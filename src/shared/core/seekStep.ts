/**
 * Seek keys and wheel of Video Triage (video-triage.md §5.1-5.2, TV-B). Pure.
 *
 * The modifier factor comes from the triggering event, so the shortcuts that carry Ctrl/Shift are
 * multiplied again by design (legacy compounding, Q1): `Ctrl+W` = 0.1 s x 3 = 300 ms.
 */
import type { KeyChord } from '../domain/keymap'

/** The legacy `this.duration = playerDuration - 100` (RangeSlider fudge). */
export const SLIDER_FUDGE_MS = 100

export interface ModifierState {
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly metaKey: boolean
}

/** Ctrl only x3, Shift only x0.3, Alt only x5, Ctrl+Shift x10, anything else (incl. Meta) x1. */
export function modifierFactor(mods: ModifierState): number {
  if (mods.metaKey) return 1
  const { ctrlKey: ctrl, shiftKey: shift, altKey: alt } = mods
  if (ctrl && shift && !alt) return 10
  if (ctrl && !shift && !alt) return 3
  if (shift && !ctrl && !alt) return 0.3
  if (alt && !ctrl && !shift) return 5
  return 1
}

/** Signed delta in whole ms: `round(nominalSec * factor * 1000)` (no float residue such as 0.30000000000000004). */
export function seekDeltaMs(nominalSec: number, mods: ModifierState, direction: 1 | -1): number {
  return direction * Math.round(nominalSec * modifierFactor(mods) * 1000)
}

/**
 * New position: never below 0, never above `effectiveDurationMs - 1` (legacy `this.duration - 1`).
 * Returns `null` while the duration is unknown (no seek before metadata is loaded).
 */
export function clampSeekTarget(
  positionMs: number,
  deltaMs: number,
  effectiveDurationMs: number
): number | null {
  if (!Number.isFinite(effectiveDurationMs) || effectiveDurationMs <= 0) return null
  const target = positionMs + deltaMs
  return Math.max(0, Math.min(target, effectiveDurationMs - 1))
}

/** Duration the seek and the handles work against: `durationMs - 100`, never negative. */
export function effectiveDuration(durationMs: number): number {
  return Math.max(0, durationMs - SLIDER_FUDGE_MS)
}

export interface SeekKey {
  readonly id: string
  readonly keys: readonly KeyChord[]
  /** Base step in seconds (the argument of the legacy `reducePos` / `acceleration`). */
  readonly nominalSec: number
  readonly direction: 1 | -1
  readonly description: string
}

function pair(
  name: string,
  back: KeyChord,
  forward: KeyChord,
  nominalSec: number,
  label: string
): SeekKey[] {
  return [
    {
      id: `videoTriage.seekBack${name}`,
      keys: [back],
      nominalSec,
      direction: -1,
      description: `Seek back ${label}`
    },
    {
      id: `videoTriage.seekForward${name}`,
      keys: [forward],
      nominalSec,
      direction: 1,
      description: `Seek forward ${label}`
    }
  ]
}

/** The 20 seek shortcuts (data-driven; the effective step is nominal x event modifiers). */
export const SEEK_KEYS: readonly SeekKey[] = [
  ...pair('Half', 'W', 'E', 0.5, '0.5 s'),
  ...pair('Tenth', 'Ctrl+W', 'Ctrl+E', 0.1, '0.3 s'),
  ...pair('Hundredth', 'Ctrl+Shift+W', 'Ctrl+Shift+E', 0.01, '0.1 s'),
  ...pair('One', 'Q', 'R', 1, '1 s'),
  ...pair('Five', 'Ctrl+Q', 'Ctrl+R', 5, '15 s'),
  ...pair('Ten', 'Ctrl+Shift+Q', 'Ctrl+Shift+R', 10, '100 s'),
  ...pair('Arrow', 'ArrowDown', 'ArrowUp', 5, '5 s'),
  ...pair('ArrowCtrl', 'Ctrl+ArrowDown', 'Ctrl+ArrowUp', 30, '90 s'),
  ...pair('ArrowShift', 'Shift+ArrowDown', 'Shift+ArrowUp', 45, '13.5 s'),
  ...pair('ArrowCtrlShift', 'Ctrl+Shift+ArrowDown', 'Ctrl+Shift+ArrowUp', 60, '600 s')
]

/** Wheel notches: `deltaY` is accumulated and one notch is emitted per 100 units. */
export const WHEEL_NOTCH = 100

export interface WheelAccumulator {
  readonly remainder: number
}

export function wheelNotches(
  acc: WheelAccumulator,
  deltaY: number
): { readonly notches: number; readonly acc: WheelAccumulator } {
  const total = acc.remainder + deltaY
  const notches = Math.trunc(total / WHEEL_NOTCH) || 0
  return { notches, acc: { remainder: total - notches * WHEEL_NOTCH } }
}

/**
 * Mouse scrubbing over the video (M:377-384, TV-H): `trunc(x / width * (durationMs - 100))`.
 * A position outside `[0, width]` (only reachable while dragging outside) is ignored.
 */
export function scrubTarget(x: number, width: number, durationMs: number): number | null {
  if (!Number.isFinite(x) || !(width > 0)) return null
  const fraction = x / width
  if (fraction < 0 || fraction > 1) return null
  return Math.trunc(fraction * effectiveDuration(durationMs))
}
