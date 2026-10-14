/**
 * Media channels: probe, frames, mosaics, prefetch, black bars, image edits.
 * Owner (wave 2): svc-media. `media:probe` calls svc-jobs' `services/ffmpeg/probe.ts`.
 */
import { defineInvoke, type InvokeMapOf } from '../define';
import type { Rect } from '../../domain/geometry';
import {
  DetectBlackBarsRequestSchema,
  GenerateMosaicsRequestSchema,
  GrabFrameRequestSchema,
  ImageEditRequestSchema,
  ImagePreviewRequestSchema,
  ImageRestoreRequestSchema,
  ImageRotateRequestSchema,
  MediaCancelTaskRequestSchema,
  MosaicRequestSchema,
  PrefetchRequestSchema,
  ProbeManyRequestSchema,
  ProbeRequestSchema,
  type FrameRef,
  type GenerateMosaicsResult,
  type ImageEditResult,
  type ImagePreviewResult,
  type ImageRef,
  type ImageRestoreResult,
  type MediaInfo,
  type MosaicProgress,
  type PrefetchResult,
  type ProbeManyResult
} from '../../domain/media';

export {
  DetectBlackBarsRequestSchema,
  GenerateMosaicsRequestSchema,
  GrabFrameRequestSchema,
  ImageEditRequestSchema,
  ImageRestoreRequestSchema,
  ImageRotateRequestSchema,
  MediaCancelTaskRequestSchema,
  MosaicRequestSchema,
  PrefetchRequestSchema,
  ProbeManyRequestSchema,
  ProbeRequestSchema
};

export const mediaInvoke = {
  /** PROBE_FAILED for unreadable files (legacy "Error in get informations"). */
  'media:probe': defineInvoke(ProbeRequestSchema).returns<MediaInfo>(),
  'media:probeMany': defineInvoke(ProbeManyRequestSchema).returns<ProbeManyResult>(),
  /** Frame at `atMs` into a temp file (ffmpeg rawvideo → PNG → thumbnailer fallbacks). */
  'media:grabFrame': defineInvoke(GrabFrameRequestSchema).returns<FrameRef>(),
  /** Cached 4×4 mosaic of 16 frames (skips 10 s at each end when it can). */
  'media:mosaic': defineInvoke(MosaicRequestSchema).returns<ImageRef>(),
  /** Warm the probe/mosaic caches for the next items; returns at once. */
  'media:prefetch': defineInvoke(PrefetchRequestSchema).returns<PrefetchResult>(),
  /** "Generate Thumbs": resolves when finished or cancelled; progress via `media:mosaicProgress`. */
  'media:generateMosaics': defineInvoke(GenerateMosaicsRequestSchema).returns<GenerateMosaicsResult>(),
  'media:cancelTask': defineInvoke(MediaCancelTaskRequestSchema).returns<void>(),
  /** Auto-detect black bars ("Strip Image"); the crop dialog's default selection. */
  'media:detectBlackBars': defineInvoke(DetectBlackBarsRequestSchema).returns<Rect>(),
  /** Crop/adjust an image in place after a `bkp/` copy; journaled as `write`. */
  /** Converted preview for files `<img>` cannot draw. The original is never rewritten. */
  'media:imagePreview': defineInvoke(ImagePreviewRequestSchema).returns<ImagePreviewResult>(),
  'media:imageEdit': defineInvoke(ImageEditRequestSchema).returns<ImageEditResult>(),
  /** End key (`ccw90`). Backup + journal like `media:imageEdit`. */
  'media:imageRotate': defineInvoke(ImageRotateRequestSchema).returns<ImageEditResult>(),
  /** Ctrl+F "un-crop": restore the original from `bkp/`. */
  'media:imageRestoreBackup': defineInvoke(ImageRestoreRequestSchema).returns<ImageRestoreResult>()
} as const;

export type MediaInvoke = InvokeMapOf<typeof mediaInvoke>;

export interface MediaEvents {
  'media:mosaicProgress': MosaicProgress;
}
