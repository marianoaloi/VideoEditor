/**
 * Rubber-band state machine of the CropDialog (cutter-crop-zoom.md 3.3), in DISPLAYED image
 * pixels. Pure, so the pointer rules are testable without Konva.
 *
 * - press on empty space (or outside the band): start a new band; a click without a drag hides it;
 * - press within 20 view px of a corner: drag that corner (the opposite one stays fixed);
 * - press inside the band: move it (extra, not legacy);
 * - the band is clamped to the picture and never smaller than 30 view px (2 source px).
 */
import type { Size } from '@shared/domain/geometry'
import {
  CORNER_GRAB_PX,
  MIN_SELECTION_SOURCE_PX,
  MIN_SELECTION_VIEW_PX,
  containsPoint,
  cornerPoint,
  hitCorner,
  moveRect,
  oppositeCorner,
  rectFromAnchor,
  type FloatRect,
  type Point
} from '@shared/core/cropMath'

export type DragState =
  | { kind: 'new'; anchor: Point; moved: boolean }
  | { kind: 'corner'; anchor: Point }
  | { kind: 'move'; last: Point }

export interface SelectionModel {
  rect: FloatRect | null
  drag: DragState | null
}

export const EMPTY_SELECTION: SelectionModel = { rect: null, drag: null }

function minEdge(scale: number): number {
  return Math.max(MIN_SELECTION_VIEW_PX / scale, MIN_SELECTION_SOURCE_PX)
}

export function pressSelection(model: SelectionModel, point: Point, scale: number): SelectionModel {
  const { rect } = model
  if (rect !== null) {
    const corner = hitCorner(rect, point, CORNER_GRAB_PX / scale)
    if (corner !== null) {
      return { rect, drag: { kind: 'corner', anchor: cornerPoint(rect, oppositeCorner(corner)) } }
    }
    if (containsPoint(rect, point)) return { rect, drag: { kind: 'move', last: point } }
  }
  return { rect, drag: { kind: 'new', anchor: point, moved: false } }
}

export function moveSelection(
  model: SelectionModel,
  point: Point,
  scale: number,
  bounds: Size
): SelectionModel {
  const { drag } = model
  if (drag === null) return model
  if (drag.kind === 'move' && model.rect !== null) {
    const rect = moveRect(model.rect, point.x - drag.last.x, point.y - drag.last.y, bounds)
    return { rect, drag: { kind: 'move', last: point } }
  }
  if (drag.kind === 'move') return model
  const rect = rectFromAnchor(drag.anchor, point, bounds, minEdge(scale))
  return { rect, drag: drag.kind === 'new' ? { ...drag, moved: true } : drag }
}

export function releaseSelection(model: SelectionModel): SelectionModel {
  const { drag } = model
  if (drag?.kind === 'new' && !drag.moved) return EMPTY_SELECTION
  return { rect: model.rect, drag: null }
}
