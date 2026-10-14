import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import CloseIcon from '@mui/icons-material/Close'
import { ProcessingMode, type Range } from '@shared/domain/job'
import { formatMillis } from '@shared/core/timeFormat'
import { totalSelectedMs } from '@shared/core/rangeEditor'
import { parsePartsText } from '@shared/core/splitRanges'
import { TimeCell } from './TimeCell'
import { isWholeVideo, rowBounds, rowLengthMs, selectionColor } from './timeRangesMath'
import type { TimeRangesProps } from './types'

interface RowProps {
  range: Range
  index: number
  durationMs: number
  selected: boolean
  onSelect: (index: number | null) => void
  onSeek: TimeRangesProps['onSeek']
  onRemove: (index: number) => void
  onChange: (index: number, range: Range) => void
}

/** Visual order of the legacy row: begin | duration | end | X. */
function RangeRow({ range, index, durationMs, selected, ...handlers }: RowProps) {
  const { startMs, endMs } = rowBounds(range, durationMs)
  const whole = isWholeVideo(range)
  const editable = !whole
  const edit = (start: number | null, end: number | null) => {
    if (start !== null && end !== null && start < end) handlers.onChange(index, [start, end])
  }
  return (
    <Box
      role="listitem"
      aria-label={`Range ${index + 1}`}
      aria-current={selected ? 'true' : undefined}
      onClick={() => handlers.onSelect(selected ? null : index)}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 0.5,
        borderRadius: 0.5,
        bgcolor: selected ? 'action.selected' : 'transparent',
        '&:hover': { bgcolor: 'action.hover' }
      }}
    >
      <Typography variant="caption" sx={{ width: 20, color: 'text.secondary' }}>
        {index + 1}
      </Typography>
      <TimeCell
        label={`Start of range ${index + 1}`}
        valueMs={startMs}
        onSeek={handlers.onSeek}
        onCommit={
          editable ? (value) => edit(value, endMs) : undefined
        }
      />
      <Typography
        component="button"
        type="button"
        aria-label={`Duration of range ${index + 1}`}
        onClick={(event) => {
          event.stopPropagation()
          handlers.onSeek?.(startMs)
        }}
        sx={{
          all: 'unset',
          cursor: 'pointer',
          width: 84,
          fontFamily: 'monospace',
          fontStyle: 'italic',
          fontSize: 12,
          color: 'error.main'
        }}
      >
        {whole ? 'whole video' : formatMillis(rowLengthMs(range, durationMs), { millis: true })}
      </Typography>
      <TimeCell
        label={`End of range ${index + 1}`}
        valueMs={endMs}
        onSeek={handlers.onSeek}
        onCommit={
          editable ? (value) => edit(startMs, value) : undefined
        }
      />
      <IconButton
        size="small"
        aria-label={`Remove range ${index + 1}`}
        onClick={(event) => {
          event.stopPropagation()
          handlers.onRemove(index)
        }}
        sx={{ bgcolor: 'error.main', color: 'error.contrastText', borderRadius: 0.5, p: 0.25 }}
      >
        <CloseIcon fontSize="inherit" />
      </IconButton>
    </Box>
  )
}

function SplitField({ onSplit }: { onSplit: (parts: number) => void }) {
  const [text, setText] = useState('')
  const parts = parsePartsText(text)
  const submit = () => {
    if (parts !== null) onSplit(parts)
  }
  return (
    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
      <TextField
        size="small"
        label="Split into"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Enter') submit()
        }}
        slotProps={{ htmlInput: { inputMode: 'numeric', 'aria-label': 'Split into parts' } }}
        sx={{ width: 110 }}
      />
      <Button size="small" variant="outlined" disabled={parts === null || parts < 1} onClick={submit}>
        Split
      </Button>
    </Box>
  )
}

/** Marked ranges: select, seek, edit, remove, plus the cut / concat switch and "split into N". */
export function TimeRanges(props: TimeRangesProps) {
  const { ranges, durationMs, mode, selectedIndex, thresholds } = props
  const total = totalSelectedMs(ranges, durationMs)
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={mode}
          aria-label="Output mode"
          onChange={(_event, value: number | null) => {
            if (value === ProcessingMode.cut || value === ProcessingMode.concat) {
              props.onModeChange(value)
            }
          }}
        >
          <ToggleButton value={ProcessingMode.cut}>Cut</ToggleButton>
          <ToggleButton value={ProcessingMode.concat}>Concat</ToggleButton>
        </ToggleButtonGroup>
        <Typography
          variant="body2"
          aria-label="Selected duration"
          sx={{ fontFamily: 'monospace', color: `${selectionColor(total, thresholds)}.main` }}
        >
          {formatMillis(total)}
        </Typography>
        {props.onSplit !== undefined && <SplitField onSplit={props.onSplit} />}
      </Box>
      <Box role="list" aria-label="Ranges" sx={{ overflowY: 'auto', minHeight: 0 }}>
        {ranges.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
            No ranges yet. Press X to start one and X again to end it.
          </Typography>
        )}
        {ranges.map((range, index) => (
          <RangeRow
            key={`${range[0]}-${range[1]}-${index}`}
            range={range}
            index={index}
            durationMs={durationMs}
            selected={selectedIndex === index}
            onSelect={props.onSelect}
            onSeek={props.onSeek}
            onRemove={props.onRemove}
            onChange={props.onChange}
          />
        ))}
      </Box>
    </Box>
  )
}

export default TimeRanges
