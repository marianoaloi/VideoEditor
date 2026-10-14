/**
 * Cutter state (F5, F6, F7; MyVideos / DialogResume, LEG §4.1-4.2). Owner (wave 2): ui-cutter.
 * One video at a time: open (or drop) a file, edit ranges and overrides, save the job JSON,
 * optionally process it now through the job queue.
 */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { EnqueueOptionsInput, VideoJob } from '@shared/domain/job'
import { call, toSerializedError, type SerializedError } from '../../app/api'
import {
  createJobDraft,
  toVideoJobDraft,
  type JobDraftOverrides,
  type JobDraftState
} from '../../app/draft'
import { createAppAsyncThunk } from '../../app/thunk'

export interface CutterState {
  videoPath: string | null
  /** Existing `<video>.json` found on open (any legacy format, already converted to v2). */
  loadedJob: VideoJob | null
  draft: JobDraftState
  /** Options for "process now". */
  enqueue: EnqueueOptionsInput
  jsonPath: string | null
  dirty: boolean
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: SerializedError | null
}

const initialState: CutterState = {
  videoPath: null,
  loadedJob: null,
  draft: createJobDraft(),
  enqueue: {},
  jsonPath: null,
  dirty: false,
  status: 'idle',
  error: null
}

/** Reads `<video>.json` (v2 or legacy) and seeds the draft from it. */
export const openCutterVideo = createAppAsyncThunk(
  'cutter/openVideo',
  async (videoPath: string, { rejectWithValue }) => {
    try {
      const read = await call('jobs:readJob', { videoPath })
      return { videoPath, job: read.job, warnings: read.warnings }
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

function draftFromJob(job: VideoJob): JobDraftState {
  const draft = createJobDraft()
  draft.ranges = job.times.map((range) => [range[0], range[1]])
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

const cutterSlice = createSlice({
  name: 'cutter',
  initialState,
  reducers: {
    cutterClosed() {
      return initialState
    },
    draftPatched(state, action: PayloadAction<Partial<Omit<JobDraftState, 'overrides'>>>) {
      Object.assign(state.draft, action.payload)
      state.dirty = true
    },
    overridesPatched(state, action: PayloadAction<Partial<JobDraftOverrides>>) {
      Object.assign(state.draft.overrides, action.payload)
      state.dirty = true
    },
    enqueueOptionsChanged(state, action: PayloadAction<EnqueueOptionsInput>) {
      state.enqueue = { ...state.enqueue, ...action.payload }
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(openCutterVideo.pending, (state, action) => {
        state.status = 'loading'
        state.videoPath = action.meta.arg
        state.error = null
      })
      .addCase(openCutterVideo.fulfilled, (state, action) => {
        state.status = 'ready'
        state.videoPath = action.payload.videoPath
        state.loadedJob = action.payload.job
        state.draft =
          action.payload.job === null ? createJobDraft() : draftFromJob(action.payload.job)
        state.jsonPath = null
        state.dirty = false
      })
      .addCase(openCutterVideo.rejected, (state, action) => {
        state.status = 'error'
        state.error = action.payload ?? { code: 'INTERNAL', message: 'Could not open the video' }
      })
      .addCase(saveCutterJob.fulfilled, (state, action) => {
        state.jsonPath = action.payload.jsonPath
        state.loadedJob = action.payload.job
        state.dirty = false
      })
  }
})

export const { cutterClosed, draftPatched, overridesPatched, enqueueOptionsChanged } =
  cutterSlice.actions
export default cutterSlice.reducer
