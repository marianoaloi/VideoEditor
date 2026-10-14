/** Stub (wave 1). Owner (wave 2): svc-files. Replace `registerStubs` with the real `handle()` calls. */
import { SESSION_INVOKE_CHANNELS } from '@shared/ipc/channels/session.names'
import type { MainContext } from '../../ipc/context'
import { registerStubs } from '../../ipc/stub'

export function registerSessionIpc(_ctx: MainContext): void {
  registerStubs(SESSION_INVOKE_CHANNELS)
}
