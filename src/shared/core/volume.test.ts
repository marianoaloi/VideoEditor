import { describe, expect, it } from 'vitest'
import { fromPercent, toPercent, volumeDown, volumeMin, volumeUp } from './volume'

describe('TV-C volume (checklist 13)', () => {
  it('goes up from 1 as 1..11, 21 ... 91, 100', () => {
    const seen: number[] = [1]
    for (let i = 0; i < 25; i += 1) seen.push(volumeUp(seen[seen.length - 1] ?? 1))
    expect(seen.slice(0, 11)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(seen.slice(11, 20)).toEqual([21, 31, 41, 51, 61, 71, 81, 91, 100])
    expect(volumeUp(100)).toBe(100)
  })

  it('goes down from 100 as 100, 90 ... 10, 9 ... 1, 1 (never 0)', () => {
    const seen: number[] = [100]
    for (let i = 0; i < 19; i += 1) seen.push(volumeDown(seen[seen.length - 1] ?? 1))
    expect(seen).toEqual([100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1])
    expect(volumeDown(1)).toBe(1)
  })

  it('* sets 1 and the 0..1 conversion round-trips', () => {
    expect(volumeMin()).toBe(1)
    expect(toPercent(0.5)).toBe(50)
    expect(fromPercent(50)).toBe(0.5)
    expect(toPercent(0)).toBe(1)
    expect(toPercent(5)).toBe(100)
  })
})
