/** Launches the built app with an isolated user-data dir and exposes the helpers the specs share. */
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { killLeftovers, makeTempDir, removeDir } from './media'

export interface IpcOk<T> {
  ok: true
  data: T
}
export interface IpcFail {
  ok: false
  error: { code: string; message: string; details?: unknown }
}

export interface MediaReply {
  status: number
  headers: Record<string, string>
  bytes: number
  text: string
}

export interface E2eApp {
  app: ElectronApplication
  page: Page
  userData: string
  consoleErrors: string[]
  /** `window.api.invoke` returning the raw `{ok,...}` envelope. */
  invoke<T = unknown>(channel: string, request?: unknown): Promise<IpcOk<T> | IpcFail>
  /** Like `invoke` but throws on `ok:false` and returns the value. */
  call<T = unknown>(channel: string, request?: unknown): Promise<T>
  /** The next `app:openDirectoryDialog` answers with this path (or cancels with `null`). */
  stubDirectoryDialog(path: string | null): Promise<void>
  /** Approves a folder the way a user does: through the (stubbed) native folder dialog. */
  approveFolder(dir: string): Promise<void>
  /** Paths `shell.trashItem` was called with (the stub also deletes the file, there is no real bin use). */
  trashed(): Promise<string[]>
  /**
   * Requests a `media://` URL through the real protocol handler (`net.fetch` in main: the page CSP
   * only allows media:// for <img>/<video>). Reads at most `maxBytes` of the body, then cancels.
   */
  mediaFetch(
    url: string,
    init?: { method?: string; range?: string; maxBytes?: number }
  ): Promise<MediaReply>
  goTo(workspaceLabel: string): Promise<void>
  close(): Promise<void>
}

export async function launchApp(): Promise<E2eApp> {
  const userData = makeTempDir('ve-e2e-ud-')
  const env = { ...process.env } as Record<string, string>
  delete env['ELECTRON_RUN_AS_NODE']
  delete env['ELECTRON_RENDERER_URL']
  const app = await electron.launch({
    args: [join(process.cwd(), 'out', 'main', 'index.js'), `--user-data-dir=${userData}`],
    env,
    timeout: 60_000
  })
  const consoleErrors: string[] = []
  const watch = (page: Page): void => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))
  }
  app.on('window', watch)
  const page = await app.firstWindow()
  watch(page)
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('navigation', { name: 'Workspaces' }).waitFor()
  await app.evaluate(({ dialog, shell }) => {
    const { rmSync } = process.getBuiltinModule('node:fs')
    const state = { dialogNext: null as string | null | undefined, trashed: [] as string[] }
    ;(globalThis as Record<string, unknown>)['__e2e'] = state
    dialog.showOpenDialog = (async () => {
      const next = state.dialogNext
      state.dialogNext = undefined
      if (next === undefined) throw new Error('e2e: unexpected dialog (no stub queued)')
      return { canceled: next === null, filePaths: next === null ? [] : [next] }
    }) as typeof dialog.showOpenDialog
    shell.trashItem = async (path: string) => {
      state.trashed.push(path)
      rmSync(path, { force: true, recursive: true })
    }
  })

  const invoke: E2eApp['invoke'] = (channel, request) =>
    page.evaluate(
      ([c, r]) =>
        (
          window as unknown as { api: { invoke(c: string, r: unknown): Promise<never> } }
        ).api.invoke(c, r),
      [channel, request ?? {}] as const
    ) as Promise<never>

  return {
    app,
    page,
    userData,
    consoleErrors,
    invoke,
    async call<T>(channel: string, request?: unknown): Promise<T> {
      const reply = await invoke<T>(channel, request)
      if (!reply.ok) throw new Error(`${channel}: ${reply.error.code} ${reply.error.message}`)
      return reply.data
    },
    stubDirectoryDialog: (path) =>
      app.evaluate((_e, p) => {
        ;(
          (globalThis as Record<string, unknown>)['__e2e'] as { dialogNext: string | null }
        ).dialogNext = p
      }, path),
    async approveFolder(dir) {
      await app.evaluate((_e, p) => {
        ;(
          (globalThis as Record<string, unknown>)['__e2e'] as { dialogNext: string | null }
        ).dialogNext = p
      }, dir)
      const reply = await invoke('app:openDirectoryDialog', {})
      if (!reply.ok)
        throw new Error(`approveFolder ${dir}: ${reply.error.code} ${reply.error.message}`)
    },
    trashed: () =>
      app.evaluate(
        () => ((globalThis as Record<string, unknown>)['__e2e'] as { trashed: string[] }).trashed
      ),
    mediaFetch: (url, init = {}) =>
      app.evaluate(
        async ({ net }, [u, i]) => {
          const headers: Record<string, string> = i.range === undefined ? {} : { Range: i.range }
          const res = await net.fetch(u, { method: i.method ?? 'GET', headers })
          const limit = i.maxBytes ?? 1_000_000
          const chunks: Buffer[] = []
          let bytes = 0
          if (res.body !== null) {
            const reader = res.body.getReader()
            while (bytes < limit) {
              const { value, done } = await reader.read()
              if (done) break
              chunks.push(Buffer.from(value))
              bytes += value.byteLength
            }
            await reader.cancel().catch(() => undefined)
          }
          const out: Record<string, string> = {}
          res.headers.forEach((v, k) => {
            out[k] = v
          })
          return {
            status: res.status,
            headers: out,
            bytes,
            text: Buffer.concat(chunks).subarray(0, 300).toString('utf8')
          }
        },
        [url, init] as const
      ),
    goTo: async (label) => {
      await page
        .getByRole('navigation', { name: 'Workspaces' })
        .getByText(label, { exact: true })
        .click()
    },
    close: async () => {
      const pid = app.process().pid
      await app.close().catch(() => undefined)
      if (pid !== undefined && process.platform === 'win32') {
        // Last resort: the whole tree of this instance (renderer, gpu, ffmpeg children).
        await import('node:child_process').then(({ spawnSync }) =>
          spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
        )
      }
      killLeftovers()
      removeDir(userData)
    }
  }
}
