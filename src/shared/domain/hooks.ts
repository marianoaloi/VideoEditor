/**
 * External programs as configurable hooks (ADR-008, amended: optional `env`).
 * Owner (wave 2): svc-files (runner in `main/services/hooks`, pure expansion in `core/hookArgs.ts`).
 *
 * Expansion rules (svc-files implements them; Settings shows a preview through `hooks:preview`):
 * - Placeholders: `{file}` `{files}` `{dir}` `{root}` `{md5}` `{outputs}`. `{{` and `}}` are literal braces.
 *   An unknown `{name}` or a placeholder without a value in the context is an error (VALIDATION).
 * - `args`: substituted per argv entry, never by joining a command string. An entry that contains a
 *   list placeholder (`{files}`, `{outputs}`) becomes one argv entry per value.
 * - `env` values and `cwd`: same placeholders; list placeholders are joined with `\n`
 *   (Nautilus `NAUTILUS_SCRIPT_SELECTED_FILE_PATHS` convention). The hook env is merged over
 *   `process.env`.
 * - Always `spawn(command, args, { shell: false })`. Output goes to the job log or a notification;
 *   a non-zero exit is reported.
 */
import { z } from 'zod';
import { AbsPathSchema, IdSchema, NonNegIntSchema } from './common';
import { IpcErrorSchema } from './errors';

export const HOOK_NAMES = [
  'uploadOutputs',
  'uploadAll',
  'moviesL',
  'uploadImagesL',
  'deleteR',
  'externalPlayer',
  'openList'
] as const;
export const HookNameSchema = z.enum(HOOK_NAMES);
export type HookName = z.infer<typeof HookNameSchema>;

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const CommandTemplateSchema = z.object({
  enabled: z.boolean(),
  /** Executable path, or a name looked up on PATH. `''` = not configured. */
  command: z.string(),
  args: z.array(z.string()),
  cwd: z.string().optional(),
  env: z.record(z.string().regex(ENV_NAME, 'Invalid environment variable name'), z.string()).optional()
});
export type CommandTemplate = z.infer<typeof CommandTemplateSchema>;

export const HOOK_PLACEHOLDERS = [
  { token: '{file}', list: false, description: 'The current file (absolute path)' },
  { token: '{files}', list: true, description: 'Several files: one argv entry each, \\n-joined in env' },
  { token: '{dir}', list: false, description: 'The folder the hook acts on (e.g. <root>/L)' },
  { token: '{root}', list: false, description: 'The session root' },
  { token: '{md5}', list: false, description: 'MD5 of the source file' },
  { token: '{outputs}', list: true, description: 'Job outputs: one argv entry each, \\n-joined in env' }
] as const;
export type HookPlaceholder = (typeof HOOK_PLACEHOLDERS)[number]['token'];

/** Values available to the expansion. Each hook documents which ones it receives (HOOK_META). */
export const HookContextSchema = z.object({
  file: AbsPathSchema.optional(),
  files: z.array(AbsPathSchema).optional(),
  dir: AbsPathSchema.optional(),
  root: AbsPathSchema.optional(),
  md5: z.string().regex(/^[0-9a-f]{32}$/).optional(),
  outputs: z.array(AbsPathSchema).optional()
});
export type HookContext = z.infer<typeof HookContextSchema>;

export interface HookMeta {
  readonly label: string;
  readonly trigger: string;
  readonly provides: readonly HookPlaceholder[];
  /** `deleteR` always trashes the top-level files of `R/`; its command is an optional extra. */
  readonly builtIn?: string;
}

export const HOOK_META: Readonly<Record<HookName, HookMeta>> = {
  uploadOutputs: {
    label: 'Upload job outputs',
    trigger: 'After each successful job with "upload" on',
    provides: ['{file}', '{outputs}', '{md5}', '{dir}', '{root}']
  },
  uploadAll: {
    label: 'Upload the whole batch',
    trigger: 'When a batch ends with "upload all" on',
    provides: ['{outputs}', '{dir}']
  },
  moviesL: {
    label: 'Process the L folder (movies.sh)',
    trigger: 'Jobs: "Clean queue and execute movie"',
    provides: ['{dir}', '{root}']
  },
  uploadImagesL: {
    label: 'Upload kept images',
    trigger: 'Image Triage: L ("send")',
    provides: ['{dir}', '{root}']
  },
  deleteR: {
    label: 'Delete the R folder',
    trigger: 'Image Triage: L ("send"); Jobs: "Clean queue and execute movie"',
    provides: ['{dir}', '{root}', '{files}'],
    builtIn: 'Sends every top-level file of <root>/R to the trash, then runs the command if enabled'
  },
  externalPlayer: {
    label: 'Open in an external player',
    trigger: 'F8 or + in Video Triage',
    provides: ['{file}']
  },
  openList: {
    label: 'Open a file list in another viewer',
    trigger: 'Duplicates: "Open first line analyses"',
    provides: ['{files}']
  }
};

// ---- requests / results / events ----------------------------------------------------------

export const HookRunRequestSchema = z.object({
  name: HookNameSchema,
  context: HookContextSchema
});
export type HookRunRequest = z.input<typeof HookRunRequestSchema>;

/** `hooks:run` returns at once; output and the exit arrive as `hooks:output` / `hooks:exit`. */
export const HookRunStartedSchema = z.object({
  runId: IdSchema,
  name: HookNameSchema,
  /** True when the hook is disabled or has no command (built-in `deleteR` work still runs). */
  skipped: z.boolean()
});
export type HookRunStarted = z.infer<typeof HookRunStartedSchema>;

export const HookPreviewRequestSchema = z.object({
  template: CommandTemplateSchema,
  context: HookContextSchema
});
export type HookPreviewRequest = z.input<typeof HookPreviewRequestSchema>;

export const HookPreviewSchema = z.object({
  command: z.string(),
  args: z.array(z.string()),
  cwd: z.string().nullable(),
  env: z.record(z.string(), z.string())
});
export type HookPreview = z.infer<typeof HookPreviewSchema>;

export const HookOutputSchema = z.object({
  runId: IdSchema,
  name: HookNameSchema,
  stream: z.enum(['stdout', 'stderr']),
  lines: z.array(z.string()).min(1)
});
export type HookOutput = z.infer<typeof HookOutputSchema>;

export const HookExitSchema = z.object({
  runId: IdSchema,
  name: HookNameSchema,
  /** `null` when the process could not start or was killed. */
  code: z.number().int().nullable(),
  durationMs: NonNegIntSchema,
  error: IpcErrorSchema.nullable()
});
export type HookExit = z.infer<typeof HookExitSchema>;
