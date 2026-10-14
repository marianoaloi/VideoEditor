/** Media IPC (CONTRACT §2 "media"): probe, frames, mosaics, black bars, in-place image edits. */
import type { MainContext } from '../../ipc/context'
import { handle } from '../../ipc/handle'
import { resolveGuardedPath, resolveGuardedPaths } from '../../ipc/pathGuard'
import { detectBlackBars } from './blackBars'
import { createFrameService } from './frames'
import { createImageEditService } from './imageEdit'
import { createMosaicService } from './mosaic'
import { createPreviewService } from './preview'
import { createProbeService } from './probeService'
import { createMediaTasks } from './tasks'

export function registerMediaIpc(ctx: MainContext): void {
  const probes = createProbeService(() => ctx.settings.get().ffmpeg)
  const frames = createFrameService({ ctx, probe: (file) => probes.probe(file) })
  const mosaics = createMosaicService({ ctx, probe: (file) => probes.probe(file) })
  const edits = createImageEditService(ctx)
  const previews = createPreviewService(ctx)
  const tasks = createMediaTasks({
    probe: (file) => probes.probe(file),
    mosaic: (file, signal) => mosaics.get(file, signal === undefined ? {} : { signal }),
    emit: (progress) => ctx.sendEvent('media:mosaicProgress', progress),
    onBackgroundError: (file, error) => console.warn('[media] prefetch failed', file, error)
  })

  // H2: every renderer-supplied path must be inside an opened/approved folder (UNC refused).
  // The caller's spelling is kept (the renderer keys results by it); only the check normalises.
  const guard = async (file: string): Promise<string> => {
    await resolveGuardedPath(ctx, file)
    return file
  }
  const guardAll = async (files: readonly string[]): Promise<string[]> => {
    await resolveGuardedPaths(ctx, files)
    return [...files]
  }

  handle('media:probe', async (req) => probes.probe(await guard(req.path)))
  handle('media:probeMany', async (req) => probes.probeMany(await guardAll(req.paths)))
  handle('media:grabFrame', async (req) => {
    await guard(req.path)
    return frames.grab(req)
  })
  handle('media:mosaic', async (req) => mosaics.get(await guard(req.path), { force: req.force }))
  handle('media:prefetch', async (req) => tasks.prefetch(await guardAll(req.paths), req.what))
  handle('media:generateMosaics', async (req) => tasks.generate(req.taskId, await guardAll(req.paths)))
  handle('media:cancelTask', (req) => tasks.cancel(req.taskId))
  handle('media:detectBlackBars', async (req) =>
    detectBlackBars(
      { grabPng: (file, atMs) => frames.grabPng(file, atMs), probe: (file) => probes.probe(file) },
      await guard(req.path),
      req.atMs
    )
  )
  handle('media:imagePreview', async (req) => previews.preview(await guard(req.path), req.force))
  handle('media:imageEdit', (req) => edits.edit(req))
  handle('media:imageRotate', (req) => edits.rotate(req))
  handle('media:imageRestoreBackup', (req) => edits.restore(req))
}
