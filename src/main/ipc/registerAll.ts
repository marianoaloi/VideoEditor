/**
 * Wires every service's IPC handlers to `ipcMain` (SWARM-WIRE(ipc) in `src/main/index.ts`):
 *
 *   const ipc = registerAllIpc({ ipcMain, trashItem: shell.trashItem, getWindow: () => mainWindow,
 *                                userDataDir: app.getPath('userData'), tempDir: app.getPath('temp') })
 *   // ipc.context.allowlist is what the media:// protocol handler checks.
 *
 * Electron objects are injected (type-only imports here), so this file is testable in Node.
 */
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import { DEFAULT_SETTINGS } from '@shared/domain/settings'
import { registerAppIpc } from '../services/app/ipc'
import { registerFileopsIpc } from '../services/fileops/ipc'
import { registerHashingIpc } from '../services/hashing/ipc'
import { registerHooksIpc } from '../services/hooks/ipc'
import { registerJobsIpc } from '../services/jobs/ipc'
import { registerMediaIpc } from '../services/media/ipc'
import { killAllTranscodes } from '../services/media/transcode'
import { registerSessionIpc } from '../services/session/ipc'
import { registerSettingsIpc } from '../services/settings/ipc'
import { createMainContext, createSettingsAccess, type MainContext } from './context'
import { bindIpcMain, missingChannels, type IpcEventLike, type IpcMainLike } from './handle'
import { approveDroppedPath, DROP_APPROVAL_CHANNEL } from './dropApproval'
import { createMediaAllowlist } from './mediaAllowlist'
import { createPathApprovals } from './pathApprovals'

/**
 * Registration order matters only for service slots that are provided at registration time:
 * settings first (everybody reads them), then session/fileops/hooks (they provide
 * `sessions`, `journal`, `hooks`), then the services that consume those slots.
 */
export function registerServices(ctx: MainContext): { dispose(): void } {
  registerSettingsIpc(ctx)
  registerAppIpc(ctx)
  registerSessionIpc(ctx)
  registerFileopsIpc(ctx)
  const hooks = registerHooksIpc(ctx)
  registerMediaIpc(ctx)
  const jobs = registerJobsIpc(ctx)
  registerHashingIpc(ctx)
  return {
    dispose: () => {
      jobs.dispose()
      hooks.dispose()
      killAllTranscodes()
    }
  }
}

export interface RegisterAllDeps {
  readonly ipcMain: IpcMainLike
  readonly getWindow: () => BrowserWindow | null
  readonly trashItem: (absPath: string) => Promise<void>
  readonly userDataDir: string
  readonly tempDir: string
}

export interface RegisteredIpc {
  readonly context: MainContext
  /** Detaches the handlers from `ipcMain` and stops running jobs (quit, tests, hot reload). */
  dispose(): void
}

export function registerAllIpc(deps: RegisterAllDeps): RegisteredIpc {
  const context = createMainContext({
    getWindow: deps.getWindow,
    settings: createSettingsAccess(DEFAULT_SETTINGS),
    allowlist: createMediaAllowlist(),
    approvals: createPathApprovals(path.join(deps.userDataDir, 'approved-roots.json')),
    paths: { userData: deps.userDataDir, temp: path.join(deps.tempDir, 'VideoEditor') },
    trashItem: deps.trashItem,
    newId: randomUUID
  })
  const services = registerServices(context)

  const missing = missingChannels()
  if (missing.length > 0) {
    throw new Error(`IPC channels without a handler: ${missing.join(', ')}`)
  }

  const isTrusted = (event: IpcEventLike): boolean => {
    const win = deps.getWindow()
    if (win === null || win.isDestroyed() || win.webContents.id !== event.sender.id) return false
    // Only the top-level frame of the app window may call main (no sub-frames, no other documents).
    return event.senderFrame === win.webContents.mainFrame
  }
  const unbind = bindIpcMain(deps.ipcMain, isTrusted)
  const onDropped = (event: IpcEventLike, raw?: unknown): void => {
    if (isTrusted(event) && typeof raw === 'string') void approveDroppedPath(context, raw)
  }
  deps.ipcMain.on?.(DROP_APPROVAL_CHANNEL, onDropped)
  return {
    context,
    dispose: () => {
      deps.ipcMain.removeListener?.(DROP_APPROVAL_CHANNEL, onDropped)
      unbind()
      services.dispose()
    }
  }
}
