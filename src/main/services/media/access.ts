/** Path checks shared by the `media://` protocol and the IPC handlers (ADR-003). */
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '../../ipc/errors'
import type { MediaAllowlist } from '../../ipc/mediaAllowlist'

/**
 * `path.resolve`, then `fs.realpath`, then the allowlist on BOTH forms, so neither `..` nor a
 * symlink can leave the allowed roots. Returns the real path. Throws `PATH_NOT_ALLOWED`/`NOT_FOUND`.
 */
export async function resolveAllowedPath(
  allowlist: MediaAllowlist,
  requested: string
): Promise<string> {
  const resolved = path.resolve(requested)
  if (!allowlist.isAllowed(resolved)) {
    throw new AppError('PATH_NOT_ALLOWED', 'Path is outside the allowed media roots')
  }
  let real: string
  try {
    real = await realpath(resolved)
  } catch (error: unknown) {
    const code: unknown = error instanceof Error ? Reflect.get(error, 'code') : undefined
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new AppError('NOT_FOUND', 'File not found', { path: resolved })
    }
    throw error
  }
  if (!allowlist.isAllowed(real)) {
    throw new AppError('PATH_NOT_ALLOWED', 'Path resolves outside the allowed media roots')
  }
  return real
}

/** Allows a produced file (temp frame, mosaic, preview) under both its lexical and real path. */
export async function allowProducedFile(
  allowlist: MediaAllowlist,
  file: string
): Promise<string[]> {
  const real = await realpath(file).catch(() => file)
  const added = real === file ? [file] : [file, real]
  for (const entry of added) allowlist.addFile(entry)
  return added
}

/** True when `candidate` is `root` or inside it. */
export function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(candidate))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Grants `media://` access to a session root under BOTH its lexical and its real form, so a
 * junction/symlink root still passes the realpath re-check (review M2). Returns what to revoke.
 */
export async function grantRoot(allowlist: MediaAllowlist, root: string): Promise<string[]> {
  const real = await realpath(root).catch(() => root)
  const granted = path.resolve(real) === path.resolve(root) ? [root] : [root, real]
  for (const entry of granted) allowlist.addRoot(entry)
  return granted
}

export function revokeRoots(allowlist: MediaAllowlist, granted: readonly string[]): void {
  for (const entry of granted) allowlist.removeRoot(entry)
}
