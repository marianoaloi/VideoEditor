/** Stub (wave 1). Owner (wave 2): svc-files. Replace `registerStubs` with the real `handle()` calls. */
import { APP_INVOKE_CHANNELS } from '@shared/ipc/channels/app.names'
import type { MainContext } from '../../ipc/context'
import { registerStubs } from '../../ipc/stub'

export function registerAppIpc(_ctx: MainContext): void {
  registerStubs(APP_INVOKE_CHANNELS)
}
