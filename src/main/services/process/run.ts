/**
 * The only way the main process starts external programs (SWARM_PLAN §4, ADR-003, ADR-005):
 * `spawn(command, argsArray, { shell: false })`. File names are argv entries, never part of a
 * command string.
 *
 * - `run()` resolves with a typed `RunResult` and never rejects (spawn failures, cancellation and
 *   timeouts are statuses). Output can be consumed line by line while it is produced.
 * - `spawnStream()` exposes the raw stdout `Readable` (the ADR-004 transcode pipe) and a `done`
 *   promise with the same result type.
 * - An `AbortSignal` or a timeout kills the whole process tree: `taskkill /T /F /PID` on
 *   Windows, a negative-PID SIGKILL (process group) elsewhere.
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { Readable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'

export interface RunOptions {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd?: string
  /** Merged over `process.env`. */
  readonly env?: Readonly<Record<string, string>>
  readonly signal?: AbortSignal
  /** Kill the tree after this many milliseconds (status `timeout`). */
  readonly timeoutMs?: number
  /** Called for every complete stdout line (`\n`, `\r\n` and lone `\r` all end a line). */
  readonly onStdoutLine?: (line: string) => void
  readonly onStderrLine?: (line: string) => void
  /** Keep the output in the result? Default true. Turn off for chatty `-progress` streams. */
  readonly captureStdout?: boolean
  readonly captureStderr?: boolean
  /** Cap per captured stream; the START is kept and `*Truncated` is set. Default 16 MiB. */
  readonly maxCaptureBytes?: number
}

export type RunStatus = 'exited' | 'cancelled' | 'timeout' | 'spawn-error'

export interface RunResult {
  readonly status: RunStatus
  /** `null` when the process never started or was killed by a signal. */
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
  readonly stdoutTruncated: boolean
  readonly stderrTruncated: boolean
  readonly durationMs: number
  /** Set for `spawn-error` (e.g. `ENOENT`, `EINVAL`). */
  readonly error?: { readonly code: string | null; readonly message: string }
}

export function isSuccess(result: RunResult): boolean {
  return result.status === 'exited' && result.exitCode === 0
}

export interface StreamingProcess {
  /** Raw stdout. Consume it fully or destroy it; ignoring it can stall the child. */
  readonly stdout: Readable
  /** Resolves when the process has ended and stderr has been drained. */
  readonly done: Promise<RunResult>
  /** Kills the process tree; `done` then resolves with status `cancelled`. */
  kill(): void
}

const DEFAULT_MAX_CAPTURE = 16 * 1024 * 1024
const LINE_BREAK = /\r\n|\n|\r/

/** Kills `child` and everything it started. Never throws. */
export function killProcessTree(child: ChildProcess): void {
  const pid = child.pid
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/T', '/F', '/PID', String(pid)], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore'
    })
    killer.on('error', () => {
      child.kill('SIGKILL')
    })
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

/** Splits a byte stream into lines, flushing the partial last line at the end. */
class LineSplitter {
  private readonly decoder = new StringDecoder('utf8')
  private pending = ''

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: Buffer): void {
    this.feed(this.decoder.write(chunk))
  }

  end(): void {
    this.feed(this.decoder.end())
    if (this.pending.length > 0) this.onLine(this.pending)
    this.pending = ''
  }

  private feed(text: string): void {
    if (text.length === 0) return
    const parts = (this.pending + text).split(LINE_BREAK)
    this.pending = parts.pop() ?? ''
    for (const line of parts) this.onLine(line)
  }
}

class Capture {
  private chunks: Buffer[] = []
  private size = 0
  truncated = false

  constructor(
    private readonly enabled: boolean,
    private readonly limit: number
  ) {}

  push(chunk: Buffer): void {
    if (!this.enabled || this.truncated) return
    const room = this.limit - this.size
    if (chunk.length <= room) {
      this.chunks.push(chunk)
      this.size += chunk.length
      return
    }
    if (room > 0) this.chunks.push(chunk.subarray(0, room))
    this.size = this.limit
    this.truncated = true
  }

  text(): string {
    return Buffer.concat(this.chunks).toString('utf8')
  }
}

function spawnOptions(options: RunOptions): SpawnOptions {
  return {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    // A new process group lets us kill the whole tree with one signal on POSIX.
    detached: process.platform !== 'win32',
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    env: options.env === undefined ? process.env : { ...process.env, ...options.env }
  }
}

function errorInfo(error: Error): { code: string | null; message: string } {
  const code: unknown = Reflect.get(error, 'code')
  return { code: typeof code === 'string' ? code : null, message: error.message }
}

interface Started {
  readonly stdout: Readable
  readonly done: Promise<RunResult>
  kill(): void
}

/**
 * Shared implementation. With `rawStdout` the caller reads `stdout`; otherwise the stream is
 * consumed here (lines and capture).
 */
function start(options: RunOptions, rawStdout: boolean): Started {
  const startedAt = Date.now()
  const limit = options.maxCaptureBytes ?? DEFAULT_MAX_CAPTURE
  const outCapture = new Capture(!rawStdout && options.captureStdout !== false, limit)
  const errCapture = new Capture(options.captureStderr !== false, limit)

  const finish = (
    partial: Pick<RunResult, 'status' | 'exitCode' | 'signal'> & { error?: RunResult['error'] }
  ): RunResult => ({
    ...partial,
    stdout: outCapture.text(),
    stderr: errCapture.text(),
    stdoutTruncated: outCapture.truncated,
    stderrTruncated: errCapture.truncated,
    durationMs: Date.now() - startedAt
  })

  const { signal } = options
  if (signal?.aborted === true) {
    const empty = Readable.from([])
    return {
      stdout: empty,
      done: Promise.resolve(finish({ status: 'cancelled', exitCode: null, signal: null })),
      kill: () => undefined
    }
  }

  let child: ChildProcess
  try {
    child = spawn(options.command, [...options.args], spawnOptions(options))
  } catch (error: unknown) {
    // spawn throws synchronously for invalid arguments (e.g. NUL bytes).
    return {
      stdout: Readable.from([]),
      done: Promise.resolve(
        finish({
          status: 'spawn-error',
          exitCode: null,
          signal: null,
          error: errorInfo(error instanceof Error ? error : new Error(String(error)))
        })
      ),
      kill: () => undefined
    }
  }

  const stdout = child.stdout ?? Readable.from([])
  const stderr = child.stderr ?? Readable.from([])
  let cancelled = false
  let timedOut = false
  let spawnError: Error | null = null

  const kill = (): void => {
    cancelled = true
    killProcessTree(child)
  }

  const onAbort = (): void => {
    kill()
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer =
    options.timeoutMs === undefined
      ? null
      : setTimeout(() => {
          timedOut = true
          killProcessTree(child)
        }, options.timeoutMs)

  const outLines =
    options.onStdoutLine === undefined ? null : new LineSplitter(options.onStdoutLine)
  const errLines =
    options.onStderrLine === undefined ? null : new LineSplitter(options.onStderrLine)

  if (!rawStdout) {
    stdout.on('data', (chunk: Buffer) => {
      outCapture.push(chunk)
      outLines?.push(chunk)
    })
  }
  stderr.on('data', (chunk: Buffer) => {
    errCapture.push(chunk)
    errLines?.push(chunk)
  })

  const done = new Promise<RunResult>((resolve) => {
    child.once('error', (error: Error) => {
      spawnError = error
    })
    // `close` fires after the process ended AND its stdio streams closed.
    child.once('close', (code: number | null, closeSignal: NodeJS.Signals | null) => {
      if (timer !== null) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      outLines?.end()
      errLines?.end()
      if (spawnError !== null && child.pid === undefined) {
        resolve(
          finish({
            status: 'spawn-error',
            exitCode: null,
            signal: null,
            error: errorInfo(spawnError)
          })
        )
        return
      }
      const status: RunStatus = timedOut ? 'timeout' : cancelled ? 'cancelled' : 'exited'
      resolve(finish({ status, exitCode: code, signal: closeSignal }))
    })
  })

  return { stdout, done, kill }
}

/** Runs a program to completion. Never rejects. */
export function run(options: RunOptions): Promise<RunResult> {
  return start(options, false).done
}

/** Starts a program and hands out its raw stdout (for piping into an HTTP response). */
export function spawnStream(options: RunOptions): StreamingProcess {
  const started = start(options, true)
  return { stdout: started.stdout, done: started.done, kill: started.kill }
}
