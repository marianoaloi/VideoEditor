import { expect, test } from '@playwright/test'
import { launchApp, type E2eApp } from './support/launch'

let e2e: E2eApp
test.beforeAll(async () => {
  e2e = await launchApp()
})
test.afterAll(async () => {
  await e2e?.close()
})

const WORKSPACES = ['Video Triage', 'Image Triage', 'Cutter', 'Jobs', 'Duplicates', 'Settings']

test('SPEC 6.10 app starts: title, six workspaces, no console errors', async () => {
  await expect(e2e.page).toHaveTitle(/VideoEditor/i)
  const nav = e2e.page.getByRole('navigation', { name: 'Workspaces' })
  for (const label of WORKSPACES) await expect(nav.getByText(label, { exact: true })).toBeVisible()
  await expect(nav.getByRole('button')).toHaveCount(6)
  expect(e2e.consoleErrors).toEqual([])
})

test('each workspace opens without console errors', async () => {
  for (const label of WORKSPACES) {
    await e2e.goTo(label)
    await expect(
      e2e.page
        .getByRole('navigation')
        .getByText(label, { exact: true })
        .locator('xpath=ancestor::*[@aria-current="page"]')
    ).toHaveCount(1)
  }
  await e2e.goTo('Video Triage')
  expect(e2e.consoleErrors).toEqual([])
})

test('window.api is present and typed channels answer', async () => {
  const shape = await e2e.page.evaluate(() => {
    const api = (window as unknown as { api?: Record<string, unknown> }).api
    return { present: api !== undefined, invoke: typeof api?.invoke, on: typeof api?.on }
  })
  expect(shape).toEqual({ present: true, invoke: 'function', on: 'function' })

  const info = await e2e.call<{
    platform: string
    userDataDir: string
    versions: { electron: string }
  }>('app:info')
  expect(info.platform).toBe(process.platform)
  expect(info.userDataDir.toLowerCase()).toBe(e2e.userData.toLowerCase())
  const settings = await e2e.call<{ folders: { custom: string } }>('settings:get')
  expect(settings.folders.custom).toBe('CUSTOM')
  const tools = await e2e.call<{ ffmpeg: { path: string } | null }>('jobs:tools')
  expect(tools.ffmpeg).not.toBeNull()
})

test('the sandboxed renderer has no node access', async () => {
  const leaked = await e2e.page.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process
  }))
  expect(leaked).toEqual({ require: 'undefined', process: 'undefined' })
})
