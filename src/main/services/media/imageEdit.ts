/**
 * In-place image edits (ADR-006, image-triage.md §6): crop/adjust, rotate and un-crop.
 *
 * Order matters: validate and render the whole result in memory first (a failure touches
 * nothing), then copy to `<dir>/bkp/<name>` unless a backup exists (the first original wins),
 * then write atomically (temp file in the same folder + rename), then journal a `write` entry
 * that names the backup. `write` entries are not undoable; Ctrl+F restores from `bkp/`.
 */
import { constants } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  ImageEditRequest,
  ImageEditResult,
  ImageRestoreRequest,
  ImageRestoreResult,
  ImageRotateRequest
} from '@shared/domain/media'
import { AppError } from '../../ipc/errors'
import type { MainContext } from '../../ipc/context'
import { isInside } from './access'
import {
  applyEdit,
  encode,
  loadOriented,
  rotateImage,
  writableFormat,
  type RawImage
} from './imageOps'

export const BACKUP_DIR = 'bkp'

export interface ImageEditService {
  edit(request: ImageEditRequest): Promise<ImageEditResult>
  rotate(request: ImageRotateRequest): Promise<ImageEditResult>
  restore(request: ImageRestoreRequest): Promise<ImageRestoreResult>
}

export function backupPathFor(file: string): string {
  return path.join(path.dirname(file), BACKUP_DIR, path.basename(file))
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

/** Copies `file` into `bkp/` unless a backup exists. Returns whether one was created. */
async function ensureBackup(file: string): Promise<{ backupPath: string; created: boolean }> {
  const backupPath = backupPathFor(file)
  await mkdir(path.dirname(backupPath), { recursive: true })
  try {
    await copyFile(file, backupPath, constants.COPYFILE_EXCL)
    return { backupPath, created: true }
  } catch (error: unknown) {
    const code: unknown = error instanceof Error ? Reflect.get(error, 'code') : undefined
    if (code === 'EEXIST') return { backupPath, created: false }
    throw error
  }
}

export function createImageEditService(ctx: MainContext): ImageEditService {
  const sessionRoot = (sessionId: string, file: string): string => {
    const root = ctx.services.require('sessions').require(sessionId).root
    if (!isInside(root, file)) {
      throw new AppError('PATH_NOT_ALLOWED', 'The image is outside the session folder', {
        path: file
      })
    }
    return root
  }

  const journal = async (
    root: string,
    sessionId: string,
    file: string,
    backup: string
  ): Promise<string> => {
    const entry = await ctx.services
      .require('journal')
      .record(
        root,
        { op: 'write', from: file, to: file, sidecars: [], undoable: false, backup },
        sessionId
      )
    return entry.id
  }

  const apply = async (
    sessionId: string,
    file: string,
    render: (image: RawImage) => Promise<RawImage>
  ): Promise<ImageEditResult> => {
    const root = sessionRoot(sessionId, file)
    const format = writableFormat(file)
    const output = await encode(await render(await loadOriented(file)), format)
    const backup = await ensureBackup(file)
    await writeAtomic(file, output.data, ctx.newId())
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

  const restore: ImageEditService['restore'] = async (request) => {
    const file = request.path
    const root = sessionRoot(request.sessionId, file)
    const backupPath = backupPathFor(file)
    const exists = await stat(backupPath).catch(() => null)
    if (exists === null) {
      const current = await stat(file).catch(() => null)
      return { path: file, restored: false, backupPath: null, version: current?.mtimeMs ?? 0 }
    }
    await writeAtomic(file, await readFile(backupPath), ctx.newId())
    await journal(root, request.sessionId, file, backupPath)
    return { path: file, restored: true, backupPath, version: (await stat(file)).mtimeMs }
  }

  return {
    edit: (request) =>
      apply(request.sessionId, request.path, (img) => applyEdit(img, request.edit)),
    rotate: (request) =>
      apply(request.sessionId, request.path, (img) => rotateImage(img, request.rotation)),
    restore
  }
}
