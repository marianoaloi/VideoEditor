import { ThemeProvider } from '@mui/material/styles'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '@renderer/app/api'
import { workspaceActivated } from '@renderer/app/keymap/keymapSlice'
import KeymapHost from '@renderer/app/keymap/KeymapHost'
import { createAppStore } from '@renderer/app/store'
import { theme } from '@renderer/app/theme'
import type { JobSummary } from '@shared/domain/job'
import JobsScreen from './JobsScreen'
import { jobEventReceived } from './jobsSlice'

type Bridge = NonNullable<Parameters<typeof setBridge>[0]>
type Handler = (request: unknown) => unknown

/** `hooks:exit` listeners registered through the fake bridge. */
const exitListeners = new Set<(payload: unknown) => void>()
function emitHookExit(runId: string, name: string, extra: object = {}): void {
  for (const listener of exitListeners) {
    listener({ runId, name, code: 0, durationMs: 1, error: null, ...extra })
  }
}

function installBridge(handlers: Record<string, Handler>) {
  const invoke = vi.fn((channel: string, request: unknown) => {
    const handler = handlers[channel]
    if (handler === undefined) {
      return Promise.resolve({ ok: false, error: { code: 'INTERNAL', message: `no ${channel}` } })
    }
    return Promise.resolve({ ok: true, data: handler(request) })
  })
  const on = (channel: string, listener: (payload: unknown) => void): (() => void) => {
    if (channel !== 'hooks:exit') return () => undefined
    exitListeners.add(listener)
    return () => exitListeners.delete(listener)
  }
  setBridge({ invoke, on, getPathForFile: () => '' } as unknown as Bridge)
  return invoke
}

function summary(id: string, status: JobSummary['status']): JobSummary {
  return {
    id,
    videoPath: `/media/CUSTOM/${id}.mp4`,
    jsonPath: `/media/CUSTOM/${id}.mp4.json`,
    mode: 1,
    status,
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
}

function renderJobs() {
  const store = createAppStore()
  store.dispatch(workspaceActivated('jobs'))
  render(
    <ThemeProvider theme={theme}>
      <Provider store={store}>
        <JobsScreen />
        <KeymapHost />
      </Provider>
    </ThemeProvider>
  )
  return store
}

afterEach(() => setBridge(null))

describe('Jobs screen', () => {
  it('shows the [running] [queued] counter and cancels the selected job with Delete', async () => {
    const user = userEvent.setup()
    const invoke = installBridge({ 'jobs:list': () => [], 'jobs:cancel': () => null })
    const store = renderJobs()
    act(() => {
      store.dispatch(jobEventReceived({ type: 'queued', job: summary('a', 'queued') }))
      store.dispatch(jobEventReceived({ type: 'queued', job: summary('b', 'queued') }))
      store.dispatch(jobEventReceived({ type: 'started', jobId: 'a', at: 5 }))
      store.dispatch(jobEventReceived({ type: 'log', jobId: 'a', lines: ['frame=12 fps=30'] }))
    })

    expect(await screen.findByLabelText('Queue counter')).toHaveTextContent('[1] [1]')
    expect(screen.getByLabelText('Latest ffmpeg output')).toHaveTextContent('frame=12 fps=30')

    await user.click(screen.getByText('a.mp4', { exact: false }))
    expect(screen.getByLabelText('Job log')).toHaveTextContent('frame=12 fps=30')
    fireEvent.keyDown(window, { key: 'Delete', code: 'Delete' })
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('jobs:cancel', { jobId: 'a' }))
  })

  it('batches the picked folder with the checkbox options (force mode included)', async () => {
    const user = userEvent.setup()
    const invoke = installBridge({
      'jobs:list': () => [],
      'app:openDirectoryDialog': () => ({ canceled: false, path: '/media/CUSTOM' }),
      'jobs:enqueueFolder': () => ({ batchId: 'b1', jobIds: ['j1'], skipped: [] })
    })
    renderJobs()
    await user.click(screen.getByRole('checkbox', { name: 'Delete original' }))
    await user.click(screen.getByRole('button', { name: 'Re-encode whole videos in folder' }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('jobs:enqueueFolder', {
        dir: '/media/CUSTOM',
        options: { deleteOriginal: true },
        force: true
      })
    )
  })

  it('"Clean queue and execute movie" confirms, preclean L, then runs moviesL and deleteR on the root', async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    const invoke = installBridge({
      'jobs:list': () => [],
      'app:openDirectoryDialog': () => ({ canceled: false, path: '/media/CUSTOM' }),
      'jobs:enqueueFolder': () => ({ batchId: 'b1', jobIds: [], skipped: [] }),
      'jobs:clearQueue': () => {
        calls.push('clear')
        return { cancelled: 2 }
      },
      'session:open': () => {
        calls.push('open')
        return { id: 's1', root: '/media' }
      },
      'fileops:preclean': () => {
        calls.push('preclean')
        return { trashed: ['/media/L/x.log'] }
      },
      'session:close': () => {
        calls.push('close')
        return null
      },
      'hooks:run': (request) => {
        const name = (request as { name: string }).name
        calls.push(`hook:${name}`)
        // moviesL takes a while: deleteR must not start before its exit event (review M12)
        setTimeout(() => {
          calls.push(`exit:${name}`)
          emitHookExit(`run-${name}`, name, name === 'deleteR' ? { trashed: 2 } : {})
        }, name === 'moviesL' ? 60 : 1)
        return { runId: `run-${name}`, name, skipped: false }
      }
    })
    renderJobs()
    await user.click(screen.getByRole('button', { name: 'Choose folder and process' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('jobs:enqueueFolder', expect.anything()))

    await user.click(screen.getByRole('button', { name: 'Clean queue and execute movie' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Run' }))

    await waitFor(() => expect(calls).toContain('hook:deleteR'))
    expect(calls.slice(0, 7)).toEqual([
      'clear',
      'open',
      'preclean',
      'close',
      'hook:moviesL',
      'exit:moviesL',
      'hook:deleteR'
    ])
    expect(invoke).toHaveBeenCalledWith('hooks:run', {
      name: 'moviesL',
      context: { dir: '/media/L', root: '/media' }
    })
  })
})
