/**
 * Player state shared by Video Triage, Cutter and the crop dialog (ADR-004). The `<video>` element
 * itself lives in `MediaPlayer`; this is what the rest of the UI reads and commands.
 *
 * Timeline rule: `positionMs` is ALWAYS in the original file's timeline. In `transcode` mode the
 * element's `currentTime` restarts at 0 after every seek, so
 * `positionMs = transcodeOffsetMs + currentTime * 1000`; range handles and job times use it.
 */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { PlayerMode } from '../../components/MediaPlayer/types'

export type { PlayerMode }

/** Keys `1`-`5` (video-triage.md §3): 1, 2.5, 5, 7.5, 10. `Ctrl+1`-`5`: 1.25, 1.5, 1.75, 2, 2.25. */
export const SPEEDS = [1, 2.5, 5, 7.5, 10] as const
export const CTRL_SPEEDS = [1.25, 1.5, 1.75, 2, 2.25] as const
export const MIN_SPEED = 0.25
export const MAX_SPEED = 10

export interface PlayerState {
  path: string | null
  mode: PlayerMode
  /** Start offset of the current transcode stream, original timeline. 0 in direct mode. */
  transcodeOffsetMs: number
  positionMs: number
  durationMs: number
  playing: boolean
  /** 0.25..10 (keys 1-5, Ctrl+1-5). Survives item changes. */
  speed: number
  volume: number
  muted: boolean
  /** Last decode / load error of the current file (the player already tried the fallback). */
  error: string | null
}

const initialState: PlayerState = {
  path: null,
  mode: 'direct',
  transcodeOffsetMs: 0,
  positionMs: 0,
  durationMs: 0,
  playing: false,
  speed: 1,
  volume: 0.5,
  muted: false,
  error: null
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const playerSlice = createSlice({
  name: 'player',
  initialState,
  reducers: {
    /** A new file: resets position, mode and error but keeps volume and speed. */
    fileOpened(
      state,
      action: PayloadAction<{ path: string | null; durationMs?: number; forceTranscode?: boolean }>
    ) {
      state.path = action.payload.path
      state.mode = action.payload.forceTranscode === true ? 'transcode' : 'direct'
      state.transcodeOffsetMs = 0
      state.positionMs = 0
      state.durationMs = action.payload.durationMs ?? 0
      state.playing = false
      state.error = null
    },
    positionChanged(state, action: PayloadAction<number>) {
      state.positionMs = Math.max(0, Math.round(action.payload))
    },
    durationChanged(state, action: PayloadAction<number>) {
      state.durationMs = Math.max(0, Math.round(action.payload))
    },
    playingChanged(state, action: PayloadAction<boolean>) {
      state.playing = action.payload
    },
    speedSet(state, action: PayloadAction<number>) {
      state.speed = clamp(action.payload, MIN_SPEED, MAX_SPEED)
    },
    volumeSet(state, action: PayloadAction<number>) {
      state.volume = clamp(action.payload, 0, 1)
      if (state.volume > 0) state.muted = false
    },
    muteToggled(state) {
      state.muted = !state.muted
    },
    /** ADR-004 fallback: switch to `media://transcode/...?start=<offset>`. */
    transcodeStarted(state, action: PayloadAction<{ offsetMs: number }>) {
      state.mode = 'transcode'
      state.transcodeOffsetMs = Math.max(0, Math.round(action.payload.offsetMs))
      state.positionMs = state.transcodeOffsetMs
      state.error = null
    },
    /** A seek in transcode mode re-requests the stream from a new start. */
    transcodeSeeked(state, action: PayloadAction<{ offsetMs: number }>) {
      state.transcodeOffsetMs = Math.max(0, Math.round(action.payload.offsetMs))
      state.positionMs = state.transcodeOffsetMs
    },
    playerFailed(state, action: PayloadAction<string>) {
      state.error = action.payload
      state.playing = false
    }
  }
})

export const {
  fileOpened,
  positionChanged,
  durationChanged,
  playingChanged,
  speedSet,
  volumeSet,
  muteToggled,
  transcodeStarted,
  transcodeSeeked,
  playerFailed
} = playerSlice.actions
export default playerSlice.reducer
