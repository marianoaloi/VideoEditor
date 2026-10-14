/**
 * The Redux store: every slice, the listener middleware and the typed helpers.
 *
 *   import { store, startAppListening, type RootState, type AppDispatch } from '@renderer/app/store'
 *
 * Tests build their own store with `createAppStore(preloadedState)`.
 */
import { combineReducers, configureStore } from '@reduxjs/toolkit'
import cutter from '../features/cutter/cutterSlice'
import duplicates from '../features/duplicates/duplicatesSlice'
import imageTriage from '../features/imageTriage/imageTriageSlice'
import jobs from '../features/jobs/jobsSlice'
import settings from '../features/settings/settingsSlice'
import videoTriage from '../features/videoTriage/videoTriageSlice'
import keymap from './keymap/keymapSlice'
import { listenerMiddleware } from './listenerMiddleware'
import mediaInfo from './mediaInfo/mediaInfoSlice'
import notifications from './notifications/notificationsSlice'
import player from './player/playerSlice'

const rootReducer = combineReducers({
  videoTriage,
  imageTriage,
  cutter,
  jobs,
  duplicates,
  settings,
  keymap,
  notifications,
  player,
  mediaInfo
})

export type RootState = ReturnType<typeof rootReducer>

export function createAppStore(preloadedState?: Partial<RootState>) {
  return configureStore({
    reducer: rootReducer,
    ...(preloadedState === undefined ? {} : { preloadedState }),
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().prepend(listenerMiddleware.middleware)
  })
}

export type AppStore = ReturnType<typeof createAppStore>
export type AppDispatch = AppStore['dispatch']

/** Typed `startListening` (side effects: prefetch, timers, error toasts). Register in `features/<ws>/*Listeners.ts`. */
export const startAppListening = listenerMiddleware.startListening.withTypes<
  RootState,
  AppDispatch
>()

export const store = createAppStore()
