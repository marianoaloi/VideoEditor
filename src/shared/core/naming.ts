/**
 * Pure destination naming for every move (video triage, image triage, duplicates; ADR-006).
 * Owner (wave 2): svc-files implements the callers; this module is complete and tested.
 *
 * Rules (research video-triage §8.2 / image-triage §5.2):
 * - recursive sessions prefix the name with the source sub-folders, separators removed, then `_`;
 *   no `_` for files directly in the root; spaces are kept;
 * - the whole destination path is at most 254 characters and the name at most 255, each time
 *   trimming the START of the name so the end (and the extension) survives;
 * - an existing name gets ` (n)` before the extension (n = 1, 2, ...), then the limits apply again.
 */
import { splitSegments } from './paths'

/** Legacy whole-path bound (`len(dest) > 254`). */
export const MAX_DEST_PATH_LENGTH = 254
/** ADR-006 file-name bound. */
export const MAX_NAME_LENGTH = 255

function separatorOf(dir: string): string {
  if (dir.includes('/') && !dir.includes('\\')) return '/'
  return '\\'
}

function isWindowsLike(p: string): boolean {
  return /^[A-Za-z]:/.test(p) || /^[\\/]{2}/.test(p) || (p.includes('\\') && !p.includes('/'))
}

function splitExt(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: '' }
}

/**
 * The folders between `root` and the file's directory, concatenated without separators:
 * `("C:\\r", "C:\\r\\a\\b\\x.mp4")` gives `"ab"`; `""` for a file directly in the root.
 * Returns `null` when the file is not inside `root`. Windows-looking paths compare case-insensitively.
 */
export function recursivePrefix(root: string, filePath: string): string | null {
  const rootSegments = splitSegments(root)
  const fileSegments = splitSegments(filePath)
  const fold = isWindowsLike(root) ? (s: string) => s.toLowerCase() : (s: string) => s
  if (fileSegments.length <= rootSegments.length) return null
  for (let i = 0; i < rootSegments.length; i += 1) {
    if (fold(fileSegments[i] ?? '') !== fold(rootSegments[i] ?? '')) return null
  }
  return fileSegments.slice(rootSegments.length, -1).join('')
}

/** `prefix + "_" + name` when the prefix is not empty, else `name`. */
export function prefixedName(name: string, prefix: string): string {
  return prefix.length > 0 ? `${prefix}_${name}` : name
}

/**
 * Applies the 254 (whole path) and 255 (name) bounds by dropping characters from the START.
 * `destDir` is the destination folder (`<root>/<folder>`). Returns `null` when no usable name
 * is left (the extension plus at least one character would not fit): the caller refuses the move.
 */
export function limitName(name: string, destDir: string): string | null {
  const sepLength = 1
  let result = name
  if (destDir.length + sepLength + result.length > MAX_DEST_PATH_LENGTH) {
    const keep = MAX_DEST_PATH_LENGTH - destDir.length - sepLength
    if (keep <= splitExt(result).ext.length) return null
    result = result.slice(result.length - keep)
  }
  if (result.length > MAX_NAME_LENGTH) result = result.slice(result.length - MAX_NAME_LENGTH)
  return result
}

/** `clip.mp4` + 2 gives `clip (2).mp4`; `n = 0` returns the name unchanged. */
export function collisionName(name: string, n: number): string {
  if (n <= 0) return name
  const { stem, ext } = splitExt(name)
  return `${stem} (${n})${ext}`
}

export interface DestinationNameOptions {
  /** Session root. */
  readonly root: string
  /** Destination folder NAME directly under the root (`L`, `md5Purge`, ...). */
  readonly folder: string
  /** Absolute source path. */
  readonly sourcePath: string
  /** Only recursive sessions use the sub-folder prefix. */
  readonly recursive: boolean
  /** True when the candidate path is taken (main passes a `fs.existsSync`-like check). */
  readonly exists: (candidatePath: string) => boolean
  /** Safety valve for the ` (n)` loop. Default 10000. */
  readonly maxAttempts?: number
}

export interface DestinationName {
  readonly name: string
  readonly dir: string
  /** `dir + separator + name`, with the separator of `root`. */
  readonly path: string
  /** Number of the ` (n)` suffix that was needed; 0 when the plain name was free. */
  readonly collisions: number
}

export type DestinationNameError = 'OUTSIDE_ROOT' | 'NAME_TOO_LONG' | 'TOO_MANY_COLLISIONS'

export type DestinationNameResult =
  | { readonly ok: true; readonly value: DestinationName }
  | { readonly ok: false; readonly error: DestinationNameError }

function lastSegment(p: string): string {
  const segments = splitSegments(p)
  return segments[segments.length - 1] ?? ''
}

/** Pure core of every move: where does `sourcePath` go, without overwriting anything? */
export function resolveDestination(options: DestinationNameOptions): DestinationNameResult {
  const { root, folder, sourcePath, recursive, exists } = options
  const sep = separatorOf(root)
  const dir = `${root.replace(/[\\/]+$/, '')}${sep}${folder}`
  const baseName = lastSegment(sourcePath)
  let wanted = baseName
  if (recursive) {
    const prefix = recursivePrefix(root, sourcePath)
    if (prefix === null) return { ok: false, error: 'OUTSIDE_ROOT' }
    wanted = prefixedName(baseName, prefix)
  }
  const maxAttempts = options.maxAttempts ?? 10000
  for (let n = 0; n <= maxAttempts; n += 1) {
    const limited = limitName(collisionName(wanted, n), dir)
    if (limited === null) return { ok: false, error: 'NAME_TOO_LONG' }
    const path = `${dir}${sep}${limited}`
    if (!exists(path)) return { ok: true, value: { name: limited, dir, path, collisions: n } }
  }
  return { ok: false, error: 'TOO_MANY_COLLISIONS' }
}
