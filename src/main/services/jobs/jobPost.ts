/**
 * Steps after a successful job (research §9.2, checklist 27-33):
 *
 *   1. `uploadOutputs` hook when the job has "upload" on (disabled hook = skipped, not a failure);
 *   2. trash the source video and its `.json` when "delete original" is on, but only after `done`,
 *      only when every output's probed duration matches the expected range duration (M8: a
 *      truncated output must not cost the source), and, if the upload hook actually ran, only when
 *      it exited 0 (legacy trashed regardless, B23).
 *
 * `uploadAll` runs once per drained batch (`runUploadAll`). Hooks are disabled by default; the
 * hook service decides what "disabled" means and reports it as `skipped`.
 */
import path from 'node:path'
import { resolveRanges } from '@shared/core/ffmpegArgs'
import type { CommandTemplate, HookContext, HookExit, HookName } from '@shared/domain/hooks'
import type { HookService } from '../../ipc/context'
import { md5OfFile } from '../hashing/build'
import { exists } from './jobFiles'
import type { JobPayload } from './jobExecutor'
import type { ExecHandle } from './jobQueue'

export interface PostDeps {
  readonly hooks: HookService | null
  hookTemplate(name: HookName): CommandTemplate
  trash(path: string, root: string): Promise<void>
  /** Probed duration of a media file in ms; `null` when it has none. */
  probeDurationMs(path: string): Promise<number | null>
}

/** Allowed difference between an output and its expected duration (encoder frame/keyframe slack). */
export const DURATION_TOLERANCE_MS = 2000
export const DURATION_TOLERANCE_RATIO = 0.1

/** Expected output durations: one per range, or their sum when the job concatenates. */
export function expectedDurationsMs(job: JobPayload['job'], sourceMs: number): number[] {
  const spans = resolveRanges(job, { durationMs: sourceMs, width: 0, height: 0, bitrateKbps: null, rotation: 0, hasAudio: false })
  const each = spans.map((s) => (s.start < 0 ? sourceMs : s.end - s.start))
  return job.posExecution === 2 ? [each.reduce((a, b) => a + b, 0)] : each
}

function withinTolerance(actual: number, expected: number): boolean {
  const slack = Math.max(DURATION_TOLERANCE_MS, expected * DURATION_TOLERANCE_RATIO)
  return Math.abs(actual - expected) <= slack
}

/** `null` when every output matches the expected duration, else why the source must be kept. */
export async function verifyOutputDurations(
  deps: PostDeps,
  payload: JobPayload,
  outputs: readonly string[]
): Promise<string | null> {
  try {
    const sourceMs = (await deps.probeDurationMs(payload.videoPath)) ?? 0
    const expected = expectedDurationsMs(payload.job, sourceMs)
    if (expected.length !== outputs.length) {
      return `expected ${expected.length} output(s) but the job produced ${outputs.length}`
    }
    for (const [index, output] of outputs.entries()) {
      const want = expected[index] ?? 0
      const actual = await deps.probeDurationMs(output)
      if (actual === null || !withinTolerance(actual, want)) {
        return `${path.basename(output)} lasts ${actual ?? 'an unknown number of'} ms, expected about ${want} ms`
      }
    }
    return null
  } catch (error) {
    return `the outputs could not be verified (${error instanceof Error ? error.message : String(error)})`
  }
}

export function referencesMd5(template: CommandTemplate): boolean {
  const texts = [...template.args, ...Object.values(template.env ?? {}), template.cwd ?? '']
  return texts.some((text) => text.includes('{md5}'))
}

export type HookOutcome = 'skipped' | 'ok' | 'failed'

/** Runs a hook and waits for it. Never throws: a failure is `failed` with a log line. */
export async function runHookAndWait(
  deps: PostDeps,
  name: HookName,
  context: HookContext,
  log: (line: string) => void
): Promise<HookOutcome> {
  if (deps.hooks === null) {
    log(`Hook ${name}: the hook service is not available; skipped`)
    return 'skipped'
  }
  try {
    const started = await deps.hooks.run({ name, context })
    if (started.skipped) {
      log(`Hook ${name} is disabled; skipped`)
      return 'skipped'
    }
    const exit: HookExit = await deps.hooks.waitForExit(started.runId)
    if (exit.code === 0) {
      log(`Hook ${name} finished`)
      return 'ok'
    }
    const why = exit.error?.message ?? `exit code ${exit.code ?? 'none'}`
    log(`Hook ${name} failed: ${why}`)
    return 'failed'
  } catch (error) {
    log(`Hook ${name} could not run: ${error instanceof Error ? error.message : String(error)}`)
    return 'failed'
  }
}

async function uploadOutputs(
  deps: PostDeps,
  payload: JobPayload,
  outputs: readonly string[],
  log: (line: string) => void
): Promise<HookOutcome> {
  const template = deps.hookTemplate('uploadOutputs')
  const context: HookContext = {
    file: payload.videoPath,
    outputs: [...outputs],
    dir: path.dirname(payload.videoPath),
    root: payload.root
  }
  if (template.enabled && referencesMd5(template)) {
    context.md5 = await md5OfFile(payload.videoPath)
  }
  return runHookAndWait(deps, 'uploadOutputs', context, log)
}

async function trashOriginal(deps: PostDeps, payload: JobPayload, log: (line: string) => void): Promise<void> {
  for (const target of [payload.videoPath, payload.jsonPath]) {
    if (target === null || !(await exists(target))) continue
    await deps.trash(target, payload.root)
    log(`Sent to the trash: ${target}`)
  }
}

/** The queue's `afterDone` step. */
export async function postJob(
  deps: PostDeps,
  payload: JobPayload,
  outputs: readonly string[],
  handle: ExecHandle
): Promise<void> {
  const log = (line: string): void => {
    handle.log(line)
  }
  let upload: HookOutcome = 'skipped'
  if (payload.options.upload && outputs.length > 0) {
    upload = await uploadOutputs(deps, payload, outputs, log)
  }
  if (!payload.options.deleteOriginal) return
  if (upload === 'failed') {
    log('The original was kept because the upload hook failed')
    return
  }
  const mismatch = await verifyOutputDurations(deps, payload, outputs)
  if (mismatch !== null) {
    log(`The original was kept: ${mismatch}`)
    return
  }
  await trashOriginal(deps, payload, log)
}

/** `uploadAll`: one call with every output of the batch's successful jobs that asked for it. */
export async function runUploadAll(
  deps: PostDeps,
  outputs: readonly string[],
  log: (line: string) => void
): Promise<HookOutcome> {
  const first = outputs[0]
  if (first === undefined) return 'skipped'
  return runHookAndWait(deps, 'uploadAll', { outputs: [...outputs], dir: path.dirname(first) }, log)
}
