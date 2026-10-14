/**
 * Player volume as an integer percentage (video-triage.md §3, TV-C). Pure.
 * The volume is persistent across items and never reaches 0 through the keys (floor 1 %).
 */

export const VOLUME_MIN = 1
export const VOLUME_MAX = 100
export const VOLUME_START = 50

const clampPercent = (value: number): number =>
  Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, Math.round(value)))

/** Step 10 above 10 %, else 1. Up from 1: 1..11, 21, 31 ... 91, 100. */
export function volumeUp(percent: number): number {
  const v = clampPercent(percent)
  return clampPercent(v + (v > 10 ? 10 : 1))
}

/** Down from 100: 100, 90 ... 20, 10, 9 ... 1, 1. */
export function volumeDown(percent: number): number {
  const v = clampPercent(percent)
  return clampPercent(v - (v > 10 ? 10 : 1))
}

/** `*` key: 1 %. */
export function volumeMin(): number {
  return VOLUME_MIN
}

/** Player state holds 0..1; keys work on percents. */
export function toPercent(volume: number): number {
  return clampPercent(volume * 100)
}

export function fromPercent(percent: number): number {
  return clampPercent(percent) / 100
}
