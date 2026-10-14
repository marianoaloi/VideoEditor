/** Conflict detection for the keymap registry (F18): same chord twice in a scope, or in a workspace and `global`. */
import {
  WORKSPACE_IDS,
  type Binding,
  type KeymapConflict,
  type KeymapScope
} from '@shared/domain/keymap'

const WORKSPACES: ReadonlySet<string> = new Set(WORKSPACE_IDS)

export function findConflicts(bindings: readonly Binding[]): KeymapConflict[] {
  const byScopeChord = new Map<string, Map<string, string[]>>()
  for (const binding of bindings) {
    const chords = byScopeChord.get(binding.scope) ?? new Map<string, string[]>()
    for (const chord of new Set(binding.keys)) {
      chords.set(chord, [...(chords.get(chord) ?? []), binding.id])
    }
    byScopeChord.set(binding.scope, chords)
  }

  const conflicts: KeymapConflict[] = []
  for (const [scope, chords] of byScopeChord) {
    const globals =
      scope !== 'global' && WORKSPACES.has(scope) ? byScopeChord.get('global') : undefined
    for (const [chord, ids] of chords) {
      const all = [...ids, ...(globals?.get(chord) ?? [])]
      if (all.length >= 2) {
        conflicts.push({ chord, scope: scope as KeymapScope, bindingIds: all })
      }
    }
  }
  return conflicts.sort((a, b) => a.scope.localeCompare(b.scope) || a.chord.localeCompare(b.chord))
}
