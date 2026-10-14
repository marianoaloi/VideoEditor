/**
 * Bounded `worker_threads` pool for hash jobs. Workers start lazily, run one job at a time and are
 * recycled when they crash or when a job is cancelled (a worker busy in a pixel loop cannot hear a
 * message, so cancel = reject now + terminate). A crash fails only the job it was running.
 */
import { availableParallelism } from 'node:os'
import { Worker } from 'node:worker_threads'
import type { PerceptualKeys } from '@shared/core/hashPrimitives'
import type { FromWorker, HashJob, ToWorker } from './protocol'

export type JobSpec = DistributiveOmit<HashJob, 'id'>
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export interface PoolOptions {
  readonly size: number
  readonly workerPath: () => Promise<string> | string
  /** Video jobs get this long to stop their ffmpeg child after a cancel before the thread dies. */
  readonly cancelGraceMs?: number
}

interface Pending {
  readonly job: HashJob
  readonly resolve: (keys: PerceptualKeys[]) => void
  readonly reject: (error: unknown) => void
  readonly signal: AbortSignal | undefined
  onAbort?: () => void
}

interface Slot {
  worker: Worker | null
  current: Pending | null
}

export function defaultWorkerCount(): number {
  return Math.max(1, Math.min(3, availableParallelism() - 1))
}

export class HashWorkerPool {
  private readonly slots: Slot[]
  private readonly queue: Pending[] = []
  private nextId = 1
  private path: string | null = null

  constructor(private readonly options: PoolOptions) {
    this.slots = Array.from({ length: Math.max(1, options.size) }, () => ({
      worker: null,
      current: null
    }))
  }

  get size(): number {
    return this.slots.length
  }

  run(spec: JobSpec, signal?: AbortSignal): Promise<PerceptualKeys[]> {
    if (signal?.aborted === true) return Promise.reject(abortReason(signal))
    const job = { ...spec, id: this.nextId++ } as HashJob
    return new Promise<PerceptualKeys[]>((resolve, reject) => {
      const pending: Pending = { job, resolve, reject, signal }
      if (signal !== undefined) {
        pending.onAbort = (): void => this.cancel(pending, abortReason(signal))
        signal.addEventListener('abort', pending.onAbort, { once: true })
      }
      this.queue.push(pending)
      void this.dispatch()
    })
  }

  /** Rejects everything outstanding and terminates all workers; later `run` calls start fresh ones. */
  async dispose(): Promise<void> {
    const error = new Error('Hash worker pool is closed')
    for (const pending of this.queue.splice(0)) this.settle(pending, error)
    await Promise.all(this.slots.map((slot) => this.retire(slot, error)))
  }

  private async dispatch(): Promise<void> {
    for (const slot of this.slots) {
      if (slot.current !== null) continue
      const pending = this.queue.shift()
      if (pending === undefined) return
      slot.current = pending
      try {
        slot.worker ??= await this.spawn(slot)
        if (slot.current === pending && slot.worker !== null) {
          slot.worker.postMessage({ type: 'job', job: pending.job } satisfies ToWorker)
        }
      } catch (error) {
        if (slot.current === pending) {
          slot.current = null
          this.settle(pending, error)
        }
      }
    }
  }

  private async spawn(slot: Slot): Promise<Worker> {
    this.path ??= await this.options.workerPath()
    const worker = new Worker(this.path)
    worker.on('message', (message: FromWorker) => this.onMessage(slot, worker, message))
    worker.on('error', (error) => this.onDeath(slot, worker, `Hash worker crashed: ${error.message}`))
    worker.on('exit', (code) => this.onDeath(slot, worker, `Hash worker exited (code ${code})`))
    return worker
  }

  private onMessage(slot: Slot, worker: Worker, message: FromWorker): void {
    const pending = slot.current
    if (slot.worker !== worker || pending === null || pending.job.id !== message.id) return
    slot.current = null
    if (message.type === 'result') this.settle(pending, undefined, message.keys)
    else this.settle(pending, new Error(message.message))
    void this.dispatch()
  }

  private onDeath(slot: Slot, worker: Worker, message: string): void {
    if (slot.worker !== worker) return
    slot.worker = null
    const pending = slot.current
    slot.current = null
    if (pending !== undefined && pending !== null) this.settle(pending, new Error(message))
    void this.dispatch()
  }

  private cancel(pending: Pending, reason: unknown): void {
    const queued = this.queue.indexOf(pending)
    if (queued >= 0) {
      this.queue.splice(queued, 1)
      this.settle(pending, reason)
      return
    }
    const slot = this.slots.find((s) => s.current === pending)
    if (slot !== undefined) void this.retire(slot, reason)
  }

  /** Detaches the worker from its slot (so the slot is reusable at once) and stops it. */
  private async retire(slot: Slot, reason: unknown): Promise<void> {
    const { worker, current } = slot
    slot.worker = null
    slot.current = null
    if (current !== null) this.settle(current, reason)
    void this.dispatch()
    if (worker === null) return
    if (current?.job.op === 'video') {
      worker.postMessage({ type: 'cancel', id: current.job.id } satisfies ToWorker)
      await new Promise((resolve) => setTimeout(resolve, this.options.cancelGraceMs ?? 200))
    }
    await worker.terminate()
  }

  private settle(pending: Pending, error?: unknown, keys?: PerceptualKeys[]): void {
    if (pending.onAbort !== undefined) pending.signal?.removeEventListener('abort', pending.onAbort)
    if (keys !== undefined) pending.resolve(keys)
    else pending.reject(error)
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError')
}
