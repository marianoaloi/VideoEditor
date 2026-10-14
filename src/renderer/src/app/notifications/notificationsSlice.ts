/**
 * Snackbar queue (SPEC §5: errors reach the operator, no silent catch). Owner (wave 2): ui-shell
 * renders it (`NotificationsHost`); everybody else only dispatches `notificationAdded`.
 */
import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit'

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error'

export interface AppNotification {
  id: string
  severity: NotificationSeverity
  message: string
  /** Extra line (e.g. the failing path or the error code). */
  detail: string | null
  /** `null` = stays until dismissed (errors default to this). */
  autoHideMs: number | null
}

export interface NotificationsState {
  queue: AppNotification[]
}

const MAX_QUEUE = 20
const DEFAULT_AUTO_HIDE: Readonly<Record<NotificationSeverity, number | null>> = {
  info: 4000,
  success: 3000,
  warning: 8000,
  error: null
}

export interface NotifyOptions {
  detail?: string
  autoHideMs?: number | null
  id?: string
}

const initialState: NotificationsState = { queue: [] }

const notificationsSlice = createSlice({
  name: 'notifications',
  initialState,
  reducers: {
    notificationAdded: {
      reducer(state, action: PayloadAction<AppNotification>) {
        state.queue = [
          ...state.queue.filter((n) => n.id !== action.payload.id),
          action.payload
        ].slice(-MAX_QUEUE)
      },
      prepare(severity: NotificationSeverity, message: string, options: NotifyOptions = {}) {
        return {
          payload: {
            id: options.id ?? nanoid(),
            severity,
            message,
            detail: options.detail ?? null,
            autoHideMs:
              options.autoHideMs === undefined ? DEFAULT_AUTO_HIDE[severity] : options.autoHideMs
          } satisfies AppNotification
        }
      }
    },
    notificationDismissed(state, action: PayloadAction<string>) {
      state.queue = state.queue.filter((n) => n.id !== action.payload)
    },
    notificationsCleared(state) {
      state.queue = []
    }
  }
})

export const { notificationAdded, notificationDismissed, notificationsCleared } =
  notificationsSlice.actions
export default notificationsSlice.reducer
