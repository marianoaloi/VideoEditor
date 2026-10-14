/** `media:probe` / `media:probeMany`: ffprobe with a cache keyed by path + mtime + size. */
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { MediaInfo, ProbeManyResult } from '@shared/domain/media'
import { AppError, toIpcError } from '../../ipc/errors'
import { requireTool, type FfmpegToolsConfig } from '../ffmpeg/locate'
import { probeMedia } from '../ffmpeg/probe'

const MAX_ENTRIES = 2000
const PROBE_MANY_CONCURRENCY = 4

export interface ProbeService {
  probe(file: string, signal?: AbortSignal): Promise<MediaInfo>
  probeMany(files: readonly string[]): Promise<ProbeManyResult>
}

async function cacheKey(file: string): Promise<string> {
  try {
    const info = await stat(file)
    if (!info.isFile()) throw new AppError('NOT_FOUND', 'Not a file', { path: file })
    return `${file}|${info.mtimeMs}|${info.size}`
  } catch (error: unknown) {
    if (error instanceof AppError) throw error
    throw new AppError('PROBE_FAILED', `Cannot read ${path.basename(file)}`, { path: file })
  }
}

export function createProbeService(config: () => FfmpegToolsConfig): ProbeService {
  const cache = new Map<string, Promise<MediaInfo>>()

  const remember = (key: string, value: Promise<MediaInfo>): void => {
    cache.set(key, value)
    value.catch(() => cache.delete(key))
    if (cache.size > MAX_ENTRIES) {
      const oldest = cache.keys().next()
      if (oldest.done !== true) cache.delete(oldest.value)
    }
  }

  const probe = async (file: string, signal?: AbortSignal): Promise<MediaInfo> => {
    const key = await cacheKey(file)
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    const ffprobePath = requireTool('ffprobe', config()).path
    const pending = probeMedia(file, { ffprobePath, ...(signal === undefined ? {} : { signal }) })
    remember(key, pending)
    return pending
  }

  const probeMany = async (files: readonly string[]): Promise<ProbeManyResult> => {
    const results: ProbeManyResult['results'] = new Array(files.length)
    let next = 0
    const worker = async (): Promise<void> => {
      for (let i = next++; i < files.length; i = next++) {
        const file = files[i] as string
        try {
          results[i] = { ok: true, path: file, info: await probe(file) }
        } catch (error: unknown) {
          results[i] = { ok: false, path: file, error: toIpcError(error) }
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(PROBE_MANY_CONCURRENCY, files.length) }, worker)
    )
    return { results }
  }

  return { probe, probeMany }
}
