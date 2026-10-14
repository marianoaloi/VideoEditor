/** Session service: `session:open|rescan|close` and the `sessions` slot. */
import type { MainContext } from '../../ipc/context'
import { handle } from '../../ipc/handle'
import { createSessionService } from './store'

export function registerSessionIpc(ctx: MainContext): void {
  const service = createSessionService(ctx)
  ctx.services.provide('sessions', service)

  handle('session:open', (req) => service.open(req))
  handle('session:rescan', (req) => service.rescan(req.sessionId))
  handle('session:close', (req) => {
    service.close(req.sessionId)
  })
}
