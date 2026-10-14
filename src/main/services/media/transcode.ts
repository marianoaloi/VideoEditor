/**
 * ADR-004 fallback: ffmpeg to fragmented MP4 on stdout, started per request at `startSec` and
 * killed when the request is aborted or the consumer goes away.
 */
import { Readable } from 'node:stream'
import { spawnStream } from '../process/run'

export const TRANSCODE_CONTENT_TYPE = 'video/mp4'

/** argv without the executable. Even dimensions are forced because yuv420p needs them. */
export function buildTranscodeArgs(inputPath: string, startSec: number): string[] {
  return [
    ...['-hide_banner', '-loglevel', 'error', '-nostdin'],
    ...['-ss', startSec.toFixed(3), '-i', inputPath],
    ...['-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn'],
    ...['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'],
    ...['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency'],
    ...['-pix_fmt', 'yuv420p', '-g', '48'],
    ...['-c:a', 'aac', '-b:a', '128k', '-ac', '2'],
    ...['-movflags', 'frag_keyframe+empty_moov+default_base_moof'],
    ...['-f', 'mp4', 'pipe:1']
  ]
}

/** Concurrent transcode streams (L3). A new request past the cap evicts the oldest one (seek). */
export const MAX_TRANSCODE_STREAMS = 2

const active = new Set<() => void>()

/** Kills every running transcode (app quit). */
export function killAllTranscodes(): void {
  for (const kill of [...active]) kill()
  active.clear()
}

export function activeTranscodeCount(): number {
  return active.size
}

export function transcodeResponse(
  ffmpegPath: string,
  inputPath: string,
  startSec: number,
  signal: AbortSignal,
  maxStreams: number = MAX_TRANSCODE_STREAMS
): Response {
  while (active.size >= Math.max(1, maxStreams)) {
    const oldest = active.values().next()
    if (oldest.done === true) break
    oldest.value()
    active.delete(oldest.value)
  }
  const proc = spawnStream({
    command: ffmpegPath,
    args: buildTranscodeArgs(inputPath, startSec),
    captureStderr: true
  })
  const stop = (): void => proc.kill()
  active.add(stop)
  void proc.done.then(() => active.delete(stop))
  if (signal.aborted) stop()
  signal.addEventListener('abort', stop, { once: true })
  // The consumer closing the body (seek, navigation) must not leave ffmpeg running.
  proc.stdout.once('close', stop)
  void proc.done.then(() => signal.removeEventListener('abort', stop))
  const body = Readable.toWeb(proc.stdout) as unknown as ReadableStream<Uint8Array>
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': TRANSCODE_CONTENT_TYPE,
      'Accept-Ranges': 'none',
      'Cache-Control': 'no-store'
    }
  })
}
