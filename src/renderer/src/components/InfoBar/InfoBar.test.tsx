import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { MediaInfo } from '@shared/domain/media'
import { DEFAULT_SETTINGS } from '@shared/domain/settings'
import { NO_OVERRIDES } from '../../app/draft'
import InfoBar from './InfoBar'
import type { InfoBarProps } from './types'

const A1: MediaInfo = {
  path: '/v/a.mp4',
  container: 'mov,mp4',
  formatLongName: null,
  durationMs: 600_000,
  sizeBytes: 314_572_800,
  bitrateKbps: 2500,
  hasVideo: true,
  width: 1920,
  height: 1080,
  displayWidth: 1920,
  displayHeight: 1080,
  rotation: 0,
  fps: 30,
  videoCodec: 'h264',
  pixFmt: 'yuv420p',
  hasAudio: true,
  audioCodec: 'aac',
  audioChannels: 2,
  streamCount: 2
}

function props(over: Partial<InfoBarProps> = {}): InfoBarProps {
  return {
    info: A1,
    fileSizeBytes: 314_572_800,
    positionMs: 65_000,
    selectedMs: 120_000,
    thresholds: DEFAULT_SETTINGS.thresholds,
    overrides: NO_OVERRIDES,
    onOverridesChange: vi.fn(),
    ...over
  }
}

describe('InfoBar (checklist 27-29, TV-A1)', () => {
  it('shows the formatted values with their colours', () => {
    render(<InfoBar {...props()} />)
    expect(screen.getByTestId('info-fileSize')).toHaveTextContent('300.00M')
    expect(screen.getByTestId('info-fileSize')).toHaveAttribute('data-color', 'red')
    expect(screen.getByTestId('info-durationTime')).toHaveAttribute('data-color', 'yellow')
    expect(screen.getByTestId('info-otimizedTime')).toHaveTextContent('00:04:20')
    expect(screen.getByTestId('info-otimizedSize')).toHaveTextContent('13.33M')
    expect(screen.getByTestId('info-position')).toHaveTextContent('00:01:05')
    expect(screen.getByTestId('info-selection')).toHaveTextContent('00:02:00')
    expect(screen.getByTestId('info-selection')).toHaveAttribute('data-color', 'green')
    expect(screen.getByTestId('info-estimate')).toHaveTextContent('2.67M')
  })

  it('shows only the error when the probe failed', () => {
    render(<InfoBar {...props({ error: 'moov atom not found' })} />)
    expect(screen.getByRole('alert')).toHaveTextContent('moov atom not found')
    expect(screen.queryByTestId('info-fileSize')).not.toBeInTheDocument()
  })

  it('shows a dash for the estimate without probe data', () => {
    render(<InfoBar {...props({ info: null })} />)
    expect(screen.getByTestId('info-estimate')).toHaveTextContent('—')
  })
})

describe('InfoBar overrides (checklist 30, 31)', () => {
  it('commits a valid edit on Enter as a typed patch', async () => {
    const onOverridesChange = vi.fn()
    const user = userEvent.setup()
    render(<InfoBar {...props({ onOverridesChange })} />)
    const input = screen.getByRole('textbox', { name: 'Bitrate (kbit/s)' })
    await user.clear(input)
    await user.type(input, '800{Enter}')
    expect(onOverridesChange).toHaveBeenCalledWith({ rate: 800 })
  })

  it('refuses an invalid edit and sends nothing', async () => {
    const onOverridesChange = vi.fn()
    const user = userEvent.setup()
    render(<InfoBar {...props({ onOverridesChange })} />)
    const input = screen.getByRole('textbox', { name: 'Crop' })
    await user.clear(input)
    await user.type(input, '10|20|300{Enter}')
    expect(onOverridesChange).not.toHaveBeenCalled()
    expect(screen.getByText(/x\|y\|w\|h/)).toBeInTheDocument()
  })

  it('does not mark a field that was only focused and left (legacy bug N18)', () => {
    const onOverridesChange = vi.fn()
    render(<InfoBar {...props({ onOverridesChange })} />)
    const input = screen.getByRole('textbox', { name: 'FPS' })
    fireEvent.focus(input)
    fireEvent.blur(input)
    expect(onOverridesChange).not.toHaveBeenCalled()
  })

  it('shows overrides as overrides', () => {
    render(<InfoBar {...props({ overrides: { ...NO_OVERRIDES, size: '640x360' } })} />)
    expect(screen.getByRole('textbox', { name: 'Size' })).toHaveValue('640x360')
    expect(screen.getAllByText('Override').length).toBeGreaterThan(0)
  })
})
