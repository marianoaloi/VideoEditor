/**
 * The one generic, typed bridge `window.api` (ADR-003). The preload is sandboxed, so this file
 * imports only `electron` and the zod-free `@shared/ipc/contract` (channel allowlists + types).
 *
 *   contextBridge.exposeInMainWorld('api', createBridge())      // src/preload/index.ts
 */
import { ipcRenderer, webUtils } from 'electron'
import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  type EventChannel,
  type EventPayload,
  type InvokeChannel,
  type InvokeRequest,
  type InvokeResponse,
  type IpcResult,
  type RendererApi
} from '@shared/ipc/contract'

const invokeAllowlist: ReadonlySet<string> = new Set(INVOKE_CHANNELS)
const eventAllowlist: ReadonlySet<string> = new Set(EVENT_CHANNELS)

function failure(code: 'UNKNOWN_CHANNEL' | 'INTERNAL', message: string): IpcResult<never> {
  return { ok: false, error: { code, message } }
}

function isEnvelope(value: unknown): value is IpcResult<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { ok?: unknown }).ok === 'boolean'
  )
}

export function createBridge(): RendererApi {
  return {
    async invoke<C extends InvokeChannel>(
      channel: C,
      request: InvokeRequest<C>
    ): Promise<IpcResult<InvokeResponse<C>>> {
      if (!invokeAllowlist.has(channel)) {
        return failure('UNKNOWN_CHANNEL', `Channel "${String(channel)}" is not allowed`)
      }
      try {
        const reply: unknown = await ipcRenderer.invoke(channel, request)
        if (!isEnvelope(reply)) return failure('INTERNAL', `Malformed reply from "${channel}"`)
        return reply as IpcResult<InvokeResponse<C>>
      } catch (error: unknown) {
        // ipcRenderer.invoke rejects when no handler is registered or the handler crashed.
        return failure('INTERNAL', error instanceof Error ? error.message : String(error))
      }
    },

    on<C extends EventChannel>(
      channel: C,
      listener: (payload: EventPayload<C>) => void
    ): () => void {
      if (!eventAllowlist.has(channel)) {
        throw new TypeError(`Event channel "${String(channel)}" is not allowed`)
      }
      const wrapped = (_event: unknown, payload: EventPayload<C>): void => {
        listener(payload)
      }
      ipcRenderer.on(channel, wrapped)
      return () => {
        ipcRenderer.removeListener(channel, wrapped)
      }
    },

    getPathForFile(file: File): string {
      return webUtils.getPathForFile(file)
    }
  }
}
