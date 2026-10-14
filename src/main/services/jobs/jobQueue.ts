/**
 * The job queue (ADR-005, research §10.4, B14): ONE queue, a fixed number of workers (default 2),
 * workers that never die (an exception becomes an `error` event and the next job starts).
 *
 * Event order per job: `queued`, `started`, `progress`*, `log`*, then `done` | `error` |
 * `cancelled`. `progress` is throttled (~4/s) and `log` lines are batched. After `done` the
 * optional `afterDone` step (hooks, trash) runs while the worker slot is still held.
 */
import type { IpcError } from '@shared/domain/errors'
import type { JobEvent, JobSummary } from '@shared/domain/job'

export type ExecOutcome =
  | { readonly kind: 'done'; readonly outputs: string[] }
  | { readonly kind: 'error'; readonly error: IpcError }
  | { readonly kind: 'cancelled' }

export interface ProgressReport {
  readonly progress: number
  readonly stepIndex: number
  readonly stepCount: number
  readonly outTimeMs: number | null
  readonly speed: number | null
}

/** What a running job can do through the queue. */
export interface ExecHandle {
  readonly signal: AbortSignal
  progress(report: ProgressReport): void
  /** `quiet` lines are kept in the job log but not pushed to the renderer. */
  log(line: string, options?: { quiet?: boolean }): void
  /** Every log line so far. */
  lines(): string[]
  setLogPath(path: string): void
}

export interface QueueDeps<P> {
  /** Read on every scheduling decision, so a Settings change applies to the next job. */
  concurrency(): number
  execute(payload: P, summary: Readonly<JobSummary>, handle: ExecHandle): Promise<ExecOutcome>
  /** Runs after the `done` event, still inside the worker slot. Errors are logged. */
  afterDone?(payload: P, summary: Readonly<JobSummary>, handle: ExecHandle): Promise<void>
  /** Called once when every job of a batch has finished (done, error or cancelled). */
  onBatchSettled?(batchId: string, jobs: readonly JobSummary[]): Promise<void>
  emit(event: JobEvent): void
  now?(): number
  /** Default 250 ms (~4 progress events per second). */
  progressIntervalMs?: number
  /** Default 200 ms. */
  logFlushMs?: number
}

const MAX_LOG_LINES = 5000
const MAX_FINISHED_KEPT = 500

interface Entry<P> {
  readonly summary: JobSummary
  readonly payload: P
  readonly controller: AbortController
  readonly log: string[]
  pending: string[]
  flushTimer: ReturnType<typeof setTimeout> | null
  lastProgressAt: number
}

function snapshot(summary: JobSummary): JobSummary {
  return { ...summary, outputs: [...summary.outputs] }
}

function isFinished(summary: JobSummary): boolean {
  return summary.status === 'done' || summary.status === 'error' || summary.status === 'cancelled'
}

export class JobQueue<P> {
  private readonly entries = new Map<string, Entry<P>>()
  private readonly waiting: Entry<P>[] = []
  private running = 0
  private readonly background = new Set<Promise<void>>()

  constructor(private readonly deps: QueueDeps<P>) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  add(summary: JobSummary, payload: P): void {
    const entry: Entry<P> = {
      summary: snapshot(summary),
      payload,
      controller: new AbortController(),
      log: [],
      pending: [],
      flushTimer: null,
      lastProgressAt: Number.NEGATIVE_INFINITY
    }
    this.entries.set(summary.id, entry)
    this.waiting.push(entry)
    this.deps.emit({ type: 'queued', job: snapshot(entry.summary) })
    this.pump()
  }

  list(): JobSummary[] {
    return [...this.entries.values()].map((e) => snapshot(e.summary))
  }

  get(jobId: string): JobSummary | undefined {
    const entry = this.entries.get(jobId)
    return entry === undefined ? undefined : snapshot(entry.summary)
  }

  logOf(jobId: string): { lines: string[]; logPath: string | null } | undefined {
    const entry = this.entries.get(jobId)
    return entry === undefined ? undefined : { lines: [...entry.log], logPath: entry.summary.logPath }
  }

  /** True when a queued or running job already works on this video. */
  hasActiveJobFor(videoPath: string): boolean {
    for (const { summary } of this.entries.values()) {
      if (summary.videoPath === videoPath && !isFinished(summary)) return true
    }
    return false
  }

  /** Queued job: removed and reported `cancelled`. Running job: its process tree is killed. */
  cancel(jobId: string): boolean {
    const entry = this.entries.get(jobId)
    if (entry === undefined || isFinished(entry.summary)) return false
    if (entry.summary.status === 'running') {
      entry.controller.abort()
      return true
    }
    const index = this.waiting.indexOf(entry)
    if (index >= 0) this.waiting.splice(index, 1)
    entry.controller.abort()
    this.finishQueued(entry)
    return true
  }

  /** Cancels every queued (not running) job. */
  clearQueued(): number {
    const queued = [...this.waiting]
    this.waiting.length = 0
    for (const entry of queued) {
      entry.controller.abort()
      this.finishQueued(entry)
    }
    return queued.length
  }

  /** Appends a line to a job's log after the fact (batch-level steps report through the last job). */
  note(jobId: string, line: string): void {
    const entry = this.entries.get(jobId)
    if (entry === undefined) return
    this.appendLog(entry, line, false)
    this.flush(entry)
  }

  /** Resolves when nothing is queued, running or settling. For tests and shutdown. */
  async idle(): Promise<void> {
    while (this.running > 0 || this.waiting.length > 0 || this.background.size > 0) {
      await Promise.race([...this.background, new Promise((r) => setTimeout(r, 5))])
    }
  }

  /** Aborts every job (app shutdown). */
  abortAll(): void {
    this.clearQueued()
    for (const entry of this.entries.values()) {
      if (entry.summary.status === 'running') entry.controller.abort()
    }
  }

  private finishQueued(entry: Entry<P>): void {
    entry.summary.status = 'cancelled'
    entry.summary.finishedAt = this.now()
    this.deps.emit({ type: 'cancelled', jobId: entry.summary.id })
    this.settleBatch(entry.summary.batchId)
  }

  private pump(): void {
    while (this.running < Math.max(1, this.deps.concurrency())) {
      const entry = this.waiting.shift()
      if (entry === undefined) return
      this.running += 1
      void this.work(entry)
    }
  }

  private async work(entry: Entry<P>): Promise<void> {
    const { summary } = entry
    summary.status = 'running'
    summary.startedAt = this.now()
    this.deps.emit({ type: 'started', jobId: summary.id, at: summary.startedAt })
    const handle = this.handleFor(entry)
    const outcome = await this.execute(entry, handle)
    this.flush(entry)
    this.conclude(entry, outcome)
    if (outcome.kind === 'done') await this.runAfterDone(entry, handle)
    this.flush(entry)
    this.running -= 1
    this.trimHistory()
    this.settleBatch(summary.batchId)
    this.pump()
  }

  private async execute(entry: Entry<P>, handle: ExecHandle): Promise<ExecOutcome> {
    try {
      const outcome = await this.deps.execute(entry.payload, snapshot(entry.summary), handle)
      if (outcome.kind !== 'done' && entry.controller.signal.aborted) return { kind: 'cancelled' }
      return outcome
    } catch (error) {
      if (entry.controller.signal.aborted) return { kind: 'cancelled' }
      const message = error instanceof Error ? error.message : String(error)
      return { kind: 'error', error: { code: 'INTERNAL', message } }
    }
  }

  private conclude(entry: Entry<P>, outcome: ExecOutcome): void {
    const { summary } = entry
    summary.finishedAt = this.now()
    if (outcome.kind === 'done') {
      summary.status = 'done'
      summary.progress = 1
      summary.outputs = [...outcome.outputs]
      const durationMs = Math.max(0, summary.finishedAt - (summary.startedAt ?? summary.finishedAt))
      this.deps.emit({ type: 'done', jobId: summary.id, outputs: [...outcome.outputs], durationMs })
    } else if (outcome.kind === 'error') {
      summary.status = 'error'
      summary.error = outcome.error
      this.deps.emit({ type: 'error', jobId: summary.id, error: outcome.error })
    } else {
      summary.status = 'cancelled'
      this.deps.emit({ type: 'cancelled', jobId: summary.id })
    }
  }

  private async runAfterDone(entry: Entry<P>, handle: ExecHandle): Promise<void> {
    if (this.deps.afterDone === undefined) return
    try {
      await this.deps.afterDone(entry.payload, snapshot(entry.summary), handle)
    } catch (error) {
      handle.log(`Post-job step failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private settleBatch(batchId: string | null): void {
    if (batchId === null || this.deps.onBatchSettled === undefined) return
    const jobs = [...this.entries.values()].filter((e) => e.summary.batchId === batchId)
    if (jobs.some((e) => !isFinished(e.summary))) return
    const task = this.deps
      .onBatchSettled(batchId, jobs.map((e) => snapshot(e.summary)))
      .catch((error: unknown) => {
        const last = jobs[jobs.length - 1]
        if (last !== undefined) {
          this.appendLog(last, `Batch step failed: ${error instanceof Error ? error.message : String(error)}`, false)
          this.flush(last)
        }
      })
      .finally(() => {
        this.background.delete(task)
      })
    this.background.add(task)
  }

  private trimHistory(): void {
    const finished = [...this.entries.values()].filter((e) => isFinished(e.summary))
    const extra = finished.length - MAX_FINISHED_KEPT
    for (const entry of finished.slice(0, Math.max(0, extra))) this.entries.delete(entry.summary.id)
  }

  // ---- handle: progress throttle and log batching -----------------------------------------

  private handleFor(entry: Entry<P>): ExecHandle {
    return {
      signal: entry.controller.signal,
      progress: (report) => {
        this.reportProgress(entry, report)
      },
      log: (line, options) => {
        this.appendLog(entry, line, options?.quiet === true)
      },
      lines: () => [...entry.log],
      setLogPath: (path) => {
        entry.summary.logPath = path
      }
    }
  }

  private reportProgress(entry: Entry<P>, report: ProgressReport): void {
    entry.summary.progress = Math.min(1, Math.max(0, report.progress))
    const interval = this.deps.progressIntervalMs ?? 250
    const at = this.now()
    if (at - entry.lastProgressAt < interval && report.progress < 1) return
    entry.lastProgressAt = at
    this.deps.emit({
      type: 'progress',
      jobId: entry.summary.id,
      progress: entry.summary.progress,
      stepIndex: report.stepIndex,
      stepCount: report.stepCount,
      outTimeMs: report.outTimeMs,
      speed: report.speed
    })
  }

  private appendLog(entry: Entry<P>, line: string, quiet: boolean): void {
    entry.log.push(line)
    if (entry.log.length > MAX_LOG_LINES) entry.log.splice(0, entry.log.length - MAX_LOG_LINES)
    if (quiet) return
    entry.pending.push(line)
    if (entry.flushTimer !== null) return
    entry.flushTimer = setTimeout(() => {
      this.flush(entry)
    }, this.deps.logFlushMs ?? 200)
    entry.flushTimer.unref()
  }

  private flush(entry: Entry<P>): void {
    if (entry.flushTimer !== null) clearTimeout(entry.flushTimer)
    entry.flushTimer = null
    if (entry.pending.length === 0) return
    const lines = entry.pending
    entry.pending = []
    this.deps.emit({ type: 'log', jobId: entry.summary.id, lines })
  }
}
