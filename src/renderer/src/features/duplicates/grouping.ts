/**
 * Pure grouping / ordering / badge / selection logic of the Duplicates table
 * (duplicates-thumbs.md §7, §8.2-§8.7, port checklist 21-24, 27).
 * Grouping itself is `groupDuplicates` of `@shared/core/duplicates` (the one implementation);
 * this module only shapes its groups into table rows. Windows paths are case-folded by `pathKey`.
 */
import { groupDuplicates, pathKey, roundHalfEven } from '@shared/core/duplicates'
import { HASH_KEYS, type DuplicateGroup, type HashKey, type HashKind, type HashRow } from '@shared/domain/hash'

/** What the table needs to know about a file, from `media:probeMany`; `null` = missing/unreadable. */
export interface FileFacts {
  width: number
  height: number
  bitrateKbps: number
  hasAudio: boolean
  sizeBytes: number
}
export type FactsMap = Readonly<Record<string, FileFacts | null | undefined>>

export interface TableMember {
  path: string
  /** Value of the active key on the row that put this file in the group. */
  value: string
  /** First CSV row of the path. */
  row: HashRow
}

export interface TableRow {
  id: string
  members: TableMember[]
}

export interface KeyCount {
  key: HashKey
  groups: number
  files: number
}

/** One member per distinct path of a group, carrying the first CSV row of that path. */
function membersOf(group: DuplicateGroup): TableMember[] {
  return group.paths.map((path) => {
    const id = pathKey(path)
    const row = group.rows.find((r) => pathKey(r.path) === id) ?? group.rows[0]
    return { path, value: group.value, row: row as HashRow }
  })
}

/** Button counts for the six keys (checklist 23): value groups and distinct files. */
export function keyCounts(rows: readonly HashRow[]): KeyCount[] {
  return HASH_KEYS.map((key) => {
    const groups = groupDuplicates(rows, key)
    const files = new Set(groups.flatMap((g) => g.paths.map((p) => pathKey(p))))
    return { key, groups: groups.length, files: files.size }
  })
}

/** Table rows of a key before ordering: de-duplicated by the ordered member list (§8.2 step 4). */
export function tableRowsForKey(rows: readonly HashRow[], key: HashKey): TableRow[] {
  const seen = new Map<string, TableRow>()
  for (const group of groupDuplicates(rows, key)) {
    const members = membersOf(group)
    const id = members.map((m) => pathKey(m.path)).join('|')
    seen.set(id, { id, members })
  }
  return [...seen.values()]
}

function rank(kind: HashKind, facts: FileFacts | null | undefined): number {
  if (facts === null) return Number.NEGATIVE_INFINITY
  if (facts === undefined) return -1
  return kind === 'image' ? facts.height : facts.bitrateKbps
}

/**
 * Orders members (image: height desc; video/gif: bitrate desc; unreadable last, stable) and hides
 * rows left with fewer than two readable members (§8.2 step 2-3). Unprobed files stay visible.
 */
export function orderRows(rows: readonly TableRow[], kind: HashKind, facts: FactsMap): TableRow[] {
  const result: TableRow[] = []
  for (const row of rows) {
    const readable = row.members.filter((m) => facts[m.path] !== null)
    if (readable.length < 2) continue
    const sorted = readable
      .map((m, index) => ({ m, index, r: rank(kind, facts[m.path]) }))
      .sort((a, b) => b.r - a.r || a.index - b.index)
      .map(({ m }) => m)
    result.push({ id: row.id, members: sorted })
  }
  return result
}

/** Distinct paths of the rows (selection / probing scope). */
export function pathsOf(rows: readonly TableRow[]): string[] {
  const seen = new Map<string, string>()
  for (const row of rows) for (const m of row.members) seen.set(pathKey(m.path), m.path)
  return [...seen.values()]
}

// ---- DIF badge (§8.4) -----------------------------------------------------------------------

export type DifBadge = { kind: 'none' } | { kind: 'blue' } | { kind: 'red'; percent: number }

/** `firstSize` = CSV size of the first member of the row. */
export function difBadge(firstSize: number, size: number): DifBadge {
  if (size === firstSize || size <= 0) return { kind: 'none' }
  const ratio = firstSize / size
  if (ratio > 1.005) return { kind: 'red', percent: roundHalfEven((ratio - 1) * 100) }
  return { kind: 'blue' }
}

// ---- selection helpers (§8.7) ---------------------------------------------------------------

export function selectAll(rows: readonly TableRow[]): string[] {
  return pathsOf(rows)
}

/** Additive: every member except the first (best) one of each row. */
export function unselectFirstColumn(rows: readonly TableRow[], current: readonly string[]): string[] {
  const next = new Map(current.map((p) => [pathKey(p), p]))
  for (const row of rows) {
    for (const m of row.members.slice(1)) next.set(pathKey(m.path), m.path)
  }
  return [...next.values()]
}

export function toggleSelected(current: readonly string[], path: string): string[] {
  const id = pathKey(path)
  return current.some((p) => pathKey(p) === id)
    ? current.filter((p) => pathKey(p) !== id)
    : [...current, path]
}

// ---- openList hook (§8.10) ------------------------------------------------------------------

/** One path per row: the first member with audio if any, else the first member. */
export function firstLinePaths(rows: readonly TableRow[], facts: FactsMap): string[] {
  const picked: string[] = []
  for (const row of rows) {
    const withAudio = row.members.find((m) => facts[m.path]?.hasAudio === true)
    const chosen = withAudio ?? row.members[0]
    if (chosen !== undefined) picked.push(chosen.path)
  }
  return picked
}

/** `##MOVEFILE <tag> <a,b,c>` lines of the hook output -> tag -> paths. */
export function parseMoveFileOutput(text: string): Map<string, string[]> {
  const tags = new Map<string, string[]>()
  for (const match of text.matchAll(/##MOVEFILE (\S+) ([^\r\n]+)/g)) {
    const [, tag, list] = match
    if (tag === undefined || list === undefined) continue
    const paths = list.split(',').map((p) => p.trim()).filter((p) => p !== '')
    tags.set(tag, [...(tags.get(tag) ?? []), ...paths])
  }
  return tags
}

/** Tag `R` selects, `L` deselects, other tags are ignored; only paths shown in the table count. */
export function applyMoveFileTags(
  current: readonly string[],
  tags: ReadonlyMap<string, readonly string[]>,
  rows: readonly TableRow[]
): string[] {
  const known = new Map(pathsOf(rows).map((p) => [pathKey(p), p]))
  const next = new Map(current.map((p) => [pathKey(p), p]))
  for (const path of tags.get('R') ?? []) {
    const known_ = known.get(pathKey(path))
    if (known_ !== undefined) next.set(pathKey(path), known_)
  }
  for (const path of tags.get('L') ?? []) next.delete(pathKey(path))
  return [...next.values()]
}

// ---- feedback / export ----------------------------------------------------------------------

/** Distinct paths with a `worksdWell=False` row (the Feedback list, B10). */
export function unreadablePaths(rows: readonly HashRow[]): string[] {
  const seen = new Map<string, string>()
  for (const row of rows) if (!row.worksdWell) seen.set(pathKey(row.path), row.path)
  return [...seen.values()]
}

/** "Export screen data": `[[path, key], ...]`, row-major. */
export function exportScreenData(rows: readonly TableRow[]): string {
  return JSON.stringify(rows.flatMap((r) => r.members.map((m) => [m.path, m.value])))
}

/** A folder name typed by the user: single segment, no separators or `..`. */
export function sanitizeFolderName(text: string, fallback: string): string | null {
  const name = text.trim()
  if (name === '') return fallback
  if (/[\\/:*?"<>|]/.test(name) || name === '.' || name === '..') return null
  return name
}
