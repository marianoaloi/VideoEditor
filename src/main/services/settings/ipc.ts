/** Stub (wave 1). Owner (wave 2): svc-files. Replace `registerStubs` with the real `handle()` calls. */
import { SETTINGS_INVOKE_CHANNELS } from '@shared/ipc/channels/settings.names'
import type { MainContext } from '../../ipc/context'
import { registerStubs } from '../../ipc/stub'

export function registerSettingsIpc(_ctx: MainContext): void {
  registerStubs(SETTINGS_INVOKE_CHANNELS)
}
