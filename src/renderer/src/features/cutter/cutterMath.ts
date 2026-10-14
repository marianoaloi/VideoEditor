/**
 * Pure helpers of the Cutter workspace (MyVideos key table, volume rule, wheel steps, scrub
 * formula, dropped files; research cutter-crop-zoom §1.5, TV-3). Volume here is the Cutter's own
 * rule (0..100, step 10 from 10 up, else 1) and differs from Video Triage's floor of 1.
 */
import { mediaKindOf } from '@shared/core/mediaKind'
import { basename } from '@shared/core/paths'

export interface SeekKeySpec {
  readonly chord: string
  readonly deltaMs: number
  readonly description: string
}

function pair(backChord: string, forwardChord: string, ms: number, label: string): SeekKeySpec[] {
  return [
    { chord: backChord, deltaMs: -ms, description: `Back ${label}` },
    { chord: forwardChord, deltaMs: ms, description: `Forward ${label}` }
  ]
}

/** The 14 seek keys of MyVideos (exact ms values). Ctrl+Q is -5 s (no Exit binding, D18). */
export const SEEK_KEY_SPECS: readonly SeekKeySpec[] = [
  ...pair('Q', 'R', 1000, '1 s'),
  ...pair('Ctrl+Q', 'Ctrl+R', 5000, '5 s'),
  ...pair('Ctrl+Shift+Q', 'Ctrl+Shift+R', 10000, '10 s'),
  ...pair('W', 'E', 500, '0.5 s'),
  ...pair('Ctrl+W', 'Ctrl+E', 100, '0.1 s'),
  ...pair('Ctrl+Shift+W', 'Ctrl+Shift+E', 10, '10 ms'),
  ...pair('ArrowDown', 'ArrowUp', 5000, '5 s')
]

export const VOLUME_END_KEY_PERCENT = 10

const clampPercent = (value: number): number => Math.min(100, Math.max(0, Math.round(value)))

/** Up: `+10` from 10 up, else `+1` (5 gives 6 7 8 9 10 20 30). */
export function volumeUpPercent(percent: number): number {
  const v = clampPercent(percent)
  return clampPercent(v + (v >= 10 ? 10 : 1))
}

/** Down: `-10` from 10 up, else `-1` (100 gives 90 ... 10 0; 14 gives 4 3 2). */
export function volumeDownPercent(percent: number): number {
  const v = clampPercent(percent)
  return clampPercent(v - (v >= 10 ? 10 : 1))
}

export const WHEEL_NOTCH = 100

/** Wheel accumulator: one step per 100 `deltaY` units; negative `deltaY` (wheel up) is +1. */
export function wheelSteps(
  remainder: number,
  deltaY: number
): { readonly steps: number; readonly remainder: number } {
  const total = remainder + deltaY
  const notches = Math.trunc(total / WHEEL_NOTCH) || 0
  return { steps: -notches || 0, remainder: total - notches * WHEEL_NOTCH }
}

/** Drag-scrub over the video: `trunc(x / width * duration)`; `null` outside the video area. */
export function scrubMs(x: number, width: number, durationMs: number): number | null {
  if (width <= 0 || durationMs <= 0) return null
  const fraction = x / width
  if (fraction < 0 || fraction > 1) return null
  return Math.trunc(fraction * durationMs)
}

export interface DropPlan {
  readonly open: string | null
  readonly ignored: string[]
}

/** The first dropped video file opens; every other path is reported (D21). */
export function planDrop(paths: readonly string[]): DropPlan {
  const clean = paths.filter((p) => p !== '')
  const first = clean.find((p) => mediaKindOf(basename(p)) === 'video') ?? null
  return { open: first, ignored: clean.filter((p) => p !== first) }
}

/** `<video>.<i>.mp4` per range for cut, `<video>.mp4` for concat (ADR-005 naming). */
export function outputNames(videoPath: string, rangeCount: number, concat: boolean): string[] {
  const name = basename(videoPath)
  if (concat) return rangeCount > 0 ? [`${name}.mp4`] : []
  return Array.from({ length: rangeCount }, (_, i) => `${name}.${i}.mp4`)
}
