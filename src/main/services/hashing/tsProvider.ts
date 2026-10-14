/**
 * Pure-TS hash provider (ADR-007): Node crypto + sharp (images) + ffmpeg raw frames (videos).
 *
 * WHERE THIS APPROXIMATES THE LEGACY PYTHON (research §4.4). `md5` of the file is exact and is
 * computed by the scanner. The perceptual keys cannot be bit-identical:
 *   1. Colour decode: sharp/libvips instead of OpenCV `imread`. Same libjpeg-turbo/libpng defaults
 *      for baseline 8-bit files; ICC profiles are converted to sRGB by sharp (OpenCV ignores them),
 *      and 16-bit PNG / CMYK may differ. EXIF orientation is applied (`rotate()`), like `imread`.
 *   2. Grey decode (files whose last two bytes are not FF D9 / 60 82): Pillow's `convert('L')`
 *      integer weights applied to sharp's RGB at full resolution (never `greyscale()`, which is
 *      linear-light). No EXIF rotation, like Pillow.
 *   3. `cv2.resize(INTER_LINEAR)` is re-implemented in fixed point (`makeThumb`); OpenCV's SIMD
 *      paths can differ by +-1 level.
 *   4. Videos: ffmpeg decodes one full-resolution `bgr24` frame per timestamp instead of
 *      `cv2.VideoCapture`; seeking, swscale colour matrix and frame selection can differ by a few
 *      levels. The clip length is ffprobe's `duration` (legacy: frame_count/fps), fps is the
 *      stream `avg_frame_rate` (fallback 25).
 * Everything after the 40x40 thumbnail (blur, thresholds, MD5, average hash) is bit-exact.
 */
import { open, readFile } from 'node:fs/promises'
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
  type Md5Fn,
  type PerceptualKeys,
  type RawImage
} from '@shared/core/hashPrimitives'
import { spawnStream } from '../process/run'
import { probeMedia } from '../ffmpeg/probe'
import type { HashProvider } from './provider'

export interface ToolPaths {
  readonly ffmpegPath: string
  readonly ffprobePath: string
}

export interface TsProviderOptions {
  readonly md5: Md5Fn
  /** Resolved lazily so image-only scans never need ffmpeg. */
  readonly tools: () => ToolPaths
  readonly cascade?: boolean
}

const JPEG_EOI = [0xff, 0xd9]
const PNG_TAIL = [0x60, 0x82]
const FALLBACK_FPS = 25

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

interface RgbBuffer {
  readonly data: Buffer
  readonly width: number
  readonly height: number
  readonly channels: number
}

async function decodeRgb(
  file: Buffer,
  strict: boolean,
  autoRotate: boolean
): Promise<RgbBuffer> {
  let pipeline = sharp(file, {
    failOn: strict ? 'warning' : 'none',
    limitInputPixels: false
  })
  if (autoRotate) pipeline = pipeline.rotate()
  const { data, info } = await pipeline
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

/** RGB(A) or grey bytes -> BGR bytes (what `cv2.imread(IMREAD_COLOR)` returns). */
function toBgr(rgb: RgbBuffer): RawImage {
  const count = rgb.width * rgb.height
  const out = new Uint8Array(count * 3)
  for (let i = 0; i < count; i++) {
    const at = i * rgb.channels
    const r = rgb.data[at] as number
    const g = rgb.channels >= 3 ? (rgb.data[at + 1] as number) : r
    const b = rgb.channels >= 3 ? (rgb.data[at + 2] as number) : r
    out[i * 3] = b
    out[i * 3 + 1] = g
    out[i * 3 + 2] = r
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

/** Decodes an image the way `imageBase` does and returns the full-resolution raw pixels. */
export async function decodeImage(path: string): Promise<RawImage> {
  let file: Buffer
  try {
    // Read into memory and hand sharp a Buffer: a path would keep the file open on Windows and
    // block the Move to R that follows a scan.
    file = await readFile(path)
  } catch (error) {
    if (Reflect.get(error as object, 'code') === 'ENOENT') throw new Error('Not exist image')
    throw error
  }
  try {
    if (usesColourPath(file.subarray(Math.max(0, file.length - 2)))) {
      return toBgr(await decodeRgb(file, false, true))
    }
    return toPillowGrey(await decodeRgb(file, true, false))
  } catch (error) {
    throw new Error(legacyImageComment(error), { cause: error })
  }
}

// ---- video -----------------------------------------------------------------------------------

async function grabBgrFrame(
  tools: ToolPaths,
  path: string,
  seconds: number,
  width: number,
  height: number,
  signal?: AbortSignal
): Promise<RawImage | null> {
  const proc = spawnStream({
    command: tools.ffmpegPath,
    args: [
      '-v',
      'error',
      '-nostdin',
      '-ss',
      seconds.toFixed(4),
      '-i',
      path,
      '-frames:v',
      '1',
      '-an',
      '-sn',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'bgr24',
      'pipe:1'
    ],
    captureStdout: false,
    timeoutMs: 120_000,
    ...(signal === undefined ? {} : { signal })
  })
  const chunks: Buffer[] = []
  for await (const chunk of proc.stdout) chunks.push(chunk as Buffer)
  await proc.done
  const data = Buffer.concat(chunks)
  const expected = width * height * 3
  if (data.length < expected) return null
  return { width, height, channels: 3, data: data.subarray(0, expected) }
}

/** Frame indices for the legacy timestamps, first occurrence kept (identical rows add nothing). */
export function frameIndices(durationMs: number, fps: number): number[] {
  const seen = new Set<number>()
  for (const ms of frameTimesMs(durationMs)) seen.add(frameIndexForMs(ms, fps))
  return [...seen]
}

export function createTsHashProvider(options: TsProviderOptions): HashProvider {
  const cascade = options.cascade ?? LEGACY_BLUR_CASCADE
  const keysOf = (thumb: RawImage): PerceptualKeys => computeKeys(thumb, options.md5, cascade)

  async function hashImage(path: string): Promise<PerceptualKeys[]> {
    return [keysOf(makeThumb(await decodeImage(path)))]
  }

  async function hashVideo(path: string, signal?: AbortSignal): Promise<PerceptualKeys[]> {
    const tools = options.tools()
    const info = await probeMedia(path, {
      ffprobePath: tools.ffprobePath,
      ...(signal === undefined ? {} : { signal })
    })
    if (!info.hasVideo || info.displayWidth === 0 || info.displayHeight === 0) {
      throw new Error('no video stream')
    }
    const fps = info.fps !== null && info.fps > 0 ? info.fps : FALLBACK_FPS
    const keys: PerceptualKeys[] = []
    for (const index of frameIndices(info.durationMs, fps)) {
      signal?.throwIfAborted()
      const seconds = seekSecondsForIndex(index, fps)
      const frame = await grabBgrFrame(
        tools,
        path,
        seconds,
        info.displayWidth,
        info.displayHeight,
        signal
      )
      if (frame === null) continue
      const thumb = makeThumb(frame)
      if (hasSignal(thumb)) keys.push(keysOf(thumb))
    }
    return keys
  }

  return { id: 'ts-sharp-ffmpeg', hashImage, hashVideo }
}
