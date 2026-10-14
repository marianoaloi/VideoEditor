/**
 * The pure request handler behind `media://` (no electron import, so it is testable):
 * allowlist + realpath check, HTTP Range for files, ADR-004 transcode stream.
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { parseMediaUrl } from '@shared/ipc/mediaUrl'
import { mimeTypeOf } from '@shared/core/mediaKind'
import { AppError, toIpcError } from '../../ipc/errors'
import type { MediaAllowlist } from '../../ipc/mediaAllowlist'
import { requireTool, type FfmpegToolsConfig } from '../ffmpeg/locate'
import { resolveAllowedPath } from './access'
import { parseRange } from './range'
import { transcodeResponse } from './transcode'

export interface MediaRequestDeps {
  readonly allowlist: MediaAllowlist
  readonly ffmpegConfig: () => FfmpegToolsConfig
}

const STATUS_BY_CODE: Partial<Record<string, number>> = {
  PATH_NOT_ALLOWED: 403,
  NOT_FOUND: 404,
  FFMPEG_NOT_FOUND: 503
}

function textResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  })
}

function errorResponse(error: unknown): Response {
  const ipc = toIpcError(error)
  return textResponse(STATUS_BY_CODE[ipc.code] ?? 500, ipc.message)
}

async function fileResponse(request: Request, realPath: string): Promise<Response> {
  const info = await stat(realPath)
  if (!info.isFile()) throw new AppError('NOT_FOUND', 'Not a file')
  const parsed = parseRange(request.headers.get('range'), info.size)
  if (parsed.kind === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } })
  }
  const range = parsed.kind === 'range' ? parsed.range : { start: 0, end: info.size - 1 }
  const length = info.size === 0 ? 0 : range.end - range.start + 1
  const headers: Record<string, string> = {
    'Content-Type': mimeTypeOf(path.basename(realPath)),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
    'Content-Length': String(length)
  }
  if (parsed.kind === 'range') {
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`
  }
  const status = parsed.kind === 'range' ? 206 : 200
  if (request.method === 'HEAD' || length === 0) return new Response(null, { status, headers })
  const stream = createReadStream(realPath, { start: range.start, end: range.end })
  request.signal.addEventListener('abort', () => stream.destroy(), { once: true })
  const body = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>
  return new Response(body, { status, headers })
}

/** Builds the `(request) => Response` handler; it never throws. */
export function createMediaRequestHandler(
  deps: MediaRequestDeps
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      const parsed = parseMediaUrl(request.url)
      if (parsed === null) return textResponse(400, 'Malformed media URL')
      const real = await resolveAllowedPath(deps.allowlist, parsed.path)
      if (parsed.kind === 'file') return await fileResponse(request, real)
      const ffmpeg = requireTool('ffmpeg', deps.ffmpegConfig())
      return transcodeResponse(ffmpeg.path, real, parsed.startSec, request.signal)
    } catch (error: unknown) {
      return errorResponse(error)
    }
  }
}
