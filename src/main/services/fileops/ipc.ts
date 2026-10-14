/** Stub (wave 1). Owner (wave 2): svc-files. Replace `registerStubs` with the real `handle()` calls. */
import { FILEOPS_INVOKE_CHANNELS } from '@shared/ipc/channels/fileops.names'
import type { MainContext } from '../../ipc/context'
import { registerStubs } from '../../ipc/stub'

export function registerFileopsIpc(_ctx: MainContext): void {
  registerStubs(FILEOPS_INVOKE_CHANNELS)
}
