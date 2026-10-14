/** Test helpers for the svc-files services (never imported by production code). */
import { mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import { DEFAULT_SETTINGS, type Settings } from '@shared/domain/settings'
import type { EventChannel } from '@shared/ipc/contract'
import { createMainContext, createSettingsAccess, type MainContext } from '../../ipc/context'
import { dispatch, resetHandlers } from '../../ipc/handle'
import { createMediaAllowlist } from '../../ipc/mediaAllowlist'
import { registerFileopsIpc } from './ipc'
import { registerHooksIpc } from '../hooks/ipc'
import { registerSessionIpc } from '../session/ipc'
import { registerSettingsIpc } from '../settings/ipc'

export interface SentEvent {
  readonly channel: EventChannel
  readonly payload: unknown
}

export interface TestEnv {
  readonly ctx: MainContext
  readonly base: string
  readonly userData: string
  readonly trashDir: string
  readonly events: SentEvent[]
  readonly trashed: string[]
  call(channel: string, request?: unknown): Promise<unknown>
  ok<T>(channel: string, request?: unknown): Promise<T>
}

export async function makeBase(prefix = 'svcfiles'): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `${prefix}-`))
}

export async function touch(file: string, content = 'x'): Promise<string> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content)
  return file
}

export async function createEnv(settings: Settings = DEFAULT_SETTINGS): Promise<TestEnv> {
  resetHandlers()
  const base = await makeBase()
  const userData = path.join(base, 'userData')
  const trashDir = path.join(base, 'trash')
  await mkdir(trashDir, { recursive: true })
  const events: SentEvent[] = []
  const trashed: string[] = []
  const win = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (channel: EventChannel, payload: unknown) => events.push({ channel, payload })
    }
  } as unknown as BrowserWindow
  let counter = 0
  const ctx = createMainContext({
    getWindow: () => win,
    settings: createSettingsAccess(settings),
    allowlist: createMediaAllowlist(),
    paths: { userData, temp: path.join(base, 'temp') },
    trashItem: async (file) => {
      trashed.push(file)
      counter += 1
      await rename(file, path.join(trashDir, `${counter}-${path.basename(file)}`))
    },
    newId: () => `id-${++counter}`
  })
  registerSettingsIpc(ctx)
  registerSessionIpc(ctx)
  registerFileopsIpc(ctx)
  registerHooksIpc(ctx)
  const call = (channel: string, request?: unknown) => dispatch(channel, request)
  const ok = async <T>(channel: string, request?: unknown): Promise<T> => {
    const result = await dispatch(channel, request)
    if (!result.ok) throw new Error(`${channel}: ${result.error.code} ${result.error.message}`)
    return result.data as T
  }
  return { ctx, base, userData, trashDir, events, trashed, call, ok }
}
