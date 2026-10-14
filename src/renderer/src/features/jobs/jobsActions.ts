/**
 * Jobs workspace use cases: batch a folder, process the drop table, fill the table, and the
 * "Clean queue and execute movie" flow (research ffmpeg-jobs §10.7, hooks `moviesL` + `deleteR`).
 */
import { ApiError, call, toSerializedError } from '../../app/api'
import { notify } from '../../app/notifications/notify'
import { createAppAsyncThunk } from '../../app/thunk'
import { DEFAULT_SETTINGS } from '@shared/domain/settings'
import type { EnqueueResult } from '@shared/domain/job'
import { joinPath, resolveRoot } from './jobsLogic'
import { enqueueFiles, enqueueFolder, rowResolved, rowsAdded } from './jobsSlice'

const PROBE_CHUNK = 50

function folderNames(state: { settings: { value: typeof DEFAULT_SETTINGS | null } }) {
  const folders = state.settings.value?.folders ?? DEFAULT_SETTINGS.folders
  return { custom: folders.custom, left: folders.left, right: folders.right }
}

/** Toast text for an enqueue result: how many were queued and why others were skipped. */
export function describeEnqueue(result: EnqueueResult): { message: string; detail?: string } {
  const queued = `Queued ${String(result.jobIds.length)} job${result.jobIds.length === 1 ? '' : 's'}`
  if (result.skipped.length === 0) return { message: queued }
  const detail = result.skipped
    .slice(0, 5)
    .map((s) => `${s.path}: ${s.reason}${s.movedTo === null ? '' : ` (moved to ${s.movedTo})`}`)
    .join('\n')
  return { message: `${queued}, ${String(result.skipped.length)} skipped`, detail }
}

/** Batch every `*.json` of a folder (`force`: re-encode every video of the folder whole). */
export const runFolder = createAppAsyncThunk(
  'jobs/runFolder',
  async (arg: { dir: string; force: boolean }, { dispatch, getState, rejectWithValue }) => {
    const options = getState().jobs.options
    const action = await dispatch(enqueueFolder({ dir: arg.dir, options, force: arg.force }))
    if (enqueueFolder.rejected.match(action)) {
      return rejectWithValue(action.payload ?? toSerializedError(action.error))
    }
    const { message, detail } = describeEnqueue(action.payload)
    dispatch(notify(action.payload.skipped.length > 0 ? 'warning' : 'success', message, detail === undefined ? {} : { detail }))
    return action.payload
  }
)

/** "Process All": rows with a JSON run as their job, the others as a whole-video job. */
export const processRows = createAppAsyncThunk(
  'jobs/processRows',
  async (_arg: void, { dispatch, getState, rejectWithValue }) => {
    const { rows, options } = getState().jobs
    const ready = rows.filter((row) => row.status === 'ready')
    const groups = [
      { force: false, paths: ready.filter((r) => r.hasJson === true).map((r) => r.path) },
      { force: true, paths: ready.filter((r) => r.hasJson !== true).map((r) => r.path) }
    ].filter((group) => group.paths.length > 0)
    if (groups.length === 0) {
      dispatch(notify('info', 'No video to process in the table'))
      return 0
    }
    let queued = 0
    for (const group of groups) {
      const action = await dispatch(enqueueFiles({ paths: group.paths, options, force: group.force }))
      if (enqueueFiles.rejected.match(action)) {
        return rejectWithValue(action.payload ?? toSerializedError(action.error))
      }
      queued += action.payload.jobIds.length
      const { message, detail } = describeEnqueue(action.payload)
      dispatch(notify(action.payload.skipped.length > 0 ? 'warning' : 'success', message, detail === undefined ? {} : { detail }))
    }
    return queued
  }
)

async function resolveRow(path: string): Promise<Parameters<typeof rowResolved>[0]> {
  const [probe, read] = await Promise.allSettled([
    call('media:probe', { path }),
    call('jobs:readJob', { videoPath: path })
  ])
  const hasJson = read.status === 'fulfilled' ? read.value.found : null
  if (probe.status === 'fulfilled') return { path, info: probe.value, error: null, hasJson }
  const message = probe.reason instanceof Error ? probe.reason.message : String(probe.reason)
  return { path, info: null, error: message, hasJson }
}

/** Adds videos to the table and fills their ffprobe columns in small parallel chunks. */
export const addVideos = createAppAsyncThunk(
  'jobs/addVideos',
  async (paths: string[], { dispatch, getState }) => {
    const before = new Set(getState().jobs.rows.map((r) => r.path))
    const fresh = [...new Set(paths)].filter((p) => !before.has(p))
    dispatch(rowsAdded(fresh))
    for (let i = 0; i < fresh.length; i += PROBE_CHUNK) {
      const chunk = fresh.slice(i, i + PROBE_CHUNK)
      const resolved = await Promise.all(chunk.map(resolveRow))
      for (const row of resolved) dispatch(rowResolved(row))
    }
    return fresh.length
  }
)

export interface MoviesOutcome {
  root: string
  precleaned: number
  moviesStarted: boolean
}

/**
 * "Clean queue and execute movie": cancel the queue, trash zero-byte files and logs of `L/`,
 * run `moviesL` on `L/` when it exists, then `deleteR` (built-in trash of the `R/` files).
 */
export const cleanAndExecuteMovie = createAppAsyncThunk(
  'jobs/cleanAndExecuteMovie',
  async (jobsDir: string, { dispatch, getState, rejectWithValue }) => {
    const names = folderNames(getState())
    const root = resolveRoot(jobsDir, names.custom)
    const left = joinPath(root, names.left)
    try {
      const cleared = await call('jobs:clearQueue')
      const session = await call('session:open', { dir: root, kind: 'any', recursive: false })
      let precleaned = 0
      let leftExists = true
      try {
        precleaned = (await call('fileops:preclean', { sessionId: session.id, folder: names.left })).trashed.length
      } catch (error: unknown) {
        if (!(error instanceof ApiError) || error.code !== 'NOT_FOUND') throw error
        leftExists = false
      } finally {
        await call('session:close', { sessionId: session.id })
      }
      if (leftExists) await call('hooks:run', { name: 'moviesL', context: { dir: left, root } })
      else dispatch(notify('warning', `Folder ${left} does not exist; movie not started`))
      await call('hooks:run', { name: 'deleteR', context: { dir: joinPath(root, names.right), root } })
      dispatch(
        notify('info', `Queue cleared (${String(cleared.cancelled)} cancelled), ${String(precleaned)} empty/log files trashed`)
      )
      return { root, precleaned, moviesStarted: leftExists } satisfies MoviesOutcome
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)
