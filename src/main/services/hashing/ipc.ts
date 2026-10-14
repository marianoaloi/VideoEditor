/** Stub (wave 1). Owner (wave 2): svc-hash. Replace `registerStubs` with the real `handle()` calls. */
import { HASHING_INVOKE_CHANNELS } from '@shared/ipc/channels/hashing.names'
import type { MainContext } from '../../ipc/context'
import { registerStubs } from '../../ipc/stub'

export function registerHashingIpc(_ctx: MainContext): void {
  registerStubs(HASHING_INVOKE_CHANNELS)
}
