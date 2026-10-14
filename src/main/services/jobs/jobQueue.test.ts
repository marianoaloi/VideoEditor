/** Queue behaviour (checklist 22, 23 of `.swarm/research/ffmpeg-jobs.md`). */
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/domain/settings'
import type { JobEvent, JobSummary } from '@shared/domain/job'
import { JobQueue, type ExecOutcome, type QueueDeps } from './jobQueue'

function summary(id: string, batchId: string | null = 'b1'): JobSummary {
  return {
    id,
    videoPath: `/v/${id}.mp4`,
    jsonPath: `/v/${id}.mp4.json`,
    mode: 1,
    status: 'queued',
    progress: 0,
    outputs: [],
    error: null,
    options: {
      upload: false,
      uploadAll: false,
      deleteOriginal: false,
      ignoreErrors: false,
      sameSize: false,
      keepParts: false
    },
    batchId,
    createdAt: 0,
    startedAt: null,
    finishedAt: null,
    logPath: null
  }
}

interface Gate {
  promise: Promise<ExecOutcome>
  release(outcome?: ExecOutcome): void
}
function gate(): Gate {
  let release: (o: ExecOutcome) => void = () => undefined
  const promise = new Promise<ExecOutcome>((resolve) => {
    release = resolve
  })
  return { promise, release: (o = { kind: 'done', outputs: [] }) => release(o) }
}

function setup(over: Partial<QueueDeps<string>> = {}): {
  queue: JobQueue<string>
  events: JobEvent[]
  gates: Map<string, Gate>
  running: { now: number; max: number }
} {
  const events: JobEvent[] = []
  const gates = new Map<string, Gate>()
  const running = { now: 0, max: 0 }
  const queue = new JobQueue<string>({
    concurrency: () => DEFAULT_SETTINGS.ffmpeg.concurrency,
    emit: (e) => events.push(e),
    execute: async (payload) => {
      running.now += 1
      running.max = Math.max(running.max, running.now)
      const g = gate()
      gates.set(payload, g)
      try {
        return await g.promise
      } finally {
        running.now -= 1
      }
    },
    logFlushMs: 10_000,
    ...over
  })
  return { queue, events, gates, running }
}

const types = (events: JobEvent[], id: string): string[] =>
  events.filter((e) => (e.type === 'queued' ? e.job.id : e.jobId) === id).map((e) => e.type)

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 15))
}

describe('JobQueue', () => {
  it('runs exactly 2 jobs at a time out of 5 (a single queue)', async () => {
    const { queue, events, gates, running } = setup()
    for (const id of ['a', 'b', 'c', 'd', 'e']) queue.add(summary(id), id)
    await tick()
    expect(events.filter((e) => e.type === 'started')).toHaveLength(2)
    gates.get('a')?.release()
    await tick()
    expect(events.filter((e) => e.type === 'started')).toHaveLength(3)
    expect(types(events, 'c')).toEqual(['queued', 'started'])
    gates.get('b')?.release({ kind: 'error', error: { code: 'PROCESS_FAILED', message: 'x' } })
    await tick()
    expect(events.filter((e) => e.type === 'started')).toHaveLength(4)
    for (const id of ['c', 'd', 'e']) {
      await tick()
      gates.get(id)?.release()
    }
    await queue.idle()
    expect(running.max).toBe(2)
    expect(queue.list().map((j) => j.status)).toEqual(['done', 'error', 'done', 'done', 'done'])
  })

  it('emits queued, started, progress, log, done in order', async () => {
    let clock = 0
    const { queue, events } = setup({
      now: () => clock,
      execute: (_p, _s, handle) => {
        handle.progress({ progress: 0.1, stepIndex: 0, stepCount: 2, outTimeMs: 1, speed: 1 })
        clock = 100
        handle.progress({ progress: 0.2, stepIndex: 0, stepCount: 2, outTimeMs: 2, speed: 1 })
        clock = 300
        handle.progress({ progress: 0.5, stepIndex: 1, stepCount: 2, outTimeMs: 3, speed: 1 })
        clock = 310
        handle.progress({ progress: 1, stepIndex: 1, stepCount: 2, outTimeMs: 4, speed: 1 })
        handle.log('one')
        handle.log('two')
        handle.log('hidden', { quiet: true })
        return Promise.resolve({ kind: 'done', outputs: ['/o.mp4'] })
      }
    })
    queue.add(summary('a'), 'a')
    await queue.idle()
    expect(types(events, 'a')).toEqual(['queued', 'started', 'progress', 'progress', 'progress', 'log', 'done'])
    const progress = events.filter((e) => e.type === 'progress').map((e) => e.progress)
    expect(progress).toEqual([0.1, 0.5, 1])
    const log = events.find((e) => e.type === 'log')
    expect(log).toMatchObject({ lines: ['one', 'two'] })
    expect(queue.logOf('a')?.lines).toEqual(['one', 'two', 'hidden'])
    expect(queue.get('a')).toMatchObject({ status: 'done', progress: 1, outputs: ['/o.mp4'] })
  })

  it('an exception ends one job with an error and the worker keeps going', async () => {
    let calls = 0
    const { queue, events } = setup({
      concurrency: () => 1,
      execute: () => {
        calls += 1
        return calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve({ kind: 'done', outputs: [] })
      }
    })
    queue.add(summary('a'), 'a')
    queue.add(summary('b'), 'b')
    await queue.idle()
    expect(events.find((e) => e.type === 'error')).toMatchObject({
      jobId: 'a',
      error: { code: 'INTERNAL', message: 'boom' }
    })
    expect(types(events, 'b')).toEqual(['queued', 'started', 'done'])
  })

  it('cancels a queued job without running it and aborts a running one', async () => {
    const { queue, events, gates } = setup({ concurrency: () => 1 })
    queue.add(summary('a'), 'a')
    queue.add(summary('b'), 'b')
    await tick()
    expect(queue.cancel('b')).toBe(true)
    expect(types(events, 'b')).toEqual(['queued', 'cancelled'])
    expect(queue.cancel('a')).toBe(true)
    expect(queue.cancel('missing')).toBe(false)
    gates.get('a')?.release({ kind: 'error', error: { code: 'CANCELLED', message: 'Cancelled' } })
    await queue.idle()
    expect(types(events, 'a')).toEqual(['queued', 'started', 'cancelled'])
    expect(queue.cancel('a')).toBe(false)
  })

  it('clearQueued cancels the waiting jobs and leaves the running ones', async () => {
    const { queue, events, gates } = setup()
    for (const id of ['a', 'b', 'c', 'd']) queue.add(summary(id), id)
    await tick()
    expect(queue.clearQueued()).toBe(2)
    expect(events.filter((e) => e.type === 'cancelled')).toHaveLength(2)
    gates.get('a')?.release()
    gates.get('b')?.release()
    await queue.idle()
    expect(queue.list().map((j) => j.status)).toEqual(['done', 'done', 'cancelled', 'cancelled'])
  })

  it('afterDone keeps the slot, then the batch settles once', async () => {
    const order: string[] = []
    const post = gate()
    const { queue, gates, running } = setup({
      concurrency: () => 1,
      afterDone: async (payload) => {
        order.push(`post-${payload}`)
        await post.promise
      },
      onBatchSettled: (batchId, jobs) => {
        order.push(`batch-${batchId}-${jobs.length}`)
        return Promise.resolve()
      }
    })
    queue.add(summary('a'), 'a')
    queue.add(summary('b'), 'b')
    await tick()
    gates.get('a')?.release()
    await tick()
    expect(order).toEqual(['post-a'])
    expect(queue.get('b')?.status).toBe('queued')
    post.release()
    await tick()
    gates.get('b')?.release()
    await queue.idle()
    expect(order).toEqual(['post-a', 'post-b', 'batch-b1-2'])
    expect(running.max).toBe(1)
  })

  it('finds active jobs by video path', async () => {
    const { queue, gates } = setup()
    queue.add(summary('a'), 'a')
    expect(queue.hasActiveJobFor('/v/a.mp4')).toBe(true)
    gates.get('a')?.release()
    await queue.idle()
    expect(queue.hasActiveJobFor('/v/a.mp4')).toBe(false)
  })
})
