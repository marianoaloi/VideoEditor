import { useEffect, useRef } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import LinearProgress from '@mui/material/LinearProgress'
import Typography from '@mui/material/Typography'
import { ProcessingMode } from '@shared/domain/job'
import { call } from '../../app/api'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { modalClosed, modalOpened } from '../../app/keymap/keymapSlice'
import { useKeymap } from '../../app/keymap/useKeymap'
import { notify } from '../../app/notifications/notify'
import { outputNames } from './cutterMath'
import {
  closeWhenDoneSet,
  enqueueOptionsChanged,
  modeSet,
  processAutoRunConsumed,
  processCutterNow,
  processClosed,
  processFinished
} from './cutterSlice'

interface ProcessDialogProps {
  /** Called after the dialog closed because the job finished with "Close when done" on. */
  onFinished: () => void
}

const ACTIVE = new Set(['queued', 'running'])

function useProcessJob() {
  const jobId = useAppSelector((s) => s.cutter.process.jobId)
  return useAppSelector((s) => (jobId === null ? undefined : s.jobs.byId[jobId]))
}

/** "Process Video" (DialogResume): the six checkboxes, the plan, the log and Execute / Close. */
export function ProcessDialog({ onFinished }: ProcessDialogProps) {
  const dispatch = useAppDispatch()
  const cutter = useAppSelector((s) => s.cutter)
  const hookEnabled = useAppSelector((s) => s.settings.value?.hooks.uploadOutputs.enabled === true)
  const job = useProcessJob()
  const { process, draft, enqueue, videoPath } = cutter
  const concat = draft.posExecution === ProcessingMode.concat
  const running = process.starting || (job !== undefined && ACTIVE.has(job.status))
  const canExecute = !running && draft.ranges.length > 0 && videoPath !== null
  const open = process.open

  const execute = (forceConcat?: boolean) => {
    if (!canExecute) return
    if (forceConcat === true && !concat) dispatch(modeSet(ProcessingMode.concat))
    void dispatch(processCutterNow())
  }
  const close = () => {
    if (running && job !== undefined) {
      void call('jobs:cancel', { jobId: job.id }).catch((error: unknown) => {
        dispatch(notify('error', 'Could not cancel the job', { detail: String(error) }))
      })
    }
    dispatch(processClosed())
  }

  useEffect(() => {
    if (!open) return undefined
    dispatch(modalOpened('dialog'))
    return () => {
      dispatch(modalClosed('dialog'))
    }
  }, [open, dispatch])

  const autoRun = process.autoRun
  useEffect(() => {
    if (!open || autoRun === null) return
    dispatch(processAutoRunConsumed())
    if (canExecute) void dispatch(processCutterNow())
  }, [open, autoRun, canExecute, dispatch])

  const status = job?.status
  const outputs = job?.outputs
  useEffect(() => {
    if (!open || status !== 'done') return
    dispatch(processFinished(outputs ?? []))
    if (cutter.closeWhenDone) {
      dispatch(processClosed())
      onFinished()
    }
  }, [open, status, outputs, cutter.closeWhenDone, dispatch, onFinished])

  useKeymap(
    'dialog',
    [
      { id: 'dialog.cutterExecute', keys: ['F', '3'], description: 'Process: execute', run: () => execute() },
      {
        id: 'dialog.cutterConcat',
        keys: ['D', '6'],
        description: 'Process: execute as concat',
        run: () => execute(true)
      },
      { id: 'dialog.cutterClose', keys: ['Escape'], description: 'Process: close', run: close }
    ],
    { enabled: open }
  )

  const names = outputNames(videoPath ?? '', draft.ranges.length, concat)
  return (
    <Dialog open={open} onClose={close} maxWidth="md" fullWidth aria-labelledby="process-title">
      <DialogTitle id="process-title">Process Video</DialogTitle>
      <DialogContent>
        <OptionsGrid hookEnabled={hookEnabled} disabled={running} />
        {draft.ranges.length === 0 && (
          <Alert severity="info" sx={{ my: 1 }}>
            Add at least one range (X) before processing.
          </Alert>
        )}
        <Box aria-label="Plan" sx={{ my: 1 }}>
          <Typography variant="subtitle2">
            {concat ? 'Concat: one output' : `Cut: ${names.length} output(s)`}
            {enqueue.deleteOriginal === true ? ', original goes to the trash afterwards' : ''}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 3, fontFamily: 'monospace', fontSize: 13 }}>
            {names.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </Box>
        </Box>
        {job !== undefined && <JobLog />}
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>Close</Button>
        <Button variant="contained" disabled={!canExecute} onClick={() => execute()}>
          Execute
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function OptionsGrid({ hookEnabled, disabled }: { hookEnabled: boolean; disabled: boolean }) {
  const dispatch = useAppDispatch()
  const { enqueue, closeWhenDone, draft } = useAppSelector((s) => s.cutter)
  const concat = draft.posExecution === ProcessingMode.concat
  const box = (label: string, checked: boolean, onChange: (value: boolean) => void) => (
    <FormControlLabel
      key={label}
      label={label}
      control={
        <Checkbox
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
      }
    />
  )
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2 }}>
      {box('Close when done', closeWhenDone, (v) => dispatch(closeWhenDoneSet(v)))}
      {box('Same size', enqueue.sameSize === true, (v) =>
        dispatch(enqueueOptionsChanged({ sameSize: v }))
      )}
      {box('Ignore ffmpeg warnings', enqueue.ignoreErrors === true, (v) =>
        dispatch(enqueueOptionsChanged({ ignoreErrors: v }))
      )}
      {box('Concat', concat, (v) =>
        dispatch(modeSet(v ? ProcessingMode.concat : ProcessingMode.cut))
      )}
      {box('Delete original', enqueue.deleteOriginal === true, (v) =>
        dispatch(enqueueOptionsChanged({ deleteOriginal: v }))
      )}
      {hookEnabled &&
        box('Upload (hook uploadOutputs)', enqueue.upload === true, (v) =>
          dispatch(enqueueOptionsChanged({ upload: v }))
        )}
    </Box>
  )
}

function JobLog() {
  const job = useProcessJob()
  const logRef = useRef<HTMLPreElement>(null)
  const stuck = useRef(true)
  const lines = job?.logTail.length ?? 0

  useEffect(() => {
    const el = logRef.current
    if (el !== null && stuck.current) el.scrollTop = el.scrollHeight
  }, [lines])

  if (job === undefined) return null
  return (
    <Box sx={{ mt: 1 }}>
      <LinearProgress
        variant="determinate"
        value={Math.round(job.progress * 100)}
        aria-label="Job progress"
      />
      <Typography variant="caption" aria-live="polite">
        {job.status}
        {job.error === null ? '' : `: ${job.error.message}`}
      </Typography>
      <Box
        component="pre"
        ref={logRef}
        aria-label="Job log"
        onScroll={(event) => {
          const el = event.currentTarget
          stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8
        }}
        sx={{ m: 0, mt: 0.5, p: 1, height: 200, overflow: 'auto', fontSize: 12, bgcolor: 'action.hover' }}
      >
        {job.logTail.join('\n')}
      </Box>
      {job.status === 'error' && job.logPath !== null && (
        <Typography variant="caption">Full log: {job.logPath}</Typography>
      )}
    </Box>
  )
}

export default ProcessDialog
