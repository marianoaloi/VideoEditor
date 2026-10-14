/**
 * Converted image preview (image-triage.md §5): the original file is NEVER rewritten. When it has
 * a missing JPEG/PNG trailer, cannot be shown by `<img>` (tif/heic) or the renderer reports a
 * load error, a decoded JPEG copy goes to a cache folder outside the user's folder.
 * Exposed as the `media:imagePreview` channel.
 */
import { createHash } from 'node:crypto'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import type { ImageRef } from '@shared/domain/media'
import { toMediaUrl } from '@shared/ipc/mediaUrl'
import type { MainContext } from '../../ipc/context'
import { allowProducedFile } from './access'

const TRAILER_CHECKED = new Set(['.jpg', '.jpeg', '.jpe', '.jfif', '.png'])
const NOT_BROWSER_NATIVE = new Set(['.tif', '.tiff', '.heic', '.heif'])

export type PreviewReason = 'trailer-missing' | 'not-browser-native' | 'forced'

export interface PreviewResult {
  /** `null` reason: the original can be shown as is. */
  readonly reason: PreviewReason | null
  readonly preview: ImageRef | null
}

/** JPEG ends with `FF D9`, PNG with the `60 82` tail of its IEND CRC. */
export async function hasTrailer(file: string): Promise<boolean> {
  const handle = await open(file, 'r')
  try {
    const { size } = await handle.stat()
    if (size < 2) return false
    const tail = Buffer.alloc(2)
    await handle.read(tail, 0, 2, size - 2)
    return (tail[0] === 0xff && tail[1] === 0xd9) || (tail[0] === 0x60 && tail[1] === 0x82)
  } finally {
    await handle.close()
  }
}

export function createPreviewService(ctx: MainContext): {
  preview(file: string, force?: boolean): Promise<PreviewResult>
} {
  const dir = path.join(ctx.paths.temp, 'previews')
  const allowed = new Set<string>()

  const reasonFor = async (file: string, force: boolean): Promise<PreviewReason | null> => {
    const ext = path.extname(file).toLowerCase()
    if (force) return 'forced'
    if (NOT_BROWSER_NATIVE.has(ext)) return 'not-browser-native'
    if (TRAILER_CHECKED.has(ext) && !(await hasTrailer(file))) return 'trailer-missing'
    return null
  }

  const convert = async (file: string, target: string): Promise<void> => {
    const tmp = `${target}.${ctx.newId()}.tmp`
    try {
      await sharp(file, { failOn: 'none' }).rotate().jpeg({ quality: 90 }).toFile(tmp)
      await rename(tmp, target)
    } finally {
      await rm(tmp, { force: true })
    }
  }

  return {
    async preview(file, force = false) {
      const reason = await reasonFor(file, force)
      if (reason === null) return { reason, preview: null }
      const info = await stat(file)
      const key = createHash('md5').update(`${file}|${info.size}|${info.mtimeMs}`).digest('hex')
      const target = path.join(dir, `${key}.jpg`)
      if ((await stat(target).catch(() => null)) === null) {
        await mkdir(dir, { recursive: true })
        await convert(file, target)
      }
      if (!allowed.has(target)) {
        await allowProducedFile(ctx.allowlist, target)
        allowed.add(target)
      }
      const meta = await sharp(target).metadata()
      const ref: ImageRef = {
        path: target,
        url: toMediaUrl(target),
        width: meta.width ?? 0,
        height: meta.height ?? 0
      }
      return { reason, preview: ref }
    }
  }
}
