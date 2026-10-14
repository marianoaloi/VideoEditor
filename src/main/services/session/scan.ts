/**
 * Folder scan (video-triage §1.3/§1.4, image-triage §1.5/§1.6, ADR-006): lists the media files of a
 * root, optionally recursive, skipping destination folders, `.mediamaloi/` and the thumbnail cache.
 * Symlinked directories are not followed. Unreadable entries are skipped and counted.
 */
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { mediaKindOf, matchesKindFilter } from '@shared/core/mediaKind'
import type { SessionItem, SessionKindFilter, SessionSort } from '@shared/domain/session'

export const JOURNAL_DIR_NAME = '.mediamaloi'

export interface ScanOptions {
  readonly root: string
  readonly recursive: boolean
  readonly kind: SessionKindFilter
  readonly sort: SessionSort
  /** Folder names skipped directly under the root (destination folders, `.mediamaloi`). */
  readonly skipAtRoot: readonly string[]
  /** Folder names skipped at any depth (the backup folder). */
  readonly skipEverywhere: readonly string[]
  /** Absolute directories skipped wherever they are (thumbnail cache). */
  readonly skipDirs: readonly string[]
  readonly newId: () => string
  readonly onProgress?: (scanned: number, matched: number) => void
  readonly caseInsensitive?: boolean
}

export interface ScanResult {
  readonly items: SessionItem[]
  readonly skippedDirs: string[]
  readonly unreadable: number
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Size descending (legacy), ties by natural case-insensitive path; or by natural name. */
export function sortItems(items: SessionItem[], sort: SessionSort): SessionItem[] {
  const byPath = (a: SessionItem, b: SessionItem): number => collator.compare(a.path, b.path)
  const compare =
    sort === 'name'
      ? (a: SessionItem, b: SessionItem) => collator.compare(a.name, b.name) || byPath(a, b)
      : (a: SessionItem, b: SessionItem) => b.sizeBytes - a.sizeBytes || byPath(a, b)
  return [...items].sort(compare)
}

interface ScanState {
  scanned: number
  unreadable: number
  readonly items: SessionItem[]
  readonly skipped: string[]
}

function makeSkipper(options: ScanOptions): (dir: string, depth: number) => boolean {
  const fold = (s: string): string =>
    (options.caseInsensitive ?? process.platform === 'win32') ? s.toLowerCase() : s
  const atRoot = new Set(options.skipAtRoot.map(fold))
  const everywhere = new Set(options.skipEverywhere.map(fold))
  const absolute = new Set(options.skipDirs.map((d) => fold(path.resolve(d))))
  return (dir, depth) => {
    const name = fold(path.basename(dir))
    if (everywhere.has(name)) return true
    if (depth === 1 && atRoot.has(name)) return true
    return absolute.has(fold(path.resolve(dir)))
  }
}

async function toItem(options: ScanOptions, filePath: string, name: string, dir: string): Promise<SessionItem | null> {
  const kind = mediaKindOf(name)
  if (kind === null || !matchesKindFilter(kind, options.kind)) return null
  const info = await stat(filePath)
  if (!info.isFile()) return null
  return {
    id: options.newId(),
    path: filePath,
    relDir: path.relative(options.root, dir),
    name,
    sizeBytes: info.size,
    mtimeMs: info.mtimeMs,
    kind
  }
}

async function scanDir(
  options: ScanOptions,
  dir: string,
  depth: number,
  skip: (dir: string, depth: number) => boolean,
  state: ScanState
): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    state.unreadable += 1
    return
  }
  const subdirs: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (skip(full, depth + 1)) state.skipped.push(full)
      else if (options.recursive) subdirs.push(full)
      continue
    }
    state.scanned += 1
    try {
      const item = await toItem(options, full, entry.name, dir)
      if (item !== null) state.items.push(item)
    } catch {
      state.unreadable += 1
    }
    options.onProgress?.(state.scanned, state.items.length)
  }
  for (const sub of subdirs) await scanDir(options, sub, depth + 1, skip, state)
}

export async function scanFolder(options: ScanOptions): Promise<ScanResult> {
  const state: ScanState = { scanned: 0, unreadable: 0, items: [], skipped: [] }
  await scanDir(options, options.root, 0, makeSkipper(options), state)
  return {
    items: sortItems(state.items, options.sort),
    skippedDirs: state.skipped,
    unreadable: state.unreadable
  }
}
