import type { Binding, KeymapConflict, KeymapScope } from '@shared/domain/keymap'
import { findConflicts } from './conflicts'

/** Bindings of one scope, sorted by id. */
export function bindingsFor(
  bindings: Readonly<Record<string, Binding>>,
  scope: KeymapScope
): Binding[] {
  return Object.values(bindings)
    .filter((binding) => binding.scope === scope)
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** Conflicts that matter for the shown scopes. */
export function relevantConflicts(
  bindings: Readonly<Record<string, Binding>>,
  scopes: readonly KeymapScope[]
): KeymapConflict[] {
  return findConflicts(Object.values(bindings)).filter((c) => scopes.includes(c.scope))
}
