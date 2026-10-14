/** `hashing:*` handlers (CONTRACT §2 hashing, ADR-007). Owner: svc-hash. */
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { HashBuildRequest, HashBuildResult, HashRow, HashTable } from '@shared/domain/hash'
import type { MainContext } from '../../ipc/context'
import { AppError } from '../../ipc/errors'
import { handle } from '../../ipc/handle'
import { requireTool } from '../ffmpeg/locate'
import { buildHashCsv } from './build'
import {
  MIXED_ORIGIN_WARNING,
  concatRows,
  csvExists,
  csvPathFor,
  dropMissing,
  foreignRoots,
  isTsOrigin,
  readRows,
  removeCsv,
  writeRows
} from './csvStore'
import { createTsHashProvider } from './tsProvider'

const md5 = (data: Uint8Array): string => createHash('md5').update(data).digest('hex')
const CSV_EXTENSIONS = new Set(['.txt', '.csv'])

function checkCsvName(csvPath: string): void {
  if (!CSV_EXTENSIONS.has(path.extname(csvPath).toLowerCase())) {
    throw new AppError('VALIDATION', 'A hash file must be a .txt or .csv file', { csvPath })
  }
}

function table(csvPath: string, rows: HashRow[]): HashTable {
  return { csvPath, rows }
}

export function registerHashingIpc(ctx: MainContext): void {
  const tasks = new Map<string, AbortController>()
  const allowed = new Set<string>()

  const allowDir = (dir: string): void => {
    const key = path.resolve(dir)
    if (allowed.has(key)) return
    allowed.add(key)
    ctx.allowlist.addRoot(key)
  }

  const runBuild = async (req: HashBuildRequest, rebuild: boolean): Promise<HashBuildResult> => {
    if (tasks.has(req.taskId)) throw new AppError('CONFLICT', `Task ${req.taskId} is running`)
    const dir = path.resolve(req.dir)
    const settings = ctx.settings.get()
    const controller = new AbortController()
    tasks.set(req.taskId, controller)
    try {
      allowDir(dir)
      if (rebuild) await removeCsv(csvPathFor(dir, req.kind))
      const provider = createTsHashProvider({
        md5,
        tools: () => ({
          ffmpegPath: requireTool('ffmpeg', settings.ffmpeg).path,
          ffprobePath: requireTool('ffprobe', settings.ffmpeg).path
        })
      })
      const cache = settings.thumbs.cacheDir ?? path.join(ctx.paths.userData, 'thumbs')
      const { folders } = settings
      const outcome = await buildHashCsv({
        dir,
        kind: req.kind,
        taskId: req.taskId,
        provider,
        signal: controller.signal,
        onProgress: (p) => ctx.sendEvent('hashing:progress', p),
        excludeNames: [folders.purge, folders.ruim, folders.backup, '.mediamaloi'],
        excludePaths: [cache],
        concurrency: req.kind === 'image' ? 3 : 2
      })
      return { taskId: req.taskId, ...outcome }
    } finally {
      tasks.delete(req.taskId)
    }
  }

  handle('hashing:build', (req) => runBuild(req, false))
  handle('hashing:rebuild', (req) => runBuild(req, true))

  handle('hashing:load', async ({ source }) => {
    if ('csvPath' in source) {
      checkCsvName(source.csvPath)
      return table(source.csvPath, await readRows(source.csvPath))
    }
    const csvPath = csvPathFor(source.dir, source.kind)
    const rows = await readRows(csvPath)
    const foreign = foreignRoots(rows, source.dir)
    if (foreign.length > 0) {
      throw new AppError(
        'CONFLICT',
        'This hash file was made for another folder. Rebuild it, or open it by file.',
        { csvPath, foreignRoots: foreign.slice(0, 5) }
      )
    }
    allowDir(source.dir)
    return table(csvPath, rows)
  })

  handle('hashing:save', async ({ csvPath, rows }) => {
    checkCsvName(csvPath)
    return { csvPath, rowCount: await writeRows(csvPath, rows) }
  })

  handle('hashing:concat', async ({ csvPath, otherCsvPath }) => {
    checkCsvName(csvPath)
    checkCsvName(otherCsvPath)
    const current = await readRows(csvPath)
    const other = await readRows(otherCsvPath)
    const merged = concatRows(current, other)
    const mixed = (await isTsOrigin(csvPath)) !== (await isTsOrigin(otherCsvPath))
    return {
      table: table(csvPath, merged.rows),
      added: merged.added,
      warning: mixed ? MIXED_ORIGIN_WARNING : null
    }
  })

  handle('hashing:clean', async ({ csvPath }) => {
    checkCsvName(csvPath)
    const rows = await readRows(csvPath)
    const kept = await dropMissing(rows)
    if (kept.length !== rows.length) await writeRows(csvPath, kept)
    return { table: table(csvPath, kept), removed: rows.length - kept.length }
  })

  handle('hashing:csvPath', async ({ dir, kind }) => {
    const csvPath = csvPathFor(dir, kind)
    return { csvPath, exists: await csvExists(csvPath) }
  })

  handle('hashing:cancel', ({ taskId }) => {
    tasks.get(taskId)?.abort()
  })
}
