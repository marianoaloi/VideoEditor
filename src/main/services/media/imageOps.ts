/**
 * Pixel work for in-place image edits (image-triage.md §6): everything happens on EXIF-oriented
 * raw pixels, so crop coordinates, rotation and the written file agree with what the user saw.
 * Output keeps the file's real format (SPEC §5) at quality 95; no metadata is written.
 */
import path from 'node:path'
import sharp, { type OutputInfo, type Sharp } from 'sharp'
import type { CropResult, Rect } from '@shared/domain/geometry'
import type { ImageRotation } from '@shared/domain/media'
import { AppError } from '../../ipc/errors'

export type OutputFormat = 'jpeg' | 'png' | 'webp' | 'tiff' | 'avif'

const FORMAT_BY_EXTENSION: Readonly<Record<string, OutputFormat>> = {
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.jpe': 'jpeg',
  '.jfif': 'jpeg',
  '.png': 'png',
  '.webp': 'webp',
  '.tif': 'tiff',
  '.tiff': 'tiff',
  '.avif': 'avif'
}
const QUALITY = 95
/** 100 MP (RGBA raw is ~400 MB); larger files are refused instead of exhausting memory. */
const MAX_INPUT_PIXELS = 100_000_000

export interface RawImage {
  readonly data: Buffer
  readonly width: number
  readonly height: number
  readonly channels: 1 | 2 | 3 | 4
}

function notEditable(file: string): AppError {
  return new AppError('VALIDATION', `Format not editable: ${path.extname(file) || file}`, {
    path: file
  })
}

/** Extension-based format (used only when the content cannot be sniffed). */
export function writableFormat(file: string): OutputFormat {
  const format = FORMAT_BY_EXTENSION[path.extname(file).toLowerCase()]
  if (format === undefined) throw notEditable(file)
  return format
}

const FORMAT_BY_CONTENT: Readonly<Record<string, OutputFormat>> = {
  jpeg: 'jpeg',
  png: 'png',
  webp: 'webp',
  tiff: 'tiff'
}

/**
 * The format the file REALLY has (checklist 37: a JPEG named `.png` stays a JPEG), so the
 * rewrite never changes the encoding behind the user's back. Throws `VALIDATION` for anything
 * that cannot be written back (gif, svg, heic, ...).
 */
export async function detectWritableFormat(data: Buffer, file: string): Promise<OutputFormat> {
  const meta = await sharp(data, { failOn: 'none' })
    .metadata()
    .catch((cause: unknown) => {
      throw new AppError('VALIDATION', 'Not a readable image', { path: file }, { cause })
    })
  if (meta.format === 'heif') {
    if (meta.compression === 'av1') return 'avif'
    throw notEditable(file)
  }
  const format = meta.format === undefined ? undefined : FORMAT_BY_CONTENT[meta.format]
  if (format === undefined) throw notEditable(file)
  return format
}

function toRaw(data: Buffer, info: OutputInfo): RawImage {
  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels as RawImage['channels']
  }
}

/**
 * Decodes tolerantly, applies the EXIF orientation, refuses animated files. An embedded ICC
 * profile is converted to sRGB (the output carries no profile, so the colours would shift
 * otherwise). EXIF is not written back: the orientation is baked into the pixels.
 */
export async function loadOriented(source: string | Buffer): Promise<RawImage> {
  const meta = await sharp(source, { failOn: 'none' }).metadata()
  if ((meta.pages ?? 1) > 1) {
    throw new AppError('VALIDATION', 'Animated images are not editable', {
      path: typeof source === 'string' ? source : undefined
    })
  }
  const pipeline = sharp(source, { failOn: 'none', limitInputPixels: MAX_INPUT_PIXELS }).rotate()
  const { data, info } = await (meta.icc === undefined ? pipeline : pipeline.withIccProfile('srgb'))
    .raw()
    .toBuffer({ resolveWithObject: true })
  return toRaw(data, info)
}

function fromRaw(image: RawImage): Sharp {
  const { width, height, channels } = image
  return sharp(image.data, { raw: { width, height, channels } })
}

async function realise(pipeline: Sharp): Promise<RawImage> {
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true })
  return toRaw(data, info)
}

export async function encode(
  image: RawImage,
  format: OutputFormat
): Promise<{ data: Buffer; width: number; height: number }> {
  const pipeline = fromRaw(image)
  const encoded =
    format === 'jpeg'
      ? pipeline.jpeg({ quality: QUALITY })
      : format === 'png'
        ? pipeline.png()
        : format === 'webp'
          ? pipeline.webp({ quality: QUALITY })
          : format === 'tiff'
            ? pipeline.tiff({ quality: QUALITY })
            : pipeline.avif({ quality: QUALITY })
  const data = await encoded.toBuffer()
  return { data, width: image.width, height: image.height }
}

/** Legacy: a crop with an empty intersection is refused BEFORE the backup (DP-24). */
export function validateCrop(rect: Rect, image: Pick<RawImage, 'width' | 'height'>): Rect {
  if (rect.x >= image.width || rect.y >= image.height) {
    throw new AppError('VALIDATION', 'The crop rectangle is outside the image', { rect })
  }
  return {
    x: rect.x,
    y: rect.y,
    w: Math.min(rect.w, image.width - rect.x),
    h: Math.min(rect.h, image.height - rect.y)
  }
}

/** Rotates by `clockwiseDeg` inside the SAME canvas, black corners (the dialog preview). */
async function rotateKeepingCanvas(image: RawImage, clockwiseDeg: number): Promise<RawImage> {
  const rotated = await realise(
    fromRaw(image).rotate(clockwiseDeg, { background: { r: 0, g: 0, b: 0, alpha: 1 } })
  )
  const keepW = Math.min(image.width, rotated.width)
  const keepH = Math.min(image.height, rotated.height)
  const left = Math.floor((rotated.width - keepW) / 2)
  const top = Math.floor((rotated.height - keepH) / 2)
  const padX = image.width - keepW
  const padY = image.height - keepH
  return realise(
    fromRaw(rotated)
      .extract({ left, top, width: keepW, height: keepH })
      .extend({
        left: Math.floor(padX / 2),
        right: padX - Math.floor(padX / 2),
        top: Math.floor(padY / 2),
        bottom: padY - Math.floor(padY / 2),
        background: { r: 0, g: 0, b: 0, alpha: 1 }
      })
  )
}

/** Legacy `saturate(in * contrast + brightness * 255)`, then the free rotation. */
async function adjust(image: RawImage, edit: CropResult): Promise<RawImage> {
  const contrast = edit.contrast ?? 1
  const beta = (edit.bright ?? 0) * 255
  let out = image
  if (contrast !== 1 || beta !== 0) out = await realise(fromRaw(out).linear(contrast, beta))
  // `transpose` is stored as -slider degrees and the slider is clockwise (geometry.ts).
  const clockwise = -(edit.transpose ?? 0)
  if (clockwise % 360 !== 0) out = await rotateKeepingCanvas(out, clockwise)
  return out
}

/** Legacy rule: with a crop only the crop is applied; otherwise the adjustments. */
export async function applyEdit(image: RawImage, edit: CropResult): Promise<RawImage> {
  if (edit.crop !== null) {
    const rect = validateCrop(edit.crop, image)
    return realise(
      fromRaw(image).extract({ left: rect.x, top: rect.y, width: rect.w, height: rect.h })
    )
  }
  const neutral =
    (edit.bright ?? 0) === 0 && (edit.contrast ?? 1) === 1 && (edit.transpose ?? 0) === 0
  if (neutral) throw new AppError('VALIDATION', 'Nothing to apply: the edit is neutral')
  return adjust(image, edit)
}

const ROTATION_DEGREES: Readonly<Record<ImageRotation, number>> = {
  ccw90: 270,
  cw90: 90,
  rot180: 180
}

/** End key: 90 degrees counter-clockwise with the canvas expanded (width and height swap). */
export function rotateImage(image: RawImage, rotation: ImageRotation): Promise<RawImage> {
  return realise(fromRaw(image).rotate(ROTATION_DEGREES[rotation]))
}
