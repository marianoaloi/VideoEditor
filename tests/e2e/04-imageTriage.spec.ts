/** SPEC 6 criteria 8 (quick-crop, bkp, restore) and A/F image moves with undo. */
import { expect, test } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { launchApp, type E2eApp } from './support/launch'
import { makeImage, makeTempDir, removeDir, sizeOf } from './support/media'

let e2e: E2eApp
let dir: string
test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  e2e = await launchApp()
  dir = makeTempDir('ve-e2e-img-')
  makeImage(join(dir, 'p1.png'), 'a', 320, 160)
  makeImage(join(dir, 'p2.png'), 'b', 320, 160)
  makeImage(join(dir, 'p3.jpg'), 'c', 320, 160)
  makeImage(join(dir, 'p4.png'), 'a', 320, 160)
})
test.afterAll(async () => {
  await e2e?.close()
  if (dir) removeDir(dir)
})

const press = (key: string) => e2e.page.keyboard.press(key)
const status = () => e2e.page.getByTestId('status-line')
const files = (sub: string) =>
  existsSync(join(dir, sub)) ? readdirSync(join(dir, sub)).sort() : []
const rootImages = () =>
  readdirSync(dir)
    .filter((n) => /\.(png|jpg)$/.test(n))
    .sort()

async function dims(path: string): Promise<[number, number]> {
  const m = await sharp(path).metadata()
  return [m.width ?? 0, m.height ?? 0]
}

test('open folder through the UI; thumbnails load over media://', async () => {
  await e2e.goTo('Image Triage')
  await e2e.stubDirectoryDialog(dir)
  await e2e.page.getByRole('button', { name: 'Open folder' }).click()
  await expect(status()).toContainText(dir)
  await expect
    .poll(
      () =>
        e2e.page.evaluate(
          () => [...document.images].filter((i) => i.complete && i.naturalWidth > 0).length
        ),
      { timeout: 15_000 }
    )
    .toBeGreaterThan(0)
})

test('A moves to L, F moves to R, B undoes in LIFO order', async () => {
  const before = rootImages()
  expect(before).toHaveLength(4)
  const firstText = await status().innerText()
  await press('a')
  await expect.poll(() => files('L').length).toBe(1)
  await press('f')
  await expect.poll(() => files('R').length).toBe(1)
  expect(rootImages()).toHaveLength(2)
  await press('b')
  await expect.poll(() => files('R').length).toBe(0)
  await press('b')
  await expect.poll(() => files('L').length).toBe(0)
  expect(rootImages()).toEqual(before)
  expect(await status().innerText()).toBe(firstText)
})

test('SPEC 6.8: quick-crop backs up to bkp/, adds a quick-crop button, Ctrl+F restores', async () => {
  const current =
    (await e2e.page.evaluate(
      () => document.querySelector('[data-testid="status-line"]')?.textContent ?? ''
    )) ?? ''
  const name = rootImages().find((n) => current.includes(n))
  expect(name, current).toBeDefined()
  const target = join(dir, name!)
  const [w0, h0] = await dims(target)
  const sizeBefore = sizeOf(target)

  await press('Control+Shift+S')
  const apply = e2e.page.getByRole('dialog').getByRole('button', { name: /^Vertical Default/ })
  await expect(apply).toBeVisible({ timeout: 15_000 })
  await press('Control+Shift+A') // Vertical default: full height, then apply

  await expect.poll(() => files('bkp'), { timeout: 15_000 }).toContain(name)
  await expect
    .poll(async () => (await dims(target)).join('x'), { timeout: 15_000 })
    .not.toBe(`${w0}x${h0}`)
  const [w1, h1] = await dims(target)
  expect(w1 * h1).toBeLessThan(w0 * h0)
  expect(await dims(join(dir, 'bkp', name!))).toEqual([w0, h0])
  expect(sizeOf(join(dir, 'bkp', name!))).toBe(sizeBefore)

  // A quick-crop button now exists in the controls bar (label carries the crop size).
  await expect(e2e.page.getByRole('button', { name: `${w1} x ${h1}` })).toHaveCount(1)

  await press('Control+f')
  await expect
    .poll(async () => (await dims(target)).join('x'), { timeout: 15_000 })
    .toBe(`${w0}x${h0}`)
  expect(sizeOf(target)).toBe(sizeBefore)
  // Un-crop consumes the backup (image-triage checklist 41): nothing stale is left to collide later.
  await expect.poll(() => files('bkp'), { timeout: 15_000 }).not.toContain(name)
})

test('SPEC 6.8: Ctrl+Shift+F moves the current image left and applies the last crop to the next', async () => {
  const text = await status().innerText()
  const current = rootImages().find((n) => text.includes(n))!
  const next = rootImages().filter((n) => n !== current)[0]!
  const [w0, h0] = await dims(join(dir, next))
  await press('Control+Shift+F')
  await expect.poll(() => files('L'), { timeout: 15_000 }).toContain(current)
  await expect.poll(() => files('bkp'), { timeout: 15_000 }).toContain(next)
  const [w1, h1] = await dims(join(dir, next))
  expect(w1 * h1).toBeLessThan(w0 * h0)
})

test('no console errors during the Image Triage flow', () => {
  expect(e2e.consoleErrors).toEqual([])
})
