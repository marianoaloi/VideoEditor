/**
 * App start-up wiring (called once from `main.tsx`, outside React):
 *
 *   const dispose = initApp(store)
 *
 * - subscribes to main-process events (events.ts);
 * - turns every rejected thunk that carries a `SerializedError` into an error notification
 *   (SPEC §5: no silent failures), except expected cases listed in `SILENT`;
 * - loads the settings.
 */
import { isRejectedWithValue } from '@reduxjs/toolkit'
import { loadSettings } from '../features/settings/settingsSlice'
import type { SerializedError } from './api'
import { subscribeAppEvents } from './events'
import { listenerMiddleware } from './listenerMiddleware'
import { notify } from './notifications/notify'
import type { AppDispatch, AppStore } from './store'

/** Thunk type prefixes whose failures the screens handle themselves. */
const SILENT_PREFIXES = ['mediaInfo/', 'duplicates/load'] as const
const SILENT_CODES: ReadonlySet<string> = new Set(['CANCELLED'])

function isSerializedError(value: unknown): value is SerializedError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  )
}

export function initApp(store: Pick<AppStore, 'dispatch'>): () => void {
  const dispatch: AppDispatch = store.dispatch
  const offEvents = subscribeAppEvents(dispatch)
  const offErrors = listenerMiddleware.startListening({
    matcher: isRejectedWithValue,
    effect: (action, api) => {
      if (!isSerializedError(action.payload)) return
      if (SILENT_CODES.has(action.payload.code)) return
      if (SILENT_PREFIXES.some((prefix) => action.type.startsWith(prefix))) return
      const { code, message } = action.payload
      api.dispatch(
        notify('error', message, { detail: `${code} (${action.type.replace(/\/rejected$/, '')})` })
      )
    }
  })
  void dispatch(loadSettings())
  return () => {
    offEvents()
    offErrors()
  }
}
