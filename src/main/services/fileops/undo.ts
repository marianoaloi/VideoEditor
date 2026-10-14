/** `fileops:undo` / `fileops:peekUndo` (ADR-006): reverse a move or copy through the journal. */
import type { JournalEntry, SidecarMove, UndoResult } from '@shared/domain/fileops'
import { appError } from '../../ipc/errors'
import type { MainContext, SessionRecord } from '../../ipc/context'
import { moveEntry, pathExists, uniqueName } from './fsutil'
import type { JournalStore } from './journal'
import { sidecarOf } from './operations'
import path from 'node:path'

async function findTarget(
  journal: JournalStore,
  root: string,
  entryId: string | undefined
): Promise<JournalEntry> {
  if (entryId === undefined) {
    const latest = await journal.latestUndoable(root)
    if (latest === null) throw appError('NOTHING_TO_UNDO', 'Nothing to undo')
    return latest
  }
  const found = await journal.find(root, entryId)
  if (found === null) throw appError('NOT_FOUND', `Journal entry not found: ${entryId}`)
  if (!found.reversible) throw appError('NOTHING_TO_UNDO', 'This operation cannot be undone')
  return found.entry
}

/** Where a sidecar goes back to, following the (possibly renamed) restored file. */
function restoredSidecarPath(entry: JournalEntry, restored: string, sidecar: SidecarMove): string {
  return sidecar.from.startsWith(entry.from)
    ? restored + sidecar.from.slice(entry.from.length)
    : sidecar.from
}

async function undoMove(entry: JournalEntry): Promise<{ restored: string; sidecars: SidecarMove[] }> {
  if (entry.to === null || !pathExists(entry.to)) {
    throw appError('NOT_FOUND', `The file is no longer at ${entry.to ?? '(unknown)'}`, { path: entry.to })
  }
  const hasSidecars = entry.sidecars.some((s) => pathExists(s.to))
  const dir = path.dirname(entry.from)
  const free = uniqueName(dir, path.basename(entry.from), (candidate) =>
    pathExists(candidate) || (hasSidecars && entry.sidecars.some((s) => pathExists(restoredSidecarPath(entry, candidate, s))))
  )
  await moveEntry(entry.to, free.path)
  const moved: SidecarMove[] = []
  for (const sidecar of entry.sidecars) {
    if (!pathExists(sidecar.to)) continue
    const target = restoredSidecarPath(entry, free.path, sidecar)
    await moveEntry(sidecar.to, target)
    moved.push({ from: sidecar.to, to: target })
  }
  return { restored: free.path, sidecars: moved }
}

async function undoCopy(
  ctx: MainContext,
  entry: JournalEntry
): Promise<{ restored: string; sidecars: SidecarMove[] }> {
  if (entry.to === null || !pathExists(entry.to)) {
    throw appError('NOT_FOUND', `The copy is no longer at ${entry.to ?? '(unknown)'}`, { path: entry.to })
  }
  await ctx.trashItem(entry.to)
  return { restored: entry.from, sidecars: [] }
}

export async function undoEntry(
  ctx: MainContext,
  journal: JournalStore,
  session: SessionRecord,
  entryId: string | undefined,
  itemFor: (path: string) => Promise<UndoResult['item']>
): Promise<UndoResult> {
  const entry = await findTarget(journal, session.root, entryId)
  const outcome = entry.op === 'copy' ? await undoCopy(ctx, entry) : await undoMove(entry)
  const compensating = await journal.record(
    session.root,
    {
      op: 'undo',
      from: entry.to ?? entry.from,
      to: entry.op === 'copy' ? null : outcome.restored,
      sidecars: outcome.sidecars,
      undoable: false,
      undoOf: entry.id
    },
    session.id
  )
  return {
    undone: entry,
    compensating,
    restoredPath: outcome.restored,
    item: await itemFor(outcome.restored)
  }
}

export { sidecarOf }
