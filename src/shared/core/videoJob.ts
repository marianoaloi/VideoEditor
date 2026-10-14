/**
 * Reads every job-JSON format (v2 and both legacy ones) and writes v2 (SPEC §4, acceptance 1).
 * Pure: the caller does the I/O. Owner (wave 2): svc-jobs.
 *
 * Legacy behaviour kept on purpose (mediamaloipackage/UtilFileTimes.py, FFMPEGVideoDTO.py):
 * - old format: `definedSize` → size, `definedRate` → rate (the legacy reader crashed on this,
 *   LEG §9), `times: [{st, du}]` → `[st, du]` where `du` is the END, `posExecution "f"` → concat;
 * - ranges are `[min, max]` (TimeDTO) except `[-1, durationMs]` = the whole video;
 * - the job's `filename` is the video's real location (openTimes does the same).
 * Not kept: `originalPath` is preserved instead of being reset (undo now uses the journal).
 */
import {
  ProcessingMode,
  RangeSchema,
  VideoJobSchema,
  VideoSizeSchema,
  WHOLE_VIDEO_START_MS,
  VideoJobDraftSchema,
  type Range,
  type VideoJob,
  type VideoJobDraft,
  type VideoJobFormat
} from '../domain/job';
import type { Rect } from '../domain/geometry';

export type ParseVideoJobResult =
  | { readonly ok: true; readonly job: VideoJob; readonly format: VideoJobFormat; readonly warnings: string[] }
  | { readonly ok: false; readonly error: string; readonly warnings: string[] };

export interface VideoJobContext {
  /** Absolute path of the video the JSON belongs to (`<video>.json` minus `.json`). */
  readonly videoPath: string;
}

type Loose = Record<string, unknown>;

function isRecord(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

class Normaliser {
  readonly warnings: string[] = [];

  warn(message: string): void {
    this.warnings.push(message);
  }

  number(field: string, value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = toNumber(value);
    if (n === null) this.warn(`${field}: "${String(value)}" is not a number; ignored`);
    return n;
  }

  positive(field: string, value: unknown, integer: boolean): number | null {
    const n = this.number(field, value);
    if (n === null) return null;
    const v = integer ? Math.trunc(n) : n;
    if (v > 0) return v;
    this.warn(`${field}: ${n} is not positive; ignored`);
    return null;
  }

  size(field: string, value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    const text = typeof value === 'number' ? String(Math.trunc(value)) : value;
    // The legacy UI also wrote "640X360" (adaptSize.py); the schema only knows the lowercase form.
    const trimmed = typeof text === 'string' ? text.trim().replace(/^(-?\d+)X(-?\d+)$/, '$1x$2') : '';
    if (VideoSizeSchema.safeParse(trimmed).success) return trimmed;
    this.warn(`${field}: "${String(value)}" is not "WxH", "W:H" or "-1"; ignored`);
    return null;
  }

  crop(value: unknown): Rect | null {
    if (value === null || value === undefined) return null;
    if (!isRecord(value)) {
      this.warn('crop: not an object; ignored');
      return null;
    }
    const [x, y, w, h] = (['x', 'y', 'w', 'h'] as const).map((k) => toNumber(value[k]));
    if (x === null || y === null || w === null || h === null || x < 0 || y < 0 || w < 1 || h < 1) {
      this.warn('crop: needs numeric x, y ≥ 0 and w, h ≥ 1; ignored');
      return null;
    }
    return { x: Math.trunc(x), y: Math.trunc(y), w: Math.trunc(w), h: Math.trunc(h) };
  }

  convert(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return ['true', '1', 'yes'].includes(value.trim().toLowerCase());
    this.warn('convert: not a boolean; using false');
    return false;
  }

  range(start: unknown, end: unknown, index: number): Range | null {
    const a = toNumber(start);
    const b = toNumber(end);
    if (a === null || b === null) {
      this.warn(`times[${index}]: not two numbers; dropped`);
      return null;
    }
    const candidate: Range =
      Math.trunc(a) === WHOLE_VIDEO_START_MS
        ? [WHOLE_VIDEO_START_MS, Math.trunc(b)]
        : [Math.trunc(Math.min(a, b)), Math.trunc(Math.max(a, b))];
    if (!RangeSchema.safeParse(candidate).success) {
      this.warn(`times[${index}]: [${a}, ${b}] is empty or negative; dropped`);
      return null;
    }
    return candidate;
  }

  times(value: unknown, oldFormat: boolean): Range[] {
    if (value === null || value === undefined) return [];
    if (!Array.isArray(value)) {
      this.warn('times: not a list; ignored');
      return [];
    }
    const ranges: Range[] = [];
    value.forEach((item: unknown, index) => {
      let range: Range | null = null;
      if (oldFormat && isRecord(item)) range = this.range(item['st'], item['du'], index);
      else if (Array.isArray(item) && item.length >= 2) range = this.range(item[0], item[1], index);
      else this.warn(`times[${index}]: unexpected shape; dropped`);
      if (range) ranges.push(range);
    });
    return ranges;
  }

  /** Legacy: `"f"` = concat, `"d"`/`"e"` = cut (DialogResume), ints 1/2 in the current format. */
  mode(value: unknown): 1 | 2 {
    if (value === null || value === undefined) return ProcessingMode.cut;
    const text = typeof value === 'string' ? value.trim().toLowerCase() : value;
    if (text === 'f' || text === '2' || text === 2) return ProcessingMode.concat;
    if (text === 'd' || text === 'e' || text === '1' || text === 1 || text === '') return ProcessingMode.cut;
    this.warn(`posExecution: "${String(value)}" is unknown; using cut`);
    return ProcessingMode.cut;
  }
}

export function detectVideoJobFormat(raw: Loose): VideoJobFormat {
  if (raw['version'] !== undefined) return 'v2';
  if ('definedSize' in raw || 'definedRate' in raw) return 'legacy-old';
  const times = raw['times'];
  if (Array.isArray(times) && times.some((t: unknown) => isRecord(t) && 'st' in t)) return 'legacy-old';
  return 'legacy';
}

function normalise(raw: Loose, format: VideoJobFormat, ctx: VideoJobContext, n: Normaliser): Loose {
  const old = format === 'legacy-old';
  const original = raw['originalPath'];
  const transpose = n.number('transpose', raw['transpose']);
  return {
    filename: ctx.videoPath,
    originalPath: typeof original === 'string' && original.length > 0 ? original : ctx.videoPath,
    crop: n.crop(raw['crop']),
    bright: n.number('bright', raw['bright']),
    contrast: n.number('contrast', raw['contrast']),
    transpose: transpose === null ? null : Math.trunc(transpose),
    mediaPath: typeof raw['mediaPath'] === 'string' ? raw['mediaPath'] : null,
    convert: n.convert(raw['convert']),
    size: n.size('size', old ? (raw['definedSize'] ?? raw['size']) : raw['size']),
    rate: n.positive('rate', old ? (raw['definedRate'] ?? raw['rate']) : raw['rate'], true),
    avgrate: n.positive('avgrate', raw['avgrate'], false),
    times: n.times(raw['times'], old),
    posExecution: n.mode(raw['posExecution']),
    version: 2
  };
}

/** Parses an already-decoded JSON value in any supported format. */
export function parseAnyVideoJob(raw: unknown, ctx: VideoJobContext): ParseVideoJobResult {
  const n = new Normaliser();
  if (!isRecord(raw)) return { ok: false, error: 'The job file is not a JSON object', warnings: [] };
  const format = detectVideoJobFormat(raw);
  if (format === 'v2') {
    const version = raw['version'];
    if (version !== 1 && version !== 2) {
      return { ok: false, error: `Unsupported job version ${String(version)}`, warnings: [] };
    }
    const strict = VideoJobSchema.safeParse({ ...raw, filename: ctx.videoPath, version: 2 });
    if (strict.success) return { ok: true, job: strict.data, format, warnings: [] };
    n.warn(`v2 job failed validation, read leniently: ${strict.error.issues.map((i) => i.message).join('; ')}`);
  }
  const parsed = VideoJobSchema.safeParse(normalise(raw, format, ctx, n));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; '), warnings: n.warnings };
  }
  return { ok: true, job: parsed.data, format, warnings: n.warnings };
}

/** Parses the text of a `<video>.json` file. Empty files are an error (ADR-005: report them). */
export function parseVideoJobText(text: string, ctx: VideoJobContext): ParseVideoJobResult {
  if (text.trim() === '') return { ok: false, error: 'The job file is empty', warnings: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `The job file is not valid JSON: ${reason}`, warnings: [] };
  }
  return parseAnyVideoJob(raw, ctx);
}

/** Builds the job `jobs:saveJob` writes. Throws a ZodError for an invalid draft. */
export function createVideoJob(videoPath: string, draft: VideoJobDraft): VideoJob {
  const d = VideoJobDraftSchema.parse(draft);
  return VideoJobSchema.parse({
    filename: videoPath,
    originalPath: d.originalPath ?? videoPath,
    crop: d.crop,
    bright: d.bright,
    contrast: d.contrast,
    transpose: d.transpose,
    mediaPath: d.mediaPath,
    convert: d.convert,
    size: d.size,
    rate: d.rate,
    avgrate: d.avgrate,
    times: d.times,
    posExecution: d.posExecution,
    version: 2
  });
}

const KEY_ORDER: readonly (keyof VideoJob)[] = [
  'filename',
  'originalPath',
  'crop',
  'bright',
  'contrast',
  'transpose',
  'mediaPath',
  'convert',
  'size',
  'rate',
  'avgrate',
  'times',
  'posExecution',
  'version'
];

/** JSON text in the legacy key order (2-space indent, trailing newline). */
export function serializeVideoJob(job: VideoJob): string {
  const valid = VideoJobSchema.parse(job);
  const ordered: Record<string, unknown> = {};
  for (const key of KEY_ORDER) ordered[key] = valid[key];
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** `<video>.json` (the legacy sidecar name keeps the video extension). */
export function jobJsonPathFor(videoPath: string): string {
  return `${videoPath}.json`;
}
