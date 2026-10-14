/**
 * Pure helpers of `RangeSlider` (legacy `range_slider.py` rules, research §5): the handles never
 * cross (minimum gap 1 ms) and the handle that moved is the active one.
 */
import type { RangeSelection } from './types'

export const MIN_GAP_MS = 1

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Applies a thumb move. `activeThumb` 0 moves the low handle (it cannot reach high), 1 the high
 * handle (it cannot reach low). Values are rounded to whole ms and kept inside `[0, durationMs]`.
 */
export function moveHandle(
  current: RangeSelection,
  activeThumb: 0 | 1,
  valueMs: number,
  durationMs: number
): RangeSelection {
  const value = Math.round(valueMs)
  if (activeThumb === 0) {
    const lowMs = clamp(value, 0, Math.max(0, current.highMs - MIN_GAP_MS))
    return { lowMs, highMs: current.highMs }
  }
  const highMs = clamp(value, Math.min(durationMs, current.lowMs + MIN_GAP_MS), durationMs)
  return { lowMs: current.lowMs, highMs }
}

/** Normalises props: integers, inside the video, `low < high` when there is room. */
export function normaliseSelection(
  lowMs: number,
  highMs: number,
  durationMs: number
): RangeSelection {
  const max = Math.max(0, durationMs)
  const low = clamp(Math.round(lowMs), 0, max)
  const high = clamp(Math.round(highMs), 0, max)
  if (low <= high) return { lowMs: low, highMs: high }
  return { lowMs: high, highMs: low }
}

/** Pointer x inside the track box → ms (`trunc(x / width * duration)`, the legacy scrub formula). */
export function pointerToMs(
  clientX: number,
  box: { left: number; width: number },
  durationMs: number
): number {
  if (box.width <= 0 || durationMs <= 0) return 0
  const fraction = clamp((clientX - box.left) / box.width, 0, 1)
  return Math.trunc(fraction * durationMs)
}

/** Percentage 0..100 of a position, for the bands and the playhead. */
export function percentOf(valueMs: number, durationMs: number): number {
  if (durationMs <= 0) return 0
  return clamp((valueMs / durationMs) * 100, 0, 100)
}
