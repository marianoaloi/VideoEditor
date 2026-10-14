import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useImperativeHandle, type Ref } from 'react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult } from '@shared/domain/errors'
import type { JobSummary, VideoJob } from '@shared/domain/job'
import type { MediaInfo } from '@shared/domain/media'
import { DEFAULT_SETTINGS } from '@shared/domain/settings'
import type { InvokeChannel, RendererApi } from '@shared/ipc/contract'
import { setBridge } from '../../app/api'
import { allHandlers, clearHandlers } from '../../app/keymap/registry'
import { workspaceActivated } from '../../app/keymap/keymapSlice'
import { createAppStore } from '../../app/store'
import type { MediaPlayerHandle } from '../../components/MediaPlayer/types'
import { jobEventReceived } from '../jobs/jobsSlice'
import CutterScreen from './CutterScreen'
import { openCutterVideo } from './cutterSlice'

const live = { positionMs: 0, paused: 0, seeks: [] as number[] }

vi.mock('../../components/MediaPlayer/MediaPlayer', () => ({
  default: (props: { ref?: Ref<MediaPlayerHandle> }) => {
    useImperativeHandle(props.ref, () => ({
      play: () => undefined,
      pause: () => {
        live.paused += 1
      },
      toggle: () => undefined,
      seekToMs: (ms: number) => {
        live.seeks.push(ms)
        live.positionMs = ms
      },
      seekByMs: () => undefined,
      getPositionMs: () => live.positionMs,
      getVideoElement: () => null
    }))
    return <div data-testid="player" />
  }
}))
vi.mock('../../components/InfoBar/InfoBar', () => ({ default: () => <div data-testid="info-bar" /> }))
vi.mock('../../components/CropDialog/CropDialog', () => ({
  default: (props: { onAccept: (r: unknown) => void }) => (
    <button
      type="button"
      onClick={() => props.onAccept({ crop: { x: 1, y: 2, w: 30, h: 40 }, bright: null, contrast: null, transpose: 90 })}
    >
      accept-crop
    </button>
  )
}))

const VIDEO = 'C:\\v\\a.mp4'
const DURATION = 95000

const probe: MediaInfo = {
  path: VIDEO,
  container: 'mov,mp4',
  formatLongName: null,
  durationMs: DURATION,
  sizeBytes: 1000,
  bitrateKbps: 500,
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
}

function savedJob(times: [number, number][], posExecution: 1 | 2 = 1): VideoJob {
  return {
    filename: VIDEO,
    originalPath: VIDEO,
    crop: null,
    bright: null,
    contrast: null,
    transpose: null,
    mediaPath: null,
    convert: false,
    size: null,
    rate: null,
    avgrate: null,
    times,
    posExecution,
    version: 2
  }
}

type Handler = (request: never) => unknown

function setup(handlers: Partial<Record<InvokeChannel, Handler>> = {}, stored: VideoJob | null = null) {
  const calls: Array<{ channel: string; request: unknown }> = []
  const all: Partial<Record<InvokeChannel, Handler>> = {
    'jobs:readJob': () => ({ found: stored !== null, job: stored, format: stored && 'v2', warnings: [] }),
    'media:probe': () => probe,
    'jobs:saveJob': (req: { job: { times: [number, number][]; posExecution: 1 | 2 } }) => ({
      jsonPath: `${VIDEO}.json`,
      job: savedJob(req.job.times, req.job.posExecution)
    }),
    'jobs:enqueueFiles': () => ({ batchId: 'b1', jobIds: ['j1'], skipped: [] }),
    ...handlers
  }
  const bridge: RendererApi = {
    invoke: async (channel, request) => {
      calls.push({ channel, request })
      const handler = all[channel]
      if (handler === undefined) return { ok: false, error: { code: 'NOT_IMPLEMENTED', message: channel } }
      return { ok: true, data: handler(request as never) } as IpcResult<never>
    },
    on: () => () => undefined,
    getPathForFile: () => ''
  }
  setBridge(bridge)
  const store = createAppStore({
    settings: { value: DEFAULT_SETTINGS, status: 'ready', error: null, saving: false }
  })
  store.dispatch(workspaceActivated('cutter'))
  render(
    <Provider store={store}>
      <CutterScreen />
    </Provider>
  )
  return { store, calls }
}

async function openVideo(store: ReturnType<typeof setup>['store']) {
  await act(async () => {
    await store.dispatch(openCutterVideo(VIDEO))
  })
  await waitFor(() => expect(store.getState().player.durationMs).toBe(DURATION))
}

function press(id: string) {
  const binding = allHandlers().find((b) => b.id === id)
  if (binding === undefined) throw new Error(`no binding ${id}`)
  act(() => binding.run(new KeyboardEvent('keydown')))
}

function mark(at: number) {
  live.positionMs = at
  press('cutter.mark')
}

beforeEach(() => {
  live.positionMs = 0
  live.paused = 0
  live.seeks = []
})
afterEach(() => {
  cleanup()
  clearHandlers()
  setBridge(null)
})

describe('Cutter workspace', () => {
  it('shows the empty state until a video is opened', () => {
    setup()
    expect(screen.getByText(/Open a video \(Ctrl\+O\)/)).toBeInTheDocument()
  })

  it('loads the ranges of an existing <video>.json (checklist 5)', async () => {
    const { store } = setup({}, savedJob([[1000, 2000], [5000, 9000]]))
    await openVideo(store)
    expect(await screen.findByLabelText('Start of range 2')).toHaveTextContent('00:00:05.000')
  })

  it('marks a range with X read from the live position, then saves it (checklist 9, 15)', async () => {
    const { store, calls } = setup()
    await openVideo(store)
    mark(1200)
    expect(store.getState().cutter.draft.pendingStartMs).toBe(1200)
    mark(4500)
    expect(await screen.findByLabelText('End of range 1')).toHaveTextContent('00:00:04.500')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.channel === 'jobs:saveJob')).toBe(true))
    const save = calls.find((c) => c.channel === 'jobs:saveJob')?.request as {
      videoPath: string
      job: { times: unknown }
    }
    expect(save.videoPath).toBe(VIDEO)
    expect(save.job.times).toEqual([[1200, 4500]])
  })

  it('refuses a zero-length range with a warning (D10)', async () => {
    const { store } = setup()
    await openVideo(store)
    mark(7000)
    mark(7000)
    expect(store.getState().cutter.draft.ranges).toEqual([])
    expect(store.getState().notifications.items.at(-1)?.severity).toBe('warning')
  })

  it('splits the span into N ranges (TV-2.7)', async () => {
    const { store } = setup()
    await openVideo(store)
    const field = await screen.findByLabelText('Split into parts')
    fireEvent.change(field, { target: { value: '4' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(store.getState().cutter.draft.ranges).toEqual([
      [0, 23750],
      [23750, 47500],
      [47500, 71250],
      [71250, DURATION]
    ])
  })

  it('C with no ranges only warns (checklist 16)', async () => {
    const { store, calls } = setup()
    await openVideo(store)
    press('cutter.cut')
    expect(calls.some((c) => c.channel === 'jobs:saveJob')).toBe(false)
    expect(store.getState().cutter.process.open).toBe(false)
  })

  it('Ctrl+Shift+V appends [playhead, end], saves as concat and opens the dialog (TV-2.4)', async () => {
    const { store, calls } = setup()
    await openVideo(store)
    live.positionMs = 20000
    press('cutter.concatToEnd')
    await waitFor(() => expect(store.getState().cutter.process.open).toBe(true))
    const save = calls.filter((c) => c.channel === 'jobs:saveJob').at(-1)?.request as {
      job: { times: unknown; posExecution: number }
    }
    expect(save.job.times).toEqual([[20000, DURATION]])
    expect(save.job.posExecution).toBe(2)
    expect(await screen.findByRole('dialog', { name: 'Process Video' })).toBeInTheDocument()
  })

  it('Execute saves, queues the file with the checkbox options and closes when done (checklist 24-31)', async () => {
    const { store, calls } = setup()
    await openVideo(store)
    mark(0)
    mark(5000)
    press('cutter.cut')
    await screen.findByRole('dialog', { name: 'Process Video' })
    expect(screen.getByLabelText('Close when done')).toBeChecked()
    expect(screen.getByLabelText('Same size')).not.toBeChecked()
    expect(screen.getByLabelText('Ignore ffmpeg warnings')).toBeChecked()
    expect(screen.getByLabelText('Concat')).not.toBeChecked()
    expect(screen.getByLabelText('Delete original')).toBeChecked()
    expect(screen.queryByLabelText(/Upload/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Execute' }))
    await waitFor(() => expect(store.getState().cutter.process.jobId).toBe('j1'))
    const enqueue = calls.find((c) => c.channel === 'jobs:enqueueFiles')?.request
    expect(enqueue).toEqual({
      paths: [VIDEO],
      options: { upload: false, deleteOriginal: true, ignoreErrors: true, sameSize: false }
    })

    const summary: JobSummary = {
      id: 'j1', videoPath: VIDEO, jsonPath: `${VIDEO}.json`, mode: 1, status: 'queued', progress: 0,
      outputs: [], error: null, options: {} as JobSummary['options'], batchId: 'b1', createdAt: 1,
      startedAt: null, finishedAt: null, logPath: null
    }
    act(() => {
      store.dispatch(jobEventReceived({ type: 'queued', job: summary }))
    })
    expect(screen.getByRole('button', { name: 'Execute' })).toBeDisabled()
    act(() => {
      store.dispatch(jobEventReceived({ type: 'done', jobId: 'j1', outputs: [`${VIDEO}.0.mp4`], durationMs: 10 }))
    })
    await waitFor(() => expect(store.getState().cutter.videoPath).toBeNull())
    expect(store.getState().cutter.result).toEqual({ kind: 'processed', outputs: [`${VIDEO}.0.mp4`] })
  })

  it('shows the upload checkbox only when the hook is enabled (A6)', async () => {
    const { store } = setup()
    store.dispatch({
      type: 'settings/loaded-test',
      payload: null
    })
    await openVideo(store)
    mark(0)
    mark(1000)
    press('cutter.cut')
    await screen.findByRole('dialog', { name: 'Process Video' })
    expect(screen.queryByLabelText('Upload (hook uploadOutputs)')).toBeNull()
  })

  it('applies the crop result to the overrides and creates a whole-video range (checklist 17)', async () => {
    const { store } = setup({
      'media:grabFrame': () => ({
        path: 'C:\\tmp\\f.png', url: 'media://f', width: 640, height: 360, sourcePath: VIDEO, atMs: 0
      })
    })
    await openVideo(store)
    press('cutter.crop')
    fireEvent.click(await screen.findByRole('button', { name: 'accept-crop' }))
    const { draft } = store.getState().cutter
    expect(draft.overrides.crop).toEqual({ x: 1, y: 2, w: 30, h: 40 })
    expect(draft.overrides.transpose).toBe(90)
    expect(draft.ranges).toEqual([[0, DURATION]])
  })

  it('seek keys clamp to the video (D12)', async () => {
    const { store } = setup()
    await openVideo(store)
    live.positionMs = 94000
    press('cutter.seek.Ctrl+R')
    expect(live.seeks.at(-1)).toBe(DURATION)
    live.positionMs = 3000
    press('cutter.seek.Ctrl+Shift+Q')
    expect(live.seeks.at(-1)).toBe(0)
  })

  it('Escape with unsaved ranges asks Save / Discard (A7)', async () => {
    const { store } = setup()
    await openVideo(store)
    mark(0)
    mark(1000)
    press('cutter.close')
    expect(await screen.findByRole('dialog', { name: 'Unsaved ranges' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(store.getState().cutter.videoPath).toBeNull()
    expect(store.getState().cutter.result).toEqual({ kind: 'cancelled' })
  })

  it('Escape without ranges closes at once with a cancelled result (checklist 22)', async () => {
    const { store } = setup()
    await openVideo(store)
    press('cutter.close')
    expect(store.getState().cutter.videoPath).toBeNull()
    expect(store.getState().cutter.result).toEqual({ kind: 'cancelled' })
  })

  it('F8 reports a missing external player hook', async () => {
    const { store } = setup({
      'hooks:run': () => ({ runId: 'r', name: 'externalPlayer', skipped: true })
    })
    await openVideo(store)
    press('cutter.externalPlayer')
    await waitFor(() =>
      expect(store.getState().notifications.items.at(-1)?.message).toBe(
        'External player hook is not configured'
      )
    )
  })

  it('registers the cutter keys under one scope with unique ids (checklist 23)', async () => {
    const { store } = setup()
    await openVideo(store)
    const ids = allHandlers().filter((b) => b.scope === 'cutter').map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('cutter.mark')
    const chords = allHandlers().filter((b) => b.scope === 'cutter').flatMap((b) => b.keys)
    expect(chords).not.toContain('Ctrl+Shift+A')
    expect(new Set(chords).size).toBe(chords.length)
  })
})
