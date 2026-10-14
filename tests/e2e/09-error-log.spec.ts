/** A video that cannot be read: the error toast carries a log icon that opens the real ffprobe error. */
import { expect, test } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, type E2eApp } from './support/launch'
import { makeTempDir, makeVideo, removeDir } from './support/media'

let e2e: E2eApp
let dir: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  e2e = await launchApp()
  dir = makeTempDir('ve-e2e-errlog-')
  // Largest first, so the corrupt file is the first video shown.
  writeFileSync(join(dir, 'broken.mp4'), randomBytes(400_000))
  makeVideo(join(dir, 'fine.mp4'), { width: 64, height: 36, seconds: 2 })
})
test.afterAll(async () => {
  await e2e?.close()
  if (dir) removeDir(dir)
})

test('an unreadable video shows an error toast with a log icon; the log has the ffprobe error', async () => {
  await e2e.goTo('Video Triage')
  await e2e.stubDirectoryDialog(dir)
  await e2e.page.getByRole('button', { name: 'Open a folder' }).click()

  await expect(e2e.page.getByText('Cannot read broken.mp4')).toBeVisible({ timeout: 20_000 })
  const showLog = e2e.page.getByRole('button', { name: 'Show log' })
  await expect(showLog).toBeVisible()
  await showLog.click()

  const dialog = e2e.page.getByRole('dialog', { name: 'Log: Cannot read broken.mp4' })
  await expect(dialog).toBeVisible()
  const text = (await dialog.getByTestId('log-text').textContent()) ?? ''
  expect(text).toContain('Cannot read this video')
  expect(text).toContain(join(dir, 'broken.mp4'))
  expect(text).toContain('Error code: PROBE_FAILED')
  expect(text).toContain('--- output ---') // what ffprobe printed

  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()
  // The toast is still there until it is dismissed.
  await expect(e2e.page.getByText('Cannot read broken.mp4')).toBeVisible()
})

test('a readable video has no log icon', async () => {
  await e2e.page.getByRole('button', { name: 'Close' }).first().click()
  await e2e.page.keyboard.press('d')
  await expect(e2e.page.getByTestId('item-label')).toContainText('fine.mp4', { timeout: 15_000 })
  await expect(e2e.page.getByRole('button', { name: 'Show log' })).toHaveCount(0)
})
