/**
 * Job queue mirror (F8, ADR-005). Main owns the queue; the renderer reduces `jobs:event`s into
 * `byId` and keeps only a tail of every log (`jobs:log` returns the full one).
 * Owner (wave 2): ui-shell (Jobs screen). The reducers here are complete.
 */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type {
  EnqueueFilesRequest,
  EnqueueFolderRequest,
  EnqueueOptionsInput,
  JobEvent,
  JobSummary,
  ToolsStatus
} from '@shared/domain/job'
import { call, toSerializedError } from '../../app/api'
import { createAppAsyncThunk } from '../../app/thunk'

export const LOG_TAIL_LINES = 500

export interface JobItem extends JobSummary {
  logTail: string[]
  outTimeMs: number | null
  speed: number | null
  stepIndex: number
  stepCount: number
  durationMs: number | null
}

export interface JobsState {
  byId: Record<string, JobItem>
  /** Queue order (creation order). */
  order: string[]
  selectedId: string | null
  /** Checkboxes of the Jobs screen (DialogResume / ExecuteConfiguratedFiles). */
  options: EnqueueOptionsInput
  tools: ToolsStatus | null
}

const initialState: JobsState = {
  byId: {},
  order: [],
  selectedId: null,
  options: {},
  tools: null
}

function toItem(summary: JobSummary): JobItem {
  return {
    ...summary,
    logTail: [],
    outTimeMs: null,
    speed: null,
    stepIndex: 0,
    stepCount: 1,
    durationMs: null
  }
}

export const loadJobs = createAppAsyncThunk(
  'jobs/load',
  async (_arg: void, { rejectWithValue }) => {
    try {
      return await call('jobs:list')
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

export const enqueueFolder = createAppAsyncThunk(
  'jobs/enqueueFolder',
  async (request: EnqueueFolderRequest, { rejectWithValue }) => {
    try {
      return await call('jobs:enqueueFolder', request)
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

export const enqueueFiles = createAppAsyncThunk(
  'jobs/enqueueFiles',
  async (request: EnqueueFilesRequest, { rejectWithValue }) => {
    try {
      return await call('jobs:enqueueFiles', request)
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

export const cancelJob = createAppAsyncThunk(
  'jobs/cancel',
  async (jobId: string, { rejectWithValue }) => {
    try {
      await call('jobs:cancel', { jobId })
      return null
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

export const clearQueue = createAppAsyncThunk(
  'jobs/clearQueue',
  async (_arg: void, { rejectWithValue }) => {
    try {
      return await call('jobs:clearQueue')
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

export const loadTools = createAppAsyncThunk(
  'jobs/loadTools',
  async (refresh: boolean | undefined, { rejectWithValue }) => {
    try {
      return await call('jobs:tools', { refresh: refresh ?? false })
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

const jobsSlice = createSlice({
  name: 'jobs',
  initialState,
  reducers: {
    jobSelected(state, action: PayloadAction<string | null>) {
      state.selectedId = action.payload
    },
    optionsChanged(state, action: PayloadAction<EnqueueOptionsInput>) {
      state.options = { ...state.options, ...action.payload }
    },
    /** Reduces one `jobs:event`. Events for unknown jobs are ignored (except `queued`). */
    jobEventReceived(state, action: PayloadAction<JobEvent>) {
      const event = action.payload
      if (event.type === 'queued') {
        if (state.byId[event.job.id] === undefined) state.order.push(event.job.id)
        const previous = state.byId[event.job.id]
        state.byId[event.job.id] = { ...toItem(event.job), logTail: previous?.logTail ?? [] }
        return
      }
      const job = state.byId[event.jobId]
      if (job === undefined) return
      switch (event.type) {
        case 'started':
          job.status = 'running'
          job.startedAt = event.at
          break
        case 'progress':
          job.progress = event.progress
          job.stepIndex = event.stepIndex
          job.stepCount = event.stepCount
          job.outTimeMs = event.outTimeMs
          job.speed = event.speed
          break
        case 'log':
          job.logTail.push(...event.lines)
          if (job.logTail.length > LOG_TAIL_LINES) {
            job.logTail.splice(0, job.logTail.length - LOG_TAIL_LINES)
          }
          break
        case 'done':
          job.status = 'done'
          job.progress = 1
          job.outputs = event.outputs
          job.durationMs = event.durationMs
          job.finishedAt = (job.startedAt ?? 0) + event.durationMs
          job.error = null
          break
        case 'error':
          job.status = 'error'
          job.error = event.error
          break
        case 'cancelled':
          job.status = 'cancelled'
          break
      }
    },
    jobsRemoved(state, action: PayloadAction<string[]>) {
      for (const id of action.payload) delete state.byId[id]
      state.order = state.order.filter((id) => state.byId[id] !== undefined)
      if (state.selectedId !== null && state.byId[state.selectedId] === undefined) {
        state.selectedId = null
      }
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadJobs.fulfilled, (state, action) => {
        for (const summary of action.payload) {
          const previous = state.byId[summary.id]
          if (previous === undefined) state.order.push(summary.id)
          state.byId[summary.id] = { ...toItem(summary), logTail: previous?.logTail ?? [] }
        }
      })
      .addCase(loadTools.fulfilled, (state, action) => {
        state.tools = action.payload
      })
  }
})

export const { jobSelected, optionsChanged, jobEventReceived, jobsRemoved } = jobsSlice.actions
export default jobsSlice.reducer
