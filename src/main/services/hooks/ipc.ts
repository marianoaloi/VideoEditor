/** Stub (wave 1). Owner (wave 2): svc-files. Replace `registerStubs` with the real `handle()` calls. */
import { HOOKS_INVOKE_CHANNELS } from '@shared/ipc/channels/hooks.names'
import type { MainContext } from '../../ipc/context'
import { registerStubs } from '../../ipc/stub'

export function registerHooksIpc(_ctx: MainContext): void {
  registerStubs(HOOKS_INVOKE_CHANNELS)
}
