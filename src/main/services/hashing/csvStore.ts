/**
 * Hash CSV files on disk (research §3, §8.10): location, atomic write, load with root guard,
 * clean, concat and the `<csv>.meta.json` sidecar that records the hash origin (ADR-007).
 */
import { copyFile, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseHashCsv, serializeHashCsv } from '@shared/core/hashCsv'
import { HASH_CSV_PREFIX, HASH_CSV_SUFFIX, type HashKind, type HashRow } from '@shared/domain/hash'
import { AppError } from '../../ipc/errors'
import { HASH_ALGO_VERSION, HASH_ORIGIN, type CsvMeta } from './provider'

const MAX_FOLDER_PART = 100
// eslint-disable-next-line no-control-regex -- control characters are invalid in Windows names
const UNSAFE_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g

/**
 * Legacy location and name (`join(dirname(resolve(root)), prefix + "resultsMD5.txt")`), shared by
 * every sibling folder: rebuilding one overwrote the others' CSV (review H4). Still LOADED when
 * the per-folder file is absent, never written by this app. A drive root keeps the CSV inside.
 */
export function legacyCsvPathFor(dir: string, kind: HashKind): string {
  const root = path.resolve(dir)
  const parent = path.dirname(root)
  return path.join(parent === root ? root : parent, `${HASH_CSV_PREFIX[kind]}${HASH_CSV_SUFFIX}`)
}

/** Per-folder CSV next to the folder: `<folderName>_<prefix>resultsMD5.txt` (ADR-007 addendum). */
export function csvPathFor(dir: string, kind: HashKind): string {
  const root = path.resolve(dir)
  const parent = path.dirname(root)
  if (parent === root) return legacyCsvPathFor(dir, kind)
  const folder = path.basename(root).replace(UNSAFE_NAME_CHARS, '_').slice(0, MAX_FOLDER_PART)
  return path.join(parent, `${folder}_${HASH_CSV_PREFIX[kind]}${HASH_CSV_SUFFIX}`)
}

export interface LocatedCsv {
  readonly csvPath: string
  readonly exists: boolean
  /** The file is the shared legacy one. */
  readonly legacy: boolean
}

/** The per-folder CSV when present, else the legacy one when present, else the per-folder path. */
export async function locateCsv(dir: string, kind: HashKind): Promise<LocatedCsv> {
  const current = csvPathFor(dir, kind)
  if (await csvExists(current)) return { csvPath: current, exists: true, legacy: false }
  const legacy = legacyCsvPathFor(dir, kind)
  if (legacy !== current && (await csvExists(legacy))) return { csvPath: legacy, exists: true, legacy: true }
  return { csvPath: current, exists: false, legacy: false }
}

export function metaPathFor(csvPath: string): string {
  return `${csvPath}.meta.json`
}

function errnoCode(error: unknown): string | undefined {
  return error instanceof Error ? (Reflect.get(error, 'code') as string | undefined) : undefined
}

export async function csvExists(csvPath: string): Promise<boolean> {
  try {
    return (await stat(csvPath)).isFile()
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return false
    throw error
  }
}

export async function readRows(csvPath: string): Promise<HashRow[]> {
  let text: string
  try {
    text = await readFile(csvPath, 'utf8')
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') {
      throw new AppError('NOT_FOUND', `Hash file not found: ${csvPath}`, { csvPath })
    }
    throw error
  }
  try {
    return parseHashCsv(text)
  } catch (error) {
    throw new AppError('VALIDATION', error instanceof Error ? error.message : String(error), {
      csvPath
    })
  }
}

/** Temp file + rename, so an interrupted write never leaves a partial CSV (legacy bug B4). */
export async function atomicWrite(target: string, text: string): Promise<void> {
  const tmp = `${target}.tmp`
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, target)
}

export async function writeRows(csvPath: string, rows: readonly HashRow[]): Promise<number> {
  await atomicWrite(csvPath, serializeHashCsv(rows))
  return rows.length
}

export async function writeMeta(csvPath: string, root: string, provider: string): Promise<void> {
  const meta: CsvMeta = { origin: HASH_ORIGIN, algo: HASH_ALGO_VERSION, provider, root }
  await atomicWrite(metaPathFor(csvPath), JSON.stringify(meta, null, 2))
}

/** `true` when the sidecar says this CSV came from this app; absent/unreadable = legacy. */
export async function isTsOrigin(csvPath: string): Promise<boolean> {
  try {
    const parsed: unknown = JSON.parse(await readFile(metaPathFor(csvPath), 'utf8'))
    return typeof parsed === 'object' && parsed !== null && Reflect.get(parsed, 'origin') === HASH_ORIGIN
  } catch (error) {
    if (errnoCode(error) === 'ENOENT' || error instanceof SyntaxError) return false
    throw error
  }
}

export async function removeCsv(csvPath: string): Promise<void> {
  await rm(csvPath, { force: true })
  await rm(metaPathFor(csvPath), { force: true })
}

function isInside(child: string, parent: string): boolean {
  if (!path.isAbsolute(child)) return false
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Rows whose `root` is outside the scanned folder (a CSV of another folder or machine). */
export function foreignRoots(rows: readonly HashRow[], dir: string): string[] {
  const outside = new Set<string>()
  for (const row of rows) if (!isInside(row.root, dir)) outside.add(row.root)
  return [...outside]
}

export async function fileExists(file: string): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch (error) {
    if (errnoCode(error) === 'ENOENT' || errnoCode(error) === 'ENOTDIR') return false
    throw error
  }
}

/** "Clean analyses": keeps rows whose file still exists. */
export async function dropMissing(rows: readonly HashRow[]): Promise<HashRow[]> {
  const known = new Map<string, boolean>()
  for (const row of rows) {
    if (!known.has(row.path)) known.set(row.path, await fileExists(row.path))
  }
  return rows.filter((row) => known.get(row.path) === true)
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory()
  } catch (error) {
    if (errnoCode(error) === 'ENOENT' || errnoCode(error) === 'ENOTDIR') return false
    throw error
  }
}

export interface CleanOutcome {
  readonly rows: HashRow[]
  readonly removed: number
}

/**
 * "Clean" (review M7): refuses when a root folder of the CSV is not there (unmounted drive, moved
 * folder) or when it would drop every row, and keeps `<csv>.bak` of what it replaced.
 */
export async function cleanCsv(csvPath: string): Promise<CleanOutcome> {
  const rows = await readRows(csvPath)
  const roots = new Set(rows.map((row) => row.root).filter((root) => path.isAbsolute(root)))
  for (const root of roots) {
    if (!(await isDirectory(root))) {
      throw new AppError(
        'VALIDATION',
        `Clean was not run: the folder ${root} is not available (unmounted drive or moved folder?).`,
        { csvPath, root }
      )
    }
  }
  const kept = await dropMissing(rows)
  if (kept.length === 0 && rows.length > 0) {
    throw new AppError('VALIDATION', 'Clean was not run: it would remove every row of the hash file.', {
      csvPath
    })
  }
  if (kept.length === rows.length) return { rows: kept, removed: 0 }
  await copyFile(csvPath, `${csvPath}.bak`)
  await writeRows(csvPath, kept)
  return { rows: kept, removed: rows.length - kept.length }
}

export interface ConcatOutcome {
  readonly rows: HashRow[]
  readonly added: number
}

/**
 * Legacy "Concat other data": all current rows, then the other file's rows whose `pureMD5`
 * occurs in the current data. Empty values never match (legacy bug B15).
 */
export function concatRows(current: readonly HashRow[], other: readonly HashRow[]): ConcatOutcome {
  const known = new Set<string>()
  for (const row of current) if (row.pureMD5 !== null) known.add(row.pureMD5)
  const extra = other.filter((row) => row.pureMD5 !== null && known.has(row.pureMD5))
  return { rows: [...current, ...extra], added: extra.length }
}

export const MIXED_ORIGIN_WARNING =
  'These hash files come from different origins (legacy Python vs this app). ' +
  'Perceptual keys are not comparable across origins, so only exact (md5) matches are reliable. ' +
  'Re-scan the old folders to get comparable keys.'
