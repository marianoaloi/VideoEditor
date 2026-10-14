/**
 * `jobs:tools`: where ffmpeg/ffprobe are, their versions, the H.264 encoders and the hwaccels
 * `ffmpeg` reports (research §7.4). Results are cached per ffmpeg path until `refresh`.
 */
import type { ToolsStatus } from '@shared/domain/job'
import { toIpcError } from '../../ipc/errors'
import { clearToolCache, locateTools, type FfmpegToolsConfig } from '../ffmpeg/locate'
import { isSuccess, run } from '../process/run'

const QUERY_TIMEOUT_MS = 15_000

async function ffmpegText(ffmpegPath: string, args: string[]): Promise<string> {
  const result = await run({
    command: ffmpegPath,
    args,
    timeoutMs: QUERY_TIMEOUT_MS
  })
  if (!isSuccess(result)) return ''
  return `${result.stdout}\n${result.stderr}`
}

export function parseVersion(text: string): string | null {
  const match = /^(?:ff(?:mpeg|probe)) version (\S+)/im.exec(text)
  return match?.[1] ?? null
}

/** Lines of `ffmpeg -encoders`: ` V....D libx264  ...`; keeps the H.264 video encoders. */
export function parseH264Encoders(text: string): string[] {
  const names: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*V\S{5}\s+(\S+)/.exec(line)
    const name = match?.[1]
    if (name !== undefined && /264/.test(name) && !names.includes(name)) names.push(name)
  }
  return names
}

export function parseHwaccels(text: string): string[] {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => /^hardware acceleration methods:/i.test(line.trim()))
  if (start < 0) return []
  return lines
    .slice(start + 1)
    .map((line) => line.trim())
    .filter((line) => /^[a-z0-9_]+$/i.test(line))
}

interface Cached {
  readonly key: string
  readonly status: ToolsStatus
}
let cached: Cached | null = null

export async function readToolsStatus(
  config: FfmpegToolsConfig,
  refresh: boolean
): Promise<ToolsStatus> {
  if (refresh) {
    clearToolCache()
    cached = null
  }
  const tools = locateTools(config)
  if (tools.ffmpeg === null) {
    return {
      ffmpeg: null,
      ffprobe: null,
      h264Encoders: [],
      hwaccels: [],
      error: {
        code: 'FFMPEG_NOT_FOUND',
        message: 'ffmpeg was not found. Set its path in Settings or add it to PATH.'
      }
    }
  }
  const key = `${tools.ffmpeg.path}|${tools.ffprobe?.path ?? ''}`
  if (cached?.key === key) return cached.status
  try {
    const status = await queryTools(tools.ffmpeg.path, tools.ffprobe?.path ?? null)
    cached = { key, status }
    return status
  } catch (error) {
    return {
      ffmpeg: { path: tools.ffmpeg.path, version: null },
      ffprobe: tools.ffprobe === null ? null : { path: tools.ffprobe.path, version: null },
      h264Encoders: [],
      hwaccels: [],
      error: toIpcError(error)
    }
  }
}

async function queryTools(ffmpegPath: string, ffprobePath: string | null): Promise<ToolsStatus> {
  const [version, encoders, hwaccels, probeVersion] = await Promise.all([
    ffmpegText(ffmpegPath, ['-version']),
    ffmpegText(ffmpegPath, ['-hide_banner', '-encoders']),
    ffmpegText(ffmpegPath, ['-hide_banner', '-hwaccels']),
    ffprobePath === null ? Promise.resolve('') : ffmpegText(ffprobePath, ['-version'])
  ])
  return {
    ffmpeg: { path: ffmpegPath, version: parseVersion(version) },
    ffprobe: ffprobePath === null ? null : { path: ffprobePath, version: parseVersion(probeVersion) },
    h264Encoders: parseH264Encoders(encoders),
    hwaccels: parseHwaccels(hwaccels),
    error: null
  }
}
