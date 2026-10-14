/**
 * Runs a hook and waits for its `hooks:exit` event (review M5, M12): used by "Send" (`L`) in Image
 * Triage and by "Clean queue and execute movie", which must not start `deleteR` before `moviesL`
 * has ended. The result tells "hook disabled, nothing ran" apart from "only the built-in trash ran".
 */
import type { HookContext, HookExit, HookName, HookRunStarted } from '@shared/domain/hooks'
import { call, onEvent } from '../api'

export type HookRunOutcome =
  | { readonly status: 'disabled' }
  | {
      readonly status: 'done'
      /** `deleteR` ran only its built-in trash (the command template is disabled or empty). */
      readonly builtInOnly: boolean
      readonly code: number | null
      /** Files the built-in step sent to the trash (`deleteR` only). */
      readonly trashed: number | null
      readonly error: string | null
    }

/** `skipped && builtIn` = built-in step only; `skipped` otherwise = nothing ran. */
export function isDisabled(started: Pick<HookRunStarted, 'skipped' | 'builtIn'>): boolean {
  return started.skipped && started.builtIn !== true
}

function outcomeOf(started: HookRunStarted, exit: HookExit): HookRunOutcome {
  return {
    status: 'done',
    builtInOnly: started.skipped,
    code: exit.code,
    trashed: exit.trashed ?? null,
    error: exit.error?.message ?? null
  }
}

/** Starts the hook and resolves with its outcome once `hooks:exit` arrives. */
export async function runHookAndWait(name: HookName, context: HookContext): Promise<HookRunOutcome> {
  const seen: HookExit[] = []
  let wake: (() => void) | null = null
  const off = onEvent('hooks:exit', (event) => {
    seen.push(event)
    wake?.()
  })
  try {
    const started = await call('hooks:run', { name, context })
    if (isDisabled(started)) return { status: 'disabled' }
    for (;;) {
      const exit = seen.find((e) => e.runId === started.runId)
      if (exit !== undefined) return outcomeOf(started, exit)
      await new Promise<void>((resolve) => {
        wake = resolve
      })
    }
  } finally {
    off()
  }
}

/** One short phrase for the Send summary. */
export function describeOutcome(outcome: HookRunOutcome): string {
  if (outcome.status === 'disabled') return 'hook disabled, nothing ran'
  const trashed = outcome.trashed === null ? '' : `, ${String(outcome.trashed)} trashed`
  if (outcome.builtInOnly) {
    return outcome.code === 0 ? `built-in trash done${trashed}` : `built-in trash failed${trashed}`
  }
  if (outcome.code === 0) return `ok${trashed}`
  return `exit ${outcome.code ?? 'none'}${outcome.error === null ? '' : ` (${outcome.error})`}${trashed}`
}
