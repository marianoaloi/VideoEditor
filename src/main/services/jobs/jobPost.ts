/**
 * Steps after a successful job (research §9.2, checklist 27-33):
 *
 *   1. `uploadOutputs` hook when the job has "upload" on (disabled hook = skipped, not a failure);
 *   2. trash the source video and its `.json` when "delete original" is on, but only after `done`
 *      and, if the upload hook actually ran, only when it exited 0 (legacy trashed regardless, B23).
 *
 * `uploadAll` runs once per drained batch (`runUploadAll`). Hooks are disabled by default; the
 * hook service decides what "disabled" means and reports it as `skipped`.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import type { CommandTemplate, HookContext, HookExit, HookName } from '@shared/domain/hooks'
import type { HookService } from '../../ipc/context'
import { exists } from './jobFiles'
import type { JobPayload } from './jobExecutor'
import type { ExecHandle } from './jobQueue'

export interface PostDeps {
  readonly hooks: HookService | null
  hookTemplate(name: HookName): CommandTemplate
  trash(path: string, root: string): Promise<void>
}

/** Streaming MD5 of a file (never read whole into memory, B23). */
export async function md5OfFile(file: string): Promise<string> {
  const hash = createHash('md5')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
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
