import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  averageHash,
  bilinearStretch,
  blur2x2,
  computeKeys,
  frameIndexForMs,
  frameTimesMs,
  makeThumb,
  pyRound,
  seekSecondsForIndex,
  thresholdBinary,
  type RawImage
} from './hashPrimitives'

const md5 = (d: Uint8Array): string => createHash('md5').update(d).digest('hex')

function grey(width: number, height: number, fn: (x: number, y: number) => number): RawImage {
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = fn(x, y)
  return { width, height, channels: 1, data }
}

const uniform = (side: number, channels: 1 | 3, v: number): RawImage => ({
  width: side,
  height: side,
  channels,
  data: new Uint8Array(side * side * channels).fill(v)
})

describe('md5 binding', () => {
  it('md5("abc")', () => {
    expect(md5(new TextEncoder().encode('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72')
  })
})

describe('averageHash layout (section 12d, item 12)', () => {
  it('8x8 vectors', () => {
    expect(averageHash(grey(8, 8, (x) => (x >= 4 ? 255 : 0)), 8)).toBe('0f0f0f0f0f0f0f0f')
    expect(averageHash(grey(8, 8, (_x, y) => (y < 4 ? 255 : 0)), 8)).toBe('ffffffff00000000')
    expect(averageHash(grey(8, 8, (x, y) => (x === 0 && y === 0 ? 255 : 0)), 8)).toBe(
      '8000000000000000'
    )
    expect(averageHash(grey(8, 8, (x, y) => (x === 7 && y === 7 ? 255 : 0)), 8)).toBe(
      '0000000000000001'
    )
    expect(averageHash(grey(8, 8, () => 77), 8)).toBe('0000000000000000')
    expect(averageHash(grey(8, 8, (x, y) => 4 * (y * 8 + x)), 8)).toBe('00000000ffffffff')
  })

  it('16x16 uniform gives 64 zeros', () => {
    expect(averageHash(grey(16, 16, () => 9), 16)).toBe('0'.repeat(64))
  })

  it('Pillow Lanczos smoke vectors on 40x40', () => {
    expect(averageHash(grey(40, 40, () => 77), 8)).toBe('0000000000000000')
    const lr = grey(40, 40, (x) => (x >= 20 ? 255 : 0))
    expect(averageHash(lr, 8)).toBe('0f0f0f0f0f0f0f0f')
    expect(averageHash(lr, 16)).toBe('00ff'.repeat(16))
    const tb = grey(40, 40, (_x, y) => (y < 20 ? 255 : 0))
    expect(averageHash(tb, 8)).toBe('ffffffff00000000')
    expect(averageHash(tb, 16)).toBe('f'.repeat(32) + '0'.repeat(32))
  })

  it('3-channel luma weights land on the swapped channels (memory [255,0,0] -> 76)', () => {
    const px: RawImage = { width: 8, height: 8, channels: 3, data: new Uint8Array(8 * 8 * 3) }
    for (let i = 0; i < 64; i++) px.data[i * 3] = i < 32 ? 255 : 0
    expect(averageHash(px, 8)).toBe('ffffffff00000000')
  })
})

describe('blur2x2 (item 13)', () => {
  it('rounds half to even with zero padding on top/left', () => {
    const at11 = (a: number, b: number, c: number, d: number): number =>
      blur2x2({ width: 2, height: 2, channels: 1, data: Uint8Array.of(a, b, c, d) }).data[3] as number
    expect(at11(1, 1, 0, 0)).toBe(0)
    expect(at11(3, 3, 0, 0)).toBe(2)
    expect(at11(5, 5, 0, 0)).toBe(2)
    expect(at11(7, 7, 0, 0)).toBe(4)
    expect(at11(1, 0, 0, 0)).toBe(0)
    expect(at11(3, 0, 0, 0)).toBe(1)
  })

  it('40x40 uniform 200: corner 50, edge 100, interior 200', () => {
    const b = blur2x2(uniform(40, 1, 200)).data
    expect([b[0], b[1], b[40], b[41]]).toEqual([50, 100, 100, 200])
  })

  it('works per channel', () => {
    const b = blur2x2(uniform(4, 3, 200)).data
    expect([...b.subarray(0, 3)]).toEqual([50, 50, 50])
  })
})

describe('threshold is strict (item 15)', () => {
  const t = (v: number, lvl: number): number =>
    thresholdBinary({ width: 1, height: 1, channels: 1, data: Uint8Array.of(v) }, lvl)[0] as number
  it('136/137 and 115/116', () => {
    expect([t(136, 136), t(137, 136), t(115, 115), t(116, 115)]).toEqual([0, 255, 0, 255])
  })
})

describe('key cascade (item 14)', () => {
  it('2x2 grey 200', () => {
    const k = computeKeys(uniform(2, 1, 200), md5)
    expect(k.thumbLight).toBe('bbd822615535efc59c0719b820e06fd9')
    expect(k.thumbDark).toBe('f1d3ff8443297732862df21dc4e57262')
    expect(k.pureMD5).toBe('c60d0cd464b113cf520d9af6c9820c75')
    expect(computeKeys(uniform(2, 1, 200), md5, false).pureMD5).toBe(
      '3d3e7b0ba42dc167aa48082bfb8ff9b1'
    )
  })

  it('40x40 grey 200', () => {
    const k = computeKeys(uniform(40, 1, 200), md5)
    expect(k.pureMD5).toBe('bc469dcf126e12d9f3ddb1c73e1fa4b1')
    expect(k.thumbLight).toBe('81b09cf6e009af63e8ab09df530bb355')
    expect(k.thumbDark).toBe('7090e913448be18324ce57e9f8f566c0')
    expect(md5(uniform(40, 1, 200).data)).toBe('a23ca825140c3aa1dd9727b27af8370b')
    expect(computeKeys(uniform(40, 1, 200), md5, false).pureMD5).toBe(
      'a23ca825140c3aa1dd9727b27af8370b'
    )
  })

  it('40x40x3 BGR 200', () => {
    const k = computeKeys(uniform(40, 3, 200), md5)
    expect(k.pureMD5).toBe('76ac2569161d2356d7fba29bcc376bb3')
    expect(k.thumbLight).toBe('3cce4dcf210285edd6f77efebaa0c099')
    expect(k.thumbDark).toBe('f92e91a216c380a00b376e5a33417538')
  })

  it('hash widths: hash8 16 chars, hash16 64 chars', () => {
    const k = computeKeys(uniform(40, 3, 10), md5)
    expect([k.hash8.length, k.hash16.length]).toEqual([16, 64])
  })
})

describe('thumbnail (item 11)', () => {
  it('stretches to 64x64 and crops to 40x40, keeping a uniform colour', () => {
    const data = new Uint8Array(300 * 123 * 3).fill(90)
    const t = makeThumb({ width: 300, height: 123, channels: 3, data })
    expect([t.width, t.height, t.channels]).toEqual([40, 40, 3])
    expect(new Set(t.data)).toEqual(new Set([90]))
  })

  it('bilinear interpolates between source pixels', () => {
    const src = grey(2, 1, (x) => (x === 0 ? 0 : 200))
    expect([...bilinearStretch(src, 4, 1).data]).toEqual([0, 50, 150, 200])
  })

  it('a horizontal gradient stays monotone after the crop', () => {
    const t = makeThumb(grey(128, 128, (x) => x * 2))
    const row = [...t.data.subarray(0, 40)]
    expect([...row].sort((a, b) => a - b)).toEqual(row)
    expect(row[39]).toBeGreaterThan(row[0] as number)
  })
})

describe('frame sampling (item 16, section 12b)', () => {
  it('lists', () => {
    expect(frameTimesMs(60000)).toEqual([6000, 5825, 0, 1000, 2000, 3000, 4000])
    expect(frameTimesMs(4000)).toEqual([400, 388, 0, 1000, 2000, 3000])
    expect(frameTimesMs(10000)).toEqual([1000, 971, 0, 1000, 2000, 3000, 4000])
    expect(frameTimesMs(600000)).toEqual([
      60000, 58252, 58852, 59452, 60052, 60652, 61252, 61852, 0, 1000, 2000, 3000, 4000
    ])
    expect(frameTimesMs(500)).toEqual([50, 49, 0])
    expect(frameTimesMs(0)).toEqual([0])
  })

  it('python round is half-even', () => {
    expect([pyRound(0.5), pyRound(1.5), pyRound(2.5), pyRound(2.4), pyRound(2.6)]).toEqual([
      0, 2, 2, 2, 3
    ])
  })

  it('frame index and seek time', () => {
    expect(frameIndexForMs(1000, 25)).toBe(25)
    expect(frameIndexForMs(4, 25)).toBe(0)
    expect(seekSecondsForIndex(25, 25)).toBeCloseTo(0.99)
    expect(seekSecondsForIndex(0, 25)).toBe(0)
  })
})
