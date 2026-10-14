/** Types of the central keymap (F18). The registry and dispatcher live next to this file. */
import type { Binding, KeyChord, KeymapScope } from '@shared/domain/keymap'

/**
 * What a component passes to `useKeymap(scope, bindings)`.
 * `id` is `<scope>.<action>` and unique app-wide; `description` is what F1 shows.
 */
export interface KeyBinding {
  readonly id: string
  /** Canonical chords (`Ctrl+Shift+F`, `ArrowUp`, `F1`; see `@shared/domain/keymap`). */
  readonly keys: readonly KeyChord[]
  readonly description: string
  readonly run: (event: KeyboardEvent) => void
  /** Default true. A disabled binding stays listed in F1 but does not fire (e.g. `P` w/o folder). */
  readonly enabled?: boolean
  /** Fire on auto-repeat too (seek keys). Default false. */
  readonly allowRepeat?: boolean
  /** Fire while an input/textarea/select has focus. Default false. */
  readonly allowInInput?: boolean
}

export interface KeymapOptions {
  /** Default true. `false` unregisters everything (e.g. a hidden workspace). */
  readonly enabled?: boolean
}

/** Registered handler with its scope. */
export interface RegisteredBinding extends KeyBinding {
  readonly scope: KeymapScope
}

/** The data part that Redux keeps for the F1 help (functions stay in the registry). */
export function toBindingMeta(scope: KeymapScope, binding: KeyBinding): Binding {
  return { id: binding.id, keys: [...binding.keys], description: binding.description, scope }
}
