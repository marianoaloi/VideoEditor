/** Stub (wave 1). Owner (wave 2): svc-jobs. Replace `registerStubs` with the real `handle()` calls. */
import { JOBS_INVOKE_CHANNELS } from '@shared/ipc/channels/jobs.names'
import type { MainContext } from '../../ipc/context'
import { registerStubs } from '../../ipc/stub'

export function registerJobsIpc(_ctx: MainContext): void {
  registerStubs(JOBS_INVOKE_CHANNELS)
}
