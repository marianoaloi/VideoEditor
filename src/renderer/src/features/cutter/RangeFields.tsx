import { useState } from 'react'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import { formatMillis, parseTimeInput } from '@shared/core/timeFormat'

interface TimeFieldProps {
  label: string
  /** `null` shows an empty field (the end field while idle). */
  valueMs: number | null
  onCommit: (valueMs: number | null) => void
}

/** `HH:MM:SS.mmm` field: shows the live value, a typed time commits on Enter or blur. */
function TimeField({ label, valueMs, onCommit }: TimeFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (valueMs === null ? '' : formatMillis(valueMs, { millis: true }))
  const finish = () => {
    if (draft !== null) onCommit(parseTimeInput(draft))
    setDraft(null)
  }
  return (
    <TextField
      size="small"
      label={label}
      value={shown}
      onFocus={() => setDraft(valueMs === null ? '' : formatMillis(valueMs, { millis: true }))}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={finish}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') event.currentTarget.querySelector('input')?.blur()
        if (event.key === 'Escape') setDraft(null)
      }}
      slotProps={{ htmlInput: { 'aria-label': label, size: 12, style: { fontFamily: 'monospace' } } }}
      sx={{ width: 150 }}
    />
  )
}

interface RangeFieldsProps {
  positionMs: number
  pendingStartMs: number | null
  /** Seeks to the typed time (any value in 0..duration, D11). */
  onSeekTyped: (valueMs: number | null) => void
  /** Typing into the start field while a range is pending moves its frozen start. */
  onPendingStartTyped: (valueMs: number | null) => void
  /** The `+` button: same as the X key. */
  onMark: () => void
  /** Length label: `|end - start|` while pending. */
  pendingLengthMs: number | null
}

/** Start / end fields, the cut label and the `+` button (MyVideos `startPoint`, `duration`). */
export function RangeFields(props: RangeFieldsProps) {
  const pending = props.pendingStartMs !== null
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      <TimeField
        label="Start"
        valueMs={pending ? props.pendingStartMs : props.positionMs}
        onCommit={pending ? props.onPendingStartTyped : props.onSeekTyped}
      />
      <TimeField
        label="End"
        valueMs={pending ? props.positionMs : null}
        onCommit={props.onSeekTyped}
      />
      <IconButton aria-label="Mark (X)" title="Mark start / end (X)" onClick={props.onMark}>
        <AddIcon />
      </IconButton>
      <Typography
        variant="body2"
        aria-label="Pending length"
        sx={{ fontFamily: 'monospace', minWidth: 90 }}
      >
        {props.pendingLengthMs === null ? '' : formatMillis(props.pendingLengthMs)}
      </Typography>
    </Box>
  )
}
