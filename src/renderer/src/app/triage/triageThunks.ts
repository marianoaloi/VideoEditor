/**
 * Thunks shared by both triage workspaces, built once per slice with `createTriageThunks`.
 * They talk to main (`session:*`, `fileops:*`) and keep the decision stack in step (ADR-006).
 *
 * File operations of one workspace run strictly in key order (a promise chain), so fast
 * keystrokes cannot reorder moves or undo a move that has not happened yet.
 */
import type { ActionCreatorWithPayload, ActionCreatorWithoutPayload } from '@reduxjs/toolkit'
import type { Destination } from '@shared/domain/fileops'
import type { OpenFolderRequest, Session, SessionItem } from '@shared/domain/session'
import { ApiError, call, toSerializedError } from '../api'
import { notify } from '../notifications/notify'
import type { RootState } from '../store'
import { createAppAsyncThunk } from '../thunk'
import {
  currentItem,
  indexOfItem,
  peekDecision,
  type RecordDecisionInput,
  type TriageCoreState
} from './triageCore'

export interface TriageActions {
  sessionOpened: ActionCreatorWithPayload<Session>
  sessionClosed: ActionCreatorWithoutPayload
  decisionRecorded: ActionCreatorWithPayload<RecordDecisionInput>
  trashRecorded: ActionCreatorWithPayload<{ itemId: string; advance?: boolean }>
  undoApplied: ActionCreatorWithPayload<{ restoredPath?: string; entryId?: string }>
  journalRestored: ActionCreatorWithPayload<SessionItem>
}

export interface TriageThunkConfig {
  /** Action type prefix, `videoTriage` | `imageTriage`. */
  name: string
  select: (state: RootState) => TriageCoreState
  actions: TriageActions
}

export type MoveKind = 'left' | 'right' | 'custom' | 'folder'

export interface MoveItemArg {
  /** Defaults to the current item. */
  itemId?: string
  kind: MoveKind
  /** Destination folder NAME: required for `folder`; overrides the role for `left`/`right` (image triage names). */
  folder?: string
  /** Advance the cursor after the move (default true). */
  advance?: boolean
}

function destinationFor(arg: MoveItemArg): Destination {
  if (arg.kind === 'folder' || arg.folder !== undefined) {
    if (arg.folder === undefined) throw new Error('A folder name is required for kind "folder"')
    return { type: 'folder', name: arg.folder }
  }
  return { type: 'role', role: arg.kind }
}

export function createTriageThunks(config: TriageThunkConfig) {
  const { name, select, actions } = config
  let chain: Promise<unknown> = Promise.resolve()
  /** Runs `task` after every earlier task of this workspace, whatever their outcome. */
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const result = chain.then(task, task)
    chain = result.catch(() => undefined)
    return result
  }

  /** Opens a folder as the workspace session. */
  const openFolder = createAppAsyncThunk(
    `${name}/openFolder`,
    async (request: OpenFolderRequest, { dispatch, rejectWithValue }) => {
      try {
        const session = await call('session:open', request)
        dispatch(actions.sessionOpened(session))
        return { sessionId: session.id, count: session.items.length }
      } catch (error: unknown) {
        return rejectWithValue(toSerializedError(error))
      }
    }
  )

  /** Closes the session in main (allowlist) and clears the slice. */
  const closeFolder = createAppAsyncThunk(
    `${name}/closeFolder`,
    async (_arg: void, { dispatch, getState, rejectWithValue }) => {
      const { sessionId } = select(getState())
      dispatch(actions.sessionClosed())
      if (sessionId === null) return null
      try {
        await call('session:close', { sessionId })
        return null
      } catch (error: unknown) {
        return rejectWithValue(toSerializedError(error))
      }
    }
  )

  /** `A` / `F` / `C` (and image-triage folder moves): move, journal, push the decision. */
  const moveItem = createAppAsyncThunk(
    `${name}/moveItem`,
    (arg: MoveItemArg, { dispatch, getState, rejectWithValue }) =>
      serial(async () => {
        const state = select(getState())
        const item =
          arg.itemId === undefined
            ? currentItem(state)
            : (state.items[indexOfItem(state, arg.itemId)] ?? null)
        if (state.sessionId === null || item === null) return null
        try {
          const result = await call('fileops:move', {
            sessionId: state.sessionId,
            path: item.path,
            destination: destinationFor(arg)
          })
          dispatch(
            actions.decisionRecorded({
              itemId: item.id,
              kind: arg.kind,
              entryId: result.entry.id,
              folder: arg.folder ?? null,
              newPath: result.newPath,
              advance: arg.advance ?? true,
              ts: result.entry.ts
            })
          )
          return result.newPath
        } catch (error: unknown) {
          return rejectWithValue(toSerializedError(error))
        }
      })
  )

  /** `D` (skip): no file operation, but it is a decision (ADR-006). */
  const skipItem = createAppAsyncThunk(
    `${name}/skipItem`,
    (arg: { itemId?: string } | undefined, { dispatch, getState }) =>
      serial(() => {
        const state = select(getState())
        const item =
          arg?.itemId === undefined
            ? currentItem(state)
            : (state.items[indexOfItem(state, arg.itemId)] ?? null)
        if (item !== null) {
          dispatch(
            actions.decisionRecorded({
              itemId: item.id,
              kind: 'skip',
              entryId: null,
              advance: true
            })
          )
        }
        return Promise.resolve()
      })
  )

  /** `P`: copy to the personal folder. NOT_CONFIGURED is surfaced by the global error listener. */
  const copyToPersonal = createAppAsyncThunk(
    `${name}/copyToPersonal`,
    (arg: { itemId?: string } | undefined, { dispatch, getState, rejectWithValue }) =>
      serial(async () => {
        const state = select(getState())
        const item =
          arg?.itemId === undefined
            ? currentItem(state)
            : (state.items[indexOfItem(state, arg.itemId)] ?? null)
        if (state.sessionId === null || item === null) return null
        try {
          const result = await call('fileops:copyToPersonal', {
            sessionId: state.sessionId,
            path: item.path
          })
          dispatch(
            actions.decisionRecorded({
              itemId: item.id,
              kind: 'personal',
              entryId: result.entry.id,
              advance: false,
              ts: result.entry.ts
            })
          )
          return result.newPath
        } catch (error: unknown) {
          return rejectWithValue(toSerializedError(error))
        }
      })
  )

  /** Shift+Del: send to the trash. Not pushed on the stack, cannot be undone. */
  const trashItem = createAppAsyncThunk(
    `${name}/trashItem`,
    (arg: { itemId?: string } | undefined, { dispatch, getState, rejectWithValue }) =>
      serial(async () => {
        const state = select(getState())
        const item =
          arg?.itemId === undefined
            ? currentItem(state)
            : (state.items[indexOfItem(state, arg.itemId)] ?? null)
        if (state.sessionId === null || item === null) return null
        try {
          await call('fileops:trash', { sessionId: state.sessionId, path: item.path })
          dispatch(actions.trashRecorded({ itemId: item.id }))
          return item.id
        } catch (error: unknown) {
          return rejectWithValue(toSerializedError(error))
        }
      })
  )

  /**
   * `B` / ArrowUp: pop the latest decision (LIFO). Skips and copies need no file move back; a
   * move is reversed through the journal by entry id. With an empty stack the latest journal
   * entry of the root is undone and its item re-inserted (undo across restarts).
   */
  const undo = createAppAsyncThunk(
    `${name}/undo`,
    (_arg: void, { dispatch, getState, rejectWithValue }) =>
      serial(async () => {
        const state = select(getState())
        if (state.sessionId === null) return false
        const decision = peekDecision(state)
        try {
          if (decision === null) {
            const result = await call('fileops:undo', { sessionId: state.sessionId })
            if (result.item !== null) dispatch(actions.journalRestored(result.item))
            return true
          }
          if (decision.kind === 'skip') {
            dispatch(actions.undoApplied({}))
            return true
          }
          if (decision.entryId === null) {
            dispatch(actions.undoApplied({}))
            return true
          }
          const result = await call('fileops:undo', {
            sessionId: state.sessionId,
            entryId: decision.entryId
          })
          dispatch(actions.undoApplied({ restoredPath: result.restoredPath }))
          return true
        } catch (error: unknown) {
          if (error instanceof ApiError && error.code === 'NOTHING_TO_UNDO') {
            dispatch(notify('info', 'Nothing to undo'))
            return false
          }
          return rejectWithValue(toSerializedError(error))
        }
      })
  )

  /**
   * Reverses ONE move by its journal entry id, whatever else was decided since (M1): used when a
   * follow-up step of that move fails (`sendJob` could not write the job JSON).
   */
  const undoEntry = createAppAsyncThunk(
    `${name}/undoEntry`,
    (entryId: string, { dispatch, getState, rejectWithValue }) =>
      serial(async () => {
        const { sessionId } = select(getState())
        if (sessionId === null) return false
        try {
          const result = await call('fileops:undo', { sessionId, entryId })
          dispatch(actions.undoApplied({ restoredPath: result.restoredPath, entryId }))
          return true
        } catch (error: unknown) {
          return rejectWithValue(toSerializedError(error))
        }
      })
  )

  return { openFolder, closeFolder, moveItem, skipItem, copyToPersonal, trashItem, undo, undoEntry }
}
