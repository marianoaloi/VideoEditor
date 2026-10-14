import { describe, expect, it } from 'vitest'
import {
  cropLabel,
  displayedSize,
  displayedToSource,
  fitRectToImage,
  fitScale,
  hitCorner,
  horizontalDefaultRect,
  moveRect,
  rectFromAnchor,
  sourceToDisplayed,
  verticalDefaultRect,
  viewToImageRect
} from './cropMath'

const SRC = { width: 1920, height: 1080 }

describe('viewToImageRect (cutter TV-6, checklist 36)', () => {
  it('truncates each value on its own with one uniform scale', () => {
    const view = { x: 123, y: 45, w: 300, h: 150 }
    expect(viewToImageRect(view, 0.5, SRC)).toEqual({ x: 246, y: 90, w: 600, h: 300 })
  })

  it('clamps a selection that leaves the frame', () => {
    const view = { x: 900, y: 500, w: 100, h: 100 }
    expect(viewToImageRect(view, 0.5, SRC)).toEqual({ x: 1800, y: 1000, w: 120, h: 80 })
  })

  it('image TV-27 style: independent truncation', () => {
    // legacy stretched example used 640x480 label; with a uniform 0.64 scale on 1000x750
    expect(viewToImageRect({ x: 33, y: 17, w: 101, h: 77 }, 0.64, { width: 1000, height: 750 })).toEqual({
      x: 51,
      y: 26,
      w: 157,
      h: 120
    })
  })
})

describe('rotation mapping (cutter TV-6 table)', () => {
  const cases: Array<[number, [number, number, number, number], [number, number, number, number]]> = [
    [90, [0, 0, 1080, 960], [0, 0, 960, 1080]],
    [90, [200, 100, 300, 400], [100, 580, 400, 300]],
    [180, [100, 50, 300, 200], [1520, 830, 300, 200]],
    [-90, [0, 0, 1080, 960], [960, 0, 960, 1080]],
    [-90, [200, 100, 300, 400], [1420, 200, 400, 300]]
  ]
  it.each(cases)('T=%i maps %j to %j and back', (rotation, d, s) => {
    const displayed = { x: d[0], y: d[1], w: d[2], h: d[3] }
    const source = { x: s[0], y: s[1], w: s[2], h: s[3] }
    expect(displayedToSource(displayed, SRC, rotation)).toEqual(source)
    expect(sourceToDisplayed(source, SRC, rotation)).toEqual(displayed)
  })

  it('leaves free angles alone and swaps the canvas only for quarter turns', () => {
    const r = { x: 1, y: 2, w: 3, h: 4 }
    expect(displayedToSource(r, SRC, 45)).toEqual(r)
    expect(displayedSize(SRC, 45)).toEqual(SRC)
    expect(displayedSize(SRC, 90)).toEqual({ width: 1080, height: 1920 })
    expect(displayedSize(SRC, -90)).toEqual({ width: 1080, height: 1920 })
    expect(displayedSize(SRC, 180)).toEqual(SRC)
  })

  it('round-trips random rectangles', () => {
    for (const t of [0, 90, 180, -90]) {
      const d = { x: 17, y: 33, w: 101, h: 77 }
      expect(sourceToDisplayed(displayedToSource(d, SRC, t), SRC, t)).toEqual(d)
    }
  })
})

describe('fitRectToImage (checklist 40, DP-24)', () => {
  it('clips to a smaller image and refuses an empty intersection', () => {
    expect(fitRectToImage({ x: 20, y: 10, w: 300, h: 200 }, { width: 200, height: 100 })).toEqual({
      x: 20,
      y: 10,
      w: 180,
      h: 90
    })
    expect(fitRectToImage({ x: 20, y: 10, w: 300, h: 200 }, { width: 20, height: 100 })).toBeNull()
  })
})

describe('selection geometry', () => {
  const bounds = { width: 400, height: 300 }

  it('grabs the nearest corner within 20 px Manhattan and none beyond', () => {
    const rect = { x: 100, y: 100, w: 100, h: 50 }
    expect(hitCorner(rect, { x: 105, y: 108 })).toBe('tl')
    expect(hitCorner(rect, { x: 195, y: 145 })).toBe('br')
    expect(hitCorner(rect, { x: 150, y: 125 })).toBeNull()
    expect(hitCorner(rect, { x: 100 + 10, y: 100 + 10 })).toBeNull()
  })

  it('drags from an anchor, flips over it, clamps and keeps the minimum', () => {
    expect(rectFromAnchor({ x: 100, y: 100 }, { x: 50, y: 40 }, bounds, 30)).toEqual({
      x: 50,
      y: 40,
      w: 50,
      h: 60
    })
    expect(rectFromAnchor({ x: 100, y: 100 }, { x: 900, y: 900 }, bounds, 30)).toEqual({
      x: 100,
      y: 100,
      w: 300,
      h: 200
    })
    const small = rectFromAnchor({ x: 100, y: 100 }, { x: 105, y: 102 }, bounds, 30)
    expect(small).toEqual({ x: 100, y: 100, w: 30, h: 30 })
    const edge = rectFromAnchor({ x: 395, y: 295 }, { x: 399, y: 299 }, bounds, 30)
    expect(edge.x + edge.w).toBeLessThanOrEqual(400)
    expect(edge.y + edge.h).toBeLessThanOrEqual(300)
    expect(edge.w).toBe(30)
  })

  it('moves a rectangle inside the bounds', () => {
    expect(moveRect({ x: 10, y: 10, w: 100, h: 100 }, -50, 500, bounds)).toEqual({
      x: 0,
      y: 200,
      w: 100,
      h: 100
    })
  })
})

describe('defaults and labels', () => {
  it('Vertical Default keeps x and width, full height (cutter 3.6)', () => {
    expect(verticalDefaultRect({ width: 640, height: 360 }, { x: 10, y: 20, w: 50, h: 60 })).toEqual({
      x: 10,
      y: 0,
      w: 50,
      h: 360
    })
  })

  it('without a selection the centred band is 218,0,204,360 on 640x360', () => {
    expect(verticalDefaultRect({ width: 640, height: 360 }, null)).toEqual({ x: 218, y: 0, w: 204, h: 360 })
    expect(horizontalDefaultRect({ width: 360, height: 640 }, null)).toEqual({ x: 0, y: 218, w: 360, h: 204 })
  })

  it('Horizontal Default keeps y and height, full width', () => {
    expect(horizontalDefaultRect({ width: 640, height: 360 }, { x: 10, y: 20, w: 50, h: 60 })).toEqual({
      x: 0,
      y: 20,
      w: 640,
      h: 60
    })
  })

  it('quick-cut label is y1,y2,x1,x2 (image TV-26/27/28)', () => {
    expect(cropLabel({ x: 200, y: 150, w: 400, h: 300 })).toBe('150,450,200,600')
    expect(cropLabel({ x: 51, y: 26, w: 157, h: 120 })).toBe('26,146,51,208')
    expect(cropLabel({ x: 20, y: 10, w: 300, h: 200 })).toBe('10,210,20,320')
  })

  it('fitScale keeps the aspect ratio', () => {
    expect(fitScale({ width: 1600, height: 1200 }, { width: 800, height: 400 })).toBeCloseTo(1 / 3, 6)
    expect(fitScale({ width: 0, height: 10 }, { width: 800, height: 400 })).toBe(1)
  })
})
