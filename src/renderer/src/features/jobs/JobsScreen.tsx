/**
 * Jobs workspace (F8, research ffmpeg-jobs §10-§11): batch a folder, reprocess CUSTOM, force
 * (whole video) mode, the drag-and-drop table, the queue with its `[running] [queued]` counter,
 * and "Clean queue and execute movie".
 */
import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { call } from '@renderer/app/api'
import { useAppDispatch, useAppSelector } from '@renderer/app/hooks'
import { useKeymap } from '@renderer/app/keymap/useKeymap'
import { useNotify } from '@renderer/app/notifications/notify'
import type { EnqueueOptionsInput } from '@shared/domain/job'
import { DEFAULT_SETTINGS } from '@shared/domain/settings'
import ConfirmDialog from '../settings/ConfirmDialog'
import DropTable from './DropTable'
import { cleanAndExecuteMovie, runFolder } from './jobsActions'
import { countJobs, formatCounter, isActive, joinPath, lastRunningLine } from './jobsLogic'
import {
  clearQueue,
  jobSelected,
  jobsDirChosen,
  loadJobs,
  optionsChanged,
  cancelJob,
  type JobItem
} from './jobsSlice'
import JobQueue from './JobQueue'

const OPTION_LABELS: readonly { key: keyof EnqueueOptionsInput; label: string }[] = [
  { key: 'upload', label: 'Send each output (upload)' },
  { key: 'uploadAll', label: 'Send the whole batch' },
  { key: 'deleteOriginal', label: 'Delete original' },
  { key: 'ignoreErrors', label: 'Ignore errors' },
  { key: 'sameSize', label: 'Same size' },
  { key: 'keepParts', label: 'Keep parts (concat)' }
]

async function pickDirectory(title: string): Promise<string | null> {
  const result = await call('app:openDirectoryDialog', { title })
  return result.canceled ? null : result.path
}

export default function JobsScreen() {
  const dispatch = useAppDispatch()
  const toast = useNotify()
  const byId = useAppSelector((state) => state.jobs.byId)
  const order = useAppSelector((state) => state.jobs.order)
  const options = useAppSelector((state) => state.jobs.options)
  const selectedId = useAppSelector((state) => state.jobs.selectedId)
  const jobsDir = useAppSelector((state) => state.jobs.jobsDir)
  const customName = useAppSelector(
    (state) => state.settings.value?.folders.custom ?? DEFAULT_SETTINGS.folders.custom
  )
  const [confirmMovie, setConfirmMovie] = useState(false)

  useEffect(() => {
    void dispatch(loadJobs())
  }, [dispatch])

  const jobs = order.map((id) => byId[id]).filter((job): job is JobItem => job !== undefined)
  const counter = formatCounter(countJobs(jobs))
  const ffLine = lastRunningLine(jobs)

  const withDirectory = (title: string, use: (dir: string) => void): void => {
    pickDirectory(title)
      .then((dir) => {
        if (dir !== null) use(dir)
      })
      .catch((error: unknown) => toast.apiError(error, 'Choosing a folder'))
  }
  const batch = (dir: string, force: boolean): void => {
    dispatch(jobsDirChosen(dir))
    void dispatch(runFolder({ dir, force }))
  }
  const pickBatch = (): void => withDirectory('Folder with the job files (*.json)', (dir) => batch(dir, false))
  const reprocessCustom = (): void =>
    withDirectory('Session folder (its CUSTOM folder is reprocessed)', (root) =>
      batch(joinPath(root, customName), false)
    )
  const pickForce = (): void =>
    withDirectory('Folder whose videos are re-encoded whole', (dir) => batch(dir, true))
  const runMovie = (): void => {
    setConfirmMovie(false)
    if (jobsDir !== null) {
      void dispatch(cleanAndExecuteMovie(jobsDir))
      return
    }
    withDirectory('Session folder', (dir) => {
      dispatch(jobsDirChosen(dir))
      void dispatch(cleanAndExecuteMovie(dir))
    })
  }
  const select = (offset: number): void => {
    if (jobs.length === 0) return
    const index = jobs.findIndex((job) => job.id === selectedId)
    const next = Math.min(jobs.length - 1, Math.max(0, index < 0 ? 0 : index + offset))
    const target = jobs[next]
    if (target !== undefined) dispatch(jobSelected(target.id))
  }
  const selected = selectedId === null ? undefined : byId[selectedId]

  useKeymap('jobs', [
    { id: 'jobs.pickFolder', keys: ['Ctrl+O'], description: 'Choose a folder of job files and process it', run: pickBatch },
    { id: 'jobs.reprocessCustom', keys: ['Ctrl+Shift+O'], description: 'Reprocess the CUSTOM folder of a session', run: reprocessCustom },
    { id: 'jobs.forceFolder', keys: ['Ctrl+Shift+F'], description: 'Re-encode whole videos of a folder', run: pickForce },
    { id: 'jobs.cleanMovie', keys: ['Ctrl+Shift+M'], description: 'Clean queue and execute movie', run: () => setConfirmMovie(true), enabled: !confirmMovie },
    { id: 'jobs.previous', keys: ['ArrowUp'], description: 'Select the previous job', run: () => select(-1) },
    { id: 'jobs.next', keys: ['ArrowDown'], description: 'Select the next job', run: () => select(1) },
    {
      id: 'jobs.cancel',
      keys: ['Delete'],
      description: 'Cancel the selected job',
      enabled: selected !== undefined && isActive(selected),
      run: () => {
        if (selectedId !== null) void dispatch(cancelJob(selectedId))
      }
    }
  ])

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Typography variant="h6" component="h1">
          Jobs
        </Typography>
        <Typography variant="h6" component="span" aria-label="Queue counter" sx={{ fontFamily: 'monospace' }}>
          {counter}
        </Typography>
        <Typography variant="body2" color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }} aria-label="Latest ffmpeg output">
          {ffLine}
        </Typography>
      </Stack>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <Button variant="contained" onClick={pickBatch} title="Ctrl+O">
          Choose folder and process
        </Button>
        <Button onClick={reprocessCustom} title="Ctrl+Shift+O">
          Reprocess CUSTOM
        </Button>
        <Button onClick={pickForce} title="Ctrl+Shift+F">
          Re-encode whole videos in folder
        </Button>
        <Button color="warning" onClick={() => setConfirmMovie(true)} title="Ctrl+Shift+M">
          Clean queue and execute movie
        </Button>
        <Button
          onClick={() => void dispatch(clearQueue())}
          disabled={!jobs.some(isActive)}
        >
          Cancel all
        </Button>
      </Stack>
      <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', columnGap: 2 }} role="group" aria-label="Job options">
        {OPTION_LABELS.map(({ key, label }) => (
          <FormControlLabel
            key={key}
            label={label}
            control={
              <Checkbox
                checked={options[key] === true}
                onChange={(e) => dispatch(optionsChanged({ [key]: e.target.checked }))}
              />
            }
          />
        ))}
      </Stack>
      {jobsDir === null ? null : (
        <Typography variant="caption" color="text.secondary">
          Last folder: {jobsDir}
        </Typography>
      )}
      <DropTable />
      <JobQueue />
      <ConfirmDialog
        open={confirmMovie}
        title="Clean queue and execute movie"
        message="This cancels every queued and running job, trashes empty files and logs in L, runs the movie hook on L and then trashes the files of R. Continue?"
        confirmLabel="Run"
        onConfirm={runMovie}
        onCancel={() => setConfirmMovie(false)}
      />
    </Box>
  )
}
