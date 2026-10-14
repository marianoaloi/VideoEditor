/** Runtime channel names for `jobs.ts` (zod-free: the preload bundles this file). */
import { channelNames } from '../define';
import type { JobsEvents, JobsInvoke } from './jobs';

export const JOBS_INVOKE_CHANNELS = channelNames<keyof JobsInvoke & string>()([
  'jobs:saveJob',
  'jobs:readJob',
  'jobs:enqueueFolder',
  'jobs:enqueueFiles',
  'jobs:cancel',
  'jobs:clearQueue',
  'jobs:list',
  'jobs:log',
  'jobs:tools'
]);

export const JOBS_EVENT_CHANNELS = channelNames<keyof JobsEvents & string>()(['jobs:event']);
