/**
 * Video jobs (`<video>.json`, LEG §2.2 / SPEC §4) and the job queue (ADR-005).
 * Owner (wave 2): svc-jobs. The legacy adapter lives in `core/videoJob.ts`.
 */
import { z } from 'zod';
import {
  AbsPathSchema,
  IdSchema,
  NonNegIntSchema,
  TimestampMsSchema
} from './common';
import { IpcErrorSchema } from './errors';
import { RectSchema } from './geometry';

/** Legacy `ProcessingFF`: cut = one output per range (`<video>.<i>.mp4`), concat = one output. */
export const ProcessingMode = { cut: 1, concat: 2 } as const;
export const ProcessingModeSchema = z.union([z.literal(1), z.literal(2)]);
export type ProcessingMode = z.infer<typeof ProcessingModeSchema>;

/** `[-1, durationMs]` means "the whole video" (legacy `IGNORE_TIME_USE_FULL_VIDEO`). */
export const WHOLE_VIDEO_START_MS = -1;

/** `[startMs, endMs]`, integers. */
export const RangeSchema = z
  .tuple([z.number().int().min(WHOLE_VIDEO_START_MS), z.number().int().nonnegative()])
  .refine(
    ([start, end]) => start === WHOLE_VIDEO_START_MS || start < end,
    'A range needs start < end (or start = -1 for the whole video)'
  );
export type Range = z.infer<typeof RangeSchema>;

/** `"WxH"`, `"W:H"` (ffmpeg scale, -1/-2 allowed) or `"-1"` (keep the source size). */
export const VideoSizeSchema = z
  .string()
  .regex(/^(-1|-?\d+[x:]-?\d+)$/, 'Expected "WxH", "W:H" or "-1"');

/**
 * The job file as this app writes it: the legacy key set plus `version: 2` (SPEC §4).
 * Key order matches the legacy `__dict__` dump; `serializeVideoJob` keeps it.
 */
export const VideoJobSchema = z.object({
  /** Absolute path of the video at its current location (main sets it on save and on read). */
  filename: AbsPathSchema,
  /** Where the video was before triage moved it (informational; undo uses the journal). */
  originalPath: z.string().min(1),
  crop: RectSchema.nullable(),
  /** −1..1 (ffmpeg eq brightness range; ADR-005 fixes the legacy `bright*100`). */
  bright: z.number().nullable(),
  /** −4..4, 1 = neutral. */
  contrast: z.number().nullable(),
  /** Degrees, legacy sign (= −dialog slider). */
  transpose: z.number().int().nullable(),
  mediaPath: z.string().nullable(),
  /** Legacy "convert first" (re-encode broken containers before processing). */
  convert: z.boolean(),
  size: VideoSizeSchema.nullable(),
  /** Video bitrate in kbit/s; null → source bitrate capped at `thresholds.maxRateKbps`. */
  rate: z.number().int().positive().nullable(),
  /** fps hint; null → source fps. */
  avgrate: z.number().positive().nullable(),
  times: z.array(RangeSchema),
  posExecution: ProcessingModeSchema,
  version: z.literal(2)
});
export type VideoJob = z.infer<typeof VideoJobSchema>;

/** What the renderer sends to `jobs:saveJob`; main fills `filename`, `version` and defaults. */
export const VideoJobDraftSchema = z.object({
  originalPath: z.string().min(1).optional(),
  crop: RectSchema.nullable().default(null),
  bright: z.number().nullable().default(null),
  contrast: z.number().nullable().default(null),
  transpose: z.number().int().nullable().default(null),
  mediaPath: z.string().nullable().default(null),
  convert: z.boolean().default(false),
  size: VideoSizeSchema.nullable().default(null),
  rate: z.number().int().positive().nullable().default(null),
  avgrate: z.number().positive().nullable().default(null),
  times: z.array(RangeSchema).default([]),
  posExecution: ProcessingModeSchema.default(ProcessingMode.cut)
});
export type VideoJobDraft = z.input<typeof VideoJobDraftSchema>;

// ---- legacy formats (read only) -----------------------------------------------------------

const LooseScalar = z.union([z.number(), z.string()]).nullable().optional();

/**
 * Legacy "current" format: the v2 key set without `version`. Values are loose because the old UI
 * stored text-field values (`rate`, `avgrate`, `size` as strings) and Python `None`s.
 */
export const LegacyVideoJobSchema = z.looseObject({
  filename: z.string().nullable().optional(),
  originalPath: z.string().nullable().optional(),
  crop: z.unknown().optional(),
  bright: LooseScalar,
  contrast: LooseScalar,
  transpose: LooseScalar,
  mediaPath: z.string().nullable().optional(),
  convert: z.union([z.boolean(), z.number(), z.string()]).nullable().optional(),
  size: LooseScalar,
  rate: LooseScalar,
  avgrate: LooseScalar,
  times: z.array(z.unknown()).nullable().optional(),
  posExecution: LooseScalar
});
export type LegacyVideoJob = z.infer<typeof LegacyVideoJobSchema>;

/**
 * Legacy "old" format (`UtilFileTimes.openTimes.transformSavedFile`):
 * `definedSize` → size, `definedRate` → rate, `times: [{st, du}]` → `[st, du]` (`du` is the END,
 * as in `TimeComponent.duration`), `posExecution: "f"` → concat, anything else → cut.
 */
export const LegacyOldVideoJobSchema = z.looseObject({
  definedSize: LooseScalar,
  definedRate: LooseScalar,
  times: z
    .array(z.looseObject({ st: z.union([z.number(), z.string()]), du: z.union([z.number(), z.string()]) }))
    .nullable()
    .optional(),
  posExecution: LooseScalar
});
export type LegacyOldVideoJob = z.infer<typeof LegacyOldVideoJobSchema>;

export const VideoJobFormatSchema = z.enum(['v2', 'legacy', 'legacy-old']);
export type VideoJobFormat = z.infer<typeof VideoJobFormatSchema>;

// ---- queue ----------------------------------------------------------------------------------

export const JobIdSchema = IdSchema;
export type JobId = z.infer<typeof JobIdSchema>;

export const JobStatusSchema = z.enum(['queued', 'running', 'done', 'error', 'cancelled']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

/** DialogResume / ExecuteConfiguratedFiles checkboxes. All off by default. */
export const EnqueueOptionsSchema = z.object({
  /** Run hook `uploadOutputs` after each successful job ("Send to 4"). */
  upload: z.boolean().default(false),
  /** Run hook `uploadAll` with every output when the batch ends ("Send to Account"). */
  uploadAll: z.boolean().default(false),
  /** Trash the source video and its `.json` after success ("Delete original"). */
  deleteOriginal: z.boolean().default(false),
  /** "Ignore Error": tolerate decode errors (semantics: research ffmpeg-jobs.md). */
  ignoreErrors: z.boolean().default(false),
  /** "Same Size": keep the source dimensions (no ≤ maxSide scaling). */
  sameSize: z.boolean().default(false),
  /** Concat: keep the cut parts instead of trashing them (`--keepFiles`). */
  keepParts: z.boolean().default(false)
});
export type EnqueueOptions = z.infer<typeof EnqueueOptionsSchema>;
export type EnqueueOptionsInput = z.input<typeof EnqueueOptionsSchema>;

export const JobSummarySchema = z.object({
  id: JobIdSchema,
  videoPath: AbsPathSchema,
  /** `null` for force (full-length) jobs, which have no JSON. */
  jsonPath: AbsPathSchema.nullable(),
  mode: ProcessingModeSchema,
  status: JobStatusSchema,
  /** 0..1 over all ffmpeg steps of the job. */
  progress: z.number().min(0).max(1),
  outputs: z.array(AbsPathSchema),
  error: IpcErrorSchema.nullable(),
  options: EnqueueOptionsSchema,
  batchId: IdSchema.nullable(),
  createdAt: TimestampMsSchema,
  startedAt: TimestampMsSchema.nullable(),
  finishedAt: TimestampMsSchema.nullable(),
  logPath: AbsPathSchema.nullable()
});
export type JobSummary = z.infer<typeof JobSummarySchema>;

/** Event `jobs:event`. Main throttles `progress` (~4/s per job) and batches `log` lines. */
export const JobEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('queued'), job: JobSummarySchema }),
  z.object({ type: z.literal('started'), jobId: JobIdSchema, at: TimestampMsSchema }),
  z.object({
    type: z.literal('progress'),
    jobId: JobIdSchema,
    progress: z.number().min(0).max(1),
    stepIndex: NonNegIntSchema,
    stepCount: z.number().int().positive(),
    outTimeMs: NonNegIntSchema.nullable(),
    speed: z.number().nonnegative().nullable()
  }),
  z.object({ type: z.literal('log'), jobId: JobIdSchema, lines: z.array(z.string()).min(1) }),
  z.object({
    type: z.literal('done'),
    jobId: JobIdSchema,
    outputs: z.array(AbsPathSchema),
    durationMs: NonNegIntSchema
  }),
  z.object({ type: z.literal('error'), jobId: JobIdSchema, error: IpcErrorSchema }),
  z.object({ type: z.literal('cancelled'), jobId: JobIdSchema })
]);
export type JobEvent = z.infer<typeof JobEventSchema>;

// ---- requests / results -------------------------------------------------------------------

export const SaveJobRequestSchema = z.object({
  videoPath: AbsPathSchema,
  job: VideoJobDraftSchema
});
export type SaveJobRequest = z.input<typeof SaveJobRequestSchema>;
export const SaveJobResultSchema = z.object({ jsonPath: AbsPathSchema, job: VideoJobSchema });
export type SaveJobResult = z.infer<typeof SaveJobResultSchema>;

export const ReadJobRequestSchema = z.object({ videoPath: AbsPathSchema });
export type ReadJobRequest = z.input<typeof ReadJobRequestSchema>;
export const ReadJobResultSchema = z.object({
  found: z.boolean(),
  job: VideoJobSchema.nullable(),
  format: VideoJobFormatSchema.nullable(),
  warnings: z.array(z.string())
});
export type ReadJobResult = z.infer<typeof ReadJobResultSchema>;

/**
 * Batch a folder (usually `<root>/CUSTOM`): every `*.json` with its video. Orphan or empty JSON
 * files are reported in `skipped` and moved aside, never deleted (ADR-005).
 * `force`: every video in the folder becomes a full-length job, without JSON.
 */
export const EnqueueFolderRequestSchema = z.object({
  dir: AbsPathSchema,
  options: EnqueueOptionsSchema.prefault({}),
  force: z.boolean().default(false)
});
export type EnqueueFolderRequest = z.input<typeof EnqueueFolderRequestSchema>;

/** Videos (with a sidecar JSON unless `force`), e.g. the Cutter "process now" or drag-and-drop. */
export const EnqueueFilesRequestSchema = z.object({
  paths: z.array(AbsPathSchema).min(1).max(10000),
  options: EnqueueOptionsSchema.prefault({}),
  force: z.boolean().default(false)
});
export type EnqueueFilesRequest = z.input<typeof EnqueueFilesRequestSchema>;

export const SkippedJobSchema = z.object({
  path: AbsPathSchema,
  reason: z.string(),
  movedTo: AbsPathSchema.nullable()
});
export const EnqueueResultSchema = z.object({
  batchId: IdSchema,
  jobIds: z.array(JobIdSchema),
  skipped: z.array(SkippedJobSchema)
});
export type EnqueueResult = z.infer<typeof EnqueueResultSchema>;

export const JobRefSchema = z.object({ jobId: JobIdSchema });
export type JobRef = z.input<typeof JobRefSchema>;

export const ClearQueueResultSchema = z.object({ cancelled: NonNegIntSchema });
export type ClearQueueResult = z.infer<typeof ClearQueueResultSchema>;

export const JobLogResultSchema = z.object({
  jobId: JobIdSchema,
  lines: z.array(z.string()),
  logPath: AbsPathSchema.nullable()
});
export type JobLogResult = z.infer<typeof JobLogResultSchema>;

export const ToolsRequestSchema = z.object({ refresh: z.boolean().default(false) }).prefault({});
export type ToolsRequest = z.input<typeof ToolsRequestSchema>;

export const ToolInfoSchema = z.object({ path: AbsPathSchema, version: z.string().nullable() });
export type ToolInfo = z.infer<typeof ToolInfoSchema>;

/** For the Settings screen: which binaries were found and what the encoder chain can use. */
export const ToolsStatusSchema = z.object({
  ffmpeg: ToolInfoSchema.nullable(),
  ffprobe: ToolInfoSchema.nullable(),
  /** H.264 encoders `ffmpeg -encoders` reports (h264_nvenc, libx264, ...). */
  h264Encoders: z.array(z.string()),
  hwaccels: z.array(z.string()),
  error: IpcErrorSchema.nullable()
});
export type ToolsStatus = z.infer<typeof ToolsStatusSchema>;
