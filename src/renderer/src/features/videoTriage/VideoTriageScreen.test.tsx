import { act, render, screen, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult } from '@shared/domain/errors'
import type { JournalEntry } from '@shared/domain/fileops'
import type { MediaInfo } from '@shared/domain/media'
import type { Session } from '@shared/domain/session'
import type { InvokeChannel, RendererApi } from '@shared/ipc/contract'
import { setBridge } from '../../app/api'
import { findConflicts } from '../../app/keymap/conflicts'
import { allHandlers, clearHandlers, resolveBinding } from '../../app/keymap/registry'
import { panChanged } from '../../app/player/playerSlice'
import { createAppStore } from '../../app/store'
import VideoTriageScreen from './VideoTriageScreen'
import { handlesSet, sessionOpened, videoTriageThunks } from './videoTriageSlice'

vi.mock('../../components/MediaPlayer/MediaPlayer', () => ({
  default: () => <div data-testid="player" />
}))
vi.mock('../../components/CropDialog', () => ({ default: () => null }))
vi.mock('../../components/ZoomViewer', () => ({ default: () => null }))

type Handler = (request: unknown) => IpcResult<unknown> | Promise<IpcResult<unknown>>

const INFO = (path: string): MediaInfo => ({
  path,
  container: 'mov,mp4',
  formatLongName: null,
  durationMs: 60_000,
  sizeBytes: 5_242_880,
  bitrateKbps: 400,
  hasVideo: true,
  width: 640,
  height: 360,
  displayWidth: 640,
  displayHeight: 360,
  rotation: 0,
  fps: 25,
  videoCodec: 'h264',
  pixFmt: 'yuv420p',
  hasAudio: true,
  audioCodec: 'aac',
  audioChannels: 2,
  streamCount: 2
})

const entry = (id: string, from: string, to: string): JournalEntry => ({
  id,
  ts: 1,
  op: 'move',
  from,
  to,
  sidecars: [],
  sessionId: 's1',
  undoable: true
})

const session: Session = {
  id: 's1',
  root: '/in',
  recursive: false,
  kind: 'video',
  sort: 'size-desc',
  items: [0, 1, 2].map((n) => ({
    id: `i${n}`,
    path: `/in/v${n}.mp4`,
    relDir: '',
    name: `v${n}.mp4`,
    sizeBytes: 5_242_880,
    mtimeMs: 1,
    kind: 'video' as const
  })),
  openedAt: 0,
  skippedDirs: []
}

const calls: Array<{ channel: string; request: unknown }> = []
let handlers: Partial<Record<InvokeChannel, Handler>> = {}

function install(): void {
  calls.length = 0
  handlers = {
    'media:probe': (r) => ({ ok: true, data: INFO((r as { path: string }).path) }),
    'media:prefetch': () => ({ ok: true, data: { queued: 0 } }),
    'jobs:readJob': () => ({
      ok: true,
      data: { found: false, job: null, format: null, warnings: [] }
    }),
    'fileops:move': (r) => {
      const { path, destination } = r as { path: string; destination: { role: string } }
      const dir = destination.role === 'left' ? 'L' : destination.role === 'right' ? 'R' : 'CUSTOM'
      const to = path.replace('/in/', `/in/${dir}/`)
      return { ok: true, data: { entry: entry(`e-${path}`, path, to), newPath: to } }
    },
    'jobs:saveJob': (r) => ({
      ok: true,
      data: { jsonPath: `${(r as { videoPath: string }).videoPath}.json`, job: {} }
    })
  }
  const bridge: RendererApi = {
    invoke: (channel, request) => {
      calls.push({ channel, request })
      const handler = handlers[channel]
      const result =
        handler === undefined
          ? { ok: false as const, error: { code: 'NOT_IMPLEMENTED' as const, message: channel } }
          : handler(request)
      return Promise.resolve(result as never)
    },
    on: () => () => undefined,
    getPathForFile: () => ''
  }
  setBridge(bridge)
}

async function mount() {
  const store = createAppStore()
  render(
    <Provider store={store}>
      <VideoTriageScreen />
    </Provider>
  )
  act(() => {
    store.dispatch(sessionOpened(session))
  })
  await waitFor(() => expect(store.getState().mediaInfo.byPath['/in/v0.mp4']?.status).toBe('ready'))
  await waitFor(() => expect(store.getState().videoTriage.handlesReady).toBe(true))
  return store
}

function press(id: string): void {
  const binding = allHandlers().find((b) => b.id === id)
  if (binding === undefined) throw new Error(`binding ${id} is not registered`)
  act(() => {
    binding.run({ ctrlKey: false, shiftKey: false, altKey: false, metaKey: false } as KeyboardEvent)
  })
}

const channelsCalled = (): string[] => calls.map((c) => c.channel)

beforeEach(() => {
  clearHandlers()
  install()
})
afterEach(() => {
  setBridge(null)
  clearHandlers()
})

describe('Video Triage screen', () => {
  it('shows the label, the player, the info bar and handles [0, duration-100] (checklist 7, 9)', async () => {
    const store = await mount()
    expect(screen.getByRole('heading', { name: 'Video Triage' })).toBeInTheDocument()
    expect(screen.getByTestId('item-label')).toHaveTextContent('/in/v0.mp4 3/1')
    expect(screen.getByTestId('player')).toBeInTheDocument()
    expect(screen.getByTestId('info-fileSize')).toHaveTextContent('5.00M')
    const { draft, activeHandle } = store.getState().videoTriage
    expect([draft.low, draft.high, activeHandle]).toEqual([0, 59_900, 0])
  })

  it('A / F move to L / R and advance; B undoes the latest decision (checklist 36)', async () => {
    const store = await mount()
    handlers['fileops:undo'] = () => ({
      ok: true,
      data: {
        undone: entry('e', '/in/v0.mp4', '/in/L/v0.mp4'),
        compensating: entry('c', '/in/L/v0.mp4', '/in/v0.mp4'),
        restoredPath: '/in/v0.mp4',
        item: null
      }
    })
    press('videoTriage.moveLeft')
    await waitFor(() => expect(store.getState().videoTriage.cursor).toBe(1))
    expect(store.getState().videoTriage.items[0]?.path).toBe('/in/L/v0.mp4')
    press('videoTriage.moveRight')
    await waitFor(() => expect(store.getState().videoTriage.cursor).toBe(2))
    press('videoTriage.undo')
    await waitFor(() => expect(store.getState().videoTriage.cursor).toBe(1))
    expect(calls.filter((c) => c.channel === 'fileops:undo')).toHaveLength(1)
  })

  it('D skips without a file operation; keys are no-ops at the end (checklist 8)', async () => {
    const store = await mount()
    press('videoTriage.skip')
    await waitFor(() => expect(store.getState().videoTriage.cursor).toBe(1))
    press('videoTriage.skip')
    await waitFor(() => expect(store.getState().videoTriage.cursor).toBe(2))
    press('videoTriage.skip')
    await waitFor(() => expect(screen.getByTestId('end-of-list')).toBeInTheDocument())
    press('videoTriage.skip')
    press('videoTriage.moveLeft')
    expect(store.getState().videoTriage.cursor).toBe(3)
    expect(channelsCalled()).not.toContain('fileops:move')
  })

  it('C moves to CUSTOM then writes the job from the handles (checklist 40)', async () => {
    const store = await mount()
    act(() => {
      store.dispatch(handlesSet({ low: 18_054, high: 46_182, active: 1 }))
    })
    press('videoTriage.cut')
    await waitFor(() => expect(channelsCalled()).toContain('jobs:saveJob'))
    const move = calls.find((c) => c.channel === 'fileops:move')
    expect(move?.request).toMatchObject({ destination: { type: 'role', role: 'custom' } })
    const save = calls.find((c) => c.channel === 'jobs:saveJob')
    expect(save?.request).toMatchObject({
      videoPath: '/in/CUSTOM/v0.mp4',
      job: { times: [[18_054, 46_182]], posExecution: 1, convert: false }
    })
  })

  it('PageDown moves the video to CUSTOM and opens that file in the Cutter, without writing a job', async () => {
    const store = await mount()
    press('videoTriage.sendToCutter')
    await waitFor(() => expect(store.getState().cutter.videoPath).toBe('/in/CUSTOM/v0.mp4'))
    const move = calls.find((c) => c.channel === 'fileops:move')
    expect(move?.request).toMatchObject({ destination: { type: 'role', role: 'custom' } })
    expect(channelsCalled()).not.toContain('jobs:saveJob')
    expect(store.getState().keymap.activeWorkspace).toBe('cutter')
    expect(store.getState().cutter.origin).toBe('triage')
    // Triage carries on with the next video, and the move is an ordinary decision.
    expect(store.getState().videoTriage.cursor).toBe(1)
  })

  it('PageDown is a normal decision: B moves the video back', async () => {
    const store = await mount()
    handlers['fileops:undo'] = () => ({
      ok: true,
      data: {
        undone: entry('e', '/in/v0.mp4', '/in/CUSTOM/v0.mp4'),
        compensating: entry('c', '/in/CUSTOM/v0.mp4', '/in/v0.mp4'),
        restoredPath: '/in/v0.mp4',
        item: null
      }
    })
    press('videoTriage.sendToCutter')
    await waitFor(() => expect(store.getState().cutter.videoPath).toBe('/in/CUSTOM/v0.mp4'))
    press('videoTriage.undo')
    await waitFor(() => expect(channelsCalled()).toContain('fileops:undo'))
    await waitFor(() => expect(store.getState().videoTriage.cursor).toBe(0))
  })

  it('M1: a failed job write undoes THIS move by entry id, not whatever was decided last', async () => {
    const store = await mount()
    act(() => {
      store.dispatch(handlesSet({ low: 1000, high: 5000, active: 1 }))
    })
    handlers['jobs:saveJob'] = async () => {
      // the user keeps triaging while the write is failing: v1 gets skipped (top of the stack)
      await store.dispatch(videoTriageThunks.skipItem())
      return { ok: false, error: { code: 'INTERNAL', message: 'disk full' } }
    }
    handlers['fileops:undo'] = () => ({
      ok: true,
      data: {
        entry: entry('u1', '/in/CUSTOM/v0.mp4', '/in/v0.mp4'),
        restoredPath: '/in/v0.mp4',
        item: null
      }
    })
    press('videoTriage.cut')
    await waitFor(() => expect(channelsCalled()).toContain('fileops:undo'))
    expect(calls.find((c) => c.channel === 'fileops:undo')?.request).toMatchObject({
      sessionId: 's1',
      entryId: 'e-/in/v0.mp4'
    })
    await waitFor(() => expect(store.getState().videoTriage.items[0]?.status).toBe('pending'))
    expect(store.getState().videoTriage.items[1]?.status).toBe('skipped')
    expect(store.getState().videoTriage.decisions.map((d) => d.kind)).toEqual(['skip'])
  })

  it('V sorts the ranges and uses concat; Ctrl+Shift+C writes the whole-video sentinel (checklist 40-42)', async () => {
    const store = await mount()
    act(() => {
      store.dispatch({ type: 'videoTriage/rangeAdded', payload: [20_000, 30_000] })
      store.dispatch({ type: 'videoTriage/rangeAdded', payload: [0, 5000] })
    })
    press('videoTriage.concat')
    await waitFor(() => expect(channelsCalled()).toContain('jobs:saveJob'))
    expect(calls.find((c) => c.channel === 'jobs:saveJob')?.request).toMatchObject({
      job: {
        times: [
          [0, 5000],
          [20_000, 30_000]
        ],
        posExecution: 2
      }
    })
    await waitFor(() => expect(store.getState().videoTriage.cursor).toBe(1))
    await waitFor(() => expect(store.getState().videoTriage.handlesReady).toBe(true))
    calls.length = 0
    press('videoTriage.convertWhole')
    await waitFor(() => expect(channelsCalled()).toContain('jobs:saveJob'))
    expect(calls.find((c) => c.channel === 'jobs:saveJob')?.request).toMatchObject({
      job: { times: [[-1, 60_000]], posExecution: 1, convert: true }
    })
  })

  it('a failed job write moves the video back (checklist 43)', async () => {
    const store = await mount()
    handlers['jobs:saveJob'] = () => ({
      ok: false,
      error: { code: 'INTERNAL', message: 'disk full' }
    })
    handlers['fileops:undo'] = () => ({
      ok: true,
      data: {
        undone: entry('e', '/in/v0.mp4', '/in/CUSTOM/v0.mp4'),
        compensating: entry('c', '/in/CUSTOM/v0.mp4', '/in/v0.mp4'),
        restoredPath: '/in/v0.mp4',
        item: null
      }
    })
    act(() => {
      store.dispatch(handlesSet({ low: 1000, high: 5000, active: 0 }))
    })
    press('videoTriage.cut')
    await waitFor(() => expect(channelsCalled()).toContain('fileops:undo'))
    await waitFor(() => expect(store.getState().videoTriage.cursor).toBe(0))
    expect(store.getState().videoTriage.items[0]?.path).toBe('/in/v0.mp4')
  })

  it('X adds (min, max) of the handles; an empty span is refused (checklist 20)', async () => {
    const store = await mount()
    act(() => {
      store.dispatch(handlesSet({ low: 40_000, high: 10_000, active: 0 }))
    })
    press('videoTriage.addRange')
    expect(store.getState().videoTriage.draft.ranges).toEqual([[10_000, 40_000]])
    act(() => {
      store.dispatch(handlesSet({ low: 5, high: 5, active: 0 }))
    })
    press('videoTriage.addRange')
    expect(store.getState().videoTriage.draft.ranges).toHaveLength(1)
  })

  it('Z swaps the active handle; the volume and speed keys follow TV-C and §3', async () => {
    const store = await mount()
    press('videoTriage.swapHandle')
    expect(store.getState().videoTriage.activeHandle).toBe(1)
    press('videoTriage.volumeUp')
    expect(store.getState().player.volume).toBeCloseTo(0.6)
    press('videoTriage.volumeMin')
    expect(store.getState().player.volume).toBeCloseTo(0.01)
    press('videoTriage.speed2')
    expect(store.getState().player.speed).toBe(2.5)
    press('videoTriage.speedCtrl1')
    expect(store.getState().player.speed).toBe(1.25)
  })

  it('P is inert until a personal folder is configured (checklist 38)', async () => {
    await mount()
    const personal = allHandlers().find((b) => b.id === 'videoTriage.personal')
    expect(personal?.enabled).toBe(false)
  })

  it('registers every key of the table once in the videoTriage scope (checklist 25, 26)', async () => {
    await mount()
    const mine = allHandlers().filter((b) => b.scope === 'videoTriage')
    const chords = mine.flatMap((b) => b.keys)
    expect(new Set(chords).size).toBe(chords.length)
    for (const chord of [
      'A',
      'F',
      'D',
      'B',
      'Shift+Delete',
      'P',
      'X',
      'C',
      'V',
      'Z',
      'S',
      '6',
      'Plus',
      'F8',
      'PageUp',
      'PageDown'
    ]) {
      expect(chords, chord).toContain(chord)
    }
  })

  it('zoom chords: registered once, update the slice, and Ctrl+Plus never fires the plain Plus binding', async () => {
    const store = await mount()
    const chords = allHandlers().filter((b) => b.scope === 'videoTriage').flatMap((b) => b.keys)
    for (const chord of ['Ctrl+Plus', 'Ctrl+Minus', 'Ctrl+0']) {
      expect(chords.filter((c) => c === chord)).toHaveLength(1)
    }
    expect(findConflicts(allHandlers().map((b) => ({ id: b.id, keys: [...b.keys], description: b.description, scope: b.scope })))).toEqual([])
    const state = { activeWorkspace: 'videoTriage' as const, modalStack: [] }
    const info = { repeat: false, inInput: false }
    expect(resolveBinding('Ctrl+Plus', state, info)?.id).toBe('videoTriage.zoomIn')
    expect(resolveBinding('Plus', state, info)?.id).toBe('videoTriage.externalPlayer')
    expect(resolveBinding('Ctrl+Minus', state, { repeat: true, inInput: false })?.id).toBe('videoTriage.zoomOut')
    press('videoTriage.zoomIn')
    press('videoTriage.zoomIn')
    expect(store.getState().player.zoom).toBe(1.5625)
    press('videoTriage.zoomOut')
    expect(store.getState().player.zoom).toBe(1.25)
    press('videoTriage.zoomReset')
    expect(store.getState().player.zoom).toBe(1)
    expect(channelsCalled()).not.toContain('app:openExternal')
  })

  it('zoom and pan survive moving to the next video', async () => {
    const store = await mount()
    press('videoTriage.zoomIn')
    press('videoTriage.zoomIn')
    store.dispatch(panChanged({ x: 0.1, y: -0.1 }))
    press('videoTriage.skip')
    await waitFor(() => expect(store.getState().videoTriage.cursor).toBe(1))
    expect(store.getState().player).toMatchObject({ zoom: 1.5625, panX: 0.1, panY: -0.1 })
  })
})
