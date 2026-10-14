/** Toolbar, destination names, reset buttons, timer and quick-cut buttons of Image Triage. */
import { useState, type WheelEvent } from 'react'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import PauseIcon from '@mui/icons-material/Pause'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { useNotify } from '../../app/notifications/notify'
import {
  applyCropRect,
  chooseFolder,
  moveOrAdvance,
  resetDestination,
  setRecursive
} from './imageTriageThunks'
import {
  destinationNamesSet,
  noMoveSet,
  selectImageTriage,
  timerChanged
} from './imageTriageSlice'
import { formatInterval, stepInterval, validateDestinationName, wheelDirection } from './logic'

function NameField(props: {
  label: string
  value: string
  other: string
  backup: string
  editable: boolean
  onValid: (value: string) => void
}) {
  const { label, value, other, backup, editable, onValid } = props
  const notify = useNotify()
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (): void => {
    if (draft === null) return
    const check = validateDestinationName(draft, other, backup)
    if (check.ok) onValid(check.value)
    else notify.warning(check.reason)
    setDraft(null)
  }
  return (
    <TextField
      size="small"
      label={label}
      value={draft ?? value}
      disabled={!editable}
      slotProps={{ htmlInput: { 'aria-label': label } }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
      sx={{ width: 110 }}
    />
  )
}

export default function ControlsBar() {
  const dispatch = useAppDispatch()
  const s = useAppSelector(selectImageTriage)
  const backup = useAppSelector((st) => st.settings.value?.folders.backup ?? 'bkp')
  const [editNames, setEditNames] = useState(false)
  const onWheel = (e: WheelEvent): void => {
    const dir = wheelDirection(e.deltaY)
    if (dir !== 0) dispatch(timerChanged({ intervalMs: stepInterval(s.timer.intervalMs, dir) }))
  }
  const idle = s.sessionId === null
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, p: 1 }}>
      <Button startIcon={<FolderOpenIcon />} onClick={() => void dispatch(chooseFolder())}>
        Open folder
      </Button>
      <FormControlLabel
        control={<Checkbox checked={s.recursive} onChange={(_, v) => void dispatch(setRecursive(v))} />}
        label="Recursive"
      />
      <FormControlLabel
        control={<Checkbox checked={s.noMove} onChange={(_, v) => dispatch(noMoveSet(v))} />}
        label="No move"
      />
      <FormControlLabel
        control={<Checkbox checked={editNames} onChange={(_, v) => setEditNames(v)} />}
        label="Edit destination names"
      />
      <Button variant="outlined" disabled={idle} onClick={() => void dispatch(moveOrAdvance({ side: 'left' }))}>
        {s.leftName} [A]
      </Button>
      <NameField label="Left folder" value={s.leftName} other={s.rightName} backup={backup} editable={editNames} onValid={(left) => dispatch(destinationNamesSet({ left }))} />
      <Button disabled={idle} onClick={() => void dispatch(resetDestination('left'))}>
        Reset {s.leftName}
      </Button>
      <Button variant="outlined" disabled={idle} onClick={() => void dispatch(moveOrAdvance({ side: 'right' }))}>
        {s.rightName} [F]
      </Button>
      <NameField label="Right folder" value={s.rightName} other={s.leftName} backup={backup} editable={editNames} onValid={(right) => dispatch(destinationNamesSet({ right }))} />
      <Button disabled={idle} onClick={() => void dispatch(resetDestination('right'))}>
        Reset {s.rightName}
      </Button>
      <Tooltip title="Auto-advance [S]">
        <IconButton aria-label={s.timer.running ? 'Pause timer' : 'Start timer'} onClick={() => dispatch(timerChanged({ running: !s.timer.running }))}>
          {s.timer.running ? <PauseIcon /> : <PlayArrowIcon />}
        </IconButton>
      </Tooltip>
      <Typography component="span" data-testid="timer-interval" onWheel={onWheel} sx={{ minWidth: 56, textAlign: 'center', userSelect: 'none' }}>
        {formatInterval(s.timer.intervalMs)}
      </Typography>
      <Select size="small" value={s.timer.action} displayEmpty inputProps={{ 'aria-label': 'Timer action' }} onChange={(e) => dispatch(timerChanged({ action: e.target.value as '' | 'L' | 'R' }))}>
        <MenuItem value="">(advance only)</MenuItem>
        <MenuItem value="L">{s.leftName}</MenuItem>
        <MenuItem value="R">{s.rightName}</MenuItem>
      </Select>
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', width: '100%' }}>
        {s.quickCrops.map((q) => (
          <Tooltip key={q.id} title={q.crop.crop === null ? '' : `${q.crop.crop.w} x ${q.crop.crop.h}`}>
            <Button size="small" variant="outlined" disabled={idle} onClick={() => q.crop.crop !== null && void dispatch(applyCropRect({ crop: q.crop.crop }))}>
              {q.label}
            </Button>
          </Tooltip>
        ))}
      </Box>
    </Box>
  )
}
