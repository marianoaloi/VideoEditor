/**
 * TimeRanges contract: the list of marked ranges with `hms(start)`, `hms(end)`, `hms(duration)`,
 * remove / select / edit, and the cut-vs-concat mode switch (LEG §4.1 TimeComponent).
 * Owner (wave 2): ui-cutter implements `TimeRanges.tsx`; used by Video Triage and the Cutter.
 */
import type { ProcessingMode, Range } from '@shared/domain/job'

export interface TimeRangesProps {
  ranges: readonly Range[]
  /** `[-1, durationMs]` entries are shown as "whole video". */
  durationMs: number
  /** Cut: one output per range (insertion order). Concat: one output (ordered by start). */
  mode: ProcessingMode
  selectedIndex: number | null
  onSelect: (index: number | null) => void
  /** Click on a range's start/end label: seek the player there. */
  onSeek?: (positionMs: number) => void
  onRemove: (index: number) => void
  /** A typed edit of one range; the component validates `start < end` before calling. */
  onChange: (index: number, range: Range) => void
  onModeChange: (mode: ProcessingMode) => void
  /** "Split into N": replaces the ranges by `splitRanges(low, high, n)`. */
  onSplit?: (parts: number) => void
  /** Total of the selected ranges, for the TimeDuration label colour (settings.thresholds.selection). */
  thresholds: { greenBelowMs: number; yellowBelowMs: number }
}
