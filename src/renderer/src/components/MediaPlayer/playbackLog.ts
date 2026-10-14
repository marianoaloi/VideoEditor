/** The text behind "The video could not be played": what the element reported and what is known. */
import type { MediaInfo } from '@shared/domain/media'
import { formatLog } from '../../app/notifications/errorLog'
import type { PlayerMode } from './types'

const MEDIA_ERROR_NAMES: Readonly<Record<number, string>> = {
  1: 'MEDIA_ERR_ABORTED (loading was aborted)',
  2: 'MEDIA_ERR_NETWORK (the stream broke while loading)',
  3: 'MEDIA_ERR_DECODE (the data could not be decoded)',
  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED (the format or codec is not supported)'
}

const NETWORK_STATES = ['EMPTY', 'IDLE', 'LOADING', 'NO_SOURCE'] as const

export interface PlaybackFailure {
  path: string
  info: MediaInfo | null
  video: HTMLVideoElement | null
  source: { mode: PlayerMode; url: string; offsetMs: number } | null
  /** The direct source failed first and the transcode stream was tried. */
  fallbackTried: boolean
  forceTranscode: boolean
}

export function playbackMessage(video: HTMLVideoElement | null): string {
  const message = video?.error?.message
  return message !== undefined && message !== '' ? message : 'The video could not be played'
}

function describeInfo(info: MediaInfo | null): Record<string, string | number | null> {
  if (info === null) return { 'Probe result': 'not available' }
  return {
    Container: info.container,
    'Video codec': info.videoCodec,
    'Pixel format': info.pixFmt,
    Size: info.hasVideo ? `${String(info.width)}x${String(info.height)}` : null,
    Rotation: info.rotation === 0 ? null : info.rotation,
    FPS: info.fps,
    'Audio codec': info.hasAudio ? info.audioCodec : 'none',
    'Duration (ms)': info.durationMs,
    'File size (bytes)': info.sizeBytes
  }
}

/** Multi-line log for the error toast. */
export function describePlaybackFailure(failure: PlaybackFailure): string {
  const { video, source } = failure
  const error = video?.error ?? null
  const code = error === null ? null : (MEDIA_ERROR_NAMES[error.code] ?? `code ${String(error.code)}`)
  return formatLog('Playback failed', {
    File: failure.path,
    'Player mode': source?.mode ?? null,
    'Source URL': source?.url ?? null,
    'Stream start (ms)': source === null || source.offsetMs === 0 ? null : source.offsetMs,
    'Transcode fallback tried': failure.fallbackTried ? 'yes, and it failed too' : 'no',
    'Forced transcode': failure.forceTranscode ? 'yes' : null,
    'Element error': code,
    'Element message': error?.message,
    'Ready state': video === null ? null : video.readyState,
    'Network state': video === null ? null : (NETWORK_STATES[video.networkState] ?? video.networkState),
    'Current time (s)': video === null ? null : Number(video.currentTime.toFixed(3)),
    ...describeInfo(failure.info)
  })
}
