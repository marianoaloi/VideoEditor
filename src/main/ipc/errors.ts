/**
 * Errors of the main process and their mapping to the serialisable IPC envelope (ADR-003).
 * Services throw `AppError` (or let a Node/zod/abort error escape); `handle()` converts it.
 */
import { ZodError } from 'zod'
import type { IpcError, IpcErrorCode } from '@shared/domain/errors'

export class AppError extends Error {
  readonly code: IpcErrorCode
  readonly details?: unknown

  constructor(
    code: IpcErrorCode,
    message: string,
    details?: unknown,
    options?: { cause?: unknown }
  ) {
    super(message, options)
    this.name = 'AppError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

export function appError(code: IpcErrorCode, message: string, details?: unknown): AppError {
  return new AppError(code, message, details)
}

/** Stub services throw this until their wave-2 owner replaces the handler. */
export function notImplemented(channel: string): AppError {
  return new AppError('NOT_IMPLEMENTED', `${channel} is not implemented yet`, { channel })
}

interface ErrnoLike {
  readonly code: string
  readonly message: string
}

function isErrnoLike(error: unknown): error is Error & ErrnoLike {
  if (!(error instanceof Error)) return false
  const code: unknown = Reflect.get(error, 'code')
  return typeof code === 'string' && /^E[A-Z0-9]+$/.test(code)
}

/** Keeps only JSON-safe data so the envelope always survives structured clone. */
export function toSerialisable(value: unknown): unknown {
  if (value === undefined) return undefined
  try {
    const text = JSON.stringify(value)
    return text === undefined ? undefined : (JSON.parse(text) as unknown)
  } catch {
    return String(value)
  }
}

function withDetails(code: IpcErrorCode, message: string, details: unknown): IpcError {
  const safe = toSerialisable(details)
  return safe === undefined ? { code, message } : { code, message, details: safe }
}

const ERRNO_CODES: Readonly<Record<string, IpcErrorCode>> = {
  ENOENT: 'NOT_FOUND',
  ENOTDIR: 'NOT_FOUND',
  EEXIST: 'ALREADY_EXISTS',
  EACCES: 'PERMISSION_DENIED',
  EPERM: 'PERMISSION_DENIED'
}

/** Maps anything thrown by a handler to the envelope error. Never throws. */
export function toIpcError(error: unknown): IpcError {
  if (error instanceof AppError) return withDetails(error.code, error.message, error.details)
  if (error instanceof ZodError) {
    return withDetails('VALIDATION', 'Invalid request', { issues: error.issues })
  }
  if (isErrnoLike(error)) {
    const code = ERRNO_CODES[error.code] ?? 'IO'
    return withDetails(code, error.message, { errno: error.code })
  }
  if (error instanceof Error) {
    if (error.name === 'AbortError') return { code: 'CANCELLED', message: 'Cancelled' }
    return { code: 'INTERNAL', message: error.message }
  }
  return { code: 'INTERNAL', message: String(error) }
}
