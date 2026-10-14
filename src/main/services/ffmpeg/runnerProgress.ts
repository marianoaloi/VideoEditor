/**
 * Parser for `ffmpeg -progress pipe:1` (research §7.7): `key=value` lines, a block ends with
 * `progress=continue|end`. ffmpeg 8 prints `out_time_us` and `out_time_ms`, both in microseconds.
 */

export interface ProgressSample {
  /** Output time reached, in milliseconds; `null` while ffmpeg prints `N/A`. */
  readonly outTimeMs: number | null
  /** Encoding speed (`1.5x` is 1.5); `null` when unknown. */
  readonly speed: number | null
  readonly end: boolean
}

function parseNumber(text: string): number | null {
  const value = Number(text)
  return text !== '' && Number.isFinite(value) ? value : null
}

export class ProgressParser {
  private outTimeUs: number | null = null
  private speed: number | null = null

  /** Feeds one stdout line; returns a sample when a block is complete. */
  feed(line: string): ProgressSample | null {
    const eq = line.indexOf('=')
    if (eq <= 0) return null
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (key === 'out_time_us') {
      this.outTimeUs = parseNumber(value)
    } else if (key === 'out_time_ms' && this.outTimeUs === null) {
      this.outTimeUs = parseNumber(value)
    } else if (key === 'speed') {
      this.speed = parseNumber(value.replace(/x$/, ''))
    } else if (key === 'progress') {
      return this.flush(value === 'end')
    }
    return null
  }

  private flush(end: boolean): ProgressSample {
    const sample: ProgressSample = {
      outTimeMs: this.outTimeUs === null ? null : Math.max(0, Math.trunc(this.outTimeUs / 1000)),
      speed: this.speed,
      end
    }
    this.outTimeUs = null
    this.speed = null
    return sample
  }
}

/** Fraction (0..1) of a step; `null` when the step has no known duration. */
export function stepFraction(outTimeMs: number | null, expectedMs: number | null): number | null {
  if (outTimeMs === null || expectedMs === null || expectedMs <= 0) return null
  return Math.min(1, Math.max(0, outTimeMs / expectedMs))
}

/** Overall progress over `stepCount` equally weighted steps. */
export function overallProgress(stepIndex: number, stepCount: number, fraction: number): number {
  if (stepCount <= 0) return 0
  return Math.min(1, Math.max(0, (stepIndex + fraction) / stepCount))
}
