/** Folder-level operations: Reset L/R (image-triage §2.6) and the `L` pre-clean (§7.1). */
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { JournalEntry, MoveManyResult, SidecarMove } from '@shared/domain/fileops'
import { appError, toIpcError } from '../../ipc/errors'
import type { SessionRecord } from '../../ipc/context'
import { longPath, moveEntry, pathExists, uniqueName } from './fsutil'
import type { JournalStore } from './journal'
import { sidecarOf, trashOne, type OpsDeps } from './operations'

async function listEntries(dir: string): Promise<{ name: string; isDir: boolean; size: number }[]> {
  const entries = await readdir(longPath(dir), { withFileTypes: true })
  const result: { name: string; isDir: boolean; size: number }[] = []
  for (const entry of entries) {
    const info = await stat(longPath(path.join(dir, entry.name))).catch(() => null)
    if (info !== null) result.push({ name: entry.name, isDir: info.isDirectory(), size: info.size })
  }
  return result
}

/** Names whose `<name>.json` sibling exists: the sibling travels with them. */
function sidecarNames(names: readonly string[]): Set<string> {
  const all = new Set(names)
  const sidecars = new Set<string>()
  for (const name of names) {
    if (name.endsWith('.json') && all.has(name.slice(0, -'.json'.length))) sidecars.add(name)
  }
  return sidecars
}

/** Every direct entry of `<root>/<folder>` goes back to the root, collision-safe (prefixes stay in the names). */
export async function resetFolder(
  deps: OpsDeps,
  journal: JournalStore,
  session: SessionRecord,
  folder: string
): Promise<MoveManyResult> {
  const dir = path.join(session.root, folder)
  if (!pathExists(dir)) throw appError('NOT_FOUND', `Folder ${folder} does not exist`, { path: dir })
  const entries = await listEntries(dir)
  const skip = sidecarNames(entries.map((e) => e.name))
  const written: JournalEntry[] = []
  const result: MoveManyResult = { moved: [], failed: [] }
  for (const entry of entries.filter((e) => !skip.has(e.name))) {
    const src = path.join(dir, entry.name)
    try {
      const hasSidecar = !entry.isDir && pathExists(sidecarOf(src))
      const free = uniqueName(session.root, entry.name, (c) => pathExists(c) || (hasSidecar && pathExists(sidecarOf(c))))
      const sidecar: SidecarMove | null = hasSidecar ? { from: sidecarOf(src), to: sidecarOf(free.path) } : null
      await moveEntry(src, free.path)
      if (sidecar !== null) await moveEntry(sidecar.from, sidecar.to)
      const journaled = await journal.append(
        session.root,
        { op: 'move', from: src, to: free.path, sidecars: sidecar === null ? [] : [sidecar], undoable: true },
        session.id
      )
      written.push(journaled)
      result.moved.push({ entry: journaled, newPath: free.path })
    } catch (error) {
      result.failed.push({ path: src, error: toIpcError(error) })
    }
  }
  journal.emit(session.root, session.id, written)
  return result
}

function isPrecleanTarget(name: string, size: number, isDir: boolean): boolean {
  return !isDir && (size === 0 || name.toLowerCase().endsWith('.log'))
}

/** Trashes the zero-byte files and `*.log` files directly in `<root>/<folder>` (journaled, not undoable). */
export async function precleanFolder(
  deps: OpsDeps,
  journal: JournalStore,
  session: SessionRecord,
  folder: string
): Promise<string[]> {
  const dir = path.join(session.root, folder)
  if (!pathExists(dir)) return []
  const targets = (await listEntries(dir)).filter((e) => isPrecleanTarget(e.name, e.size, e.isDir))
  const written: JournalEntry[] = []
  const trashed: string[] = []
  for (const target of targets) {
    const file = path.join(dir, target.name)
    if (!pathExists(file)) continue
    const entry = await trashOne(deps, session, file, (e) =>
      journal.append(session.root, e, session.id)
    )
    written.push(entry)
    trashed.push(entry.from)
  }
  journal.emit(session.root, session.id, written)
  return trashed
}
