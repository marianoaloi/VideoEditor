import { describe, expect, it } from 'vitest'
import {
  EMPTY_SELECTION,
  moveSelection,
  pressSelection,
  releaseSelection,
  type SelectionModel
} from './selection'

const bounds = { width: 640, height: 360 }

function drag(model: SelectionModel, from: [number, number], to: [number, number], scale = 1): SelectionModel {
  const pressed = pressSelection(model, { x: from[0], y: from[1] }, scale)
  const moved = moveSelection(pressed, { x: to[0], y: to[1] }, scale, bounds)
  return releaseSelection(moved)
}

describe('rubber band (cutter checklist 33)', () => {
  it('draws on empty space, clamped to the picture', () => {
    const m = drag(EMPTY_SELECTION, [100, 100], [900, 900])
    expect(m.rect).toEqual({ x: 100, y: 100, w: 540, h: 260 })
    expect(m.drag).toBeNull()
  })

  it('enforces the 30 view-px minimum (in image px at scale 0.5 that is 60)', () => {
    const m = drag(EMPTY_SELECTION, [100, 100], [101, 101], 0.5)
    expect(m.rect).toMatchObject({ w: 60, h: 60 })
  })

  it('grabs each corner within 20 view px and keeps the opposite one fixed', () => {
    const base = drag(EMPTY_SELECTION, [100, 100], [300, 200])
    const tl = drag(base, [110, 105], [50, 40])
    expect(tl.rect).toEqual({ x: 50, y: 40, w: 250, h: 160 })
    const br = drag(base, [295, 205], [400, 250])
    expect(br.rect).toEqual({ x: 100, y: 100, w: 300, h: 150 })
    const bl = drag(base, [100, 200], [120, 260])
    expect(bl.rect).toEqual({ x: 120, y: 100, w: 180, h: 160 })
    const tr = drag(base, [300, 100], [350, 80])
    expect(tr.rect).toEqual({ x: 100, y: 80, w: 250, h: 120 })
  })

  it('the grab radius scales with the view', () => {
    const base = drag(EMPTY_SELECTION, [100, 100], [300, 200])
    // 30 image px away is 15 view px at 0.5: still a corner grab (resize), not a move
    const grabbed = drag(base, [100 + 15, 100 + 15], [100, 100], 0.5)
    expect(grabbed.rect).toEqual({ x: 100, y: 100, w: 200, h: 100 })
  })

  it('moves the band when dragging inside it', () => {
    const base = drag(EMPTY_SELECTION, [100, 100], [300, 200])
    const moved = drag(base, [200, 150], [240, 170])
    expect(moved.rect).toEqual({ x: 140, y: 120, w: 200, h: 100 })
  })

  it('a click outside without a drag hides it; a click-drag outside redraws', () => {
    const base = drag(EMPTY_SELECTION, [100, 100], [300, 200])
    expect(pressSelection(base, { x: 500, y: 300 }, 1).drag?.kind).toBe('new')
    expect(releaseSelection(pressSelection(base, { x: 500, y: 300 }, 1)).rect).toBeNull()
    expect(drag(base, [400, 250], [500, 300]).rect).toEqual({ x: 400, y: 250, w: 100, h: 50 })
  })

  it('dragging past the opposite corner flips the band', () => {
    const base = drag(EMPTY_SELECTION, [100, 100], [300, 200])
    const flipped = drag(base, [300, 200], [40, 20])
    expect(flipped.rect).toEqual({ x: 40, y: 20, w: 60, h: 80 })
  })
})
