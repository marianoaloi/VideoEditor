/**
 * Typed `handle(channel, handler)` (ADR-003): every request is validated with its zod schema
 * (`@shared/ipc/schemas`) before the handler runs, and every outcome is returned as the envelope
 * `{ ok: true, data } | { ok: false, error: { code, message, details? } }`. Main never rejects.
 *
 * This module does not import `electron`: handlers are collected in a registry and attached to
 * `ipcMain` by `bindIpcMain` (called from `registerAll.ts`), which keeps it unit-testable.
 */
import { ipcFail, ipcOk, type IpcResult } from '@shared/domain/errors'
import type { InvokeChannel, InvokeParsedRequest, InvokeResponse } from '@shared/ipc/contract'
import { INVOKE_CHANNELS } from '@shared/ipc/contract'
import { requestSchemaFor } from '@shared/ipc/schemas'
import { toIpcError } from './errors'

/** The part of `IpcMainInvokeEvent` the handlers and the sender check need. */
export interface IpcEventLike {
  readonly sender: { readonly id: number }
  readonly senderFrame?: unknown
}

export type Handler<C extends InvokeChannel> = (
  request: InvokeParsedRequest<C>,
  event: IpcEventLike | null
) => InvokeResponse<C> | Promise<InvokeResponse<C>>

type AnyHandler = (raw: unknown, event: IpcEventLike | null) => Promise<IpcResult<unknown>>

const registry = new Map<InvokeChannel, AnyHandler>()

/** Registers the handler of one channel. A channel has exactly one owner: registering twice throws. */
export function handle<C extends InvokeChannel>(channel: C, handler: Handler<C>): void {
  if (registry.has(channel)) throw new Error(`IPC channel "${channel}" is already handled`)
  const schema = requestSchemaFor(channel)
  registry.set(channel, async (raw, event) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      return ipcFail('VALIDATION', 'Invalid request', {
        channel,
        issues: parsed.error.issues
      })
    }
    try {
      const data = await handler(parsed.data as InvokeParsedRequest<C>, event)
      return ipcOk<unknown>(data)
    } catch (error: unknown) {
      const { code, message, details } = toIpcError(error)
      return details === undefined ? ipcFail(code, message) : ipcFail(code, message, details)
    }
  })
}

/** Runs a registered handler as `ipcMain` would. Used by `bindIpcMain` and by tests. */
export async function dispatch(
  channel: string,
  raw: unknown,
  event: IpcEventLike | null = null
): Promise<IpcResult<unknown>> {
  const entry = (INVOKE_CHANNELS as readonly string[]).includes(channel)
    ? registry.get(channel as InvokeChannel)
    : undefined
  if (entry === undefined) {
    return ipcFail('UNKNOWN_CHANNEL', `Unknown IPC channel "${channel}"`)
  }
  return entry(raw, event)
}

export function handledChannels(): InvokeChannel[] {
  return [...registry.keys()]
}

/** Contract channels nobody registered. `registerAllIpc` refuses to start while this is not empty. */
export function missingChannels(): InvokeChannel[] {
  return INVOKE_CHANNELS.filter((channel) => !registry.has(channel))
}

/** Test helper. */
export function resetHandlers(): void {
  registry.clear()
}

/** The slice of `electron.ipcMain` that `bindIpcMain` uses. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => unknown): void
  removeHandler(channel: string): void
  /** One-way messages (`ipcRenderer.send`), e.g. the preload's "the user dropped this path". */
  on?(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => void): void
  removeListener?(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => void): void
}

/**
 * Attaches every registered handler to `ipcMain`. A request from a sender that is not trusted
 * (not the app window) gets `PERMISSION_DENIED` without reaching the handler.
 * Returns a function that detaches them again.
 */
export function bindIpcMain(
  ipcMain: IpcMainLike,
  isTrustedSender: (event: IpcEventLike) => boolean
): () => void {
  const bound: string[] = []
  for (const channel of registry.keys()) {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedSender(event)) {
        return ipcFail('PERMISSION_DENIED', `Sender is not allowed to call "${channel}"`)
      }
      return dispatch(channel, args[0], event)
    })
    bound.push(channel)
  }
  return () => {
    for (const channel of bound) ipcMain.removeHandler(channel)
  }
}
