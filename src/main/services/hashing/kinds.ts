/**
 * Which files a scan kind accepts (research §2 table, port checklist item 1). Matching is on the
 * lower-cased extension of the FILE NAME (legacy bug B6 matched substrings of the whole path).
 */
import { extname } from 'node:path'
import { isVideoFileName } from '@shared/core/videoExtensions'
import type { HashKind } from '@shared/domain/hash'

export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'jpg',
  'jpeg',
  'jpe',
  'jfif',
  'png',
  'gif',
  'bmp',
  'webp',
  'tif',
  'tiff',
  'avif',
  'heic',
  'heif'
])

function extensionOf(fileName: string): string {
  return extname(fileName).slice(1).toLowerCase()
}

export function acceptsFile(kind: HashKind, fileName: string): boolean {
  const ext = extensionOf(fileName)
  switch (kind) {
    case 'image':
      return IMAGE_EXTENSIONS.has(ext)
    case 'video':
      return isVideoFileName(fileName)
    case 'gif':
      return ext === 'gif'
  }
}
