/** SPEC 6.7: duplicate groups from a freshly built CSV, and "Move to R" moving only the selection. */
import { expect, test } from '@playwright/test'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launchApp, type E2eApp } from './support/launch'
import { makeImage, makeTempDir, removeDir } from './support/media'

let e2e: E2eApp
let root: string
let dir: string
test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  e2e = await launchApp()
  root = makeTempDir('ve-e2e-dup-')
  dir = join(root, 'imgs') // the CSV is written to the PARENT of the scanned folder
  mkdirSync(dir)
  makeImage(join(dir, 'pic one.png'), 'a', 200, 120)
  copyFileSync(join(dir, 'pic one.png'), join(dir, 'pic one copy.png'))
  makeImage(join(dir, 'different.png'), 'b', 200, 120)
})
test.afterAll(async () => {
  await e2e?.close()
  if (root) removeDir(root)
})

const cell = (name: string) => e2e.page.getByRole('button', { name: join(dir, name) })

test('build the CSV for the folder through the UI and find the identical pair', async () => {
  await e2e.goTo('Duplicates')
  await e2e.page.getByRole('button', { name: 'Image', exact: true }).click()
  await e2e.stubDirectoryDialog(dir)
  await e2e.page.getByRole('button', { name: 'Choose folder' }).click()
  // No analysis yet: the screen offers to build it.
  await e2e.page.getByRole('button', { name: 'Build', exact: true }).click()
  const md5Button = e2e.page.getByRole('button', { name: /^md5: 1 group \/ 2 files$/ })
  await expect(md5Button).toBeEnabled({ timeout: 60_000 })

  const csv = await e2e.call<{ csvPath: string; exists: boolean }>('hashing:csvPath', {
    dir,
    kind: 'image'
  })
  expect(csv.exists).toBe(true)
  expect(dirname(csv.csvPath).toLowerCase()).toBe(root.toLowerCase())

  await md5Button.click()
  await expect(cell('pic one.png')).toBeVisible()
  await expect(cell('pic one copy.png')).toBeVisible()
  await expect(cell('different.png')).toHaveCount(0)
})

test('grouping data: the pair shares md5/pureMD5, the odd one out does not', async () => {
  const table = await e2e.call<{ rows: { path: string; md5: string; pureMD5: string }[] }>(
    'hashing:load',
    {
      source: { dir, kind: 'image' }
    }
  )
  const by = (name: string) => table.rows.find((r) => r.path.endsWith(name))!
  expect(table.rows).toHaveLength(3)
  expect(by('pic one.png').md5).toBe(by('pic one copy.png').md5)
  expect(by('pic one.png').md5).not.toBe(by('different.png').md5)
})

test('Move to R moves only the selected file', async () => {
  await cell('pic one copy.png').click()
  await expect(cell('pic one copy.png')).toHaveAttribute('aria-pressed', 'true')
  await expect(cell('pic one.png')).toHaveAttribute('aria-pressed', 'false')
  await e2e.page.getByRole('button', { name: 'Move to R (1)' }).click()

  await expect
    .poll(() => existsSync(join(dir, 'pic one copy.png')), { timeout: 15_000 })
    .toBe(false)
  const { folders } = await e2e.call<{ folders: { purge: string } }>('settings:get')
  expect(readdirSync(join(dir, folders.purge))).toEqual(['pic one copy.png'])
  expect(
    readdirSync(dir)
      .filter((n) => n.endsWith('.png'))
      .sort()
  ).toEqual(['different.png', 'pic one.png'])
})

test('no console errors during the Duplicates flow', () => {
  expect(e2e.consoleErrors).toEqual([])
})
