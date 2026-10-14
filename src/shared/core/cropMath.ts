/**
 * Crop geometry shared by the CropDialog and Image Triage (cutter-crop-zoom.md 3.3, 3.6, 3.7).
 * Pure functions, no DOM.
 *
 * Two pixel spaces:
 * - SOURCE: the (auto-rotated) image as delivered, the space of `CropResult.crop`;
 * - DISPLAYED: the source after the previewed rotation. Quarter turns swap width and height; any
 *   other angle keeps the canvas (legacy `warpAffine`, corners cut), so the rectangle is kept as is.
 * `rotationCw` is the PREVIEW rotation in degrees clockwise (the slider value).
 */
import { clampRect, type Rect, type Size } from '../domain/geometry'

/** A rectangle with fractional coordinates (view or displayed pixels). */
export interface FloatRect {
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

export type Corner = 'tl' | 'tr' | 'bl' | 'br'

/** Corner grab distance (legacy RB:54-59, Manhattan distance in view pixels). */
export const CORNER_GRAB_PX = 20
/** Minimum selection edge in view pixels (legacy RB:28). */
export const MIN_SELECTION_VIEW_PX = 30
/** Minimum selection edge in source pixels. */
export const MIN_SELECTION_SOURCE_PX = 2

const EPSILON = 1e-9

/** Normalises any angle to 0, 90, 180 or 270; `null` when it is not a quarter turn. */
export function quarterTurns(rotationCw: number): 0 | 90 | 180 | 270 | null {
  const a = ((Math.round(rotationCw) % 360) + 360) % 360
  return a === 0 || a === 90 || a === 180 || a === 270 ? a : null
}

/** Scale that fits `image` inside `box` keeping the aspect ratio (1 for degenerate input). */
export function fitScale(image: Size, box: Size): number {
  if (image.width <= 0 || image.height <= 0 || box.width <= 0 || box.height <= 0) return 1
  return Math.min(box.width / image.width, box.height / image.height)
}

/** Size of the picture after the previewed rotation. */
export function displayedSize(source: Size, rotationCw: number): Size {
  const q = quarterTurns(rotationCw)
  return q === 90 || q === 270
    ? { width: source.height, height: source.width }
    : { width: source.width, height: source.height }
}

/** `trunc(view / scale)` for each value on its own (legacy `int()`), clamped into `bounds`. */
export function viewToImageRect(view: FloatRect, scale: number, bounds: Size): Rect {
  const t = (v: number): number => Math.trunc(v / scale + EPSILON)
  return clampRect({ x: t(view.x), y: t(view.y), w: t(view.w), h: t(view.h) }, bounds)
}

/** Scales an image-pixel rectangle to view pixels. */
export function imageToViewRect(rect: FloatRect, scale: number): FloatRect {
  return { x: rect.x * scale, y: rect.y * scale, w: rect.w * scale, h: rect.h * scale }
}

/** Displayed-space rectangle to SOURCE pixels (TV-6 table); other angles keep the rectangle. */
export function displayedToSource(d: Rect, source: Size, rotationCw: number): Rect {
  const { width: W, height: H } = source
  switch (quarterTurns(rotationCw)) {
    case 90:
      return { x: d.y, y: H - d.x - d.w, w: d.h, h: d.w }
    case 180:
      return { x: W - d.x - d.w, y: H - d.y - d.h, w: d.w, h: d.h }
    case 270:
      return { x: W - d.y - d.h, y: d.x, w: d.h, h: d.w }
    default:
      return d
  }
}

/** Inverse of `displayedToSource`. */
export function sourceToDisplayed(s: Rect, source: Size, rotationCw: number): Rect {
  const { width: W, height: H } = source
  switch (quarterTurns(rotationCw)) {
    case 90:
      return { x: H - s.y - s.h, y: s.x, w: s.h, h: s.w }
    case 180:
      return { x: W - s.x - s.w, y: H - s.y - s.h, w: s.w, h: s.h }
    case 270:
      return { x: s.y, y: W - s.x - s.w, w: s.h, h: s.w }
    default:
      return s
  }
}

/**
 * Clips `rect` to the image. `null` when nothing is left (a replayed crop that starts outside a
 * smaller image): the caller refuses before touching any file (DP-24).
 */
export function fitRectToImage(rect: Rect, size: Size): Rect | null {
  if (rect.x >= size.width || rect.y >= size.height) return null
  const w = Math.min(rect.w, size.width - rect.x)
  const h = Math.min(rect.h, size.height - rect.y)
  return w > 0 && h > 0 ? { x: rect.x, y: rect.y, w, h } : null
}

/** Rectangle spanned by two points (works in either drag direction). */
export function rectFromPoints(a: Point, b: Point): FloatRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y)
  }
}

export function cornerPoint(rect: FloatRect, corner: Corner): Point {
  return {
    x: corner === 'tl' || corner === 'bl' ? rect.x : rect.x + rect.w,
    y: corner === 'tl' || corner === 'tr' ? rect.y : rect.y + rect.h
  }
}

export function oppositeCorner(corner: Corner): Corner {
  const map: Record<Corner, Corner> = { tl: 'br', tr: 'bl', bl: 'tr', br: 'tl' }
  return map[corner]
}

/** The corner within `radius` (Manhattan) of `point`, nearest first, or `null`. */
export function hitCorner(rect: FloatRect, point: Point, radius = CORNER_GRAB_PX): Corner | null {
  let best: Corner | null = null
  let bestDistance = radius
  for (const corner of ['tl', 'tr', 'bl', 'br'] as const) {
    const c = cornerPoint(rect, corner)
    const distance = Math.abs(point.x - c.x) + Math.abs(point.y - c.y)
    if (distance < bestDistance) {
      best = corner
      bestDistance = distance
    }
  }
  return best
}

export function containsPoint(rect: FloatRect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
  )
}

function clampNumber(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi))
}

/**
 * Rectangle from a fixed `anchor` to the dragged `point`: clamped to `bounds`, flips over the
 * anchor like the legacy band, and never smaller than `min` on either edge (it grows away from
 * the anchor in the direction of the pointer, shifted back inside the bounds when needed).
 */
export function rectFromAnchor(anchor: Point, point: Point, bounds: Size, min: number): FloatRect {
  const px = clampNumber(point.x, 0, bounds.width)
  const py = clampNumber(point.y, 0, bounds.height)
  const edge = (a: number, p: number, limit: number): [number, number] => {
    const dir = p >= a ? 1 : -1
    const length = Math.max(Math.abs(p - a), Math.min(min, limit))
    const far = a + dir * length
    if (far > limit) return [limit - length, length]
    if (far < 0) return [0, length]
    return [dir > 0 ? a : far, length]
  }
  const [x, w] = edge(anchor.x, px, bounds.width)
  const [y, h] = edge(anchor.y, py, bounds.height)
  return { x, y, w, h }
}

/** Moves a rectangle by (dx, dy) keeping it inside `bounds`. */
export function moveRect(rect: FloatRect, dx: number, dy: number, bounds: Size): FloatRect {
  return {
    x: clampNumber(rect.x + dx, 0, bounds.width - rect.w),
    y: clampNumber(rect.y + dy, 0, bounds.height - rect.h),
    w: rect.w,
    h: rect.h
  }
}

/**
 * "Vertical Default" (CR:236-245): keep x and width, take the full height. Without a selection
 * the typical portrait band of the author (204 of 360 rows, centred).
 */
export function verticalDefaultRect(displayed: Size, selection: FloatRect | null): Rect {
  const { width: W, height: H } = displayed
  if (selection !== null) {
    return clampRect({ x: selection.x, y: 0, w: selection.w, h: H }, displayed)
  }
  const w = Math.max(1, Math.min(W, Math.round((204 / 360) * H)))
  return { x: Math.floor((W - w) / 2), y: 0, w, h: H }
}

/** "Horizontal Default" (CR:246-255): keep y and height, take the full width. */
export function horizontalDefaultRect(displayed: Size, selection: FloatRect | null): Rect {
  const { width: W, height: H } = displayed
  if (selection !== null) {
    return clampRect({ x: 0, y: selection.y, w: W, h: selection.h }, displayed)
  }
  const h = Math.max(1, Math.min(H, Math.round((204 / 360) * W)))
  return { x: 0, y: Math.floor((H - h) / 2), w: W, h }
}

/** Quick-cut button caption `y1,y2,x1,x2` (G:831; matches the slice `[y1:y2, x1:x2]`). */
export function cropLabel(crop: Rect): string {
  return `${crop.y},${crop.y + crop.h},${crop.x},${crop.x + crop.w}`
}
