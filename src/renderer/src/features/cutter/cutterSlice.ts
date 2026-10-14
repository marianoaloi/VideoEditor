/**
 * Cutter state (F5, F6, F7; MyVideos / DialogResume, LEG §4.1-4.2). Owner (wave 2): ui-cutter.
 * One video at a time: open (or drop) a file, edit ranges and overrides, save the job JSON,
 * optionally process it now through the job queue.
 */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { ProcessingMode, type EnqueueOptionsInput, type VideoJob } from '@shared/domain/job'
import type { Range } from '@shared/domain/job'
import type { EditorState } from '@shared/core/rangeEditor'
import { call, toSerializedError, type SerializedError } from '../../app/api'
import {
  createJobDraft,
  toVideoJobDraft,
  type JobDraftOverrides,
  type JobDraftState
} from '../../app/draft'
import { createAppAsyncThunk } from '../../app/thunk'

/** Who opened the Cutter. Anything but `standalone` is the legacy `byChoice` (starts paused). */
export type CutterOrigin = 'standalone' | 'triage' | 'jobs'

/** What the host (Video Triage PageUp, Jobs drop table) learns when the Cutter closes. */
export type CutterResult =
  | { kind: 'cancelled' }
  | { kind: 'saved'; jsonPath: string; posExecution: 1 | 2 }
  | { kind: 'processed'; outputs: string[] }

export interface OpenCutterArg {
  path: string
  origin?: CutterOrigin
  /** Seek here after opening (Video Triage hands over its position). */
  seekMs?: number
  /** `-s <ms>`: one range from here to the end, concat mode. */
  fromMsToEnd?: number
}

/** Open options the screen applies once the duration is known, then clears. */
export interface PendingOpen {
  seekMs: number | null
  fromMsToEnd: number | null
}

export interface ProcessState {
  open: boolean
  /** Run on open: `cut`, `concat` or `cut-nosend` (legacy 'd' / 'f' / 'e'). */
  autoRun: 'cut' | 'concat' | 'cut-nosend' | null
  /** The queued job of the current run. */
  jobId: string | null
  /** Between "Execute" and the job being queued. */
  starting: boolean
}

export interface CutterState {
  videoPath: string | null
  /** Existing `<video>.json` found on open (any legacy format, already converted to v2). */
  loadedJob: VideoJob | null
  draft: JobDraftState
  /** Options for "process now" (the ProcessDialog checkboxes; `concat` is `draft.posExecution`). */
  enqueue: EnqueueOptionsInput
  /** UI-only checkbox "Close when done". */
  closeWhenDone: boolean
  origin: CutterOrigin
  pendingOpen: PendingOpen | null
  selectedIndex: number | null
  process: ProcessState
  jsonPath: string | null
  dirty: boolean
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: SerializedError | null
  result: CutterResult | null
}

const initialState: CutterState = {
  videoPath: null,
  loadedJob: null,
  draft: createJobDraft(),
  enqueue: { upload: true, deleteOriginal: true, ignoreErrors: true, sameSize: false },
  closeWhenDone: true,
  origin: 'standalone',
  pendingOpen: null,
  selectedIndex: null,
  process: { open: false, autoRun: null, jobId: null, starting: false },
  jsonPath: null,
  dirty: false,
  status: 'idle',
  error: null,
  result: null
}

function normaliseArg(arg: string | OpenCutterArg): OpenCutterArg {
  return typeof arg === 'string' ? { path: arg } : arg
}

/** Reads `<video>.json` (v2 or legacy) and seeds the draft from it. */
export const openCutterVideo = createAppAsyncThunk(
  'cutter/openVideo',
  async (arg: string | OpenCutterArg, { rejectWithValue }) => {
    const options = normaliseArg(arg)
    try {
      const read = await call('jobs:readJob', { videoPath: options.path })
      return { options, job: read.job, warnings: read.warnings }
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

/** Ctrl+Shift+O: replaces the ranges and overrides by the ones in `<video>.json` (D14). */
export const reloadCutterTimes = createAppAsyncThunk(
  'cutter/reloadTimes',
  async (_arg: void, { getState, rejectWithValue }) => {
    const { videoPath } = getState().cutter
    if (videoPath === null) return rejectWithValue({ code: 'CONFLICT', message: 'No video is open' })
    try {
      return await call('jobs:readJob', { videoPath })
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

/** Writes the draft as `<video>.json` (`jobs:saveJob`). */
export const saveCutterJob = createAppAsyncThunk(
  'cutter/saveJob',
  async (_arg: void, { getState, rejectWithValue }) => {
    const { videoPath, draft } = getState().cutter
    if (videoPath === null)
      return rejectWithValue({ code: 'CONFLICT', message: 'No video is open' })
    try {
      return await call('jobs:saveJob', { videoPath, job: toVideoJobDraft(draft, videoPath) })
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

/** "Execute": saves the job, then queues it with the dialog's checkboxes (`jobs:enqueueFiles`). */
export const processCutterNow = createAppAsyncThunk(
  'cutter/processNow',
  async (_arg: void, { getState, rejectWithValue }) => {
    const { videoPath, draft, enqueue } = getState().cutter
    if (videoPath === null)
      return rejectWithValue({ code: 'CONFLICT', message: 'No video is open' })
    if (draft.ranges.length === 0)
      return rejectWithValue({ code: 'VALIDATION', message: 'Add at least one range (X)' })
    const hookEnabled = getState().settings.value?.hooks.uploadOutputs.enabled === true
    try {
      const saved = await call('jobs:saveJob', {
        videoPath,
        job: toVideoJobDraft(draft, videoPath)
      })
      const options = { ...enqueue, upload: enqueue.upload === true && hookEnabled }
      const queued = await call('jobs:enqueueFiles', { paths: [videoPath], options })
      return { saved, queued }
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

function draftFromJob(job: VideoJob): JobDraftState {
  const draft = createJobDraft()
  draft.ranges = job.times.map((range): Range => [range[0], range[1]])
  draft.overrides = {
    size: job.size,
    rate: job.rate,
    avgrate: job.avgrate,
    crop: job.crop,
    bright: job.bright,
    contrast: job.contrast,
    transpose: job.transpose
  }
  draft.convert = job.convert
  draft.posExecution = job.posExecution
  return draft
}

function resultOf(state: CutterState): CutterResult {
  if (state.result?.kind === 'processed') return state.result
  if (state.jsonPath !== null && !state.dirty) {
    return { kind: 'saved', jsonPath: state.jsonPath, posExecution: state.draft.posExecution }
  }
  return { kind: 'cancelled' }
}

const cutterSlice = createSlice({
  name: 'cutter',
  initialState,
  reducers: {
    /** Closes the Cutter. `result` stays readable for the host until the next open. */
    cutterClosed(state) {
      return { ...initialState, enqueue: state.enqueue, closeWhenDone: state.closeWhenDone, result: resultOf(state) }
    },
    draftPatched(state, action: PayloadAction<Partial<Omit<JobDraftState, 'overrides'>>>) {
      Object.assign(state.draft, action.payload)
      state.dirty = true
    },
    /** Applies the pure range editor's state (ranges + the frozen start). */
    editorApplied(state, action: PayloadAction<EditorState>) {
      state.draft.ranges = action.payload.ranges.map((range): Range => [range[0], range[1]])
      state.draft.pendingStartMs = action.payload.pendingStartMs
      if (state.selectedIndex !== null && state.selectedIndex >= state.draft.ranges.length) {
        state.selectedIndex = null
      }
      state.dirty = true
    },
    /** Slider handles; not part of the saved job, so they do not dirty it. */
    handlesSet(state, action: PayloadAction<{ low: number; high: number }>) {
      state.draft.low = action.payload.low
      state.draft.high = action.payload.high
    },
    modeSet(state, action: PayloadAction<ProcessingMode>) {
      state.draft.posExecution = action.payload
      state.dirty = true
    },
    selectedSet(state, action: PayloadAction<number | null>) {
      state.selectedIndex = action.payload
    },
    overridesPatched(state, action: PayloadAction<Partial<JobDraftOverrides>>) {
      Object.assign(state.draft.overrides, action.payload)
      state.dirty = true
    },
    enqueueOptionsChanged(state, action: PayloadAction<EnqueueOptionsInput>) {
      state.enqueue = { ...state.enqueue, ...action.payload }
    },
    closeWhenDoneSet(state, action: PayloadAction<boolean>) {
      state.closeWhenDone = action.payload
    },
    openOptionsConsumed(state) {
      state.pendingOpen = null
    },
    processOpened(state, action: PayloadAction<ProcessState['autoRun'] | undefined>) {
      state.process = { open: true, autoRun: action.payload ?? null, jobId: null, starting: false }
      if (action.payload === 'concat') state.draft.posExecution = ProcessingMode.concat
      if (action.payload === 'cut' || action.payload === 'cut-nosend') {
        state.draft.posExecution = ProcessingMode.cut
      }
      if (action.payload === 'cut-nosend') state.enqueue = { ...state.enqueue, upload: false }
    },
    processAutoRunConsumed(state) {
      state.process.autoRun = null
    },
    processClosed(state) {
      state.process = { open: false, autoRun: null, jobId: null, starting: false }
    },
    processFinished(state, action: PayloadAction<string[]>) {
      state.result = { kind: 'processed', outputs: action.payload }
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(openCutterVideo.pending, (state, action) => {
        const options = normaliseArg(action.meta.arg)
        return {
          ...initialState,
          enqueue: state.enqueue,
          closeWhenDone: state.closeWhenDone,
          status: 'loading',
          videoPath: options.path,
          origin: options.origin ?? 'standalone'
        }
      })
      .addCase(openCutterVideo.fulfilled, (state, action) => {
        const { options, job } = action.payload
        if (state.videoPath !== options.path) return
        state.status = 'ready'
        state.loadedJob = job
        state.draft = job === null ? createJobDraft() : draftFromJob(job)
        state.jsonPath = null
        state.dirty = false
        const seekMs = options.seekMs ?? null
        const fromMsToEnd = options.fromMsToEnd ?? null
        state.pendingOpen = seekMs === null && fromMsToEnd === null ? null : { seekMs, fromMsToEnd }
      })
      .addCase(openCutterVideo.rejected, (state, action) => {
        state.status = 'error'
        state.error = action.payload ?? { code: 'INTERNAL', message: 'Could not open the video' }
      })
      .addCase(reloadCutterTimes.fulfilled, (state, action) => {
        const job = action.payload.job
        if (job === null) return
        const handles = { low: state.draft.low, high: state.draft.high }
        state.draft = { ...draftFromJob(job), ...handles }
        state.selectedIndex = null
        state.dirty = false
      })
      .addCase(saveCutterJob.fulfilled, (state, action) => {
        state.jsonPath = action.payload.jsonPath
        state.loadedJob = action.payload.job
        state.dirty = false
      })
      .addCase(processCutterNow.pending, (state) => {
        state.process.starting = true
      })
      .addCase(processCutterNow.fulfilled, (state, action) => {
        state.process.starting = false
        state.process.jobId = action.payload.queued.jobIds[0] ?? null
        state.jsonPath = action.payload.saved.jsonPath
        state.loadedJob = action.payload.saved.job
        state.dirty = false
      })
      .addCase(processCutterNow.rejected, (state) => {
        state.process.starting = false
      })
  }
})

export const {
  cutterClosed,
  draftPatched,
  editorApplied,
  handlesSet,
  modeSet,
  selectedSet,
  overridesPatched,
  enqueueOptionsChanged,
  closeWhenDoneSet,
  openOptionsConsumed,
  processOpened,
  processAutoRunConsumed,
  processClosed,
  processFinished
} = cutterSlice.actions
export default cutterSlice.reducer
