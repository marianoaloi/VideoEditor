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

export interface LimitOptions {
  /** Characters to keep free after the name (e.g. 5 for the sidecar suffix `.json`). Default 0. */
  readonly reserve?: number
  /** Also bound the UTF-8 byte length to 255 (Linux/macOS file systems count bytes). Default false. */
  readonly byteLimit?: boolean
}

function utf8Length(text: string): number {
  let bytes = 0
  for (const point of text) {
    const code = point.codePointAt(0) ?? 0
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}

/**
 * Applies the 254 (whole path) and 255 (name) bounds by dropping characters from the START,
 * whole code points at a time (a surrogate pair is never cut in half). `reserve` keeps room for
 * a sidecar suffix; `byteLimit` adds the 255-byte rule of POSIX file systems.
 * `destDir` is the destination folder (`<root>/<folder>`). Returns `null` when no usable name
 * is left (the extension plus at least one character would not fit): the caller refuses the move.
 */
export function limitName(name: string, destDir: string, options: LimitOptions = {}): string | null {
  const reserve = options.reserve ?? 0
  const fits = (candidate: string): boolean =>
    destDir.length + 1 + candidate.length + reserve <= MAX_DEST_PATH_LENGTH &&
    candidate.length + reserve <= MAX_NAME_LENGTH &&
    (options.byteLimit !== true || utf8Length(candidate) + reserve <= MAX_NAME_LENGTH)
  if (fits(name)) return name
  const points = Array.from(name)
  let start = 1
  while (start < points.length && !fits(points.slice(start).join(''))) start += 1
  const result = points.slice(start).join('')
  return result.length <= splitExt(name).ext.length || !fits(result) ? null : result
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
  /** Name-length options (sidecar reserve, POSIX byte limit); see `limitName`. */
  readonly limits?: LimitOptions
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
    const limited = limitName(collisionName(wanted, n), dir, options.limits)
    if (limited === null) return { ok: false, error: 'NAME_TOO_LONG' }
    const path = `${dir}${sep}${limited}`
    if (!exists(path)) return { ok: true, value: { name: limited, dir, path, collisions: n } }
  }
  return { ok: false, error: 'TOO_MANY_COLLISIONS' }
}
