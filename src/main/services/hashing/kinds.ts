/**
 * Which files a scan kind accepts (research §2 table, port checklist item 1). Matching is on the
 * lower-cased extension of the FILE NAME (legacy bug B6 matched substrings of the whole path).
 */
import { extname } from 'node:path'
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

export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  'mp4',
  'm4v',
  'mov',
  'qt',
  'avi',
  'mkv',
  'webm',
  'mpg',
  'mpeg',
  'mpe',
  'm1v',
  'wmv',
  'asf',
  'flv',
  'f4v',
  '3gp',
  '3g2',
  '3gpp',
  'ogv',
  'ts',
  'mts',
  'm2ts',
  'vob',
  'divx'
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
      return VIDEO_EXTENSIONS.has(ext)
    case 'gif':
      return ext === 'gif'
  }
}
