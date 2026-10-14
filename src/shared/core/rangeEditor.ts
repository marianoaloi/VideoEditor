/**
 * Pure range editor behind the Cutter and Video Triage (MyVideos `addTimef`, `removeTime`,
 * `presentSuperTimes`; research cutter-crop-zoom §1.4, TV-2). The two-press `X` mark is a small
 * state machine: IDLE (`pendingStartMs === null`, the start follows the playhead) and PENDING
 * (the start is frozen, the end follows the playhead). Positions are always the LIVE player
 * position at the key event (legacy D9 read a stale one).
 */
import { WHOLE_VIDEO_START_MS, type Range } from '../domain/job'

export interface EditorState {
  /** Finished ranges, insertion order. */
  readonly ranges: readonly Range[]
  /** The frozen start of the range being marked; `null` = idle. */
  readonly pendingStartMs: number | null
}

export type EditorError = 'zero-length' | 'no-room' | 'out-of-range' | 'invalid'

export type EditorResult =
  | { readonly ok: true; readonly state: EditorState; readonly added: Range | null }
  | {
      readonly ok: false
      readonly state: EditorState
      readonly error: EditorError
      readonly message: string
    }

export const EDITOR_MESSAGES: Record<EditorError, string> = {
  'zero-length': 'A range needs an end after its start',
  'no-room': 'The start is already at the end of the video',
  'out-of-range': 'That time is outside the video',
  invalid: 'Not a valid range'
}

export const EMPTY_EDITOR: EditorState = { ranges: [], pendingStartMs: null }

function failure(state: EditorState, error: EditorError): EditorResult {
  return { ok: false, state, error, message: EDITOR_MESSAGES[error] }
}

export function isPending(state: EditorState): boolean {
  return state.pendingStartMs !== null
}

/** Clamps a position to `[0, durationMs]` (D12: a seek past the end lands on the end). */
export function clampPosition(positionMs: number, durationMs: number): number {
  if (!Number.isFinite(positionMs)) return 0
  const max = Math.max(0, durationMs)
  return Math.min(max, Math.max(0, Math.round(positionMs)))
}

/** Seek key / wheel step: `clampPosition(positionMs + deltaMs)`. */
export function seekTarget(positionMs: number, deltaMs: number, durationMs: number): number {
  return clampPosition(positionMs + deltaMs, durationMs)
}

/** Valid for the editor: integers, `0 <= start < end <= duration` (or the whole-video marker). */
export function isValidRange(range: Range, durationMs: number): boolean {
  const [start, end] = range
  if (start === WHOLE_VIDEO_START_MS) return end > 0
  const inside = durationMs <= 0 || end <= durationMs
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start < end && inside
}

/** Length of a range; `[-1, d]` counts as the whole video. */
export function rangeLengthMs(range: Range, durationMs: number): number {
  if (range[0] === WHOLE_VIDEO_START_MS) return durationMs > 0 ? durationMs : range[1]
  return Math.max(0, range[1] - range[0])
}

/** Total of the selected ranges (drives the info bar estimates and the selection colour). */
export function totalSelectedMs(ranges: readonly Range[], durationMs: number): number {
  return ranges.reduce((sum, range) => sum + rangeLengthMs(range, durationMs), 0)
}

/** The cut label while PENDING: `|position - start|`; `null` when idle. */
export function pendingLengthMs(state: EditorState, positionMs: number): number | null {
  return state.pendingStartMs === null ? null : Math.abs(positionMs - state.pendingStartMs)
}

/**
 * `X`. IDLE: freeze the start at the live position. PENDING: close `[min, max]` of the frozen
 * start and the live position, then go idle (the next start follows the playhead).
 * Equal marks are refused (D10).
 */
export function markRange(
  state: EditorState,
  positionMs: number,
  durationMs: number
): EditorResult {
  const position = clampPosition(positionMs, durationMs)
  if (state.pendingStartMs === null) {
    return { ok: true, state: { ...state, pendingStartMs: position }, added: null }
  }
  const start = state.pendingStartMs
  if (position === start) return failure(state, 'zero-length')
  const added: Range = position > start ? [start, position] : [position, start]
  return { ok: true, state: { ranges: [...state.ranges, added], pendingStartMs: null }, added }
}

/**
 * Ctrl+Shift+C / V: append `[pendingStart ?? position, duration]` (D4: always the end of the
 * video, also from PENDING). The caller then saves and processes.
 */
export function appendToEnd(
  state: EditorState,
  positionMs: number,
  durationMs: number
): EditorResult {
  if (durationMs <= 0) return failure(state, 'invalid')
  const start = state.pendingStartMs ?? clampPosition(positionMs, durationMs)
  if (start >= durationMs) return failure(state, 'no-room')
  const added: Range = [start, durationMs]
  return { ok: true, state: { ranges: [...state.ranges, added], pendingStartMs: null }, added }
}

/** `-s <ms>`: one range from `fromMs` to the end, editor idle. */
export function fromMsToEnd(fromMs: number, durationMs: number): EditorState {
  const start = clampPosition(fromMs, durationMs)
  const ranges: Range[] = start < durationMs ? [[start, durationMs]] : []
  return { ranges, pendingStartMs: null }
}

/** Removing a row: delete it, drop any pending mark, hand back the start to seek to (D13). */
export function removeRange(
  state: EditorState,
  index: number
): { readonly state: EditorState; readonly seekMs: number | null } {
  const target = state.ranges[index]
  if (target === undefined) return { state, seekMs: null }
  const ranges = state.ranges.filter((_, i) => i !== index)
  const seekMs = target[0] === WHOLE_VIDEO_START_MS ? 0 : target[0]
  return { state: { ranges, pendingStartMs: null }, seekMs }
}

/** A typed edit of one row. */
export function replaceRange(
  state: EditorState,
  index: number,
  range: Range,
  durationMs: number
): EditorResult {
  if (state.ranges[index] === undefined) return failure(state, 'invalid')
  if (range[0] >= range[1]) return failure(state, 'zero-length')
  if (!isValidRange(range, durationMs)) return failure(state, 'out-of-range')
  const ranges = state.ranges.map((existing, i) => (i === index ? range : existing))
  return { ok: true, state: { ...state, ranges }, added: null }
}

/** Replaces the whole list (open times, split). Pending is cleared. */
export function setRanges(ranges: readonly Range[]): EditorState {
  return { ranges: [...ranges], pendingStartMs: null }
}

/** Ranges sorted ascending by start for concat; cut keeps the insertion order. */
export function orderForMode(ranges: readonly Range[], concat: boolean): Range[] {
  return concat ? [...ranges].sort((a, b) => a[0] - b[0]) : [...ranges]
}

/** Typed start/end field: any value in `0..duration` seeks there (D11); `null` when out of range. */
export function typedPosition(valueMs: number | null, durationMs: number): number | null {
  if (valueMs === null || !Number.isFinite(valueMs) || valueMs < 0) return null
  if (durationMs > 0 && valueMs > durationMs) return null
  return Math.round(valueMs)
}
