/**
 * Which file names count as videos in Video Triage (video-triage.md §1.3). Replaces the legacy
 * `mimetypes` + `mimetype -b` shell-out. Case-insensitive; the `.3gp` family is matched by
 * extension only (never by a substring of the whole path).
 */
import { extname } from './paths'

export const DEFAULT_VIDEO_EXTENSIONS: readonly string[] = [
  '.mp4', '.m4v', '.mov', '.qt', '.avi', '.mkv', '.webm', '.mpg', '.mpeg', '.mpe', '.mpa',
  '.m1v', '.m2v', '.mpv', '.wmv', '.asf', '.flv', '.f4v', '.ogv', '.3gp', '.3gpp', '.3g2',
  '.ts', '.mts', '.m2ts', '.vob', '.divx', '.movie'
]

const DEFAULT_SET: ReadonlySet<string> = new Set(DEFAULT_VIDEO_EXTENSIONS)

/** Normalises `mp4`, `.MP4` to `.mp4`; `''` stays `''`. */
export function normaliseExtension(extension: string): string {
  const trimmed = extension.trim().toLowerCase()
  if (trimmed === '') return ''
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`
}

/** True when `fileName` (or a full path) has a video extension from `extensions`. */
export function isVideoFileName(
  fileName: string,
  extensions: readonly string[] = DEFAULT_VIDEO_EXTENSIONS
): boolean {
  const ext = extname(fileName).toLowerCase()
  if (ext === '') return false
  if (extensions === DEFAULT_VIDEO_EXTENSIONS) return DEFAULT_SET.has(ext)
  return extensions.some((candidate) => normaliseExtension(candidate) === ext)
}
