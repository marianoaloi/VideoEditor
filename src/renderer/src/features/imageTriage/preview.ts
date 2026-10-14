/**
 * Converted previews (image-triage.md section 3): files the browser cannot draw (or that failed
 * to load) get a main-process preview; the original is never rewritten. The planned channel
 * `media:imagePreview {path, force?}` returns `{reason, preview: ImageRef | null}`. It may not
 * exist yet, so every call is guarded; `media:grabFrame` (ffmpeg decodes stills too) is the
 * second chance, and `null` means "show a placeholder".
 */
import { call } from '../../app/api'

export interface PreviewRef {
  url: string
  width: number
  height: number
}

interface PreviewReply {
  reason?: string
  preview: PreviewRef | null
}

type LooseCall = (channel: string, request: unknown) => Promise<unknown>

function isPreviewReply(value: unknown): value is PreviewReply {
  return typeof value === 'object' && value !== null && 'preview' in value
}

async function viaPreviewChannel(path: string, force: boolean): Promise<PreviewRef | null> {
  const reply = await (call as unknown as LooseCall)('media:imagePreview', { path, force })
  return isPreviewReply(reply) ? reply.preview : null
}

async function viaGrabFrame(path: string): Promise<PreviewRef | null> {
  const frame = await call('media:grabFrame', { path, atMs: 0, format: 'png' })
  return { url: frame.url, width: frame.width, height: frame.height }
}

/** `null` when no preview can be made. Never throws. */
export async function requestPreview(path: string, force = false): Promise<PreviewRef | null> {
  for (const attempt of [() => viaPreviewChannel(path, force), () => viaGrabFrame(path)]) {
    try {
      const preview = await attempt()
      if (preview !== null) return preview
    } catch {
      // The channel is missing or the decode failed: try the next source, then fall back to a placeholder.
    }
  }
  return null
}
