import { describe, expect, it } from 'vitest'
import type { Range } from '../domain/job'
import {
  appendToEnd,
  clampPosition,
  EMPTY_EDITOR,
  fromMsToEnd,
  isValidRange,
  markRange,
  orderForMode,
  pendingLengthMs,
  removeRange,
  replaceRange,
  seekTarget,
  totalSelectedMs,
  typedPosition,
  type EditorResult,
  type EditorState
} from './rangeEditor'

const DURATION = 95000

function mustOk(result: EditorResult): EditorState {
  if (!result.ok) throw new Error(result.message)
  return result.state
}

describe('markRange (TV-2.1 to 2.3)', () => {
  it('freezes the start on the first press and closes the range on the second', () => {
    const pending = mustOk(markRange(EMPTY_EDITOR, 1200, DURATION))
    expect(pending.pendingStartMs).toBe(1200)
    expect(pendingLengthMs(pending, 4500)).toBe(3300)
    const done = markRange(pending, 4500, DURATION)
    expect(done).toMatchObject({ ok: true, added: [1200, 4500] })
    expect(mustOk(done).ranges).toEqual([[1200, 4500]])
    expect(mustOk(done).pendingStartMs).toBeNull()
  })

  it('normalises the order when the end is before the start', () => {
    const state: EditorState = { ranges: [], pendingStartMs: 9000 }
    expect(mustOk(markRange(state, 5000, DURATION)).ranges).toEqual([[5000, 9000]])
  })

  it('refuses a zero-length range (D10) and keeps the pending mark', () => {
    const pending = mustOk(markRange(EMPTY_EDITOR, 7000, DURATION))
    const second = markRange(pending, 7000, DURATION)
    expect(second).toMatchObject({ ok: false, error: 'zero-length' })
    expect(second.state.pendingStartMs).toBe(7000)
  })

  it('allows overlapping ranges', () => {
    const a = mustOk(markRange(mustOk(markRange(EMPTY_EDITOR, 0, DURATION)), 5000, DURATION))
    const b = mustOk(markRange(mustOk(markRange(a, 2000, DURATION)), 8000, DURATION))
    expect(b.ranges).toEqual([
      [0, 5000],
      [2000, 8000]
    ])
  })

  it('clamps the mark into the video', () => {
    expect(mustOk(markRange(EMPTY_EDITOR, 999999, DURATION)).pendingStartMs).toBe(DURATION)
  })
})

describe('appendToEnd (TV-2.4, 2.5)', () => {
  it('from idle appends [playhead, duration]', () => {
    const state: EditorState = { ranges: [[0, 1000]], pendingStartMs: null }
    expect(mustOk(appendToEnd(state, 20000, DURATION)).ranges).toEqual([
      [0, 1000],
      [20000, DURATION]
    ])
  })

  it('from pending uses the frozen start and the video end (legacy lost it, D4)', () => {
    const state: EditorState = { ranges: [], pendingStartMs: 10000 }
    const next = mustOk(appendToEnd(state, 30000, DURATION))
    expect(next.ranges).toEqual([[10000, DURATION]])
    expect(next.pendingStartMs).toBeNull()
  })

  it('refuses when the playhead is at the end', () => {
    expect(appendToEnd(EMPTY_EDITOR, DURATION, DURATION)).toMatchObject({
      ok: false,
      error: 'no-room'
    })
  })

  it('refuses without a known duration', () => {
    expect(appendToEnd(EMPTY_EDITOR, 0, 0)).toMatchObject({ ok: false })
  })
})

describe('removeRange (TV-2.6)', () => {
  it('removes the row, clears pending and seeks to its start', () => {
    const state: EditorState = {
      ranges: [
        [0, 1000],
        [3000, 8000]
      ],
      pendingStartMs: 500
    }
    const { state: next, seekMs } = removeRange(state, 1)
    expect(next).toEqual({ ranges: [[0, 1000]], pendingStartMs: null })
    expect(seekMs).toBe(3000)
  })

  it('ignores an unknown index', () => {
    expect(removeRange(EMPTY_EDITOR, 3)).toEqual({ state: EMPTY_EDITOR, seekMs: null })
  })

  it('seeks to 0 for a whole-video row', () => {
    const state: EditorState = { ranges: [[-1, DURATION]], pendingStartMs: null }
    expect(removeRange(state, 0).seekMs).toBe(0)
  })
})

describe('replaceRange', () => {
  const state: EditorState = { ranges: [[0, 1000]], pendingStartMs: null }
  it('accepts a valid edit', () => {
    expect(mustOk(replaceRange(state, 0, [100, 2000], DURATION)).ranges).toEqual([[100, 2000]])
  })
  it('refuses start >= end and values past the end', () => {
    expect(replaceRange(state, 0, [500, 500], DURATION)).toMatchObject({ error: 'zero-length' })
    expect(replaceRange(state, 0, [0, DURATION + 1], DURATION)).toMatchObject({
      error: 'out-of-range'
    })
    expect(replaceRange(state, 4, [0, 10], DURATION)).toMatchObject({ error: 'invalid' })
  })
})

describe('seek helpers (TV-3 deltas clamp to [0, duration], D12)', () => {
  it('clamps both ends', () => {
    expect(seekTarget(10000, -1000, 12000)).toBe(9000)
    expect(seekTarget(10000, 5000, 12000)).toBe(12000)
    expect(seekTarget(10000, -10000, 12000)).toBe(0)
    expect(seekTarget(10000, -50000, 12000)).toBe(0)
    expect(seekTarget(10000, 10, 12000)).toBe(10010)
  })
  it('clampPosition handles junk', () => {
    expect(clampPosition(Number.NaN, 100)).toBe(0)
    expect(clampPosition(-5, 100)).toBe(0)
  })
})

describe('typedPosition (D11)', () => {
  it('accepts any value in 0..duration, including under a second', () => {
    expect(typedPosition(500, DURATION)).toBe(500)
    expect(typedPosition(0, DURATION)).toBe(0)
    expect(typedPosition(DURATION, DURATION)).toBe(DURATION)
  })
  it('rejects junk and values past the end', () => {
    expect(typedPosition(null, DURATION)).toBeNull()
    expect(typedPosition(-1, DURATION)).toBeNull()
    expect(typedPosition(DURATION + 1, DURATION)).toBeNull()
  })
})

describe('totals and ordering', () => {
  it('sums ranges and counts the whole-video marker as the duration', () => {
    const ranges: Range[] = [
      [0, 1000],
      [2000, 5000]
    ]
    expect(totalSelectedMs(ranges, DURATION)).toBe(4000)
    expect(totalSelectedMs([[-1, DURATION]], DURATION)).toBe(DURATION)
  })
  it('sorts for concat only', () => {
    const ranges: Range[] = [
      [5000, 6000],
      [0, 1000]
    ]
    expect(orderForMode(ranges, true)).toEqual([
      [0, 1000],
      [5000, 6000]
    ])
    expect(orderForMode(ranges, false)).toEqual(ranges)
  })
  it('fromMsToEnd makes one idle range', () => {
    expect(fromMsToEnd(20000, DURATION)).toEqual({
      ranges: [[20000, DURATION]],
      pendingStartMs: null
    })
    expect(fromMsToEnd(DURATION, DURATION).ranges).toEqual([])
  })
  it('isValidRange', () => {
    expect(isValidRange([0, 10], 100)).toBe(true)
    expect(isValidRange([10, 10], 100)).toBe(false)
    expect(isValidRange([-1, 100], 100)).toBe(true)
  })
})
