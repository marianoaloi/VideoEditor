import { describe, expect, it } from 'vitest'
import {
  clampPan,
  clampZoom,
  formatZoom,
  panForZoomAbout,
  sliderFromZoom,
  wheelZoom,
  zoomFromSlider,
  zoomToFit
} from './zoomMath'

describe('zoom (cutter TV-10, checklist 44)', () => {
  it('wheel steps x1.1 up and x0.9 down, which are not inverses', () => {
    const up1 = wheelZoom(1, -120)
    const up2 = wheelZoom(up1, -120)
    const down = wheelZoom(up2, 120)
    expect(formatZoom(down)).toBe('+1.09 x')
    expect(sliderFromZoom(down)).toBe(108)
    expect(wheelZoom(wheelZoom(1, -1), 1)).toBeCloseTo(0.99, 10)
    expect(wheelZoom(2, 0)).toBe(2)
  })

  it('slider maps value/100 and clamps to 5..3000', () => {
    expect(zoomFromSlider(250)).toBe(2.5)
    expect(zoomFromSlider(-100)).toBe(0.05)
    expect(zoomFromSlider(99999)).toBe(30)
    expect(sliderFromZoom(0.001)).toBe(5)
    expect(sliderFromZoom(1000)).toBe(3000)
  })

  it('clamps and handles bad input', () => {
    expect(clampZoom(0)).toBe(0.05)
    expect(clampZoom(100)).toBe(30)
    expect(clampZoom(Number.NaN)).toBe(1)
  })

  it('fits and pans', () => {
    expect(zoomToFit({ width: 1000, height: 500 }, { width: 500, height: 500 })).toBe(0.5)
    const image = { width: 1000, height: 1000 }
    const view = { width: 400, height: 400 }
    expect(clampPan({ x: 50, y: 50 }, image, 1, view)).toEqual({ x: 0, y: 0 })
    expect(clampPan({ x: -5000, y: -5000 }, image, 1, view)).toEqual({ x: -600, y: -600 })
    expect(clampPan({ x: 0, y: 0 }, image, 0.2, view)).toEqual({ x: 100, y: 100 })
  })

  it('zooming about the cursor keeps the point under it', () => {
    const pan = panForZoomAbout({ x: 0, y: 0 }, { x: 100, y: 50 }, 1, 2)
    expect(pan).toEqual({ x: -100, y: -50 })
  })
})
