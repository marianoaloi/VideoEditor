/** `hashing:*` handlers (CONTRACT §2 hashing, ADR-007). Owner: svc-hash. */
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { HashBuildRequest, HashBuildResult, HashRow, HashTable } from '@shared/domain/hash'
import type { MainContext } from '../../ipc/context'
import { AppError } from '../../ipc/errors'
import { handle } from '../../ipc/handle'
import { resolveGuardedPath } from '../../ipc/pathGuard'
import { grantRoot } from '../media/access'
import { requireTool } from '../ffmpeg/locate'
import { buildHashCsv } from './build'
import {
  MIXED_ORIGIN_WARNING,
  concatRows,
  cleanCsv,
  foreignRoots,
  isTsOrigin,
  locateCsv,
  readRows,
  writeRows
} from './csvStore'
import { createTsHashProvider } from './tsProvider'

const md5 = (data: Uint8Array): string => createHash('md5').update(data).digest('hex')
const CSV_EXTENSIONS = new Set(['.txt', '.csv'])
/** Hash files made by this app (and the legacy suite) sit NEXT TO the scanned folder. */
const OWN_CSV_NAME = /resultsMD5\.(txt|csv)$/i

function checkCsvName(csvPath: string): void {
  if (!CSV_EXTENSIONS.has(path.extname(csvPath).toLowerCase())) {
    throw new AppError('VALIDATION', 'A hash file must be a .txt or .csv file', { csvPath })
  }
}

/**
 * A hash file is allowed when it passes the normal path guard (inside an opened folder, or a file
 * the user picked in a dialog), or when it is a `*resultsMD5.txt|csv` file beside an approved
 * folder (the default location, next to the scanned folder).
 */
async function guardCsv(ctx: MainContext, csvPath: string): Promise<string> {
  checkCsvName(csvPath)
  try {
    return await resolveGuardedPath(ctx, csvPath)
  } catch (error) {
    if (!OWN_CSV_NAME.test(path.basename(csvPath))) throw error
    const parent = path.dirname(path.resolve(csvPath))
    const roots = [...ctx.allowlist.roots(), ...ctx.approvals.roots()]
    const beside = roots.some((root) => path.dirname(path.resolve(root)) === parent)
    if (!beside) throw error
    return path.resolve(csvPath)
  }
}

function table(csvPath: string, rows: HashRow[]): HashTable {
  return { csvPath, rows }
}

export function registerHashingIpc(ctx: MainContext): void {
  const tasks = new Map<string, AbortController>()
  const allowed = new Set<string>()

  const allowDir = async (dir: string): Promise<void> => {
    const key = path.resolve(dir)
    if (allowed.has(key)) return
    allowed.add(key)
    await grantRoot(ctx.allowlist, key)
  }

  const runBuild = async (req: HashBuildRequest): Promise<HashBuildResult> => {
    if (tasks.has(req.taskId)) throw new AppError('CONFLICT', `Task ${req.taskId} is running`)
    const dir = await resolveGuardedPath(ctx, req.dir)
    const settings = ctx.settings.get()
    const controller = new AbortController()
    tasks.set(req.taskId, controller)
    try {
      await allowDir(dir)
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

  // Rebuild = build: the scan writes a temp file and renames it over the CSV only when complete,
  // so cancel/failure keeps the old CSV (review H4). Nothing is deleted beforehand.
  handle('hashing:build', (req) => runBuild(req))
  handle('hashing:rebuild', (req) => runBuild(req))

  handle('hashing:load', async ({ source }) => {
    if ('csvPath' in source) {
      const csvPath = await guardCsv(ctx, source.csvPath)
      return table(csvPath, await readRows(csvPath))
    }
    const dir = await resolveGuardedPath(ctx, source.dir)
    const { csvPath } = await locateCsv(dir, source.kind)
    const rows = await readRows(csvPath)
    const foreign = foreignRoots(rows, dir)
    if (foreign.length > 0) {
      throw new AppError(
        'CONFLICT',
        'This hash file was made for another folder. Rebuild it, or open it by file.',
        { csvPath, foreignRoots: foreign.slice(0, 5) }
      )
    }
    await allowDir(dir)
    return table(csvPath, rows)
  })

  handle('hashing:save', async (req) => {
    const csvPath = await guardCsv(ctx, req.csvPath)
    return { csvPath, rowCount: await writeRows(csvPath, req.rows) }
  })

  handle('hashing:concat', async (req) => {
    const csvPath = await guardCsv(ctx, req.csvPath)
    const otherCsvPath = await guardCsv(ctx, req.otherCsvPath)
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

  handle('hashing:clean', async (req) => {
    const csvPath = await guardCsv(ctx, req.csvPath)
    const cleaned = await cleanCsv(csvPath)
    return { table: table(csvPath, cleaned.rows), removed: cleaned.removed }
  })

  handle('hashing:csvPath', async (req) => {
    const { csvPath, exists } = await locateCsv(await resolveGuardedPath(ctx, req.dir), req.kind)
    return { csvPath, exists }
  })

  handle('hashing:cancel', ({ taskId }) => {
    tasks.get(taskId)?.abort()
  })
}
