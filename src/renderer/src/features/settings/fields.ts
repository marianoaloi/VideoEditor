/**
 * Declarative description of every editable Settings key except the hooks (see `HooksEditor`).
 * The editor renders from this table, so a key added to the schema needs one line here.
 */
import type { Settings, SettingsPatch, SettingsSection } from '@shared/domain/settings'
import { HwaccelSchema } from '@shared/domain/settings'

export type FieldKind =
  | 'int'
  | 'number'
  | 'text'
  /** A single folder name relative to a session root. */
  | 'folder'
  /** Absolute directory or `null`; has a Browse button. */
  | 'dir'
  /** Absolute file or `null`; has a Browse button. */
  | 'file'
  | 'bool'
  | 'enum'
  /** Comma separated list of words. */
  | 'list'

export interface FieldDef {
  readonly path: readonly string[]
  readonly label: string
  readonly kind: FieldKind
  readonly help?: string
  readonly options?: readonly string[]
  readonly unit?: string
}

export interface SectionDef {
  readonly id: Exclude<SettingsSection, 'hooks'>
  readonly title: string
  readonly fields: readonly FieldDef[]
}

const f = (
  section: SectionDef['id'],
  key: string,
  label: string,
  kind: FieldKind,
  extra: Partial<Pick<FieldDef, 'help' | 'options' | 'unit'>> = {}
): FieldDef => ({ path: [section, ...key.split('.')], label, kind, ...extra })

export const SECTIONS: readonly SectionDef[] = [
  {
    id: 'folders',
    title: 'Folders',
    fields: [
      f('folders', 'left', 'Left (L)', 'folder'),
      f('folders', 'right', 'Right (R)', 'folder'),
      f('folders', 'custom', 'Custom', 'folder'),
      f('folders', 'purge', 'Duplicates purge', 'folder'),
      f('folders', 'backup', 'Image backup', 'folder'),
      f('folders', 'ruim', 'Rejected / orphan files', 'folder'),
      f('folders', 'personal', 'Personal folder (P key)', 'dir', {
        help: 'Empty disables the P key.'
      })
    ]
  },
  {
    id: 'thresholds',
    title: 'Thresholds',
    fields: [
      f('thresholds', 'maxRateKbps', 'Bitrate cap', 'int', { unit: 'kbit/s' }),
      f('thresholds', 'maxSide', 'Longest output side', 'int', { unit: 'px' }),
      f('thresholds', 'maxOutputBytes', 'Output size budget', 'int', { unit: 'bytes' }),
      f('thresholds', 'targetPixels', 'Pixel budget', 'int', { unit: 'px' }),
      f('thresholds', 'minOutputBytes', 'Smallest valid output', 'int', { unit: 'bytes' }),
      f('thresholds', 'fileSize.greenBelowBytes', 'File size green below', 'int', { unit: 'bytes' }),
      f('thresholds', 'fileSize.yellowBelowBytes', 'File size yellow below', 'int', { unit: 'bytes' }),
      f('thresholds', 'duration.greenBelowMs', 'Duration green below', 'int', { unit: 'ms' }),
      f('thresholds', 'duration.yellowBelowMs', 'Duration yellow below', 'int', { unit: 'ms' }),
      f('thresholds', 'selection.greenBelowMs', 'Selection green below', 'int', { unit: 'ms' }),
      f('thresholds', 'selection.yellowBelowMs', 'Selection yellow below', 'int', { unit: 'ms' }),
      f('thresholds', 'fps.greenAbove', 'FPS green above', 'number'),
      f('thresholds', 'fps.yellowAbove', 'FPS yellow above', 'number'),
      f('thresholds', 'width.redAbove', 'Width red above', 'int', { unit: 'px' }),
      f('thresholds', 'width.yellowAbove', 'Width yellow above', 'int', { unit: 'px' }),
      f('thresholds', 'bitrate.redAboveKbps', 'Bitrate red above', 'int', { unit: 'kbit/s' }),
      f('thresholds', 'bitrate.yellowAboveKbps', 'Bitrate yellow above', 'int', { unit: 'kbit/s' }),
      f('thresholds', 'duplicateSizeDiffPercent', 'Duplicate size difference', 'number', {
        unit: '%'
      })
    ]
  },
  {
    id: 'ffmpeg',
    title: 'ffmpeg',
    fields: [
      f('ffmpeg', 'ffmpegPath', 'ffmpeg executable', 'file', { help: 'Empty: look it up on PATH.' }),
      f('ffmpeg', 'ffprobePath', 'ffprobe executable', 'file', {
        help: 'Empty: look it up on PATH.'
      }),
      f('ffmpeg', 'encoders', 'Encoder chain', 'list', {
        help: 'Comma separated; tried in order, the last one is the CPU fallback.'
      }),
      f('ffmpeg', 'hwaccel', 'Hardware acceleration', 'enum', { options: HwaccelSchema.options }),
      f('ffmpeg', 'concurrency', 'Parallel jobs', 'int', { help: '1 to 8.' })
    ]
  },
  {
    id: 'player',
    title: 'Player',
    fields: [
      f('player', 'stayOnTop', 'Keep the window on top', 'bool'),
      f('player', 'startPaused', 'Open videos paused', 'bool'),
      f('player', 'volume', 'Volume', 'number', { help: '0 to 1.' })
    ]
  },
  {
    id: 'videoTriage',
    title: 'Video Triage',
    fields: [
      f('videoTriage', 'analyse', 'Analyse videos (player and ffprobe)', 'bool'),
      f('videoTriage', 'errorMoveR', 'Move unreadable files to R', 'bool')
    ]
  },
  {
    id: 'thumbs',
    title: 'Thumbnails',
    fields: [
      f('thumbs', 'enabled', 'Show the 4x4 mosaic', 'bool'),
      f('thumbs', 'prefetch', 'Prefetch next items', 'int', { help: '0 to 20.' }),
      f('thumbs', 'cacheDir', 'Cache folder', 'dir', { help: 'Empty: use the app data folder.' })
    ]
  },
  {
    id: 'imageTriage',
    title: 'Image Triage',
    fields: [
      f('imageTriage', 'visibleCount', 'Images in the strip', 'int', { help: '1 to 9.' }),
      f('imageTriage', 'leftDir', 'Left folder name', 'folder'),
      f('imageTriage', 'rightDir', 'Right folder name', 'folder'),
      f('imageTriage', 'autoAdvanceMs', 'Auto-advance interval', 'int', {
        unit: 'ms',
        help: '100 to 60000.'
      }),
      f('imageTriage', 'sendPreclean', 'Clean zero-byte files and logs before "send"', 'bool')
    ]
  }
]

// ---- immutable path helpers -----------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getIn(source: unknown, path: readonly string[]): unknown {
  let current: unknown = source
  for (const key of path) {
    if (!isRecord(current)) return undefined
    current = current[key]
  }
  return current
}

export function setIn<T>(source: T, path: readonly string[], value: unknown): T {
  const [head, ...rest] = path
  if (head === undefined) return value as T
  const record: Record<string, unknown> = isRecord(source) ? source : {}
  return { ...record, [head]: setIn(record[head], rest, value) } as T
}

// ---- value <-> text -------------------------------------------------------------------------

export function listToText(value: unknown): string {
  return Array.isArray(value) ? value.join(', ') : ''
}

export function textToList(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

// ---- saving ---------------------------------------------------------------------------------

/** Hook keys the user removed cannot be deleted by a deep merge; they are sent as `''`. */
function withClearedHookKeys(base: Settings['hooks'], next: Settings['hooks']): Settings['hooks'] {
  const result = { ...next }
  for (const name of Object.keys(next) as (keyof Settings['hooks'])[]) {
    const before = base[name]
    const after = next[name]
    const env = { ...(after.env ?? {}) }
    for (const key of Object.keys(before.env ?? {})) env[key] ??= ''
    const cleared = {
      ...after,
      ...(Object.keys(env).length > 0 ? { env } : {}),
      ...(before.cwd !== undefined && before.cwd !== '' && after.cwd === undefined ? { cwd: '' } : {})
    }
    result[name] = cleared
  }
  return result
}

/** Sections that differ between the stored settings and the draft, as a deep-partial patch. */
export function buildPatch(base: Settings, draft: Settings): SettingsPatch {
  const patch: Record<string, unknown> = {}
  for (const section of ['folders', 'thresholds', 'ffmpeg', 'player', 'videoTriage', 'thumbs', 'imageTriage', 'hooks'] as const) {
    if (JSON.stringify(base[section]) === JSON.stringify(draft[section])) continue
    patch[section] =
      section === 'hooks' ? withClearedHookKeys(base.hooks, draft.hooks) : draft[section]
  }
  return patch as SettingsPatch
}
