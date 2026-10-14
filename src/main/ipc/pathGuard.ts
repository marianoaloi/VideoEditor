/**
 * Path gate for every channel that takes a renderer-supplied path (ADR-003, review H2/M3).
 *
 * A path is usable when it is inside an open session root / produced file (`ctx.allowlist`) or
 * inside something the user approved natively (`ctx.approvals`: dialog results, dropped items).
 * UNC (`\\server\share`) and device (`\\?\`, `\\.\`) paths are refused on every platform, and the
 * REAL path (junctions and symlinks resolved, nearest existing ancestor for new files) must stay
 * inside a root as well.
 */
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { AppError } from './errors'
import type { MediaAllowlist } from './mediaAllowlist'

export interface PathGuardContext {
  readonly allowlist: MediaAllowlist
  readonly approvals: MediaAllowlist
}

/** True for empty, NUL-carrying, relative, UNC and `\\?\` / `\\.\` device paths. */
export function isForbiddenPathSyntax(candidate: string): boolean {
  if (candidate.length === 0 || candidate.includes('\0')) return true
  if (/^[\\/]{2}/.test(candidate)) return true
  return !path.isAbsolute(candidate)
}

export function assertSafePathSyntax(candidate: string): void {
  if (isForbiddenPathSyntax(candidate)) {
    throw new AppError('PATH_NOT_ALLOWED', 'Network, device and relative paths are not allowed', {
      path: candidate
    })
  }
}

function errnoOf(error: unknown): string | undefined {
  const code: unknown = typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined
  return typeof code === 'string' ? code : undefined
}

/** `realpath` of the nearest existing ancestor, with the missing tail appended. */
export async function realpathNearest(target: string): Promise<string> {
  const tail: string[] = []
  let current = path.resolve(target)
  for (;;) {
    try {
      return path.join(await realpath(current), ...tail.reverse())
    } catch (error: unknown) {
      const code = errnoOf(error)
      const parent = path.dirname(current)
      if ((code !== 'ENOENT' && code !== 'ENOTDIR') || parent === current) throw error
      tail.push(path.basename(current))
      current = parent
    }
  }
}

/** True when `candidate` is `root` or inside it (separator aware; case-insensitive on Windows). */
export function isInsideOrEqual(root: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(candidate))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Throws `PATH_NOT_ALLOWED` unless the REAL `candidate` is inside the REAL `root`. */
export async function assertRealInside(root: string, candidate: string): Promise<void> {
  const [realRoot, realTarget] = await Promise.all([realpathNearest(root), realpathNearest(candidate)])
  if (!isInsideOrEqual(realRoot, realTarget)) {
    throw new AppError('PATH_NOT_ALLOWED', 'The path resolves outside the session folder', {
      path: candidate
    })
  }
}

/** The allowlist only covers what is BELOW a root; the folder the user picked is allowed too. */
function isRootItself(list: MediaAllowlist, candidate: string): boolean {
  const resolved = path.resolve(candidate)
  const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
  return list.roots().some((root) => root === key)
}

const lexicallyAllowed = (guard: PathGuardContext, p: string): boolean =>
  guard.allowlist.isAllowed(p) ||
  guard.approvals.isAllowed(p) ||
  isRootItself(guard.allowlist, p) ||
  isRootItself(guard.approvals, p)

/**
 * Validates `requested` and returns it resolved (lexical form, so callers keep the identity the
 * renderer knows). Throws `PATH_NOT_ALLOWED`; never touches the file itself.
 */
export async function resolveGuardedPath(guard: PathGuardContext, requested: string): Promise<string> {
  assertSafePathSyntax(requested)
  const resolved = path.resolve(requested)
  if (!lexicallyAllowed(guard, resolved)) {
    throw new AppError('PATH_NOT_ALLOWED', 'Path is outside the folders you opened', { path: requested })
  }
  const real = await realpathNearest(resolved)
  if (real === resolved || lexicallyAllowed(guard, real)) return resolved
  const roots = [...guard.allowlist.roots(), ...guard.approvals.roots()]
  const realRoots = await Promise.all(roots.map((root) => realpathNearest(root).catch(() => root)))
  if (realRoots.some((root) => isInsideOrEqual(root, real))) return resolved
  throw new AppError('PATH_NOT_ALLOWED', 'Path resolves outside the folders you opened', { path: requested })
}

/** Guards a list; fails on the first offender. */
export async function resolveGuardedPaths(
  guard: PathGuardContext,
  requested: readonly string[]
): Promise<string[]> {
  const out: string[] = []
  for (const item of requested) out.push(await resolveGuardedPath(guard, item))
  return out
}
