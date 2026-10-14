/**
 * MediaPlayer contract (ADR-004). Owner (wave 2): ui-video implements `MediaPlayer.tsx`.
 * Used by Video Triage, the Cutter and anything that previews a video.
 *
 * Source selection: `isDirectlyPlayable(info)` (`@shared/core/playability`) → `toMediaUrl(path)`;
 * otherwise (or after a `<video>` decode error, or `forceTranscode`) →
 * `toTranscodeUrl(path, startSec)`. Positions in props and callbacks are in the ORIGINAL timeline
 * (`./timeline.ts` maps the element's `currentTime`).
 */
import type { Ref } from 'react'
import type { MediaInfo } from '@shared/domain/media'

export type PlayerMode = 'direct' | 'transcode'

export interface MediaPlayerProps {
  /** Absolute path of the video. A path change resets the player (position 0). */
  path: string
  /** Probe result; `null` while probing (the player waits unless `forceTranscode`). */
  info: MediaInfo | null
  /** Start playing as soon as the media is ready (settings `player.startPaused` inverted). */
  autoPlay: boolean
  /** Start position, original timeline (e.g. resume after switching to transcode). */
  initialPositionMs?: number
  /** 1..10 (keys 1-5, Ctrl+1-5). */
  speed: number
  /** 0..1 */
  volume: number
  muted: boolean
  /** Force the transcode stream (legacy "player fallback"). */
  forceTranscode?: boolean
  /** ~15 Hz while playing and after every seek. Original timeline. */
  onPosition: (positionMs: number) => void
  onDuration?: (durationMs: number) => void
  onPlayingChange?: (playing: boolean) => void
  /** Called when the source switches (fallback or forced); `offsetMs` is the stream start. */
  onModeChange?: (mode: PlayerMode, offsetMs: number) => void
  /**
   * Decode failure that even the fallback could not recover. Shown by the screen. `log` is a
   * multi-line text for the toast's log dialog (element error, mode, probe summary).
   */
  onError?: (message: string, log?: string) => void
  onEnded?: () => void
  /** Mouse wheel over the video: `deltaY` sign follows the DOM event. The screen decides what it does. */
  onWheel?: (event: WheelEvent) => void
  /** Visual zoom 1..8 (default 1); a CSS transform, the source frame is untouched. */
  zoom?: number
  /** Pan as a fraction of the player box (see `@shared/core/videoZoom`). */
  pan?: { x: number; y: number }
  /** Left-button drag while zoomed in; the new, already clamped pan. */
  onPanChange?: (pan: { x: number; y: number }) => void
  /** Accessible name, default "Video player". */
  label?: string
  /** React 19 ref prop: the imperative handle. */
  ref?: Ref<MediaPlayerHandle>
}

export interface MediaPlayerHandle {
  play(): void
  pause(): void
  toggle(): void
  /** Original timeline. Direct: sets `currentTime`. Transcode: in-stream or restarts the stream. */
  seekToMs(positionMs: number): void
  seekByMs(deltaMs: number): void
  getPositionMs(): number
  /** For frame grabs of the visible frame; prefer `media:grabFrame` for source-resolution frames. */
  getVideoElement(): HTMLVideoElement | null
}
