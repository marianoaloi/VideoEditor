/**
 * HTML5 `<video>` on `media://` with the ADR-004 transcode fallback. Props and handle:
 * `./types.ts`. Positions in props, callbacks and the handle are ORIGINAL-timeline milliseconds;
 * `./timeline.ts` maps the element's `currentTime` (which restarts at 0 for every transcode stream).
 *
 * Source choice: `checkPlayback(info)` decides up front; a `<video>` decode error switches a direct
 * source to the transcode stream at the current position; `forceTranscode` (key `6`) does the same
 * on demand. Seeking inside a transcode stream either moves `currentTime` (already buffered) or
 * re-requests the stream from the target.
 */
import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import { checkPlayback } from '@shared/core/playability'
import { toMediaUrl, toTranscodeUrl } from '@shared/ipc/mediaUrl'
import { planTranscodeSeek, toElementSec, toOriginalMs } from './timeline'
import type { MediaPlayerProps, PlayerMode } from './types'

/** Position reports while playing, about 15 per second. */
const POSITION_INTERVAL_MS = 66

interface Source {
  mode: PlayerMode
  /** Start of the stream in the original timeline (0 for direct sources). */
  offsetMs: number
  url: string
}

function directSource(path: string): Source {
  return { mode: 'direct', offsetMs: 0, url: toMediaUrl(path) }
}

function transcodeSource(path: string, offsetMs: number): Source {
  return { mode: 'transcode', offsetMs, url: toTranscodeUrl(path, offsetMs / 1000) }
}

function bufferedEndSec(video: HTMLVideoElement): number {
  const ranges = video.buffered
  return ranges.length > 0 ? ranges.end(ranges.length - 1) : 0
}

function describeError(video: HTMLVideoElement | null): string {
  const message = video?.error?.message
  return message !== undefined && message !== '' ? message : 'The video could not be played'
}

export function MediaPlayer(props: MediaPlayerProps) {
  const { path, info, speed, volume, muted, forceTranscode = false, label, ref } = props
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [source, setSource] = useState<Source | null>(null)
  const [playing, setPlaying] = useState(false)

  // Latest props for the stable handlers below (no stale closures, no re-subscribing).
  const latest = useRef(props)
  latest.current = props
  const sourceRef = useRef<Source | null>(null)
  sourceRef.current = source
  const positionRef = useRef(0)
  const wantPlayRef = useRef(props.autoPlay)
  const fallbackTriedRef = useRef(false)
  const pendingSeekRef = useRef<number | null>(null)
  const lastPathRef = useRef<string | null>(null)

  const hasInfo = info !== null
  const direct = info === null ? null : checkPlayback(info).direct

  const emitPosition = (): void => {
    const video = videoRef.current
    const src = sourceRef.current
    if (video === null || src === null) return
    const ms = toOriginalMs(src.offsetMs, video.currentTime)
    positionRef.current = ms
    latest.current.onPosition(ms)
  }

  const reportDuration = (): void => {
    const video = videoRef.current
    const fromElement = video !== null && Number.isFinite(video.duration) ? video.duration * 1000 : 0
    const fromProbe = latest.current.info?.durationMs ?? 0
    const ms = sourceRef.current?.mode === 'transcode' ? fromProbe || fromElement : fromElement || fromProbe
    if (ms > 0) latest.current.onDuration?.(Math.round(ms))
  }

  // ---- source selection ---------------------------------------------------------------------
  useEffect(() => {
    if (lastPathRef.current !== path) {
      lastPathRef.current = path
      positionRef.current = Math.max(0, latest.current.initialPositionMs ?? 0)
      wantPlayRef.current = latest.current.autoPlay
      fallbackTriedRef.current = false
      pendingSeekRef.current = null
      setPlaying(false)
    } else {
      wantPlayRef.current = wantPlayRef.current || playing
    }
    const start = positionRef.current
    if (forceTranscode || direct === false) {
      setSource(transcodeSource(path, start))
    } else if (direct === true) {
      setSource(directSource(path))
      pendingSeekRef.current = start > 0 ? start : null
    } else {
      setSource(null)
    }
    // `playing` is read, not a trigger: switching sources must not restart on every pause/play.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, hasInfo, direct, forceTranscode])

  useEffect(() => {
    if (source !== null) latest.current.onModeChange?.(source.mode, source.offsetMs)
  }, [source])

  // ---- element settings (re-applied after every load: the element resets them) --------------
  const applySettings = (): void => {
    const video = videoRef.current
    if (video === null) return
    video.playbackRate = latest.current.speed
    video.preservesPitch = true
    video.volume = Math.min(1, Math.max(0, latest.current.volume))
    video.muted = latest.current.muted
  }
  useEffect(applySettings, [speed, volume, muted, source])

  // ---- position ticks while playing ---------------------------------------------------------
  useEffect(() => {
    if (!playing) return undefined
    const timer = setInterval(emitPosition, POSITION_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [playing])

  // ---- wheel (the screen decides what it means) ---------------------------------------------
  useEffect(() => {
    const video = videoRef.current
    if (video === null) return undefined
    const onWheel = (event: WheelEvent): void => {
      const handler = latest.current.onWheel
      if (handler === undefined) return
      event.preventDefault()
      handler(event)
    }
    video.addEventListener('wheel', onWheel, { passive: false })
    return () => video.removeEventListener('wheel', onWheel)
  }, [])

  // ---- imperative handle --------------------------------------------------------------------
  const play = (): void => {
    const video = videoRef.current
    if (video === null) return
    wantPlayRef.current = true
    const result = video.play() as Promise<void> | undefined
    result?.catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return
      latest.current.onError?.(error instanceof Error ? error.message : 'Playback was refused')
    })
  }
  const pause = (): void => {
    wantPlayRef.current = false
    videoRef.current?.pause()
  }
  const seekToMs = (ms: number): void => {
    const target = Math.max(0, Math.round(ms))
    const video = videoRef.current
    const src = sourceRef.current
    positionRef.current = target
    if (video === null || src === null) {
      pendingSeekRef.current = target
      latest.current.onPosition(target)
      return
    }
    if (src.mode === 'direct') {
      video.currentTime = toElementSec(0, target)
    } else {
      const plan = planTranscodeSeek(src.offsetMs, target, bufferedEndSec(video))
      if (plan.kind === 'in-stream') video.currentTime = plan.currentTimeSec
      else {
        wantPlayRef.current = !video.paused || wantPlayRef.current
        setSource(transcodeSource(latest.current.path, plan.offsetMs))
      }
    }
    latest.current.onPosition(target)
  }
  useImperativeHandle(ref, () => ({
    play,
    pause,
    toggle: () => {
      const video = videoRef.current
      if (video === null || video.paused) play()
      else pause()
    },
    seekToMs,
    seekByMs: (deltaMs: number) => seekToMs(positionRef.current + deltaMs),
    getPositionMs: () => positionRef.current,
    getVideoElement: () => videoRef.current
  }))

  // ---- element events -----------------------------------------------------------------------
  const handleLoadedMetadata = (): void => {
    applySettings()
    const video = videoRef.current
    const pending = pendingSeekRef.current
    if (video !== null && pending !== null && sourceRef.current?.mode === 'direct') {
      video.currentTime = toElementSec(0, pending)
    }
    pendingSeekRef.current = null
    reportDuration()
    emitPosition()
    if (wantPlayRef.current) play()
  }

  const handleError = (): void => {
    const video = videoRef.current
    const src = sourceRef.current
    if (src !== null && src.mode === 'direct' && !fallbackTriedRef.current) {
      fallbackTriedRef.current = true
      const at = video === null ? positionRef.current : toOriginalMs(0, video.currentTime)
      wantPlayRef.current = wantPlayRef.current || (video !== null && !video.paused)
      positionRef.current = at
      setSource(transcodeSource(latest.current.path, at))
      return
    }
    latest.current.onError?.(describeError(video))
  }

  return (
    <video
      ref={videoRef}
      src={source?.url}
      aria-label={label ?? 'Video player'}
      preload="auto"
      playsInline
      style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
      onLoadedMetadata={handleLoadedMetadata}
      onDurationChange={reportDuration}
      onTimeUpdate={emitPosition}
      onSeeked={emitPosition}
      onPlay={() => {
        setPlaying(true)
        latest.current.onPlayingChange?.(true)
      }}
      onPause={() => {
        setPlaying(false)
        latest.current.onPlayingChange?.(false)
      }}
      onEnded={() => latest.current.onEnded?.()}
      onError={handleError}
    />
  )
}

export default MediaPlayer
