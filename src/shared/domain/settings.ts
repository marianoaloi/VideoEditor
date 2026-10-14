/**
 * Settings (SPEC §2, LEG §11.3): folders, thresholds, ffmpeg, player, thumbs, triage, hooks.
 * Owner (wave 2): svc-files (store: userData JSON). "Not set" is `null`, never a missing key,
 * so a JSON patch can clear a value.
 */
import { z } from 'zod';
import { AbsPathSchema, FolderNameSchema } from './common';
import { CommandTemplateSchema, type CommandTemplate, type HookName } from './hooks';

export const SETTINGS_SCHEMA_VERSION = 1;
const MiB = 1024 * 1024;

export const FoldersSettingsSchema = z.object({
  left: FolderNameSchema,
  right: FolderNameSchema,
  custom: FolderNameSchema,
  purge: FolderNameSchema,
  backup: FolderNameSchema,
  ruim: FolderNameSchema,
  /** The `P` key copies here. No default; the key is disabled while `null` (SPEC §4). */
  personal: AbsPathSchema.nullable()
});

const PositiveInt = z.number().int().positive();

/** Info-bar colours and estimates (choicevideos/main.py `fillVideo`, `changeDurationSelected`). */
export const ThresholdsSettingsSchema = z.object({
  /** Bitrate cap for jobs and estimates (legacy `Util.maxRateVideo`). */
  maxRateKbps: PositiveInt,
  /** Longest output side when scaling (legacy 640). */
  maxSide: PositiveInt,
  /** Size budget behind `otimizedTime` (legacy `maxVideosize`, 130 MiB). */
  maxOutputBytes: PositiveInt,
  /** Pixel budget behind `otimizedSize` (legacy `defaultPixelSizeMedia` = 640×360). */
  targetPixels: PositiveInt,
  /** Job outputs smaller than this are failures (ADR-005). */
  minOutputBytes: z.number().int().nonnegative(),
  fileSize: z.object({ greenBelowBytes: PositiveInt, yellowBelowBytes: PositiveInt }),
  duration: z.object({ greenBelowMs: PositiveInt, yellowBelowMs: PositiveInt }),
  /** Selected-range colour (`TimeDuration`); the legacy uses the same 10/28 min bands. */
  selection: z.object({ greenBelowMs: PositiveInt, yellowBelowMs: PositiveInt }),
  fps: z.object({ greenAbove: z.number().nonnegative(), yellowAbove: z.number().nonnegative() }),
  /** Legacy compares the WIDTH with 1000 / `maxRateVideo` (500). */
  width: z.object({ redAbove: PositiveInt, yellowAbove: PositiveInt }),
  bitrate: z.object({ redAboveKbps: PositiveInt, yellowAboveKbps: PositiveInt }),
  /** Duplicates: an info cell turns red when sizes differ by more than this percentage. */
  duplicateSizeDiffPercent: z.number().nonnegative()
});

export const HwaccelSchema = z.enum([
  'none',
  'auto',
  'cuda',
  'd3d11va',
  'dxva2',
  'qsv',
  'vaapi',
  'videotoolbox'
]);
export type Hwaccel = z.infer<typeof HwaccelSchema>;

export const FfmpegSettingsSchema = z.object({
  /** `null` → look up `ffmpeg` on PATH (ADR-005). */
  ffmpegPath: AbsPathSchema.nullable(),
  ffprobePath: AbsPathSchema.nullable(),
  /** Encoder chain, tried in order (legacy extras: libx264rgb, h264_v4l2m2m, h264_vaapi). */
  encoders: z.array(z.string().regex(/^[A-Za-z0-9_]+$/)).min(1),
  /** Used for the first (GPU) attempt; the runner retries on CPU without it. */
  hwaccel: HwaccelSchema,
  /** Queue workers (legacy: 2). */
  concurrency: z.number().int().min(1).max(8)
});

export const PlayerSettingsSchema = z.object({
  /** Video Triage window stays on top (legacy default). */
  stayOnTop: z.boolean(),
  /** Legacy `-p`: open paused. */
  startPaused: z.boolean(),
  volume: z.number().min(0).max(1)
});

/** Legacy ChoiceVideos menu toggles. */
export const VideoTriageSettingsSchema = z.object({
  /** Off = "Disable Analise Video": browse without player or ffprobe. */
  analyse: z.boolean(),
  /** "Error move R": move files ffprobe can't read straight to R/. */
  errorMoveR: z.boolean()
});

export const ThumbsSettingsSchema = z.object({
  /** `null` → `<userData>/thumbs`. */
  cacheDir: AbsPathSchema.nullable(),
  /** "Enable Thumbs": show the 4×4 mosaic in Video Triage. */
  enabled: z.boolean(),
  /** How many next items get probe + mosaic prefetched. */
  prefetch: z.number().int().min(0).max(20)
});

export const ImageTriageSettingsSchema = z.object({
  /** Main strip size (research `stripCount`), 1..9. History strips stay 4 tiles each. */
  visibleCount: z.number().int().min(1).max(9),
  leftDir: FolderNameSchema,
  rightDir: FolderNameSchema,
  /** Auto-advance timer (key S): 100..60000 ms. */
  autoAdvanceMs: z.number().int().min(100).max(60000),
  /** `L` ("send") first trashes zero-byte files and `*.log` in `L/`. */
  sendPreclean: z.boolean()
});

export const HooksSettingsSchema = z.object({
  uploadOutputs: CommandTemplateSchema,
  uploadAll: CommandTemplateSchema,
  moviesL: CommandTemplateSchema,
  uploadImagesL: CommandTemplateSchema,
  deleteR: CommandTemplateSchema,
  externalPlayer: CommandTemplateSchema,
  openList: CommandTemplateSchema
});

export const SettingsSchema = z.object({
  schemaVersion: z.literal(SETTINGS_SCHEMA_VERSION),
  folders: FoldersSettingsSchema,
  thresholds: ThresholdsSettingsSchema,
  ffmpeg: FfmpegSettingsSchema,
  player: PlayerSettingsSchema,
  videoTriage: VideoTriageSettingsSchema,
  thumbs: ThumbsSettingsSchema,
  imageTriage: ImageTriageSettingsSchema,
  hooks: HooksSettingsSchema
});
export type Settings = z.infer<typeof SettingsSchema>;

export const SETTINGS_SECTIONS = [
  'folders',
  'thresholds',
  'ffmpeg',
  'player',
  'videoTriage',
  'thumbs',
  'imageTriage',
  'hooks'
] as const satisfies readonly (keyof Settings)[];
export const SettingsSectionSchema = z.enum(SETTINGS_SECTIONS);
export type SettingsSection = z.infer<typeof SettingsSectionSchema>;

function hook(args: string[], env?: Record<string, string>): CommandTemplate {
  return env === undefined
    ? { enabled: false, command: '', args }
    : { enabled: false, command: '', args, env };
}

/** All hooks are disabled by default (ADR-008). The env defaults mirror the legacy scripts. */
const DEFAULT_HOOKS: Record<HookName, CommandTemplate> = {
  uploadOutputs: hook(['{outputs}']),
  uploadAll: hook(['{outputs}']),
  moviesL: hook(['{dir}'], { upload: 'true' }),
  uploadImagesL: hook(['{dir}'], { NAUTILUS_SCRIPT_SELECTED_FILE_PATHS: '{dir}' }),
  deleteR: hook([], { NAUTILUS_SCRIPT_SELECTED_FILE_PATHS: '{dir}' }),
  externalPlayer: hook(['{file}']),
  openList: hook(['{files}'])
};

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  folders: {
    left: 'L',
    right: 'R',
    custom: 'CUSTOM',
    purge: 'md5Purge',
    backup: 'bkp',
    ruim: 'ruimFolder',
    personal: null
  },
  thresholds: {
    maxRateKbps: 500,
    maxSide: 640,
    maxOutputBytes: 130 * MiB,
    targetPixels: 640 * 360,
    minOutputBytes: 1000,
    fileSize: { greenBelowBytes: 50 * MiB, yellowBelowBytes: 130 * MiB },
    duration: { greenBelowMs: 10 * 60_000, yellowBelowMs: 28 * 60_000 },
    selection: { greenBelowMs: 10 * 60_000, yellowBelowMs: 28 * 60_000 },
    fps: { greenAbove: 25, yellowAbove: 20 },
    width: { redAbove: 1000, yellowAbove: 500 },
    bitrate: { redAboveKbps: 1000, yellowAboveKbps: 500 },
    duplicateSizeDiffPercent: 0.5
  },
  ffmpeg: {
    ffmpegPath: null,
    ffprobePath: null,
    encoders: ['h264_nvenc', 'libx264'],
    hwaccel: 'cuda',
    concurrency: 2
  },
  player: { stayOnTop: true, startPaused: false, volume: 0.5 },
  videoTriage: { analyse: true, errorMoveR: false },
  thumbs: { cacheDir: null, enabled: false, prefetch: 2 },
  imageTriage: {
    visibleCount: 5,
    leftDir: 'L',
    rightDir: 'R',
    autoAdvanceMs: 1000,
    sendPreclean: true
  },
  hooks: DEFAULT_HOOKS
};

// ---- patches ------------------------------------------------------------------------------

/** Plain objects merge recursively; arrays, primitives and `null` replace; `undefined` keeps. */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;
export type SettingsPatch = DeepPartial<Settings>;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Maps whose keys the operator can delete: a patch replaces them instead of merging. */
const REPLACE_KEYS: ReadonlySet<string> = new Set(['env']);

function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch === undefined ? base : patch;
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (FORBIDDEN_KEYS.has(key) || value === undefined) continue;
    result[key] = REPLACE_KEYS.has(key) ? value : deepMerge(base[key], value);
  }
  return result;
}

/** Merge and validate. Throws a ZodError when the result is invalid (main maps it to VALIDATION). */
export function applySettingsPatch(base: Settings, patch: SettingsPatch): Settings {
  return SettingsSchema.parse(deepMerge(base, patch));
}

/**
 * Tolerant load of a stored settings file: merges it over the defaults section by section;
 * a section that fails validation falls back to its default and yields a warning.
 */
export function parseStoredSettings(raw: unknown): { settings: Settings; warnings: string[] } {
  const warnings: string[] = [];
  const stored = isPlainObject(raw) ? raw : {};
  if (!isPlainObject(raw)) warnings.push('Settings file is not a JSON object; using defaults.');
  const settings: Record<string, unknown> = { schemaVersion: SETTINGS_SCHEMA_VERSION };
  for (const section of SETTINGS_SECTIONS) {
    const merged = deepMerge(DEFAULT_SETTINGS[section], stored[section]);
    const parsed = SettingsSchema.shape[section].safeParse(merged);
    if (parsed.success) {
      settings[section] = parsed.data;
    } else {
      settings[section] = DEFAULT_SETTINGS[section];
      warnings.push(`Settings section "${section}" is invalid and was reset: ${parsed.error.message}`);
    }
  }
  return { settings: SettingsSchema.parse(settings), warnings };
}
