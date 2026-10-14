import { describe, expect, it } from 'vitest'
import type { Range } from '../domain/job'
import {
  applyPlayhead,
  clickRangeLabel,
  dragBoth,
  dragHandle,
  initialHandles,
  jumpToEnd,
  jumpToStart,
  loadRangeIntoHandles,
  parseAvgrateOverride,
  parseCropOverride,
  parseRateOverride,
  parseSizeOverride,
  rangeFromHandles,
  resolveJobTimes,
  selectionMs,
  swapActive,
  wholeVideoTimes,
  type Handles
} from './jobDraft'
import { splitRanges } from './splitRanges'

const MAX = 59_900

describe('TV-G handle sync (checklist 9, 18, 19, 22)', () => {
  it('G1 load, tick, Z, seek, C with no ranges', () => {
    let h = initialHandles(MAX)
    expect(h).toEqual({ low: 0, high: MAX, active: 0 })
    h = applyPlayhead(h, 5000)
    expect(h.low).toBe(5000)
    const swapped = swapActive(h)
    expect(swapped.handles.active).toBe(1)
    expect(swapped.seekMs).toBe(MAX)
    h = applyPlayhead(swapped.handles, MAX)
    expect(h.high).toBe(MAX)
    h = applyPlayhead(h, 30_000)
    expect(h).toEqual({ low: 5000, high: 30_000, active: 1 })
    expect(resolveJobTimes([], h, false)).toEqual({ ok: true, times: [[5000, 30_000]] })
  })

  it('G2 Ctrl+End then Ctrl+Home', () => {
    const start: Handles = { low: 5000, high: 12_000, active: 0 }
    const end = jumpToEnd(start, MAX)
    expect(end.handles).toEqual({ low: 5000, high: MAX, active: 1 })
    expect(end.seekMs).toBe(MAX)
    const home = jumpToStart(end.handles)
    expect(home.handles).toEqual({ low: 0, high: MAX, active: 0 })
    expect(home.seekMs).toBe(0)
  })

  it('G3 Z twice returns to low; groove click makes the next tick set low', () => {
    const h: Handles = { low: 7000, high: 9000, active: 0 }
    const once = swapActive(h)
    const twice = swapActive(once.handles)
    expect(twice.handles.active).toBe(0)
    expect(twice.seekMs).toBe(7000)
    expect(swapActive({ ...h, active: -1 }).handles.active).toBe(0)
    expect(applyPlayhead({ ...h, active: -1 }, 100).low).toBe(100)
  })

  it('G5 clicking a begin label while high is active makes low active (legacy collapsed high)', () => {
    const move = clickRangeLabel({ low: 0, high: 40_000, active: 1 }, 'start', 1000)
    expect(move.handles).toEqual({ low: 1000, high: 40_000, active: 0 })
    expect(move.seekMs).toBe(1000)
    const end = clickRangeLabel({ low: 0, high: 40_000, active: 0 }, 'end', 2000)
    expect(end.handles).toEqual({ low: 0, high: 2000, active: 1 })
  })

  it('G6 dragging high below low forces high = low + 1', () => {
    const move = dragHandle({ low: 3500, high: 10_000, active: 0 }, 1, 3000, MAX)
    expect(move.handles.high).toBe(3501)
    expect(dragHandle({ low: 0, high: 100, active: 1 }, 0, 500, MAX).handles.low).toBe(99)
    expect(dragHandle({ low: 0, high: 100, active: 1 }, 1, 999_999, MAX).handles.high).toBe(MAX)
  })

  it('R7 groove drag shifts both handles within [0, max]', () => {
    const h: Handles = { low: 1000, high: 3000, active: 0 }
    expect(dragBoth(h, 500, MAX).handles).toEqual({ low: 1500, high: 3500, active: -1 })
    expect(dragBoth(h, -5000, MAX).handles).toEqual({ low: 0, high: 2000, active: -1 })
    expect(dragBoth(h, 999_999, MAX).handles.high).toBe(MAX)
  })

  it('R9 removing a range loads it into the handles with low active', () => {
    const move = loadRangeIntoHandles([1000, 2000])
    expect(move.handles).toEqual({ low: 1000, high: 2000, active: 0 })
    expect(move.seekMs).toBe(1000)
  })

  it('R10/F6 X uses (min, max) and refuses an empty span (checklist 20)', () => {
    expect(rangeFromHandles({ low: 40_000, high: 10_000, active: 0 })).toEqual([10_000, 40_000])
    expect(rangeFromHandles({ low: 5, high: 5, active: 0 })).toBeNull()
    expect(selectionMs({ low: 40_000, high: 10_000, active: 0 })).toBe(30_000)
  })
})

describe('TV-F job times (checklist 40, 41)', () => {
  const ranges: Range[] = [
    [20_000, 30_000],
    [0, 5000]
  ]
  const handles = { low: 18_054, high: 46_182 }

  it('F1 no ranges: the raw handle span, normalised', () => {
    expect(resolveJobTimes([], handles, false)).toEqual({ ok: true, times: [[18_054, 46_182]] })
    expect(resolveJobTimes([], { low: 46_182, high: 18_054 }, false)).toEqual({
      ok: true,
      times: [[18_054, 46_182]]
    })
  })

  it('F2 cut keeps insertion order, concat sorts, handles are ignored', () => {
    expect(resolveJobTimes(ranges, handles, false)).toEqual({ ok: true, times: ranges })
    expect(resolveJobTimes(ranges, handles, true)).toEqual({
      ok: true,
      times: [
        [0, 5000],
        [20_000, 30_000]
      ]
    })
    expect(ranges[0]).toEqual([20_000, 30_000])
  })

  it('refuses an empty span', () => {
    expect(resolveJobTimes([], { low: 5, high: 5 }, false).ok).toBe(false)
  })

  it('F3 whole video uses the runner sentinel', () => {
    expect(wholeVideoTimes(60_000)).toEqual([[-1, 60_000]])
  })
})

describe('TV-D split with the shared splitRanges (checklist 21)', () => {
  const split = (lo: number, hi: number, n: number): Range[] | null => {
    const result = splitRanges(lo, hi, n)
    return result.ok ? result.ranges : null
  }
  it('matches the vectors', () => {
    expect(split(0, 10_000, 3)).toEqual([[0, 3333], [3333, 6666], [6666, 10_000]])
    expect(split(0, 10_000, 1)).toEqual([[0, 10_000]])
    expect(split(0, 10_000, 4)).toEqual([[0, 2500], [2500, 5000], [5000, 7500], [7500, 10_000]])
    expect(split(1000, 10_000, 2)).toEqual([[1000, 5500], [5500, 10_000]])
    expect(split(0, 7, 3)).toEqual([[0, 2], [2, 4], [4, 7]])
    expect(split(0, 2, 5)).toBeNull()
  })
})

describe('override parsing (checklist 31)', () => {
  it('size', () => {
    expect(parseSizeOverride('640x360')).toEqual({ ok: true, value: '640x360' })
    expect(parseSizeOverride(' 640X360 ')).toEqual({ ok: true, value: '640x360' })
    expect(parseSizeOverride('640:360')).toEqual({ ok: true, value: '640x360' })
    expect(parseSizeOverride('-1')).toEqual({ ok: true, value: '-1' })
    expect(parseSizeOverride('')).toEqual({ ok: true, value: null })
    for (const bad of ['640', '0x10', 'axb', '640x']) expect(parseSizeOverride(bad).ok).toBe(false)
  })

  it('rate and avgrate', () => {
    expect(parseRateOverride('800')).toEqual({ ok: true, value: 800 })
    expect(parseAvgrateOverride('')).toEqual({ ok: true, value: null })
    for (const bad of ['0', '-5', '1.5', 'x']) {
      expect(parseRateOverride(bad).ok, bad).toBe(false)
      expect(parseAvgrateOverride(bad).ok, bad).toBe(false)
    }
  })

  it('F4/F5 crop x|y|w|h', () => {
    expect(parseCropOverride('10|20|300|200')).toEqual({
      ok: true,
      value: { x: 10, y: 20, w: 300, h: 200 }
    })
    expect(parseCropOverride('')).toEqual({ ok: true, value: null })
    for (const bad of ['10|20|300', '10|20|0|5', 'a|b|c|d', '1|2|3|4|5', '-1|0|5|5']) {
      expect(parseCropOverride(bad).ok, bad).toBe(false)
    }
  })
})
