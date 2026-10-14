/** Hook service: `hooks:run|preview` and the `hooks` slot. */
import type { MainContext } from '../../ipc/context'
import { handle } from '../../ipc/handle'
import { createHookService } from './service'

export function registerHooksIpc(ctx: MainContext): void {
  const service = createHookService(ctx)
  ctx.services.provide('hooks', service)

  handle('hooks:run', (req) => service.run(req))
  handle('hooks:preview', (req) => service.preview(req.template, req.context))
}
