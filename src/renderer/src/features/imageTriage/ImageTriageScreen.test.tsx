import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { afterEach, describe, expect, it } from 'vitest'
import type { Session } from '@shared/domain/session'
import type { RendererApi } from '@shared/ipc/contract'
import { setBridge } from '../../app/api'
import { createAppStore } from '../../app/store'
import { workspaceActivated } from '../../app/keymap/keymapSlice'
import KeymapHost from '../../app/keymap/KeymapHost'
import { sessionOpened } from './imageTriageSlice'
import ImageTriageScreen from './ImageTriageScreen'

const session: Session = {
  id: 's1',
  root: 'C:\\r',
  recursive: false,
  kind: 'image',
  sort: 'size-desc',
  items: [
    { id: 'a', path: 'C:\\r\\a.gif', relDir: '', name: 'a.gif', sizeBytes: 2048, mtimeMs: 1, kind: 'gif' },
    { id: 'b', path: 'C:\\r\\b.tif', relDir: '', name: 'b.tif', sizeBytes: 10, mtimeMs: 1, kind: 'image' }
  ],
  openedAt: 0,
  skippedDirs: []
}

afterEach(() => setBridge(null))

describe('ImageTriageScreen', () => {
  it('starts with the open hint and no AI controls', () => {
    const store = createAppStore()
    render(
      <Provider store={store}>
        <ImageTriageScreen />
      </Provider>
    )
    expect(screen.getByTestId('status-line').textContent).toContain('Open a folder')
    expect(screen.queryByText(/tag|model|IA/i)).toBeNull()
  })

  it('shows the status line (green for GIF) and falls back to a placeholder when no preview exists', async () => {
    // The preview channel is missing and grabFrame fails: the screen must still work.
    setBridge({
      invoke: async (channel) => ({ ok: false, error: { code: 'NOT_IMPLEMENTED', message: String(channel) } }),
      on: () => () => undefined,
      getPathForFile: () => ''
    } as RendererApi)
    const store = createAppStore()
    store.dispatch(sessionOpened(session))
    render(
      <Provider store={store}>
        <ImageTriageScreen />
      </Provider>
    )
    const line = screen.getByTestId('status-line')
    expect(line.textContent).toContain('[2.00K]')
    expect(line.textContent).toContain('2/1')
    expect(getComputedStyle(line).backgroundColor).toBe('rgb(144, 238, 144)')
    fireEvent.error(screen.getAllByRole('img')[0] as HTMLElement)
    await waitFor(() => expect(screen.getAllByText('a.gif').length).toBeGreaterThan(0))
    expect(screen.getAllByTestId('image-tile')).toHaveLength(2)
  })

  it('M5: L asks first and sends nothing until confirmed; cancel sends nothing at all', async () => {
    const calls: string[] = []
    setBridge({
      invoke: async (channel) => {
        calls.push(String(channel))
        return { ok: false, error: { code: 'NOT_IMPLEMENTED', message: String(channel) } }
      },
      on: () => () => undefined,
      getPathForFile: () => ''
    } as RendererApi)
    const store = createAppStore()
    store.dispatch(workspaceActivated('imageTriage'))
    store.dispatch(sessionOpened({ ...session, items: session.items.map((i, n) => ({ ...i, id: `r${n}` })) }))
    render(
      <Provider store={store}>
        <ImageTriageScreen />
        <KeymapHost />
      </Provider>
    )
    fireEvent.keyDown(window, { key: 'l', code: 'KeyL' })
    expect(await screen.findByText(/will be sent to the trash/)).toBeTruthy()
    expect(screen.getByText(/0 files moved to R in this session/)).toBeTruthy()
    expect(calls.filter((c) => c.startsWith('hooks:') || c.startsWith('fileops:preclean'))).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText(/will be sent to the trash/)).toBeNull())
    expect(calls.filter((c) => c.startsWith('hooks:') || c.startsWith('fileops:preclean'))).toEqual([])
  })
})
