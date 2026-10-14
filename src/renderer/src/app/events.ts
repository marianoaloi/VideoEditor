/**
 * Routes main-process events into the store. `initApp` (init.ts) subscribes once at startup.
 *
 * Convention: `session:open` requests from a triage workspace pass `requestId` equal to the
 * workspace id (`'videoTriage'` | `'imageTriage'`), so `session:scanProgress` reaches the right slice.
 */
import { jobEventReceived } from '../features/jobs/jobsSlice'
import { progressReceived } from '../features/duplicates/duplicatesSlice'
import { scanProgressed as imageScanProgressed } from '../features/imageTriage/imageTriageSlice'
import { settingsReceived } from '../features/settings/settingsSlice'
import { scanProgressed as videoScanProgressed } from '../features/videoTriage/videoTriageSlice'
import { onEvent } from './api'
import { notify } from './notifications/notify'
import type { AppDispatch } from './store'

export function subscribeAppEvents(dispatch: AppDispatch): () => void {
  const offs = [
    onEvent('jobs:event', (event) => {
      dispatch(jobEventReceived(event))
    }),
    onEvent('settings:changed', (settings) => {
      dispatch(settingsReceived(settings))
    }),
    onEvent('hashing:progress', (progress) => {
      dispatch(progressReceived(progress))
    }),
    onEvent('session:scanProgress', (progress) => {
      if (progress.requestId === 'videoTriage') dispatch(videoScanProgressed(progress))
      else if (progress.requestId === 'imageTriage') dispatch(imageScanProgressed(progress))
    }),
    onEvent('hooks:exit', (exit) => {
      if (exit.error !== null) {
        dispatch(notify('error', `Hook "${exit.name}" failed: ${exit.error.message}`))
      } else if (exit.code !== 0) {
        dispatch(notify('error', `Hook "${exit.name}" exited with code ${String(exit.code)}`))
      } else {
        dispatch(notify('success', `Hook "${exit.name}" finished`))
      }
    })
  ]
  return () => {
    for (const off of offs) off()
  }
}
