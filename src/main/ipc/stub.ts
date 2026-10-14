/**
 * Placeholder handlers for the wave-1 stubs: every channel answers `NOT_IMPLEMENTED`.
 * A service owner replaces the `registerStubs(...)` line in its `ipc.ts` with real `handle()` calls.
 */
import type { InvokeChannel } from '@shared/ipc/contract'
import { notImplemented } from './errors'
import { handle } from './handle'

export function registerStubs(channels: readonly InvokeChannel[]): void {
  for (const channel of channels) {
    handle(channel, () => {
      throw notImplemented(channel)
    })
  }
}
