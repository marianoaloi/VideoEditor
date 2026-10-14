/** App service: native dialogs, Explorer integration, window flags and app info. */
import { app, dialog, shell, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { stat } from 'node:fs/promises'
import { appError } from '../../ipc/errors'
import { handle } from '../../ipc/handle'
import type { MainContext } from '../../ipc/context'

async function showOpenDialog(win: BrowserWindow | null, options: OpenDialogOptions) {
  return win === null ? dialog.showOpenDialog(options) : dialog.showOpenDialog(win, options)
}

async function requireDirectory(target: string): Promise<void> {
  const info = await stat(target).catch(() => null)
  if (info === null) throw appError('NOT_FOUND', `Not found: ${target}`, { path: target })
  if (!info.isDirectory()) {
    throw appError('VALIDATION', 'Only folders can be opened; files are never launched', { path: target })
  }
}

export function registerAppIpc(ctx: MainContext): void {
  handle('app:openDirectoryDialog', async (req) => {
    const result = await showOpenDialog(ctx.getWindow(), {
      properties: ['openDirectory'],
      ...(req.title === undefined ? {} : { title: req.title }),
      ...(req.defaultPath === undefined ? {} : { defaultPath: req.defaultPath })
    })
    return { canceled: result.canceled, path: result.canceled ? null : (result.filePaths[0] ?? null) }
  })

  handle('app:openFilesDialog', async (req) => {
    const result = await showOpenDialog(ctx.getWindow(), {
      properties: req.multi ? ['openFile', 'multiSelections'] : ['openFile'],
      ...(req.title === undefined ? {} : { title: req.title }),
      ...(req.defaultPath === undefined ? {} : { defaultPath: req.defaultPath }),
      ...(req.filters === undefined ? {} : { filters: req.filters })
    })
    return { canceled: result.canceled, paths: result.canceled ? [] : result.filePaths }
  })

  handle('app:revealInFolder', async (req) => {
    await stat(req.path).catch(() => {
      throw appError('NOT_FOUND', `Not found: ${req.path}`, { path: req.path })
    })
    shell.showItemInFolder(req.path)
  })

  handle('app:openFolder', async (req) => {
    await requireDirectory(req.path)
    const failure = await shell.openPath(req.path)
    if (failure.length > 0) throw appError('IO', failure, { path: req.path })
  })

  handle('app:setAlwaysOnTop', (req) => {
    ctx.getWindow()?.setAlwaysOnTop(req.value)
  })

  handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    userDataDir: ctx.paths.userData,
    tempDir: ctx.paths.temp,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    }
  }))
}
