/** Shows the log attached to an error toast. Owns the `dialog` keymap scope while open. */
import { useEffect, useState } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import { useAppDispatch } from '../hooks'
import { modalClosed, modalOpened } from '../keymap/keymapSlice'

interface Props {
  open: boolean
  title: string
  log: string
  onClose: () => void
}

export default function LogDialog({ open, title, log, onClose }: Props) {
  const dispatch = useAppDispatch()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (!open) return undefined
    dispatch(modalOpened('dialog'))
    setCopyState('idle')
    return () => void dispatch(modalClosed('dialog'))
  }, [open, dispatch])

  const copy = (): void => {
    navigator.clipboard.writeText(log).then(
      () => setCopyState('copied'),
      () => setCopyState('failed')
    )
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth aria-labelledby="log-title">
      <DialogTitle id="log-title">{title}</DialogTitle>
      <DialogContent dividers>
        <pre
          data-testid="log-text"
          style={{
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'Consolas, "Courier New", monospace',
            fontSize: 13,
            userSelect: 'text'
          }}
        >
          {log}
        </pre>
      </DialogContent>
      <DialogActions>
        {copyState === 'copied' && <span role="status">Copied</span>}
        {copyState === 'failed' && (
          <span role="status">Copy failed: select the text and press Ctrl+C</span>
        )}
        <Button onClick={copy}>Copy</Button>
        <Button onClick={onClose} autoFocus>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}
