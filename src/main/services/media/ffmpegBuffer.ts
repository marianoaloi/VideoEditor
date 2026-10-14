/** Runs ffmpeg and collects binary stdout (`run()` decodes stdout as text, so it cannot be used). */
import { spawnStream } from '../process/run'

export interface BufferResult {
  readonly ok: boolean
  readonly data: Buffer
  readonly stderr: string
}

export interface BufferOptions {
  readonly ffmpegPath: string
  /** argv without the executable; the caller supplies the `pipe:1` output. */
  readonly args: readonly string[]
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

/** Never rejects: failures, timeouts and cancellation are `ok: false`. */
export async function ffmpegToBuffer(options: BufferOptions): Promise<BufferResult> {
  const proc = spawnStream({
    command: options.ffmpegPath,
    args: ['-hide_banner', '-loglevel', 'error', '-nostdin', ...options.args],
    timeoutMs: options.timeoutMs ?? 15_000,
    ...(options.signal === undefined ? {} : { signal: options.signal })
  })
  const chunks: Buffer[] = []
  proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
  const result = await proc.done
  const ok = result.status === 'exited' && result.exitCode === 0
  return { ok, data: Buffer.concat(chunks), stderr: result.stderr }
}
