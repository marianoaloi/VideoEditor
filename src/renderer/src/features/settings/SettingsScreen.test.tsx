import { ThemeProvider } from '@mui/material/styles'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '@renderer/app/api'
import { settingsReceived } from './settingsSlice'
import { createAppStore } from '@renderer/app/store'
import { theme } from '@renderer/app/theme'
import { DEFAULT_SETTINGS } from '@shared/domain/settings'
import SettingsScreen from './SettingsScreen'

type Bridge = NonNullable<Parameters<typeof setBridge>[0]>
type Handler = (request: unknown) => unknown

function installBridge(handlers: Record<string, Handler>) {
  const invoke = vi.fn((channel: string, request: unknown) => {
    const handler = handlers[channel]
    if (handler === undefined) {
      return Promise.resolve({ ok: false, error: { code: 'INTERNAL', message: `no ${channel}` } })
    }
    return Promise.resolve({ ok: true, data: handler(request) })
  })
  setBridge({ invoke, on: () => () => undefined, getPathForFile: () => '' } as unknown as Bridge)
  return invoke
}

function renderScreen() {
  const store = createAppStore()
  store.dispatch(settingsReceived(DEFAULT_SETTINGS))
  render(
    <ThemeProvider theme={theme}>
      <Provider store={store}>
        <SettingsScreen />
      </Provider>
    </ThemeProvider>
  )
  return store
}

const TOOLS = { ffmpeg: null, ffprobe: null, h264Encoders: ['libx264'], hwaccels: [], error: null }

beforeEach(() => vi.useRealTimers())
afterEach(() => setBridge(null))

describe('Settings screen', () => {
  it('edits a number and saves a patch with only the changed section (Ctrl+S disabled until dirty)', async () => {
    const user = userEvent.setup()
    const invoke = installBridge({
      'jobs:tools': () => TOOLS,
      'settings:update': (request) => ({
        ...DEFAULT_SETTINGS,
        imageTriage: {
          ...DEFAULT_SETTINGS.imageTriage,
          ...(request as { patch: { imageTriage: object } }).patch.imageTriage
        }
      })
    })
    renderScreen()
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()

    await user.click(screen.getByRole('tab', { name: 'Image Triage' }))
    const field = screen.getByLabelText('Images in the strip')
    await user.clear(field)
    await user.type(field, '7')
    expect(save).toBeEnabled()
    await user.click(save)

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('settings:update', {
        patch: { imageTriage: { ...DEFAULT_SETTINGS.imageTriage, visibleCount: 7 } }
      })
    )
    await waitFor(() => expect(save).toBeDisabled())
  })

  it('blocks saving values the schema rejects and shows why', async () => {
    const user = userEvent.setup()
    installBridge({ 'jobs:tools': () => TOOLS })
    renderScreen()
    await user.click(screen.getByRole('tab', { name: 'Image Triage' }))
    const field = screen.getByLabelText('Images in the strip')
    await user.clear(field)
    await user.type(field, '12')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByText(/imageTriage.visibleCount/)).toBeInTheDocument()
  })

  it('tests a hook through hooks:preview with the unsaved template', async () => {
    const user = userEvent.setup()
    const invoke = installBridge({
      'jobs:tools': () => TOOLS,
      'hooks:preview': () => ({
        command: 'movies.exe',
        args: ['C:/Videos/L'],
        cwd: null,
        env: { upload: 'true' }
      })
    })
    renderScreen()
    await user.click(screen.getByRole('tab', { name: 'Hooks' }))
    const section = screen.getByRole('region', { name: 'Process the L folder (movies.sh)' })
    await user.type(within(section).getByLabelText('Command'), 'movies.exe')
    await user.click(within(section).getByRole('button', { name: /^Test/ }))

    expect(await within(section).findByText(/command: movies.exe/)).toBeInTheDocument()
    const call = invoke.mock.calls.find(([channel]) => channel === 'hooks:preview')
    expect(call?.[1]).toMatchObject({
      template: { command: 'movies.exe', args: ['{dir}'] },
      context: { dir: expect.any(String), root: expect.any(String) }
    })
  })

  it('warns about .bat commands', async () => {
    const user = userEvent.setup()
    installBridge({ 'jobs:tools': () => TOOLS })
    renderScreen()
    await user.click(screen.getByRole('tab', { name: 'Hooks' }))
    const section = screen.getByRole('region', { name: 'Open in an external player' })
    await user.type(within(section).getByLabelText('Command'), 'play.bat')
    expect(within(section).getByText(/cannot be started directly/)).toBeInTheDocument()
  })
})
