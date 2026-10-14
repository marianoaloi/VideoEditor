import { describe, expect, it } from 'vitest'
import reducer, { fileOpened, panChanged, zoomChanged, zoomReset } from './playerSlice'

const start = reducer(undefined, { type: 'init' })

describe('player zoom', () => {
  it('clamps the zoom to 1..8 and the pan to the picture', () => {
    expect(reducer(start, zoomChanged(20)).zoom).toBe(8)
    expect(reducer(start, zoomChanged(0.3)).zoom).toBe(1)
    const zoomed = reducer(start, zoomChanged(2))
    const panned = reducer(zoomed, panChanged({ x: 9, y: -9 }))
    expect([panned.panX, panned.panY]).toEqual([0.5, -0.5])
    expect(reducer(start, panChanged({ x: 1, y: 1 })).panX).toBe(0)
  })
  it('rescales the pan with the zoom and drops it at 1', () => {
    let s = reducer(start, zoomChanged(2))
    s = reducer(s, panChanged({ x: 0.25, y: 0 }))
    s = reducer(s, zoomChanged(3))
    expect(s.panX).toBe(0.375)
    expect(reducer(s, zoomChanged(1)).panX).toBe(0)
  })
  it('survives a new file; zoomReset restores 100 %', () => {
    let s = reducer(start, zoomChanged(2))
    s = reducer(s, panChanged({ x: 0.2, y: 0.1 }))
    s = reducer(s, fileOpened({ path: '/b.mp4' }))
    expect([s.zoom, s.panX, s.panY]).toEqual([2, 0.2, 0.1])
    expect(reducer(s, zoomReset())).toMatchObject({ zoom: 1, panX: 0, panY: 0 })
  })
})
