import { describe, expect, it } from 'vitest'
import { fromPercent, toPercent, volumeDown, volumeMin, volumeUp } from './volume'

describe('TV-C volume (checklist 13)', () => {
  it('goes up from 0.1 as 0.1 .. 1, 1.1, 2.1 ... 9.1, 10.1, 20.1 ... 90.1, 100', () => {
    const seen: number[] = [0.1]
    for (let i = 0; i < 27; i += 1) seen.push(volumeUp(seen[seen.length - 1] ?? 0.1))
    expect(seen.slice(0, 10)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1])
    expect(seen.slice(10, 19)).toEqual([1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1, 9.1])
    expect(seen.slice(19, 28)).toEqual([10.1, 20.1, 30.1, 40.1, 50.1, 60.1, 70.1, 80.1, 90.1])
    expect(volumeUp(90.1)).toBe(100)
    expect(volumeUp(100)).toBe(100)
  })

  it('goes down from 100 as 100, 90 ... 10, 9 ... 1, 0.9 ... 0.1, 0.1 (never 0)', () => {
    const seen: number[] = [100]
    for (let i = 0; i < 28; i += 1) seen.push(volumeDown(seen[seen.length - 1] ?? 0.1))
    expect(seen.slice(0, 10)).toEqual([100, 90, 80, 70, 60, 50, 40, 30, 20, 10])
    expect(seen.slice(10, 19)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1])
    expect(seen.slice(19, 29)).toEqual([0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.1])
    expect(volumeDown(0.1)).toBe(0.1)
  })

  it('* sets the 0.1 floor and the 0..1 conversion round-trips', () => {
    expect(volumeMin()).toBe(0.1)
    expect(toPercent(0.5)).toBe(50)
    expect(fromPercent(50)).toBe(0.5)
    expect(toPercent(0)).toBe(0.1)
    expect(toPercent(5)).toBe(100)
  })
})
