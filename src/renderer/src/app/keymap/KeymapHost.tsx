/**
 * The only `keydown` listener of the app. Resolves the chord through `resolveBinding` (modal
 * scope first, else the active workspace, then `global`) and registers the `global` bindings:
 * F1 help and Ctrl+1..6 workspace switching.
 */
import { useEffect } from 'react'
import { WORKSPACE_IDS } from '@shared/domain/keymap'
import { useAppDispatch, useAppStore } from '../hooks'
import { eventToChord } from './chord'
import HelpDialog from './HelpDialog'
import { helpToggled, workspaceActivated } from './keymapSlice'
import { isTextInput, WORKSPACE_LABELS } from './hostUtils'
import { resolveBinding } from './registry'
import type { KeyBinding } from './types'
import { useKeymap } from './useKeymap'

export default function KeymapHost() {
  const store = useAppStore()
  const dispatch = useAppDispatch()

  const globalBindings: KeyBinding[] = [
    {
      id: 'global.help',
      keys: ['F1'],
      description: 'Show the shortcuts of this workspace',
      allowInInput: true,
      run: () => void dispatch(helpToggled(undefined))
    },
    ...WORKSPACE_IDS.map(
      (id, index): KeyBinding => ({
        id: `global.go.${id}`,
        keys: [`Ctrl+${String(index + 1)}`],
        description: `Go to ${WORKSPACE_LABELS[id]}`,
        allowInInput: true,
        run: () => void dispatch(workspaceActivated(id))
      })
    )
  ]
  useKeymap('global', globalBindings)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const chord = eventToChord(event)
      if (chord === null) return
      const { activeWorkspace, modalStack } = store.getState().keymap
      const binding = resolveBinding(
        chord,
        { activeWorkspace, modalStack },
        { repeat: event.repeat, inInput: isTextInput(event.target) }
      )
      if (binding === null) return
      event.preventDefault()
      binding.run(event)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [store])

  return <HelpDialog />
}
