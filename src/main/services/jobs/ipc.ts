/** Jobs channels (ADR-005): thin handlers over `JobsService`. */
import { JOBS_INVOKE_CHANNELS } from '@shared/ipc/channels/jobs.names'
import type { MainContext } from '../../ipc/context'
import { handle } from '../../ipc/handle'
import { resolveGuardedPath, resolveGuardedPaths } from '../../ipc/pathGuard'
import { JobsService } from './jobsService'

/** Registers every `jobs:*` channel. Returns the service so the app can abort jobs on quit. */
export function registerJobsIpc(ctx: MainContext): JobsService {
  const service = new JobsService(ctx)
  handle('jobs:saveJob', async (req) =>
    service.saveJob({ ...req, videoPath: await resolveGuardedPath(ctx, req.videoPath) })
  )
  handle('jobs:readJob', async (req) =>
    service.readJob(await resolveGuardedPath(ctx, req.videoPath))
  )
  handle('jobs:enqueueFolder', async (req) =>
    service.enqueueFolder({ ...req, dir: await resolveGuardedPath(ctx, req.dir) })
  )
  handle('jobs:enqueueFiles', async (req) =>
    service.enqueueFiles({ ...req, paths: await resolveGuardedPaths(ctx, req.paths) })
  )
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
