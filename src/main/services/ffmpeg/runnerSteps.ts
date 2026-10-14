/**
 * One ffmpeg process (a "step") and its success test (research §7.1, B15):
 * success = exit code 0 AND the output file is at least `minOutputBytes` (1000 B).
 * Nothing here matches on stderr text: `-hwaccel cuda` decoder warnings with exit 0 are a success.
 */
import { rm, stat } from 'node:fs/promises'
import { run } from '../process/run'
import { runnerPrefix } from '@shared/core/ffmpegArgs'
import { ProgressParser, type ProgressSample } from './runnerProgress'

export interface StepRequest {
  /** The step argv WITHOUT the executable and WITHOUT the runner prefix. */
  readonly argv: readonly string[]
  readonly signal?: AbortSignal
  onProgress(sample: ProgressSample): void
  onStderrLine(line: string): void
}

export interface StepExit {
  readonly status: 'exited' | 'cancelled' | 'timeout' | 'spawn-error'
  readonly exitCode: number | null
  readonly spawnError?: string
}

/** Runs one step. Injectable so tests can fake ffmpeg without a process. */
export type StepExecutor = (request: StepRequest) => Promise<StepExit>

export function createProcessExecutor(ffmpegPath: string): StepExecutor {
  return async (request) => {
    const parser = new ProgressParser()
    const result = await run({
      command: ffmpegPath,
      args: [...runnerPrefix(), ...request.argv],
      captureStdout: false,
      captureStderr: false,
      onStdoutLine: (line) => {
        const sample = parser.feed(line)
        if (sample !== null) request.onProgress(sample)
      },
      onStderrLine: request.onStderrLine,
      ...(request.signal === undefined ? {} : { signal: request.signal })
    })
    const base = { status: result.status, exitCode: result.exitCode }
    return result.error === undefined ? base : { ...base, spawnError: result.error.message }
  }
}

/** Size of a file, or `null` when it does not exist. */
export async function fileSize(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, 'code') === 'ENOENT'
}

/** Deletes a failed/partial output; a missing file is fine. */
export async function removeQuietly(path: string): Promise<void> {
  await rm(path, { force: true })
}

export type StepVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly fatal: boolean }

/** Applies the success rule to an executed step. */
export async function judgeStep(
  exit: StepExit,
  output: string,
  minOutputBytes: number
): Promise<StepVerdict> {
  if (exit.status === 'spawn-error') {
    return { ok: false, fatal: true, reason: `ffmpeg could not be started: ${exit.spawnError ?? ''}` }
  }
  if (exit.status === 'timeout') return { ok: false, fatal: false, reason: 'ffmpeg timed out' }
  if (exit.status !== 'exited' || exit.exitCode !== 0) {
    return { ok: false, fatal: false, reason: `ffmpeg exited with code ${exit.exitCode ?? 'none'}` }
  }
  const size = await fileSize(output)
  if (size === null) return { ok: false, fatal: false, reason: `ffmpeg wrote no output: ${output}` }
  if (size < minOutputBytes) {
    return {
      ok: false,
      fatal: false,
      reason: `Output is ${size} bytes, below the ${minOutputBytes} byte minimum: ${output}`
    }
  }
  return { ok: true }
}

/** Keeps the last `max` lines (the failure message quotes them). */
export class TailBuffer {
  private lines: string[] = []

  constructor(private readonly max = 60) {}

  push(line: string): void {
    this.lines.push(line)
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max)
  }

  clear(): void {
    this.lines = []
  }

  snapshot(): string[] {
    return [...this.lines]
  }
}
