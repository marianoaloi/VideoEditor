import { describe, expect, it } from 'vitest'
import {
  MAX_ZOOM,
  clampPan,
  clampZoom,
  dragPan,
  formatZoom,
  maxPan,
  rescalePan,
  zoomIn,
  zoomOut,
  zoomTransform
} from './videoZoom'

describe('zoom steps', () => {
  it('steps x1.25 up and down', () => {
    expect(zoomIn(1)).toBe(1.25)
    expect(zoomIn(1.25)).toBe(1.5625)
    expect(zoomOut(1.5625)).toBe(1.25)
    expect(zoomOut(1.25)).toBe(1)
  })
  it('stays within 1..8', () => {
    expect(zoomOut(1)).toBe(1)
    expect(zoomIn(MAX_ZOOM)).toBe(MAX_ZOOM)
    expect(zoomIn(7)).toBe(8)
    expect(clampZoom(Number.NaN)).toBe(1)
    expect(clampZoom(20)).toBe(8)
    expect(clampZoom(0.2)).toBe(1)
  })
  it('reaches 8 and comes back to exactly 1 after the same number of steps', () => {
    let z = 1
    let steps = 0
    while (z < MAX_ZOOM) {
      z = zoomIn(z)
      steps += 1
    }
    for (let i = 0; i < steps; i += 1) z = zoomOut(z)
    expect(z).toBe(1)
  })
  it('formats the badge', () => {
    expect(formatZoom(2.5)).toBe('250 %')
    expect(formatZoom(1.25)).toBe('125 %')
  })
})

describe('pan', () => {
  it('has no room at zoom 1 and (z-1)/2 otherwise', () => {
    expect(maxPan(1)).toBe(0)
    expect(maxPan(3)).toBe(1)
    expect(clampPan({ x: 5, y: -5 }, 1)).toEqual({ x: 0, y: 0 })
    expect(clampPan({ x: 5, y: -5 }, 2)).toEqual({ x: 0.5, y: -0.5 })
  })
  it('keeps the same centre when the zoom changes, then clamps', () => {
    expect(rescalePan({ x: 0.25, y: -0.25 }, 2, 3)).toEqual({ x: 0.375, y: -0.375 })
    expect(rescalePan({ x: 0.5, y: 0.5 }, 2, 1)).toEqual({ x: 0, y: 0 })
    expect(rescalePan({ x: 0.5, y: 0 }, 2, 1.25)).toEqual({ x: 0.125, y: 0 })
  })
  it('converts a pixel drag into box fractions and clamps', () => {
    const box = { width: 400, height: 200 }
    expect(dragPan({ x: 0, y: 0 }, 2, { dxPx: 100, dyPx: -50 }, box)).toEqual({ x: 0.25, y: -0.25 })
    expect(dragPan({ x: 0, y: 0 }, 2, { dxPx: 900, dyPx: 0 }, box)).toEqual({ x: 0.5, y: 0 })
    expect(dragPan({ x: 0.1, y: 0 }, 2, { dxPx: 5, dyPx: 5 }, { width: 0, height: 0 })).toEqual({
      x: 0.1,
      y: 0
    })
  })
  it('builds the transform in percent of the box', () => {
    expect(zoomTransform(2, { x: 0.25, y: 0 })).toBe('translate(25%, 0%) scale(2)')
    expect(zoomTransform(1, { x: 0.4, y: 0.4 })).toBe('translate(0%, 0%) scale(1)')
  })
})
