/**
 * "Split into N" (MyVideos `splitTimes`, research cutter-crop-zoom §1.4, TV-1).
 * Always exactly N ranges of `trunc((end - start) / N)` ms; the last one takes the remainder.
 * Unlike the legacy loop it never makes more than N ranges and never divides by a zero step.
 */
import type { Range } from '../domain/job'

export type SplitRefusal = 'invalid-parts' | 'invalid-span' | 'too-many-parts'

export type SplitResult =
  | { readonly ok: true; readonly ranges: Range[] }
  | { readonly ok: false; readonly reason: SplitRefusal; readonly message: string }

function refuse(reason: SplitRefusal, message: string): SplitResult {
  return { ok: false, reason, message }
}

/** `splitRanges(0, 95000, 4)` → `[0,23750] [23750,47500] [47500,71250] [71250,95000]`. */
export function splitRanges(startMs: number, endMs: number, parts: number): SplitResult {
  if (!Number.isInteger(parts) || parts < 1) {
    return refuse('invalid-parts', 'Enter a number of parts of 1 or more')
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return refuse('invalid-span', 'The span to split is empty')
  }
  const start = Math.trunc(startMs)
  const end = Math.trunc(endMs)
  const step = Math.trunc((end - start) / parts)
  if (step < 1) return refuse('too-many-parts', 'Too many parts for this span')
  const ranges: Range[] = []
  for (let i = 0; i < parts; i += 1) {
    ranges.push([start + i * step, i === parts - 1 ? end : start + (i + 1) * step])
  }
  return { ok: true, ranges }
}

/** First run of digits of the field text, as the legacy field read it; `null` when there is none. */
export function parsePartsText(text: string): number | null {
  const match = /\d+/.exec(text)
  if (match === null) return null
  const value = Number(match[0])
  return Number.isSafeInteger(value) ? value : null
}
