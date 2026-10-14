import { rm } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createEnv, makeBase, touch, type TestEnv } from '../fileops/testSupport'
import { registerMediaIpc } from './ipc'

let env: TestEnv
const extra: string[] = []
afterEach(async () => {
  await rm(env.base, { recursive: true, force: true })
  for (const dir of extra.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** Every media channel that takes a path, with a request builder. */
const CHANNELS: [string, (file: string) => unknown][] = [
  ['media:probe', (path) => ({ path })],
  ['media:probeMany', (path) => ({ paths: [path] })],
  ['media:grabFrame', (path) => ({ path, atMs: 0 })],
  ['media:mosaic', (path) => ({ path })],
  ['media:prefetch', (path) => ({ paths: [path], what: ['probe'] })],
  ['media:generateMosaics', (path) => ({ taskId: 't1', paths: [path] })],
  ['media:detectBlackBars', (path) => ({ path })],
  ['media:imagePreview', (path) => ({ path })]
]

describe('media channels only accept opened or approved paths (review H2)', () => {
  it.each(CHANNELS)('%s refuses unapproved, UNC and device paths', async (channel, build) => {
    env = await createEnv()
    registerMediaIpc(env.ctx)
    const outside = await makeBase('outside')
    extra.push(outside)
    const unapproved = await touch(path.join(outside, 'a.mp4'))
    for (const file of [unapproved, '\\\\server\\share\\a.mp4', '\\\\?\\C:\\Windows\\win.ini']) {
      expect(await env.call(channel, build(file))).toMatchObject({
        ok: false,
        error: { code: 'PATH_NOT_ALLOWED' }
      })
    }
  })

  it('an approved folder passes the guard (the failure is then about the file, not the path)', async () => {
    env = await createEnv()
    registerMediaIpc(env.ctx)
    const res = await env.call('media:probe', { path: path.join(env.base, 'missing.mp4') })
    expect(res).toMatchObject({ ok: false })
    expect(res).not.toMatchObject({ error: { code: 'PATH_NOT_ALLOWED' } })
  })
})
