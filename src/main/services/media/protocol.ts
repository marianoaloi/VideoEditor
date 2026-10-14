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
  protocol.handle('media', (request) => handler(request))
}
