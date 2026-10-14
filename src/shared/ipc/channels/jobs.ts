/** Job channels (F7, F8; ADR-005). Owner (wave 2): svc-jobs. */
import { defineInvoke, type InvokeMapOf } from '../define';
import { EmptyRequestSchema } from '../../domain/common';
import {
  EnqueueFilesRequestSchema,
  EnqueueFolderRequestSchema,
  JobRefSchema,
  ReadJobRequestSchema,
  SaveJobRequestSchema,
  ToolsRequestSchema,
  type ClearQueueResult,
  type EnqueueResult,
  type JobEvent,
  type JobLogResult,
  type JobSummary,
  type ReadJobResult,
  type SaveJobResult,
  type ToolsStatus
} from '../../domain/job';

export {
  EnqueueFilesRequestSchema,
  EnqueueFolderRequestSchema,
  JobRefSchema,
  ReadJobRequestSchema,
  SaveJobRequestSchema,
  ToolsRequestSchema
};

export const jobsInvoke = {
  /** Writes `<videoPath>.json` (v2 + legacy keys); `filename` = videoPath. */
  'jobs:saveJob': defineInvoke(SaveJobRequestSchema).returns<SaveJobResult>(),
  /** Reads `<videoPath>.json` in any format; `found: false` when there is none. */
  'jobs:readJob': defineInvoke(ReadJobRequestSchema).returns<ReadJobResult>(),
  'jobs:enqueueFolder': defineInvoke(EnqueueFolderRequestSchema).returns<EnqueueResult>(),
  'jobs:enqueueFiles': defineInvoke(EnqueueFilesRequestSchema).returns<EnqueueResult>(),
  /** Cancels a queued or running job (kills its ffmpeg tree). */
  'jobs:cancel': defineInvoke(JobRefSchema).returns<void>(),
  /** Cancels every queued (not running) job. */
  'jobs:clearQueue': defineInvoke(EmptyRequestSchema).returns<ClearQueueResult>(),
  'jobs:list': defineInvoke(EmptyRequestSchema).returns<JobSummary[]>(),
  /** Full log of a job (the renderer keeps only a tail). */
  'jobs:log': defineInvoke(JobRefSchema).returns<JobLogResult>(),
  /** ffmpeg/ffprobe location, versions and available H.264 encoders. */
  'jobs:tools': defineInvoke(ToolsRequestSchema).returns<ToolsStatus>()
} as const;

export type JobsInvoke = InvokeMapOf<typeof jobsInvoke>;

export interface JobsEvents {
  'jobs:event': JobEvent;
}
