import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { INVOKE_CHANNELS } from '@shared/ipc/contract'
import { AppError, toIpcError } from './errors'
import {
  bindIpcMain,
  dispatch,
  handle,
  handledChannels,
  missingChannels,
  resetHandlers,
  type IpcEventLike,
  type IpcMainLike
} from './handle'
import { registerServices } from './registerAll'
import { createMainContext, createSettingsAccess } from './context'
import { createMediaAllowlist } from './mediaAllowlist'
import { DEFAULT_SETTINGS } from '@shared/domain/settings'

afterEach(() => resetHandlers())

describe('handle / dispatch', () => {
  it('validates the request before the handler runs', async () => {
    const spy = vi.fn()
    handle('app:setAlwaysOnTop', spy)
    const bad = await dispatch('app:setAlwaysOnTop', { value: 'yes' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.code).toBe('VALIDATION')
    expect(spy).not.toHaveBeenCalled()
    const good = await dispatch('app:setAlwaysOnTop', { value: true })
    expect(good).toEqual({ ok: true, data: undefined })
    expect(spy).toHaveBeenCalledWith({ value: true }, null)
  })

  it('applies schema defaults (parsed request)', async () => {
    let seen: unknown
    handle('hashing:cancel', (req) => {
      seen = req
    })
    await dispatch('hashing:cancel', { taskId: 'a-1' })
    expect(seen).toEqual({ taskId: 'a-1' })
  })

  it('wraps AppError, Node errors and unknown throws in the envelope', async () => {
    handle('app:info', () => {
      throw new AppError('NOT_CONFIGURED', 'no ffmpeg', { setting: 'ffmpeg.ffmpegPath' })
    })
    const r = await dispatch('app:info', undefined)
    expect(r).toEqual({
      ok: false,
      error: {
        code: 'NOT_CONFIGURED',
        message: 'no ffmpeg',
        details: { setting: 'ffmpeg.ffmpegPath' }
      }
    })
    expect(toIpcError(Object.assign(new Error('x'), { code: 'ENOENT' })).code).toBe('NOT_FOUND')
    expect(toIpcError(Object.assign(new Error('x'), { code: 'EPERM' })).code).toBe(
      'PERMISSION_DENIED'
    )
    expect(toIpcError(Object.assign(new Error('x'), { code: 'EBUSY' }))).toMatchObject({
      code: 'IO',
      details: { errno: 'EBUSY' }
    })
    expect(toIpcError(new z.ZodError([])).code).toBe('VALIDATION')
    expect(toIpcError(new Error('boom'))).toEqual({ code: 'INTERNAL', message: 'boom' })
    expect(toIpcError('weird')).toEqual({ code: 'INTERNAL', message: 'weird' })
  })

  it('refuses unknown channels and double registration', async () => {
    expect((await dispatch('nope:nope', {})).ok).toBe(false)
    handle('app:info', () => {
      throw new Error('x')
    })
    expect(() =>
      handle('app:info', () => {
        throw new Error('y')
      })
    ).toThrow(/already handled/)
  })
})

describe('bindIpcMain', () => {
  it('denies untrusted senders', async () => {
    handle('hashing:cancel', () => undefined)
    const handlers = new Map<string, (e: IpcEventLike, ...a: unknown[]) => unknown>()
    const ipcMain: IpcMainLike = {
      handle: (c, l) => void handlers.set(c, l),
      removeHandler: (c) => void handlers.delete(c)
    }
    const off = bindIpcMain(ipcMain, (e) => e.sender.id === 1)
    const fn = handlers.get('hashing:cancel')
    expect(await fn?.({ sender: { id: 2 } }, { taskId: 'a' })).toMatchObject({
      ok: false,
      error: { code: 'PERMISSION_DENIED' }
    })
    expect(await fn?.({ sender: { id: 1 } }, { taskId: 'a' })).toEqual({
      ok: true,
      data: undefined
    })
    off()
    expect(handlers.size).toBe(0)
  })
})

describe('registerServices (wave-1 stubs)', () => {
  it('covers every channel of the contract and answers NOT_IMPLEMENTED', async () => {
    const ctx = createMainContext({
      getWindow: () => null,
      settings: createSettingsAccess(DEFAULT_SETTINGS),
      allowlist: createMediaAllowlist(),
      paths: { userData: 'u', temp: 't' },
      trashItem: () => Promise.resolve(),
      newId: () => 'id'
    })
    registerServices(ctx)
    expect(missingChannels()).toEqual([])
    expect(handledChannels().length).toBe(INVOKE_CHANNELS.length)
    const r = await dispatch('settings:get', undefined)
    expect(r).toMatchObject({ ok: false, error: { code: 'NOT_IMPLEMENTED' } })
  })
})
