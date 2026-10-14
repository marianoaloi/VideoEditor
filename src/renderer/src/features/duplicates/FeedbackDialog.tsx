/** Feedback panel (duplicates-thumbs.md §8.9): unreadable files with "Move to ruim", or exported screen data. */
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import { useEffect } from 'react'
import { useAppDispatch } from '../../app/hooks'
import { modalClosed, modalOpened } from '../../app/keymap/keymapSlice'

export interface FeedbackDialogProps {
  open: boolean
  panel: 'unreadable' | 'export' | null
  /** Unreadable paths, or the export text. */
  text: string
  onClose(): void
  onMoveToRuim(): void
  onCopy(): void
}

export default function FeedbackDialog(props: FeedbackDialogProps) {
  const { open, panel, text, onClose, onMoveToRuim, onCopy } = props
  const dispatch = useAppDispatch()
  useEffect(() => {
    if (!open) return undefined
    dispatch(modalOpened('dialog'))
    return () => {
      dispatch(modalClosed('dialog'))
    }
  }, [open, dispatch])
  const unreadable = panel === 'unreadable'
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{unreadable ? 'Unreadable files' : 'Screen data'}</DialogTitle>
      <DialogContent>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }} data-testid="feedback-text">
          {text === '' ? 'Nothing to report.' : text}
        </pre>
      </DialogContent>
      <DialogActions>
        {unreadable ? (
          <Button onClick={onMoveToRuim} disabled={text === ''}>Move to ruim</Button>
        ) : (
          <Button onClick={onCopy} disabled={text === ''}>Copy</Button>
        )}
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
