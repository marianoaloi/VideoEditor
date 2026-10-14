import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeTempDir } from '../../ffmpeg/testFixtures'
import { buildHashCsv } from '../build'
import { writePattern } from '../testImages'
import { createTsHashProvider } from '../tsProvider'
import { HashWorkerPool } from './pool'
import { DEFAULT_MAX_PIXELS } from './protocol'

/** Fake worker: 'hang' blocks the thread, 'crash' exits, anything else sleeps 120 ms and replies. */
const FAKE_WORKER = `
const { parentPort } = require('node:worker_threads')
parentPort.on('message', (m) => {
  if (m.type !== 'job') return
  const { id, path } = m.job
  if (path === 'hang') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20000)
  if (path === 'crash') process.exit(3)
  const start = Date.now()
  setTimeout(() => {
    const keys = [{ pureMD5: String(start), hash16: '', hash8: String(Date.now()), thumbLight: '', thumbDark: '' }]
    parentPort.postMessage({ type: 'result', id, keys })
  }, 120)
})
`

let dir = ''
let fakePath = ''
beforeAll(async () => {
  dir = await makeTempDir('hash-pool')
  fakePath = path.join(dir, 'fake-worker.cjs')
  await writeFile(fakePath, FAKE_WORKER)
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

const spec = (p: string) => ({ op: 'image' as const, path: p, cascade: true, maxPixels: DEFAULT_MAX_PIXELS })
const fakePool = (size: number): HashWorkerPool =>
  new HashWorkerPool({ size, workerPath: () => fakePath, cancelGraceMs: 20 })

function maxOverlap(spans: Array<[number, number]>): number {
  return Math.max(...spans.map(([s]) => spans.filter(([a, b]) => a <= s && s < b).length))
}

describe('HashWorkerPool', () => {
  it('never runs more jobs at once than its size, and uses all of its workers', async () => {
    const pool = fakePool(2)
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => pool.run(spec(`f${i}`))))
    await pool.dispose()
    const spans = results.map(([k]) => [Number(k?.pureMD5), Number(k?.hash8)] as [number, number])
    expect(maxOverlap(spans)).toBe(2)
  })

  it('cancel terminates a busy worker promptly and the slot keeps working', async () => {
    const pool = fakePool(1)
    const controller = new AbortController()
    const hung = pool.run(spec('hang'), controller.signal)
    const queued = pool.run(spec('next'))
    await new Promise((r) => setTimeout(r, 150))
    const t0 = Date.now()
    controller.abort()
    await expect(hung).rejects.toMatchObject({ name: 'AbortError' })
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(await queued).toHaveLength(1)
    await pool.dispose()
  })

  it('a worker crash fails only that file; later files still hash', async () => {
    const pool = fakePool(1)
    const [crashed, ok] = await Promise.allSettled([pool.run(spec('crash')), pool.run(spec('fine'))])
    await pool.dispose()
    expect(crashed.status).toBe('rejected')
    expect(String((crashed as PromiseRejectedResult).reason)).toMatch(/Hash worker/)
    expect(ok.status).toBe('fulfilled')
  })

  it('a job already aborted never starts', async () => {
    const pool = fakePool(1)
    const controller = new AbortController()
    controller.abort()
    await expect(pool.run(spec('x'), controller.signal)).rejects.toBeDefined()
    await pool.dispose()
  })
})

describe('real worker scan', () => {
  const tools = () => ({ ffmpegPath: 'unused', ffprobePath: 'unused' })

  async function scanDir(name: string, count: number, size?: { width: number; height: number }) {
    const folder = path.join(dir, name)
    await mkdir(folder, { recursive: true })
    for (let i = 0; i < count; i++) {
      await writePattern(folder, `img${String(i).padStart(3, '0')}.png`, 'png', size, i * 0.01)
    }
    return folder
  }

  it('a corrupt image becomes a failed row and the scan continues', async () => {
    const folder = await scanDir('corrupt', 4)
    await writeFile(path.join(folder, 'broken.jpg'), 'not an image')
    const provider = createTsHashProvider({ tools, workers: 2 })
    const out = await buildHashCsv({ dir: folder, kind: 'image', taskId: 't', provider, concurrency: 3 })
    expect(out.failedCount).toBe(1)
    expect(out.rowCount).toBe(5)
    expect(out.cancelled).toBe(false)
  })

  it('an image above the pixel cap is a failed row with a clear comment', async () => {
    const folder = await scanDir('cap', 1, { width: 160, height: 120 })
    const provider = createTsHashProvider({ tools, workers: 1, maxPixels: 10_000 })
    await expect(provider.hashImage(path.join(folder, 'img000.png'))).rejects.toThrow(
      /Image too large: more than 10000 px \(pixel limit\)/
    )
    await provider.dispose()
  })

  it('cancelling mid-scan ends the build quickly with cancelled=true', async () => {
    const folder = await scanDir('cancel', 120, { width: 400, height: 300 })
    const controller = new AbortController()
    const provider = createTsHashProvider({ tools, workers: 2 })
    const started = Date.now()
    let abortedAt = 0
    const out = await buildHashCsv({
      dir: folder,
      kind: 'image',
      taskId: 'c',
      provider,
      concurrency: 3,
      signal: controller.signal,
      progressIntervalMs: 0,
      onProgress: (p) => {
        if (p.phase === 'hashing' && p.done >= 3 && abortedAt === 0) {
          abortedAt = Date.now()
          controller.abort()
        }
      }
    })
    expect(out.cancelled).toBe(true)
    expect(abortedAt).toBeGreaterThan(0)
    expect(Date.now() - abortedAt).toBeLessThan(2000)
    expect(Date.now() - started).toBeLessThan(30_000)
  }, 60_000)

  it('benchmark: 200 images keep the main-thread event-loop lag small', async () => {
    const folder = await scanDir('bench', 200, { width: 640, height: 480 })
    const provider = createTsHashProvider({ tools, workers: 3 })
    let running = true
    let worst = 0
    const sampler = (async (): Promise<void> => {
      let last = performance.now()
      while (running) {
        await new Promise<void>((r) => setImmediate(r))
        const now = performance.now()
        worst = Math.max(worst, now - last)
        last = now
      }
    })()
    const out = await buildHashCsv({ dir: folder, kind: 'image', taskId: 'b', provider, concurrency: 3 })
    running = false
    await sampler
    expect(out.rowCount).toBe(200)
    expect(out.failedCount).toBe(0)
    // Decoding + hashing 640x480 images on the main thread stalls it for tens of ms per file;
    // with workers the loop only serves md5 chunks and CSV writes. Generous to avoid flakiness.
    expect(worst).toBeLessThan(300)
  }, 60_000)
})
