/**
 * Info bar of Video Triage and the Cutter: fields, colours and size/time estimates
 * (choicevideos `fillVideo` M:1244-1380 and `changeDurationSelected` M:868-877; video-triage.md §7,
 * vectors TV-A). Pure: no I/O, no renderer imports (the field shape is structurally the one of
 * `components/InfoBar/types.ts`).
 *
 * Kept as coded on purpose (SPEC acceptance 6): the bitrate factor `(maxRate / rate) * 2` that
 * exceeds 1 between 500 and 1000 kbit/s, and `otimizedTime` / `otimizedSize` as the legacy names.
 */
import type { Rect } from '../domain/geometry'
import type { MediaInfo } from '../domain/media'
import type { Settings } from '../domain/settings'
import { formatMillis, formatSize } from './timeFormat'

export type TriageInfoColor = 'green' | 'yellow' | 'red' | 'none'

export const TRIAGE_INFO_FIELD_IDS = [
  'fileSize',
  'durationTime',
  'otimizedTime',
  'audio',
  'rotate',
  'codec',
  'avgrate',
  'size',
  'crop',
  'rateVideo',
  'otimizedSize'
] as const
export type TriageInfoFieldId = (typeof TRIAGE_INFO_FIELD_IDS)[number]

export interface TriageInfoField {
  id: TriageInfoFieldId
  label: string
  text: string
  color: TriageInfoColor
  editable: boolean
  overridden: boolean
}

export interface InfoOverrides {
  size: string | null
  rate: number | null
  avgrate: number | null
  crop: Rect | null
}

export type InfoThresholds = Settings['thresholds']

const FIELD_LABELS: Readonly<Record<TriageInfoFieldId, string>> = {
  fileSize: 'File size',
  durationTime: 'Duration',
  otimizedTime: 'Optimised time',
  audio: 'Audio',
  rotate: 'Rotation',
  codec: 'Codec',
  avgrate: 'FPS',
  size: 'Size',
  crop: 'Crop',
  rateVideo: 'Bitrate (kbit/s)',
  otimizedSize: 'Optimised size'
}

/** Legacy fallbacks when the file has no video stream / no bitrate / no frame rate. */
const NO_VIDEO_SIZE = { width: 640, height: 360 } as const
const DEFAULT_RATE_KBPS = 500
const DEFAULT_FPS = 25

export interface InfoInput {
  info: MediaInfo
  /** Disk size (`os.stat`), not ffprobe's. */
  fileSizeBytes: number
  thresholds: InfoThresholds
  overrides: InfoOverrides
}

/** Multipliers behind the "optimised" size and the selection estimate (`variationDurationSize`). */
export interface EstimateFactors {
  sizeBytes: number
  /** Whole seconds. */
  durationSec: number
  pixelsFactor: number
  rateFactor: number
}

export function parseSizeText(text: string): { width: number; height: number } | null {
  const match = /^(\d+)[xX:](\d+)$/.exec(text.trim())
  if (match === null) return null
  return { width: Number(match[1]), height: Number(match[2]) }
}

function field(
  id: TriageInfoFieldId,
  text: string,
  color: TriageInfoColor = 'none',
  extra: { editable?: boolean; overridden?: boolean } = {}
): TriageInfoField {
  return {
    id,
    label: FIELD_LABELS[id],
    text,
    color,
    editable: extra.editable ?? false,
    overridden: extra.overridden ?? false
  }
}

/** Green below `greenBelow`, yellow below `yellowBelow`, else red (strict comparisons). */
function bandBelow(
  value: number,
  greenBelow: number,
  yellowBelow: number
): 'green' | 'yellow' | 'red' {
  if (value < greenBelow) return 'green'
  return value < yellowBelow ? 'yellow' : 'red'
}

/** Red above `redAbove`, yellow above `yellowAbove`, else green (strict comparisons). */
function bandAbove(
  value: number,
  redAbove: number,
  yellowAbove: number
): 'green' | 'yellow' | 'red' {
  if (value > redAbove) return 'red'
  return value > yellowAbove ? 'yellow' : 'green'
}

/** The displayed size in pixels (the size override wins, like the legacy sidecar `size`). */
function effectivePixels(input: InfoInput): { width: number; height: number } {
  const { info, overrides } = input
  const overridden = overrides.size === null ? null : parseSizeText(overrides.size)
  if (overridden !== null) return overridden
  if (!info.hasVideo) return { ...NO_VIDEO_SIZE }
  return { width: info.width, height: info.height }
}

/** Reported bitrate in kbit/s after the override; `null` when the probe had none (legacy: 500, no factor). */
function effectiveRateKbps(input: InfoInput): number | null {
  if (input.overrides.rate !== null) return input.overrides.rate
  return input.info.bitrateKbps
}

export function estimateFactors(input: InfoInput): EstimateFactors | null {
  const durationSec = Math.trunc(input.info.durationMs / 1000)
  if (durationSec <= 0 || input.fileSizeBytes <= 0) return null
  const { width, height } = effectivePixels(input)
  const pixels = width * height
  const target = input.thresholds.targetPixels
  const rate = effectiveRateKbps(input)
  const max = input.thresholds.maxRateKbps
  return {
    sizeBytes: input.fileSizeBytes,
    durationSec,
    pixelsFactor: pixels > target ? target / pixels : 1,
    rateFactor: rate !== null && rate > max ? (max / rate) * 2 : 1
  }
}

/** `otimizedSize`: the file scaled to the pixel and bitrate budgets. */
export function optimisedSizeBytes(factors: EstimateFactors): number {
  return factors.sizeBytes * factors.pixelsFactor * factors.rateFactor
}

/** `otimizedTime` seconds: how long the file could be at its byte rate within `maxOutputBytes`. */
export function optimisedTimeSec(
  durationSec: number,
  fileSizeBytes: number,
  maxOutputBytes: number
): number | null {
  if (fileSizeBytes <= 0 || durationSec <= 0) return null
  return Math.trunc((durationSec * maxOutputBytes) / fileSizeBytes)
}

/** Estimated output size of the selected span (`estimativesize`); `null` without probe data. */
export function estimateSelectionBytes(
  factors: EstimateFactors | null,
  selectedMs: number
): number | null {
  if (factors === null || !Number.isFinite(selectedMs) || selectedMs < 0) return null
  return (optimisedSizeBytes(factors) * (selectedMs / 1000)) / factors.durationSec
}

export interface SelectionSummary {
  /** `HH:MM:SS` of the selection (hours not wrapped). */
  text: string
  color: Exclude<TriageInfoColor, 'none'>
  /** `formatSize` of the estimate, or `null` ("—" in the UI). */
  estimate: string | null
}

export function selectionSummary(
  selectedMs: number,
  thresholds: InfoThresholds,
  factors: EstimateFactors | null
): SelectionSummary {
  const ms = Math.max(0, selectedMs)
  const bytes = estimateSelectionBytes(factors, ms)
  return {
    text: formatMillis(ms),
    color: bandBelow(ms, thresholds.selection.greenBelowMs, thresholds.selection.yellowBelowMs),
    estimate: bytes === null ? null : formatSize(bytes)
  }
}

function sizeField(input: InfoInput): TriageInfoField {
  const { info, overrides, thresholds } = input
  if (overrides.size !== null) {
    return field('size', overrides.size, 'none', { editable: true, overridden: true })
  }
  if (!info.hasVideo) {
    return field('size', `${NO_VIDEO_SIZE.width}x${NO_VIDEO_SIZE.height}`, 'none', {
      editable: true
    })
  }
  const color = bandAbove(info.width, thresholds.width.redAbove, thresholds.width.yellowAbove)
  return field('size', `${info.width}x${info.height}`, color, { editable: true })
}

function cropField(input: InfoInput): TriageInfoField {
  const { info, overrides } = input
  if (overrides.crop !== null) {
    const { x, y, w, h } = overrides.crop
    return field('crop', `${x}|${y}|${w}|${h}`, 'none', { editable: true, overridden: true })
  }
  const width = info.hasVideo ? info.displayWidth : NO_VIDEO_SIZE.width
  const height = info.hasVideo ? info.displayHeight : NO_VIDEO_SIZE.height
  return field('crop', `0|0|${width}|${height}`, 'none', { editable: true })
}

function avgrateField(input: InfoInput): TriageInfoField | null {
  const { info, overrides, thresholds } = input
  if (overrides.avgrate !== null) {
    return field('avgrate', String(overrides.avgrate), 'none', { editable: true, overridden: true })
  }
  if (info.fps === null) return field('avgrate', String(DEFAULT_FPS), 'none', { editable: true })
  if (info.fps <= 0) return null
  const fps = Math.trunc(info.fps)
  const { greenAbove, yellowAbove } = thresholds.fps
  const color = fps > greenAbove ? 'green' : fps > yellowAbove ? 'yellow' : 'red'
  return field('avgrate', String(fps), color, { editable: true })
}

function rateField(input: InfoInput): TriageInfoField {
  const { overrides, thresholds } = input
  if (overrides.rate !== null) {
    return field('rateVideo', String(overrides.rate), 'none', { editable: true, overridden: true })
  }
  const rate = input.info.bitrateKbps
  if (rate === null) {
    return field('rateVideo', String(DEFAULT_RATE_KBPS), 'none', { editable: true })
  }
  const { redAboveKbps, yellowAboveKbps } = thresholds.bitrate
  return field('rateVideo', String(rate), bandAbove(rate, redAboveKbps, yellowAboveKbps), {
    editable: true
  })
}

/**
 * The info-bar fields in the fixed order of `TRIAGE_INFO_FIELD_IDS`. Fields that do not apply are
 * left out (`rotate` without rotation, `avgrate` for a 0 fps stream, the derived ones without a
 * duration or with an empty file).
 */
export function buildInfoFields(input: InfoInput): TriageInfoField[] {
  const { info, fileSizeBytes, thresholds } = input
  const fields: (TriageInfoField | null)[] = []
  fields.push(
    field(
      'fileSize',
      formatSize(fileSizeBytes),
      bandBelow(fileSizeBytes, thresholds.fileSize.greenBelowBytes, thresholds.fileSize.yellowBelowBytes)
    )
  )
  const durationSec = Math.trunc(info.durationMs / 1000)
  if (info.durationMs > 0) {
    fields.push(
      field(
        'durationTime',
        formatMillis(durationSec * 1000),
        bandBelow(durationSec * 1000, thresholds.duration.greenBelowMs, thresholds.duration.yellowBelowMs)
      )
    )
    const fits = optimisedTimeSec(durationSec, fileSizeBytes, thresholds.maxOutputBytes)
    fields.push(fits === null ? null : field('otimizedTime', formatMillis(fits * 1000)))
  }
  fields.push(
    info.hasAudio
      ? field('audio', info.audioCodec ?? 'audio', 'green')
      : field('audio', 'N_aud', 'red')
  )
  if (info.rotation !== 0) fields.push(field('rotate', String(info.rotation), 'green'))
  if (info.videoCodec !== null) fields.push(field('codec', info.videoCodec))
  fields.push(avgrateField(input), sizeField(input), cropField(input), rateField(input))
  const factors = estimateFactors(input)
  if (factors !== null) {
    fields.push(field('otimizedSize', formatSize(optimisedSizeBytes(factors))))
  }
  return fields.filter((f): f is TriageInfoField => f !== null)
}
