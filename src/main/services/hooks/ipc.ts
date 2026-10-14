/** Hook service: `hooks:run|preview` and the `hooks` slot. */
import type { HookContext } from '@shared/domain/hooks'
import type { MainContext } from '../../ipc/context'
import { handle } from '../../ipc/handle'
import { resolveGuardedPath } from '../../ipc/pathGuard'
import { createHookService } from './service'

/** Every path a renderer puts in a hook context must be inside an opened/approved folder. */
export async function guardHookContext(ctx: MainContext, context: HookContext): Promise<void> {
  const single = [context.file, context.dir, context.root]
  const lists = [...(context.files ?? []), ...(context.outputs ?? [])]
  for (const item of [...single, ...lists]) {
    if (item !== undefined) await resolveGuardedPath(ctx, item)
  }
}

export function registerHooksIpc(ctx: MainContext): { dispose(): void } {
  const service = createHookService(ctx)
  ctx.services.provide('hooks', service)

  handle('hooks:run', async (req) => {
    await guardHookContext(ctx, req.context)
    return service.run(req)
  })
  handle('hooks:preview', (req) => service.preview(req.template, req.context))
  return { dispose: () => service.dispose() }
}
