/**
 * Media metadata, frames, thumbnails and in-place image edits.
 * Owner (wave 2): svc-media. `MediaInfo` is produced by svc-jobs' `services/ffmpeg/probe.ts`:
 * changes to it must be additive (new optional/nullable fields) and announced to svc-jobs.
 */
import { z } from 'zod';
import {
  AbsPathSchema,
  IdSchema,
  NonNegIntSchema,
  TaskIdSchema
} from './common';
import { IpcErrorSchema } from './errors';
import { CropResultSchema } from './geometry';

export const MediaKindSchema = z.enum(['video', 'image', 'gif']);
export type MediaKind = z.infer<typeof MediaKindSchema>;

/**
 * `ffprobe -show_format -show_streams` reduced to what the app uses (ADR-005).
 * Legacy parity notes (choicevideos/main.py `fillVideo`, FFMPEGProcess):
 * - the video stream is the first non-cover-art video stream (legacy: first stream with `width`);
 * - `bitrateKbps` = trunc(bit_rate / 1000), from the format, else from the video stream;
 * - `fps` = avg_frame_rate as a float (the UI truncates it like the legacy `avgrate`);
 * - `rotation` = display-matrix rotation in degrees counter-clockwise, normalised to (−180, 180];
 *   the old `tags.rotate` (clockwise) is converted. Any non-zero value forces size "-1" in jobs.
 */
export const MediaInfoSchema = z.object({
  path: AbsPathSchema,
  /** ffprobe `format_name`, e.g. `mov,mp4,m4a,3gp,3g2,mj2`; `''` when unknown. */
  container: z.string(),
  formatLongName: z.string().nullable(),
  /** 0 when unknown (still images). */
  durationMs: NonNegIntSchema,
  sizeBytes: NonNegIntSchema,
  bitrateKbps: NonNegIntSchema.nullable(),
  hasVideo: z.boolean(),
  /** Stream size before rotation; 0 without a video stream. */
  width: NonNegIntSchema,
  height: NonNegIntSchema,
  /** Size as displayed (width/height swapped for ±90° rotation). Crop rects use this space. */
  displayWidth: NonNegIntSchema,
  displayHeight: NonNegIntSchema,
  rotation: z.number(),
  fps: z.number().nonnegative().nullable(),
  videoCodec: z.string().nullable(),
  pixFmt: z.string().nullable(),
  hasAudio: z.boolean(),
  audioCodec: z.string().nullable(),
  audioChannels: NonNegIntSchema.nullable(),
  streamCount: NonNegIntSchema
});
export type MediaInfo = z.infer<typeof MediaInfoSchema>;

/** An image the renderer can show: `url` is a `media://` URL (see `ipc/mediaUrl.ts`). */
export const ImageRefSchema = z.object({
  path: AbsPathSchema,
  url: z.string().min(1),
  width: NonNegIntSchema,
  height: NonNegIntSchema
});
export type ImageRef = z.infer<typeof ImageRefSchema>;

/** A frame grabbed from a video into a temp file (allowlisted for `media://`). */
export const FrameRefSchema = ImageRefSchema.extend({
  sourcePath: AbsPathSchema,
  atMs: NonNegIntSchema
});
export type FrameRef = z.infer<typeof FrameRefSchema>;

// ---- requests / results -------------------------------------------------------------------

export const ProbeRequestSchema = z.object({ path: AbsPathSchema });
export type ProbeRequest = z.input<typeof ProbeRequestSchema>;

export const ProbeManyRequestSchema = z.object({
  paths: z.array(AbsPathSchema).min(1).max(500)
});
export type ProbeManyRequest = z.input<typeof ProbeManyRequestSchema>;

export const ProbeManyItemSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), path: AbsPathSchema, info: MediaInfoSchema }),
  z.object({ ok: z.literal(false), path: AbsPathSchema, error: IpcErrorSchema })
]);
export const ProbeManyResultSchema = z.object({ results: z.array(ProbeManyItemSchema) });
export type ProbeManyResult = z.infer<typeof ProbeManyResultSchema>;

export const GrabFrameRequestSchema = z.object({
  path: AbsPathSchema,
  atMs: NonNegIntSchema,
  format: z.enum(['jpeg', 'png']).default('jpeg'),
  /** Downscale to at most this width. Omit for source resolution (crop needs source pixels). */
  maxWidth: z.number().int().positive().max(16384).optional()
});
export type GrabFrameRequest = z.input<typeof GrabFrameRequestSchema>;

export const MosaicRequestSchema = z.object({
  path: AbsPathSchema,
  /** Rebuild even when cached. */
  force: z.boolean().default(false)
});
export type MosaicRequest = z.input<typeof MosaicRequestSchema>;

export const PrefetchWhatSchema = z.enum(['probe', 'mosaic']);
export const PrefetchRequestSchema = z.object({
  paths: z.array(AbsPathSchema).max(50),
  what: z.array(PrefetchWhatSchema).min(1).default(['probe'])
});
export type PrefetchRequest = z.input<typeof PrefetchRequestSchema>;
export const PrefetchResultSchema = z.object({ queued: NonNegIntSchema });
export type PrefetchResult = z.infer<typeof PrefetchResultSchema>;

export const GenerateMosaicsRequestSchema = z.object({
  taskId: TaskIdSchema,
  paths: z.array(AbsPathSchema).min(1).max(200000)
});
export type GenerateMosaicsRequest = z.input<typeof GenerateMosaicsRequestSchema>;
export const GenerateMosaicsResultSchema = z.object({
  taskId: TaskIdSchema,
  done: NonNegIntSchema,
  failed: NonNegIntSchema,
  cancelled: z.boolean()
});
export type GenerateMosaicsResult = z.infer<typeof GenerateMosaicsResultSchema>;

export const MediaCancelTaskRequestSchema = z.object({ taskId: TaskIdSchema });
export type MediaCancelTaskRequest = z.input<typeof MediaCancelTaskRequestSchema>;

/** Event `media:mosaicProgress`. */
export const MosaicProgressSchema = z.object({
  taskId: TaskIdSchema,
  done: NonNegIntSchema,
  total: NonNegIntSchema,
  path: AbsPathSchema.optional(),
  error: IpcErrorSchema.optional()
});
export type MosaicProgress = z.infer<typeof MosaicProgressSchema>;

/** Black-bar detection on a video frame at `atMs` (default: 10 % of the duration) or on an image. */
export const DetectBlackBarsRequestSchema = z.object({
  path: AbsPathSchema,
  atMs: NonNegIntSchema.optional()
});
export type DetectBlackBarsRequest = z.input<typeof DetectBlackBarsRequestSchema>;

/**
 * In-place image edit (crop and/or adjust), after a `bkp/` copy (ADR-006).
 * Legacy rule: with a `crop`, only the crop is applied; without one, the adjustments are.
 */
export const ImageEditRequestSchema = z.object({
  sessionId: IdSchema,
  path: AbsPathSchema,
  edit: CropResultSchema
});
export type ImageEditRequest = z.input<typeof ImageEditRequestSchema>;

/** `ccw90` is the legacy End key (PIL `rotate(90, expand=True)`). */
export const ImageRotationSchema = z.enum(['ccw90', 'cw90', 'rot180']);
export type ImageRotation = z.infer<typeof ImageRotationSchema>;

export const ImageRotateRequestSchema = z.object({
  sessionId: IdSchema,
  path: AbsPathSchema,
  rotation: ImageRotationSchema
});
export type ImageRotateRequest = z.input<typeof ImageRotateRequestSchema>;

export const ImageEditResultSchema = z.object({
  path: AbsPathSchema,
  backupPath: AbsPathSchema,
  /** False when a backup already existed and was kept (the first original wins). */
  backupCreated: z.boolean(),
  width: NonNegIntSchema,
  height: NonNegIntSchema,
  /** New mtime in ms; pass it to `toMediaUrl(path, { version })` to bust the image cache. */
  version: z.number().nonnegative(),
  journalEntryId: IdSchema.nullable()
});
export type ImageEditResult = z.infer<typeof ImageEditResultSchema>;

export const ImageRestoreRequestSchema = z.object({
  sessionId: IdSchema,
  path: AbsPathSchema
});
export type ImageRestoreRequest = z.input<typeof ImageRestoreRequestSchema>;

export const ImageRestoreResultSchema = z.object({
  path: AbsPathSchema,
  restored: z.boolean(),
  backupPath: AbsPathSchema.nullable(),
  version: z.number().nonnegative()
});
export type ImageRestoreResult = z.infer<typeof ImageRestoreResultSchema>;

export const ImagePreviewRequestSchema = z.object({
  path: AbsPathSchema,
  force: z.boolean().default(false)
});
export type ImagePreviewRequest = z.input<typeof ImagePreviewRequestSchema>;

/** `reason: null` means the original can be shown as is (`preview` is then `null`). */
export const ImagePreviewResultSchema = z.object({
  reason: z.enum(['trailer-missing', 'not-browser-native', 'forced']).nullable(),
  preview: z.object({ url: z.string(), width: z.number(), height: z.number() }).nullable()
});
export type ImagePreviewResult = z.infer<typeof ImagePreviewResultSchema>;
