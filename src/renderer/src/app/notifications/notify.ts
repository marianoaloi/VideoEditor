/**
 * Raising notifications.
 *
 *   dispatch(notify('error', 'Could not move the file', { detail: path }))   // thunks, listeners
 *   const toast = useNotify(); toast.error('Saved failed', { detail })       // components
 *   dispatch(notifyApiError(error, 'Opening the folder'))                    // catch blocks
 */
import { useMemo } from 'react'
import { ApiError } from '../api'
import { useAppDispatch } from '../hooks'
import {
  notificationAdded,
  type NotificationSeverity,
  type NotifyOptions
} from './notificationsSlice'

/** Action creator: `dispatch(notify(severity, message, options))`. */
export function notify(severity: NotificationSeverity, message: string, options?: NotifyOptions) {
  return notificationAdded(severity, message, options)
}

/** Turns anything thrown (usually an `ApiError`) into an error notification. Never silent. */
export function notifyApiError(error: unknown, context?: string) {
  const message = error instanceof Error ? error.message : String(error)
  const code = error instanceof ApiError ? error.code : null
  const text = context === undefined ? message : `${context}: ${message}`
  return notificationAdded('error', text, code === null ? {} : { detail: code })
}

export interface Notifier {
  info(message: string, options?: NotifyOptions): void
  success(message: string, options?: NotifyOptions): void
  warning(message: string, options?: NotifyOptions): void
  error(message: string, options?: NotifyOptions): void
  /** `catch (e) { toast.apiError(e, 'Saving the job') }` */
  apiError(error: unknown, context?: string): void
}

export function useNotify(): Notifier {
  const dispatch = useAppDispatch()
  return useMemo<Notifier>(
    () => ({
      info: (m, o) => void dispatch(notify('info', m, o)),
      success: (m, o) => void dispatch(notify('success', m, o)),
      warning: (m, o) => void dispatch(notify('warning', m, o)),
      error: (m, o) => void dispatch(notify('error', m, o)),
      apiError: (e, c) => void dispatch(notifyApiError(e, c))
    }),
    [dispatch]
  )
}
