import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import Box from '@mui/material/Box'
import Slider from '@mui/material/Slider'
import { WHOLE_VIDEO_START_MS } from '@shared/domain/job'
import { formatMillis } from '@shared/core/timeFormat'
import { moveHandle, normaliseSelection, percentOf, pointerToMs } from './rangeSliderMath'
import type { RangeSelection, RangeSliderProps } from './types'

const THUMB_CLASS = 'MuiSlider-thumb'

function isThumb(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`.${THUMB_CLASS}`) !== null
}

/**
 * Two-thumb in/out slider over the video timeline. Dragging a handle never lets it cross the
 * other (1 ms gap); a click on the track away from the handles seeks (`onSeek`) instead of
 * moving a handle. Finished ranges are bands under the track and the playhead is a line.
 */
export function RangeSlider(props: RangeSliderProps) {
  const { durationMs, positionMs, ranges = [], disabled = false, stepMs = 100 } = props
  const { onChange, onChangeCommitted, onSeek } = props
  const trackRef = useRef<HTMLDivElement>(null)
  const selection = normaliseSelection(props.lowMs, props.highMs, durationMs)
  const inactive = disabled || durationMs <= 0

  const handleChange = (_event: Event, value: number | number[], activeThumb: number) => {
    if (!Array.isArray(value) || (activeThumb !== 0 && activeThumb !== 1)) return
    const next = moveHandle(selection, activeThumb, value[activeThumb] ?? 0, durationMs)
    if (next.lowMs !== selection.lowMs || next.highMs !== selection.highMs) onChange(next)
  }

  const handleCommitted = (_event: unknown, value: number | number[]) => {
    if (onChangeCommitted === undefined || !Array.isArray(value)) return
    const committed: RangeSelection = { lowMs: value[0] ?? 0, highMs: value[1] ?? durationMs }
    onChangeCommitted(normaliseSelection(committed.lowMs, committed.highMs, durationMs))
  }

  const seekOnTrack = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (onSeek === undefined || inactive || isThumb(event.target)) return
    const box = trackRef.current?.getBoundingClientRect()
    if (box === undefined) return
    // Capture phase: keeps MUI from dragging the nearest handle to the click.
    event.stopPropagation()
    onSeek(pointerToMs(event.clientX, box, durationMs))
  }

  return (
    <Box
      ref={trackRef}
      data-testid="range-slider"
      onPointerDownCapture={seekOnTrack}
      sx={{ position: 'relative', width: '100%', px: 1, py: 0.5 }}
    >
      <Box sx={{ position: 'relative', height: 8, mx: '10px' }} aria-hidden="true">
        {ranges.map((range, index) => {
          const start = range[0] === WHOLE_VIDEO_START_MS ? 0 : range[0]
          const left = percentOf(start, durationMs)
          const width = Math.max(0.2, percentOf(range[1], durationMs) - left)
          return (
            <Box
              key={`${range[0]}-${range[1]}-${index}`}
              data-testid="range-band"
              sx={{
                position: 'absolute',
                top: 0,
                height: '100%',
                left: `${left}%`,
                width: `${width}%`,
                bgcolor: 'success.main',
                opacity: 0.7,
                borderRadius: 0.5
              }}
            />
          )
        })}
        <Box
          data-testid="range-playhead"
          sx={{
            position: 'absolute',
            top: -4,
            bottom: -20,
            width: '2px',
            left: `${percentOf(positionMs, durationMs)}%`,
            bgcolor: 'error.main',
            pointerEvents: 'none',
            zIndex: 1
          }}
        />
      </Box>
      <Slider
        value={[selection.lowMs, selection.highMs]}
        min={0}
        max={Math.max(durationMs, 1)}
        step={stepMs}
        disabled={inactive}
        disableSwap
        size="small"
        onChange={handleChange}
        onChangeCommitted={handleCommitted}
        valueLabelDisplay="auto"
        valueLabelFormat={(value) => formatMillis(value, { millis: true })}
        getAriaLabel={(index) => (index === 0 ? 'Range start' : 'Range end')}
        getAriaValueText={(value) => formatMillis(value, { millis: true })}
        sx={{ mt: 0.5 }}
      />
    </Box>
  )
}

export default RangeSlider
