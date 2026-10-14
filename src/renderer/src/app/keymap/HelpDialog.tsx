/**
 * F1 help: the bindings of the active workspace and of `global`, with conflict warnings.
 * While open it owns the `help` modal scope (Escape or F1 close it).
 */
import { useEffect, useMemo } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import type { Binding, KeymapScope } from '@shared/domain/keymap'
import { useAppDispatch, useAppSelector } from '../hooks'
import { bindingsFor, relevantConflicts } from './helpModel'
import { helpToggled, modalClosed, modalOpened } from './keymapSlice'
import { useKeymap } from './useKeymap'

function ScopeTable({ scope, rows }: { scope: KeymapScope; rows: Binding[] }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2">{scope}</Typography>
      <Table size="small" aria-label={`${scope} shortcuts`}>
        <TableBody>
          {rows.map((binding) => (
            <TableRow key={binding.id}>
              <TableCell sx={{ whiteSpace: 'nowrap', width: 1 }}>
                {binding.keys.map((key) => (
                  <Chip key={key} label={key} sx={{ mr: 0.5, fontFamily: 'monospace' }} />
                ))}
              </TableCell>
              <TableCell>{binding.description}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  )
}

export default function HelpDialog() {
  const dispatch = useAppDispatch()
  const open = useAppSelector((state) => state.keymap.helpOpen)
  const active = useAppSelector((state) => state.keymap.activeWorkspace)
  const bindings = useAppSelector((state) => state.keymap.bindings)
  const close = (): void => void dispatch(helpToggled(false))

  useEffect(() => {
    if (!open) return undefined
    dispatch(modalOpened('help'))
    return () => void dispatch(modalClosed('help'))
  }, [open, dispatch])

  useKeymap(
    'help',
    [{ id: 'help.close', keys: ['Escape', 'F1'], description: 'Close this help', run: close }],
    { enabled: open }
  )

  const scopes = useMemo<KeymapScope[]>(() => [active, 'global'], [active])
  const conflicts = useMemo(() => relevantConflicts(bindings, scopes), [bindings, scopes])

  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth aria-labelledby="help-title">
      <DialogTitle id="help-title">Keyboard shortcuts</DialogTitle>
      <DialogContent dividers>
        {conflicts.map((conflict) => (
          <Alert key={`${conflict.scope}:${conflict.chord}`} severity="warning" sx={{ mb: 1 }}>
            {conflict.chord} is bound more than once ({conflict.bindingIds.join(', ')})
          </Alert>
        ))}
        {scopes.map((scope) => {
          const rows = bindingsFor(bindings, scope)
          return rows.length === 0 ? null : <ScopeTable key={scope} scope={scope} rows={rows} />
        })}
      </DialogContent>
    </Dialog>
  )
}
