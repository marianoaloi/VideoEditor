/**
 * RangeSlider contract: two-thumb in/out slider over the video timeline (MUI `Slider`), with the
 * playhead and the already marked ranges drawn on the track (LEG §4.1 range editor).
 * Owner (wave 2): ui-cutter implements `RangeSlider.tsx`; ui-video uses it in Video Triage.
 *
 * All values are milliseconds in the ORIGINAL timeline (a transcode stream's offset is already
 * applied by the caller).
 */
import type { Range } from '@shared/domain/job'

export interface RangeSelection {
  lowMs: number
  highMs: number
}

export interface RangeSliderProps {
  durationMs: number
  lowMs: number
  highMs: number
  /** Playhead marker. */
  positionMs: number
  /** Finished ranges, shown as bands under the track. */
  ranges?: readonly Range[]
  disabled?: boolean
  /** Handle step for keyboard/drag. Default 100. */
  stepMs?: number
  /** Dragging a handle. `low <= high` is guaranteed. */
  onChange: (selection: RangeSelection) => void
  /** Drag released. */
  onChangeCommitted?: (selection: RangeSelection) => void
  /** Click on the track away from the handles: seek the player there. */
  onSeek?: (positionMs: number) => void
}
