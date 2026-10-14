/**
 * Geometry and the crop/adjust result shared by the crop dialog, the job JSON and image edits.
 * Owner: frozen (lead).
 */
import { z } from 'zod';

/**
 * A rectangle in source pixels. The keys are the legacy job-JSON `crop` keys (LEG §2.2):
 * `{x, y, w, h}`, integers, measured on the displayed (auto-rotated) frame.
 */
export const RectSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive(),
  h: z.number().int().positive()
});
export type Rect = z.infer<typeof RectSchema>;

export const SizeSchema = z.object({
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative()
});
export type Size = z.infer<typeof SizeSchema>;

/**
 * What the crop dialog returns (legacy `CroppMedia.closeSend`), and what an image edit applies.
 * `null` means "unchanged". The scales are the legacy ones, so they round-trip through the job JSON:
 * - `bright`    = slider / 255, slider −255..255 → −1..1 (ffmpeg eq brightness range, ADR-005 fix)
 * - `contrast`  = slider / 100, slider −400..400 → −4..4 (1 = neutral)
 * - `transpose` = −slider degrees, slider −180..180 in steps of 45 (legacy sign convention)
 */
export const CropResultSchema = z.object({
  crop: RectSchema.nullable(),
  bright: z.number().min(-1).max(1).nullable(),
  contrast: z.number().min(-4).max(4).nullable(),
  transpose: z.number().int().min(-180).max(180).nullable()
});
export type CropResult = z.infer<typeof CropResultSchema>;

export const NEUTRAL_CROP_RESULT: CropResult = {
  crop: null,
  bright: null,
  contrast: null,
  transpose: null
};

/** True when applying the result would change nothing (legacy: no signal emitted). */
export function isNeutralCropResult(result: CropResult): boolean {
  return (
    result.crop === null &&
    (result.bright === null || result.bright === 0) &&
    (result.contrast === null || result.contrast === 1) &&
    (result.transpose === null || result.transpose === 0)
  );
}

/** Clamps a rectangle into `bounds`, keeping at least 1×1. */
export function clampRect(rect: Rect, bounds: Size): Rect {
  const x = Math.min(Math.max(0, Math.trunc(rect.x)), Math.max(0, bounds.width - 1));
  const y = Math.min(Math.max(0, Math.trunc(rect.y)), Math.max(0, bounds.height - 1));
  const w = Math.max(1, Math.min(Math.trunc(rect.w), bounds.width - x));
  const h = Math.max(1, Math.min(Math.trunc(rect.h), bounds.height - y));
  return { x, y, w, h };
}
