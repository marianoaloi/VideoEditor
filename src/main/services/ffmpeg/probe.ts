/**
 * ffprobe → `MediaInfo` (ADR-005). `probeMedia` runs ffprobe through `run()` (argv only);
 * `parseFfprobeOutput` is the pure part, reused by tests of other services.
 *
 * Parity notes (see `MediaInfoSchema`): the video stream is the first non-cover-art video stream;
 * `bitrateKbps` = trunc(format.bit_rate / 1000), else the video stream's; `fps` = avg_frame_rate;
 * `rotation` = display-matrix rotation (degrees, counter-clockwise), else the old `tags.rotate`
 * (clockwise) negated, normalised to (−180, 180].
 */
import { z } from 'zod'
import { MediaInfoSchema, type MediaInfo } from '@shared/domain/media'
import { AppError } from '../../ipc/errors'
import { isSuccess, run } from '../process/run'

const NumberLike = z.union([z.number(), z.string()]).optional()

const StreamSchema = z.looseObject({
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  pix_fmt: z.string().optional(),
  channels: z.number().optional(),
  avg_frame_rate: z.string().optional(),
  bit_rate: NumberLike,
  duration: NumberLike,
  disposition: z.looseObject({ attached_pic: z.number().optional() }).optional(),
  tags: z.looseObject({ rotate: NumberLike }).optional(),
  side_data_list: z.array(z.looseObject({ rotation: z.number().optional() })).optional()
})

const FormatSchema = z.looseObject({
  format_name: z.string().optional(),
  format_long_name: z.string().optional(),
  duration: NumberLike,
  size: NumberLike,
  bit_rate: NumberLike
})

export const FfprobeOutputSchema = z.looseObject({
  streams: z.array(StreamSchema).default([]),
  format: FormatSchema.optional()
})
export type FfprobeOutput = z.infer<typeof FfprobeOutputSchema>

function num(value: string | number | undefined): number | null {
  if (value === undefined || value === '' || value === 'N/A') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/** Degrees counter-clockwise in (−180, 180]. */
export function normaliseRotation(degrees: number): number {
  const mod = ((degrees % 360) + 360) % 360
  const r = mod > 180 ? mod - 360 : mod
  return r === 0 ? 0 : r
}

/** "30000/1001" → 29.97; "0/0" and malformed values → null. */
export function parseFrameRate(value: string | undefined): number | null {
  if (value === undefined) return null
  const m = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(value.trim())
  if (m === null) {
    const plain = num(value)
    return plain !== null && plain > 0 ? plain : null
  }
  const numerator = Number(m[1])
  const denominator = Number(m[2])
  if (denominator === 0 || numerator === 0) return null
  return numerator / denominator
}

type Stream = z.infer<typeof StreamSchema>

function streamRotation(stream: Stream): number {
  for (const side of stream.side_data_list ?? []) {
    if (side.rotation !== undefined) return normaliseRotation(side.rotation)
  }
  const tag = num(stream.tags?.rotate)
  return tag === null ? 0 : normaliseRotation(-tag)
}

/** Pure conversion of parsed ffprobe JSON. Throws `PROBE_FAILED` when there are no streams. */
export function toMediaInfo(filePath: string, probe: FfprobeOutput): MediaInfo {
  const streams = probe.streams
  if (streams.length === 0) {
    throw new AppError('PROBE_FAILED', 'ffprobe found no streams in this file', { path: filePath })
  }
  const format = probe.format
  const video = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1)
  const audio = streams.find((s) => s.codec_type === 'audio' || s.channels !== undefined)

  const durationSec = num(format?.duration) ?? (video === undefined ? null : num(video.duration))
  const bitRate = num(format?.bit_rate) ?? (video === undefined ? null : num(video.bit_rate))
  const rotation = video === undefined ? 0 : streamRotation(video)
  const width = video?.width ?? 0
  const height = video?.height ?? 0
  const swapped = Math.round(Math.abs(rotation)) % 180 === 90

  return MediaInfoSchema.parse({
    path: filePath,
    container: format?.format_name ?? '',
    formatLongName: format?.format_long_name ?? null,
    durationMs: durationSec === null ? 0 : Math.max(0, Math.trunc(durationSec * 1000)),
    sizeBytes: Math.max(0, Math.trunc(num(format?.size) ?? 0)),
    bitrateKbps: bitRate === null ? null : Math.max(0, Math.trunc(bitRate / 1000)),
    hasVideo: video !== undefined,
    width,
    height,
    displayWidth: swapped ? height : width,
    displayHeight: swapped ? width : height,
    rotation,
    fps: video === undefined ? null : parseFrameRate(video.avg_frame_rate),
    videoCodec: video?.codec_name ?? null,
    pixFmt: video?.pix_fmt ?? null,
    hasAudio: audio !== undefined,
    audioCodec: audio?.codec_name ?? null,
    audioChannels: audio?.channels ?? null,
    streamCount: streams.length
  })
}

export interface ProbeOptions {
  /** Absolute path of ffprobe (from `locate.ts`). */
  readonly ffprobePath: string
  readonly signal?: AbortSignal
  /** Default 30 s. */
  readonly timeoutMs?: number
}

export const FFPROBE_ARGS = [
  '-v',
  'error',
  '-print_format',
  'json',
  '-show_format',
  '-show_streams'
]

function tail(text: string, max = 600): string {
  const trimmed = text.trim()
  return trimmed.length > max ? trimmed.slice(trimmed.length - max) : trimmed
}

/** Probes one file. Throws `AppError` (`PROBE_FAILED`, `FFMPEG_NOT_FOUND`, `CANCELLED`, `TIMEOUT`). */
export async function probeMedia(filePath: string, options: ProbeOptions): Promise<MediaInfo> {
  const result = await run({
    command: options.ffprobePath,
    args: [...FFPROBE_ARGS, '-i', filePath],
    timeoutMs: options.timeoutMs ?? 30_000,
    ...(options.signal === undefined ? {} : { signal: options.signal })
  })
  switch (result.status) {
    case 'cancelled':
      throw new AppError('CANCELLED', 'Probe cancelled', { path: filePath })
    case 'timeout':
      throw new AppError('TIMEOUT', 'ffprobe timed out', { path: filePath })
    case 'spawn-error':
      if (result.error?.code === 'ENOENT') {
        throw new AppError(
          'FFMPEG_NOT_FOUND',
          `ffprobe could not be started: ${options.ffprobePath}`,
          {
            tool: 'ffprobe'
          }
        )
      }
      throw new AppError(
        'PROCESS_FAILED',
        `ffprobe could not be started: ${result.error?.message ?? ''}`
      )
    case 'exited':
      break
  }
  if (!isSuccess(result)) {
    throw new AppError(
      'PROBE_FAILED',
      tail(result.stderr) || `ffprobe exited with ${result.exitCode}`,
      {
        path: filePath,
        exitCode: result.exitCode
      }
    )
  }
  let json: unknown
  try {
    json = JSON.parse(result.stdout)
  } catch {
    throw new AppError('PROBE_FAILED', 'ffprobe returned invalid JSON', { path: filePath })
  }
  const parsed = FfprobeOutputSchema.safeParse(json)
  if (!parsed.success) {
    throw new AppError('PROBE_FAILED', 'ffprobe output has an unexpected shape', { path: filePath })
  }
  return toMediaInfo(filePath, parsed.data)
}
