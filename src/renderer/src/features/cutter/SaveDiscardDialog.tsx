import { useEffect } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import { useAppDispatch } from '../../app/hooks'
import { modalClosed, modalOpened } from '../../app/keymap/keymapSlice'

interface SaveDiscardDialogProps {
  open: boolean
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}

/** Closing with unsaved ranges (assumption A7): Save, Discard or keep editing. */
export function SaveDiscardDialog({ open, onSave, onDiscard, onCancel }: SaveDiscardDialogProps) {
  const dispatch = useAppDispatch()
  useEffect(() => {
    if (!open) return undefined
    dispatch(modalOpened('dialog'))
    return () => {
      dispatch(modalClosed('dialog'))
    }
  }, [open, dispatch])

  return (
    <Dialog open={open} onClose={onCancel} aria-labelledby="save-discard-title">
      <DialogTitle id="save-discard-title">Unsaved ranges</DialogTitle>
      <DialogContent>
        <DialogContentText>
          The ranges of this video are not saved. Save them to the job file before closing?
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Keep editing</Button>
        <Button color="error" onClick={onDiscard}>
          Discard
        </Button>
        <Button variant="contained" onClick={onSave} autoFocus>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}
