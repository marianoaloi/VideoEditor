/**
 * Zoom viewer arithmetic (cutter-crop-zoom.md 6, TV-10). Pure, no DOM.
 * Scale 1 = 100 % of the natural size.
 */
export const ZOOM_MIN = 0.05
export const ZOOM_MAX = 30
export const ZOOM_WHEEL_UP = 1.1
export const ZOOM_WHEEL_DOWN = 0.9
/** Zoom slider range in percent (legacy -500..3000; the port cannot reach <= 0). */
export const ZOOM_SLIDER_MIN = 5
export const ZOOM_SLIDER_MAX = 3000

export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.min(Math.max(scale, ZOOM_MIN), ZOOM_MAX)
}

/** One wheel notch: up (`deltaY < 0`) x1.1, down x0.9. 1.1 and 0.9 are not inverses (legacy). */
export function wheelZoom(scale: number, deltaY: number): number {
  if (deltaY === 0) return scale
  return clampZoom(scale * (deltaY < 0 ? ZOOM_WHEEL_UP : ZOOM_WHEEL_DOWN))
}

/** Slider value (percent, truncated like Python `int`) for a scale. */
export function sliderFromZoom(scale: number): number {
  const value = Math.trunc(clampZoom(scale) * 100 + 1e-9)
  return Math.min(Math.max(value, ZOOM_SLIDER_MIN), ZOOM_SLIDER_MAX)
}

export function zoomFromSlider(value: number): number {
  return clampZoom(Math.min(Math.max(value, ZOOM_SLIDER_MIN), ZOOM_SLIDER_MAX) / 100)
}

/** `"+1.09 x"` (legacy `"{:+.2f} x"`). */
export function formatZoom(scale: number): string {
  return `${scale < 0 ? '-' : '+'}${Math.abs(scale).toFixed(2)} x`
}

export interface Box {
  width: number
  height: number
}

/** Scale that fits the whole picture in the viewport (may be above 1). */
export function zoomToFit(image: Box, viewport: Box): number {
  if (image.width <= 0 || image.height <= 0) return 1
  return clampZoom(Math.min(viewport.width / image.width, viewport.height / image.height))
}

export interface Pan {
  x: number
  y: number
}

/** Top-left offset of the picture; a picture smaller than the viewport is centred. */
export function clampPan(pan: Pan, image: Box, scale: number, viewport: Box): Pan {
  const axis = (offset: number, imageSize: number, viewSize: number): number => {
    const shown = imageSize * scale
    if (shown <= viewSize) return (viewSize - shown) / 2
    return Math.min(0, Math.max(viewSize - shown, offset))
  }
  return {
    x: axis(pan.x, image.width, viewport.width),
    y: axis(pan.y, image.height, viewport.height)
  }
}

/** New pan that keeps the picture point under `pointer` fixed while the scale changes. */
export function panForZoomAbout(pan: Pan, pointer: Pan, oldScale: number, newScale: number): Pan {
  const ratio = newScale / oldScale
  return { x: pointer.x - (pointer.x - pan.x) * ratio, y: pointer.y - (pointer.y - pan.y) * ratio }
}
