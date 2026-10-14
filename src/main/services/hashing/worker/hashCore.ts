/**
 * Everything heavy about hashing (sharp decode, per-pixel loops, ffmpeg frame handling). It runs
 * inside a worker thread (`hashWorker.ts`) so the main process stays responsive; it is also
 * importable directly for tests and the inline provider.
 *
 * Memory: at most one full-resolution picture or video frame is alive at a time per worker.
 * Video frames are NOT downscaled by ffmpeg: the legacy `cv2.resize(INTER_LINEAR)` is a 2x2-tap
 * bilinear from the full frame, and a scaler (bicubic by default) in front would change the 40x40
 * thumbnail and so every key (research duplicates-thumbs §4.1, §5).
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open } from 'node:fs/promises'
import sharp from 'sharp'
import {
  LEGACY_BLUR_CASCADE,
  computeKeys,
  frameIndexForMs,
  frameTimesMs,
  hasSignal,
  makeThumb,
  rgbToPillowL,
  seekSecondsForIndex,
  type PerceptualKeys,
  type RawImage
} from '@shared/core/hashPrimitives'
import { probeMedia } from '../../ffmpeg/probe'
import { spawnStream } from '../../process/run'
import { DEFAULT_MAX_PIXELS, type WorkerTools } from './protocol'

const JPEG_EOI = [0xff, 0xd9]
const PNG_TAIL = [0x60, 0x82]
const FALLBACK_FPS = 25

export const md5Hex = (data: Uint8Array): string => createHash('md5').update(data).digest('hex')

/** Last two bytes of the file (fewer if the file is shorter). */
export async function readTail(path: string): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const length = Math.min(2, size)
    const buffer = Buffer.alloc(length)
    if (length > 0) await handle.read(buffer, 0, length, size - length)
    return buffer
  } finally {
    await handle.close()
  }
}

function endsWith(tail: Buffer, bytes: readonly number[]): boolean {
  return tail.length === 2 && tail[0] === bytes[0] && tail[1] === bytes[1]
}

/** Legacy `imageBase` decides colour vs grey from the trailer, not from the type (LM:97-99). */
export function usesColourPath(tail: Buffer): boolean {
  return endsWith(tail, JPEG_EOI) || endsWith(tail, PNG_TAIL)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Keeps the three legacy comment prefixes (spelling included, research §2). */
export function legacyImageComment(error: unknown): string {
  const message = messageOf(error)
  if (/unsupported image format|cannot identify|not recognised|unknown (image )?format/i.test(message)) {
    return `Not iddentify is image ${message}`
  }
  return `Not complete image ${message}`
}

function tooLarge(what: string, maxPixels: number): Error {
  const limit = maxPixels >= 1_000_000 ? `${Math.round(maxPixels / 1_000_000)} MP` : `${maxPixels} px`
  return new Error(`${what} too large: more than ${limit} (pixel limit)`)
}

interface RgbBuffer {
  readonly data: Buffer
  readonly width: number
  readonly height: number
  readonly channels: number
}

/** Streams the file into sharp: no whole-file Buffer, and the handle closes when decoding ends. */
function decodeStream(
  path: string,
  strict: boolean,
  autoRotate: boolean,
  maxPixels: number
): Promise<RgbBuffer> {
  return new Promise<RgbBuffer>((resolve, reject) => {
    let pipeline = sharp({ failOn: strict ? 'warning' : 'none', limitInputPixels: maxPixels })
    if (autoRotate) pipeline = pipeline.rotate()
    const source = createReadStream(path)
    source.on('error', (error) => {
      pipeline.destroy()
      reject(error)
    })
    pipeline
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true })
      .then(({ data, info }) => {
        resolve({ data, width: info.width, height: info.height, channels: info.channels })
      }, reject)
    source.pipe(pipeline)
  })
}

/** RGB(A) or grey bytes -> BGR (what `cv2.imread(IMREAD_COLOR)` returns). Swaps in place for 3 channels. */
function toBgr(rgb: RgbBuffer): RawImage {
  const count = rgb.width * rgb.height
  if (rgb.channels === 3) {
    const d = rgb.data
    for (let i = 0; i < count; i++) {
      const at = i * 3
      const r = d[at] as number
      d[at] = d[at + 2] as number
      d[at + 2] = r
    }
    return { width: rgb.width, height: rgb.height, channels: 3, data: d }
  }
  const out = new Uint8Array(count * 3)
  for (let i = 0; i < count; i++) {
    const v = rgb.data[i * rgb.channels] as number
    out[i * 3] = v
    out[i * 3 + 1] = v
    out[i * 3 + 2] = v
  }
  return { width: rgb.width, height: rgb.height, channels: 3, data: out }
}

/** Pillow `convert('L')` at full resolution. */
function toPillowGrey(rgb: RgbBuffer): RawImage {
  const count = rgb.width * rgb.height
  const out = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    const at = i * rgb.channels
    const r = rgb.data[at] as number
    const g = rgb.channels >= 3 ? (rgb.data[at + 1] as number) : r
    const b = rgb.channels >= 3 ? (rgb.data[at + 2] as number) : r
    out[i] = rgbToPillowL(r, g, b)
  }
  return { width: rgb.width, height: rgb.height, channels: 1, data: out }
}

async function readTailOrNotExist(path: string): Promise<Buffer> {
  try {
    return await readTail(path)
  } catch (error) {
    if (Reflect.get(error as object, 'code') === 'ENOENT') throw new Error('Not exist image')
    throw error
  }
}

/** Decodes an image the way `imageBase` does and returns the full-resolution raw pixels. */
export async function decodeImage(path: string, maxPixels = DEFAULT_MAX_PIXELS): Promise<RawImage> {
  const colour = usesColourPath(await readTailOrNotExist(path))
  try {
    return colour
      ? toBgr(await decodeStream(path, false, true, maxPixels))
      : toPillowGrey(await decodeStream(path, true, false, maxPixels))
  } catch (error) {
    if (/pixel limit/i.test(messageOf(error))) throw tooLarge('Image', maxPixels)
    throw new Error(legacyImageComment(error), { cause: error })
  }
}

// ---- video -----------------------------------------------------------------------------------

async function grabBgrFrame(
  tools: WorkerTools,
  path: string,
  seconds: number,
  width: number,
  height: number,
  signal?: AbortSignal
): Promise<RawImage | null> {
  const proc = spawnStream({
    command: tools.ffmpegPath,
    args: [
      '-v', 'error', '-nostdin', '-ss', seconds.toFixed(4), '-i', path,
      '-frames:v', '1', '-an', '-sn', '-f', 'rawvideo', '-pix_fmt', 'bgr24', 'pipe:1'
    ],
    captureStdout: false,
    timeoutMs: 120_000,
    ...(signal === undefined ? {} : { signal })
  })
  const expected = width * height * 3
  const data = Buffer.allocUnsafe(expected)
  let filled = 0
  for await (const chunk of proc.stdout) {
    const part = chunk as Buffer
    const room = expected - filled
    if (room > 0) filled += part.copy(data, filled, 0, Math.min(part.length, room))
  }
  await proc.done
  return filled < expected ? null : { width, height, channels: 3, data }
}

/** Frame indices for the legacy timestamps, first occurrence kept (identical rows add nothing). */
export function frameIndices(durationMs: number, fps: number): number[] {
  const seen = new Set<number>()
  for (const ms of frameTimesMs(durationMs)) seen.add(frameIndexForMs(ms, fps))
  return [...seen]
}

export async function hashImageFile(
  path: string,
  cascade: boolean = LEGACY_BLUR_CASCADE,
  maxPixels = DEFAULT_MAX_PIXELS
): Promise<PerceptualKeys[]> {
  return [computeKeys(makeThumb(await decodeImage(path, maxPixels)), md5Hex, cascade)]
}

export async function hashVideoFile(
  path: string,
  tools: WorkerTools,
  cascade: boolean = LEGACY_BLUR_CASCADE,
  maxPixels = DEFAULT_MAX_PIXELS,
  signal?: AbortSignal
): Promise<PerceptualKeys[]> {
  const info = await probeMedia(path, {
    ffprobePath: tools.ffprobePath,
    ...(signal === undefined ? {} : { signal })
  })
  const { displayWidth: w, displayHeight: h } = info
  if (!info.hasVideo || w === 0 || h === 0) throw new Error('no video stream')
  if (w * h > maxPixels) throw tooLarge('Video frame', maxPixels)
  const fps = info.fps !== null && info.fps > 0 ? info.fps : FALLBACK_FPS
  const keys: PerceptualKeys[] = []
  for (const index of frameIndices(info.durationMs, fps)) {
    signal?.throwIfAborted()
    const frame = await grabBgrFrame(tools, path, seekSecondsForIndex(index, fps), w, h, signal)
    if (frame === null) continue
    const thumb = makeThumb(frame)
    if (hasSignal(thumb)) keys.push(computeKeys(thumb, md5Hex, cascade))
  }
  return keys
}
