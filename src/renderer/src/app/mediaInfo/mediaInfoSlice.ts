/**
 * Probe cache by path (`media:probe`). Prefetched for the next items (settings `thumbs.prefetch`);
 * the info bar and the crop dialog read it. Entries are evicted oldest-first beyond `MAX_ENTRIES`.
 */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { MediaInfo } from '@shared/domain/media'
import { call, toSerializedError, type SerializedError } from '../api'
import { createAppAsyncThunk } from '../thunk'

export const MAX_ENTRIES = 300

export type MediaInfoEntry =
  | { status: 'loading' }
  | { status: 'ready'; info: MediaInfo }
  | { status: 'error'; error: SerializedError }

export interface MediaInfoState {
  byPath: Record<string, MediaInfoEntry>
  /** Insertion order, for eviction. */
  order: string[]
}

const initialState: MediaInfoState = { byPath: {}, order: [] }

/** Probes `path` unless a result or a request already exists. Resolves with the entry. */
export const fetchMediaInfo = createAppAsyncThunk(
  'mediaInfo/fetch',
  async (path: string, { rejectWithValue }) => {
    try {
      return await call('media:probe', { path })
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  },
  {
    condition: (path, { getState }) => getState().mediaInfo.byPath[path] === undefined
  }
)

/** Warms main's caches for the next items; no state change. */
export const prefetchMedia = createAppAsyncThunk(
  'mediaInfo/prefetch',
  async (paths: string[], { rejectWithValue }) => {
    try {
      return await call('media:prefetch', { paths, what: ['probe'] })
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

function remember(state: MediaInfoState, path: string): void {
  if (!state.order.includes(path)) state.order.push(path)
  while (state.order.length > MAX_ENTRIES) {
    const oldest = state.order.shift()
    if (oldest !== undefined) delete state.byPath[oldest]
  }
}

const mediaInfoSlice = createSlice({
  name: 'mediaInfo',
  initialState,
  reducers: {
    /** Forget a path (file edited or moved). */
    mediaInfoInvalidated(state, action: PayloadAction<string>) {
      delete state.byPath[action.payload]
      state.order = state.order.filter((p) => p !== action.payload)
    },
    mediaInfoReceived(state, action: PayloadAction<MediaInfo>) {
      state.byPath[action.payload.path] = { status: 'ready', info: action.payload }
      remember(state, action.payload.path)
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchMediaInfo.pending, (state, action) => {
        state.byPath[action.meta.arg] = { status: 'loading' }
        remember(state, action.meta.arg)
      })
      .addCase(fetchMediaInfo.fulfilled, (state, action) => {
        state.byPath[action.meta.arg] = { status: 'ready', info: action.payload }
      })
      .addCase(fetchMediaInfo.rejected, (state, action) => {
        state.byPath[action.meta.arg] = {
          status: 'error',
          error: action.payload ?? {
            code: 'INTERNAL',
            message: action.error.message ?? 'Probe failed'
          }
        }
      })
  }
})

export const { mediaInfoInvalidated, mediaInfoReceived } = mediaInfoSlice.actions
export default mediaInfoSlice.reducer
