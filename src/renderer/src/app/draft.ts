/**
 * The in-memory job draft shared by Video Triage and the Cutter: ranges being edited plus the
 * overrides of the info bar (LEG §4.1, video-triage.md §3). `toVideoJobDraft` converts it to the
 * `jobs:saveJob` payload.
 */
import { ProcessingMode, type Range, type VideoJobDraft } from '@shared/domain/job'
import type { Rect } from '@shared/domain/geometry'

export interface JobDraftOverrides {
  /** `"WxH"`, `"W:H"` or `"-1"`; `null` = automatic. */
  size: string | null
  /** kbit/s; `null` = source bitrate capped by settings. */
  rate: number | null
  avgrate: number | null
  crop: Rect | null
  bright: number | null
  contrast: number | null
  transpose: number | null
}

export interface JobDraftState {
  /** Finished ranges `[startMs, endMs]`, insertion order (concat sorts when saving). */
  ranges: Range[]
  /** Range handles (range slider), in the ORIGINAL timeline (transcode offset already applied). */
  low: number
  high: number
  /** The open end of a range being marked with X (`null` = idle). */
  pendingStartMs: number | null
  overrides: JobDraftOverrides
  convert: boolean
  posExecution: ProcessingMode
}

export const NO_OVERRIDES: JobDraftOverrides = {
  size: null,
  rate: null,
  avgrate: null,
  crop: null,
  bright: null,
  contrast: null,
  transpose: null
}

export function createJobDraft(): JobDraftState {
  return {
    ranges: [],
    low: 0,
    high: 0,
    pendingStartMs: null,
    overrides: { ...NO_OVERRIDES },
    convert: false,
    posExecution: ProcessingMode.cut
  }
}

/**
 * The `jobs:saveJob` draft. Concat sorts the ranges by start (legacy M:646-647); cut keeps the
 * insertion order. `[]` stays empty: main/ffmpegArgs treat it as "the whole video".
 */
export function toVideoJobDraft(draft: JobDraftState, originalPath?: string): VideoJobDraft {
  const times =
    draft.posExecution === ProcessingMode.concat
      ? [...draft.ranges].sort((a, b) => a[0] - b[0])
      : [...draft.ranges]
  return {
    ...(originalPath === undefined ? {} : { originalPath }),
    crop: draft.overrides.crop,
    bright: draft.overrides.bright,
    contrast: draft.overrides.contrast,
    transpose: draft.overrides.transpose,
    convert: draft.convert,
    size: draft.overrides.size,
    rate: draft.overrides.rate,
    avgrate: draft.overrides.avgrate,
    times,
    posExecution: draft.posExecution
  }
}
