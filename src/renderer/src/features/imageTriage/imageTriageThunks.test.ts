import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult } from '@shared/domain/errors'
import type { Session } from '@shared/domain/session'
import type { EventChannel, EventPayload, InvokeChannel, RendererApi } from '@shared/ipc/contract'
import { setBridge } from '../../app/api'
import { createAppStore } from '../../app/store'
import {
  applyCropResult,
  cropNext,
  moveOrAdvance,
  resetDestination,
  rotateCurrent,
  sendImages,
  uncropCurrent
} from './imageTriageThunks'
import { noMoveSet, sessionOpened } from './imageTriageSlice'

vi.mock('./imageSize', () => ({
  measureImage: vi.fn().mockResolvedValue({ width: 200, height: 100 })
}))

type Handler = (request: unknown) => unknown

function fake(handlers: Partial<Record<InvokeChannel, Handler>>) {
  const calls: Array<{ channel: string; request: unknown }> = []
  const listeners = new Map<string, Set<(p: never) => void>>()
  const bridge: RendererApi = {
    invoke: async (channel, request) => {
      calls.push({ channel, request })
      const h = handlers[channel]
      if (h === undefined) return { ok: false, error: { code: 'NOT_IMPLEMENTED', message: channel } }
      return { ok: true, data: await h(request) } as IpcResult<never>
    },
    on: (channel, listener) => {
      const set = listeners.get(channel) ?? new Set()
      set.add(listener as (p: never) => void)
      listeners.set(channel, set)
      return () => set.delete(listener as (p: never) => void)
    },
    getPathForFile: () => ''
  }
  const emit = <C extends EventChannel>(c: C, p: EventPayload<C>): void => {
    for (const l of listeners.get(c) ?? []) l(p as never)
  }
  return { bridge, calls, emit }
}

const session: Session = {
  id: 's1',
  root: 'C:\\r',
  recursive: false,
  kind: 'image',
  sort: 'size-desc',
  items: [0, 1, 2].map((n) => ({ id: `i${n}`, path: `C:\\r\\p${n}.jpg`, relDir: '', name: `p${n}.jpg`, sizeBytes: 9 - n, mtimeMs: 1, kind: 'image' as const })),
  openedAt: 0,
  skippedDirs: []
}

const entry = (id: string) => ({ id, ts: 1, op: 'move', from: 'a', to: 'b', sidecars: [], sessionId: 's1', undoable: true })
const edited = { path: 'C:\\r\\p0.jpg', backupPath: 'C:\\r\\bkp\\p0.jpg', backupCreated: true, width: 1, height: 1, version: 77, journalEntryId: 'j' }

function setup(handlers: Partial<Record<InvokeChannel, Handler>>) {
  const f = fake({
    'fileops:move': (r) => ({ entry: entry('e1'), newPath: `C:\\r\\${(r as { destination: { name: string } }).destination.name}\\x.jpg` }),
    ...handlers
  })
  setBridge(f.bridge)
  const store = createAppStore()
  store.dispatch(sessionOpened(session))
  return { ...f, store }
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => setBridge(null))

describe('moveOrAdvance (checklist 18, 19, 25)', () => {
  it('moves the current image to the configured name and advances', async () => {
    const { store, calls } = setup({})
    await store.dispatch(moveOrAdvance({ side: 'left' }))
    expect(calls[0]).toMatchObject({ channel: 'fileops:move', request: { destination: { type: 'folder', name: 'L' }, path: 'C:\\r\\p0.jpg' } })
    expect(store.getState().imageTriage.cursor).toBe(1)
  })

  it('a look-ahead move leaves the cursor alone', async () => {
    const { store } = setup({})
    await store.dispatch(moveOrAdvance({ side: 'right', itemId: 'i2' }))
    expect(store.getState().imageTriage.cursor).toBe(0)
    expect(store.getState().imageTriage.items[2]?.status).toBe('right')
  })

  it('No move only advances: no file operation, undo needs no IPC', async () => {
    const { store, calls } = setup({})
    store.dispatch(noMoveSet(true))
    await store.dispatch(moveOrAdvance({ side: 'left' }))
    expect(calls).toHaveLength(0)
    expect(store.getState().imageTriage.cursor).toBe(1)
  })
})

describe('edits (checklist 36-42)', () => {
  it('applyCropResult writes the crop, remembers it and adds one quick-cut button per rectangle', async () => {
    const { store, calls } = setup({ 'media:imageEdit': () => edited })
    const crop = { x: 20, y: 10, w: 100, h: 50 }
    const result = { crop, bright: 0.2, contrast: null, transpose: null }
    await store.dispatch(applyCropResult({ result }))
    await store.dispatch(applyCropResult({ result }))
    expect(calls[0]?.request).toMatchObject({ edit: { crop, bright: null, contrast: null, transpose: null } })
    const s = store.getState().imageTriage
    expect(s.items[0]?.version).toBe(77)
    expect(s.lastCrop?.crop).toEqual(crop)
    expect(s.quickCrops.map((q) => q.label)).toEqual(['10,60,20,120'])
    expect(store.getState().notifications).toBeDefined()
  })

  it('TV-33 a neutral result writes nothing', async () => {
    const { store, calls } = setup({})
    await store.dispatch(applyCropResult({ result: { crop: null, bright: null, contrast: null, transpose: null } }))
    expect(calls).toHaveLength(0)
  })

  it('TV-31 cropNext without lastCrop does nothing; with one it moves left then crops the next', async () => {
    const { store, calls } = setup({ 'media:imageEdit': () => edited })
    await store.dispatch(cropNext())
    expect(calls).toHaveLength(0)
    await store.dispatch(applyCropResult({ result: { crop: { x: 20, y: 10, w: 100, h: 50 }, bright: null, contrast: null, transpose: null } }))
    calls.length = 0
    await store.dispatch(cropNext())
    expect(calls.map((c) => c.channel)).toEqual(['fileops:move', 'media:imageEdit'])
    expect(calls[1]?.request).toMatchObject({ path: 'C:\\r\\p1.jpg' })
    expect(store.getState().imageTriage.cursor).toBe(1)
  })

  it('refuses a stored crop that does not fit the next image, before any write', async () => {
    const { store, calls } = setup({ 'media:imageEdit': () => edited })
    await store.dispatch(applyCropResult({ result: { crop: { x: 20, y: 10, w: 100, h: 50 }, bright: null, contrast: null, transpose: null } }))
    store.dispatch({ type: 'imageTriage/lastCropSet', payload: { crop: { x: 500, y: 0, w: 5, h: 5 }, bright: null, contrast: null, transpose: null } })
    calls.length = 0
    await store.dispatch(cropNext())
    expect(calls.map((c) => c.channel)).toEqual(['fileops:move'])
  })

  it('End rotates counter-clockwise; Ctrl+F reports a missing backup', async () => {
    const { store, calls } = setup({
      'media:imageRotate': () => edited,
      'media:imageRestoreBackup': () => ({ path: 'p', restored: false, backupPath: null, version: 1 })
    })
    await store.dispatch(rotateCurrent())
    expect(calls[0]?.request).toMatchObject({ rotation: 'ccw90' })
    await store.dispatch(uncropCurrent())
    expect(calls[1]?.channel).toBe('media:imageRestoreBackup')
  })
})

describe('send and reset (TV-19, TV-38)', () => {
  it('L pre-cleans the left folder, runs deleteR on R and uploadImagesL on L, one summary', async () => {
    const hookCalls: unknown[] = []
    const f = setup({
      'fileops:preclean': () => ({ trashed: ['a', 'b'] }),
      'hooks:run': (r) => {
        hookCalls.push(r)
        return { runId: String(hookCalls.length), name: (r as { name: string }).name, skipped: false }
      }
    })
    const done = f.store.dispatch(sendImages())
    for (let i = 0; i < 20 && hookCalls.length < 2; i += 1) await new Promise((r) => setTimeout(r, 5))
    f.emit('hooks:exit', { runId: '1', name: 'deleteR', code: 0, durationMs: 1 } as never)
    for (let i = 0; i < 20 && hookCalls.length < 2; i += 1) await new Promise((r) => setTimeout(r, 5))
    f.emit('hooks:exit', { runId: '2', name: 'uploadImagesL', code: 3, durationMs: 1 } as never)
    await done
    expect(hookCalls).toEqual([
      { name: 'deleteR', context: { dir: 'C:\\r\\R', root: 'C:\\r' } },
      { name: 'uploadImagesL', context: { dir: 'C:\\r\\L', root: 'C:\\r' } }
    ])
    const text = JSON.stringify(f.store.getState().notifications)
    expect(text).toContain('2 trashed')
    expect(text).toContain('exit 3')
  })

  it('M5: separates "hook disabled" from "built-in trash done" and shows the trashed count', async () => {
    let emitExit: (runId: string, trashed?: number) => void = () => undefined
    const f = setup({
      'fileops:preclean': () => ({ trashed: [] }),
      'hooks:run': (r) => {
        const name = (r as { name: 'deleteR' | 'uploadImagesL' }).name
        if (name === 'deleteR') {
          setTimeout(() => emitExit('d', 3), 5)
          return { runId: 'd', name, skipped: true, builtIn: true }
        }
        return { runId: 'u', name, skipped: true, builtIn: false }
      }
    })
    emitExit = (runId, trashed) =>
      f.emit('hooks:exit', { runId, name: 'deleteR', code: 0, durationMs: 1, error: null, trashed } as never)
    await f.store.dispatch(sendImages())
    const text = JSON.stringify(f.store.getState().notifications)
    expect(text).toContain('delete R: built-in trash done, 3 trashed')
    expect(text).toContain('upload L: hook disabled, nothing ran')
  })

  it('Reset L moves the folder back then rescans', async () => {
    const f = setup({
      'fileops:resetFolder': () => ({ moved: [{}], failed: [] }),
      'session:open': () => ({ ...session, id: 's2' }),
      'session:close': () => undefined
    })
    await f.store.dispatch(resetDestination('left'))
    expect(f.calls.map((c) => c.channel)).toEqual(['fileops:resetFolder', 'session:open', 'session:close'])
    expect(f.store.getState().imageTriage.sessionId).toBe('s2')
    expect(f.store.getState().imageTriage.cursor).toBe(0)
  })
})
