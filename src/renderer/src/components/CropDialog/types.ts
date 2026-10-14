/**
 * CropDialog contract (CroppMedia, LEG §3.2). Owner (wave 2): ui-image implements
 * `CropDialog.tsx` (react-konva) and the pure `core/cropMath.ts`, `core/adjustments.ts`.
 * Used by Image Triage (in-place edits) and by Video Triage / Cutter (job overrides).
 *
 * Coordinates: `result.crop` is in SOURCE PIXELS of `image` as delivered (`media:grabFrame`
 * already applies container rotation, so this is the displayed, auto-rotated frame), measured
 * BEFORE the `transpose` of the result. The dialog rotates only its preview; `cropMath`
 * maps view ↔ source with the inverse rotation for transpose 0 / 90 / 180 / -90.
 * Scales (see `CropResultSchema`): `bright` = slider/255 (−1..1), `contrast` = slider/100 (−4..4,
 * 1 neutral), `transpose` = −slider° (slider −180..180 in steps of 45).
 *
 * Keys are bound through the keymap scope `crop` (modal): Enter/accept, Escape/cancel, ... .
 */
import type { CropResult, Rect } from '@shared/domain/geometry'

export type { CropResult }

export interface CropImage {
  /** `media://` URL (see `toMediaUrl`) of the frame or image. */
  url: string
  /** Source pixel size of that image. */
  width: number
  height: number
}

export interface CropDialogProps {
  open: boolean
  image: CropImage
  /** `image`: with no rectangle drawn, brightness/contrast/rotation apply to the whole image. */
  mode: 'video' | 'image'
  /** Window title, e.g. the file name. */
  title?: string
  /** Seed values: last crop (Ctrl+Shift+F), a loaded job, a quick-crop being edited. */
  initial?: Partial<CropResult>
  /**
   * "Strip Image" button: resolves the detected content rectangle (calls `media:detectBlackBars`).
   * Omit to hide the button.
   */
  detectBars?: () => Promise<Rect>
  /**
   * Called with the result when the operator accepts and it is not neutral
   * (`isNeutralCropResult` false). A neutral result calls `onCancel` instead (legacy: no signal).
   */
  onAccept: (result: CropResult) => void
  onCancel: () => void
}
