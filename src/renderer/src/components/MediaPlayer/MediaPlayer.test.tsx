import { createRef } from 'react'
import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaInfo } from '@shared/domain/media'
import { toMediaUrl, toTranscodeUrl } from '@shared/ipc/mediaUrl'
import MediaPlayer from './MediaPlayer'
import type { MediaPlayerHandle, MediaPlayerProps } from './types'

const PATH = '/videos/a.mkv'

function info(over: Partial<MediaInfo> = {}): MediaInfo {
  return {
    path: PATH,
    container: 'mov,mp4,m4a,3gp,3g2,mj2',
    formatLongName: null,
    durationMs: 60_000,
    sizeBytes: 1,
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
    streamCount: 2,
    ...over
  }
}

function props(over: Partial<MediaPlayerProps> = {}): MediaPlayerProps {
  return {
    path: PATH,
    info: info(),
    autoPlay: false,
    speed: 1,
    volume: 0.5,
    muted: false,
    onPosition: vi.fn(),
    ...over
  }
}

const video = (container: HTMLElement): HTMLVideoElement => {
  const el = container.querySelector('video')
  if (el === null) throw new Error('no video element')
  return el
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

describe('MediaPlayer source choice (ADR-004)', () => {
  it('plays a compatible file directly from media://local', () => {
    const { container } = render(<MediaPlayer {...props()} />)
    expect(video(container).getAttribute('src')).toBe(toMediaUrl(PATH))
  })

  it('goes straight to the transcode stream for an unplayable container', () => {
    const onModeChange = vi.fn()
    const { container } = render(
      <MediaPlayer {...props({ info: info({ container: 'avi' }), onModeChange })} />
    )
    expect(video(container).getAttribute('src')).toBe(toTranscodeUrl(PATH, 0))
    expect(onModeChange).toHaveBeenCalledWith('transcode', 0)
  })

  it('waits for the probe, unless the fallback is forced', () => {
    const waiting = render(<MediaPlayer {...props({ info: null })} />)
    expect(video(waiting.container).getAttribute('src')).toBeNull()
    const forced = render(<MediaPlayer {...props({ info: null, forceTranscode: true })} />)
    expect(video(forced.container).getAttribute('src')).toBe(toTranscodeUrl(PATH, 0))
  })

  it('switches to the transcode stream at the current position on a decode error', () => {
    const onModeChange = vi.fn()
    const { container } = render(<MediaPlayer {...props({ onModeChange })} />)
    const el = video(container)
    Object.defineProperty(el, 'currentTime', { value: 12.5, configurable: true })
    fireEvent.error(el)
    expect(el.getAttribute('src')).toBe(toTranscodeUrl(PATH, 12.5))
    expect(onModeChange).toHaveBeenLastCalledWith('transcode', 12_500)
  })

  it('reports an error when even the fallback fails', () => {
    const onError = vi.fn()
    const { container } = render(<MediaPlayer {...props({ onError, forceTranscode: true })} />)
    fireEvent.error(video(container))
    expect(onError).toHaveBeenCalledTimes(1)
  })
})

describe('MediaPlayer timeline and handle', () => {
  it('reports positions in the original timeline (offset + currentTime)', () => {
    const onPosition = vi.fn()
    const { container } = render(
      <MediaPlayer {...props({ onPosition, forceTranscode: true, initialPositionMs: 30_000 })} />
    )
    const el = video(container)
    expect(el.getAttribute('src')).toBe(toTranscodeUrl(PATH, 30))
    Object.defineProperty(el, 'currentTime', { value: 2, configurable: true })
    fireEvent.timeUpdate(el)
    expect(onPosition).toHaveBeenLastCalledWith(32_000)
  })

  it('seeks directly in direct mode and re-requests the stream outside the buffer in transcode mode', () => {
    const ref = createRef<MediaPlayerHandle>()
    const direct = render(<MediaPlayer {...props({ ref })} />)
    act(() => ref.current?.seekToMs(5000))
    expect(video(direct.container).currentTime).toBe(5)
    expect(ref.current?.getPositionMs()).toBe(5000)

    const ref2 = createRef<MediaPlayerHandle>()
    const onModeChange = vi.fn()
    const stream = render(
      <MediaPlayer {...props({ ref: ref2, forceTranscode: true, onModeChange })} />
    )
    act(() => ref2.current?.seekToMs(40_000))
    expect(video(stream.container).getAttribute('src')).toBe(toTranscodeUrl(PATH, 40))
    expect(onModeChange).toHaveBeenLastCalledWith('transcode', 40_000)
  })

  it('applies speed and volume after metadata loads and reports the duration', () => {
    const onDuration = vi.fn()
    const { container } = render(<MediaPlayer {...props({ speed: 2.5, volume: 0.3, onDuration })} />)
    const el = video(container)
    fireEvent.loadedMetadata(el)
    expect(el.playbackRate).toBe(2.5)
    expect(el.volume).toBeCloseTo(0.3)
    expect(onDuration).toHaveBeenCalledWith(60_000)
  })

  it('autoplays once the metadata is ready, and forwards the wheel', () => {
    const onWheel = vi.fn()
    const { container } = render(<MediaPlayer {...props({ autoPlay: true, onWheel })} />)
    const el = video(container)
    fireEvent.loadedMetadata(el)
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
    fireEvent.wheel(el, { deltaY: -100 })
    expect(onWheel).toHaveBeenCalledTimes(1)
  })
})
