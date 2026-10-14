/**
 * User-approved roots (review H2). Only main may add to this set, and only from
 * (a) a native dialog result, (b) an item the user dropped on the window (reported by the
 * preload through `webUtils`), or (c) a root approved in an earlier run (persisted here).
 * A session may then open any folder inside an approved root, never an arbitrary renderer path.
 */
import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createMediaAllowlist, type MediaAllowlist } from './mediaAllowlist'
import { isForbiddenPathSyntax } from './pathGuard'

const MAX_PERSISTED = 100

function readPersisted(file: string): string[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string' && !isForbiddenPathSyntax(v))
  } catch (error: unknown) {
    const code: unknown = error instanceof Error ? Reflect.get(error, 'code') : undefined
    if (code !== 'ENOENT') console.warn('[approvals] ignoring unreadable approvals file', error)
    return []
  }
}

/** `file === null` keeps the approvals in memory only (tests). */
export function createPathApprovals(file: string | null): MediaAllowlist {
  const inner = createMediaAllowlist()
  let recent: string[] = file === null ? [] : readPersisted(file).slice(-MAX_PERSISTED)
  for (const root of recent) inner.addRoot(root)

  const save = (): void => {
    if (file === null) return
    const tmp = `${file}.tmp`
    void mkdir(path.dirname(file), { recursive: true })
      .then(() => writeFile(tmp, JSON.stringify(recent)))
      .then(() => rename(tmp, file))
      .catch((error: unknown) => console.warn('[approvals] could not persist approvals', error))
  }

  return {
    ...inner,
    addRoot(dir) {
      if (isForbiddenPathSyntax(dir)) return
      inner.addRoot(dir)
      recent = [...recent.filter((r) => r !== dir), dir].slice(-MAX_PERSISTED)
      save()
    },
    addFile(target) {
      if (!isForbiddenPathSyntax(target)) inner.addFile(target)
    }
  }
}
