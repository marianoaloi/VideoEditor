/**
 * Runs one queued job: probe, optional `convert` pre-step, the ffmpeg ladder, and the per-job
 * failure log (`<video>.log`, research §8.4: written on failure only, never on success).
 */
import { writeFile } from 'node:fs/promises'
import { buildConvertStep } from '@shared/core/ffmpegArgs'
import type { IpcError } from '@shared/domain/errors'
import type { EnqueueOptions, VideoJob } from '@shared/domain/job'
import type { MediaInfo } from '@shared/domain/media'
import type { Settings } from '@shared/domain/settings'
import { AppError, toIpcError } from '../../ipc/errors'
import { runFfmpegJob } from '../ffmpeg/runner'
import {
  createProcessExecutor,
  judgeStep,
  removeQuietly,
  type StepExecutor
} from '../ffmpeg/runnerSteps'
import type { ExecHandle, ExecOutcome } from './jobQueue'

/** Everything the worker needs to know about one job. */
export interface JobPayload {
  readonly videoPath: string
  /** `null` for force jobs (no JSON). */
  readonly jsonPath: string | null
  readonly job: VideoJob
  readonly options: EnqueueOptions
  /** Session root the video belongs to (journal location). */
  readonly root: string
}

export interface ExecutorDeps {
  settings(): Settings
  /** Throws `FFMPEG_NOT_FOUND`. */
  tools(): { readonly ffmpeg: string; readonly ffprobe: string }
  probe(path: string, ffprobePath: string): Promise<MediaInfo>
  /** Trash + journal; used for concat parts. */
  trash(path: string, root: string): Promise<void>
  /** Test seam: replaces the real ffmpeg process. */
  stepExecutor?(ffmpegPath: string): StepExecutor
}

function fail(error: IpcError): ExecOutcome {
  return { kind: 'error', error }
}

/** GPU decoding is only implemented for CUDA (the builder emits the CUDA flags). */
function gpuEnabled(settings: Settings): boolean {
  return settings.ffmpeg.hwaccel === 'cuda' || settings.ffmpeg.hwaccel === 'auto'
}

interface Prepared {
  readonly inputPath: string
  readonly outputBase: string
  readonly media: MediaInfo
  readonly temp: string | null
}

/** `convert: true`: re-encode the whole file to a NEW temp file and probe that (§7.5). */
async function prepareInput(
  deps: ExecutorDeps,
  payload: JobPayload,
  media: MediaInfo,
  tools: { readonly ffmpeg: string; readonly ffprobe: string },
  handle: ExecHandle
): Promise<Prepared> {
  const same: Prepared = {
    inputPath: payload.videoPath,
    outputBase: payload.videoPath,
    media,
    temp: null
  }
  if (!payload.job.convert) return same
  const step = buildConvertStep(payload.videoPath, { hasAudio: media.hasAudio, verbose: false })
  handle.log('Converting the source to a clean H.264/MP4 first')
  handle.log(`$ ffmpeg ${step.argv.join(' ')}`)
  const exec = deps.stepExecutor?.(tools.ffmpeg) ?? createProcessExecutor(tools.ffmpeg)
  const exit = await exec({
    argv: step.argv,
    signal: handle.signal,
    onProgress: () => undefined,
    onStderrLine: (line) => {
      handle.log(line)
    }
  })
  const min = deps.settings().thresholds.minOutputBytes
  const verdict = await judgeStep(exit, step.output, min)
  if (!verdict.ok) {
    await removeQuietly(step.output)
    handle.log(`Convert failed (${verdict.reason}); continuing with the original file`)
    return same
  }
  try {
    const converted = await deps.probe(step.output, tools.ffprobe)
    return { inputPath: step.output, outputBase: payload.videoPath, media: converted, temp: step.output }
  } catch (error) {
    await removeQuietly(step.output)
    handle.log(`Could not probe the converted file: ${toIpcError(error).message}`)
    return same
  }
}

async function writeFailureLog(videoPath: string, handle: ExecHandle, tail: string[]): Promise<void> {
  const logPath = `${videoPath}.log`
  const lines = [...handle.lines(), '--- last ffmpeg output ---', ...tail]
  try {
    await writeFile(logPath, `${lines.join('\n')}\n`, 'utf8')
    handle.setLogPath(logPath)
  } catch (error) {
    handle.log(`Could not write ${logPath}: ${toIpcError(error).message}`)
  }
}

export async function executeJob(
  deps: ExecutorDeps,
  payload: JobPayload,
  handle: ExecHandle
): Promise<ExecOutcome> {
  let tools: { ffmpeg: string; ffprobe: string }
  let media: MediaInfo
  try {
    tools = deps.tools()
    media = await deps.probe(payload.videoPath, tools.ffprobe)
    if (!media.hasVideo) throw new AppError('PROBE_FAILED', 'The file has no video stream')
  } catch (error) {
    return fail(toIpcError(error))
  }
  const input = await prepareInput(deps, payload, media, tools, handle)
  try {
    return await runLadder(deps, payload, handle, tools.ffmpeg, input)
  } finally {
    if (input.temp !== null) await removeQuietly(input.temp)
  }
}

async function runLadder(
  deps: ExecutorDeps,
  payload: JobPayload,
  handle: ExecHandle,
  ffmpegPath: string,
  input: Prepared
): Promise<ExecOutcome> {
  const settings = deps.settings()
  const { options } = payload
  const result = await runFfmpegJob({
    ffmpegPath,
    job: payload.job,
    media: input.media,
    inputPath: input.inputPath,
    outputBase: input.outputBase,
    encoders: settings.ffmpeg.encoders,
    gpu: gpuEnabled(settings),
    sameSize: options.sameSize,
    maxRateKbps: settings.thresholds.maxRateKbps,
    maxSide: settings.thresholds.maxSide,
    minOutputBytes: settings.thresholds.minOutputBytes,
    keepParts: options.keepParts,
    signal: handle.signal,
    onProgress: (p) => {
      handle.progress(p)
    },
    onLog: (line, source) => {
      handle.log(line, { quiet: source === 'stderr' && options.ignoreErrors })
    },
    trashPart: (path) => deps.trash(path, payload.root),
    ...(deps.stepExecutor === undefined ? {} : { executor: deps.stepExecutor(ffmpegPath) })
  })
  if (result.ok) return { kind: 'done', outputs: result.outputs }
  if (result.cancelled) return { kind: 'cancelled' }
  handle.log(`Failed: ${result.error}`)
  await writeFailureLog(payload.videoPath, handle, result.lastLines)
  return fail({ code: 'PROCESS_FAILED', message: result.error })
}
