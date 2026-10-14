import { rm } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Session } from '@shared/domain/session'
import { createEnv, touch, type TestEnv } from '../fileops/testSupport'

let env: TestEnv
afterEach(async () => {
  await rm(env.base, { recursive: true, force: true })
})

async function open(dir: string, extra: Record<string, unknown> = {}): Promise<Session> {
  return env.ok<Session>('session:open', { dir, kind: 'video', ...extra })
}

describe('session:open (video-triage §1.3/§1.4, checklist 5-7)', () => {
  it('lists only matching kinds, includes hidden files and the .3gp family (5)', async () => {
    env = await createEnv()
    const root = path.join(env.base, 'in')
    await touch(path.join(root, 'a.mp4'))
    await touch(path.join(root, 'b.MKV'))
    await touch(path.join(root, 'c.3gp'))
    await touch(path.join(root, '.hidden.mov'))
    await touch(path.join(root, 'pic.jpg'))
    await touch(path.join(root, 'notes.txt'))
    const session = await open(root)
    expect(session.items.map((i) => i.name).sort()).toEqual(['.hidden.mov', 'a.mp4', 'b.MKV', 'c.3gp'])
    expect(session.items.every((i) => i.kind === 'video')).toBe(true)
  })

  it('sorts by size descending, ties by natural path (6)', async () => {
    env = await createEnv()
    const root = path.join(env.base, 'in')
    await touch(path.join(root, 'v10.mp4'), '12')
    await touch(path.join(root, 'v2.mp4'), '12')
    await touch(path.join(root, 'big.mp4'), '123456')
    await touch(path.join(root, 'small.mp4'), '1')
    const session = await open(root)
    expect(session.items.map((i) => i.name)).toEqual(['big.mp4', 'v2.mp4', 'v10.mp4', 'small.mp4'])
  })

  it('sorts by name when asked', async () => {
    env = await createEnv()
    const root = path.join(env.base, 'in')
    await touch(path.join(root, 'b.mp4'), '123')
    await touch(path.join(root, 'a10.mp4'), '1')
    await touch(path.join(root, 'a9.mp4'), '1')
    const session = await open(root, { sort: 'name' })
    expect(session.items.map((i) => i.name)).toEqual(['a9.mp4', 'a10.mp4', 'b.mp4'])
  })

  it('is not recursive by default and recursive on request, with relDir', async () => {
    env = await createEnv()
    const root = path.join(env.base, 'in')
    await touch(path.join(root, 'top.mp4'))
    await touch(path.join(root, 'sub', 'deep', 'x.mp4'))
    expect((await open(root)).items.map((i) => i.name)).toEqual(['top.mp4'])
    const rec = await open(root, { recursive: true })
    const deep = rec.items.find((i) => i.name === 'x.mp4')
    expect(deep?.relDir).toBe(path.join('sub', 'deep'))
    expect(rec.recursive).toBe(true)
  })

  it('skips destination folders at the root, .mediamaloi, the thumb cache and bkp at any depth (ADR-006)', async () => {
    env = await createEnv()
    const root = path.join(env.base, 'in')
    await touch(path.join(root, 'keep.mp4'))
    for (const dir of ['L', 'R', 'CUSTOM', 'md5Purge', 'ruimFolder', '.mediamaloi', 'bkp']) {
      await touch(path.join(root, dir, 'no.mp4'))
    }
    await touch(path.join(root, 'sub', 'bkp', 'no.mp4'))
    await touch(path.join(root, 'sub', 'L', 'yes.mp4'))
    const cache = path.join(root, 'cache')
    await touch(path.join(cache, 'no.mp4'))
    await env.ok('settings:update', { patch: { thumbs: { cacheDir: cache } } })
    const session = await open(root, { recursive: true })
    expect(session.items.map((i) => i.name).sort()).toEqual(['keep.mp4', 'yes.mp4'])
    expect(session.skippedDirs.length).toBeGreaterThanOrEqual(8)
  })

  it('image sessions include GIFs; gif sessions only GIFs', async () => {
    env = await createEnv()
    const root = path.join(env.base, 'in')
    await touch(path.join(root, 'a.jpg'))
    await touch(path.join(root, 'b.gif'))
    await touch(path.join(root, 'c.mp4'))
    expect((await open(root, { kind: 'image' })).items.map((i) => i.name).sort()).toEqual(['a.jpg', 'b.gif'])
    expect((await open(root, { kind: 'gif' })).items.map((i) => i.name)).toEqual(['b.gif'])
  })

  it('registers the root in the allowlist and releases it on close; progress ends with done', async () => {
    env = await createEnv()
    const root = path.join(env.base, 'in')
    await touch(path.join(root, 'a.mp4'))
    const session = await open(root, { requestId: 'videoTriage' })
    expect(env.ctx.allowlist.isAllowed(path.join(root, 'a.mp4'))).toBe(true)
    const progress = env.events.filter((e) => e.channel === 'session:scanProgress')
    expect(progress.at(-1)?.payload).toMatchObject({ requestId: 'videoTriage', matched: 1, done: true })
    await env.ok('session:close', { sessionId: session.id })
    expect(env.ctx.allowlist.isAllowed(path.join(root, 'a.mp4'))).toBe(false)
    const again = await env.call('session:rescan', { sessionId: session.id })
    expect(again).toMatchObject({ ok: false, error: { code: 'SESSION_NOT_FOUND' } })
  })

  it('rescan re-reads the folder with the same options', async () => {
    env = await createEnv()
    const root = path.join(env.base, 'in')
    await touch(path.join(root, 'a.mp4'))
    const session = await open(root)
    await touch(path.join(root, 'b.mp4'))
    const again = await env.ok<Session>('session:rescan', { sessionId: session.id })
    expect(again.id).toBe(session.id)
    expect(again.items).toHaveLength(2)
  })

  it('fails with NOT_FOUND for a missing folder and never registers the root', async () => {
    env = await createEnv()
    const missing = path.join(env.base, 'nope')
    const r = await env.call('session:open', { dir: missing, kind: 'video' })
    expect(r).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(env.ctx.allowlist.roots()).toEqual([])
  })

  it('itemFor builds a fresh item inside the session and null outside or for other kinds', async () => {
    env = await createEnv()
    const root = path.join(env.base, 'in')
    const file = await touch(path.join(root, 'a.mp4'), '1234')
    await touch(path.join(root, 'b.txt'))
    const session = await open(root)
    const sessions = env.ctx.services.require('sessions')
    expect(await sessions.itemFor(session.id, file)).toMatchObject({ name: 'a.mp4', sizeBytes: 4 })
    expect(await sessions.itemFor(session.id, path.join(root, 'b.txt'))).toBeNull()
    expect(await sessions.itemFor(session.id, path.join(env.base, 'a.mp4'))).toBeNull()
    expect(sessions.get('zzz')).toBeUndefined()
  })
})
