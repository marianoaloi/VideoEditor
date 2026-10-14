/** `media:detectBlackBars`: the pure `detectBars` on a video frame or an (EXIF-oriented) image. */
import sharp from 'sharp'
import type { Rect } from '@shared/domain/geometry'
import type { MediaInfo } from '@shared/domain/media'
import { mediaKindOf } from '@shared/core/mediaKind'
import { detectBars } from '@shared/core/stripBars'
import path from 'node:path'
import { AppError } from '../../ipc/errors'

export interface BlackBarsDeps {
  readonly grabPng: (file: string, atMs: number) => Promise<{ png: Buffer }>
  readonly probe: (file: string) => Promise<MediaInfo>
}

async function decode(input: Buffer | string): Promise<Rect | null> {
  const { data, info } = await sharp(input, { failOn: 'none' })
    .rotate()
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return detectBars({ data, width: info.width, height: info.height, channels: info.channels })
}

export async function detectBlackBars(
  deps: BlackBarsDeps,
  file: string,
  atMs?: number
): Promise<Rect> {
  const kind = mediaKindOf(path.basename(file))
  let rect: Rect | null
  if (kind === 'image') {
    rect = await decode(file)
  } else {
    const at = atMs ?? Math.round((await deps.probe(file)).durationMs / 10)
    rect = await decode((await deps.grabPng(file, at)).png)
  }
  if (rect === null) throw new AppError('NOT_FOUND', 'No picture area found', { path: file })
  return rect
}
