/** File operations service: `fileops:*` handlers and the `journal` slot (CONTRACT §2, §4). */
import type { MoveManyResult } from '@shared/domain/fileops'
import { appError, toIpcError } from '../../ipc/errors'
import { handle } from '../../ipc/handle'
import type { MainContext } from '../../ipc/context'
import { precleanFolder, resetFolder } from './folders'
import { createMutex } from './fsutil'
import { createJournal } from './journal'
import { copyOne, folderNameFor, moveOne, trashOne, type OpsDeps } from './operations'
import { undoEntry } from './undo'

export function registerFileopsIpc(ctx: MainContext): void {
  const journal = createJournal(ctx)
  ctx.services.provide('journal', journal)
  const serial = createMutex()
  const deps: OpsDeps = { ctx, journal }
  const sessions = () => ctx.services.require('sessions')

  handle('fileops:move', (req) =>
    serial(async () => {
      const session = sessions().require(req.sessionId)
      return moveOne(deps, session, req.path, folderNameFor(ctx, req.destination))
    })
  )

  handle('fileops:moveMany', (req) =>
    serial(async () => {
      const session = sessions().require(req.sessionId)
      const folder = folderNameFor(ctx, req.destination)
      const result: MoveManyResult = { moved: [], failed: [] }
      for (const file of req.paths) {
        try {
          const moved = await moveOne(deps, session, file, folder, (e) => journal.append(session.root, e, session.id))
          result.moved.push(moved)
        } catch (error) {
          result.failed.push({ path: file, error: toIpcError(error) })
        }
      }
      journal.emit(session.root, session.id, result.moved.map((m) => m.entry))
      return result
    })
  )

  handle('fileops:undo', (req) =>
    serial(async () => {
      const session = sessions().require(req.sessionId)
      return undoEntry(ctx, journal, session, req.entryId, (p) => sessions().itemFor(session.id, p))
    })
  )

  handle('fileops:peekUndo', async (req) => journal.latestUndoable(sessions().require(req.sessionId).root))

  handle('fileops:trash', (req) =>
    serial(async () => ({ entry: await trashOne(deps, sessions().require(req.sessionId), req.path) }))
  )

  handle('fileops:copyToPersonal', (req) =>
    serial(async () => {
      const personal = ctx.settings.get().folders.personal
      if (personal === null) {
        throw appError('NOT_CONFIGURED', 'Set the personal folder in Settings first', {
          setting: 'folders.personal'
        })
      }
      return copyOne(deps, sessions().require(req.sessionId), req.path, personal)
    })
  )

  handle('fileops:resetFolder', (req) =>
    serial(() => resetFolder(deps, journal, sessions().require(req.sessionId), req.folder))
  )

  handle('fileops:preclean', (req) =>
    serial(async () => ({
      trashed: await precleanFolder(deps, journal, sessions().require(req.sessionId), req.folder)
    }))
  )

  handle('fileops:journal', async (req) => journal.list(sessions().require(req.sessionId).root, req.limit))
}
