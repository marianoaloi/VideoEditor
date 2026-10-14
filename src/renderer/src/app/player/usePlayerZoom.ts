/** Zoom/pan commands over the shared player slice (Video Triage and Cutter). */
import { useMemo } from 'react'
import { zoomIn, zoomOut, type Pan } from '@shared/core/videoZoom'
import { useAppDispatch, useAppSelector } from '../hooks'
import { panChanged, zoomChanged, zoomReset } from './playerSlice'

export interface ZoomControls {
  zoom: number
  pan: Pan
  zoomIn(): void
  zoomOut(): void
  zoomReset(): void
  onPanChange(pan: Pan): void
}

export function usePlayerZoom(): ZoomControls {
  const dispatch = useAppDispatch()
  const zoom = useAppSelector((s) => s.player.zoom)
  const panX = useAppSelector((s) => s.player.panX)
  const panY = useAppSelector((s) => s.player.panY)
  return useMemo(
    () => ({
      zoom,
      pan: { x: panX, y: panY },
      zoomIn: () => dispatch(zoomChanged(zoomIn(zoom))),
      zoomOut: () => dispatch(zoomChanged(zoomOut(zoom))),
      zoomReset: () => dispatch(zoomReset()),
      onPanChange: (pan: Pan) => dispatch(panChanged(pan))
    }),
    [dispatch, zoom, panX, panY]
  )
}
