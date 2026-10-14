/** Renders the notification queue as MUI snackbars, one at a time (oldest first). */
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Snackbar from '@mui/material/Snackbar'
import { useAppDispatch, useAppSelector } from '../hooks'
import { notificationDismissed } from './notificationsSlice'

export default function NotificationsHost() {
  const dispatch = useAppDispatch()
  const current = useAppSelector((state) => state.notifications.queue[0])
  const remaining = useAppSelector((state) => state.notifications.queue.length - 1)
  if (current === undefined) return null

  const dismiss = (_event?: unknown, reason?: string): void => {
    if (reason === 'clickaway') return
    dispatch(notificationDismissed(current.id))
  }

  return (
    <Snackbar
      key={current.id}
      open
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      autoHideDuration={current.autoHideMs}
      onClose={dismiss}
    >
      <Alert
        severity={current.severity}
        variant="filled"
        onClose={() => dismiss()}
        sx={{ maxWidth: 560 }}
      >
        {current.detail === null ? (
          current.message
        ) : (
          <>
            <AlertTitle sx={{ mb: 0 }}>{current.message}</AlertTitle>
            {current.detail}
          </>
        )}
        {remaining > 0 ? ` (+${String(remaining)} more)` : ''}
      </Alert>
    </Snackbar>
  )
}
