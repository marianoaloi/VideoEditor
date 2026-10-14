/**
 * Small file-system helpers for moves: long-path prefix on Windows, `rename` with a cross-device
 * fallback, collision-safe names and a mutex that serialises mutating operations.
 */
import { lstatSync } from 'node:fs'
import { constants } from 'node:fs'
import { copyFile, cp, mkdir, rename, rm, unlink } from 'node:fs/promises'
import path from 'node:path'
import { collisionName, limitName } from '@shared/core/naming'
import { appError } from '../../ipc/errors'

/** Windows rejects paths over 260 characters unless they carry the `\\?\` prefix. */
export function longPath(p: string): string {
  if (process.platform !== 'win32' || p.length < 240 || p.startsWith('\\\\?\\')) return p
  const full = path.win32.resolve(p)
  return full.startsWith('\\\\') ? `\\\\?\\UNC\\${full.slice(2)}` : `\\\\?\\${full}`
}

export function pathExists(p: string): boolean {
  return lstatSync(longPath(p), { throwIfNoEntry: false }) !== undefined
}

export function samePath(a: string, b: string): boolean {
  const x = path.resolve(a)
  const y = path.resolve(b)
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y
}

export function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(candidate))
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function errnoOf(error: unknown): string | undefined {
  const code: unknown = typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined
  return typeof code === 'string' ? code : undefined
}

/** `fs.rename`, falling back to copy + delete across devices (ADR-006). Never overwrites by copy. */
export async function moveEntry(src: string, dest: string): Promise<void> {
  const from = longPath(src)
  const to = longPath(dest)
  await mkdir(longPath(path.dirname(dest)), { recursive: true })
  try {
    await rename(from, to)
    return
  } catch (error) {
    if (errnoOf(error) !== 'EXDEV') throw error
  }
  await copyAcrossDevices(from, to)
}

async function copyAcrossDevices(from: string, to: string): Promise<void> {
  const isDir = lstatSync(from).isDirectory()
  if (isDir) await cp(from, to, { recursive: true, errorOnExist: true, force: false })
  else await copyFile(from, to, constants.COPYFILE_EXCL)
  try {
    if (isDir) await rm(from, { recursive: true })
    else await unlink(from)
  } catch (error) {
    await rm(to, { recursive: true, force: true })
    throw error
  }
}

/** A free name in `dir`: `name`, then `name (1)`, ... with the 254/255 limits applied. */
export function uniqueName(
  dir: string,
  name: string,
  isTaken: (candidate: string) => boolean = pathExists
): { name: string; path: string } {
  for (let n = 0; n <= 10000; n += 1) {
    const limited = limitName(collisionName(name, n), dir)
    if (limited === null) throw appError('IO', `File name too long for ${dir}: ${name}`)
    const candidate = path.join(dir, limited)
    if (!isTaken(candidate)) return { name: limited, path: candidate }
  }
  throw appError('CONFLICT', `Too many name collisions for ${name} in ${dir}`)
}

/** Runs async work one at a time, in call order (moves of one workspace must not interleave). */
export function createMutex(): <T>(work: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work, work)
    tail = result.catch(() => undefined)
    return result
  }
}
