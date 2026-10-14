import { beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (event: unknown, payload: unknown) => void

const { ipcRenderer, webUtils } = vi.hoisted(() => ({
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn()
  },
  webUtils: { getPathForFile: vi.fn() }
}))
vi.mock('electron', () => ({ ipcRenderer, webUtils }))

import { createBridge } from './bridge'

beforeEach(() => {
  ipcRenderer.invoke.mockReset()
  ipcRenderer.on.mockReset()
  ipcRenderer.removeListener.mockReset()
})

describe('createBridge', () => {
  it('forwards allowed invokes and returns the envelope untouched', async () => {
    ipcRenderer.invoke.mockResolvedValue({ ok: true, data: { version: '1' } })
    const api = createBridge()
    const r = await api.invoke('app:info', undefined)
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('app:info', undefined)
    expect(r).toEqual({ ok: true, data: { version: '1' } })
  })

  it('refuses channels outside the allowlist without calling ipcRenderer', async () => {
    const api = createBridge()
    const r = await api.invoke('shell:exec' as never, {} as never)
    expect(r).toMatchObject({ ok: false, error: { code: 'UNKNOWN_CHANNEL' } })
    expect(ipcRenderer.invoke).not.toHaveBeenCalled()
  })

  it('turns rejections and malformed replies into INTERNAL errors', async () => {
    const api = createBridge()
    ipcRenderer.invoke.mockRejectedValueOnce(new Error('No handler registered'))
    expect(await api.invoke('app:info', undefined)).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL', message: 'No handler registered' }
    })
    ipcRenderer.invoke.mockResolvedValueOnce('nope')
    expect(await api.invoke('app:info', undefined)).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL' }
    })
  })

  it('subscribes with payload-only listeners and unsubscribes', () => {
    const api = createBridge()
    const seen: unknown[] = []
    const off = api.on('settings:changed', (payload) => seen.push(payload))
    const registered = ipcRenderer.on.mock.calls[0]?.[1] as Listener
    expect(ipcRenderer.on.mock.calls[0]?.[0]).toBe('settings:changed')
    registered({ sender: 'secret' }, { schemaVersion: 1 })
    expect(seen).toEqual([{ schemaVersion: 1 }])
    off()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith('settings:changed', registered)
  })

  it('throws for events outside the allowlist', () => {
    const api = createBridge()
    expect(() => api.on('evil:event' as never, () => undefined)).toThrow(/not allowed/)
    expect(ipcRenderer.on).not.toHaveBeenCalled()
  })

  it('delegates getPathForFile to webUtils', () => {
    webUtils.getPathForFile.mockReturnValue('C:\\x\\a.mp4')
    const file = {} as File
    expect(createBridge().getPathForFile(file)).toBe('C:\\x\\a.mp4')
    expect(webUtils.getPathForFile).toHaveBeenCalledWith(file)
  })
})
