/**
 * Handler registry and dispatch rules of the central keymap. The DOM listener (one `keydown` on
 * `window`) and the F1 help UI belong to ui-shell; they use `resolveBinding` so that the rules
 * stay in one place:
 *
 * - while a modal scope (`crop`, `zoom`, `help`, `dialog`) is open, only its bindings fire;
 * - otherwise the active workspace's bindings, then `global`'s;
 * - disabled bindings never fire; auto-repeat and focused inputs are filtered per binding.
 */
import type { KeyChord, KeymapScope } from '@shared/domain/keymap'
import type { KeyBinding, RegisteredBinding } from './types'

const handlers = new Map<string, RegisteredBinding>()

/** Registers bindings for `scope`; returns the function that removes exactly these. */
export function registerHandlers(scope: KeymapScope, bindings: readonly KeyBinding[]): () => void {
  const ids: string[] = []
  for (const binding of bindings) {
    handlers.set(binding.id, { ...binding, scope })
    ids.push(binding.id)
  }
  return () => {
    for (const id of ids) {
      if (handlers.get(id)?.scope === scope) handlers.delete(id)
    }
  }
}

export function allHandlers(): RegisteredBinding[] {
  return [...handlers.values()]
}

export function clearHandlers(): void {
  handlers.clear()
}

export interface DispatchState {
  readonly activeWorkspace: KeymapScope
  /** Open modal scopes, innermost last. */
  readonly modalStack: readonly KeymapScope[]
}

export interface DispatchEventInfo {
  readonly repeat: boolean
  readonly inInput: boolean
}

/** Which binding handles `chord` right now, or `null`. */
export function resolveBinding(
  chord: KeyChord,
  state: DispatchState,
  info: DispatchEventInfo,
  source: readonly RegisteredBinding[] = allHandlers()
): RegisteredBinding | null {
  const top = state.modalStack[state.modalStack.length - 1]
  const scopes: KeymapScope[] = top !== undefined ? [top] : [state.activeWorkspace, 'global']
  for (const scope of scopes) {
    for (const binding of source) {
      if (binding.scope !== scope || binding.enabled === false) continue
      if (!binding.keys.includes(chord)) continue
      if (info.repeat && binding.allowRepeat !== true) continue
      if (info.inInput && binding.allowInInput !== true) continue
      return binding
    }
  }
  return null
}
