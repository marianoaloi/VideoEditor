/** Pure helpers of the Jobs workspace (research ffmpeg-jobs §10-§11): counter, table cells, paths. */
import { basename, dirname } from '@shared/core/paths'
import { formatMillis, formatSize } from '@shared/core/timeFormat'
import type { MediaInfo } from '@shared/domain/media'
import type { JobItem } from './jobsSlice'

export interface QueueCounts {
  running: number
  queued: number
}

export function countJobs(jobs: readonly Pick<JobItem, 'status'>[]): QueueCounts {
  let running = 0
  let queued = 0
  for (const job of jobs) {
    if (job.status === 'running') running += 1
    else if (job.status === 'queued') queued += 1
  }
  return { running, queued }
}

/** The legacy label: `[running] [queued]`. */
export function formatCounter({ running, queued }: QueueCounts): string {
  return `[${String(running)}] [${String(queued)}]`
}

/** Joins with the separator already used by `base` (Windows paths keep `\`). */
export function joinPath(base: string, name: string): string {
  const separator = base.includes('\\') && !base.includes('/') ? '\\' : '/'
  return base.replace(/[\\/]+$/, '') + separator + name
}

/** `root` = the parent when the picked folder is the CUSTOM folder, else the folder itself (§10.1). */
export function resolveRoot(jobsDir: string, customName: string): string {
  return basename(jobsDir) === customName ? dirname(jobsDir) : jobsDir
}

export interface InfoColumns {
  name: string
  size: string
  duration: string
  bitRate: string
  dimensions: string
  frameRate: string
  codec: string
  audio: string
}

const EMPTY_COLUMNS: Omit<InfoColumns, 'name'> = {
  size: '',
  duration: '',
  bitRate: '',
  dimensions: '',
  frameRate: '',
  codec: '',
  audio: ''
}

/** The eight data columns of the drop table; blanks for missing values (legacy parity, §11). */
export function infoColumns(path: string, info: MediaInfo | null): InfoColumns {
  const name = basename(path)
  if (info === null) return { name, ...EMPTY_COLUMNS }
  return {
    name,
    size: formatSize(info.sizeBytes),
    duration: info.durationMs > 0 ? formatMillis(info.durationMs) : '',
    bitRate: info.bitrateKbps === null ? '' : `${String(Math.trunc(info.bitrateKbps))} kbit/s`,
    dimensions: info.hasVideo ? `${String(info.displayWidth)}x${String(info.displayHeight)}` : '',
    frameRate: info.fps === null || info.fps <= 0 ? '' : String(Math.trunc(info.fps)),
    codec: info.videoCodec ?? '',
    audio: info.hasAudio ? (info.audioCodec ?? '') : 'N_aud'
  }
}

/** Last non-empty log line of the first running job: the legacy "FF" label. */
export function lastRunningLine(jobs: readonly Pick<JobItem, 'status' | 'logTail'>[]): string {
  const running = jobs.find((job) => job.status === 'running')
  if (running === undefined) return ''
  for (let i = running.logTail.length - 1; i >= 0; i -= 1) {
    const line = running.logTail[i]
    if (line !== undefined && line.trim() !== '') return line
  }
  return ''
}

/** Queued or running: the states a job can be cancelled in. */
export function isActive(job: Pick<JobItem, 'status'>): boolean {
  return job.status === 'queued' || job.status === 'running'
}
