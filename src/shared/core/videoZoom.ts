/**
 * Pure math of the player zoom (visual magnification of the picture inside the player box).
 *
 * The picture is scaled around the centre of the box and moved by a pan offset. The pan is stored
 * as a fraction of the box size (not pixels) so Video Triage and the Cutter, whose boxes differ,
 * show the same part of the picture. With zoom `z` the picture covers the box as long as the
 * offset stays within `+-(z - 1) / 2` box sizes per axis.
 */

export const MIN_ZOOM = 1
export const MAX_ZOOM = 8
export const ZOOM_STEP = 1.25

export interface Pan {
  x: number
  y: number
}

export const NO_PAN: Readonly<Pan> = { x: 0, y: 0 }

/** Rounds away float noise from repeated multiplications (1.25^3 etc.). */
const tidy = (value: number): number => Math.round(value * 10_000) / 10_000

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_ZOOM
  return tidy(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)))
}

export function zoomIn(zoom: number): number {
  return clampZoom(zoom * ZOOM_STEP)
}

export function zoomOut(zoom: number): number {
  return clampZoom(zoom / ZOOM_STEP)
}

/** Largest pan offset per axis (box fractions) that keeps the picture covering the box. */
export function maxPan(zoom: number): number {
  return (clampZoom(zoom) - 1) / 2
}

/** `-0` is normalised to `0` so equality checks and snapshots stay simple. */
const bound = (value: number, limit: number): number => {
  const result = Math.min(limit, Math.max(-limit, Number.isFinite(value) ? value : 0))
  return result === 0 ? 0 : result
}

export function clampPan(pan: Pan, zoom: number): Pan {
  const limit = maxPan(zoom)
  return { x: bound(pan.x, limit), y: bound(pan.y, limit) }
}

/** Keeps the same picture point at the centre when the zoom changes, then clamps. */
export function rescalePan(pan: Pan, fromZoom: number, toZoom: number): Pan {
  const ratio = clampZoom(toZoom) / clampZoom(fromZoom)
  return clampPan({ x: pan.x * ratio, y: pan.y * ratio }, toZoom)
}

/** Pan after dragging by `dxPx`/`dyPx` inside a box of the given pixel size. */
export function dragPan(
  pan: Pan,
  zoom: number,
  delta: { dxPx: number; dyPx: number },
  box: { width: number; height: number }
): Pan {
  if (box.width <= 0 || box.height <= 0) return clampPan(pan, zoom)
  return clampPan({ x: pan.x + delta.dxPx / box.width, y: pan.y + delta.dyPx / box.height }, zoom)
}

/**
 * CSS `transform` of the full-box `<video>` element (`transform-origin` at the centre). Its
 * translate percentages refer to the element, which is the box, so the pan fractions map 1:1.
 */
export function zoomTransform(zoom: number, pan: Pan): string {
  const z = clampZoom(zoom)
  const p = clampPan(pan, z)
  return `translate(${tidy(p.x * 100)}%, ${tidy(p.y * 100)}%) scale(${z})`
}

/** "250 %" for the badge. */
export function formatZoom(zoom: number): string {
  return `${Math.round(clampZoom(zoom) * 100)} %`
}
