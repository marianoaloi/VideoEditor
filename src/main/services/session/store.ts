/** Session registry: scan, rescan, close, and the `sessions` service slot (CONTRACT §4). */
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { matchesKindFilter, mediaKindOf } from '@shared/core/mediaKind'
import type { OpenFolderRequest, Session, SessionItem } from '@shared/domain/session'
import { appError } from '../../ipc/errors'
import type { MainContext, SessionRecord, SessionStore } from '../../ipc/context'
import { resolveGuardedPath } from '../../ipc/pathGuard'
import { grantRoot, revokeRoots } from '../media/access'
import { JOURNAL_DIR_NAME, scanFolder, type ScanOptions } from './scan'

const PROGRESS_INTERVAL_MS = 100

interface Entry {
  record: SessionRecord
  granted: string[]
  requestId: string | undefined
}

export interface SessionService extends SessionStore {
  open(request: Required<Pick<OpenFolderRequest, 'dir' | 'recursive' | 'kind' | 'sort'>> & { requestId?: string }): Promise<Session>
  rescan(sessionId: string): Promise<Session>
  close(sessionId: string): void
}

function skipNamesFor(ctx: MainContext): { atRoot: string[]; everywhere: string[]; dirs: string[] } {
  const s = ctx.settings.get()
  const f = s.folders
  const atRoot = [f.left, f.right, f.custom, f.purge, f.ruim, s.imageTriage.leftDir, s.imageTriage.rightDir]
  const cache = s.thumbs.cacheDir ?? path.join(ctx.paths.userData, 'thumbs')
  return { atRoot: [...atRoot, JOURNAL_DIR_NAME], everywhere: [f.backup], dirs: [cache] }
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate)
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel)
}

export function createSessionService(ctx: MainContext): SessionService {
  const sessions = new Map<string, Entry>()

  const scan = async (record: SessionRecord, requestId: string | undefined): Promise<Session> => {
    const skip = skipNamesFor(ctx)
    let lastEmit = 0
    const emit = (scanned: number, matched: number, done: boolean): void => {
      ctx.sendEvent('session:scanProgress', {
        ...(requestId === undefined ? {} : { requestId }),
        root: record.root,
        scanned,
        matched,
        done
      })
    }
    const options: ScanOptions = {
      root: record.root,
      recursive: record.recursive,
      kind: record.kind,
      sort: record.sort,
      skipAtRoot: skip.atRoot,
      skipEverywhere: skip.everywhere,
      skipDirs: skip.dirs,
      newId: ctx.newId,
      onProgress: (scanned, matched) => {
        const now = Date.now()
        if (now - lastEmit < PROGRESS_INTERVAL_MS) return
        lastEmit = now
        emit(scanned, matched, false)
      }
    }
    const result = await scanFolder(options)
    emit(result.items.length + result.unreadable, result.items.length, true)
    return { ...record, items: result.items, skippedDirs: result.skippedDirs }
  }

  const service: SessionService = {
    async open(request) {
      // H2: only a folder the user picked/dropped (or one inside it) can become a session root.
      const root = await resolveGuardedPath(ctx, request.dir)
      const info = await stat(root).catch(() => null)
      if (info === null || !info.isDirectory()) throw appError('NOT_FOUND', `Folder not found: ${root}`, { path: root })
      const record: SessionRecord = {
        id: ctx.newId(),
        root,
        recursive: request.recursive,
        kind: request.kind,
        sort: request.sort,
        openedAt: Date.now()
      }
      const granted = await grantRoot(ctx.allowlist, root)
      try {
        const session = await scan(record, request.requestId)
        sessions.set(record.id, { record, granted, requestId: request.requestId })
        return session
      } catch (error) {
        revokeRoots(ctx.allowlist, granted)
        throw error
      }
    },
    async rescan(sessionId) {
      const entry = sessions.get(sessionId)
      if (entry === undefined) throw appError('SESSION_NOT_FOUND', `Unknown session ${sessionId}`)
      return scan(entry.record, entry.requestId)
    },
    close(sessionId) {
      const entry = sessions.get(sessionId)
      if (entry === undefined) return
      sessions.delete(sessionId)
      revokeRoots(ctx.allowlist, entry.granted)
    },
    get: (id) => sessions.get(id)?.record,
    require(id) {
      const record = sessions.get(id)?.record
      if (record === undefined) throw appError('SESSION_NOT_FOUND', `Unknown session ${id}`, { sessionId: id })
      return record
    },
    async itemFor(sessionId, absPath) {
      const record = sessions.get(sessionId)?.record
      if (record === undefined) return null
      return buildItem(ctx, record, absPath)
    }
  }
  return service
}

async function buildItem(ctx: MainContext, record: SessionRecord, absPath: string): Promise<SessionItem | null> {
  const full = path.resolve(absPath)
  if (!isInside(record.root, full)) return null
  const name = path.basename(full)
  const kind = mediaKindOf(name)
  if (kind === null || !matchesKindFilter(kind, record.kind)) return null
  const info = await stat(full).catch(() => null)
  if (info === null || !info.isFile()) return null
  const relDir = path.relative(record.root, path.dirname(full))
  if (!record.recursive && relDir.length > 0) return null
  return { id: ctx.newId(), path: full, relDir, name, sizeBytes: info.size, mtimeMs: info.mtimeMs, kind }
}
