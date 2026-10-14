/**
 * In-place image edits (ADR-006, image-triage.md §6): crop/adjust, rotate and un-crop.
 *
 * Order matters: validate and render the whole result in memory first (a failure touches
 * nothing), then copy the ORIGINAL bytes to `<dir>/bkp/<name>` (a numbered name when that one
 * belongs to another image), then write atomically (temp file in the same folder + rename), then
 * journal a `write` entry that names the backup. `write` entries are not undoable.
 *
 * Backup identity (review H3): `backupIndex.ts` remembers which bytes each backup protects.
 * Ctrl+F restores only while the file is still exactly what our last edit wrote, then CONSUMES
 * the backup (checklist 41). Anything else is refused with `CONFLICT`.
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  ImageEditRequest,
  ImageEditResult,
  ImageRestoreRequest,
  ImageRestoreResult,
  ImageRotateRequest
} from '@shared/domain/media'
import { collisionName } from '@shared/core/naming'
import { AppError } from '../../ipc/errors'
import type { MainContext } from '../../ipc/context'
import { assertRealInside } from '../../ipc/pathGuard'
import { isInside } from './access'
import { createBackupIndex, sha256, type BackupIndex, type BackupRecord } from './backupIndex'
import {
  applyEdit,
  detectWritableFormat,
  encode,
  loadOriented,
  rotateImage,
  type RawImage
} from './imageOps'

export const BACKUP_DIR = 'bkp'
const MAX_BACKUP_NAMES = 1000

export interface ImageEditService {
  edit(request: ImageEditRequest): Promise<ImageEditResult>
  rotate(request: ImageRotateRequest): Promise<ImageEditResult>
  restore(request: ImageRestoreRequest): Promise<ImageRestoreResult>
}

export function backupPathFor(file: string, folder: string = BACKUP_DIR): string {
  return path.join(path.dirname(file), folder, path.basename(file))
}

async function writeAtomic(target: string, data: Buffer, id: string): Promise<void> {
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${id}.tmp`)
  try {
    await writeFile(tmp, data)
    await rename(tmp, target)
  } finally {
    await rm(tmp, { force: true })
  }
}

async function exists(file: string): Promise<boolean> {
  return (await stat(file).catch(() => null)) !== null
}

/** Writes `data` to the first free `bkp/<name>`, `bkp/<stem> (1).<ext>`, ... (never overwrites). */
async function createBackupCopy(file: string, folder: string, data: Buffer): Promise<string> {
  const dir = path.join(path.dirname(file), folder)
  await mkdir(dir, { recursive: true })
  for (let n = 0; n < MAX_BACKUP_NAMES; n += 1) {
    const target = path.join(dir, collisionName(path.basename(file), n))
    try {
      await writeFile(target, data, { flag: 'wx' })
      return target
    } catch (error: unknown) {
      const code: unknown = error instanceof Error ? Reflect.get(error, 'code') : undefined
      if (code !== 'EEXIST') throw error
    }
  }
  throw new AppError('CONFLICT', 'Too many backups with the same name', { path: file })
}

interface BackupState {
  readonly backupPath: string
  readonly created: boolean
  readonly originalHash: string
}

export function createImageEditService(ctx: MainContext): ImageEditService {
  const folder = (): string => ctx.settings.get().folders.backup

  const sessionRoot = async (sessionId: string, file: string): Promise<string> => {
    const root = ctx.services.require('sessions').require(sessionId).root
    if (!isInside(root, file)) {
      throw new AppError('PATH_NOT_ALLOWED', 'The image is outside the session folder', { path: file })
    }
    await assertRealInside(root, file)
    return root
  }

  const journal = async (root: string, sessionId: string, file: string, backup: string): Promise<string> => {
    const entry = await ctx.services
      .require('journal')
      .record(root, { op: 'write', from: file, to: file, sidecars: [], undoable: false, backup }, sessionId)
    return entry.id
  }

  /** Reuses our backup while the file is untouched since our last edit; otherwise takes a new one. */
  const ensureBackup = async (
    index: BackupIndex,
    root: string,
    file: string,
    original: Buffer
  ): Promise<BackupState> => {
    const currentHash = sha256(original)
    const known = await index.get(file)
    if (known !== undefined && known.editHash === currentHash) {
      const backupPath = path.join(root, known.backup)
      if (await exists(backupPath)) {
        return { backupPath, created: false, originalHash: known.originalHash }
      }
    }
    const backupPath = await createBackupCopy(file, folder(), original)
    return { backupPath, created: true, originalHash: currentHash }
  }

  const apply = async (
    sessionId: string,
    file: string,
    render: (image: RawImage) => Promise<RawImage>
  ): Promise<ImageEditResult> => {
    const root = await sessionRoot(sessionId, file)
    const original = await readFile(file)
    const format = await detectWritableFormat(original, file)
    const output = await encode(await render(await loadOriented(original)), format)
    const index = createBackupIndex(root)
    const backup = await ensureBackup(index, root, file, original)
    try {
      await writeAtomic(file, output.data, ctx.newId())
    } catch (error: unknown) {
      if (backup.created) await rm(backup.backupPath, { force: true })
      throw error
    }
    const record: BackupRecord = {
      backup: path.relative(root, backup.backupPath).split(path.sep).join('/'),
      originalHash: backup.originalHash,
      editHash: sha256(output.data),
      updatedAt: Date.now()
    }
    await index.set(file, record)
    const journalEntryId = await journal(root, sessionId, file, backup.backupPath)
    return {
      path: file,
      backupPath: backup.backupPath,
      backupCreated: backup.created,
      width: output.width,
      height: output.height,
      version: (await stat(file)).mtimeMs,
      journalEntryId
    }
  }

  const refuse = (message: string, file: string): AppError =>
    new AppError('CONFLICT', message, { path: file, reason: 'backup-mismatch' })

  const restore: ImageEditService['restore'] = async (request) => {
    const file = request.path
    const root = await sessionRoot(request.sessionId, file)
    const index = createBackupIndex(root)
    const record = await index.get(file)
    const current = await readFile(file).catch(() => null)
    const version = async (): Promise<number> => (await stat(file).catch(() => null))?.mtimeMs ?? 0
    if (record === undefined) {
      if (await exists(backupPathFor(file, folder()))) {
        throw refuse(
          'A backup with this name exists but it was not made by an edit of this image. It was left untouched; copy it back by hand if it is the right one.',
          file
        )
      }
      return { path: file, restored: false, backupPath: null, version: await version() }
    }
    const backupPath = path.join(root, record.backup)
    if (!(await exists(backupPath))) {
      await index.remove(file)
      return { path: file, restored: false, backupPath: null, version: await version() }
    }
    if (current !== null && sha256(current) !== record.editHash) {
      throw refuse(
        'The image changed after its last edit, so the backup no longer belongs to it. Nothing was restored.',
        file
      )
    }
    const original = await readFile(backupPath)
    if (sha256(original) !== record.originalHash) throw refuse('The backup copy is damaged', file)
    await writeAtomic(file, original, ctx.newId())
    await journal(root, request.sessionId, file, backupPath)
    await index.remove(file)
    await rm(backupPath, { force: true }) // consumed (image-triage checklist 41)
    return { path: file, restored: true, backupPath, version: await version() }
  }

  return {
    edit: (request) => apply(request.sessionId, request.path, (img) => applyEdit(img, request.edit)),
    rotate: (request) =>
      apply(request.sessionId, request.path, (img) => rotateImage(img, request.rotation)),
    restore
  }
}
