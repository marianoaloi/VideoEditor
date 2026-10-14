/**
 * ZoomViewer contract: full-window image viewer with wheel / key zoom and drag-to-pan (recognition
 * `ZoomScreem` without classes, LEG §6). Owner (wave 2): ui-image implements `ZoomViewer.tsx` and
 * the pure `core/zoomMath.ts`. Keys go through the keymap scope `zoom` (modal).
 */
export interface ZoomViewerProps {
  open: boolean
  /** `media://` URL of the image. */
  imageUrl: string
  /** Natural size, for the "100 %" and fit calculations. */
  width: number
  height: number
  title?: string
  /** Escape or a click outside. */
  onClose: () => void
}
