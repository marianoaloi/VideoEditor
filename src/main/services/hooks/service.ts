/**
 * Hook runner (ADR-008): named command templates expanded by `core/hookArgs`, started with
 * `run()` (argv only, `shell:false`, command resolved to an absolute path). Output and exit go to
 * `hooks:output` / `hooks:exit`. The built-in part of `deleteR` trashes the top-level files of
 * `<root>/<R folder>`, a folder main derives itself (review H1); it runs even when the command is off.
 */
import { expandTemplate, HookExpansionError, type ExpandedCommand } from '@shared/core/hookArgs'
import type {
  CommandTemplate,
  HookContext,
  HookExit,
  HookName,
  HookPreview,
  HookRunRequest,
  HookRunStarted
} from '@shared/domain/hooks'
import type { IpcError } from '@shared/domain/errors'
import { appError, toIpcError } from '../../ipc/errors'
import type { HookService, MainContext } from '../../ipc/context'
import { run, type RunResult } from '../process/run'
import { resolveDeleteTarget, type DeleteTarget } from './deleteTarget'
import { commandWarnings, isBatchFile, resolveCommandPath } from './resolveCommand'

const FLUSH_MS = 50
const KEEP_FINISHED = 200

export const BATCH_FILE_MESSAGE =
  'Windows cannot start .cmd/.bat files without a shell. Point the hook at an .exe or at a wrapper ' +
  '(for example powershell.exe with -File script.ps1 as the first argument).'

export interface HookServiceImpl extends HookService {
  preview(template: CommandTemplate, context: HookContext): HookPreview
  /** Kills every running hook process (app quit). */
  dispose(): void
}

/** Expansion errors are the operator's mistake in the template: VALIDATION. */
export function expandOrThrow(template: CommandTemplate, context: HookContext): ExpandedCommand {
  try {
    return expandTemplate(template, context)
  } catch (error) {
    if (error instanceof HookExpansionError) throw appError('VALIDATION', error.message)
    throw error
  }
}

function exitError(result: RunResult, command: string): IpcError | null {
  if (result.status === 'spawn-error') {
    const code = result.error?.code ?? null
    if (isBatchFile(command) || (code === 'EINVAL' && process.platform === 'win32')) {
      return { code: 'PROCESS_FAILED', message: BATCH_FILE_MESSAGE }
    }
    if (code === 'ENOENT') return { code: 'NOT_FOUND', message: `Command not found: ${command}` }
    return { code: 'PROCESS_FAILED', message: result.error?.message ?? 'The command could not start' }
  }
  if (result.status === 'cancelled') return { code: 'CANCELLED', message: 'The hook was cancelled' }
  if (result.status === 'timeout') return { code: 'TIMEOUT', message: 'The hook timed out' }
  if (result.exitCode !== 0) {
    return { code: 'PROCESS_FAILED', message: `The hook exited with code ${String(result.exitCode)}` }
  }
  return null
}

type Emitter = ReturnType<typeof createEmitter>

function createEmitter(ctx: MainContext, runId: string, name: HookName) {
  const buffers = { stdout: [] as string[], stderr: [] as string[] }
  let timer: NodeJS.Timeout | null = null
  const flush = (): void => {
    timer = null
    for (const stream of ['stdout', 'stderr'] as const) {
      const lines = buffers[stream].splice(0)
      if (lines.length > 0) ctx.sendEvent('hooks:output', { runId, name, stream, lines })
    }
  }
  return {
    line(stream: 'stdout' | 'stderr', text: string): void {
      buffers[stream].push(text)
      timer ??= setTimeout(flush, FLUSH_MS)
    },
    flush(): void {
      if (timer !== null) clearTimeout(timer)
      flush()
    }
  }
}

const builtInError = (failed: number): IpcError | null =>
  failed > 0 ? { code: 'PROCESS_FAILED', message: `${failed} file(s) could not be trashed` } : null

export function createHookService(ctx: MainContext): HookServiceImpl {
  const waiters = new Map<string, Promise<HookExit>>()
  const finished: string[] = []
  const running = new Set<AbortController>()

  const remember = (runId: string, work: Promise<HookExit>): void => {
    waiters.set(runId, work)
    void work.then(() => {
      finished.push(runId)
      while (finished.length > KEEP_FINISHED) waiters.delete(finished.shift() ?? '')
    })
  }

  const journalTrashed = async (root: string, files: string[]): Promise<void> => {
    if (files.length === 0 || !ctx.services.has('journal')) return
    const journal = ctx.services.require('journal')
    for (const file of files) {
      await journal.record(root, { op: 'trash', from: file, to: null, sidecars: [], undoable: false }, null)
    }
  }

  const trashBuiltIn = async (
    target: DeleteTarget,
    out: Emitter
  ): Promise<{ trashed: string[]; failed: number }> => {
    for (const file of target.ignored) out.line('stderr', `Ignored (not directly inside ${target.dir}): ${file}`)
    const trashed: string[] = []
    let failed = 0
    for (const file of target.files) {
      try {
        await ctx.trashItem(file)
        trashed.push(file)
      } catch (error) {
        failed += 1
        out.line('stderr', `Could not trash ${file}: ${toIpcError(error).message}`)
      }
    }
    out.line('stdout', `Trashed ${trashed.length} file(s)`)
    await journalTrashed(target.root, trashed)
    return { trashed, failed }
  }

  const runTemplate = async (
    template: CommandTemplate,
    context: HookContext,
    out: Emitter
  ): Promise<RunResult | null> => {
    if (!template.enabled || template.command.length === 0) return null
    const expanded = expandOrThrow(template, context)
    // M9: absolute path from PATH only (never the cwd), so a planted program cannot win.
    const command = resolveCommandPath(expanded.command, { ...process.env, ...expanded.env })
    if (command === null) throw appError('NOT_FOUND', `Command not found: ${expanded.command}`)
    if (isBatchFile(command)) throw appError('PROCESS_FAILED', BATCH_FILE_MESSAGE)
    const controller = new AbortController()
    running.add(controller)
    try {
      return await run({
        command,
        args: expanded.args,
        ...(expanded.cwd === null ? {} : { cwd: expanded.cwd }),
        env: expanded.env,
        signal: controller.signal,
        onStdoutLine: (line) => out.line('stdout', line),
        onStderrLine: (line) => out.line('stderr', line)
      })
    } finally {
      running.delete(controller)
    }
  }

  const finish = (
    runId: string,
    name: HookName,
    startedAt: number,
    out: Emitter,
    code: number | null,
    error: IpcError | null,
    trashed?: number
  ): HookExit => {
    out.flush()
    const exit: HookExit = {
      runId,
      name,
      code,
      durationMs: Date.now() - startedAt,
      error,
      ...(trashed === undefined ? {} : { trashed })
    }
    ctx.sendEvent('hooks:exit', exit)
    return exit
  }

  const execute = async (
    runId: string,
    name: HookName,
    template: CommandTemplate,
    context: HookContext,
    target: DeleteTarget | null,
    startedAt: number
  ): Promise<HookExit> => {
    const out = createEmitter(ctx, runId, name)
    let builtInFailed = 0
    let trashedCount: number | undefined
    let effective = context
    try {
      if (target !== null) {
        const built = await trashBuiltIn(target, out)
        builtInFailed = built.failed
        trashedCount = built.trashed.length
        effective = { ...context, ...(built.trashed.length > 0 ? { files: built.trashed } : {}) }
      }
      const result = await runTemplate(template, effective, out)
      const error = result === null ? null : exitError(result, template.command)
      const code = result === null ? (builtInFailed > 0 ? 1 : 0) : result.exitCode
      return finish(runId, name, startedAt, out, code, error ?? builtInError(builtInFailed), trashedCount)
    } catch (error) {
      out.line('stderr', toIpcError(error).message)
      return finish(runId, name, startedAt, out, null, toIpcError(error), trashedCount)
    }
  }

  return {
    async run(request: HookRunRequest): Promise<HookRunStarted> {
      const template = ctx.settings.get().hooks[request.name]
      const context = request.context ?? {}
      const runId = ctx.newId()
      const builtIn = request.name === 'deleteR'
      const skipped = !template.enabled || template.command.length === 0
      // H1: the deleteR target comes from the session root + settings, never from the renderer.
      const target = builtIn ? await resolveDeleteTarget(ctx, context) : null
      const effective = target === null ? context : { ...context, root: target.root, dir: target.dir }
      // Fail fast on a bad template; `deleteR` gets its `{files}` from the built-in step.
      if (!skipped && !builtIn) expandOrThrow(template, context)
      if (skipped && !builtIn) {
        remember(runId, Promise.resolve({ runId, name: request.name, code: null, durationMs: 0, error: null }))
        return { runId, name: request.name, skipped: true, builtIn: false }
      }
      remember(runId, execute(runId, request.name, template, effective, target, Date.now()))
      return { runId, name: request.name, skipped, builtIn }
    },
    waitForExit(runId) {
      return (
        waiters.get(runId) ??
        Promise.resolve({
          runId,
          name: 'externalPlayer' as HookName,
          code: null,
          durationMs: 0,
          error: { code: 'NOT_FOUND' as const, message: `Unknown hook run ${runId}` }
        })
      )
    },
    preview(template, context) {
      const expanded = expandOrThrow(template, context)
      if (process.platform === 'win32' && isBatchFile(template.command)) {
        throw appError('VALIDATION', BATCH_FILE_MESSAGE)
      }
      const resolved = resolveCommandPath(expanded.command, { ...process.env, ...expanded.env })
      return {
        command: expanded.command,
        args: expanded.args,
        cwd: expanded.cwd,
        env: expanded.env,
        warnings: commandWarnings(expanded.command, resolved)
      }
    },
    dispose() {
      for (const controller of [...running]) controller.abort()
      running.clear()
    }
  }
}
