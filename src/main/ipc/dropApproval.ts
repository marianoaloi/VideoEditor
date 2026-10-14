/** Approval of dropped items (review H2). No electron import: unit-testable. */
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { MainContext } from './context'
import { assertSafePathSyntax } from './pathGuard'

/** One-way message from the preload after `webUtils.getPathForFile` (the user dropped this item). */
export const DROP_APPROVAL_CHANNEL = 'app:approveDropped'

/**
 * Approves a dropped item: a folder becomes an approved root, a file approves its folder (the app
 * then opens that folder). Only the preload can learn the real path of a dropped `File`, so this
 * message cannot be forged by page scripts. Failures are silent: the later open is just refused.
 */
export async function approveDroppedPath(ctx: MainContext, dropped: string): Promise<void> {
  try {
    assertSafePathSyntax(dropped)
    const info = await stat(dropped)
    ctx.approvals.addRoot(info.isDirectory() ? dropped : path.dirname(dropped))
  } catch (error: unknown) {
    console.warn('[app] dropped path not approved', error)
  }
}
