import { ThemeProvider } from '@mui/material/styles'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '@renderer/App'
import { setBridge } from '@renderer/app/api'
import { createAppStore } from '@renderer/app/store'
import { theme } from '@renderer/app/theme'

type FakeBridge = Parameters<typeof setBridge>[0]

/** Every call fails with NOT_IMPLEMENTED: the shell test never needs main. */
const offlineBridge = {
  invoke: () =>
    Promise.resolve({ ok: false, error: { code: 'INTERNAL', message: 'offline test bridge' } }),
  on: () => () => undefined,
  getPathForFile: () => ''
} as unknown as FakeBridge

function renderApp() {
  const store = createAppStore()
  render(
    <ThemeProvider theme={theme}>
      <Provider store={store}>
        <App />
      </Provider>
    </ThemeProvider>
  )
  return store
}

beforeEach(() => setBridge(offlineBridge))
afterEach(() => setBridge(null))

describe('App shell', () => {
  it('lists the six workspaces in the navigation', () => {
    renderApp()
    const nav = screen.getByRole('navigation', { name: 'Workspaces' })
    const labels = within(nav)
      .getAllByRole('button')
      .map((button) => button.textContent)
    expect(labels).toEqual([
      'Video Triage',
      'Image Triage',
      'Cutter',
      'Jobs',
      'Duplicates',
      'Settings'
    ])
  })

  it('starts on Video Triage and switches the main area on click', async () => {
    const user = userEvent.setup()
    renderApp()
    expect(screen.getByRole('button', { name: 'Video Triage' })).toHaveAttribute('aria-current', 'page')

    await user.click(screen.getByRole('button', { name: 'Jobs' }))

    expect(await screen.findByRole('heading', { name: 'Jobs' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Jobs' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Video Triage' })).not.toHaveAttribute('aria-current')
  })

  it('switches workspace with Ctrl+4 and opens the F1 help with the global shortcuts', async () => {
    const store = renderApp()
    fireEvent.keyDown(window, { key: '4', code: 'Digit4', ctrlKey: true })
    expect(store.getState().keymap.activeWorkspace).toBe('jobs')
    expect(screen.getByRole('button', { name: 'Jobs' })).toHaveAttribute('aria-current', 'page')

    fireEvent.keyDown(window, { key: 'F1', code: 'F1' })
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })
    expect(within(dialog).getByText('Go to Settings')).toBeInTheDocument()
    expect(store.getState().keymap.modalStack).toEqual(['help'])

    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' })
    expect(store.getState().keymap.helpOpen).toBe(false)
    expect(store.getState().keymap.modalStack).toEqual([])
  })

  it('shows notifications as snackbars', async () => {
    const store = renderApp()
    const { notify } = await import('@renderer/app/notifications/notify')
    store.dispatch(notify('error', 'Could not move', { detail: 'C:/x.mp4' }))
    expect(await screen.findByText('Could not move')).toBeInTheDocument()
    expect(screen.getByText('C:/x.mp4')).toBeInTheDocument()
  })
})
