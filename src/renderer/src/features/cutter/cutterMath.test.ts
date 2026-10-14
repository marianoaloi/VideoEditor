import { describe, expect, it } from 'vitest'
import { seekTarget } from '@shared/core/rangeEditor'
import {
  outputNames,
  planDrop,
  scrubMs,
  SEEK_KEY_SPECS,
  volumeDownPercent,
  volumeUpPercent,
  wheelSteps
} from './cutterMath'

describe('seek keys (TV-3)', () => {
  const apply = (chord: string) => {
    const spec = SEEK_KEY_SPECS.find((s) => s.chord === chord)
    if (spec === undefined) throw new Error(chord)
    return seekTarget(10000, spec.deltaMs, 12000)
  }
  it('gives the table of section 1.5 from 10000 with duration 12000', () => {
    expect(SEEK_KEY_SPECS).toHaveLength(14)
    expect([apply('Q'), apply('R')]).toEqual([9000, 11000])
    expect([apply('W'), apply('E')]).toEqual([9500, 10500])
    expect([apply('Ctrl+Q'), apply('Ctrl+R')]).toEqual([5000, 12000])
    expect([apply('Ctrl+W'), apply('Ctrl+E')]).toEqual([9900, 10100])
    expect([apply('Ctrl+Shift+Q'), apply('Ctrl+Shift+R')]).toEqual([0, 12000])
    expect([apply('Ctrl+Shift+W'), apply('Ctrl+Shift+E')]).toEqual([9990, 10010])
    expect([apply('ArrowDown'), apply('ArrowUp')]).toEqual([5000, 12000])
  })
  it('has unique chords', () => {
    expect(new Set(SEEK_KEY_SPECS.map((s) => s.chord)).size).toBe(14)
  })
})

describe('volume rule (checklist 19)', () => {
  const run = (start: number, step: (v: number) => number, times: number) => {
    const out: number[] = []
    let v = start
    for (let i = 0; i < times; i += 1) {
      v = step(v)
      out.push(v)
    }
    return out
  }
  it('goes up 6 7 8 9 10 20 30 40 from 5', () => {
    expect(run(5, volumeUpPercent, 8)).toEqual([6, 7, 8, 9, 10, 20, 30, 40])
  })
  it('goes down 90 ... 10 0 0 from 100', () => {
    expect(run(100, volumeDownPercent, 11)).toEqual([90, 80, 70, 60, 50, 40, 30, 20, 10, 0, 0])
  })
  it('goes 4 3 2 from 14 (not multiples of ten)', () => {
    expect(run(14, volumeDownPercent, 4)).toEqual([4, 3, 2, 1])
  })
  it('stays inside 0..100', () => {
    expect(volumeUpPercent(100)).toBe(100)
  })
})

describe('wheelSteps', () => {
  it('turns wheel up into positive steps and accumulates small deltas', () => {
    expect(wheelSteps(0, -100)).toEqual({ steps: 1, remainder: 0 })
    expect(wheelSteps(0, 200)).toEqual({ steps: -2, remainder: 0 })
    const first = wheelSteps(0, -40)
    expect(first.steps).toBe(0)
    expect(wheelSteps(first.remainder, -70).steps).toBe(1)
  })
})

describe('scrubMs (TV-3)', () => {
  it('uses trunc(x / width * duration) and ignores outside x', () => {
    expect(scrubMs(400, 800, 95000)).toBe(47500)
    expect(scrubMs(0, 800, 95000)).toBe(0)
    expect(scrubMs(800, 800, 95000)).toBe(95000)
    expect(scrubMs(801, 800, 95000)).toBeNull()
    expect(scrubMs(-1, 800, 95000)).toBeNull()
    expect(scrubMs(5, 0, 95000)).toBeNull()
  })
})

describe('planDrop (checklist 4)', () => {
  it('opens the first video and reports the rest', () => {
    const plan = planDrop(['C:\\v\\notes.txt', 'C:\\v\\a.mp4', 'C:\\v\\b.mkv', 'C:\\v\\folder'])
    expect(plan.open).toBe('C:\\v\\a.mp4')
    expect(plan.ignored).toEqual(['C:\\v\\notes.txt', 'C:\\v\\b.mkv', 'C:\\v\\folder'])
  })
  it('opens nothing for a folder drop', () => {
    expect(planDrop(['/home/u/Videos'])).toEqual({ open: null, ignored: ['/home/u/Videos'] })
  })
})

describe('outputNames (ADR-005)', () => {
  it('cut makes one per range, concat one', () => {
    expect(outputNames('/d/v.mp4', 2, false)).toEqual(['v.mp4.0.mp4', 'v.mp4.1.mp4'])
    expect(outputNames('/d/v.mp4', 2, true)).toEqual(['v.mp4.mp4'])
    expect(outputNames('/d/v.mp4', 0, true)).toEqual([])
  })
})
