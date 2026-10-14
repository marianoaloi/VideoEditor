/**
 * InfoBar contract: media facts with colour thresholds and the size/time estimates
 * (choicevideos `fillVideo`, `changeDurationSelected`; SPEC acceptance 6).
 * Owner (wave 2): ui-video implements `InfoBar.tsx` and the pure field builder
 * `@shared/core/triageInfo.ts` (formulas, colours); the Cutter reuses both.
 */
import type { MediaInfo } from '@shared/domain/media'
import type { Settings } from '@shared/domain/settings'
import type { JobDraftOverrides } from '../../app/draft'

export type InfoColor = 'green' | 'yellow' | 'red' | 'none'

/** Stable ids, rendered in this order (video-triage.md §3 PORT). */
export const INFO_FIELD_IDS = [
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
export type InfoFieldId = (typeof INFO_FIELD_IDS)[number]

export interface InfoField {
  id: InfoFieldId
  label: string
  /** Display text (`formatSize`, `hms`, ...), already formatted. */
  text: string
  color: InfoColor
  /** Fields that can be overridden for the job: `size`, `rateVideo`, `avgrate`, `crop`. */
  editable: boolean
  /** True when the shown value is the operator's override, not the probed one. */
  overridden: boolean
}

export interface InfoBarProps {
  /** `null` while probing or when analysis is off ("Disable Analise Video"). */
  info: MediaInfo | null
  /** `os.stat` size of the file (the info bar uses disk size, not ffprobe's). */
  fileSizeBytes: number
  /** Player position, original timeline (`TimeSleed`). */
  positionMs: number
  /** Total length of the selected range(s) in ms (drives the `estimativesize`). */
  selectedMs: number
  thresholds: Settings['thresholds']
  overrides: JobDraftOverrides
  onOverridesChange: (patch: Partial<JobDraftOverrides>) => void
  /** "Error in get informations" text when the probe failed. */
  error?: string | null
}
