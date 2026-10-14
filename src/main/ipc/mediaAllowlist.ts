/**
 * The `media://` allowlist (ADR-003): open session roots, the thumbnail cache and temp frame
 * files. The protocol handler asks `isAllowed(path)` AFTER `parseMediaUrl`; it must also resolve
 * symlinks (`fs.realpath`) and check the real path again before it opens the file.
 */
import path from 'node:path'

export interface MediaAllowlist {
  /** Allows everything under `dir`. Reference-counted: each `addRoot` needs one `removeRoot`. */
  addRoot(dir: string): void
  removeRoot(dir: string): void
  /** Allows exactly one file (temp frames, mosaics). Reference-counted like roots. */
  addFile(file: string): void
  removeFile(file: string): void
  /** `path.resolve`s the input, so `..` segments and mixed separators cannot escape a root. */
  isAllowed(candidate: string): boolean
  roots(): string[]
}

function normalise(p: string, platform: NodeJS.Platform): string {
  const resolved = platform === 'win32' ? path.win32.resolve(p) : path.posix.resolve(p)
  const trimmed = resolved.length > 3 ? resolved.replace(/[\\/]+$/, '') : resolved
  return platform === 'win32' ? trimmed.toLowerCase() : trimmed
}

export function createMediaAllowlist(platform: NodeJS.Platform = process.platform): MediaAllowlist {
  const rootCounts = new Map<string, number>()
  const fileCounts = new Map<string, number>()
  const sep = platform === 'win32' ? '\\' : '/'

  const bump = (map: Map<string, number>, key: string, by: number): void => {
    const next = (map.get(key) ?? 0) + by
    if (next <= 0) map.delete(key)
    else map.set(key, next)
  }

  const isAbsolute = (p: string): boolean =>
    platform === 'win32' ? path.win32.isAbsolute(p) : path.posix.isAbsolute(p)

  return {
    addRoot(dir) {
      if (isAbsolute(dir)) bump(rootCounts, normalise(dir, platform), 1)
    },
    removeRoot(dir) {
      bump(rootCounts, normalise(dir, platform), -1)
    },
    addFile(file) {
      if (isAbsolute(file)) bump(fileCounts, normalise(file, platform), 1)
    },
    removeFile(file) {
      bump(fileCounts, normalise(file, platform), -1)
    },
    isAllowed(candidate) {
      if (candidate.length === 0 || candidate.includes('\0') || !isAbsolute(candidate)) return false
      const target = normalise(candidate, platform)
      if (fileCounts.has(target)) return true
      for (const root of rootCounts.keys()) {
        const prefix = root.endsWith(sep) ? root : root + sep
        if (target.startsWith(prefix)) return true
      }
      return false
    },
    roots() {
      return [...rootCounts.keys()]
    }
  }
}
