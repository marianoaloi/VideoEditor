/**
 * "Strip Image" (cutter-crop-zoom.md §3.5): finds the picture area inside black bars.
 *
 * Pure and dependency free. The legacy sampling band is kept (20 rows through the vertical centre
 * for columns, 20 columns through the horizontal centre for rows, raw samples summed over all
 * channels), but the two legacy thresholds and the count-based size are replaced by the INTENT:
 * one threshold and `min..max` of the active lines, so a dark line inside the picture cannot
 * shrink the rectangle. Test vectors A-I of the research note are in `stripBars.test.ts`.
 */
import type { Rect } from '../domain/geometry'

/** Half-width of the sampling band: 20 pixels through the centre (legacy `h2-10 .. h2+9`). */
export const STRIP_BAND_HALF = 10
/**
 * A line is picture content when the sum of its raw samples is above this value. The band has
 * 20 pixels x 3 channels = 60 samples, so bars of value 1 count as content (known limit, G).
 */
export const STRIP_SUM_THRESHOLD = 50

/** Interleaved 8-bit pixels (`channels` samples per pixel, row-major, no padding). */
export interface PixelBuffer {
  readonly data: Uint8Array | Uint8ClampedArray
  readonly width: number
  readonly height: number
  readonly channels: number
}

function bandStart(size: number): number {
  return Math.max(0, Math.floor(size / 2) - STRIP_BAND_HALF)
}

function bandEnd(size: number): number {
  return Math.min(size, Math.floor(size / 2) + STRIP_BAND_HALF)
}

function sumPixel(pixels: PixelBuffer, x: number, y: number): number {
  const base = (y * pixels.width + x) * pixels.channels
  let sum = 0
  for (let c = 0; c < pixels.channels; c += 1) sum += pixels.data[base + c] ?? 0
  return sum
}

/** First and last index along one axis whose band sum is above the threshold. */
function activeSpan(
  length: number,
  from: number,
  to: number,
  sampleAt: (line: number, across: number) => number
): { min: number; max: number } | null {
  let min = -1
  let max = -1
  for (let line = 0; line < length; line += 1) {
    let sum = 0
    for (let across = from; across < to; across += 1) sum += sampleAt(line, across)
    if (sum > STRIP_SUM_THRESHOLD) {
      if (min < 0) min = line
      max = line
    }
  }
  return min < 0 ? null : { min, max }
}

/**
 * The picture rectangle in pixel coordinates, or `null` when no line is bright enough
 * (all-black frame, vector I) or the buffer is inconsistent.
 */
export function detectBars(pixels: PixelBuffer): Rect | null {
  const { width, height, channels, data } = pixels
  if (width < 1 || height < 1 || channels < 1) return null
  if (data.length < width * height * channels) return null
  const cols = activeSpan(width, bandStart(height), bandEnd(height), (x, y) =>
    sumPixel(pixels, x, y)
  )
  const rows = activeSpan(height, bandStart(width), bandEnd(width), (y, x) =>
    sumPixel(pixels, x, y)
  )
  if (cols === null || rows === null) return null
  return {
    x: cols.min,
    y: rows.min,
    w: cols.max - cols.min + 1,
    h: rows.max - rows.min + 1
  }
}
