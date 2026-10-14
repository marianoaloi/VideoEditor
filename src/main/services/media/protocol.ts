/**
 * `media://` (ADR-003/ADR-004). The scheme itself is registered as privileged by the main entry
 * (`protocol.registerSchemesAsPrivileged`, before `ready`); this registers the handler.
 */
import { protocol } from 'electron'
import type { MainContext } from '../../ipc/context'
import { createMediaRequestHandler } from './mediaRequest'

export { createMediaRequestHandler } from './mediaRequest'

/** Call after `app.whenReady()`. */
export function registerMediaProtocol(ctx: MainContext): void {
  const handler = createMediaRequestHandler({
    allowlist: ctx.allowlist,
    ffmpegConfig: () => ctx.settings.get().ffmpeg
  })
  protocol.handle('media', async (request) => {
    const response = await handler(request)
    // The page origin differs (dev server or file://); the allowlist already guards access.
    // CORS lets <img crossOrigin> read pixels for the exact brightness/contrast preview.
    const headers = new Headers(response.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    })
  })
}
