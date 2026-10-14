/**
 * Crop dialog (`Ctrl+Shift+S`) and Zoom viewer (Options > Zoom) of Video Triage: grab the frame at
 * the playhead (`media:grabFrame`, source resolution, already auto-rotated), open the modal, and on
 * accept store the four `CropResult` fields as job overrides (video-triage.md §6; the host assigns
 * all four, null = neutral).
 */
import { useCallback, useState } from 'react'
import type { CropResult } from '@shared/domain/geometry'
import type { FrameRef } from '@shared/domain/media'
import { call } from '../../app/api'
import { useAppDispatch, useAppStore } from '../../app/hooks'
import { modalClosed, modalOpened } from '../../app/keymap/keymapSlice'
import { notify, notifyApiError } from '../../app/notifications/notify'
import { currentItem } from '../../app/triage/triageCore'
import type { CropDialogProps } from '../../components/CropDialog/types'
import { overridesPatched } from './videoTriageSlice'

export interface CropSession {
  frame: FrameRef
  initial: Partial<CropResult>
}

export interface FrameDialogs {
  crop: CropSession | null
  zoom: FrameRef | null
  startCrop: () => Promise<void>
  startZoom: () => Promise<void>
  acceptCrop: (result: CropResult) => void
  cancelCrop: () => void
  closeZoom: () => void
  detectBars: NonNullable<CropDialogProps['detectBars']>
}

export function useFrameDialogs(pause: () => void): FrameDialogs {
  const dispatch = useAppDispatch()
  const store = useAppStore()
  const [crop, setCrop] = useState<CropSession | null>(null)
  const [zoom, setZoom] = useState<FrameRef | null>(null)

  const grab = useCallback(async (): Promise<FrameRef | null> => {
    const state = store.getState()
    const item = currentItem(state.videoTriage)
    if (item === null) return null
    pause()
    try {
      return await call('media:grabFrame', { path: item.path, atMs: state.player.positionMs })
    } catch (error: unknown) {
      dispatch(notifyApiError(error, 'Grabbing the frame'))
      return null
    }
  }, [dispatch, pause, store])

  const startCrop = useCallback(async (): Promise<void> => {
    const frame = await grab()
    if (frame === null) return
    const { overrides } = store.getState().videoTriage.draft
    const initial: Partial<CropResult> = {
      crop: overrides.crop,
      bright: overrides.bright,
      contrast: overrides.contrast,
      transpose: overrides.transpose
    }
    if (overrides.crop === null) {
      try {
        initial.crop = await call('media:detectBlackBars', {
          path: frame.sourcePath,
          atMs: frame.atMs
        })
      } catch (error: unknown) {
        dispatch(notify('warning', 'Black-bar detection failed; draw the crop by hand'))
        console.warn('detectBlackBars failed', error)
      }
    }
    setCrop({ frame, initial })
    dispatch(modalOpened('crop'))
  }, [dispatch, grab, store])

  const startZoom = useCallback(async (): Promise<void> => {
    const frame = await grab()
    if (frame === null) return
    setZoom(frame)
    dispatch(modalOpened('zoom'))
  }, [dispatch, grab])

  const cancelCrop = useCallback((): void => {
    setCrop(null)
    dispatch(modalClosed('crop'))
  }, [dispatch])

  const acceptCrop = useCallback(
    (result: CropResult): void => {
      dispatch(
        overridesPatched({
          crop: result.crop,
          bright: result.bright,
          contrast: result.contrast,
          transpose: result.transpose
        })
      )
      setCrop(null)
      dispatch(modalClosed('crop'))
    },
    [dispatch]
  )

  const closeZoom = useCallback((): void => {
    setZoom(null)
    dispatch(modalClosed('zoom'))
  }, [dispatch])

  const detectBars = useCallback(
    () => {
      const frame = crop?.frame
      if (frame === undefined) return Promise.reject(new Error('No frame is open'))
      return call('media:detectBlackBars', { path: frame.sourcePath, atMs: frame.atMs })
    },
    [crop]
  )

  return { crop, zoom, startCrop, startZoom, acceptCrop, cancelCrop, closeZoom, detectBars }
}
