/**
 * Duplicate grouping with the legacy `MD5Files.processData` semantics (research §7):
 * a value of a key is a duplicate group when it occurs under TWO OR MORE DISTINCT PATHS.
 * Frames of one file never group with themselves; empty values (failure rows) are ignored;
 * rows keep CSV order; groups ascend by value (pandas `groupby` order).
 */
import { HASH_KEYS, type DuplicateGroup, type HashKey, type HashRow } from '../domain/hash'

export interface GroupOptions {
  /** Compare paths case-insensitively (Windows). Display keeps the original spelling. */
  readonly caseInsensitivePaths?: boolean
}

/** Comparison key of a path: `\` -> `/`, repeated and trailing separators dropped, optional lower case. */
export function pathKey(path: string, caseInsensitive = false): string {
  const unified = path.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  const trimmed = unified.length > 1 ? unified.replace(/\/+$/, '') : unified
  return caseInsensitive ? trimmed.toLowerCase() : trimmed
}

interface Bucket {
  readonly rows: HashRow[]
  readonly keys: Set<string>
}

function bucketByValue(rows: readonly HashRow[], key: HashKey, ci: boolean): Map<string, Bucket> {
  const buckets = new Map<string, Bucket>()
  for (const row of rows) {
    const value = row[key]
    if (value === null || value === '') continue
    let bucket = buckets.get(value)
    if (bucket === undefined) {
      bucket = { rows: [], keys: new Set() }
      buckets.set(value, bucket)
    }
    bucket.rows.push(row)
    bucket.keys.add(pathKey(row.path, ci))
  }
  return buckets
}

function distinctPaths(rows: readonly HashRow[], ci: boolean): string[] {
  const seen = new Set<string>()
  const paths: string[] = []
  for (const row of rows) {
    const k = pathKey(row.path, ci)
    if (seen.has(k)) continue
    seen.add(k)
    paths.push(row.path)
  }
  return paths
}

/** (max - min) / max * 100 over the first-row size of each distinct path; 0 when unknown. */
export function sizeDiffPercent(rows: readonly HashRow[], ci = false): number {
  const sizes = new Map<string, number>()
  for (const row of rows) {
    const k = pathKey(row.path, ci)
    if (!sizes.has(k)) sizes.set(k, row.sizeFile)
  }
  const values = [...sizes.values()]
  const max = Math.max(...values)
  return max > 0 ? ((max - Math.min(...values)) / max) * 100 : 0
}

export function groupDuplicates(
  rows: readonly HashRow[],
  key: HashKey,
  options: GroupOptions = {}
): DuplicateGroup[] {
  const ci = options.caseInsensitivePaths === true
  const groups: DuplicateGroup[] = []
  for (const [value, bucket] of bucketByValue(rows, key, ci)) {
    if (bucket.keys.size < 2) continue
    groups.push({
      id: `${key}:${value}`,
      key,
      value,
      paths: distinctPaths(bucket.rows, ci),
      rows: bucket.rows,
      sizeDiffPercent: sizeDiffPercent(bucket.rows, ci)
    })
  }
  return groups.sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0))
}

export function groupAllKeys(
  rows: readonly HashRow[],
  options: GroupOptions = {}
): Record<HashKey, DuplicateGroup[]> {
  const result = {} as Record<HashKey, DuplicateGroup[]>
  for (const key of HASH_KEYS) result[key] = groupDuplicates(rows, key, options)
  return result
}

export interface GroupSummary {
  readonly groups: number
  /** Distinct files across all groups of the key. */
  readonly files: number
}

export function summarizeGroups(groups: readonly DuplicateGroup[], ci = false): GroupSummary {
  const files = new Set<string>()
  for (const group of groups) for (const p of group.paths) files.add(pathKey(p, ci))
  return { groups: groups.length, files: files.size }
}

/**
 * Table rows: one per distinct ordered member list (legacy `"".join(paths)`); the row keeps the
 * position of its first occurrence (research §8.2 step 4). `memberPaths` lets the caller pass the
 * list AFTER its own filtering/sorting (bitrate, height, missing files).
 */
export function dedupeByMembers<T>(items: readonly T[], memberPaths: (item: T) => string[]): T[] {
  const index = new Map<string, number>()
  const out: T[] = []
  for (const item of items) {
    const id = memberPaths(item).join('\u0000')
    const at = index.get(id)
    if (at === undefined) {
      index.set(id, out.length)
      out.push(item)
    } else {
      out[at] = item
    }
  }
  return out
}

/** Distinct existing-file candidates for the Feedback list: paths with a `worksdWell=False` row. */
export function failedPaths(rows: readonly HashRow[], ci = false): string[] {
  return distinctPaths(
    rows.filter((r) => !r.worksdWell),
    ci
  )
}
