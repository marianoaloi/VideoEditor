import { WHOLE_VIDEO_START_MS, type Range } from '@shared/domain/job'
import { rangeLengthMs } from '@shared/core/rangeEditor'

export type SelectionColor = 'success' | 'warning' | 'error'

/** TimeDuration colour: green below `greenBelowMs`, yellow below `yellowBelowMs`, else red. */
export function selectionColor(
  totalMs: number,
  thresholds: { greenBelowMs: number; yellowBelowMs: number }
): SelectionColor {
  if (totalMs < thresholds.greenBelowMs) return 'success'
  if (totalMs < thresholds.yellowBelowMs) return 'warning'
  return 'error'
}

export function isWholeVideo(range: Range): boolean {
  return range[0] === WHOLE_VIDEO_START_MS
}

export function rowLengthMs(range: Range, durationMs: number): number {
  return rangeLengthMs(range, durationMs)
}

/** Start/end shown for a row (`[-1, d]` shows 0 → d). */
export function rowBounds(range: Range, durationMs: number): { startMs: number; endMs: number } {
  if (isWholeVideo(range)) return { startMs: 0, endMs: durationMs > 0 ? durationMs : range[1] }
  return { startMs: range[0], endMs: range[1] }
}
