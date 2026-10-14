/**
 * `media:grabFrame` (cutter-crop-zoom.md §3.2, fixing legacy D42): a PNG frame through a
 * three-step chain, then re-encoded for the renderer.
 *   1. `-ss <s> -i <v> -frames:v 1` to a pipe;
 *   2. the same into a temp file (some builds refuse to write PNG to a pipe);
 *   3. the first non-black frame among the legacy 10 % candidates.
 */
import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import type { FrameRef, GrabFrameRequest, MediaInfo } from '@shared/domain/media'
import { toMediaUrl } from '@shared/ipc/mediaUrl'
import { AppError } from '../../ipc/errors'
import type { MainContext } from '../../ipc/context'
import { requireTool } from '../ffmpeg/locate'
import { allowProducedFile } from './access'
import { ffmpegToBuffer } from './ffmpegBuffer'

const KEEP_FRAMES = 24

/** Legacy `getPreview10Perc` candidates (EM:65-70), Python half-even `round`. */
export function tenPercentCandidates(durationMs: number): number[] {
  const d = durationMs
  const t0 = roundHalfEven(d / 10)
  const begin = roundHalfEven(d / 10.3)
  const end = roundHalfEven(d / 9.7)
  const window: number[] = []
  for (let m = begin; m < end; m += 600) window.push(Math.round(m))
  const first: number[] = []
  for (let t = 0; t < Math.min(5000, roundHalfEven(d)); t += 1000) first.push(t)
  return [t0, ...window, ...first]
}

export function roundHalfEven(value: number): number {
  const floor = Math.floor(value)
  const diff = value - floor
  if (diff < 0.5) return floor
  if (diff > 0.5) return floor + 1
  return floor % 2 === 0 ? floor : floor + 1
}

/** True when every sample is 0 (a failed read or a genuinely black frame). */
export async function isBlackImage(image: Buffer): Promise<boolean> {
  const raw = await sharp(image, { failOn: 'none' }).raw().toBuffer()
  for (let i = 0; i < raw.length; i += 1) if (raw[i] !== 0) return false
  return true
}

export interface FrameService {
  /** PNG at source resolution (auto-rotated by ffmpeg). Throws `PROCESS_FAILED`. */
  grabPng(file: string, atMs: number, signal?: AbortSignal): Promise<{ png: Buffer; atMs: number }>
  grab(request: GrabFrameRequest): Promise<FrameRef>
}

export interface FrameDeps {
  readonly ctx: MainContext
  readonly probe: (file: string) => Promise<MediaInfo>
}

export function createFrameService(deps: FrameDeps): FrameService {
  const { ctx } = deps
  const frameDir = path.join(ctx.paths.temp, 'frames')
  const recent: { file: string; allowed: string[] }[] = []
  const ffmpegPath = (): string => requireTool('ffmpeg', ctx.settings.get().ffmpeg).path
  const seek = (ms: number): string => (ms / 1000).toFixed(3)

  const viaPipe = async (
    file: string,
    ms: number,
    signal?: AbortSignal
  ): Promise<Buffer | null> => {
    const result = await ffmpegToBuffer({
      ffmpegPath: ffmpegPath(),
      args: [
        '-ss',
        seek(ms),
        '-i',
        file,
        '-frames:v',
        '1',
        '-an',
        '-sn',
        '-f',
        'image2pipe',
        '-c:v',
        'png',
        'pipe:1'
      ],
      ...(signal === undefined ? {} : { signal })
    })
    return result.ok && result.data.length > 0 ? result.data : null
  }

  const viaFile = async (
    file: string,
    ms: number,
    signal?: AbortSignal
  ): Promise<Buffer | null> => {
    await mkdir(frameDir, { recursive: true })
    const out = path.join(frameDir, `tmp-${ctx.newId()}.png`)
    const result = await ffmpegToBuffer({
      ffmpegPath: ffmpegPath(),
      args: ['-ss', seek(ms), '-i', file, '-frames:v', '1', '-an', '-sn', '-y', out],
      ...(signal === undefined ? {} : { signal })
    })
    try {
      return result.ok ? await readFile(out) : null
    } catch {
      return null // ffmpeg produced nothing: the chain continues
    } finally {
      await rm(out, { force: true })
    }
  }

  const usable = async (png: Buffer | null): Promise<Buffer | null> =>
    png !== null && !(await isBlackImage(png)) ? png : null

  const fromTenPercent = async (
    file: string,
    signal?: AbortSignal
  ): Promise<{ png: Buffer; atMs: number } | null> => {
    const info = await deps.probe(file)
    for (const ms of tenPercentCandidates(info.durationMs)) {
      const png = await usable(await viaPipe(file, ms, signal))
      if (png !== null) return { png, atMs: ms }
    }
    return null
  }

  const grabPng: FrameService['grabPng'] = async (file, atMs, signal) => {
    const first = await usable(await viaPipe(file, atMs, signal))
    if (first !== null) return { png: first, atMs }
    const second = await usable(await viaFile(file, atMs, signal))
    if (second !== null) return { png: second, atMs }
    const third = await fromTenPercent(file, signal)
    if (third !== null) return third
    throw new AppError('PROCESS_FAILED', 'No can get a THUMB to work', { path: file, atMs })
  }

  const forget = async (): Promise<void> => {
    while (recent.length > KEEP_FRAMES) {
      const old = recent.shift()
      if (old === undefined) break
      for (const entry of old.allowed) ctx.allowlist.removeFile(entry)
      await unlink(old.file).catch(() => undefined)
    }
  }

  const grab: FrameService['grab'] = async (request) => {
    const format = request.format ?? 'jpeg'
    const { png, atMs } = await grabPng(request.path, request.atMs)
    let pipeline = sharp(png)
    if (request.maxWidth !== undefined) {
      pipeline = pipeline.resize({ width: request.maxWidth, withoutEnlargement: true })
    }
    pipeline = format === 'png' ? pipeline.png() : pipeline.jpeg({ quality: 92 })
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })
    await mkdir(frameDir, { recursive: true })
    const out = path.join(frameDir, `frame-${ctx.newId()}.${format === 'png' ? 'png' : 'jpg'}`)
    await writeFile(out, data)
    recent.push({ file: out, allowed: await allowProducedFile(ctx.allowlist, out) })
    await forget()
    return {
      path: out,
      url: toMediaUrl(out),
      width: info.width,
      height: info.height,
      sourcePath: request.path,
      atMs
    }
  }

  return { grabPng, grab }
}
