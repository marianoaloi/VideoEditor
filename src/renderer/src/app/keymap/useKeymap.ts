/**
 * `useKeymap(scope, bindings)`: registers handlers (and their F1 metadata) while the component is
 * mounted. Bindings may change on every render; the latest `run` closures are always used.
 *
 *   useKeymap('videoTriage', [
 *     { id: 'videoTriage.moveLeft', keys: ['A'], description: 'Move to L', run: () => ... }
 *   ])
 */
import { useEffect, useRef } from 'react'
import type { KeymapScope } from '@shared/domain/keymap'
import { useAppDispatch } from '../hooks'
import { bindingsRegistered, bindingsUnregistered } from './keymapSlice'
import { registerHandlers } from './registry'
import { toBindingMeta, type KeyBinding, type KeymapOptions } from './types'

export function useKeymap(
  scope: KeymapScope,
  bindings: readonly KeyBinding[],
  options: KeymapOptions = {}
): void {
  const dispatch = useAppDispatch()
  const latest = useRef(bindings)
  latest.current = bindings
  const enabled = options.enabled ?? true
  // Re-register when the set of ids/keys/enabled flags changes, not on every new closure.
  const signature = bindings
    .map((b) => `${b.id}|${b.keys.join(',')}|${b.enabled === false ? 0 : 1}|${b.description}`)
    .join(';')

  useEffect(() => {
    if (!enabled) return undefined
    const stable: KeyBinding[] = latest.current.map((binding) => ({
      ...binding,
      run: (event) => {
        latest.current.find((b) => b.id === binding.id)?.run(event)
      }
    }))
    const unregister = registerHandlers(scope, stable)
    dispatch(bindingsRegistered(stable.map((b) => toBindingMeta(scope, b))))
    return () => {
      unregister()
      dispatch(bindingsUnregistered(stable.map((b) => b.id)))
    }
  }, [scope, enabled, signature, dispatch])
}
