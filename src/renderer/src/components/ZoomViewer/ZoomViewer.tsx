/**
 * ZoomViewer (recognition ZoomScreem without the AI parts, cutter-crop-zoom.md 6): full-window
 * picture at 100 %, zoom by wheel / slider / keys, drag to pan, view-only brightness, contrast and
 * rotation (never saved). Closing (Esc, Ctrl+S, Ctrl+Shift+S, the X button, a click outside)
 * always reports `onClose`. Modal keymap scope `zoom`.
 */
import { useCallback, useEffect, useState, type WheelEvent } from 'react'
import CloseIcon from '@mui/icons-material/Close'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import IconButton from '@mui/material/IconButton'
import Slider from '@mui/material/Slider'
import Typography from '@mui/material/Typography'
import { NEUTRAL_SLIDERS, type SliderValues } from '@shared/core/adjustments'
import {
  ZOOM_SLIDER_MAX,
  ZOOM_SLIDER_MIN,
  clampPan,
  clampZoom,
  formatZoom,
  panForZoomAbout,
  sliderFromZoom,
  wheelZoom,
  zoomFromSlider,
  zoomToFit,
  type Pan
} from '@shared/core/zoomMath'
import { useAppDispatch } from '../../app/hooks'
import { modalClosed, modalOpened } from '../../app/keymap/keymapSlice'
import type { KeyBinding } from '../../app/keymap/types'
import { useKeymap } from '../../app/keymap/useKeymap'
import CropSliders from '../CropDialog/CropSliders'
import { useElementSize, useLoadedImage } from '../CropDialog/hooks'
import ZoomCanvas from './ZoomCanvas'
import type { ZoomViewerProps } from './types'

const FALLBACK_VIEWPORT = { width: 900, height: 560 }

interface View {
  scale: number
  pan: Pan
}

function centred(width: number, height: number, scale: number, viewport = FALLBACK_VIEWPORT): View {
  const pan = clampPan({ x: 0, y: 0 }, { width, height }, scale, viewport)
  return { scale, pan }
}

export default function ZoomViewer({ open, imageUrl, width, height, title, onClose }: ZoomViewerProps) {
  const dispatch = useAppDispatch()
  const { ref, size } = useElementSize<HTMLDivElement>()
  const viewport = size ?? FALLBACK_VIEWPORT
  const loaded = useLoadedImage(open ? imageUrl : null)
  const natural = { width, height }
  const [view, setView] = useState<View>(() => centred(width, height, 1))
  const [sliders, setSliders] = useState<SliderValues>(NEUTRAL_SLIDERS)

  useEffect(() => {
    if (!open) return
    setView(centred(width, height, 1, viewport))
    setSliders(NEUTRAL_SLIDERS)
    // Reset only when another picture is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, imageUrl])

  useEffect(() => {
    if (!open) return undefined
    dispatch(modalOpened('zoom'))
    return () => {
      dispatch(modalClosed('zoom'))
    }
  }, [open, dispatch])

  const zoomTo = useCallback(
    (next: number) => {
      const scale = clampZoom(next)
      const centre = { x: viewport.width / 2, y: viewport.height / 2 }
      setView((v) => ({
        scale,
        pan: clampPan(panForZoomAbout(v.pan, centre, v.scale, scale), natural, scale, viewport)
      }))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewport.width, viewport.height, width, height]
  )
  const fit = useCallback(() => {
    setView(centred(width, height, zoomToFit(natural, viewport), viewport))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, viewport.width, viewport.height])

  const bindings: KeyBinding[] = [
    { id: 'zoom.close', keys: ['Escape', 'Ctrl+S', 'Ctrl+Shift+S'], description: 'Close the viewer', allowInInput: true, run: onClose },
    { id: 'zoom.in', keys: ['Plus'], description: 'Zoom in', allowRepeat: true, run: () => zoomTo(view.scale * 1.1) },
    { id: 'zoom.out', keys: ['Minus'], description: 'Zoom out', allowRepeat: true, run: () => zoomTo(view.scale * 0.9) },
    { id: 'zoom.actual', keys: ['1'], description: 'Zoom to 100 %', run: () => zoomTo(1) },
    { id: 'zoom.fit', keys: ['F'], description: 'Fit the picture to the window', run: fit }
  ]
  useKeymap('zoom', bindings, { enabled: open })

  const onLabelWheel = (event: WheelEvent<HTMLElement>): void => {
    zoomTo(wheelZoom(view.scale, event.deltaY))
  }

  return (
    <Dialog open={open} onClose={(_, reason) => reason !== 'escapeKeyDown' && onClose()} fullScreen aria-labelledby="zoom-dialog-title">
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'background.default' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 0.5, gap: 1 }}>
          <Typography id="zoom-dialog-title" variant="subtitle1" noWrap sx={{ flex: 1 }}>
            {title ?? 'Zoom'}
          </Typography>
          <IconButton aria-label="Close" onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
        <Box ref={ref} sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <ZoomCanvas
            image={loaded.image}
            natural={natural}
            viewport={viewport}
            scale={view.scale}
            pan={view.pan}
            rotation={sliders.rotation}
            adjust={{ bright: sliders.brightness / 255, contrast: sliders.contrast / 100 }}
            onView={(scale, pan) => setView({ scale, pan })}
          />
        </Box>
        <CropSliders values={sliders} rotationStep={1} onChange={setSliders} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1 }}>
          <Typography
            component="span"
            data-testid="zoom-label"
            onWheel={onLabelWheel}
            onDoubleClick={() => zoomTo(1)}
            sx={{ bgcolor: 'secondary.light', color: 'secondary.contrastText', px: 1, borderRadius: 1, minWidth: 90, textAlign: 'center', userSelect: 'none' }}
          >
            {formatZoom(view.scale)}
          </Typography>
          <Slider
            size="small"
            aria-label="Zoom"
            sx={{ flex: 1 }}
            min={ZOOM_SLIDER_MIN}
            max={ZOOM_SLIDER_MAX}
            step={5}
            value={sliderFromZoom(view.scale)}
            onChange={(_, v) => zoomTo(zoomFromSlider(Array.isArray(v) ? (v[0] ?? 100) : v))}
            onDoubleClick={() => zoomTo(1)}
          />
          <Button size="small" onClick={() => zoomTo(1)}>
            100 % [1]
          </Button>
          <Button size="small" onClick={fit}>
            Fit [F]
          </Button>
        </Box>
      </Box>
    </Dialog>
  )
}
