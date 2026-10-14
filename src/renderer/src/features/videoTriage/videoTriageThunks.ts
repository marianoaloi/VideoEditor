/**
 * Video Triage actions that combine the shared triage thunks with the job draft:
 * decisions (remember the playhead for PageUp), `C` / `V` / `Ctrl+Shift+C` / Save Time (move to
 * CUSTOM, then write `<video>.json`; roll the move back when the write fails, §9), sidecar loading,
 * hand-offs to the Cutter, Jobs and the external-player hook.
 */
import { resolveJobTimes, wholeVideoTimes } from '@shared/core/jobDraft'
import { basename } from '@shared/core/paths'
import { ProcessingMode, type Range } from '@shared/domain/job'
import { call, toSerializedError } from '../../app/api'
import { toVideoJobDraft, type JobDraftOverrides, type JobDraftState } from '../../app/draft'
import { workspaceActivated } from '../../app/keymap/keymapSlice'
import { notify } from '../../app/notifications/notify'
import { currentItem, peekDecision, indexOfItem } from '../../app/triage/triageCore'
import type { RootState } from '../../app/store'
import { createAppAsyncThunk } from '../../app/thunk'
import { openCutterVideo, draftPatched as cutterDraftPatched } from '../cutter/cutterSlice'
import { enqueueFolder } from '../jobs/jobsSlice'
import {
  itemActivated,
  positionRemembered,
  sidecarLoaded,
  videoTriageThunks
} from './videoTriageSlice'

/** `A` / `F` / `D`: remember where the playhead was, then run the shared thunk. */
export const decide = createAppAsyncThunk(
  'videoTriage/decide',
  (arg: { kind: 'left' | 'right' | 'skip' }, { dispatch, getState }) => {
    const state = getState()
    const item = currentItem(state.videoTriage)
    if (item === null) return null
    dispatch(positionRemembered({ itemId: item.id, positionMs: state.player.positionMs }))
    if (arg.kind === 'skip') return dispatch(videoTriageThunks.skipItem(undefined)).then(() => null)
    return dispatch(videoTriageThunks.moveItem({ kind: arg.kind })).then(() => null)
  }
)

export interface SendJobArg {
  mode: ProcessingMode
  /** `Ctrl+Shift+C`: the whole video, ranges ignored. */
  whole?: boolean
  /** `Ctrl+Shift+X`: force the convert pre-step for this job. */
  convert?: boolean
}

/** Duration of the current item: the probe when ready, else what the player reported. */
function durationOf(state: RootState): number {
  const item = state.videoTriage.items[state.videoTriage.cursor]
  const entry = item === undefined ? undefined : state.mediaInfo.byPath[item.path]
  if (entry?.status === 'ready' && entry.info.durationMs > 0) return entry.info.durationMs
  return state.player.durationMs
}

function jobDraftFor(draft: JobDraftState, times: Range[], arg: SendJobArg): JobDraftState {
  return {
    ...draft,
    ranges: times,
    posExecution: arg.mode,
    convert: arg.convert ?? draft.convert
  }
}

/**
 * `C` / `V` / `Ctrl+Shift+C` / `Ctrl+Shift+X`: validate, move the video to CUSTOM, write the job
 * JSON next to it. A failed write moves the video back (journal undo) and reports the error.
 * Resolves with the JSON path, or `null` when nothing happened.
 */
export const sendJob = createAppAsyncThunk(
  'videoTriage/sendJob',
  async (arg: SendJobArg, { dispatch, getState, rejectWithValue }) => {
    const state = getState()
    const item = currentItem(state.videoTriage)
    if (item === null || state.videoTriage.sessionId === null) return null
    const { draft } = state.videoTriage
    const times =
      arg.whole === true
        ? { ok: true as const, times: wholeVideoTimes(durationOf(state)) }
        : resolveJobTimes(draft.ranges, draft, arg.mode === ProcessingMode.concat)
    if (!times.ok) {
      dispatch(notify('warning', times.message))
      return null
    }
    const job = toVideoJobDraft(jobDraftFor(draft, times.times, arg), item.originalPath)
    dispatch(positionRemembered({ itemId: item.id, positionMs: state.player.positionMs }))
    const moved = await dispatch(videoTriageThunks.moveItem({ kind: 'custom' }))
    if (typeof moved.payload !== 'string') return null
    try {
      const saved = await call('jobs:saveJob', { videoPath: moved.payload, job })
      dispatch(notify('success', `Job saved for ${basename(moved.payload)}`, { autoHideMs: 2500 }))
      return saved.jsonPath
    } catch (error: unknown) {
      await dispatch(videoTriageThunks.undo())
      return rejectWithValue(toSerializedError(error))
    }
  }
)

/** File > Save Time: write `<current file>.json` next to the file, no move (§6). */
export const saveTime = createAppAsyncThunk(
  'videoTriage/saveTime',
  async (_arg: void, { dispatch, getState, rejectWithValue }) => {
    const state = getState()
    const item = currentItem(state.videoTriage)
    if (item === null) return null
    const { draft } = state.videoTriage
    const times = resolveJobTimes(draft.ranges, draft, false)
    if (!times.ok) {
      dispatch(notify('warning', times.message))
      return null
    }
    const job = toVideoJobDraft(
      jobDraftFor(draft, times.times, { mode: ProcessingMode.cut }),
      item.originalPath
    )
    try {
      const saved = await call('jobs:saveJob', { videoPath: item.path, job })
      dispatch(notify('success', `Saved ${basename(saved.jsonPath)}`, { autoHideMs: 2500 }))
      return saved.jsonPath
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

/** Loads the sidecar of the current item (ranges, overrides) after `itemActivated`. */
export const loadSidecar = createAppAsyncThunk(
  'videoTriage/loadSidecar',
  async (itemId: string, { dispatch, getState, rejectWithValue }) => {
    const item = getState().videoTriage.items.find((candidate) => candidate.id === itemId)
    if (item === undefined) return null
    try {
      const read = await call('jobs:readJob', { videoPath: item.path })
      for (const warning of read.warnings) dispatch(notify('warning', warning))
      const current = currentItem(getState().videoTriage)
      if (!read.found || read.job === null || current?.id !== itemId) return null
      const overrides: Partial<JobDraftOverrides> = {
        size: read.job.size,
        rate: read.job.rate,
        avgrate: read.job.avgrate,
        crop: read.job.crop,
        bright: read.job.bright,
        contrast: read.job.contrast,
        transpose: read.job.transpose
      }
      dispatch(sidecarLoaded({ ranges: read.job.times, overrides }))
      return itemId
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

/** Cursor moved: reset the per-item draft and read the sidecar. */
export const activateItem = createAppAsyncThunk(
  'videoTriage/activateItem',
  async (itemId: string, { dispatch }) => {
    dispatch(itemActivated())
    await dispatch(loadSidecar(itemId))
    return itemId
  }
)

/** PageUp: the previous decided item and the playhead it had, handed to the Cutter (§10.1). */
export const openPreviousInCutter = createAppAsyncThunk(
  'videoTriage/openPreviousInCutter',
  async (_arg: void, { dispatch, getState }) => {
    const { videoTriage } = getState()
    const decision = peekDecision(videoTriage)
    const item = decision === null ? undefined : videoTriage.items[indexOfItem(videoTriage, decision.itemId)]
    if (item === undefined) {
      dispatch(notify('info', 'No previous video to open in the Cutter'))
      return null
    }
    const positionMs = videoTriage.positions[item.id] ?? 0
    dispatch(workspaceActivated('cutter'))
    await dispatch(openCutterVideo(item.path))
    if (positionMs > 0) dispatch(cutterDraftPatched({ low: positionMs }))
    return item.path
  }
)

/** "Execute movie": process `<root>/CUSTOM` in the Jobs workspace (§6). */
export const executeCustomFolder = createAppAsyncThunk(
  'videoTriage/executeCustomFolder',
  async (customFolder: string, { dispatch, getState }) => {
    const { root } = getState().videoTriage
    if (root === null) return null
    const separator = root.includes('\\') ? '\\' : '/'
    const dir = `${root.replace(/[\\/]+$/, '')}${separator}${customFolder}`
    dispatch(workspaceActivated('jobs'))
    await dispatch(enqueueFolder({ dir }))
    return dir
  }
)

/** F8 / `+`: the `externalPlayer` hook with the current file. */
export const openExternalPlayer = createAppAsyncThunk(
  'videoTriage/openExternalPlayer',
  async (_arg: void, { dispatch, getState, rejectWithValue }) => {
    const item = currentItem(getState().videoTriage)
    if (item === null) return null
    try {
      const started = await call('hooks:run', { name: 'externalPlayer', context: { file: item.path } })
      if (started.skipped) {
        dispatch(notify('info', 'Set up the "externalPlayer" hook in Settings to use F8'))
      }
      return started.runId
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)
