/** Queue table, per-job progress and the log view of the selected job. */
import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import LinearProgress from '@mui/material/LinearProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { call } from '@renderer/app/api'
import { useAppDispatch, useAppSelector } from '@renderer/app/hooks'
import { useNotify } from '@renderer/app/notifications/notify'
import { basename } from '@shared/core/paths'
import type { JobStatus } from '@shared/domain/job'
import { isActive } from './jobsLogic'
import { cancelJob, enqueueFiles, jobSelected, type JobItem } from './jobsSlice'

const STATUS_COLOR: Record<JobStatus, 'default' | 'primary' | 'success' | 'error' | 'warning'> = {
  queued: 'default',
  running: 'primary',
  done: 'success',
  error: 'error',
  cancelled: 'warning'
}

function LogView({ job }: { job: JobItem }) {
  const toast = useNotify()
  const [full, setFull] = useState<{ jobId: string; lines: string[] } | null>(null)
  useEffect(() => setFull(null), [job.id])
  const lines = full?.jobId === job.id ? full.lines : job.logTail
  const loadFull = (): void => {
    call('jobs:log', { jobId: job.id })
      .then((result) => setFull({ jobId: job.id, lines: result.lines }))
      .catch((error: unknown) => toast.apiError(error, 'Reading the log'))
  }
  return (
    <Paper variant="outlined" sx={{ p: 1, mt: 1 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }} noWrap>
          Log: {basename(job.videoPath)}
        </Typography>
        <Button onClick={loadFull}>Load full log</Button>
      </Stack>
      {job.error === null ? null : (
        <Alert severity="error" sx={{ my: 1 }}>
          {job.error.message}
        </Alert>
      )}
      <Box
        component="pre"
        aria-label="Job log"
        sx={{ m: 0, mt: 1, maxHeight: 220, overflow: 'auto', fontFamily: 'monospace', fontSize: 12 }}
      >
        {lines.length === 0 ? '(no output yet)' : lines.join('\n')}
      </Box>
    </Paper>
  )
}

export default function JobQueue() {
  const dispatch = useAppDispatch()
  const byId = useAppSelector((state) => state.jobs.byId)
  const order = useAppSelector((state) => state.jobs.order)
  const selectedId = useAppSelector((state) => state.jobs.selectedId)
  const options = useAppSelector((state) => state.jobs.options)
  const jobs = order.map((id) => byId[id]).filter((job): job is JobItem => job !== undefined)
  const selected = selectedId === null ? undefined : byId[selectedId]

  const reprocess = (job: JobItem): void =>
    void dispatch(
      enqueueFiles({ paths: [job.videoPath], options: { ...job.options, ...options }, force: job.jsonPath === null })
    )

  return (
    <Box>
      <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 280 }}>
        <Table stickyHeader aria-label="Job queue">
          <TableHead>
            <TableRow>
              <TableCell>Video</TableCell>
              <TableCell>Status</TableCell>
              <TableCell sx={{ width: 220 }}>Progress</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {jobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4}>No jobs yet</TableCell>
              </TableRow>
            ) : null}
            {jobs.map((job) => (
              <TableRow
                key={job.id}
                hover
                selected={job.id === selectedId}
                onClick={() => dispatch(jobSelected(job.id))}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell title={job.videoPath}>
                  {basename(job.videoPath)} {job.mode === 2 ? '(concat)' : ''}
                </TableCell>
                <TableCell>
                  <Chip label={job.status} color={STATUS_COLOR[job.status]} />
                </TableCell>
                <TableCell>
                  <LinearProgress
                    variant="determinate"
                    value={Math.round(job.progress * 100)}
                    aria-label={`Progress of ${basename(job.videoPath)}`}
                  />
                  <Typography variant="caption">
                    {Math.round(job.progress * 100)}%
                    {job.stepCount > 1 ? ` step ${String(job.stepIndex + 1)}/${String(job.stepCount)}` : ''}
                    {job.speed === null ? '' : ` ${job.speed.toFixed(1)}x`}
                  </Typography>
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  {isActive(job) ? (
                    <Button
                      onClick={(e) => {
                        e.stopPropagation()
                        void dispatch(cancelJob(job.id))
                      }}
                    >
                      Cancel
                    </Button>
                  ) : (
                    <Button
                      onClick={(e) => {
                        e.stopPropagation()
                        reprocess(job)
                      }}
                    >
                      Reprocess
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {selected === undefined ? null : <LogView job={selected} />}
    </Box>
  )
}
