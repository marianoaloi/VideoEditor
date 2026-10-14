/**
 * The range-slider handle rules R1-R12, the job `times` and the info-bar override parsing of Video
 * Triage (video-triage.md §4, §7, §9; vectors TV-F, TV-G). Pure functions on plain values: the
 * slice calls them from reducers, tests call them directly.
 *
 * Handles are in ORIGINAL-timeline ms. The legacy slider maximum is `duration - 100`
 * (`effectiveDuration`), so `max` below is that value.
 */
import type { Rect } from '../domain/geometry'
import { WHOLE_VIDEO_START_MS, type Range } from '../domain/job'

/** `0` = low handle, `1` = high handle, `-1` = both (groove drag). */
export type ActiveHandle = 0 | 1 | -1

export interface Handles {
  low: number
  high: number
  active: ActiveHandle
}

export interface HandlesMove {
  handles: Handles
  /** Where the player must seek, or `null` for no seek. */
  seekMs: number | null
}

/** After the duration is known: `[0, max]`, low active (R-load). */
export function initialHandles(maxMs: number): Handles {
  return { low: 0, high: Math.max(0, Math.round(maxMs)), active: 0 }
}

/** R1/R2: the playhead drives the active handle (no clamping, so `low > high` is possible). */
export function applyPlayhead(handles: Handles, positionMs: number): Handles {
  const p = Math.max(0, Math.round(positionMs))
  return handles.active === 1 ? { ...handles, high: p } : { ...handles, low: p }
}

/** R4 `Z`: swap the active handle (-1 becomes 0) and seek to its value. */
export function swapActive(handles: Handles): HandlesMove {
  const active: ActiveHandle = handles.active === 0 ? 1 : 0
  return {
    handles: { ...handles, active },
    seekMs: active === 0 ? handles.low : handles.high
  }
}

/** R5 `Ctrl+Home`. */
export function jumpToStart(handles: Handles): HandlesMove {
  return { handles: { ...handles, active: 0, low: 0 }, seekMs: 0 }
}

/** R5 `Ctrl+End`. */
export function jumpToEnd(handles: Handles, maxMs: number): HandlesMove {
  return { handles: { ...handles, active: 1, high: maxMs }, seekMs: maxMs }
}

/** R6: drag one handle. Low stays at least 1 ms below high, high at least 1 ms above low. */
export function dragHandle(
  handles: Handles,
  which: 0 | 1,
  valueMs: number,
  maxMs: number
): HandlesMove {
  const v = Math.min(maxMs, Math.max(0, Math.round(valueMs)))
  const next: Handles =
    which === 0
      ? { ...handles, active: 0, low: Math.min(v, handles.high - 1) }
      : { ...handles, active: 1, high: Math.max(v, handles.low + 1) }
  return { handles: next, seekMs: which === 0 ? next.low : next.high }
}

/** R7: a groove drag shifts both handles by the same offset, clamped to `[0, max]`. */
export function dragBoth(handles: Handles, deltaMs: number, maxMs: number): HandlesMove {
  const lo = Math.min(handles.low, handles.high)
  const hi = Math.max(handles.low, handles.high)
  const shift = Math.min(maxMs - hi, Math.max(-lo, Math.round(deltaMs)))
  const next: Handles = { low: handles.low + shift, high: handles.high + shift, active: -1 }
  return { handles: next, seekMs: next.low }
}

/** R8 (fixed): a range label sets the handle it belongs to, makes it active and seeks there. */
export function clickRangeLabel(
  handles: Handles,
  which: 'start' | 'end',
  ms: number
): HandlesMove {
  return which === 'start'
    ? { handles: { ...handles, active: 0, low: ms }, seekMs: ms }
    : { handles: { ...handles, active: 1, high: ms }, seekMs: ms }
}

/** R9 (fixed): removing a range loads it into the handles, low active, and seeks to its start. */
export function loadRangeIntoHandles(range: Range): HandlesMove {
  return { handles: { low: range[0], high: range[1], active: 0 }, seekMs: range[0] }
}

/** R10 `X`: the range `(min(low,high), max(low,high))`; `null` when it would be empty. */
export function rangeFromHandles(handles: Handles): Range | null {
  const start = Math.min(handles.low, handles.high)
  const end = Math.max(handles.low, handles.high)
  return start < end ? [start, end] : null
}

/** `TimeDuration`: milliseconds of the current handle selection. */
export function selectionMs(handles: Handles): number {
  return Math.abs(handles.high - handles.low)
}

export type TimesResult =
  | { readonly ok: true; readonly times: Range[] }
  | { readonly ok: false; readonly message: string }

/** `Ctrl+Shift+C` / `Ctrl+Shift+X`: the whole video as the runner's sentinel (Q3). */
export function wholeVideoTimes(durationMs: number): Range[] {
  return [[WHOLE_VIDEO_START_MS, Math.max(0, Math.round(durationMs))]]
}

/**
 * `times` of a job (§9): the added ranges (sorted by start for concat) or, with none, the raw
 * handle span. An empty span is refused instead of being written.
 */
export function resolveJobTimes(
  ranges: readonly Range[],
  handles: Pick<Handles, 'low' | 'high'>,
  concat: boolean
): TimesResult {
  if (ranges.length > 0) {
    const copy: Range[] = ranges.map((r) => [r[0], r[1]])
    return { ok: true, times: concat ? copy.sort((a, b) => a[0] - b[0]) : copy }
  }
  const span = rangeFromHandles({ ...handles, active: 0 })
  if (span === null) {
    return { ok: false, message: 'The selected span is empty: move the handles apart or add a range' }
  }
  return { ok: true, times: [span] }
}

// ---- info-bar overrides (§7) ----------------------------------------------------------------

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string }

const ok = <T>(value: T): ParseResult<T> => ({ ok: true, value })
const fail = <T>(message: string): ParseResult<T> => ({ ok: false, message })

/** `''` clears; `-1`, `WxH` or `W:H` (positive sizes). Stored as `-1` or `WxH`. */
export function parseSizeOverride(text: string): ParseResult<string | null> {
  const t = text.trim()
  if (t === '') return ok(null)
  if (t === '-1') return ok('-1')
  const match = /^(\d+)[xX:](\d+)$/.exec(t)
  if (match === null || Number(match[1]) < 1 || Number(match[2]) < 1) {
    return fail('Size must be WxH (for example 640x360) or -1')
  }
  return ok(`${Number(match[1])}x${Number(match[2])}`)
}

function parsePositiveInt(text: string, what: string): ParseResult<number | null> {
  const t = text.trim()
  if (t === '') return ok(null)
  if (!/^\d+$/.test(t) || Number(t) < 1) return fail(`${what} must be a positive whole number`)
  return ok(Number(t))
}

export const parseRateOverride = (text: string): ParseResult<number | null> =>
  parsePositiveInt(text, 'Bitrate')

export const parseAvgrateOverride = (text: string): ParseResult<number | null> =>
  parsePositiveInt(text, 'Frame rate')

/** `x|y|w|h`, four whole numbers, `w` and `h` positive. `''` clears. */
export function parseCropOverride(text: string): ParseResult<Rect | null> {
  const t = text.trim()
  if (t === '') return ok(null)
  const parts = t.split('|').map((part) => part.trim())
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
    return fail('Crop must be x|y|w|h (four whole numbers)')
  }
  const [x, y, w, h] = parts.map(Number) as [number, number, number, number]
  if (w < 1 || h < 1) return fail('Crop width and height must be positive')
  return ok({ x, y, w, h })
}
