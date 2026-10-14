/**
 * Pure ffmpeg argv builder (ADR-005, research `ffmpeg-jobs.md` §1/§3). No `node:*`, no I/O, no
 * clock: the same inputs always give the same steps and nothing passed in is modified.
 *
 * One engine, `FFMPEGProcess` semantics: cut outputs `<base>.<i>.mp4`, concat output `<base>.mp4`,
 * stream-copy temp `<base>.copy.mp4`. Option order is the legacy order (ffmpeg-python sorted the
 * option names), so the argv matches the documented vectors token for token. The runner prepends
 * `-hide_banner -nostdin -progress pipe:1 -nostats` (not part of the steps).
 */
import { WHOLE_VIDEO_START_MS, type VideoJob } from '../domain/job'
import type { MediaInfo } from '../domain/media'

export type BuilderMedia = Pick<
  MediaInfo,
  'durationMs' | 'width' | 'height' | 'bitrateKbps' | 'rotation' | 'hasAudio'
>

export interface BuilderOpts {
  /** Encoder of this attempt (`h264_nvenc`, `libx264`, ...). */
  readonly encoder: string
  /** Adds the CUDA decode flags before every `-i`. */
  readonly hwaccel: boolean
  /** `direct`: cut from the source. `copyThenCut`: stream-copy the range, then re-encode the copy. */
  readonly strategy: 'direct' | 'copyThenCut'
  /** Legacy "Same Size": no `maxSide` cap (sides are still made even). */
  readonly sameSize: boolean
  /** Legacy env `withriscs`: drop `-loglevel error`. */
  readonly verbose: boolean
  /** `settings.thresholds.maxRateKbps`. */
  readonly maxRateKbps: number
  /** `settings.thresholds.maxSide`. */
  readonly maxSide: number
  /**
   * Prefix of every output name. Defaults to `inputPath`; differs only when the input is the
   * `convert` temp file but the outputs must keep the original name.
   */
  readonly outputBase?: string
}

export interface FfmpegStep {
  readonly kind: 'cut' | 'copy' | 'concat'
  /** Without the executable. `-y` is last, so the output is `argv[argv.length - 2]`. */
  readonly argv: string[]
  readonly output: string
  /** Duration of the output in ms (progress denominator); `null` when unknown (stream copy). */
  readonly expectedMs: number | null
}

/** Thrown for jobs that cannot be turned into commands (e.g. whole video without a duration). */
export class FfmpegArgsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FfmpegArgsError'
  }
}

const GLOBAL_PREFIX = ['-hide_banner', '-nostdin', '-progress', 'pipe:1', '-nostats'] as const

/** Flags the runner puts in front of every step. */
export function runnerPrefix(): string[] {
  return [...GLOBAL_PREFIX]
}

const HW_FLAGS = ['-extra_hw_frames', '8', '-hwaccel', 'cuda', '-hwaccel_device', '0'] as const
const MIN_SIDE = 2
const NEUTRAL_SIZE_KEEP = '-1'

interface TimeSpan {
  readonly start: number
  readonly end: number
}

// ---- ranges ---------------------------------------------------------------------------------

/** R1: `[min, max]` pairs; empty `times` is the whole video. */
export function resolveRanges(job: Pick<VideoJob, 'times'>, media: BuilderMedia): TimeSpan[] {
  if (job.times.length === 0) {
    if (!(media.durationMs > 0)) {
      throw new FfmpegArgsError('The video has no known duration, so it cannot be processed whole')
    }
    return [{ start: WHOLE_VIDEO_START_MS, end: Math.trunc(media.durationMs) }]
  }
  return job.times.map(([a, b]) => ({ start: Math.min(a, b), end: Math.max(a, b) }))
}

function spanDurationMs(span: TimeSpan, media: BuilderMedia): number | null {
  if (span.start === WHOLE_VIDEO_START_MS) return media.durationMs > 0 ? media.durationMs : null
  return span.end - span.start
}

function seekArgs(span: TimeSpan): string[] {
  if (span.start === WHOLE_VIDEO_START_MS) return []
  return ['-ss', `${span.start}ms`, '-t', `${span.end - span.start}ms`]
}

// ---- size, rate, filters --------------------------------------------------------------------

function even(n: number): number {
  return n % 2 === 0 ? n : n + 1
}

/** §6.1: cap the longest side at `maxSide` (unless `sameSize`), then round both sides UP to even. */
export function defaultSize(
  width: number,
  height: number,
  sameSize: boolean,
  maxSide: number
): string {
  if (!(width > 0) || !(height > 0)) return '640:360'
  let w = width
  let h = height
  if ((w > maxSide || h > maxSide) && !sameSize) {
    if (w >= h) {
      h = Math.trunc((h * maxSide) / w)
      w = maxSide
    } else {
      w = Math.trunc((w * maxSide) / h)
      h = maxSide
    }
  }
  return `${even(Math.max(MIN_SIDE, w))}:${even(Math.max(MIN_SIDE, h))}`
}

export type TypedSize = { readonly kind: 'keep' } | { readonly kind: 'size'; readonly value: string }

/** Δ6/Δ7/Δ8: `W[xX:]H` becomes an even `W:H`; `-1` keeps; anything else is "not set" (`null`). */
export function normaliseTypedSize(size: string | null | undefined): TypedSize | null {
  if (size === null || size === undefined) return null
  const text = size.trim()
  if (text === NEUTRAL_SIZE_KEEP) return { kind: 'keep' }
  const match = /^(\d+)[xX:](\d+)$/.exec(text)
  if (match === null) return null
  const w = Number(match[1])
  const h = Number(match[2])
  if (w < MIN_SIDE || h < MIN_SIDE) return null
  return { kind: 'size', value: `${even(w)}:${even(h)}` }
}

/** R3: crop XOR scale; `-1`, rotation metadata and crop all mean "no scale". */
function resolveScale(job: VideoJob, media: BuilderMedia, opts: BuilderOpts): string | null {
  if (job.crop !== null) return null
  const typed = normaliseTypedSize(job.size)
  if (typed?.kind === 'keep') return null
  if (media.rotation !== 0) return null
  if (typed?.kind === 'size') return typed.value
  return defaultSize(media.width, media.height, opts.sameSize, opts.maxSide)
}

/** R4/§6.2: typed rate is used as is; otherwise the source rate capped; unknown means the cap. */
export function resolveRate(job: Pick<VideoJob, 'rate'>, media: BuilderMedia, cap: number): number {
  if (job.rate !== null && job.rate > 0) return Math.trunc(job.rate)
  const source = media.bitrateKbps
  if (source === null || source < 1) return cap
  return Math.min(Math.trunc(source), cap)
}

function r3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function transposeFilters(degrees: number | null): string[] {
  if (degrees === null || degrees === 0) return []
  const turns = Math.trunc(Math.abs(degrees) / 90)
  const filter = degrees > 0 ? 'transpose=1' : 'transpose=2'
  return Array.from({ length: turns }, () => filter)
}

function eqFilter(job: Pick<VideoJob, 'bright' | 'contrast'>): string[] {
  const parts: string[] = []
  if (job.bright !== null && job.bright !== 0) {
    parts.push(`brightness=${r3(Math.min(1, Math.max(-1, job.bright)))}`)
  }
  if (job.contrast !== null && job.contrast !== 0) parts.push(`contrast=${r3(job.contrast)}`)
  return parts.length === 0 ? [] : [`eq=${parts.join(':')}`]
}

/** R5: crop|scale, transposes, eq. Empty string = no `-vf`. */
export function videoFilter(job: VideoJob, media: BuilderMedia, opts: BuilderOpts): string {
  const filters: string[] = []
  if (job.crop !== null) {
    const { w, h, x, y } = job.crop
    filters.push(`crop=${w}:${h}:${x}:${y}`)
  } else {
    const scale = resolveScale(job, media, opts)
    if (scale !== null) filters.push(`scale=${scale}`)
  }
  filters.push(...transposeFilters(job.transpose), ...eqFilter(job))
  return filters.join(',')
}

// ---- argv pieces ----------------------------------------------------------------------------

function inputArgs(input: string, opts: BuilderOpts, withHw: boolean): string[] {
  const args: string[] = []
  if (withHw && opts.hwaccel) args.push(...HW_FLAGS)
  if (!opts.verbose) args.push('-loglevel', 'error')
  args.push('-i', input)
  return args
}

/** ENC(R): the legacy option order (ASCII-sorted names). */
function encoderArgs(rate: number, hasAudio: boolean, opts: BuilderOpts): string[] {
  const args: string[] = []
  if (hasAudio) args.push('-b:a', '128k')
  args.push('-b:v', `${rate}k`, '-bufsize', '130M')
  if (hasAudio) args.push('-c:a', 'aac')
  args.push(
    '-c:v',
    opts.encoder,
    '-crf',
    '28',
    '-flush_packets',
    '1',
    '-maxrate',
    `${rate}k`,
    '-pix_fmt',
    'yuv420p',
    '-r',
    '25'
  )
  return args
}

function step(
  kind: FfmpegStep['kind'],
  args: string[],
  output: string,
  expectedMs: number | null
): FfmpegStep {
  return { kind, argv: [...args, output, '-y'], output, expectedMs }
}

interface Context {
  readonly job: VideoJob
  readonly media: BuilderMedia
  readonly opts: BuilderOpts
  readonly input: string
  readonly base: string
  readonly rate: number
  readonly vf: string
}

function cutStep(c: Context, index: number, span: TimeSpan, source: string, seek: boolean): FfmpegStep {
  const args = [
    ...inputArgs(source, c.opts, true),
    ...encoderArgs(c.rate, c.media.hasAudio, c.opts),
    ...(seek ? seekArgs(span) : [])
  ]
  if (c.vf !== '') args.push('-vf', c.vf)
  return step('cut', args, `${c.base}.${index}.mp4`, spanDurationMs(span, c.media))
}

function copyStep(c: Context, span: TimeSpan): FfmpegStep {
  const args = [
    ...(c.opts.verbose ? [] : ['-loglevel', 'error']),
    '-err_detect',
    'ignore_err',
    '-fflags',
    '+discardcorrupt',
    '-i',
    c.input,
    '-c',
    'copy',
    ...seekArgs(span)
  ]
  return step('copy', args, `${c.base}.copy.mp4`, null)
}

const CONCAT_FPS = 'fps=fps=25'

function concatGraph(count: number, withAudio: boolean): string {
  const pads = Array.from({ length: count }, (_, i) => (withAudio ? `[${i}:v][${i}:a]` : `[${i}:v]`))
  const joined = `${pads.join('')}concat=a=${withAudio ? 1 : 0}:n=${count}:v=1`
  return withAudio ? `${joined}[s0][a0];[s0]${CONCAT_FPS}[s1]` : `${joined}[s0];[s0]${CONCAT_FPS}[s1]`
}

function concatStep(c: Context, parts: FfmpegStep[]): FfmpegStep {
  const args: string[] = []
  for (const part of parts) args.push(...inputArgs(part.output, c.opts, true))
  const audio = c.media.hasAudio
  args.push('-filter_complex', concatGraph(parts.length, audio), '-map', '[s1]')
  if (audio) args.push('-map', '[a0]')
  args.push(...encoderArgs(c.rate, audio, c.opts))
  const total = parts.reduce<number | null>(
    (sum, p) => (sum === null || p.expectedMs === null ? null : sum + p.expectedMs),
    0
  )
  return step('concat', args, `${c.base}.mp4`, total)
}

function stepsForRange(c: Context, index: number, span: TimeSpan): FfmpegStep[] {
  if (c.opts.strategy === 'direct') return [cutStep(c, index, span, c.input, true)]
  const copy = copyStep(c, span)
  const recode = cutStep(c, index, span, copy.output, false)
  return [copy, { ...recode, expectedMs: spanDurationMs(span, c.media) }]
}

/**
 * The commands of one attempt, in execution order. Cut mode: one `cut` per range (plus a `copy`
 * before each when `copyThenCut`). Concat mode: the same, then one `concat` of the parts.
 */
export function buildFfmpegArgs(
  job: VideoJob,
  media: BuilderMedia,
  inputPath: string,
  opts: BuilderOpts
): FfmpegStep[] {
  const spans = resolveRanges(job, media)
  const context: Context = {
    job,
    media,
    opts,
    input: inputPath,
    base: opts.outputBase ?? inputPath,
    rate: resolveRate(job, media, opts.maxRateKbps),
    vf: videoFilter(job, media, opts)
  }
  const steps = spans.flatMap((span, index) => stepsForRange(context, index, span))
  if (job.posExecution !== 2) return steps
  const parts = steps.filter((s) => s.kind === 'cut')
  return [...steps, concatStep(context, parts)]
}

export interface ConvertStep {
  readonly argv: string[]
  readonly output: string
}

/** §7.5: re-encode the WHOLE file into a NEW `<input>.converted.mp4` (the original is untouched). */
export function buildConvertStep(
  inputPath: string,
  options: { readonly hasAudio: boolean; readonly verbose: boolean }
): ConvertStep {
  const output = `${inputPath}.converted.mp4`
  const args = [
    ...(options.verbose ? [] : ['-loglevel', 'error']),
    '-i',
    inputPath,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-r',
    '25',
    '-pix_fmt',
    'yuv420p',
    ...(options.hasAudio ? ['-c:a', 'aac', '-b:a', '128k'] : []),
    '-movflags',
    '+faststart',
    output,
    '-y'
  ]
  return { argv: args, output }
}

/** Paths a step list leaves behind: every `cut` output of a concat job is a temp part. */
export function partOutputs(steps: readonly FfmpegStep[]): string[] {
  return steps.filter((s) => s.kind === 'cut').map((s) => s.output)
}
