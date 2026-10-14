import { describe, expect, it } from 'vitest'
import { moveHandle, normaliseSelection, percentOf, pointerToMs } from './rangeSliderMath'

describe('moveHandle (research §5: handles never cross, gap 1 ms)', () => {
  const current = { lowMs: 1000, highMs: 5000 }
  it('moves the low handle freely below high', () => {
    expect(moveHandle(current, 0, 2000, 10000)).toEqual({ lowMs: 2000, highMs: 5000 })
  })
  it('stops the low handle one ms before high', () => {
    expect(moveHandle(current, 0, 9000, 10000)).toEqual({ lowMs: 4999, highMs: 5000 })
  })
  it('stops the high handle one ms after low', () => {
    expect(moveHandle(current, 1, 10, 10000)).toEqual({ lowMs: 1000, highMs: 1001 })
  })
  it('clamps to the video', () => {
    expect(moveHandle(current, 0, -50, 10000).lowMs).toBe(0)
    expect(moveHandle(current, 1, 99999, 10000).highMs).toBe(10000)
  })
  it('rounds to whole milliseconds', () => {
    expect(moveHandle(current, 0, 1500.6, 10000).lowMs).toBe(1501)
  })
})

describe('helpers', () => {
  it('normaliseSelection orders and clamps', () => {
    expect(normaliseSelection(8000, 2000, 10000)).toEqual({ lowMs: 2000, highMs: 8000 })
    expect(normaliseSelection(-5, 99999, 10000)).toEqual({ lowMs: 0, highMs: 10000 })
  })
  it('pointerToMs uses trunc(x / width * duration) (TV-3 scrub)', () => {
    const box = { left: 100, width: 800 }
    expect(pointerToMs(500, box, 95000)).toBe(47500)
    expect(pointerToMs(100, box, 95000)).toBe(0)
    expect(pointerToMs(900, box, 95000)).toBe(95000)
    expect(pointerToMs(2000, box, 95000)).toBe(95000)
    expect(pointerToMs(10, { left: 0, width: 0 }, 1000)).toBe(0)
  })
  it('percentOf', () => {
    expect(percentOf(2500, 10000)).toBe(25)
    expect(percentOf(1, 0)).toBe(0)
  })
})
