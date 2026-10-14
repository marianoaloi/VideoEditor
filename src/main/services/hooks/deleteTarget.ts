/**
 * What the built-in step of `deleteR` may trash (review H1). Main derives the folder itself from
 * an approved session root plus the configured R folder name; the renderer's `dir` / `files` are
 * only accepted when they point at that same folder, and are otherwise ignored or refused.
 */
import { lstat, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { HookContext } from '@shared/domain/hooks'
import { appError } from '../../ipc/errors'
import type { MainContext } from '../../ipc/context'
import { assertRealInside, resolveGuardedPath } from '../../ipc/pathGuard'

export interface DeleteTarget {
  readonly root: string
  /** `<root>/<R folder>`; the folder may not exist (then `files` is empty). */
  readonly dir: string
  /** Regular files directly inside `dir`. */
  readonly files: string[]
  /** Renderer-supplied files that were ignored, with the reason. */
  readonly ignored: string[]
}

function samePath(a: string, b: string): boolean {
  const x = path.resolve(a)
  const y = path.resolve(b)
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y
}

/** Folder names `deleteR` may act on: the video R folder and the image-triage R folder. */
function allowedFolders(ctx: MainContext): string[] {
  const settings = ctx.settings.get()
  return [settings.folders.right, settings.imageTriage.rightDir]
}

function chooseFolder(ctx: MainContext, root: string, requestedDir: string | undefined): string {
  const names = allowedFolders(ctx)
  if (requestedDir === undefined) return names[0] ?? 'R'
  const match = names.find((name) => samePath(path.join(root, name), requestedDir))
  if (match === undefined) {
    throw appError('PATH_NOT_ALLOWED', 'deleteR only acts on the R folder of the session', {
      dir: requestedDir
    })
  }
  return match
}

async function regularFilesIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries.filter((e) => e.isFile()).map((e) => path.join(dir, e.name))
}

async function isRegularFile(file: string): Promise<boolean> {
  return (await lstat(file).catch(() => null))?.isFile() === true
}

async function filterRequested(dir: string, requested: readonly string[]): Promise<Pick<DeleteTarget, 'files' | 'ignored'>> {
  const files: string[] = []
  const ignored: string[] = []
  for (const file of requested) {
    const full = path.resolve(file)
    const inside = samePath(path.dirname(full), dir) && (await isRegularFile(full))
    if (inside) files.push(full)
    else ignored.push(file)
  }
  return { files, ignored }
}

export async function resolveDeleteTarget(ctx: MainContext, context: HookContext): Promise<DeleteTarget> {
  if (context.root === undefined) {
    throw appError('VALIDATION', 'deleteR needs the session root')
  }
  const root = await resolveGuardedPath(ctx, context.root)
  const dir = path.join(root, chooseFolder(ctx, root, context.dir))
  if ((await lstat(dir).catch(() => null)) === null) return { root, dir, files: [], ignored: [] }
  await assertRealInside(root, dir)
  if (context.files !== undefined) return { root, dir, ...(await filterRequested(dir, context.files)) }
  return { root, dir, files: await regularFilesIn(dir), ignored: [] }
}
