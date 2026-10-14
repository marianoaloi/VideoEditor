/** Jobs channels (ADR-005): thin handlers over `JobsService`. */
import { JOBS_INVOKE_CHANNELS } from '@shared/ipc/channels/jobs.names'
import type { MainContext } from '../../ipc/context'
import { handle } from '../../ipc/handle'
import { JobsService } from './jobsService'

/** Registers every `jobs:*` channel. Returns the service so the app can abort jobs on quit. */
export function registerJobsIpc(ctx: MainContext): JobsService {
  const service = new JobsService(ctx)
  handle('jobs:saveJob', (req) => service.saveJob(req))
  handle('jobs:readJob', (req) => service.readJob(req.videoPath))
  handle('jobs:enqueueFolder', (req) => service.enqueueFolder(req))
  handle('jobs:enqueueFiles', (req) => service.enqueueFiles(req))
  handle('jobs:cancel', (req) => {
    service.cancel(req.jobId)
  })
  handle('jobs:clearQueue', () => service.clearQueue())
  handle('jobs:list', () => service.list())
  handle('jobs:log', (req) => service.log(req.jobId))
  handle('jobs:tools', (req) => service.tools(req.refresh))
  return service
}

export const JOBS_CHANNELS = JOBS_INVOKE_CHANNELS
