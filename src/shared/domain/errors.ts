/**
 * The serialisable error that crosses IPC (ADR-003), and the envelope every invoke returns.
 * Owner: frozen (lead). New codes are additive.
 */
import { z } from 'zod';

export const IPC_ERROR_CODES = [
  /** The request failed zod validation in main. `details.issues` holds the zod issues. */
  'VALIDATION',
  /** The channel exists but its service is still a stub. */
  'NOT_IMPLEMENTED',
  /** The preload refused a channel that is not in the allowlist. */
  'UNKNOWN_CHANNEL',
  /** The IPC sender is not the app window, or the OS denied access (EACCES/EPERM). */
  'PERMISSION_DENIED',
  /** A path is outside the open session roots / media allowlist. */
  'PATH_NOT_ALLOWED',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'SESSION_NOT_FOUND',
  /** A required Setting is missing: personal folder, hook command, ffmpeg path, ... */
  'NOT_CONFIGURED',
  'NOTHING_TO_UNDO',
  /** The operation conflicts with current state (job already queued, task id in use, ...). */
  'CONFLICT',
  'FFMPEG_NOT_FOUND',
  'PROBE_FAILED',
  /** A child process exited with a failure that the service could not recover from. */
  'PROCESS_FAILED',
  'TIMEOUT',
  'CANCELLED',
  /** Any other file-system error. `details.errno` holds the Node error code. */
  'IO',
  'INTERNAL'
] as const;

export const IpcErrorCodeSchema = z.enum(IPC_ERROR_CODES);
export type IpcErrorCode = z.infer<typeof IpcErrorCodeSchema>;

export const IpcErrorSchema = z.object({
  code: IpcErrorCodeSchema,
  message: z.string(),
  details: z.unknown().optional()
});
export type IpcError = z.infer<typeof IpcErrorSchema>;

/** What `ipcRenderer.invoke` resolves with. Main never rejects; it returns `ok: false`. */
export type IpcResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: IpcError };

export function ipcOk<T>(data: T): IpcResult<T> {
  return { ok: true, data };
}

export function ipcFail(code: IpcErrorCode, message: string, details?: unknown): IpcResult<never> {
  return details === undefined
    ? { ok: false, error: { code, message } }
    : { ok: false, error: { code, message, details } };
}

export function isIpcError(value: unknown): value is IpcError {
  return IpcErrorSchema.safeParse(value).success;
}
