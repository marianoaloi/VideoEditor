/** Move / copy / trash operations (video-triage §8, image-triage §5; ADR-006). */
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { resolveDestination, type DestinationNameError, type LimitOptions } from '@shared/core/naming'
import type { Destination, JournalEntry, MoveResult, SidecarMove } from '@shared/domain/fileops'
import { appError } from '../../ipc/errors'
import { assertRealInside } from '../../ipc/pathGuard'
import type { JournalService, MainContext, SessionRecord } from '../../ipc/context'
import { constants } from 'node:fs'
import { isInside, longPath, moveEntry, pathExists, samePath, uniqueName } from './fsutil'

const NAME_ERRORS: Record<DestinationNameError, () => Error> = {
  OUTSIDE_ROOT: () => appError('PATH_NOT_ALLOWED', 'The file is outside the session folder'),
  NAME_TOO_LONG: () => appError('IO', 'The destination path is too long for this file name'),
  TOO_MANY_COLLISIONS: () => appError('CONFLICT', 'Too many files with the same name in the destination')
}

const SIDECAR_SUFFIX = '.json'

export function sidecarOf(file: string): string {
  return `${file}${SIDECAR_SUFFIX}`
}

/** Folder name (directly under the root) for a destination. */
export function folderNameFor(ctx: MainContext, destination: Destination): string {
  if (destination.type === 'folder') return destination.name
  return ctx.settings.get().folders[destination.role]
}

/** Lexical check, then the REAL path (junctions/symlinks resolved) must stay in the real root (M3). */
export async function assertInside(session: SessionRecord, file: string): Promise<string> {
  const full = path.resolve(file)
  if (!isInside(session.root, full)) {
    throw appError('PATH_NOT_ALLOWED', 'The path is outside the session folder', { path: file })
  }
  await assertRealInside(session.root, full)
  return full
}

/** Name limits for files that may carry a `<name>.json` sidecar; POSIX counts bytes (M10). */
export function nameLimits(withSidecar: boolean): LimitOptions {
  return { byteLimit: process.platform !== 'win32', ...(withSidecar ? { reserve: SIDECAR_SUFFIX.length } : {}) }
}

/** Rename the file and its sidecar; rolls the file back when the sidecar cannot follow. */
export async function moveWithSidecar(
  src: string,
  dest: string,
  sidecar: SidecarMove | null
): Promise<void> {
  await moveEntry(src, dest)
  if (sidecar === null) return
  try {
    await moveEntry(sidecar.from, sidecar.to)
  } catch (error) {
    await moveEntry(dest, src)
    throw error
  }
}

export interface PlannedMove {
  readonly dest: string
  readonly sidecar: SidecarMove | null
}

/** Destination path for a triage move: collision-safe on the file AND its sidecar name. */
export function planMove(session: SessionRecord, folder: string, src: string): PlannedMove {
  const hasSidecar = pathExists(sidecarOf(src))
  const result = resolveDestination({
    root: session.root,
    folder,
    sourcePath: src,
    recursive: session.recursive,
    exists: (candidate) => pathExists(candidate) || (hasSidecar && pathExists(sidecarOf(candidate))),
    limits: nameLimits(hasSidecar)
  })
  if (!result.ok) throw NAME_ERRORS[result.error]()
  const dest = result.value.path
  return { dest, sidecar: hasSidecar ? { from: sidecarOf(src), to: sidecarOf(dest) } : null }
}

export interface OpsDeps {
  readonly ctx: MainContext
  readonly journal: JournalService
}

/** Moves one file into `<root>/<folder>` and journals it. */
export async function moveOne(
  deps: OpsDeps,
  session: SessionRecord,
  rawPath: string,
  folder: string,
  record: (entry: Omit<JournalEntry, 'id' | 'ts' | 'sessionId'>) => Promise<JournalEntry> = (entry) =>
    deps.journal.record(session.root, entry, session.id)
): Promise<MoveResult> {
  const src = await assertInside(session, rawPath)
  if (!pathExists(src)) throw appError('NOT_FOUND', `File not found: ${src}`, { path: src })
  if (samePath(path.dirname(src), path.join(session.root, folder))) {
    throw appError('CONFLICT', `The file is already in ${folder}`, { path: src })
  }
  const plan = planMove(session, folder, src)
  await assertRealInside(session.root, path.dirname(plan.dest))
  await moveWithSidecar(src, plan.dest, plan.sidecar)
  const entry = await record({
    op: 'move',
    from: src,
    to: plan.dest,
    sidecars: plan.sidecar === null ? [] : [plan.sidecar],
    undoable: true
  })
  return { entry, newPath: plan.dest }
}

export async function copyOne(
  deps: OpsDeps,
  session: SessionRecord,
  rawPath: string,
  personalDir: string
): Promise<{ entry: JournalEntry; newPath: string }> {
  const src = await assertInside(session, rawPath)
  if (!pathExists(src)) throw appError('NOT_FOUND', `File not found: ${src}`, { path: src })
  await mkdir(longPath(personalDir), { recursive: true })
  const target = uniqueName(personalDir, path.basename(src), pathExists, nameLimits(false))
  await copyFile(longPath(src), longPath(target.path), constants.COPYFILE_EXCL)
  const entry = await deps.journal.record(
    session.root,
    { op: 'copy', from: src, to: target.path, sidecars: [], undoable: true },
    session.id
  )
  return { entry, newPath: target.path }
}

export async function trashOne(
  deps: OpsDeps,
  session: SessionRecord,
  rawPath: string,
  record: (entry: Omit<JournalEntry, 'id' | 'ts' | 'sessionId'>) => Promise<JournalEntry> = (entry) =>
    deps.journal.record(session.root, entry, session.id)
): Promise<JournalEntry> {
  const src = await assertInside(session, rawPath)
  if (!pathExists(src)) throw appError('NOT_FOUND', `File not found: ${src}`, { path: src })
  const sidecars: SidecarMove[] = []
  await deps.ctx.trashItem(src)
  const side = sidecarOf(src)
  if (pathExists(side)) {
    await deps.ctx.trashItem(side)
    // A trashed sidecar has no new location; `from === to` marks "trashed in place".
    sidecars.push({ from: side, to: side })
  }
  return record({ op: 'trash', from: src, to: null, sidecars, undoable: false })
}
