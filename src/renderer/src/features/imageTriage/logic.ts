/**
 * Pure rules of Image Triage (image-triage.md): timer steps, destination names, strips, edit
 * planning, status line. No React, no IPC.
 */
import { isNeutralCropResult, type CropResult } from '@shared/domain/geometry'
import { formatSize } from '@shared/core/timeFormat'
import { isSafePathSegment } from '@shared/core/paths'
import type { TriageItem } from '../../app/triage/triageCore'

// ---- timer (section 4.3, TV-20..24) ------------------------------------------------------

export const TIMER_MIN_MS = 100
export const TIMER_MAX_MS = 60000

/** One wheel notch: `direction` +1 (wheel up) lengthens, -1 shortens; step 100 ms from 300, else 10. */
export function stepInterval(ms: number, direction: 1 | -1): number {
  const step = ms >= 300 ? 100 : 10
  return Math.min(TIMER_MAX_MS, Math.max(TIMER_MIN_MS, ms + step * direction))
}

/** Browser `deltaY < 0` is wheel up. */
export function wheelDirection(deltaY: number): 1 | -1 | 0 {
  if (deltaY === 0) return 0
  return deltaY < 0 ? 1 : -1
}

export function formatInterval(ms: number): string {
  return `${(ms / 1000).toFixed(ms % 100 === 0 ? 1 : 2)} s`
}

// ---- destination names (section 2.5, TV-7) -----------------------------------------------

export type NameCheck = { ok: true; value: string } | { ok: false; reason: string }

/** One path segment, different from the other side and from the backup folder. */
export function validateDestinationName(name: string, other: string, backup: string): NameCheck {
  const value = name.trim()
  if (value === '') return { ok: false, reason: 'The folder name is empty' }
  if (!isSafePathSegment(value)) return { ok: false, reason: `"${value}" is not a valid folder name` }
  const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
  if (same(value, other)) return { ok: false, reason: 'Left and right need different folders' }
  if (same(value, backup)) return { ok: false, reason: `"${value}" is the backup folder` }
  return { ok: true, value }
}

// ---- strips (sections 2.3, 2.4, TV-13) ---------------------------------------------------

export const HISTORY_LOOKBACK = 100
export const HISTORY_TILES = 4

/** Current item first, then the next undecided ones. */
export function mainStripItems(items: readonly TriageItem[], cursor: number, count: number): TriageItem[] {
  const out: TriageItem[] = []
  for (let i = cursor; i < items.length && out.length < count; i += 1) {
    const item = items[i]
    if (item?.status === 'pending') out.push(item)
  }
  return out
}

/** Newest first, from `[cursor - 100, cursor + stripCount)` by descending index. */
export function historyItems(
  items: readonly TriageItem[],
  cursor: number,
  stripCount: number,
  side: 'left' | 'right'
): TriageItem[] {
  const out: TriageItem[] = []
  const hi = Math.min(items.length, cursor + stripCount) - 1
  const lo = Math.max(0, cursor - HISTORY_LOOKBACK)
  for (let i = hi; i >= lo && out.length < HISTORY_TILES; i -= 1) {
    const item = items[i]
    if (item?.status === side) out.push(item)
  }
  return out
}

// ---- edit planning (sections 6.2, TV-33, TV-34) ------------------------------------------

export interface EditPlan {
  /** What to send to `media:imageEdit`; `null` = do nothing at all. */
  edit: CropResult | null
  warnings: string[]
}

const IGNORED_ADJUST = 'Brightness, contrast and rotation were ignored: only the crop was applied.'
const IGNORED_ROTATION = 'Rotation is not applied in Image Triage (use End to rotate 90 degrees).'

function hasAdjust(r: CropResult): boolean {
  return (
    (r.bright !== null && r.bright !== 0) ||
    (r.contrast !== null && r.contrast !== 1) ||
    (r.transpose !== null && r.transpose !== 0)
  )
}

/** Image Triage applies the crop only (adjustments only when there is no crop; never rotation). */
export function planImageEdit(result: CropResult): EditPlan {
  if (isNeutralCropResult(result)) return { edit: null, warnings: [] }
  if (result.crop !== null) {
    const edit: CropResult = { crop: result.crop, bright: null, contrast: null, transpose: null }
    return { edit, warnings: hasAdjust(result) ? [IGNORED_ADJUST] : [] }
  }
  const warnings = result.transpose !== null && result.transpose !== 0 ? [IGNORED_ROTATION] : []
  const edit: CropResult = { crop: null, bright: result.bright, contrast: result.contrast, transpose: null }
  return { edit: isNeutralCropResult(edit) ? null : edit, warnings }
}

// ---- status line and formats (sections 2.2, 3) -------------------------------------------

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

export function isAnimatedFormat(name: string): boolean {
  const ext = extensionOf(name)
  return ext === 'gif' || ext === 'webp'
}

const NON_NATIVE = new Set(['tif', 'tiff', 'heic', 'heif'])

/** Formats a browser cannot draw: they always use the converted preview. */
export function needsConvertedPreview(name: string): boolean {
  return NON_NATIVE.has(extensionOf(name))
}

export interface StatusParts {
  size: string
  path: string
  counter: string
}

export function statusParts(items: readonly TriageItem[], cursor: number, root: string | null): StatusParts {
  const total = items.length
  const item = items[cursor]
  if (item === undefined) return { size: '', path: root ?? '', counter: `${total}/${total}` }
  return { size: `[${formatSize(item.sizeBytes)}]`, path: item.path, counter: `${total}/${cursor + 1}` }
}

export const ANIMATED_STATUS_COLOR = '#90EE90'

/**
 * Confirmation text of `L` (review M5): `deleteR` trashes EVERY file directly inside R, not only
 * what this session put there, so the count of this session is a lower bound.
 */
export function sendConfirmMessage(
  movedHere: number,
  root: string | null,
  rightName: string,
  leftName: string
): string {
  const where = root === null ? rightName : `${root}${root.includes('\\') ? '\\' : '/'}${rightName}`
  const files = `${String(movedHere)} file${movedHere === 1 ? '' : 's'} moved to ${rightName} in this session`
  return (
    `Every file directly inside "${where}" will be sent to the trash (${files}, plus any that were already there). ` +
    `Then "${leftName}" is cleaned and uploaded according to your hooks.`
  )
}
