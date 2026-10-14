/**
 * Offscreen canvas with the brightness / contrast model applied (shared by the CropDialog and
 * the ZoomViewer). The accurate path reads pixels and applies `adjustments.ts`; if the canvas is
 * tainted (a `media://` image without CORS headers) it falls back to the 2D `filter` property,
 * which approximates the same model without reading pixels.
 */
import { applyAdjustmentsToRgba, BRIGHTNESS_GAIN } from '@shared/core/adjustments'

export interface AdjustParams {
  /** -1..1 */
  bright: number
  /** -4..4, 1 = neutral */
  contrast: number
}

export function isNeutralAdjust(params: AdjustParams): boolean {
  return params.bright === 0 && params.contrast === 1
}

function drawPlain(ctx: CanvasRenderingContext2D, image: CanvasImageSource, w: number, h: number): void {
  ctx.drawImage(image, 0, 0, w, h)
}

function drawFiltered(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  w: number,
  h: number,
  params: AdjustParams
): void {
  const brightness = Math.max(0, 1 + BRIGHTNESS_GAIN * params.bright)
  ctx.filter = `contrast(${Math.max(0, params.contrast)}) brightness(${brightness})`
  drawPlain(ctx, image, w, h)
  ctx.filter = 'none'
}

/** `null` when the environment has no 2D canvas (jsdom) or the size is empty. */
export function renderAdjusted(
  image: CanvasImageSource,
  width: number,
  height: number,
  params: AdjustParams
): HTMLCanvasElement | null {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (ctx === null) return null
  drawPlain(ctx, image, w, h)
  if (isNeutralAdjust(params)) return canvas
  try {
    const data = ctx.getImageData(0, 0, w, h)
    applyAdjustmentsToRgba(data.data, params.bright, params.contrast)
    ctx.putImageData(data, 0, 0)
  } catch (error: unknown) {
    if (!(error instanceof DOMException) || error.name !== 'SecurityError') throw error
    ctx.clearRect(0, 0, w, h)
    drawFiltered(ctx, image, w, h, params)
  }
  return canvas
}
