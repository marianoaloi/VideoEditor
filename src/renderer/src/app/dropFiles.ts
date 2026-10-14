/**
 * Drag-and-drop helper (ADR-003): turns a `DataTransfer` into absolute paths through
 * `webUtils.getPathForFile` (via `pathForFile`). Folders are separated from files; only the
 * extension decides whether a file is a video (`mediaKindOf`).
 */
import { mediaKindOf } from '@shared/core/mediaKind'
import { pathForFile } from './api'

export interface DroppedPaths {
  /** Absolute paths of dropped video files, in drop order and without duplicates. */
  videos: string[]
  /** Dropped folders. */
  folders: string[]
  /** Names of files that are neither folders nor videos (or have no path). */
  ignored: string[]
}

interface Candidate {
  file: File
  isDirectory: boolean
}

function candidates(data: DataTransfer): Candidate[] {
  const result: Candidate[] = []
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file === null) continue
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
    result.push({ file, isDirectory: entry?.isDirectory === true })
  }
  if (result.length > 0) return result
  return Array.from(data.files ?? []).map((file) => ({ file, isDirectory: false }))
}

export function collectDroppedPaths(data: DataTransfer): DroppedPaths {
  const out: DroppedPaths = { videos: [], folders: [], ignored: [] }
  const seen = new Set<string>()
  for (const { file, isDirectory } of candidates(data)) {
    const path = pathForFile(file)
    if (path === '') {
      out.ignored.push(file.name)
      continue
    }
    if (seen.has(path)) continue
    seen.add(path)
    if (isDirectory) out.folders.push(path)
    else if (mediaKindOf(file.name) === 'video') out.videos.push(path)
    else out.ignored.push(file.name)
  }
  return out
}
