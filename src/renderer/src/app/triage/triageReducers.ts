/**
 * Case reducers shared by the two triage slices (`videoTriageSlice`, `imageTriageSlice`):
 * spread them into `reducers` and export the matching action creators as `TriageActions`.
 */
import type { PayloadAction } from '@reduxjs/toolkit'
import type { Session, SessionItem } from '@shared/domain/session'
import {
  applyUndo,
  closeSession,
  markEdited,
  openSession,
  popDecision,
  recordDecision,
  recordTrash,
  reinsertRestored,
  setCursor,
  type RecordDecisionInput,
  type TriageCoreState
} from './triageCore'

export const triageReducers = {
  sessionOpened(state: TriageCoreState, action: PayloadAction<Session>) {
    openSession(state, action.payload)
  },
  sessionClosed(state: TriageCoreState) {
    closeSession(state)
  },
  /** A move/skip/copy finished in main: update the item, push the decision, advance the cursor. */
  decisionRecorded(state: TriageCoreState, action: PayloadAction<RecordDecisionInput>) {
    recordDecision(state, action.payload)
  },
  trashRecorded(
    state: TriageCoreState,
    action: PayloadAction<{ itemId: string; advance?: boolean }>
  ) {
    recordTrash(state, action.payload.itemId, action.payload.advance ?? true)
  },
  /** Pops the latest decision and puts its item back (main already reversed the file move). */
  undoApplied(state: TriageCoreState, action: PayloadAction<{ restoredPath?: string }>) {
    const decision = popDecision(state)
    if (decision !== null) applyUndo(state, decision, action.payload.restoredPath)
  },
  /** Empty stack: main undid the latest journal entry of the root and returned the item. */
  journalRestored(state: TriageCoreState, action: PayloadAction<SessionItem>) {
    reinsertRestored(state, action.payload)
  },
  cursorSet(state: TriageCoreState, action: PayloadAction<number>) {
    setCursor(state, action.payload)
  },
  /** Crop / rotate / un-crop changed the pixels of one item. */
  itemEdited(state: TriageCoreState, action: PayloadAction<{ itemId: string; version: number }>) {
    markEdited(state, action.payload.itemId, action.payload.version)
  }
}
