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

  it('the error comes with a log: element error, mode, source and the probe summary', () => {
    const onError = vi.fn()
    const { container } = render(<MediaPlayer {...props({ onError })} />)
    const el = video(container)
    // The first error switches to the transcode stream, the second one is final.
    Object.defineProperty(el, 'error', {
      value: { code: 3, message: 'PIPELINE_ERROR_DECODE' },
      configurable: true
    })
    fireEvent.error(el)
    expect(onError).not.toHaveBeenCalled()
    fireEvent.error(el)

    expect(onError).toHaveBeenCalledTimes(1)
    const [message, log] = onError.mock.calls[0] as [string, string]
    expect(message).toBe('PIPELINE_ERROR_DECODE')
    expect(log).toContain('Playback failed')
    expect(log).toContain(`File: ${PATH}`)
    expect(log).toContain('Player mode: transcode')
    expect(log).toContain('Transcode fallback tried: yes, and it failed too')
    expect(log).toContain('Element error: MEDIA_ERR_DECODE')
    expect(log).toContain('Element message: PIPELINE_ERROR_DECODE')
    expect(log).toContain('Video codec: h264')
    expect(log).toContain('Size: 640x360')
  })

  it('the log still reads well without a probe result and without an element error', () => {
    const onError = vi.fn()
    const { container } = render(
      <MediaPlayer {...props({ onError, info: null, forceTranscode: true })} />
    )
    fireEvent.error(video(container))
    const [message, log] = onError.mock.calls[0] as [string, string]
    expect(message).toBe('The video could not be played')
    expect(log).toContain('Probe result: not available')
    expect(log).toContain('Forced transcode: yes')
    expect(log).not.toContain('Element error')
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
    const { container } = render(
      <MediaPlayer {...props({ speed: 2.5, volume: 0.3, onDuration })} />
    )
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

  describe('zoom', () => {
    it('applies the transform and shows the badge only when zoomed', () => {
      const { container, queryByTestId, rerender } = render(<MediaPlayer {...props()} />)
      expect(video(container).style.transform).toBe('')
      expect(queryByTestId('zoom-badge')).toBeNull()
      rerender(<MediaPlayer {...props({ zoom: 2.5, pan: { x: 0.25, y: -0.5 } })} />)
      expect(video(container).style.transform).toBe('translate(25%, -50%) scale(2.5)')
      expect(queryByTestId('zoom-badge')).toHaveTextContent('250 %')
    })

    it('clamps a pan that would leave gutters', () => {
      const { container } = render(<MediaPlayer {...props({ zoom: 2, pan: { x: 5, y: -5 } })} />)
      expect(video(container).style.transform).toBe('translate(50%, -50%) scale(2)')
    })

    it('drags to pan with clamped fractions, and not at zoom 1', () => {
      const onPanChange = vi.fn()
      const { getByTestId, rerender } = render(<MediaPlayer {...props({ onPanChange })} />)
      const box = getByTestId('player-zoom-box')
      vi.spyOn(box, 'getBoundingClientRect').mockReturnValue({ width: 400, height: 200 } as DOMRect)
      fireEvent.pointerDown(box, { button: 0, clientX: 100, clientY: 100 })
      fireEvent.pointerMove(box, { clientX: 140, clientY: 100 })
      expect(onPanChange).not.toHaveBeenCalled()
      rerender(<MediaPlayer {...props({ onPanChange, zoom: 2 })} />)
      fireEvent.pointerDown(box, { button: 0, clientX: 100, clientY: 100 })
      fireEvent.pointerMove(box, { clientX: 140, clientY: 120 })
      expect(onPanChange).toHaveBeenLastCalledWith({ x: 0.1, y: 0.1 })
      fireEvent.pointerUp(box)
      fireEvent.pointerMove(box, { clientX: 300, clientY: 120 })
      expect(onPanChange).toHaveBeenCalledTimes(1)
    })
  })
})
