/**
 * CropDialog (CroppMedia, cutter-crop-zoom.md 3): rubber band + brightness / contrast / rotation
 * preview over the picture. Contract in `types.ts`; geometry in `@shared/core/cropMath`, slider
 * mapping in `@shared/core/adjustments`. Modal keymap scope `crop`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import { buildCropResult, slidersFromResult, snapToQuarterTurns, type SliderValues } from '@shared/core/adjustments'
import {
  displayedSize,
  displayedToSource,
  fitScale,
  horizontalDefaultRect,
  sourceToDisplayed,
  verticalDefaultRect,
  viewToImageRect,
  type FloatRect
} from '@shared/core/cropMath'
import { clampRect, isNeutralCropResult, type Rect, type Size } from '@shared/domain/geometry'
import { useAppDispatch } from '../../app/hooks'
import { modalClosed, modalOpened } from '../../app/keymap/keymapSlice'
import type { KeyBinding } from '../../app/keymap/types'
import { useKeymap } from '../../app/keymap/useKeymap'
import { useNotify } from '../../app/notifications/notify'
import CropSliders from './CropSliders'
import CropStage from './CropStage'
import { moveSelection, pressSelection, releaseSelection, type SelectionModel } from './selection'
import type { CropDialogProps, CropResult } from './types'
import { useElementSize, useLoadedImage } from './hooks'

const FALLBACK_BOX: Size = { width: 800, height: 500 }

function toFloat(rect: Rect): FloatRect {
  return { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
}

/** Keeps the band on the same part of the picture when the preview rotation changes. */
function remapSelection(rect: FloatRect | null, source: Size, from: number, to: number): FloatRect | null {
  if (rect === null) return null
  const back = displayedToSource(rect, source, from)
  return toFloat(sourceToDisplayed(back, source, to))
}

interface CropState {
  sliders: SliderValues
  selection: SelectionModel
}

function useCropState(props: CropDialogProps) {
  const { image, initial, mode, open } = props
  const source: Size = useMemo(() => ({ width: image.width, height: image.height }), [image.width, image.height])
  const [state, setState] = useState<CropState>(() => seed())

  function seed(): CropState {
    const sliders = slidersFromResult(initial)
    const rotation = mode === 'video' ? snapToQuarterTurns(sliders.rotation) : sliders.rotation
    const crop = initial?.crop ?? null
    const rect = crop === null ? null : toFloat(sourceToDisplayed(crop, source, rotation))
    return { sliders: { ...sliders, rotation }, selection: { rect, drag: null } }
  }

  useEffect(() => {
    if (open) setState(seed())
    // Re-seed only when the dialog opens for another image.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, image.url])

  const setSliders = useCallback(
    (next: SliderValues) => {
      setState((current) => ({
        sliders: next,
        selection: {
          ...current.selection,
          rect: remapSelection(current.selection.rect, source, current.sliders.rotation, next.rotation)
        }
      }))
    },
    [source]
  )
  const setSelection = useCallback((next: SelectionModel | ((m: SelectionModel) => SelectionModel)) => {
    setState((current) => ({
      ...current,
      selection: typeof next === 'function' ? next(current.selection) : next
    }))
  }, [])
  return { state, source, setSliders, setSelection }
}

export default function CropDialog(props: CropDialogProps) {
  const { open, image, mode, title, detectBars, onAccept, onCancel } = props
  const dispatch = useAppDispatch()
  const notify = useNotify()
  const { state, source, setSliders, setSelection } = useCropState(props)
  const { ref: areaRef, size: measured } = useElementSize<HTMLDivElement>()
  const loaded = useLoadedImage(open ? image.url : null)
  const { sliders, selection } = state
  const display = displayedSize(source, sliders.rotation)
  const box = measured ?? FALLBACK_BOX
  const scale = fitScale(display, { width: box.width - 16, height: box.height - 16 })

  useEffect(() => {
    if (!open) return undefined
    dispatch(modalOpened('crop'))
    return () => {
      dispatch(modalClosed('crop'))
    }
  }, [open, dispatch])

  const finish = useCallback(
    (rect: FloatRect | null) => {
      const crop: Rect | null =
        rect === null
          ? null
          : clampRect(displayedToSource(viewToImageRect(rect, 1, display), source, sliders.rotation), source)
      const result: CropResult = buildCropResult(crop, sliders)
      if (isNeutralCropResult(result)) onCancel()
      else onAccept(result)
    },
    [display, source, sliders, onAccept, onCancel]
  )
  const accept = useCallback(() => finish(selection.rect), [finish, selection.rect])
  const applyDefault = useCallback(
    (make: typeof verticalDefaultRect) => {
      finish(toFloat(make(display, selection.rect)))
    },
    [display, selection.rect, finish]
  )
  const strip = useCallback(async () => {
    if (detectBars === undefined) return
    try {
      const bars = await detectBars()
      const rect = toFloat(sourceToDisplayed(bars, source, sliders.rotation))
      setSelection({ rect, drag: null })
    } catch (error: unknown) {
      notify.apiError(error, 'Strip Image')
    }
  }, [detectBars, source, sliders.rotation, setSelection, notify])

  const bindings: KeyBinding[] = [
    { id: 'crop.apply', keys: ['Ctrl+Shift+S', 'Ctrl+Alt+X', 'Enter'], description: 'Apply the crop and adjustments', allowInInput: true, run: accept },
    { id: 'crop.cancel', keys: ['Escape'], description: 'Cancel without a change', allowInInput: true, run: onCancel },
    { id: 'crop.strip', keys: ['Ctrl+Shift+D'], description: 'Strip Image: select the picture area', enabled: detectBars !== undefined, allowInInput: true, run: () => void strip() },
    { id: 'crop.vertical', keys: ['Ctrl+Shift+A'], description: 'Vertical Default: full height, then apply', allowInInput: true, run: () => applyDefault(verticalDefaultRect) },
    { id: 'crop.horizontal', keys: ['Ctrl+Shift+F'], description: 'Horizontal Default: full width, then apply', allowInInput: true, run: () => applyDefault(horizontalDefaultRect) }
  ]
  useKeymap('crop', bindings, { enabled: open })

  const rotationStep = mode === 'video' ? 90 : 1
  return (
    <Dialog open={open} onClose={(_, reason) => reason !== 'escapeKeyDown' && onCancel()} maxWidth={false} aria-labelledby="crop-dialog-title">
      <Box sx={{ width: '92vw', height: '88vh', display: 'flex', flexDirection: 'column' }}>
        <DialogTitle id="crop-dialog-title" sx={{ pb: 1 }}>{title === undefined ? 'Crop' : `Cut ${title}`}</DialogTitle>
        <CropSliders values={sliders} rotationStep={rotationStep} onChange={setSliders} />
        <DialogContent ref={areaRef} sx={{ flex: 1, minHeight: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', bgcolor: 'action.hover' }}>
          <CropStage
            image={loaded.image}
            source={source}
            rotation={sliders.rotation}
            adjust={{ bright: sliders.brightness / 255, contrast: sliders.contrast / 100 }}
            scale={scale}
            selection={selection.rect}
            onPress={(p) => setSelection((m) => pressSelection(m, p, scale))}
            onMove={(p) => setSelection((m) => moveSelection(m, p, scale, display))}
            onRelease={() => setSelection(releaseSelection)}
          />
        </DialogContent>
        {loaded.error && (
          <Typography color="error" sx={{ px: 3 }}>
            The picture could not be loaded.
          </Typography>
        )}
        {mode === 'image' && (
          <Typography variant="caption" color="text.secondary" sx={{ px: 3 }}>
            Without a selection the adjustments apply to the whole image. Drag to select; corners resize.
          </Typography>
        )}
        <DialogActions sx={{ justifyContent: 'flex-start', flexWrap: 'wrap', gap: 1 }}>
          {detectBars !== undefined && (
            <Button onClick={() => void strip()}>Strip Image [Ctrl+Shift+D]</Button>
          )}
          <Button onClick={() => applyDefault(verticalDefaultRect)}>Vertical Default [Ctrl+Shift+A]</Button>
          <Button onClick={() => applyDefault(horizontalDefaultRect)}>Horizontal Default [Ctrl+Shift+F]</Button>
          <Box sx={{ flex: 1 }} />
          <Button onClick={onCancel}>Cancel [Esc]</Button>
          <Button variant="contained" onClick={accept}>
            Apply [Ctrl+Shift+S]
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
