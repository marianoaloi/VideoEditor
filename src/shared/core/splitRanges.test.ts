import { describe, expect, it } from 'vitest'
import { parsePartsText, splitRanges } from './splitRanges'

function ranges(start: number, end: number, n: number) {
  const result = splitRanges(start, end, n)
  if (!result.ok) throw new Error(result.message)
  return result.ranges
}

describe('splitRanges (TV-1)', () => {
  it('splits 0..95000 into 4', () => {
    expect(ranges(0, 95000, 4)).toEqual([
      [0, 23750],
      [23750, 47500],
      [47500, 71250],
      [71250, 95000]
    ])
  })

  it('gives the remainder to the last range', () => {
    expect(ranges(0, 95003, 4)[3]).toEqual([71250, 95003])
  })

  it('splits from a non-zero start', () => {
    expect(ranges(10000, 100000, 3)).toEqual([
      [10000, 40000],
      [40000, 70000],
      [70000, 100000]
    ])
    expect(ranges(5000, 95000, 2)).toEqual([
      [5000, 50000],
      [50000, 95000]
    ])
  })

  it('uses step 14285 for 7 parts of 100000', () => {
    const r = ranges(0, 100000, 7)
    expect(r).toHaveLength(7)
    expect(r[5]).toEqual([71425, 85710])
    expect(r[6]).toEqual([85710, 100000])
  })

  it('one part is the whole span', () => {
    expect(ranges(0, 95000, 1)).toEqual([[0, 95000]])
  })

  it('makes exactly N ranges even when the span is under N*N (legacy made 5)', () => {
    expect(ranges(0, 11, 4)).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
      [6, 11]
    ])
  })

  it('refuses a zero step instead of throwing', () => {
    expect(splitRanges(0, 3, 4)).toMatchObject({ ok: false, reason: 'too-many-parts' })
  })

  it('refuses N < 1, fractional N and empty spans', () => {
    expect(splitRanges(0, 1000, 0)).toMatchObject({ ok: false, reason: 'invalid-parts' })
    expect(splitRanges(0, 1000, 1.5)).toMatchObject({ ok: false, reason: 'invalid-parts' })
    expect(splitRanges(500, 500, 2)).toMatchObject({ ok: false, reason: 'invalid-span' })
  })

  it('covers the span without gaps or overlaps', () => {
    const r = ranges(1234, 987654, 9)
    expect(r[0]?.[0]).toBe(1234)
    expect(r.at(-1)?.[1]).toBe(987654)
    for (let i = 1; i < r.length; i += 1) expect(r[i]?.[0]).toBe(r[i - 1]?.[1])
  })
})

describe('parsePartsText (TV-2.7)', () => {
  it('reads the first run of digits', () => {
    expect(parsePartsText('4')).toBe(4)
    expect(parsePartsText('4x')).toBe(4)
    expect(parsePartsText('x12y3')).toBe(12)
  })
  it('ignores text without digits', () => {
    expect(parsePartsText('x')).toBeNull()
    expect(parsePartsText('')).toBeNull()
  })
})
