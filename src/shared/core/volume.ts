/**
 * Player volume as a percentage (video-triage.md §3, TV-C; shared with the Cutter, cutterMath).
 * Pure. Step 10 above 10 %, step 1 between 10 % and 1 %, step 0.1 below that; the volume never
 * reaches 0 through the keys (floor 0.1 %).
 */

export const VOLUME_MIN = 0.1
export const VOLUME_MAX = 100
export const VOLUME_START = 50

/** Rounds to one decimal (tenths of a percent) so repeated 0.1 steps never drift, then clamps. */
const clampPercent = (value: number): number =>
  Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, Math.round(value * 10) / 10))

/** 10 above 10 %, 1 between 10 % and 1 %, 0.1 at or below 1 %. */
function step(percent: number): number {
  if (percent > 10) return 10
  if (percent > 1) return 1
  return 0.1
}

/** Up from 0.1: 0.1 .. 1, 1.1, 2.1 ... 9.1, 10.1, 20.1 ... 90.1, 100. */
export function volumeUp(percent: number): number {
  const v = clampPercent(percent)
  return clampPercent(v + step(v))
}

/** Down from 100: 100, 90 ... 20, 10, 9 ... 1, 0.9 ... 0.1, 0.1 (never 0). */
export function volumeDown(percent: number): number {
  const v = clampPercent(percent)
  return clampPercent(v - step(v))
}

/** `*` key: the floor, 0.1 %. */
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
