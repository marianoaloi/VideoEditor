/**
 * Settings mirror (SPEC §2.1, LEG §11.3). Main owns the file; the renderer keeps the validated
 * copy and updates it with deep-partial patches (`settings:update`). Owner (wave 2): ui-shell.
 */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { Settings, SettingsPatch, SettingsSection } from '@shared/domain/settings'
import { call, toSerializedError, type SerializedError } from '../../app/api'
import { createAppAsyncThunk } from '../../app/thunk'

export type SettingsStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface SettingsState {
  /** `null` until `loadSettings` finished (or `settings:changed` arrived). */
  value: Settings | null
  status: SettingsStatus
  error: SerializedError | null
  saving: boolean
}

const initialState: SettingsState = { value: null, status: 'idle', error: null, saving: false }

export const loadSettings = createAppAsyncThunk(
  'settings/load',
  async (_arg: void, { rejectWithValue }) => {
    try {
      return await call('settings:get')
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

/** `dispatch(updateSettings({ imageTriage: { visibleCount: 7 } }))`; rejects with VALIDATION. */
export const updateSettings = createAppAsyncThunk(
  'settings/update',
  async (patch: SettingsPatch, { rejectWithValue }) => {
    try {
      return await call('settings:update', { patch })
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

export const resetSettings = createAppAsyncThunk(
  'settings/reset',
  async (section: SettingsSection | undefined, { rejectWithValue }) => {
    try {
      return await call('settings:reset', section === undefined ? {} : { section })
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    /** From the `settings:changed` event. */
    settingsReceived(state, action: PayloadAction<Settings>) {
      state.value = action.payload
      state.status = 'ready'
      state.error = null
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadSettings.pending, (state) => {
        state.status = 'loading'
      })
      .addCase(loadSettings.fulfilled, (state, action) => {
        state.value = action.payload
        state.status = 'ready'
        state.error = null
      })
      .addCase(loadSettings.rejected, (state, action) => {
        state.status = 'error'
        state.error = action.payload ?? {
          code: 'INTERNAL',
          message: action.error.message ?? 'Failed'
        }
      })
      .addCase(updateSettings.pending, (state) => {
        state.saving = true
      })
      .addCase(updateSettings.fulfilled, (state, action) => {
        state.saving = false
        state.value = action.payload
        state.error = null
      })
      .addCase(updateSettings.rejected, (state, action) => {
        state.saving = false
        state.error = action.payload ?? {
          code: 'INTERNAL',
          message: action.error.message ?? 'Failed'
        }
      })
      .addCase(resetSettings.fulfilled, (state, action) => {
        state.value = action.payload
        state.error = null
      })
  }
})

export const { settingsReceived } = settingsSlice.actions
export default settingsSlice.reducer
