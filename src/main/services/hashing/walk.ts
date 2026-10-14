/**
 * Recursive file walk for the hash scan (research §2 "Walk" + port checklist item 2): includes
 * hidden entries, does not enter symlinked directories, skips the configured excluded folders
 * (legacy bug B3) and returns a deterministic order (files of a directory first, sorted by name,
 * then its sub-directories, sorted by name).
 */
import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

export interface WalkedFile {
  /** Directory string as `os.walk` would yield it: the scan root as given, joined below it. */
  readonly root: string
  readonly name: string
  readonly path: string
}

export interface WalkOptions {
  readonly accept: (fileName: string) => boolean
  /** Folder names skipped at any depth (case-insensitive). */
  readonly excludeNames: readonly string[]
  /** Absolute folders skipped (e.g. the thumbnail cache). */
  readonly excludePaths: readonly string[]
  readonly signal?: AbortSignal
}

export interface WalkResult {
  readonly files: WalkedFile[]
  /** Directories that could not be listed (permissions, vanished); they are skipped. */
  readonly unreadable: string[]
}

function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function samePath(a: string, b: string): boolean {
  const left = path.resolve(a)
  const right = path.resolve(b)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

function isExcluded(dir: string, name: string, options: WalkOptions): boolean {
  const lower = name.toLowerCase()
  if (options.excludeNames.some((n) => n.toLowerCase() === lower)) return true
  return options.excludePaths.some((p) => samePath(p, dir))
}

type Kind = 'file' | 'dir' | 'skip'

async function classify(entry: Dirent, full: string): Promise<Kind> {
  if (entry.isFile()) return 'file'
  if (entry.isDirectory()) return 'dir'
  if (!entry.isSymbolicLink()) return 'skip'
  try {
    // A symlink to a file is processed; a symlink to a directory is listed but not entered.
    return (await stat(full)).isFile() ? 'file' : 'skip'
  } catch {
    return 'skip'
  }
}

async function listDir(dir: string, isRoot: boolean, out: WalkResult): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (isRoot) throw error
    out.unreadable.push(dir)
    return []
  }
}

async function walkDir(dir: string, options: WalkOptions, out: WalkResult, isRoot: boolean): Promise<void> {
  options.signal?.throwIfAborted()
  const entries = await listDir(dir, isRoot, out)
  entries.sort((a, b) => byName(a.name, b.name))
  const dirs: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    const kind = await classify(entry, full)
    if (kind === 'file' && options.accept(entry.name)) {
      out.files.push({ root: dir, name: entry.name, path: full })
    } else if (kind === 'dir' && !isExcluded(full, entry.name, options)) {
      dirs.push(full)
    }
  }
  for (const sub of dirs) await walkDir(sub, options, out, false)
}

export async function walkFiles(root: string, options: WalkOptions): Promise<WalkResult> {
  const out: { files: WalkedFile[]; unreadable: string[] } = { files: [], unreadable: [] }
  await walkDir(root, options, out, true)
  return out
}
