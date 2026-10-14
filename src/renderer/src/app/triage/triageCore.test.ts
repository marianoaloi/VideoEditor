import { describe, expect, it } from 'vitest'
import type { Session, SessionItem } from '@shared/domain/session'
import {
  applyUndo,
  countByStatus,
  createTriageCore,
  currentItem,
  isEnd,
  nextPendingIndex,
  openSession,
  peekDecision,
  popDecision,
  recordDecision,
  recordTrash,
  reinsertRestored,
  type TriageCoreState
} from './triageCore'

function sessionItem(n: number): SessionItem {
  return {
    id: `i${n}`,
    path: `C:\\r\\v${n}.mp4`,
    relDir: '',
    name: `v${n}.mp4`,
    sizeBytes: 100 - n,
    mtimeMs: 1,
    kind: 'video'
  }
}

function openWith(count: number): TriageCoreState {
  const session: Session = {
    id: 's1',
    root: 'C:\\r',
    recursive: false,
    kind: 'video',
    sort: 'size-desc',
    items: Array.from({ length: count }, (_, n) => sessionItem(n)),
    openedAt: 0,
    skippedDirs: []
  }
  const state = createTriageCore()
  openSession(state, session)
  return state
}

describe('decision stack (ADR-006)', () => {
  it('moves advance the cursor and push decisions', () => {
    const s = openWith(3)
    recordDecision(s, { itemId: 'i0', kind: 'left', entryId: 'e0', newPath: 'C:\\r\\L\\v0.mp4' })
    expect(s.items[0]).toMatchObject({ status: 'left', path: 'C:\\r\\L\\v0.mp4', entryId: 'e0' })
    expect(s.cursor).toBe(1)
    expect(s.decisions).toHaveLength(1)
  })

  it('A, D, B, B: undo is LIFO and returns the cursor to each item', () => {
    const s = openWith(3)
    recordDecision(s, { itemId: 'i0', kind: 'left', entryId: 'e0', newPath: 'C:\\r\\L\\v0.mp4' })
    recordDecision(s, { itemId: 'i1', kind: 'skip', entryId: null })
    expect(s.cursor).toBe(2)

    const first = popDecision(s)
    expect(first?.kind).toBe('skip')
    if (first) applyUndo(s, first)
    expect(s.cursor).toBe(1)
    expect(s.items[1]?.status).toBe('pending')

    const second = popDecision(s)
    expect(second).toMatchObject({ kind: 'left', entryId: 'e0' })
    if (second) applyUndo(s, second, 'C:\\r\\v0 (1).mp4')
    expect(s.cursor).toBe(0)
    expect(s.items[0]).toMatchObject({
      status: 'pending',
      path: 'C:\\r\\v0 (1).mp4',
      entryId: null
    })
    expect(popDecision(s)).toBeNull()
  })

  it('trash is never pushed', () => {
    const s = openWith(2)
    recordTrash(s, 'i0')
    expect(s.items[0]?.status).toBe('trashed')
    expect(s.cursor).toBe(1)
    expect(s.decisions).toHaveLength(0)
    expect(peekDecision(s)).toBeNull()
  })

  it('a personal copy is pushed but leaves the item pending', () => {
    const s = openWith(2)
    recordDecision(s, { itemId: 'i0', kind: 'personal', entryId: 'c1', advance: false })
    expect(s.items[0]?.status).toBe('pending')
    expect(s.cursor).toBe(0)
    const d = popDecision(s)
    if (d) applyUndo(s, d)
    expect(s.items[0]?.status).toBe('pending')
  })

  it('walks over decided items and reports the end', () => {
    const s = openWith(3)
    recordDecision(s, { itemId: 'i1', kind: 'right', entryId: 'e1', newPath: 'x', advance: false })
    expect(nextPendingIndex(s.items, 0)).toBe(2)
    recordDecision(s, { itemId: 'i0', kind: 'skip', entryId: null })
    expect(s.cursor).toBe(2)
    recordDecision(s, { itemId: 'i2', kind: 'left', entryId: 'e2', newPath: 'y' })
    expect(isEnd(s)).toBe(true)
    expect(currentItem(s)).toBeNull()
    expect(countByStatus(s)).toMatchObject({ right: 1, skipped: 1, left: 1, pending: 0 })
  })

  it('re-inserts a journal-restored item at index 0 when the stack was empty', () => {
    const s = openWith(2)
    s.cursor = 1
    reinsertRestored(s, { ...sessionItem(9), path: 'C:\\r\\old.mp4', id: 'i9' })
    expect(s.items[0]).toMatchObject({ id: 'i9', status: 'pending' })
    expect(s.cursor).toBe(0)
    expect(s.items).toHaveLength(3)
  })

  it('reuses the existing item when the restored file is already in the session', () => {
    const s = openWith(2)
    recordDecision(s, { itemId: 'i0', kind: 'left', entryId: 'e0', newPath: 'C:\\r\\L\\v0.mp4' })
    reinsertRestored(s, sessionItem(0))
    expect(s.items).toHaveLength(2)
    expect(s.items[0]).toMatchObject({ status: 'pending', path: 'C:\\r\\v0.mp4' })
    expect(s.cursor).toBe(0)
  })
})
