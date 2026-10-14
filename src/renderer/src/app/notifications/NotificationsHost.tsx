/** Renders the notification queue as MUI snackbars, one at a time (oldest first). */
import { useState } from 'react'
import CloseIcon from '@mui/icons-material/Close'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import IconButton from '@mui/material/IconButton'
import Snackbar from '@mui/material/Snackbar'
import Tooltip from '@mui/material/Tooltip'
import { useAppDispatch, useAppSelector } from '../hooks'
import LogDialog from './LogDialog'
import { notificationDismissed } from './notificationsSlice'

export default function NotificationsHost() {
  const dispatch = useAppDispatch()
  const current = useAppSelector((state) => state.notifications.queue[0])
  const remaining = useAppSelector((state) => state.notifications.queue.length - 1)
  const [logOpenFor, setLogOpenFor] = useState<string | null>(null)
  if (current === undefined) return null

  const dismiss = (_event?: unknown, reason?: string): void => {
    if (reason === 'clickaway') return
    dispatch(notificationDismissed(current.id))
  }
  const logOpen = current.log !== null && logOpenFor === current.id

  return (
    <>
      <Snackbar
        key={current.id}
        open
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        // The toast stays while its log is being read.
        autoHideDuration={logOpen ? null : current.autoHideMs}
        onClose={dismiss}
      >
        <Alert
          severity={current.severity}
          variant="filled"
          sx={{ maxWidth: 560 }}
          action={
            <>
              {current.log !== null && (
                <Tooltip title="Show the log">
                  <IconButton
                    size="small"
                    color="inherit"
                    aria-label="Show log"
                    onClick={() => setLogOpenFor(current.id)}
                  >
                    <DescriptionOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              <IconButton size="small" color="inherit" aria-label="Close" onClick={() => dismiss()}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </>
          }
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
      {current.log !== null && (
        <LogDialog
          open={logOpen}
          title={`Log: ${current.message}`}
          log={current.log}
          onClose={() => setLogOpenFor(null)}
        />
      )}
    </>
  )
}
