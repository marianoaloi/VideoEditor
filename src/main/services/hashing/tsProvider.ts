/**
 * Pure-TS hash provider (ADR-007): Node crypto + sharp (images) + ffmpeg raw frames (videos).
 *
 * All heavy work (decode, pixel loops, ffmpeg frames) runs in a bounded `worker_threads` pool
 * (`worker/`) so the main process stays responsive during a scan. `inline: true` runs the same
 * code on the calling thread (tests, tools). See `worker/hashCore.ts` for the algorithm.
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
import { LEGACY_BLUR_CASCADE, type Md5Fn, type PerceptualKeys } from '@shared/core/hashPrimitives'
import type { HashProvider } from './provider'
import { hashImageFile, hashVideoFile } from './worker/hashCore'
import { HashWorkerPool, defaultWorkerCount } from './worker/pool'
import { DEFAULT_MAX_PIXELS } from './worker/protocol'

export { decodeImage, frameIndices, legacyImageComment, readTail, usesColourPath } from './worker/hashCore'

export interface ToolPaths {
  readonly ffmpegPath: string
  readonly ffprobePath: string
}

export interface TsProviderOptions {
  /** Used only by `inline` mode; workers always compute MD5 with Node crypto (same bytes). */
  readonly md5?: Md5Fn
  /** Resolved lazily so image-only scans never need ffmpeg. */
  readonly tools: () => ToolPaths
  readonly cascade?: boolean
  /** Worker threads. Default min(3, cores - 1), at least 1. */
  readonly workers?: number
  /** Max decoded pixels per image / video frame. Default 268 MP. */
  readonly maxPixels?: number
  /** Run on the calling thread instead of the pool. */
  readonly inline?: boolean
  /** Override the worker script path (tests; the default is the electron-vite bundle). */
  readonly workerPath?: () => Promise<string> | string
}

/** Built/dev app: the electron-vite chunk. Elsewhere (Vitest): an esbuild bundle of the worker. */
async function bundledWorkerPath(): Promise<string> {
  const bundled: unknown = (await import('./worker/workerPath')).default
  if (typeof bundled === 'string') return bundled
  return (await import('./worker/devWorker')).devWorkerPath()
}

export interface DisposableHashProvider extends HashProvider {
  /** Stops the worker threads. Safe to call twice. */
  dispose(): Promise<void>
}

function inlineProvider(o: TsProviderOptions, cascade: boolean, maxPixels: number): DisposableHashProvider {
  return {
    id: 'ts-sharp-ffmpeg',
    hashImage: (path) => hashImageFile(path, cascade, maxPixels),
    hashVideo: (path, signal) => hashVideoFile(path, o.tools(), cascade, maxPixels, signal),
    dispose: () => Promise.resolve()
  }
}

export function createTsHashProvider(options: TsProviderOptions): DisposableHashProvider {
  const cascade = options.cascade ?? LEGACY_BLUR_CASCADE
  const maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS
  if (options.inline === true) return inlineProvider(options, cascade, maxPixels)
  const pool = new HashWorkerPool({
    size: options.workers ?? defaultWorkerCount(),
    workerPath: options.workerPath ?? bundledWorkerPath
  })
  const run = (spec: Parameters<HashWorkerPool['run']>[0], signal?: AbortSignal): Promise<PerceptualKeys[]> =>
    pool.run(spec, signal)
  return {
    id: 'ts-sharp-ffmpeg',
    hashImage: (path, signal) => run({ op: 'image', path, cascade, maxPixels }, signal),
    hashVideo: (path, signal) =>
      run({ op: 'video', path, cascade, maxPixels, tools: options.tools() }, signal),
    dispose: () => pool.dispose()
  }
}
