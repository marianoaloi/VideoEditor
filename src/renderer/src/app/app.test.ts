import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult } from '@shared/domain/errors'
import type { JournalEntry } from '@shared/domain/fileops'
import type { Session } from '@shared/domain/session'
import type { EventChannel, EventPayload, InvokeChannel, RendererApi } from '@shared/ipc/contract'
import { jobEventReceived } from '../features/jobs/jobsSlice'
import { videoTriageThunks } from '../features/videoTriage/videoTriageSlice'
import { ApiError, call, setBridge } from './api'
import { initApp } from './init'
import { createAppStore } from './store'

type Handler = (request: unknown) => IpcResult<unknown> | Promise<IpcResult<unknown>>

function entry(id: string, from: string, to: string): JournalEntry {
  return { id, ts: 1, op: 'move', from, to, sidecars: [], sessionId: 's1', undoable: true }
}

function fakeBridge(handlers: Partial<Record<InvokeChannel, Handler>>) {
  const calls: Array<{ channel: string; request: unknown }> = []
  const listeners = new Map<string, Set<(payload: never) => void>>()
  const bridge: RendererApi = {
    invoke: async (channel, request) => {
      calls.push({ channel, request })
      const handler = handlers[channel]
      if (handler === undefined) {
        return { ok: false, error: { code: 'NOT_IMPLEMENTED', message: channel } }
      }
      return (await handler(request)) as never
    },
    on: (channel, listener) => {
      const set = listeners.get(channel) ?? new Set()
      set.add(listener as (payload: never) => void)
      listeners.set(channel, set)
      return () => set.delete(listener as (payload: never) => void)
    },
    getPathForFile: () => ''
  }
  const emit = <C extends EventChannel>(channel: C, payload: EventPayload<C>): void => {
    for (const l of listeners.get(channel) ?? []) l(payload as never)
  }
  return { bridge, calls, emit }
}

const session: Session = {
  id: 's1',
  root: 'C:\\r',
  recursive: false,
  kind: 'video',
  sort: 'size-desc',
  items: [0, 1, 2].map((n) => ({
    id: `i${n}`,
    path: `C:\\r\\v${n}.mp4`,
    relDir: '',
    name: `v${n}.mp4`,
    sizeBytes: 10 - n,
    mtimeMs: 1,
    kind: 'video' as const
  })),
  openedAt: 0,
  skippedDirs: []
}

afterEach(() => setBridge(null))

describe('call()', () => {
  it('unwraps data and throws ApiError for failures', async () => {
    const { bridge } = fakeBridge({
      'app:info': () => ({ ok: true, data: { version: '1' } }),
      'settings:get': () => ({
        ok: false,
        error: { code: 'IO', message: 'disk', details: { errno: 'EIO' } }
      })
    })
    setBridge(bridge)
    await expect(call('app:info')).resolves.toEqual({ version: '1' })
    const failure = await call('settings:get').catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(ApiError)
    expect(failure).toMatchObject({
      code: 'IO',
      message: 'disk',
      details: { errno: 'EIO' },
      channel: 'settings:get'
    })
  })
})

describe('triage thunks (ADR-006 decision stack)', () => {
  let h: ReturnType<typeof fakeBridge>
  beforeEach(() => {
    h = fakeBridge({
      'session:open': () => ({ ok: true, data: session }),
      'fileops:move': (req) => {
        const r = req as { path: string; destination: { type: string; role?: string } }
        const dir = r.destination.role === 'left' ? 'L' : 'R'
        const name = r.path.split('\\').pop() ?? ''
        const to = `C:\\r\\${dir}\\${name}`
        return { ok: true, data: { entry: entry(`e-${name}`, r.path, to), newPath: to } }
      },
      'fileops:undo': (req) => {
        const r = req as { entryId?: string }
        if (r.entryId === undefined)
          return { ok: false, error: { code: 'NOTHING_TO_UNDO', message: 'none' } }
        const original = `C:\\r\\${r.entryId.replace('e-', '')}`
        return {
          ok: true,
          data: {
            undone: entry(r.entryId, original, 'x'),
            compensating: entry('c', 'x', original),
            restoredPath: original,
            item: null
          }
        }
      }
    })
    setBridge(h.bridge)
  })

  it('A, D, B, B: moves, skips and unwinds in LIFO order', async () => {
    const store = createAppStore()
    const t = videoTriageThunks
    await store.dispatch(t.openFolder({ dir: 'C:\\r', kind: 'video' }))
    expect(store.getState().videoTriage.items).toHaveLength(3)

    await store.dispatch(t.moveItem({ kind: 'left' }))
    await store.dispatch(t.skipItem())
    let s = store.getState().videoTriage
    expect(s.cursor).toBe(2)
    expect(s.items[0]).toMatchObject({ status: 'left', path: 'C:\\r\\L\\v0.mp4' })
    expect(s.decisions.map((d) => d.kind)).toEqual(['left', 'skip'])

    await store.dispatch(t.undo()) // pops the skip: no IPC
    s = store.getState().videoTriage
    expect(s.cursor).toBe(1)
    expect(h.calls.filter((c) => c.channel === 'fileops:undo')).toHaveLength(0)

    await store.dispatch(t.undo()) // pops the move: journal undo by entry id
    s = store.getState().videoTriage
    expect(h.calls.find((c) => c.channel === 'fileops:undo')?.request).toEqual({
      sessionId: 's1',
      entryId: 'e-v0.mp4'
    })
    expect(s.cursor).toBe(0)
    expect(s.items[0]).toMatchObject({ status: 'pending', path: 'C:\\r\\v0.mp4' })
    expect(s.decisions).toHaveLength(0)
  })

  it('keeps key order for fast successive moves', async () => {
    const store = createAppStore()
    const t = videoTriageThunks
    await store.dispatch(t.openFolder({ dir: 'C:\\r', kind: 'video' }))
    await Promise.all([
      store.dispatch(t.moveItem({ kind: 'left' })),
      store.dispatch(t.moveItem({ kind: 'right' })),
      store.dispatch(t.moveItem({ kind: 'left' }))
    ])
    const moves = h.calls
      .filter((c) => c.channel === 'fileops:move')
      .map((c) => (c.request as { path: string }).path)
    expect(moves).toEqual(['C:\\r\\v0.mp4', 'C:\\r\\v1.mp4', 'C:\\r\\v2.mp4'])
    expect(store.getState().videoTriage.items.map((i) => i.status)).toEqual([
      'left',
      'right',
      'left'
    ])
  })

  it('falls back to the journal with an empty stack and reports NOTHING_TO_UNDO as info', async () => {
    const store = createAppStore()
    await store.dispatch(videoTriageThunks.openFolder({ dir: 'C:\\r', kind: 'video' }))
    await store.dispatch(videoTriageThunks.undo())
    expect(h.calls.find((c) => c.channel === 'fileops:undo')?.request).toEqual({ sessionId: 's1' })
    expect(store.getState().notifications.queue.map((n) => n.message)).toEqual(['Nothing to undo'])
  })

  it('trash is not pushed on the stack', async () => {
    h = fakeBridge({
      'session:open': () => ({ ok: true, data: session }),
      'fileops:trash': () => ({
        ok: true,
        data: {
          entry: { ...entry('t1', 'C:\\r\\v0.mp4', 'x'), op: 'trash', to: null, undoable: false }
        }
      })
    })
    setBridge(h.bridge)
    const store = createAppStore()
    await store.dispatch(videoTriageThunks.openFolder({ dir: 'C:\\r', kind: 'video' }))
    await store.dispatch(videoTriageThunks.trashItem())
    const s = store.getState().videoTriage
    expect(s.items[0]?.status).toBe('trashed')
    expect(s.decisions).toHaveLength(0)
    expect(s.cursor).toBe(1)
  })
})

describe('initApp', () => {
  it('routes events and turns rejected thunks into error notifications', async () => {
    const h = fakeBridge({
      'settings:get': () => ({ ok: false, error: { code: 'IO', message: 'cannot read settings' } })
    })
    setBridge(h.bridge)
    const store = createAppStore()
    const dispose = initApp(store)
    await vi.waitFor(() => expect(store.getState().settings.status).toBe('error'))
    expect(store.getState().notifications.queue[0]).toMatchObject({
      severity: 'error',
      message: 'cannot read settings'
    })

    h.emit('jobs:event', { type: 'log', jobId: 'nope', lines: ['x'] })
    store.dispatch(
      jobEventReceived({
        type: 'queued',
        job: {
          id: 'j1',
          videoPath: 'C:\\r\\a.mp4',
          jsonPath: null,
          mode: 1,
          status: 'queued',
          progress: 0,
          outputs: [],
          error: null,
          options: {
            upload: false,
            uploadAll: false,
            deleteOriginal: false,
            ignoreErrors: false,
            sameSize: false,
            keepParts: false
          },
          batchId: null,
          createdAt: 1,
          startedAt: null,
          finishedAt: null,
          logPath: null
        }
      })
    )
    h.emit('jobs:event', { type: 'started', jobId: 'j1', at: 5 })
    h.emit('jobs:event', { type: 'log', jobId: 'j1', lines: ['frame=1'] })
    h.emit('jobs:event', {
      type: 'progress',
      jobId: 'j1',
      progress: 0.5,
      stepIndex: 0,
      stepCount: 2,
      outTimeMs: 100,
      speed: 2
    })
    h.emit('jobs:event', { type: 'done', jobId: 'j1', outputs: ['C:\\r\\a.0.mp4'], durationMs: 10 })
    expect(store.getState().jobs.byId['j1']).toMatchObject({
      status: 'done',
      progress: 1,
      logTail: ['frame=1'],
      outputs: ['C:\\r\\a.0.mp4'],
      finishedAt: 15
    })
    dispose()
  })
})
