/**
 * Operation journal (ADR-006): `<root>/.mediamaloi/journal.jsonl`, one JSON object per line,
 * append-only. "Undone" is derived: an entry is undone when an `undo` entry with `undoOf` = its id exists.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { JournalEntrySchema, type JournalEntry } from '@shared/domain/fileops'
import type { JournalService, MainContext, NewJournalEntry } from '../../ipc/context'
import { JOURNAL_DIR_NAME } from '../session/scan'

export const JOURNAL_FILE_NAME = 'journal.jsonl'

export interface JournalStore extends JournalService {
  /** Appends without emitting `fileops:changed` (batches emit once with `emit`). */
  append(root: string, entry: NewJournalEntry, sessionId: string | null): Promise<JournalEntry>
  emit(root: string, sessionId: string | null, entries: JournalEntry[]): void
  /** Every valid entry, oldest first. */
  readAll(root: string): Promise<JournalEntry[]>
  /** Newest first. */
  list(root: string, limit: number): Promise<JournalEntry[]>
  /** The entry a bare undo would reverse, or null. */
  latestUndoable(root: string): Promise<JournalEntry | null>
  /** Entry by id, with whether it is still undoable (`undoable` and not undone). */
  find(root: string, entryId: string): Promise<{ entry: JournalEntry; reversible: boolean } | null>
}

export function journalPathFor(root: string): string {
  return path.join(root, JOURNAL_DIR_NAME, JOURNAL_FILE_NAME)
}

function parseLines(text: string): JournalEntry[] {
  const entries: JournalEntry[] = []
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      const parsed = JournalEntrySchema.safeParse(JSON.parse(line))
      if (parsed.success) entries.push(parsed.data)
      else console.warn('[journal] skipped an invalid entry')
    } catch {
      console.warn('[journal] skipped an unreadable line')
    }
  }
  return entries
}

function undoneIds(entries: readonly JournalEntry[]): Set<string> {
  const ids = new Set<string>()
  for (const entry of entries) if (entry.op === 'undo' && entry.undoOf !== undefined) ids.add(entry.undoOf)
  return ids
}

const REVERSIBLE_OPS = new Set(['move', 'copy'])

export function createJournal(ctx: MainContext): JournalStore {
  const chains = new Map<string, Promise<unknown>>()

  const append: JournalStore['append'] = async (root, entry, sessionId) => {
    const full: JournalEntry = { ...entry, id: ctx.newId(), ts: Date.now(), sessionId }
    const file = journalPathFor(root)
    const previous = chains.get(root) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        await mkdir(path.dirname(file), { recursive: true })
        await appendFile(file, `${JSON.stringify(full)}\n`, 'utf8')
      })
    chains.set(root, next)
    await next
    return full
  }

  const readAll: JournalStore['readAll'] = async (root) => {
    await (chains.get(root) ?? Promise.resolve()).catch(() => undefined)
    try {
      return parseLines(await readFile(journalPathFor(root), 'utf8'))
    } catch (error) {
      if (Reflect.get(error as object, 'code') === 'ENOENT') return []
      throw error
    }
  }

  const emit: JournalStore['emit'] = (root, sessionId, entries) => {
    if (entries.length > 0) ctx.sendEvent('fileops:changed', { root, sessionId, entries })
  }

  return {
    append,
    emit,
    readAll,
    async record(root, entry, sessionId) {
      const written = await append(root, entry, sessionId)
      emit(root, sessionId, [written])
      return written
    },
    async list(root, limit) {
      return (await readAll(root)).reverse().slice(0, limit)
    },
    async latestUndoable(root) {
      const all = await readAll(root)
      const undone = undoneIds(all)
      for (let i = all.length - 1; i >= 0; i -= 1) {
        const entry = all[i]
        if (entry !== undefined && entry.undoable && REVERSIBLE_OPS.has(entry.op) && !undone.has(entry.id)) {
          return entry
        }
      }
      return null
    },
    async find(root, entryId) {
      const all = await readAll(root)
      const entry = all.find((e) => e.id === entryId)
      if (entry === undefined) return null
      const reversible = entry.undoable && REVERSIBLE_OPS.has(entry.op) && !undoneIds(all).has(entry.id)
      return { entry, reversible }
    }
  }
}
