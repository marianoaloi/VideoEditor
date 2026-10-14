/**
 * Duplicate finder state (F10, ADR-007; duplicates-thumbs.md §8). Owner (wave 2): ui-dupes.
 * Rows are the parsed hash CSV; groups are derived with `@shared/core/duplicates` (svc-hash) in
 * selectors, so they are never stored.
 */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type {
  HashBuildRequest,
  HashKey,
  HashKind,
  HashLoadRequest,
  HashProgress,
  HashRow
} from '@shared/domain/hash'
import { call, toSerializedError, type SerializedError } from '../../app/api'
import { keyCounts, type FileFacts } from './grouping'
import { createAppAsyncThunk } from '../../app/thunk'

export interface DuplicatesState {
  kind: HashKind
  /** The folder that was scanned (CSV prefix and location derive from it). */
  dir: string | null
  csvPath: string | null
  rows: HashRow[]
  /** Which of the six keys' groups the table shows. */
  activeKey: HashKey | null
  /** Paths ticked in the table ("Move to R" acts only on these). */
  selectedPaths: string[]
  status: 'idle' | 'loading' | 'building' | 'ready' | 'error'
  /** The running build/rebuild task (for cancel). */
  taskId: string | null
  progress: HashProgress | null
  /** Warning from "Concat other data" (mixed hash origins, ADR-007). */
  warning: string | null
  error: SerializedError | null
  /** Probe results per path (`null` = missing or unreadable); drives ordering and hiding. */
  facts: Record<string, FileFacts | null>
  probing: boolean
  /** Which Feedback panel is open, and the text of the export panel. */
  feedback: 'unreadable' | 'export' | null
  exportText: string
}

/** Keeps the active key while it still has groups, else the first key that has some. */
function keepOrPickKey(current: HashKey | null, rows: HashRow[]): HashKey | null {
  const counts = keyCounts(rows)
  if (current !== null && (counts.find((c) => c.key === current)?.groups ?? 0) > 0) return current
  return counts.find((c) => c.groups > 0)?.key ?? null
}

const initialState: DuplicatesState = {
  kind: 'video',
  dir: null,
  csvPath: null,
  rows: [],
  activeKey: null,
  selectedPaths: [],
  status: 'idle',
  taskId: null,
  progress: null,
  warning: null,
  error: null,
  facts: {},
  probing: false,
  feedback: null,
  exportText: ''
}

/** Loads a CSV. NOT_FOUND means "not built yet": the screen offers to build it. */
export const loadHashTable = createAppAsyncThunk(
  'duplicates/load',
  async (request: HashLoadRequest, { rejectWithValue }) => {
    try {
      return await call('hashing:load', request)
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

/** Scans `dir` and writes the CSV; `rebuild` deletes the old one first. */
export const buildHashTable = createAppAsyncThunk(
  'duplicates/build',
  async (arg: HashBuildRequest & { rebuild?: boolean }, { rejectWithValue }) => {
    const { rebuild, ...request } = arg
    try {
      return await call(rebuild === true ? 'hashing:rebuild' : 'hashing:build', request)
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

export const cancelHashing = createAppAsyncThunk(
  'duplicates/cancel',
  async (taskId: string, { rejectWithValue }) => {
    try {
      await call('hashing:cancel', { taskId })
      return null
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

const duplicatesSlice = createSlice({
  name: 'duplicates',
  initialState,
  reducers: {
    kindChanged(state, action: PayloadAction<HashKind>) {
      state.kind = action.payload
    },
    activeKeyChanged(state, action: PayloadAction<HashKey | null>) {
      state.activeKey = action.payload
      state.selectedPaths = []
    },
    selectionChanged(state, action: PayloadAction<string[]>) {
      state.selectedPaths = action.payload
    },
    /** `hashing:progress` event. */
    progressReceived(state, action: PayloadAction<HashProgress>) {
      if (state.taskId === null || state.taskId === action.payload.taskId) {
        state.progress = action.payload
      }
    },
    /** Rows changed outside the slice (clean, concat, files moved): replace and drop stale ticks. */
    rowsReplaced(
      state,
      action: PayloadAction<{ csvPath: string; rows: HashRow[]; warning?: string | null }>
    ) {
      state.csvPath = action.payload.csvPath
      state.rows = action.payload.rows
      state.warning = action.payload.warning ?? null
      const known = new Set(action.payload.rows.map((row) => row.path))
      state.selectedPaths = state.selectedPaths.filter((p) => known.has(p))
    },
    factsReceived(state, action: PayloadAction<Record<string, FileFacts | null>>) {
      Object.assign(state.facts, action.payload)
    },
    probingChanged(state, action: PayloadAction<boolean>) {
      state.probing = action.payload
    },
    feedbackOpened(state, action: PayloadAction<{ panel: 'unreadable' | 'export'; text?: string }>) {
      state.feedback = action.payload.panel
      if (action.payload.text !== undefined) state.exportText = action.payload.text
    },
    feedbackClosed(state) {
      state.feedback = null
    },
    warningSet(state, action: PayloadAction<string | null>) {
      state.warning = action.payload
    },
    duplicatesReset() {
      return initialState
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadHashTable.pending, (state, action) => {
        state.status = 'loading'
        state.error = null
        const { source } = action.meta.arg
        if ('dir' in source) {
          state.dir = source.dir
          state.kind = source.kind
        }
      })
      .addCase(loadHashTable.fulfilled, (state, action) => {
        state.status = 'ready'
        state.csvPath = action.payload.csvPath
        state.rows = action.payload.rows
        state.selectedPaths = []
        state.facts = {}
        state.activeKey = keepOrPickKey(state.activeKey, action.payload.rows)
      })
      .addCase(loadHashTable.rejected, (state, action) => {
        state.status = 'error'
        state.error = action.payload ?? { code: 'INTERNAL', message: 'Could not load the CSV' }
      })
      .addCase(buildHashTable.pending, (state, action) => {
        state.status = 'building'
        state.taskId = action.meta.arg.taskId
        state.dir = action.meta.arg.dir
        state.kind = action.meta.arg.kind
        state.progress = null
        state.error = null
      })
      .addCase(buildHashTable.fulfilled, (state, action) => {
        state.taskId = null
        state.csvPath = action.payload.csvPath
        state.status = action.payload.cancelled ? 'idle' : 'ready'
      })
      .addCase(buildHashTable.rejected, (state, action) => {
        state.taskId = null
        state.status = 'error'
        state.error = action.payload ?? { code: 'INTERNAL', message: 'Hashing failed' }
      })
  }
})

export const {
  kindChanged,
  activeKeyChanged,
  selectionChanged,
  progressReceived,
  rowsReplaced,
  factsReceived,
  probingChanged,
  feedbackOpened,
  feedbackClosed,
  warningSet,
  duplicatesReset
} = duplicatesSlice.actions
export default duplicatesSlice.reducer
