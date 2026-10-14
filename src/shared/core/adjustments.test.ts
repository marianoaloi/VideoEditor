import { describe, expect, it } from 'vitest'
import { isNeutralCropResult } from '../domain/geometry'
import {
  adjustChannel,
  applyAdjustmentsToRgba,
  buildCropResult,
  isNeutralSliders,
  slidersFromResult,
  snapToQuarterTurns
} from './adjustments'

const rect = { x: 1, y: 2, w: 3, h: 4 }

describe('buildCropResult (cutter TV-5)', () => {
  it('neutral sliders give nulls', () => {
    const r = buildCropResult(null, { brightness: 0, contrast: 100, rotation: 0 })
    expect(r).toEqual({ crop: null, bright: null, contrast: null, transpose: null })
    expect(isNeutralCropResult(r)).toBe(true)
  })

  it('maps the scales: bright/255, contrast/100, transpose = -slider', () => {
    expect(buildCropResult(null, { brightness: 51, contrast: 100, rotation: 0 }).bright).toBe(0.2)
    expect(buildCropResult(null, { brightness: -255, contrast: 100, rotation: 0 }).bright).toBe(-1)
    expect(buildCropResult(null, { brightness: 0, contrast: 150, rotation: 0 }).contrast).toBe(1.5)
    expect(buildCropResult(null, { brightness: 0, contrast: -400, rotation: 0 }).contrast).toBe(-4)
    expect(buildCropResult(null, { brightness: 0, contrast: 100, rotation: 90 }).transpose).toBe(-90)
    expect(buildCropResult(null, { brightness: 0, contrast: 100, rotation: -180 }).transpose).toBe(180)
    expect(buildCropResult(null, { brightness: 0, contrast: 100, rotation: 45 }).transpose).toBe(-45)
  })

  it('keeps the crop untouched and clamps wild slider input', () => {
    const r = buildCropResult(rect, { brightness: 9999, contrast: 100, rotation: 0 })
    expect(r.crop).toEqual(rect)
    expect(r.bright).toBe(1)
  })
})

describe('slidersFromResult', () => {
  it('inverts the scales (legacy CR:54, 69, 84)', () => {
    expect(slidersFromResult({ bright: 0.2, contrast: 1.5, transpose: -90 })).toEqual({
      brightness: 51,
      contrast: 150,
      rotation: 90
    })
    expect(isNeutralSliders(slidersFromResult(undefined))).toBe(true)
    expect(isNeutralSliders(slidersFromResult({ bright: null, contrast: null, transpose: null }))).toBe(true)
  })
})

describe('colour model', () => {
  it('is the identity when neutral and pivots contrast on mid grey', () => {
    expect(adjustChannel(77, 0, 1)).toBe(77)
    expect(adjustChannel(128, 0, 2)).toBe(128)
    expect(adjustChannel(192, 0, 0.5)).toBe(160)
    expect(adjustChannel(0, 0, -1)).toBe(255)
  })

  it('tracks the measured eq values within ~7 levels', () => {
    // eq=contrast=2 -> 0 0 125 253 255 for 0 64 128 192 255
    const measured: Array<[number, number]> = [
      [0, 0],
      [64, 0],
      [128, 125],
      [192, 253],
      [255, 255]
    ]
    for (const [input, expected] of measured) {
      expect(Math.abs(adjustChannel(input, 0, 2) - expected)).toBeLessThanOrEqual(7)
    }
    // eq=brightness=0.2 -> 58 for 0
    expect(Math.abs(adjustChannel(0, 0.2, 1) - 58)).toBeLessThanOrEqual(7)
  })

  it('applies to RGBA data without touching alpha', () => {
    const data = new Uint8ClampedArray([10, 128, 250, 99])
    applyAdjustmentsToRgba(data, 0, 2)
    expect(Array.from(data)).toEqual([0, 128, 255, 99])
  })

  it('snaps video rotations to quarter turns', () => {
    expect(snapToQuarterTurns(44)).toBe(0)
    expect(snapToQuarterTurns(46)).toBe(90)
    expect(snapToQuarterTurns(-170)).toBe(-180)
  })
})
