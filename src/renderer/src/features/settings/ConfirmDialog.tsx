/** Confirmation modal; owns the `dialog` keymap scope while open so global keys do not leak. */
import { useEffect } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import { useAppDispatch } from '@renderer/app/hooks'
import { modalClosed, modalOpened } from '@renderer/app/keymap/keymapSlice'

interface Props {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel
}: Props) {
  const dispatch = useAppDispatch()
  useEffect(() => {
    if (!open) return undefined
    dispatch(modalOpened('dialog'))
    return () => void dispatch(modalClosed('dialog'))
  }, [open, dispatch])

  return (
    <Dialog open={open} onClose={onCancel} aria-labelledby="confirm-title">
      <DialogTitle id="confirm-title">{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="contained" onClick={onConfirm} autoFocus>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
