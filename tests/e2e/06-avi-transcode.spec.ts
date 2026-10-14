/** An AVI cannot be played natively: the player must use the media://transcode fallback (ADR-004). */
import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import { toTranscodeUrl } from '../../src/shared/ipc/mediaUrl'
import { launchApp, type E2eApp } from './support/launch'
import { makeTempDir, makeVideo, removeDir } from './support/media'

let e2e: E2eApp
let dir: string
test.beforeAll(async () => {
  e2e = await launchApp()
  dir = makeTempDir('ve-e2e-avi-')
  makeVideo(join(dir, 'legacy clip.avi'), { format: 'avi', width: 320, height: 240, seconds: 2 })
})
test.afterAll(async () => {
  await e2e?.close()
  if (dir) removeDir(dir)
})

test('media://transcode is refused until the folder is opened, then streams fragmented MP4', async () => {
  const avi = join(dir, 'legacy clip.avi')
  const denied = await e2e.mediaFetch(toTranscodeUrl(avi, 0))
  expect(denied.status).toBe(403)

  await e2e.goTo('Video Triage')
  await e2e.stubDirectoryDialog(dir)
  await e2e.page.getByRole('button', { name: 'Open a folder' }).click()
  await expect(e2e.page.getByTestId('item-label')).toContainText('legacy clip.avi')

  const ok = await e2e.mediaFetch(toTranscodeUrl(avi, 0), { maxBytes: 20_000 })
  expect(ok.status).toBe(200)
  expect(ok.headers['content-type']).toMatch(/video\/mp4/)
  expect(ok.bytes).toBeGreaterThan(1000)
  const seeked = await e2e.mediaFetch(toTranscodeUrl(avi, 1), { maxBytes: 5_000 })
  expect(seeked.status).toBe(200)
})

test('the <video> element plays the AVI through the transcode URL', async () => {
  await expect
    .poll(() => e2e.page.evaluate(() => document.querySelector('video')?.currentSrc ?? ''), {
      timeout: 20_000
    })
    .toContain('media://transcode/')
  await expect
    .poll(() => e2e.page.evaluate(() => document.querySelector('video')?.readyState ?? 0), {
      timeout: 30_000
    })
    .toBeGreaterThanOrEqual(2)
  expect(
    await e2e.page.evaluate(() => document.querySelector('video')?.error?.code ?? null)
  ).toBeNull()
  expect(e2e.consoleErrors).toEqual([])
})
