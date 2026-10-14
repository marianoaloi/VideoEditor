/** Media IPC (CONTRACT §2 "media"): probe, frames, mosaics, black bars, in-place image edits. */
import type { MainContext } from '../../ipc/context'
import { handle } from '../../ipc/handle'
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

  handle('media:probe', (req) => probes.probe(req.path))
  handle('media:probeMany', (req) => probes.probeMany(req.paths))
  handle('media:grabFrame', (req) => frames.grab(req))
  handle('media:mosaic', (req) => mosaics.get(req.path, { force: req.force }))
  handle('media:prefetch', (req) => tasks.prefetch(req.paths, req.what))
  handle('media:generateMosaics', (req) => tasks.generate(req.taskId, req.paths))
  handle('media:cancelTask', (req) => tasks.cancel(req.taskId))
  handle('media:detectBlackBars', (req) =>
    detectBlackBars(
      { grabPng: (file, atMs) => frames.grabPng(file, atMs), probe: (file) => probes.probe(file) },
      req.path,
      req.atMs
    )
  )
  handle('media:imagePreview', (req) => previews.preview(req.path, req.force))
  handle('media:imageEdit', (req) => edits.edit(req))
  handle('media:imageRotate', (req) => edits.rotate(req))
  handle('media:imageRestoreBackup', (req) => edits.restore(req))
}
