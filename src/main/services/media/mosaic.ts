/**
 * The 4x4 thumbnail mosaic (duplicates-thumbs.md §6). Always exactly 16 tiles of 75x75 (resize to
 * 115x115 stretched, centre crop 20 px per side) in a 300x300 JPEG q95, cached as `<md5>.jpeg`
 * where `md5` is the hash of the file CONTENT (so renames keep the cache and legacy files are
 * reused). Failures and all-black results are never cached.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import type { ImageRef, MediaInfo } from '@shared/domain/media'
import { toMediaUrl } from '@shared/ipc/mediaUrl'
import { AppError } from '../../ipc/errors'
import type { MainContext } from '../../ipc/context'
import { requireTool } from '../ffmpeg/locate'
import { allowProducedFile } from './access'
import { ffmpegToBuffer } from './ffmpegBuffer'
import { roundHalfEven } from './frames'

export const TILE = 75
export const TILE_CUT = 20
export const GRID = 4
export const MOSAIC_SIZE = TILE * GRID
const TILES = GRID * GRID
const JPEG_QUALITY = 95
const TILE_CONCURRENCY = 4

/** Frame indexes of the 16 tiles (EM:97-114 with the port spec: step >= 1, black when short). */
export function tileFrameIndexes(frameCount: number, fps: number): number[] {
  let skip = Math.trunc(fps * 10)
  let n = frameCount - 2 * skip
  if (n <= TILES) {
    n = frameCount
    skip = 0
  }
  n = Math.max(1, Math.trunc(n))
  const step = Math.max(1, Math.floor(n / TILES))
  return Array.from({ length: Math.min(TILES, n) }, (_, k) => skip + k * step)
}

export function md5OfFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5')
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

export interface MosaicService {
  get(file: string, options?: { force?: boolean; signal?: AbortSignal }): Promise<ImageRef>
  cacheDir(): string
}

export interface MosaicDeps {
  readonly ctx: MainContext
  readonly probe: (file: string) => Promise<MediaInfo>
}

export function createMosaicService(deps: MosaicDeps): MosaicService {
  const { ctx } = deps
  const md5Memo = new Map<string, string>()
  const inFlight = new Map<string, Promise<ImageRef>>()
  const allowed = new Set<string>()

  const cacheDir = (): string =>
    ctx.settings.get().thumbs.cacheDir ?? path.join(ctx.paths.userData, 'thumbs')

  const contentKey = async (file: string): Promise<string> => {
    const info = await stat(file)
    const memoKey = `${file}|${info.size}|${info.mtimeMs}`
    const known = md5Memo.get(memoKey)
    if (known !== undefined) return known
    const md5 = await md5OfFile(file)
    md5Memo.set(memoKey, md5)
    return md5
  }

  const tile = async (
    file: string,
    index: number,
    fps: number,
    signal?: AbortSignal
  ): Promise<Buffer | null> => {
    const resize = TILE + 2 * TILE_CUT
    const result = await ffmpegToBuffer({
      ffmpegPath: requireTool('ffmpeg', ctx.settings.get().ffmpeg).path,
      args: [
        ...['-ss', (index / fps).toFixed(3), '-i', file, '-frames:v', '1', '-an', '-sn'],
        ...['-vf', `scale=${resize}:${resize},crop=${TILE}:${TILE}:${TILE_CUT}:${TILE_CUT}`],
        ...['-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']
      ],
      ...(signal === undefined ? {} : { signal })
    })
    return result.ok && result.data.length === TILE * TILE * 3 ? result.data : null
  }

  const decodeTiles = async (
    file: string,
    info: MediaInfo,
    signal?: AbortSignal
  ): Promise<(Buffer | null)[]> => {
    const fps = info.fps !== null && info.fps > 0 ? info.fps : 25
    const frames = Math.max(1, roundHalfEven((info.durationMs / 1000) * fps))
    const indexes = tileFrameIndexes(frames, fps)
    const tiles: (Buffer | null)[] = new Array(TILES).fill(null)
    let next = 0
    const worker = async (): Promise<void> => {
      for (let k = next++; k < indexes.length; k = next++) {
        tiles[k] = await tile(file, indexes[k] as number, fps, signal)
      }
    }
    await Promise.all(Array.from({ length: TILE_CONCURRENCY }, worker))
    return tiles
  }

  const compose = async (tiles: (Buffer | null)[]): Promise<Buffer> => {
    const overlays = tiles.flatMap((data, k) =>
      data === null
        ? []
        : [
            {
              input: data,
              raw: { width: TILE, height: TILE, channels: 3 as const },
              left: (k % GRID) * TILE,
              top: Math.floor(k / GRID) * TILE
            }
          ]
    )
    return sharp({
      create: { width: MOSAIC_SIZE, height: MOSAIC_SIZE, channels: 3, background: '#000000' }
    })
      .composite(overlays)
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer()
  }

  const toRef = async (cached: string): Promise<ImageRef> => {
    if (!allowed.has(cached)) {
      await allowProducedFile(ctx.allowlist, cached)
      allowed.add(cached)
    }
    const [info, meta] = await Promise.all([stat(cached), sharp(cached).metadata()])
    return {
      path: cached,
      url: toMediaUrl(cached, { version: Math.round(info.mtimeMs) }),
      width: meta.width ?? MOSAIC_SIZE,
      height: meta.height ?? MOSAIC_SIZE
    }
  }

  const build = async (
    file: string,
    options: { force?: boolean; signal?: AbortSignal }
  ): Promise<ImageRef> => {
    const dir = cacheDir()
    const cached = path.join(dir, `${await contentKey(file)}.jpeg`)
    if (options.force !== true) {
      const hit = await stat(cached).catch(() => null)
      if (hit !== null && hit.size > 0) return toRef(cached)
    }
    const info = await deps.probe(file)
    if (!info.hasVideo)
      throw new AppError('PROCESS_FAILED', 'No video stream to build a mosaic', { path: file })
    const tiles = await decodeTiles(file, info, options.signal)
    if (options.signal?.aborted === true) throw new AppError('CANCELLED', 'Mosaic cancelled')
    if (tiles.every((t) => t === null)) {
      throw new AppError('PROCESS_FAILED', 'No decodable frame for the mosaic', { path: file })
    }
    await mkdir(dir, { recursive: true })
    const tmp = `${cached}.${ctx.newId()}.tmp`
    try {
      await writeFile(tmp, await compose(tiles))
      await rename(tmp, cached)
    } finally {
      await rm(tmp, { force: true })
    }
    return toRef(cached)
  }

  const get: MosaicService['get'] = (file, options = {}) => {
    if (options.force !== true) {
      const running = inFlight.get(file)
      if (running !== undefined) return running
    }
    const pending = build(file, options).finally(() => inFlight.delete(file))
    inFlight.set(file, pending)
    return pending
  }

  return { get, cacheDir }
}
