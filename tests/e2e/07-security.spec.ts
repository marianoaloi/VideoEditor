/** SPEC 6.9 and the ADR-003 security posture, probed against the real built app. */
import { expect, test } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { toMediaUrl } from '../../src/shared/ipc/mediaUrl'
import { launchApp, type E2eApp } from './support/launch'
import { makeTempDir, makeVideo, probeVideo, removeDir, sizeOf } from './support/media'

let e2e: E2eApp
let root: string
let session: string // opened folder (allowlisted)
let outside: string // never opened
const MARKER = 've-pwned-marker.txt'
// Windows forbids `"`, `<`, `>`, `|`, `*`, `?` in names: everything else a shell would act on is here.
const EVIL = `'quoted' & copy NUL ${MARKER} & ; $(whoami) \`id\` %PATH% ^caret! (x) [y] #z`
const NAME_MOVE = `A ${EVIL}.mp4`
const NAME_JOB = `B ${EVIL}.mp4`

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  e2e = await launchApp()
  root = makeTempDir('ve-e2e-sec-')
  session = join(root, 'session')
  outside = join(root, 'outside')
  mkdirSync(session)
  mkdirSync(outside)
  makeVideo(join(outside, 'secret.mp4'), { seconds: 1 })
  writeFileSync(join(outside, 'secret.txt'), 'top secret')
  makeVideo(join(session, NAME_MOVE), { seconds: 2, width: 320, height: 180 })
  makeVideo(join(session, NAME_JOB), { seconds: 2, width: 160, height: 90, pattern: 'smptebars' })
})
test.afterAll(async () => {
  await e2e?.close()
  if (root) removeDir(root)
})

test('media:// rejects a file outside every allowlisted root (403), even for a real file', async () => {
  for (const file of ['secret.mp4', 'secret.txt']) {
    const reply = await e2e.mediaFetch(toMediaUrl(join(outside, file)))
    expect(reply.status, file).toBe(403)
    expect(reply.text).not.toContain('top secret')
  }
  const missing = await e2e.mediaFetch(toMediaUrl(join(outside, 'nope.mp4')))
  expect([403, 404]).toContain(missing.status)
})

test('media:// rejects malformed URLs and non-absolute paths', async () => {
  expect((await e2e.mediaFetch('media://local/not-absolute')).status).toBe(400)
  expect((await e2e.mediaFetch('media://local/')).status).toBeGreaterThanOrEqual(400)
  expect(
    (await e2e.mediaFetch('media://bogushost/' + encodeURIComponent(join(outside, 'secret.txt'))))
      .status
  ).toBeGreaterThanOrEqual(400)
})

test('a folder the user never approved cannot be opened or probed, nor can a UNC path', async () => {
  const open = await e2e.invoke('session:open', { dir: outside, kind: 'video' })
  expect(open).toMatchObject({ ok: false, error: { code: 'PATH_NOT_ALLOWED' } })
  const probe = await e2e.invoke('media:probe', { path: join(outside, 'secret.mp4') })
  expect(probe).toMatchObject({ ok: false, error: { code: 'PATH_NOT_ALLOWED' } })
  const unc = await e2e.invoke('media:probe', { path: String.raw`\\server\share\a.mp4` })
  expect(unc).toMatchObject({ ok: false, error: { code: 'PATH_NOT_ALLOWED' } })
})

test('opening a session allowlists its root only; traversal and a junction out of it stay blocked', async () => {
  await e2e.approveFolder(session)
  await e2e.call('session:open', { dir: session, kind: 'video' })
  const inside = await e2e.mediaFetch(toMediaUrl(join(session, NAME_MOVE)), { range: 'bytes=0-9' })
  expect(inside.status).toBe(206)

  const traversal = join(session, '..', 'outside', 'secret.txt')
  expect((await e2e.mediaFetch(toMediaUrl(traversal))).status).toBe(403)

  const link = join(session, 'escape')
  try {
    symlinkSync(outside, link, 'junction')
  } catch (error) {
    test
      .info()
      .annotations.push({ type: 'gap', description: `junction not created: ${String(error)}` })
    return
  }
  const viaLink = await e2e.mediaFetch(toMediaUrl(join(link, 'secret.txt')))
  expect(viaLink.status).toBe(403)
  expect(viaLink.text).not.toContain('top secret')
})

test('window.api.invoke rejects unknown channels and bad payloads; on() rejects unknown events', async () => {
  const unknown = await e2e.invoke('shell:exec', { cmd: 'calc' })
  expect(unknown).toMatchObject({ ok: false, error: { code: 'UNKNOWN_CHANNEL' } })
  const proto = await e2e.invoke('__proto__', {})
  expect(proto.ok).toBe(false)
  const relative = await e2e.invoke('session:open', { dir: 'relative/dir', kind: 'video' })
  expect(relative).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
  const traversalFolder = await e2e.invoke('fileops:move', {
    sessionId: 'x',
    path: join(session, NAME_MOVE),
    destination: { type: 'folder', name: '..\\..\\evil' }
  })
  expect(traversalFolder.ok).toBe(false)
  const throws = await e2e.page.evaluate(() => {
    try {
      ;(window as unknown as { api: { on(c: string, l: () => void): void } }).api.on(
        'shell:exec',
        () => undefined
      )
      return false
    } catch {
      return true
    }
  })
  expect(throws).toBe(true)
})

test('a file with quotes/spaces/&/;/$()/backticks/%PATH% in its name moves (A) without shell interpretation', async () => {
  await e2e.goTo('Video Triage')
  await e2e.stubDirectoryDialog(session)
  await e2e.page.getByRole('button', { name: 'Open a folder' }).click()
  const label = e2e.page.getByTestId('item-label')
  await expect(label).toContainText(session)
  // Whichever is current: A-file goes to L, B-file goes to CUSTOM (job).
  for (let i = 0; i < 2; i += 1) {
    const text = await label.innerText()
    await e2e.page.keyboard.press(text.includes(join(session, 'A ')) ? 'a' : 'c')
    await e2e.page.waitForTimeout(300)
  }
  await expect
    .poll(() => (existsSync(join(session, 'L')) ? readdirSync(join(session, 'L')) : []))
    .toContain(NAME_MOVE)
  await expect
    .poll(() => (existsSync(join(session, 'CUSTOM')) ? readdirSync(join(session, 'CUSTOM')) : []))
    .toContain(NAME_JOB)
  expect(existsSync(join(session, 'CUSTOM', `${NAME_JOB}.json`))).toBe(true)
})

test('the same hostile name flows through a job: outputs exist, are playable, no marker file appears', async () => {
  await e2e.call('jobs:enqueueFolder', { dir: join(session, 'CUSTOM') })
  let jobs: { status: string; outputs: string[]; error: unknown }[] = []
  await expect
    .poll(
      async () => {
        jobs = await e2e.call('jobs:list')
        return jobs.length > 0 && jobs.every((j) => j.status !== 'queued' && j.status !== 'running')
      },
      { timeout: 60_000, intervals: [500] }
    )
    .toBe(true)
  expect(jobs).toHaveLength(1)
  expect(jobs[0]!.status, JSON.stringify(jobs[0]!.error)).toBe('done')
  const out = jobs[0]!.outputs[0]!
  expect(basename(out).startsWith(`B `)).toBe(true)
  expect(sizeOf(out)).toBeGreaterThan(1000)
  expect(probeVideo(out).codec).toBe('h264')

  for (const where of [process.cwd(), session, join(session, 'CUSTOM'), root, e2e.userData]) {
    expect(existsSync(join(where, MARKER)), `marker in ${where}`).toBe(false)
  }
  expect(e2e.consoleErrors).toEqual([])
})
