import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { IpcResult } from '@shared/domain/errors'
import type { HashRow } from '@shared/domain/hash'
import type { MediaInfo } from '@shared/domain/media'
import type { InvokeChannel, RendererApi } from '@shared/ipc/contract'
import { setBridge } from '../../app/api'
import { createAppStore } from '../../app/store'
import DuplicatesScreen from './DuplicatesScreen'
import { loadHashTable } from './duplicatesSlice'

type Handler = (request: never) => unknown

function makeBridge(handlers: Partial<Record<InvokeChannel, Handler>>) {
  const calls: Array<{ channel: string; request: unknown }> = []
  const bridge: RendererApi = {
    invoke: async (channel, request) => {
      calls.push({ channel, request })
      const handler = handlers[channel]
      if (handler === undefined) return { ok: false, error: { code: 'NOT_IMPLEMENTED', message: channel } }
      return { ok: true, data: handler(request as never) } as IpcResult<never>
    },
    on: () => () => undefined,
    getPathForFile: () => ''
  }
  return { bridge, calls }
}

function hashRow(path: string, md5: string, extra: Partial<HashRow> = {}): HashRow {
  return {
    root: '/d',
    inFile: path.slice(3),
    path,
    md5,
    pureMD5: null,
    hash16: null,
    hash8: null,
    thumbLight: null,
    thumbDark: null,
    worksdWell: true,
    sizeFile: 1000,
    comments: '',
    ...extra
  }
}

function info(path: string, bitrate: number): MediaInfo {
  return {
    path, container: 'mp4', formatLongName: null, durationMs: 1000, sizeBytes: 1234, bitrateKbps: bitrate,
    hasVideo: true, width: 640, height: 360, displayWidth: 640, displayHeight: 360, rotation: 0, fps: 25,
    videoCodec: 'h264', pixFmt: null, hasAudio: true, audioCodec: 'aac', audioChannels: 2, streamCount: 2
  }
}

const ROWS: HashRow[] = [hashRow('/d/a.mp4', 'M1'), hashRow('/d/c.mp4', 'M1'), hashRow('/d/bad.jpg', 'Z', { md5: null, worksdWell: false })]

function setup(rows: HashRow[]) {
  const afterClean = rows.filter((r) => r.path !== '/d/c.mp4')
  const { bridge, calls } = makeBridge({
    'hashing:load': () => ({ csvPath: '/vdo_resultsMD5.txt', rows }),
    'media:probeMany': ((req: { paths: string[] }) => ({
      results: req.paths.map((p) => ({ ok: true, path: p, info: info(p, p.includes('c.mp4') ? 900 : 100) }))
    })) as Handler,
    'media:mosaic': ((req: { path: string }) => ({ path: req.path, url: 'media://local/m.jpg', width: 300, height: 300 })) as Handler,
    'session:open': () => ({ id: 's1', root: '/d', items: [] }),
    'session:close': () => undefined,
    'fileops:moveMany': ((req: { paths: string[] }) => ({ moved: req.paths.map(() => ({})), failed: [] })) as Handler,
    'hashing:clean': () => ({ table: { csvPath: '/vdo_resultsMD5.txt', rows: afterClean }, removed: 1 })
  })
  setBridge(bridge)
  const store = createAppStore()
  render(
    <Provider store={store}>
      <DuplicatesScreen />
    </Provider>
  )
  return { store, calls }
}

// jsdom has no layout: give every element a viewport so the virtualizer renders rows.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 800 })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 1200 })
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 1200, height: 800, top: 0, left: 0, right: 1200, bottom: 800, x: 0, y: 0, toJSON: () => ({}) })
})

afterEach(cleanup)

describe('DuplicatesScreen', () => {
  it('shows one button per key with counts and a table ordered by bitrate (checklist 22, 23)', async () => {
    const { store } = setup(ROWS.slice(0, 2))
    await store.dispatch(loadHashTable({ source: { dir: '/d', kind: 'video' } }))
    expect(await screen.findByRole('button', { name: 'md5: 1 group / 2 files' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'thumbDark: 0 groups / 0 files' })).toBeDisabled()
    await waitFor(() => {
      const tiles = screen.getAllByRole('button', { pressed: false }).filter((b) => b.getAttribute('aria-label')?.startsWith('/d/'))
      expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual(['/d/c.mp4', '/d/a.mp4'])
    })
  })

  it('28: Move to R opens a session, moves the selection to the purge folder, closes and cleans', async () => {
    const { store, calls } = setup(ROWS.slice(0, 2))
    const user = userEvent.setup()
    await store.dispatch(loadHashTable({ source: { dir: '/d', kind: 'video' } }))
    await screen.findByRole('button', { name: '/d/a.mp4' })
    await user.click(screen.getByRole('button', { name: 'Unselect first column' }))
    await user.click(await screen.findByRole('button', { name: 'Move to R (1)' }))
    await waitFor(() => expect(calls.some((c) => c.channel === 'hashing:clean')).toBe(true))
    const channels = calls.map((c) => c.channel).filter((c) => c.startsWith('session') || c.startsWith('fileops') || c === 'hashing:clean')
    expect(channels).toEqual(['session:open', 'fileops:moveMany', 'session:close', 'hashing:clean'])
    expect(calls.find((c) => c.channel === 'session:open')?.request).toMatchObject({ dir: '/d', kind: 'any', recursive: true })
    expect(calls.find((c) => c.channel === 'fileops:moveMany')?.request).toMatchObject({
      sessionId: 's1',
      paths: ['/d/a.mp4'],
      destination: { type: 'folder', name: 'md5Purge' }
    })
    expect(store.getState().duplicates.selectedPaths).toEqual([])
  })

  it('29: unreadable files are listed in Feedback and moved to ruimFolder', async () => {
    const { store, calls } = setup(ROWS)
    const user = userEvent.setup()
    await store.dispatch(loadHashTable({ source: { dir: '/d', kind: 'video' } }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByTestId('feedback-text')).toHaveTextContent('/d/bad.jpg')
    await user.click(within(dialog).getByRole('button', { name: 'Move to ruim' }))
    await waitFor(() => expect(calls.some((c) => c.channel === 'fileops:moveMany')).toBe(true))
    expect(calls.find((c) => c.channel === 'fileops:moveMany')?.request).toMatchObject({
      paths: ['/d/bad.jpg'],
      destination: { type: 'folder', name: 'ruimFolder' }
    })
  })

  it('exports the screen data into the Feedback panel', async () => {
    const { store } = setup(ROWS.slice(0, 2))
    const user = userEvent.setup()
    await store.dispatch(loadHashTable({ source: { dir: '/d', kind: 'video' } }))
    await user.click(await screen.findByRole('button', { name: 'Export screen data' }))
    const dialog = await screen.findByRole('dialog')
    expect(JSON.parse(within(dialog).getByTestId('feedback-text').textContent ?? '')).toEqual([
      ['/d/c.mp4', 'M1'],
      ['/d/a.mp4', 'M1']
    ])
  })
})
