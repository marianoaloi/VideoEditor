import { useMemo, type RefObject } from 'react'
import { ProcessingMode, type Range } from '@shared/domain/job'
import {
  appendToEnd,
  markRange,
  removeRange,
  replaceRange,
  seekTarget,
  typedPosition,
  type EditorResult,
  type EditorState
} from '@shared/core/rangeEditor'
import { splitRanges } from '@shared/core/splitRanges'
import { call } from '../../app/api'
import { useAppDispatch, useAppStore } from '../../app/hooks'
import { notify } from '../../app/notifications/notify'
import { positionChanged, volumeSet } from '../../app/player/playerSlice'
import type { MediaPlayerHandle } from '../../components/MediaPlayer/types'
import { volumeDownPercent, volumeUpPercent, VOLUME_END_KEY_PERCENT } from './cutterMath'
import {
  cutterClosed,
  editorApplied,
  modeSet,
  openCutterVideo,
  processOpened,
  reloadCutterTimes,
  saveCutterJob,
  selectedSet,
  type OpenCutterArg
} from './cutterSlice'

export interface CutterActions {
  open(arg: string | OpenCutterArg): void
  openDialog(): Promise<void>
  togglePlay(): void
  seekTo(ms: number): void
  seekBy(deltaMs: number): void
  seekTyped(valueMs: number | null): void
  setPendingStart(valueMs: number | null): void
  mark(): void
  removeAt(index: number): void
  editAt(index: number, range: Range): void
  split(parts: number): void
  present(mode: ProcessingMode, toEnd: boolean): Promise<void>
  save(): Promise<void>
  loadTimes(): Promise<void>
  volumeBy(direction: 1 | -1): void
  volumeEndKey(): void
  externalPlayer(): Promise<void>
  close(): void
}

const VIDEO_EXTENSIONS = ['mp4', 'avi', 'm4v', '3gp', 'wmv', 'mkv', 'mpv', 'mov', 'webm']

const toEditor = (draft: { ranges: Range[]; pendingStartMs: number | null }): EditorState => ({
  ranges: draft.ranges,
  pendingStartMs: draft.pendingStartMs
})

/** Every Cutter command, reading live state at call time (never a stale render closure). */
export function useCutterActions(playerRef: RefObject<MediaPlayerHandle | null>): CutterActions {
  const dispatch = useAppDispatch()
  const store = useAppStore()

  return useMemo<CutterActions>(() => {
    const state = () => store.getState()
    const duration = () => state().player.durationMs
    const position = () => playerRef.current?.getPositionMs() ?? state().player.positionMs
    const say = (severity: 'info' | 'warning' | 'error', message: string) =>
      dispatch(notify(severity, message))

    const seekTo = (ms: number) => {
      const target = seekTarget(ms, 0, duration())
      playerRef.current?.seekToMs(target)
      dispatch(positionChanged(target))
    }
    const apply = (result: EditorResult): boolean => {
      if (!result.ok) {
        say('warning', result.message)
        return false
      }
      dispatch(editorApplied(result.state))
      return true
    }
    const editor = () => toEditor(state().cutter.draft)
    const percent = () => Math.round(state().player.volume * 100)
    const setPercent = (value: number) => dispatch(volumeSet(value / 100))

    const save = async () => {
      if (state().cutter.videoPath === null) return
      const result = await dispatch(saveCutterJob())
      if (saveCutterJob.fulfilled.match(result)) dispatch(notify('success', 'Job saved'))
    }

    const open = (arg: string | OpenCutterArg) => {
      setPercent(Math.round((state().settings.value?.player.volume ?? 0.5) * 100))
      void dispatch(openCutterVideo(arg))
    }

    return {
      open,
      openDialog: async () => {
        try {
          const picked = await call('app:openFilesDialog', {
            title: 'Open Video',
            multi: false,
            filters: [{ name: 'Video Files', extensions: VIDEO_EXTENSIONS }]
          })
          const path = picked.paths[0]
          if (!picked.canceled && path !== undefined) open(path)
        } catch (error: unknown) {
          say('error', `Could not open the file dialog: ${String(error)}`)
        }
      },
      togglePlay: () => playerRef.current?.toggle(),
      seekTo,
      seekBy: (deltaMs) => seekTo(seekTarget(position(), deltaMs, duration())),
      seekTyped: (valueMs) => {
        const target = typedPosition(valueMs, duration())
        if (target === null) say('warning', 'That time is outside the video')
        else seekTo(target)
      },
      setPendingStart: (valueMs) => {
        const target = typedPosition(valueMs, duration())
        if (target === null) {
          say('warning', 'That time is outside the video')
          return
        }
        dispatch(editorApplied({ ...editor(), pendingStartMs: target }))
        seekTo(target)
      },
      mark: () => {
        apply(markRange(editor(), position(), duration()))
      },
      removeAt: (index) => {
        const { state: next, seekMs } = removeRange(editor(), index)
        dispatch(editorApplied(next))
        if (seekMs !== null) seekTo(seekMs)
      },
      editAt: (index, range) => {
        apply(replaceRange(editor(), index, range, duration()))
      },
      split: (parts) => {
        const { low, high } = state().cutter.draft
        const span = high > low ? { start: low, end: high } : { start: 0, end: duration() }
        const result = splitRanges(span.start, span.end, parts)
        if (!result.ok) {
          say('warning', result.message)
          return
        }
        dispatch(editorApplied({ ranges: result.ranges, pendingStartMs: null }))
        dispatch(selectedSet(null))
      },
      present: async (mode, toEnd) => {
        playerRef.current?.pause()
        if (toEnd && !apply(appendToEnd(editor(), position(), duration()))) return
        if (state().cutter.draft.ranges.length === 0) {
          say('warning', 'Add at least one range (X)')
          return
        }
        dispatch(modeSet(mode))
        const result = await dispatch(saveCutterJob())
        if (saveCutterJob.fulfilled.match(result)) dispatch(processOpened(null))
      },
      save,
      loadTimes: async () => {
        const result = await dispatch(reloadCutterTimes())
        if (reloadCutterTimes.fulfilled.match(result) && result.payload.job === null) {
          say('info', 'There is no saved job for this video')
        }
      },
      volumeBy: (direction) => {
        setPercent(direction === 1 ? volumeUpPercent(percent()) : volumeDownPercent(percent()))
      },
      volumeEndKey: () => setPercent(VOLUME_END_KEY_PERCENT),
      externalPlayer: async () => {
        playerRef.current?.pause()
        const file = state().cutter.videoPath
        if (file === null) return
        try {
          const started = await call('hooks:run', { name: 'externalPlayer', context: { file } })
          if (started.skipped) say('info', 'External player hook is not configured')
        } catch (error: unknown) {
          say('error', `External player failed: ${String(error)}`)
        }
      },
      close: () => {
        playerRef.current?.pause()
        dispatch(cutterClosed())
      }
    }
  }, [dispatch, store, playerRef])
}
