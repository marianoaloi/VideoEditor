/**
 * Keymap UI state: which workspace and modal scopes are active, the registered binding metadata
 * for the F1 help, and conflicts. Handlers themselves live in `registry.ts` (not serialisable).
 * Owner (wave 2): ui-shell.
 */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { Binding, KeymapScope, WorkspaceId } from '@shared/domain/keymap'

export interface KeymapState {
  bindings: Record<string, Binding>
  activeWorkspace: WorkspaceId
  /** Open modal scopes (`crop`, `zoom`, `help`, `dialog`), innermost last. */
  modalStack: KeymapScope[]
  helpOpen: boolean
}

const initialState: KeymapState = {
  bindings: {},
  activeWorkspace: 'videoTriage',
  modalStack: [],
  helpOpen: false
}

const keymapSlice = createSlice({
  name: 'keymap',
  initialState,
  reducers: {
    bindingsRegistered(state, action: PayloadAction<Binding[]>) {
      for (const binding of action.payload) state.bindings[binding.id] = binding
    },
    bindingsUnregistered(state, action: PayloadAction<string[]>) {
      for (const id of action.payload) delete state.bindings[id]
    },
    workspaceActivated(state, action: PayloadAction<WorkspaceId>) {
      state.activeWorkspace = action.payload
    },
    modalOpened(state, action: PayloadAction<KeymapScope>) {
      state.modalStack.push(action.payload)
    },
    modalClosed(state, action: PayloadAction<KeymapScope>) {
      const index = state.modalStack.lastIndexOf(action.payload)
      if (index >= 0) state.modalStack.splice(index, 1)
    },
    helpToggled(state, action: PayloadAction<boolean | undefined>) {
      state.helpOpen = action.payload ?? !state.helpOpen
    }
  }
})

export const {
  bindingsRegistered,
  bindingsUnregistered,
  workspaceActivated,
  modalOpened,
  modalClosed,
  helpToggled
} = keymapSlice.actions
export default keymapSlice.reducer
