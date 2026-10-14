import { useCallback, useMemo, useState, type RefObject } from 'react'
import type { CropResult, Rect } from '@shared/domain/geometry'
import type { FrameRef } from '@shared/domain/media'
import { call } from '../../app/api'
import { useAppDispatch, useAppStore } from '../../app/hooks'
import { notify } from '../../app/notifications/notify'
import type { CropDialogProps } from '../../components/CropDialog/types'
import type { MediaPlayerHandle } from '../../components/MediaPlayer/types'
import { editorApplied, overridesPatched } from './cutterSlice'

export interface CropFlow {
  /** Ctrl+Shift+S: pause, grab the frame at the playhead, open the dialog. */
  start(): Promise<void>
  /** Props for `<CropDialog/>`; `null` while it is closed. */
  dialogProps: CropDialogProps | null
}

/**
 * Crop dialog host (MyVideos `actionCropVideoMet` + `croppedVideo`). The dialog is built from
 * the current frame every time (D43); an accepted result is assigned whole, so a neutral field
 * clears the earlier value (D35). With no ranges yet, one `[0, duration]` range is created.
 */
export function useCropFlow(playerRef: RefObject<MediaPlayerHandle | null>): CropFlow {
  const dispatch = useAppDispatch()
  const store = useAppStore()
  const [frame, setFrame] = useState<FrameRef | null>(null)

  const start = useCallback(async () => {
    const { videoPath } = store.getState().cutter
    if (videoPath === null) return
    playerRef.current?.pause()
    const atMs = Math.round(playerRef.current?.getPositionMs() ?? store.getState().player.positionMs)
    try {
      setFrame(await call('media:grabFrame', { path: videoPath, atMs, format: 'png' }))
    } catch (error: unknown) {
      dispatch(notify('error', 'No can get a THUMB to work', { detail: String(error) }))
    }
  }, [dispatch, store, playerRef])

  const accept = useCallback(
    (result: CropResult) => {
      dispatch(overridesPatched({ ...result }))
      const { draft } = store.getState().cutter
      const duration = store.getState().player.durationMs
      if (draft.ranges.length === 0 && duration > 0) {
        dispatch(editorApplied({ ranges: [[0, duration]], pendingStartMs: null }))
      }
      setFrame(null)
    },
    [dispatch, store]
  )

  const dialogProps = useMemo<CropDialogProps | null>(() => {
    if (frame === null) return null
    const { overrides } = store.getState().cutter.draft
    const path = frame.sourcePath
    return {
      open: true,
      mode: 'video',
      image: { url: frame.url, width: frame.width, height: frame.height },
      title: path.split(/[\\/]/).pop() ?? path,
      initial: {
        crop: overrides.crop,
        bright: overrides.bright,
        contrast: overrides.contrast,
        transpose: overrides.transpose
      },
      detectBars: (): Promise<Rect> => call('media:detectBlackBars', { path, atMs: frame.atMs }),
      onAccept: accept,
      onCancel: () => setFrame(null)
    }
  }, [frame, accept, store])

  return { start, dialogProps }
}
