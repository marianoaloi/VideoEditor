/** Typed `createAsyncThunk` for the app: `rejectWithValue` carries a plain `SerializedError`. */
import { createAsyncThunk } from '@reduxjs/toolkit'
import type { SerializedError } from './api'
import type { AppDispatch, RootState } from './store'

export const createAppAsyncThunk = createAsyncThunk.withTypes<{
  state: RootState
  dispatch: AppDispatch
  rejectValue: SerializedError
}>()
