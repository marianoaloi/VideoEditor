/**
 * Slider values <-> `CropResult` fields, and the colour model of the crop preview
 * (cutter-crop-zoom.md 3.4, 3.7). Pure, no DOM.
 *
 * Scales (frozen in `domain/geometry.ts`): `bright` = slider / 255, `contrast` = slider / 100,
 * `transpose` = -slider degrees. The slider rotation is degrees CLOCKWISE as previewed.
 */
import type { CropResult, Rect } from '../domain/geometry'

export const BRIGHTNESS_MIN = -255
export const BRIGHTNESS_MAX = 255
export const CONTRAST_MIN = -400
export const CONTRAST_MAX = 400
export const ROTATION_MIN = -180
export const ROTATION_MAX = 180
export const NEUTRAL_BRIGHTNESS = 0
export const NEUTRAL_CONTRAST = 100
export const NEUTRAL_ROTATION = 0

/** `eq` brightness gain measured against ffmpeg (research 3.4): out = ... + 1.164 * beta. */
export const BRIGHTNESS_GAIN = 1.164

export interface SliderValues {
  brightness: number
  contrast: number
  rotation: number
}

export const NEUTRAL_SLIDERS: SliderValues = {
  brightness: NEUTRAL_BRIGHTNESS,
  contrast: NEUTRAL_CONTRAST,
  rotation: NEUTRAL_ROTATION
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}

export function clampSliders(values: SliderValues): SliderValues {
  return {
    brightness: clamp(Math.round(values.brightness), BRIGHTNESS_MIN, BRIGHTNESS_MAX),
    contrast: clamp(Math.round(values.contrast), CONTRAST_MIN, CONTRAST_MAX),
    rotation: clamp(Math.round(values.rotation), ROTATION_MIN, ROTATION_MAX)
  }
}

/** Initial sliders from a seed result (legacy CR:54, 69, 84: `int(bright*255)`, `contrast*100`, `-transpose`). */
export function slidersFromResult(seed: Partial<CropResult> | undefined): SliderValues {
  if (seed === undefined) return { ...NEUTRAL_SLIDERS }
  return clampSliders({
    brightness: seed.bright == null ? NEUTRAL_BRIGHTNESS : Math.trunc(seed.bright * 255),
    contrast: seed.contrast == null ? NEUTRAL_CONTRAST : Math.round(seed.contrast * 100),
    rotation: seed.transpose == null || seed.transpose === 0 ? NEUTRAL_ROTATION : -seed.transpose
  })
}

export function isNeutralSliders(values: SliderValues): boolean {
  return (
    values.brightness === NEUTRAL_BRIGHTNESS &&
    values.contrast === NEUTRAL_CONTRAST &&
    values.rotation === NEUTRAL_ROTATION
  )
}

/** Sliders and the selection (already in source pixels) to the dialog result; neutral is `null`. */
export function buildCropResult(crop: Rect | null, sliders: SliderValues): CropResult {
  const s = clampSliders(sliders)
  return {
    crop,
    bright: s.brightness === NEUTRAL_BRIGHTNESS ? null : s.brightness / 255,
    contrast: s.contrast === NEUTRAL_CONTRAST ? null : s.contrast / 100,
    transpose: s.rotation === NEUTRAL_ROTATION ? null : 0 - s.rotation
  }
}

/** Video hosts only offer -180, -90, 0, 90, 180. */
export function snapToQuarterTurns(rotation: number): number {
  return clamp(Math.round(rotation / 90) * 90, ROTATION_MIN, ROTATION_MAX)
}

/**
 * Preview colour model: contrast pivots around mid-grey like ffmpeg `eq`, brightness adds
 * `1.164 * brightness`. `bright` is -1..1 (slider / 255), `contrast` is -4..4 (1 neutral).
 */
export function adjustChannel(value: number, bright: number, contrast: number): number {
  const out = (value - 128) * contrast + 128 + BRIGHTNESS_GAIN * bright * 255
  return clamp(Math.round(out), 0, 255)
}

/** 256-entry lookup table for `adjustChannel`. */
export function buildAdjustLut(bright: number, contrast: number): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256)
  for (let v = 0; v < 256; v += 1) lut[v] = adjustChannel(v, bright, contrast)
  return lut
}

/** Applies the model to RGBA bytes in place (alpha untouched). */
export function applyAdjustmentsToRgba(
  data: Uint8ClampedArray,
  bright: number,
  contrast: number
): void {
  if (bright === 0 && contrast === 1) return
  const lut = buildAdjustLut(bright, contrast)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i] ?? 0] ?? 0
    data[i + 1] = lut[data[i + 1] ?? 0] ?? 0
    data[i + 2] = lut[data[i + 2] ?? 0] ?? 0
  }
}

/** Contrast label: the slider as a factor with two decimals (legacy shows `str(alpha)`). */
export function contrastLabel(slider: number): string {
  return (slider / 100).toFixed(2)
}
