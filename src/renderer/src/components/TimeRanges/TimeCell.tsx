import { useState, type KeyboardEvent } from 'react'
import ButtonBase from '@mui/material/ButtonBase'
import InputBase from '@mui/material/InputBase'
import { formatMillis, parseTimeInput } from '@shared/core/timeFormat'

interface TimeCellProps {
  label: string
  valueMs: number
  /** Click: seek there. */
  onSeek?: ((valueMs: number) => void) | undefined
  /** Double-click edit; the result is `null` when the text is not a time. */
  onCommit?: ((valueMs: number | null) => void) | undefined
}

/** `HH:MM:SS.mmm` cell: click seeks, double-click edits (Enter commits, Escape cancels). */
export function TimeCell({ label, valueMs, onSeek, onCommit }: TimeCellProps) {
  const [draft, setDraft] = useState<string | null>(null)

  const finish = (commit: boolean) => {
    if (commit && draft !== null) onCommit?.(parseTimeInput(draft))
    setDraft(null)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.key === 'Enter') finish(true)
    if (event.key === 'Escape') finish(false)
  }

  if (draft !== null) {
    return (
      <InputBase
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => finish(true)}
        inputProps={{ 'aria-label': label, size: 12 }}
        sx={{ fontFamily: 'monospace', fontSize: 13, width: 104 }}
      />
    )
  }
  return (
    <ButtonBase
      aria-label={label}
      title={onCommit === undefined ? label : `${label} (double-click to edit)`}
      onClick={(event) => {
        event.stopPropagation()
        onSeek?.(valueMs)
      }}
      onDoubleClick={() => {
        if (onCommit !== undefined) setDraft(formatMillis(valueMs, { millis: true }))
      }}
      sx={{ fontFamily: 'monospace', fontSize: 13, width: 104, justifyContent: 'flex-start' }}
    >
      {formatMillis(valueMs, { millis: true })}
    </ButtonBase>
  )
}
