import { ThemeProvider } from '@mui/material/styles'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAppStore } from '../store'
import { theme } from '../theme'
import { describeFileError, formatLog, joinLogs } from './errorLog'
import NotificationsHost from './NotificationsHost'
import { notify } from './notify'

function mount() {
  const store = createAppStore()
  render(
    <ThemeProvider theme={theme}>
      <Provider store={store}>
        <NotificationsHost />
      </Provider>
    </ThemeProvider>
  )
  return store
}

describe('error toast with a log', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>()
  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined)
  })
  /** `userEvent.setup()` installs its own clipboard stub, so ours goes in afterwards. */
  const setupUser = () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    return user
  }
  afterEach(() => vi.restoreAllMocks())

  it('shows a log icon only when the notification has a log', async () => {
    const store = mount()
    act(() => void store.dispatch(notify('error', 'Plain failure')))
    expect(await screen.findByText('Plain failure')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show log' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()

    act(() => void store.dispatch(notify('error', 'With log', { log: 'a\nb' })))
    // The queue is oldest first: close the first toast to reach the second.
    await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }))
    expect(await screen.findByText('With log')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show log' })).toBeInTheDocument()
  })

  it('opens the log, copies it, and closes; the dialog owns the dialog keymap scope', async () => {
    const user = setupUser()
    const store = mount()
    act(() => {
      store.dispatch(
        notify('error', 'Cannot read a.mp4', { log: 'Playback failed\nFile: /v/a.mp4' })
      )
    })
    await user.click(await screen.findByRole('button', { name: 'Show log' }))

    const dialog = await screen.findByRole('dialog', { name: 'Log: Cannot read a.mp4' })
    expect(within(dialog).getByTestId('log-text')).toHaveTextContent('File: /v/a.mp4')
    expect(store.getState().keymap.modalStack).toContain('dialog')

    await user.click(within(dialog).getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('Playback failed\nFile: /v/a.mp4')
    expect(await within(dialog).findByText('Copied')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(store.getState().keymap.modalStack).not.toContain('dialog')
    // The toast itself is still there until it is dismissed.
    expect(screen.getByText('Cannot read a.mp4')).toBeInTheDocument()
  })

  it('says so when the clipboard refuses', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    const user = setupUser()
    const store = mount()
    act(() => void store.dispatch(notify('error', 'Boom', { log: 'x' })))
    await user.click(await screen.findByRole('button', { name: 'Show log' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Copy' }))
    expect(await within(dialog).findByText(/Copy failed/)).toBeInTheDocument()
  })

  it('a toast with a log does not auto-hide; one without follows its severity', () => {
    const store = createAppStore()
    store.dispatch(notify('info', 'quick'))
    store.dispatch(notify('info', 'with log', { log: 'x' }))
    store.dispatch(notify('info', 'explicit', { log: 'x', autoHideMs: 1000 }))
    const [quick, withLog, explicit] = store.getState().notifications.queue
    expect(quick?.autoHideMs).toBe(4000)
    expect(withLog?.autoHideMs).toBeNull()
    expect(explicit?.autoHideMs).toBe(1000)
  })
})

describe('errorLog', () => {
  const now = new Date('2026-10-14T12:00:00.000Z')

  it('formatLog skips empty fields and appends the raw output', () => {
    const text = formatLog(
      'Title',
      { File: '/a.mp4', Empty: '', Missing: undefined, N: 0 },
      '  boom\nline2  ',
      now
    )
    expect(text).toBe(
      [
        'Title',
        'Time: 2026-10-14T12:00:00.000Z',
        'File: /a.mp4',
        'N: 0',
        '',
        '--- output ---',
        'boom\nline2'
      ].join('\n')
    )
  })

  it('describeFileError carries the code, the details and the ffprobe text', () => {
    const text = describeFileError('Cannot read this video', 'C:/v/bad.mp4', {
      code: 'PROBE_FAILED',
      message: 'Invalid data found when processing input',
      details: { path: 'C:/v/bad.mp4', exitCode: 1 }
    })
    expect(text).toContain('File: C:/v/bad.mp4')
    expect(text).toContain('Error code: PROBE_FAILED')
    expect(text).toContain('"exitCode": 1')
    expect(text).toContain('--- output ---\nInvalid data found when processing input')
  })

  it('joinLogs separates the blocks', () => {
    expect(joinLogs(['a', 'b'])).toBe('a\n\n==========\n\nb')
  })
})
