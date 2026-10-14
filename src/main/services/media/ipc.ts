/** Stub (wave 1). Owner (wave 2): svc-media. Replace `registerStubs` with the real `handle()` calls. */
import { MEDIA_INVOKE_CHANNELS } from '@shared/ipc/channels/media.names'
import type { MainContext } from '../../ipc/context'
import { registerStubs } from '../../ipc/stub'

export function registerMediaIpc(_ctx: MainContext): void {
  registerStubs(MEDIA_INVOKE_CHANNELS)
}
