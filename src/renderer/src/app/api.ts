/**
 * The renderer's client for `window.api` (ADR-003). Components and thunks call `call()` /
 * `onEvent()`; they never touch `window.api` directly and never see the `{ ok, error }` envelope.
 *
 *   const session = await call('session:open', { dir, kind: 'video' })   // throws ApiError
 *   const off = onEvent('jobs:event', (event) => ...)                      // returns unsubscribe
 */
import type { IpcError, IpcErrorCode } from '@shared/domain/errors'
import type {
  EventChannel,
  EventPayload,
  InvokeChannel,
  InvokeRequest,
  InvokeResponse,
  RendererApi
} from '@shared/ipc/contract'

/** An IPC failure. `code` is one of `IPC_ERROR_CODES`; `details` is whatever main attached. */
export class ApiError extends Error {
  readonly code: IpcErrorCode
  readonly details?: unknown
  readonly channel?: string

  constructor(error: IpcError, channel?: string) {
    super(error.message)
    this.name = 'ApiError'
    this.code = error.code
    if (error.details !== undefined) this.details = error.details
    if (channel !== undefined) this.channel = channel
  }

  toJSON(): SerializedError {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details }
  }
}

/** Plain-object error that is safe to keep in Redux state and to return from `rejectWithValue`. */
export interface SerializedError {
  code: IpcErrorCode
  message: string
  details?: unknown
}

export function toSerializedError(error: unknown): SerializedError {
  if (error instanceof ApiError) return error.toJSON()
  if (error instanceof Error) return { code: 'INTERNAL', message: error.message }
  return { code: 'INTERNAL', message: String(error) }
}

let bridgeOverride: RendererApi | null = null

/** Tests install a fake bridge; pass `null` to go back to `window.api`. */
export function setBridge(bridge: RendererApi | null): void {
  bridgeOverride = bridge
}

function bridge(): RendererApi {
  if (bridgeOverride !== null) return bridgeOverride
  const candidate: unknown = (window as unknown as { api?: unknown }).api
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof (candidate as { invoke?: unknown }).invoke !== 'function'
  ) {
    throw new ApiError({
      code: 'INTERNAL',
      message: 'window.api is not available (preload missing)'
    })
  }
  return candidate as RendererApi
}

/** Channels whose request may be omitted (`{}` or `undefined` is valid). */
type CallArgs<C extends InvokeChannel> =
  undefined extends InvokeRequest<C> ? [request?: InvokeRequest<C>] : [request: InvokeRequest<C>]

/** Invokes a channel and unwraps the envelope. Throws `ApiError` on `ok: false`. */
export async function call<C extends InvokeChannel>(
  channel: C,
  ...args: CallArgs<C>
): Promise<InvokeResponse<C>> {
  const result = await bridge().invoke(channel, args[0] as InvokeRequest<C>)
  if (!result.ok) throw new ApiError(result.error, channel)
  return result.data
}

/** Subscribes to an event channel. The listener receives only the payload. */
export function onEvent<C extends EventChannel>(
  channel: C,
  listener: (payload: EventPayload<C>) => void
): () => void {
  return bridge().on(channel, listener)
}

/** Absolute path of a dropped `File` (`webUtils.getPathForFile` via the preload); `''` if none. */
export function pathForFile(file: File): string {
  return bridge().getPathForFile(file)
}

export const api = { call, onEvent, pathForFile } as const
