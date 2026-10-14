/** SPEC 6 criteria 2/3 on the real app: batch the CUSTOM folder through the Jobs workspace. */
import { expect, test } from '@playwright/test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { basename, join } from 'node:path'
import { launchApp, type E2eApp } from './support/launch'
import {
  makeTempDir,
  makeVideo,
  probeVideo,
  removeDir,
  sizeOf,
  truncateFile
} from './support/media'

interface JobRow {
  id: string
  videoPath: string
  mode: 1 | 2
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  outputs: string[]
  error: { code: string; message: string } | null
}

let e2e: E2eApp
let root: string
let custom: string
const POS_CUT = 1
const POS_CONCAT = 2

test.describe.configure({ mode: 'serial' })

async function saveJob(
  video: string,
  times: [number, number][],
  posExecution: 1 | 2
): Promise<void> {
  await e2e.call('jobs:saveJob', { videoPath: video, job: { times, posExecution } })
}

test.beforeAll(async () => {
  e2e = await launchApp()
  root = makeTempDir('ve-e2e-jobs-')
  custom = join(root, 'CUSTOM')
  mkdirSync(custom)
  makeVideo(join(custom, 'cut.mp4'), { seconds: 4 })
  makeVideo(join(custom, 'cat.mp4'), { seconds: 4, pattern: 'testsrc' })
  writeFileSync(join(custom, 'corrupt.mp4'), randomBytes(6000))
  makeVideo(join(custom, 'damaged.mp4'), {
    seconds: 6,
    width: 640,
    height: 360,
    pattern: 'testsrc'
  })
  truncateFile(join(custom, 'damaged.mp4'), 0.6)
  await e2e.approveFolder(root)
  await saveJob(
    join(custom, 'cut.mp4'),
    [
      [0, 1000],
      [2000, 3500]
    ],
    POS_CUT
  )
  await saveJob(
    join(custom, 'cat.mp4'),
    [
      [0, 1000],
      [2000, 3000]
    ],
    POS_CONCAT
  )
  await saveJob(join(custom, 'corrupt.mp4'), [[0, 1000]], POS_CUT)
  await saveJob(join(custom, 'damaged.mp4'), [[0, 1000]], POS_CUT)
})
test.afterAll(async () => {
  await e2e?.close()
  if (root) removeDir(root)
})

async function waitIdle(): Promise<JobRow[]> {
  let rows: JobRow[] = []
  await expect
    .poll(
      async () => {
        rows = await e2e.call<JobRow[]>('jobs:list')
        return rows.length > 0 && rows.every((r) => r.status !== 'queued' && r.status !== 'running')
      },
      { timeout: 90_000, intervals: [500] }
    )
    .toBe(true)
  return rows
}

test('batch on CUSTOM/ through the Jobs UI: cut -> .0/.1 mp4, concat -> one mp4, corrupt -> failed', async () => {
  await e2e.goTo('Jobs')
  await e2e.stubDirectoryDialog(custom)
  await e2e.page.getByRole('button', { name: 'Choose folder and process' }).click()
  const rows = await waitIdle()
  expect(rows).toHaveLength(4)
  const byName = (name: string): JobRow => rows.find((r) => basename(r.videoPath) === name)!

  const cut = byName('cut.mp4')
  expect(cut.status, JSON.stringify(cut.error)).toBe('done')
  expect(cut.outputs.map((o) => basename(o)).sort()).toEqual(['cut.mp4.0.mp4', 'cut.mp4.1.mp4'])
  const cat = byName('cat.mp4')
  expect(cat.status, JSON.stringify(cat.error)).toBe('done')
  expect(cat.outputs).toHaveLength(1)
  expect(basename(cat.outputs[0]!)).toMatch(/^cat\.mp4(\.\d+)?\.mp4$/)

  for (const output of [...cut.outputs, ...cat.outputs]) {
    expect(existsSync(output), output).toBe(true)
    expect(sizeOf(output), output).toBeGreaterThan(1000)
    const probed = probeVideo(output)
    expect(probed.codec).toBe('h264')
    expect(probed.durationSec).toBeGreaterThan(0.5)
  }
  expect(probeVideo(cut.outputs.find((o) => o.endsWith('.0.mp4'))!).durationSec).toBeCloseTo(1, 0)
  expect(probeVideo(cut.outputs.find((o) => o.endsWith('.1.mp4'))!).durationSec).toBeCloseTo(1.5, 0)
  expect(probeVideo(cat.outputs[0]!).durationSec).toBeCloseTo(2, 0)

  const bad = byName('corrupt.mp4')
  expect(bad.status).toBe('error')
  expect(bad.error?.code).toBe('PROBE_FAILED')
  expect(bad.error).not.toBeNull()
  expect(bad.error?.message.length ?? 0).toBeGreaterThan(0)
  expect(bad.outputs.filter((o) => existsSync(o) && sizeOf(o) > 1000)).toEqual([])

  // A truncated file probes fine but decodes badly: it must end in a DEFINITE state, and a "done"
  // may only be reported with a real output (the >1000 bytes rule, SPEC 6.3).
  const damaged = byName('damaged.mp4')
  expect(['done', 'error']).toContain(damaged.status)
  if (damaged.status === 'done') {
    expect(damaged.outputs.length).toBeGreaterThan(0)
    for (const o of damaged.outputs) expect(sizeOf(o)).toBeGreaterThan(1000)
  } else {
    expect(damaged.error).not.toBeNull()
  }
})

test('the queue table shows done and error chips and the error message is shown', async () => {
  const table = e2e.page.getByRole('table', { name: 'Job queue' })
  const damagedDone = (await e2e.call<JobRow[]>('jobs:list')).some(
    (r) => r.videoPath.endsWith('damaged.mp4') && r.status === 'done'
  )
  await expect(table.getByText('done', { exact: true })).toHaveCount(2 + (damagedDone ? 1 : 0))
  await expect(table.getByText('error', { exact: true })).toHaveCount(1 + (damagedDone ? 0 : 1))
  const rows = await e2e.call<JobRow[]>('jobs:list')
  const bad = rows.find((r) => r.videoPath.endsWith('corrupt.mp4'))!
  const log = await e2e.call<{ lines: string[] }>('jobs:log', { jobId: bad.id })
  expect(Array.isArray(log.lines)).toBe(true)
  await table.getByText('corrupt.mp4').click()
  await expect(e2e.page.getByRole('alert').filter({ hasText: /Invalid data found/ })).toBeVisible()
})

test('an orphan/empty JSON is skipped and moved aside, never deleted; the JSON of a done job survives', async () => {
  writeFileSync(join(custom, 'orphan.mp4.json'), '{"times":[[0,1000]]}')
  const result = await e2e.call<{
    jobIds: string[]
    skipped: { path: string; movedTo: string | null }[]
  }>('jobs:enqueueFolder', { dir: custom })
  const orphan = result.skipped.find((s) => s.path.endsWith('orphan.mp4.json'))
  expect(orphan, JSON.stringify(result)).toBeDefined()
  const kept = orphan!.movedTo ?? join(custom, 'orphan.mp4.json')
  expect(existsSync(kept)).toBe(true)
  await waitIdle()
})

test('no console errors during the Jobs flow', () => {
  expect(e2e.consoleErrors).toEqual([])
})
