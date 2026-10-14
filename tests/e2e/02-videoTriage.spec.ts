/** SPEC 6 criteria 4 and 5, media:// Range serving, trash, AVI fallback. */
import { expect, test } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { toMediaUrl } from '../../src/shared/ipc/mediaUrl'
import { launchApp, type E2eApp } from './support/launch'
import { makeTempDir, makeVideo, removeDir, sizeOf } from './support/media'

let e2e: E2eApp
let dir: string
let names: string[] // sorted size desc, like the app

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  e2e = await launchApp()
  dir = makeTempDir('ve-e2e-vt-')
  makeVideo(join(dir, 'big one.mp4'), { width: 640, height: 360, seconds: 3, pattern: 'testsrc' })
  makeVideo(join(dir, 'mid.mp4'), { width: 320, height: 180, seconds: 3 })
  makeVideo(join(dir, 'small.mp4'), { width: 160, height: 90, seconds: 2, pattern: 'smptebars' })
  makeVideo(join(dir, 'tiny.mp4'), { width: 64, height: 36, seconds: 2, pattern: 'mandelbrot' })
  names = readdirSync(dir).sort(
    (a, b) => sizeOf(join(dir, b)) - sizeOf(join(dir, a)) || a.localeCompare(b)
  )
  // A sidecar that must follow its video through move and undo.
  writeFileSync(join(dir, `${names[0]}.json`), JSON.stringify({ times: [[0, 1000]] }))
  names = names.filter((n) => !n.endsWith('.json'))
})
test.afterAll(async () => {
  await e2e?.close()
  if (dir) removeDir(dir)
})

const label = () => e2e.page.getByTestId('item-label')
const press = (key: string) => e2e.page.keyboard.press(key)
const files = (sub: string) =>
  existsSync(join(dir, sub)) ? readdirSync(join(dir, sub)).sort() : []

async function expectCurrent(name: string): Promise<void> {
  await expect(label()).toContainText(join(dir, name), { timeout: 15_000 })
}

test('open folder through the UI lists videos sorted by size, largest first', async () => {
  await e2e.goTo('Video Triage')
  await e2e.stubDirectoryDialog(dir)
  await e2e.page.getByRole('button', { name: 'Open a folder' }).click()
  await expectCurrent(names[0]!)
  await expect(label()).toContainText(`${names.length}/1`)
})

test('media:// serves the current video with HTTP Range (206) and rejects nothing it should serve', async () => {
  const url = toMediaUrl(join(dir, names[0]!))
  const reply = await e2e.mediaFetch(url, { range: 'bytes=0-99' })
  const head = await e2e.mediaFetch(url, { method: 'HEAD' })
  const size = sizeOf(join(dir, names[0]!))
  expect(reply.status).toBe(206)
  expect(reply.headers['content-range']).toBe(`bytes 0-99/${size}`)
  expect(reply.bytes).toBe(100)
  expect(reply.headers['accept-ranges']).toBe('bytes')
  expect(reply.headers['content-type']).toMatch(/^video\//)
  expect(head.status).toBe(200)
  expect(head.headers['content-length']).toBe(String(size))
})

test('the <video> element really loads and plays the file (readyState, duration)', async () => {
  await expect
    .poll(
      () =>
        e2e.page.evaluate(() => {
          const v = document.querySelector('video')
          return v === null
            ? null
            : { ready: v.readyState, duration: v.duration, src: v.currentSrc.slice(0, 8) }
        }),
      { timeout: 20_000 }
    )
    .toMatchObject({ src: 'media://' })
  await expect
    .poll(() => e2e.page.evaluate(() => document.querySelector('video')?.readyState ?? 0), {
      timeout: 20_000
    })
    .toBeGreaterThanOrEqual(2)
})

test('SPEC 6.4: A moves to L (with its .json sidecar), B undoes it', async () => {
  const first = names[0]!
  await press('a')
  await expectCurrent(names[1]!)
  expect(files('L')).toEqual([first, `${first}.json`].sort())
  expect(existsSync(join(dir, first))).toBe(false)
  expect(existsSync(join(dir, `${first}.json`))).toBe(false)

  await press('b')
  await expectCurrent(first)
  expect(files('L')).toEqual([])
  expect(existsSync(join(dir, first))).toBe(true)
  expect(JSON.parse(readFileSync(join(dir, `${first}.json`), 'utf8'))).toMatchObject({
    times: [[0, 1000]]
  })
})

test('SPEC 6.4: F moves to R, D moves nowhere, B undoes both in LIFO order', async () => {
  const [a, b] = [names[0]!, names[1]!]
  await press('f') // a -> R
  await expectCurrent(b)
  expect(files('R')).toContain(a)
  await press('d') // skip b
  await expectCurrent(names[2]!)
  expect(existsSync(join(dir, b))).toBe(true)

  await press('b') // undo the skip
  await expectCurrent(b)
  await press('b') // undo the move to R
  await expectCurrent(a)
  expect(files('R')).toEqual([])
  expect(existsSync(join(dir, a))).toBe(true)
})

test('Shift+Delete sends the file (and its sidecar) to the trash and is not undoable', async () => {
  const victim = names[0]!
  await press('Shift+Delete')
  await expectCurrent(names[1]!)
  await expect.poll(() => e2e.trashed()).toContain(join(dir, victim))
  expect(existsSync(join(dir, victim))).toBe(false)
  expect(await e2e.trashed()).toContain(join(dir, `${victim}.json`))
  await press('b') // nothing to undo: trash is not on the stack, so the file must not come back
  await e2e.page.waitForTimeout(500)
  expect(existsSync(join(dir, victim))).toBe(false)
})

test('SPEC 6.5: C with no ranges writes times=[[low,high]] and moves the video to CUSTOM', async () => {
  const target = names[1]!
  await expectCurrent(target)
  await expect
    .poll(() => e2e.page.evaluate(() => document.querySelector('video')?.readyState ?? 0))
    .toBeGreaterThanOrEqual(1)
  await press('c')
  await expect.poll(() => files('CUSTOM'), { timeout: 15_000 }).toContain(target)
  const jsonPath = join(dir, 'CUSTOM', `${target}.json`)
  await expect.poll(() => existsSync(jsonPath)).toBe(true)
  const job = await e2e.call<{ found: boolean; job: { times: [number, number][] } }>(
    'jobs:readJob',
    {
      videoPath: join(dir, 'CUSTOM', target)
    }
  )
  expect(job.found).toBe(true)
  expect(job.job.times).toHaveLength(1)
  const [low, high] = job.job.times[0]!
  expect(low).toBeGreaterThanOrEqual(0)
  expect(high).toBeGreaterThan(low)
})

test('no console errors during the Video Triage flow', () => {
  expect(e2e.consoleErrors).toEqual([])
})
