import { describe, expect, it } from 'vitest'
import { detectBars, type PixelBuffer } from './stripBars'

/** Builds an RGB frame filled with `bg`, then paints rectangles. */
function frame(
  width: number,
  height: number,
  paint: (set: (x: number, y: number, v: number) => void) => void
): PixelBuffer {
  const data = new Uint8Array(width * height * 3)
  paint((x, y, v) => {
    const i = (y * width + x) * 3
    data[i] = v
    data[i + 1] = v
    data[i + 2] = v
  })
  return { data, width, height, channels: 3 }
}

function fillRect(
  set: (x: number, y: number, v: number) => void,
  x0: number,
  y0: number,
  w: number,
  h: number,
  v: number
): void {
  for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) set(x, y, v)
}

describe('detectBars (cutter-crop-zoom §3.5 vectors, INTENT column)', () => {
  it('A: bars 140 px top and bottom', () => {
    const f = frame(1920, 1080, (s) => fillRect(s, 0, 140, 1920, 800, 128))
    expect(detectBars(f)).toEqual({ x: 0, y: 140, w: 1920, h: 800 })
  })

  it('B: bars 240 px left and right', () => {
    const f = frame(1920, 1080, (s) => fillRect(s, 240, 0, 1440, 1080, 128))
    expect(detectBars(f)).toEqual({ x: 240, y: 0, w: 1440, h: 1080 })
  })

  it('C: bars on all four sides', () => {
    const f = frame(1920, 1080, (s) => fillRect(s, 240, 140, 1440, 800, 128))
    expect(detectBars(f)).toEqual({ x: 240, y: 140, w: 1440, h: 800 })
  })

  it('D: no bars', () => {
    const f = frame(1920, 1080, (s) => fillRect(s, 0, 0, 1920, 1080, 90))
    expect(detectBars(f)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
  })

  it('E: a black band inside the picture does not shrink the rectangle', () => {
    const f = frame(1920, 1080, (s) => {
      fillRect(s, 0, 140, 1920, 800, 128)
      fillRect(s, 0, 500, 1920, 21, 0)
    })
    expect(detectBars(f)).toEqual({ x: 0, y: 140, w: 1920, h: 800 })
  })

  it('F: a stray low sample in a bar is ignored', () => {
    const f = frame(1920, 1080, (s) => {
      fillRect(s, 0, 140, 1920, 800, 128)
      for (let y = 0; y < 140; y += 1) s(960, y, 3)
    })
    expect(detectBars(f)).toEqual({ x: 0, y: 140, w: 1920, h: 800 })
  })

  it('G: bars of value 1 count as content (known limit)', () => {
    const f = frame(1920, 1080, (s) => {
      fillRect(s, 0, 0, 1920, 1080, 1)
      fillRect(s, 0, 140, 1920, 800, 128)
    })
    expect(detectBars(f)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
  })

  it('H: 640x360 with 217 and 219 px bars gives 204 wide', () => {
    const f = frame(640, 360, (s) => fillRect(s, 217, 0, 204, 360, 128))
    expect(detectBars(f)).toEqual({ x: 217, y: 0, w: 204, h: 360 })
  })

  it('I: an all-black frame has no picture area', () => {
    expect(detectBars(frame(640, 360, () => undefined))).toBeNull()
  })

  it('handles RGBA buffers and tiny frames', () => {
    const data = new Uint8Array(4 * 4 * 4).fill(255)
    expect(detectBars({ data, width: 4, height: 4, channels: 4 })).toEqual({
      x: 0,
      y: 0,
      w: 4,
      h: 4
    })
  })

  it('rejects inconsistent buffers', () => {
    expect(detectBars({ data: new Uint8Array(3), width: 10, height: 10, channels: 3 })).toBeNull()
  })
})
