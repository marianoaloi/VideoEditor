/**
 * Session list, cursor and the LIFO decision stack shared by Video Triage and Image Triage
 * (ADR-006, "one undo rule for both workspaces"). The functions MUTATE their state argument: call
 * them from reducers (Immer drafts) or on plain objects in tests.
 *
 * Rules:
 * - every decision is pushed: `left`, `right`, `custom`, `folder`, `skip` (cursor only) and
 *   `personal` (a copy; the item stays where it is);
 * - trash is NOT pushed and can never be undone;
 * - `popDecision` + `applyUndo` reverse the latest decision; an empty stack falls back to the
 *   journal (`fileops:undo` without an entry id), whose result re-inserts the item.
 */
import type { MediaKind } from '@shared/domain/media'
import type { Session, SessionItem } from '@shared/domain/session'

export type DecisionKind = 'left' | 'right' | 'custom' | 'folder' | 'skip' | 'personal'

/** Where an item is now. `pending` items are the ones the cursor walks over. */
export type TriageItemStatus =
  'pending' | 'left' | 'right' | 'custom' | 'folder' | 'skipped' | 'trashed'

export interface TriageItem {
  id: string
  /** Current absolute path (changes when the item is moved). */
  path: string
  /** Path at scan time or after the last undo; undo restores the file here. */
  originalPath: string
  relDir: string
  name: string
  sizeBytes: number
  mtimeMs: number
  kind: MediaKind
  status: TriageItemStatus
  /** Journal entry of the move that put it in `status` (the one to undo); `null` otherwise. */
  entryId: string | null
  /** Image edit counter / mtime used as `?v=` to bust the image cache after crop or rotate. */
  version: number
}

export interface Decision {
  itemId: string
  kind: DecisionKind
  /** Journal entry to reverse; `null` for `skip`. */
  entryId: string | null
  /** Folder name for `kind: 'folder'` (editable image destinations), else `null`. */
  folder: string | null
  ts: number
}

export interface TriageCoreState {
  sessionId: string | null
  root: string | null
  recursive: boolean
  items: TriageItem[]
  /** Index of the current item; `items.length` = end of the list. */
  cursor: number
  decisions: Decision[]
}

export function createTriageCore(): TriageCoreState {
  return { sessionId: null, root: null, recursive: false, items: [], cursor: 0, decisions: [] }
}

export function toTriageItem(item: SessionItem): TriageItem {
  return {
    id: item.id,
    path: item.path,
    originalPath: item.path,
    relDir: item.relDir,
    name: item.name,
    sizeBytes: item.sizeBytes,
    mtimeMs: item.mtimeMs,
    kind: item.kind,
    status: 'pending',
    entryId: null,
    version: item.mtimeMs
  }
}

export function openSession(state: TriageCoreState, session: Session): void {
  state.sessionId = session.id
  state.root = session.root
  state.recursive = session.recursive
  state.items = session.items.map(toTriageItem)
  state.cursor = 0
  state.decisions = []
}

export function closeSession(state: TriageCoreState): void {
  Object.assign(state, createTriageCore())
}

export function indexOfItem(state: TriageCoreState, itemId: string): number {
  return state.items.findIndex((item) => item.id === itemId)
}

/** First `pending` index strictly after `index`, or `items.length`. */
export function nextPendingIndex(items: readonly TriageItem[], index: number): number {
  for (let i = index + 1; i < items.length; i += 1) {
    if (items[i]?.status === 'pending') return i
  }
  return items.length
}

export function currentItem(state: TriageCoreState): TriageItem | null {
  return state.items[state.cursor] ?? null
}

export function isEnd(state: TriageCoreState): boolean {
  return state.cursor >= state.items.length
}

/** Counts for the status line. */
export function countByStatus(state: TriageCoreState): Record<TriageItemStatus, number> {
  const counts: Record<TriageItemStatus, number> = {
    pending: 0,
    left: 0,
    right: 0,
    custom: 0,
    folder: 0,
    skipped: 0,
    trashed: 0
  }
  for (const item of state.items) counts[item.status] += 1
  return counts
}

export interface RecordDecisionInput {
  itemId: string
  kind: DecisionKind
  entryId: string | null
  folder?: string | null
  /** New path for moves (`left|right|custom|folder`). */
  newPath?: string
  /** Move the cursor to the next pending item (default true; image triage clicks on strips pass the clicked index's own advance). */
  advance?: boolean
  ts?: number
}

const STATUS_FOR_KIND: Readonly<Record<DecisionKind, TriageItemStatus | null>> = {
  left: 'left',
  right: 'right',
  custom: 'custom',
  folder: 'folder',
  skip: 'skipped',
  personal: null
}

/** Applies a finished decision and pushes it on the stack. Unknown item ids are ignored. */
export function recordDecision(state: TriageCoreState, input: RecordDecisionInput): void {
  const index = indexOfItem(state, input.itemId)
  const item = state.items[index]
  if (item === undefined) return
  const status = STATUS_FOR_KIND[input.kind]
  if (status !== null) {
    item.status = status
    item.entryId = input.entryId
    if (input.newPath !== undefined) item.path = input.newPath
  }
  state.decisions.push({
    itemId: input.itemId,
    kind: input.kind,
    entryId: input.entryId,
    folder: input.folder ?? null,
    ts: input.ts ?? 0
  })
  if ((input.advance ?? true) && index === state.cursor) {
    state.cursor = nextPendingIndex(state.items, index)
  }
}

/** Shift+Del: marks the item trashed, advances the cursor, pushes nothing (cannot be undone). */
export function recordTrash(state: TriageCoreState, itemId: string, advance = true): void {
  const index = indexOfItem(state, itemId)
  const item = state.items[index]
  if (item === undefined) return
  item.status = 'trashed'
  item.entryId = null
  if (advance && index === state.cursor) state.cursor = nextPendingIndex(state.items, index)
}

/** The decision `B` would reverse, without removing it. */
export function peekDecision(state: TriageCoreState): Decision | null {
  return state.decisions[state.decisions.length - 1] ?? null
}

export function popDecision(state: TriageCoreState): Decision | null {
  return state.decisions.pop() ?? null
}

/** Removes the decision that owns journal entry `entryId`, wherever it sits in the stack. */
export function popDecisionByEntry(state: TriageCoreState, entryId: string): Decision | null {
  const at = state.decisions.findLastIndex((d) => d.entryId === entryId)
  if (at < 0) return null
  return state.decisions.splice(at, 1)[0] ?? null
}

/**
 * Puts the item of an undone decision back: status `pending`, path = `restoredPath` (the file
 * may have been renamed on collision), cursor on it. A `personal` copy changes nothing but the
 * cursor.
 */
export function applyUndo(state: TriageCoreState, decision: Decision, restoredPath?: string): void {
  const index = indexOfItem(state, decision.itemId)
  const item = state.items[index]
  if (item === undefined) return
  if (decision.kind !== 'personal') {
    item.status = 'pending'
    item.entryId = null
    item.path = restoredPath ?? item.originalPath
    item.originalPath = item.path
  }
  state.cursor = index
}

/**
 * Journal fallback (empty stack, e.g. after a restart): the main process undid the latest
 * journal entry of this root. If the restored file belongs to the session it is re-inserted as
 * the current item (index 0 when it is not already in the list).
 */
export function reinsertRestored(state: TriageCoreState, item: SessionItem): void {
  const existing = indexOfItem(state, item.id)
  if (existing >= 0) {
    const current = state.items[existing]
    if (current !== undefined) {
      current.status = 'pending'
      current.entryId = null
      current.path = item.path
      current.originalPath = item.path
    }
    state.cursor = existing
    return
  }
  const byPath = state.items.findIndex((i) => i.path === item.path || i.originalPath === item.path)
  if (byPath >= 0) {
    const current = state.items[byPath]
    if (current !== undefined) {
      current.status = 'pending'
      current.entryId = null
      current.path = item.path
    }
    state.cursor = byPath
    return
  }
  state.items.splice(0, 0, toTriageItem(item))
  state.cursor = 0
}

export function setCursor(state: TriageCoreState, index: number): void {
  state.cursor = Math.max(0, Math.min(index, state.items.length))
}

/** Image edits (crop, rotate, un-crop): same file, new pixels; bumps `version` for `?v=`. */
export function markEdited(state: TriageCoreState, itemId: string, version: number): void {
  const item = state.items[indexOfItem(state, itemId)]
  if (item !== undefined) item.version = version
}
