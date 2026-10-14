/** Video Triage sets itself up from `<video>.json` (current and legacy layouts). */
import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, type E2eApp } from './support/launch'
import { makeTempDir, makeVideo, removeDir, sizeOf } from './support/media'

let e2e: E2eApp
let dir: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  e2e = await launchApp()
  dir = makeTempDir('ve-e2e-sidecar-')
  // Biggest first: the app sorts by size, largest first.
  makeVideo(join(dir, 'a-current.mp4'), { width: 640, height: 360, seconds: 4, pattern: 'testsrc' })
  makeVideo(join(dir, 'b-legacy.mp4'), { width: 320, height: 180, seconds: 3 })
  makeVideo(join(dir, 'c-plain.mp4'), { width: 64, height: 36, seconds: 2, pattern: 'smptebars' })
  writeFileSync(
    join(dir, 'a-current.mp4.json'),
    JSON.stringify({
      version: 2,
      filename: join(dir, 'a-current.mp4'),
      originalPath: join(dir, 'a-current.mp4'),
      crop: { x: 0, y: 0, w: 320, h: 180 },
      bright: null,
      contrast: null,
      transpose: null,
      mediaPath: null,
      convert: false,
      size: '640x360',
      rate: 800,
      avgrate: null,
      times: [
        [500, 1500],
        [2000, 3000]
      ],
      posExecution: 2
    })
  )
  // The pre-v2 layout: definedSize/definedRate and {st, du} ranges, posExecution "f" (concat in the old layout).
  writeFileSync(
    join(dir, 'b-legacy.mp4.json'),
    JSON.stringify({
      filename: join(dir, 'b-legacy.mp4'),
      originalPath: join(dir, 'b-legacy.mp4'),
      definedSize: '320x180',
      definedRate: '500',
      times: [{ st: 500, du: 1500 }],
      posExecution: 'f'
    })
  )
})
test.afterAll(async () => {
  await e2e?.close()
  if (dir) removeDir(dir)
})

const notice = (text: string | RegExp) => e2e.page.getByText(text)
const label = () => e2e.page.getByTestId('item-label')

/** The app lists videos by size, largest first; do not assume which synthetic clip that is. */
function appOrder(): string[] {
  return ['a-current.mp4', 'b-legacy.mp4', 'c-plain.mp4'].sort(
    (a, b) => sizeOf(join(dir, b)) - sizeOf(join(dir, a)) || a.localeCompare(b)
  )
}

const EXPECTED: Record<string, string | RegExp | null> = {
  'a-current.mp4': 'Loaded a-current.mp4.json: 2 ranges, concat, crop, size 640x360, 800 kbit/s',
  'b-legacy.mp4': /Loaded b-legacy\.mp4\.json: 1 range, concat, size 320x180, 500 kbit\/s/,
  'c-plain.mp4': null
}

test('every video that has a job file (current or legacy layout) is set up from it', async () => {
  await e2e.goTo('Video Triage')
  await e2e.stubDirectoryDialog(dir)
  await e2e.page.getByRole('button', { name: 'Open a folder' }).click()
  const order = appOrder()
  for (const [index, name] of order.entries()) {
    await expect(label()).toContainText(name, { timeout: 15_000 })
    const expected = EXPECTED[name]
    if (expected !== null && expected !== undefined) {
      await expect(notice(expected)).toBeVisible({ timeout: 15_000 })
    } else {
      // Earlier notices auto-hide after 3 s; none may appear for a video without a job file.
      await e2e.page.waitForTimeout(4_000)
      await expect(notice(/Loaded .*\.json/)).toHaveCount(0)
    }
    if (index < order.length - 1) await e2e.page.keyboard.press('d')
  }
})

test('no console errors while loading job files', () => {
  expect(e2e.consoleErrors).toEqual([])
})
