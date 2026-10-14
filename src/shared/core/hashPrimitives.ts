/**
 * Pure perceptual-hash primitives (research duplicates-thumbs §4, ADR-007). No Node imports:
 * the MD5 function is injected (`Md5Fn`), so this file also runs in the renderer and in tests.
 *
 * Bit-exact with the legacy pipeline GIVEN an identical 40x40 thumbnail T:
 *   blur2x2, thresholdBinary, averageHash (Pillow Lanczos re-implementation), key layout.
 * Approximate (documented where it happens):
 *   - `makeThumb` re-implements cv2.resize(INTER_LINEAR) in fixed point; real OpenCV SIMD paths
 *     differ by +-1 level on some inputs.
 *   - decoding (sharp vs OpenCV/Pillow) and video frame extraction (ffmpeg vs cv2.VideoCapture)
 *     are done by the provider, not here.
 */

export type Md5Fn = (data: Uint8Array) => string

/** Raw 8-bit pixels, row-major, channels interleaved (B,G,R for colour; 1 for grey). */
export interface RawImage {
  readonly width: number
  readonly height: number
  readonly channels: 1 | 3
  readonly data: Uint8Array
}

export interface PerceptualKeys {
  readonly pureMD5: string
  readonly hash16: string
  readonly hash8: string
  readonly thumbLight: string
  readonly thumbDark: string
}

/** Legacy `Mosaic(64, 12)`: stretch to 64x64, crop 12 px per side -> 40x40. */
export const THUMB_STRETCH = 64
export const THUMB_CROP = 12
export const THUMB_SIDE = THUMB_STRETCH - 2 * THUMB_CROP
export const LIGHT_LEVEL = 136
export const DARK_LEVEL = 115

/**
 * Legacy quirk (research §4.3, decision Q1 / CONTRACT §7.6): `bytes_thumb` rebinds the outer
 * `img` via `nonlocal`, so `thumbDark` thresholds the TWICE-blurred array and `pureMD5` hashes it.
 * `false` = documented intent (pureMD5 = md5(T), thumbDark = thr(blur(T), 115)).
 */
export const LEGACY_BLUR_CASCADE = true

// ---- cv2.resize(INTER_LINEAR) + crop -----------------------------------------------------------

interface AxisTap {
  readonly i0: number
  readonly w0: number
  readonly w1: number
}

const COEF_BITS = 11
const COEF_SCALE = 1 << COEF_BITS

function axisTaps(inSize: number, outSize: number): AxisTap[] {
  const scale = inSize / outSize
  const taps: AxisTap[] = []
  for (let d = 0; d < outSize; d++) {
    const fx = Math.fround((d + 0.5) * scale - 0.5)
    let s = Math.floor(fx)
    let f = Math.fround(fx - s)
    if (s < 0) {
      s = 0
      f = 0
    } else if (s >= inSize - 1) {
      s = inSize - 1
      f = 0
    }
    taps.push({
      i0: s,
      w0: Math.round((1 - f) * COEF_SCALE),
      w1: Math.round(f * COEF_SCALE)
    })
  }
  return taps
}

/** Fixed-point bilinear stretch (aspect ratio ignored), horizontal then vertical, 2x2 taps. */
export function bilinearStretch(src: RawImage, outW: number, outH: number): RawImage {
  const { width, height, channels, data } = src
  const xs = axisTaps(width, outW)
  const ys = axisTaps(height, outH)
  const mid = new Int32Array(height * outW * channels)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < outW; x++) {
      const t = xs[x] as AxisTap
      const j1 = Math.min(t.i0 + 1, width - 1)
      for (let c = 0; c < channels; c++) {
        const a = data[(y * width + t.i0) * channels + c] as number
        const b = data[(y * width + j1) * channels + c] as number
        mid[(y * outW + x) * channels + c] = a * t.w0 + b * t.w1
      }
    }
  }
  const out = new Uint8Array(outH * outW * channels)
  for (let y = 0; y < outH; y++) {
    const t = ys[y] as AxisTap
    const r1 = Math.min(t.i0 + 1, height - 1)
    for (let k = 0; k < outW * channels; k++) {
      const a = mid[t.i0 * outW * channels + k] as number
      const b = mid[r1 * outW * channels + k] as number
      out[y * outW * channels + k] = (a * t.w0 + b * t.w1 + (1 << 21)) >> 22
    }
  }
  return { width: outW, height: outH, channels, data: out }
}

export function cropCentre(src: RawImage, margin: number): RawImage {
  const width = src.width - 2 * margin
  const height = src.height - 2 * margin
  const out = new Uint8Array(width * height * src.channels)
  for (let y = 0; y < height; y++) {
    const from = ((y + margin) * src.width + margin) * src.channels
    out.set(src.data.subarray(from, from + width * src.channels), y * width * src.channels)
  }
  return { width, height, channels: src.channels, data: out }
}

/** Normalised thumbnail T (research §4.1 steps 5-6): stretch to 64x64, crop to 40x40. */
export function makeThumb(src: RawImage): RawImage {
  if (src.width < 1 || src.height < 1) throw new Error('empty image')
  return cropCentre(bilinearStretch(src, THUMB_STRETCH, THUMB_STRETCH), THUMB_CROP)
}

// ---- blur / threshold --------------------------------------------------------------------------

/** Round-half-to-even of `sum / 4` (OpenCV `cvRound`). */
function roundQuarter(sum: number): number {
  const q = sum >> 2
  const r = sum & 3
  if (r > 2) return q + 1
  return r === 2 ? q + (q & 1) : q
}

/**
 * `cv2.filter2D(img, -1, ones(2,2)/4, BORDER_CONSTANT)`: anchor (1,1), so
 * out[y][x] = round((in[y-1][x-1] + in[y-1][x] + in[y][x-1] + in[y][x]) / 4), outside = 0.
 */
export function blur2x2(img: RawImage): RawImage {
  const { width, height, channels, data } = img
  const out = new Uint8Array(data.length)
  const at = (y: number, x: number, c: number): number =>
    y < 0 || x < 0 ? 0 : (data[(y * width + x) * channels + c] as number)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        const sum = at(y - 1, x - 1, c) + at(y - 1, x, c) + at(y, x - 1, c) + at(y, x, c)
        out[(y * width + x) * channels + c] = roundQuarter(sum)
      }
    }
  }
  return { width, height, channels, data: out }
}

/** `cv2.threshold(..., THRESH_BINARY)`: 255 when strictly above `level`, else 0. */
export function thresholdBinary(img: RawImage, level: number): Uint8Array {
  const out = new Uint8Array(img.data.length)
  for (let i = 0; i < out.length; i++) out[i] = (img.data[i] as number) > level ? 255 : 0
  return out
}

// ---- imagehash.average_hash --------------------------------------------------------------------

const LANCZOS_BITS = 22

function sinc(x: number): number {
  return x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
}

function lanczos3(x: number): number {
  return x >= -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0
}

interface ResampleRow {
  readonly start: number
  readonly weights: Int32Array
}

/** Pillow `precompute_coeffs` + `normalize_coeffs_8bpc` for the LANCZOS filter. */
function lanczosCoeffs(inSize: number, outSize: number): ResampleRow[] {
  const scale = inSize / outSize
  const filterScale = Math.max(scale, 1)
  const support = 3 * filterScale
  const rows: ResampleRow[] = []
  for (let i = 0; i < outSize; i++) {
    const center = (i + 0.5) * scale
    const start = Math.max(0, Math.trunc(center - support + 0.5))
    const end = Math.min(inSize, Math.trunc(center + support + 0.5))
    const raw: number[] = []
    for (let x = 0; x < end - start; x++) raw.push(lanczos3((x + start - center + 0.5) / filterScale))
    const total = raw.reduce((a, b) => a + b, 0)
    const fixed = raw.map((w) => {
      const v = (total === 0 ? w : w / total) * (1 << LANCZOS_BITS)
      return Math.trunc(v < 0 ? v - 0.5 : v + 0.5)
    })
    rows.push({ start, weights: Int32Array.from(fixed) })
  }
  return rows
}

function clip8(sum: number): number {
  const v = (sum + (1 << (LANCZOS_BITS - 1))) >> LANCZOS_BITS
  return v < 0 ? 0 : v > 255 ? 255 : v
}

/** Pillow `Image.resize((n, n), LANCZOS)` on an `L` image: horizontal pass, then vertical. */
export function resizeLanczosL(
  px: Uint8Array,
  width: number,
  height: number,
  outW: number,
  outH: number
): Uint8Array {
  if (width === outW && height === outH) return Uint8Array.from(px)
  const cx = lanczosCoeffs(width, outW)
  const cy = lanczosCoeffs(height, outH)
  const mid = new Uint8Array(outW * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < outW; x++) {
      const { start, weights } = cx[x] as ResampleRow
      let sum = 0
      for (let k = 0; k < weights.length; k++) {
        sum += (px[y * width + start + k] as number) * (weights[k] as number)
      }
      mid[y * outW + x] = clip8(sum)
    }
  }
  const out = new Uint8Array(outW * outH)
  for (let y = 0; y < outH; y++) {
    const { start, weights } = cy[y] as ResampleRow
    for (let x = 0; x < outW; x++) {
      let sum = 0
      for (let k = 0; k < weights.length; k++) {
        sum += (mid[(start + k) * outW + x] as number) * (weights[k] as number)
      }
      out[y * outW + x] = clip8(sum)
    }
  }
  return out
}

/**
 * `Image.fromarray(T).convert('L')`. A 3-channel T is read by Pillow as RGB although memory holds
 * B,G,R, so the weights land on the swapped channels (research §4.2 step 2).
 */
export function pillowLuma(img: RawImage): Uint8Array {
  if (img.channels === 1) return img.data
  const out = new Uint8Array(img.width * img.height)
  for (let i = 0; i < out.length; i++) {
    const r = img.data[i * 3] as number
    const g = img.data[i * 3 + 1] as number
    const b = img.data[i * 3 + 2] as number
    out[i] = (r * 19595 + g * 38470 + b * 7471 + 0x8000) >> 16
  }
  return out
}

/** Pillow `convert('L')` of a true RGB triple (used by the provider's grey decode path). */
export function rgbToPillowL(r: number, g: number, b: number): number {
  return (r * 19595 + g * 38470 + b * 7471 + 0x8000) >> 16
}

/** `str(imagehash.average_hash(img, hash_size=n))`: n*n/4 lower-case hex, top-left = MSB. */
export function averageHash(img: RawImage, size: number): string {
  const luma = pillowLuma(img)
  const small = resizeLanczosL(luma, img.width, img.height, size, size)
  let sum = 0
  for (const v of small) sum += v
  const mean = sum / small.length
  let hex = ''
  for (let i = 0; i < small.length; i += 4) {
    let nibble = 0
    for (let b = 0; b < 4; b++) nibble = (nibble << 1) | ((small[i + b] as number) > mean ? 1 : 0)
    hex += nibble.toString(16)
  }
  return hex
}

// ---- the five keys -----------------------------------------------------------------------------

export function computeKeys(
  thumb: RawImage,
  md5: Md5Fn,
  cascade: boolean = LEGACY_BLUR_CASCADE
): PerceptualKeys {
  const blur1 = blur2x2(thumb)
  const blur2 = cascade ? blur2x2(blur1) : blur1
  return {
    hash16: averageHash(thumb, 16),
    hash8: averageHash(thumb, 8),
    thumbLight: md5(thresholdBinary(blur1, LIGHT_LEVEL)),
    thumbDark: md5(thresholdBinary(blur2, DARK_LEVEL)),
    pureMD5: md5(cascade ? blur2.data : thumb.data)
  }
}

/** True when any sample is non-zero (legacy drops all-zero frames, EM:74). */
export function hasSignal(img: RawImage): boolean {
  for (const v of img.data) if (v !== 0) return true
  return false
}

// ---- video frame sampling (research §5) --------------------------------------------------------

/** Python `round()`: half to even (non-negative input). */
export function pyRound(x: number): number {
  const floor = Math.floor(x)
  const diff = x - floor
  if (diff < 0.5) return floor
  if (diff > 0.5) return floor + 1
  return floor % 2 === 0 ? floor : floor + 1
}

function pyRange(start: number, stop: number, step: number): number[] {
  const out: number[] = []
  for (let v = start; v < stop; v += step) out.push(v)
  return out
}

/** Timestamps (ms) sampled for hashing a clip of `durationMs`: 10 %, ~10 % window, first 5 s. */
export function frameTimesMs(durationMs: number): number[] {
  const d = Math.max(0, durationMs)
  const window = pyRange(pyRound(d / 10.3), pyRound(d / 9.7), 600)
  const first = pyRange(0, Math.min(5000, pyRound(d)), 1000)
  return [pyRound(d / 10), ...window, ...first]
}

/** Frame index OpenCV's FFmpeg backend would pick for a millisecond position. */
export function frameIndexForMs(ms: number, fps: number): number {
  return Math.floor((ms * fps) / 1000 + 0.5)
}

/** Seek time (s) that lands on frame `index` with ffmpeg's accurate input seek. */
export function seekSecondsForIndex(index: number, fps: number): number {
  return Math.max(0, index - 0.25) / fps
}
