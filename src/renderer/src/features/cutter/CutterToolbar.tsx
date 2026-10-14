import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { ProcessingMode } from '@shared/domain/job'
import { useAppSelector } from '../../app/hooks'
import type { CutterActions } from './useCutterActions'

interface CutterToolbarProps {
  actions: CutterActions
  openCrop: () => void
  onClose: () => void
}

/** File and job commands (the legacy File / Video menus and the info button). */
export function CutterToolbar({ actions, openCrop, onClose }: CutterToolbarProps) {
  const { videoPath, draft, dirty } = useAppSelector((s) => s.cutter)
  const open = videoPath !== null
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      <Tooltip title="Open a video (Ctrl+O)">
        <Button size="small" variant="outlined" onClick={() => void actions.openDialog()}>
          Open
        </Button>
      </Tooltip>
      <Tooltip title="Save the job file (Ctrl+S)">
        <span>
          <Button size="small" disabled={!open} onClick={() => void actions.save()}>
            Save
          </Button>
        </span>
      </Tooltip>
      <Tooltip title="Load the saved times (Ctrl+Shift+O)">
        <span>
          <Button size="small" disabled={!open} onClick={() => void actions.loadTimes()}>
            Load times
          </Button>
        </span>
      </Tooltip>
      <Tooltip title="Crop and adjust the picture (Ctrl+Shift+S)">
        <span>
          <Button size="small" disabled={!open} onClick={openCrop}>
            Crop
          </Button>
        </span>
      </Tooltip>
      <Tooltip title="Save the job and process it now (C cut, V concat)">
        <span>
          <Button
            size="small"
            variant="contained"
            disabled={!open || draft.ranges.length === 0}
            onClick={() => void actions.present(draft.posExecution ?? ProcessingMode.cut, false)}
            aria-label="Process"
          >
            Process
          </Button>
        </span>
      </Tooltip>
      <Typography
        variant="body2"
        noWrap
        title={videoPath ?? ''}
        sx={{ flex: 1, minWidth: 0, color: 'text.secondary' }}
      >
        {videoPath ?? 'No video open'}
        {dirty ? ' *' : ''}
      </Typography>
      {open && (
        <Button size="small" onClick={onClose}>
          Close
        </Button>
      )}
    </Box>
  )
}
