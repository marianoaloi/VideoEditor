import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, dialog, protocol } from 'electron'
import icon from '../../resources/icon.png?asset'

const APP_USER_MODEL_ID = 'br.com.aloi.videoeditor'
/** Matches `palette.background.default` in the renderer theme, so there is no white flash. */
const WINDOW_BACKGROUND = '#121212'

let mainWindow: BrowserWindow | null = null

// Custom scheme used by <video>/<img> to read local files (ADR-003/ADR-004).
// It has to be registered before `app.ready`; the handler is attached after ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
  }
])

function reportFatal(message: string, error: unknown): void {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
  console.error(`[main] ${message}`, error)
  dialog.showErrorBox('VideoEditor', `${message}\n\n${detail}`)
  app.exit(1)
}

/** The renderer dev-server URL (set by electron-vite), or `null` in a production build. */
function getDevServerUrl(): string | null {
  const url = process.env['ELECTRON_RENDERER_URL']
  return is.dev && url ? url : null
}

function isDevServerNavigation(target: string): boolean {
  const devUrl = getDevServerUrl()
  if (devUrl === null || !URL.canParse(target)) return false
  return new URL(target).origin === new URL(devUrl).origin
}

/** The app never opens windows and never navigates away (ADR-003). */
function lockDownNavigation(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!isDevServerNavigation(url)) event.preventDefault()
  })
}

function loadRenderer(win: BrowserWindow): void {
  const devUrl = getDevServerUrl()
  const loading = devUrl
    ? win.loadURL(devUrl)
    : win.loadFile(join(__dirname, '../renderer/index.html'))
  loading.catch((error: unknown) => reportFatal('Failed to load the user interface.', error))
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    show: false,
    backgroundColor: WINDOW_BACKGROUND,
    title: 'VideoEditor',
    ...(process.platform === 'darwin' ? {} : { icon }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })
  // The keymap registry owns every key; the default menu would add competing accelerators.
  win.removeMenu()
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  lockDownNavigation(win)
  loadRenderer(win)
  return win
}

function focusExistingWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function onReady(): void {
  electronApp.setAppUserModelId(APP_USER_MODEL_ID)
  app.on('browser-window-created', (_event, window) => optimizer.watchWindowShortcuts(window))

  // SWARM-WIRE(protocol): register media:// handler here
  // SWARM-WIRE(ipc): registerAllIpc() here

  mainWindow = createMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
  })
}

function bootstrap(): void {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  app.on('second-instance', focusExistingWindow)
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.whenReady().then(onReady).catch((error: unknown) => reportFatal('Startup failed.', error))
}

bootstrap()
