/**
 * The hash scan (`localMD5.process`, research §2): walk, hash every matching file, write the CSV.
 * Differences from the legacy on purpose (research §10): streamed read-only MD5 (B1), atomic CSV
 * write via a temp file (B4), failure row for videos without a decodable frame (B5), exclusions
 * and a deterministic order (B3), throttled progress with a guaranteed final event (B25),
 * cancellation through an `AbortSignal` (a cancelled scan leaves no new CSV).
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type { PerceptualKeys } from '@shared/core/hashPrimitives'
import { csvHeaderLine, csvRowLine } from '@shared/core/hashCsv'
import type { HashKind, HashProgress, HashRow } from '@shared/domain/hash'
import { AppError } from '../../ipc/errors'
import { csvPathFor, writeMeta } from './csvStore'
import { acceptsFile } from './kinds'
import type { HashProvider } from './provider'
import { walkFiles, type WalkedFile } from './walk'

export interface BuildOptions {
  readonly dir: string
  readonly kind: HashKind
  readonly taskId: string
  readonly provider: HashProvider
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: HashProgress) => void
  readonly excludeNames?: readonly string[]
  readonly excludePaths?: readonly string[]
  /** Files hashed in parallel (rows are still written in walk order). Default 2. */
  readonly concurrency?: number
  /** Minimum ms between non-final progress events. Default 250 (about 4 per second). */
  readonly progressIntervalMs?: number
}

export interface BuildOutcome {
  readonly csvPath: string
  readonly fileCount: number
  readonly rowCount: number
  readonly failedCount: number
  readonly cancelled: boolean
}

export async function md5OfFile(file: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('md5')
  const stream = createReadStream(file, {
    highWaterMark: 1 << 20,
    ...(signal === undefined ? {} : { signal })
  })
  for await (const chunk of stream) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

const EMPTY_KEYS = {
  md5: null,
  pureMD5: null,
  hash16: null,
  hash8: null,
  thumbLight: null,
  thumbDark: null
} as const

function failureRow(file: WalkedFile, size: number, comments: string): HashRow {
  return {
    root: file.root,
    inFile: file.name,
    path: file.path,
    ...EMPTY_KEYS,
    worksdWell: false,
    sizeFile: size,
    comments
  }
}

function successRow(file: WalkedFile, size: number, md5: string, k: PerceptualKeys): HashRow {
  return {
    root: file.root,
    inFile: file.name,
    path: file.path,
    md5,
    pureMD5: k.pureMD5,
    hash16: k.hash16,
    hash8: k.hash8,
    thumbLight: k.thumbLight,
    thumbDark: k.thumbDark,
    worksdWell: true,
    sizeFile: size,
    comments: ''
  }
}

interface FileResult {
  readonly rows: HashRow[]
  readonly failed: boolean
}

async function hashOne(file: WalkedFile, o: BuildOptions): Promise<FileResult> {
  let size = 0
  try {
    size = (await stat(file.path)).size
    const md5 = await md5OfFile(file.path, o.signal)
    const keys =
      o.kind === 'image'
        ? await o.provider.hashImage(file.path, o.signal)
        : await o.provider.hashVideo(file.path, o.signal)
    if (keys.length === 0) return { rows: [failureRow(file, size, 'no decodable frame')], failed: true }
    return { rows: keys.map((k) => successRow(file, size, md5, k)), failed: false }
  } catch (error) {
    if (o.signal?.aborted === true) throw error
    const message = error instanceof Error ? error.message : String(error)
    return { rows: [failureRow(file, size, message)], failed: true }
  }
}

/** Emits at most one event per interval; phase changes and `done` always go out. */
type Emit = (p: Omit<HashProgress, 'taskId' | 'dir'>, force?: boolean) => void

function progressEmitter(o: BuildOptions): Emit {
  let last = 0
  let phase: HashProgress['phase'] | null = null
  const interval = o.progressIntervalMs ?? 250
  return (p: Omit<HashProgress, 'taskId' | 'dir'>, force = false): void => {
    const now = Date.now()
    if (!force && p.phase === phase && now - last < interval) return
    phase = p.phase
    last = now
    o.onProgress?.({ taskId: o.taskId, dir: path.resolve(o.dir), ...p })
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || Reflect.get(error, 'code') === 'ABORT_ERR')
}

export async function buildHashCsv(o: BuildOptions): Promise<BuildOutcome> {
  const root = path.resolve(o.dir)
  if (!(await stat(root).then((s) => s.isDirectory(), () => false))) {
    throw new AppError('NOT_FOUND', `Folder not found: ${root}`, { dir: root })
  }
  const csvPath = csvPathFor(root, o.kind)
  const emit = progressEmitter(o)
  const counts = { done: 0, failed: 0, rows: 0 }
  emit({ phase: 'scanning', done: 0, total: 0, failed: 0 }, true)
  let tmp: string | null = null
  try {
    const { files } = await walkFiles(root, {
      accept: (name) => acceptsFile(o.kind, name),
      excludeNames: o.excludeNames ?? [],
      excludePaths: o.excludePaths ?? [],
      ...(o.signal === undefined ? {} : { signal: o.signal })
    })
    tmp = `${csvPath}.tmp`
    const handle = await open(tmp, 'w')
    try {
      await handle.write(csvHeaderLine())
      emit({ phase: 'hashing', done: 0, total: files.length, failed: 0 }, true)
      await hashAll(files, o, handle, counts, emit)
      o.signal?.throwIfAborted()
    } finally {
      await handle.close()
    }
    emit({ phase: 'writing', done: counts.done, total: files.length, failed: counts.failed }, true)
    await rename(tmp, csvPath)
    tmp = null
    await writeMeta(csvPath, root, o.provider.id)
    await o.provider.dispose?.()
    emit({ phase: 'done', done: counts.done, total: files.length, failed: counts.failed }, true)
    return { csvPath, fileCount: files.length, rowCount: counts.rows, failedCount: counts.failed, cancelled: false }
  } catch (error) {
    if (tmp !== null) await rm(tmp, { force: true })
    await o.provider.dispose?.()
    if (o.signal?.aborted !== true && !isAbort(error)) throw error
    emit({ phase: 'done', done: counts.done, total: 0, failed: counts.failed }, true)
    return { csvPath, fileCount: counts.done, rowCount: counts.rows, failedCount: counts.failed, cancelled: true }
  }
}

interface Counts {
  done: number
  failed: number
  rows: number
}

async function hashAll(
  files: readonly WalkedFile[],
  o: BuildOptions,
  handle: Awaited<ReturnType<typeof open>>,
  counts: Counts,
  emit: Emit
): Promise<void> {
  const lanes = Math.max(1, o.concurrency ?? 2)
  const results = new Map<number, FileResult>()
  let nextToStart = 0
  let nextToWrite = 0
  let flushing: Promise<void> = Promise.resolve()
  const flush = async (): Promise<void> => {
    for (let r = results.get(nextToWrite); r !== undefined; r = results.get(nextToWrite)) {
      results.delete(nextToWrite)
      await handle.write(r.rows.map(csvRowLine).join(''))
      counts.rows += r.rows.length
      counts.done += 1
      if (r.failed) counts.failed += 1
      emit({
        phase: 'hashing',
        done: counts.done,
        total: files.length,
        failed: counts.failed,
        currentPath: (files[nextToWrite] as WalkedFile).path
      })
      nextToWrite += 1
    }
  }
  const lane = async (): Promise<void> => {
    while (nextToStart < files.length) {
      o.signal?.throwIfAborted()
      const index = nextToStart++
      results.set(index, await hashOne(files[index] as WalkedFile, o))
      flushing = flushing.then(flush)
      await flushing
    }
  }
  await Promise.all(Array.from({ length: Math.min(lanes, files.length) }, lane))
}
