import { mkdir, rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Session } from '@shared/domain/session'
import { approveFolder, createEnv, makeBase, touch, type TestEnv } from '../fileops/testSupport'
import { resolveAllowedPath } from '../media/access'
import { approveDroppedPath } from '../../ipc/dropApproval'

let env: TestEnv
const extra: string[] = []
afterEach(async () => {
  await rm(env.base, { recursive: true, force: true })
  for (const dir of extra.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('session:open needs an approved folder (review H2)', () => {
  it('refuses a renderer-named folder that nobody approved, and grants nothing', async () => {
    env = await createEnv(undefined, { approveBase: false })
    const dir = path.join(env.base, 'in')
    await touch(path.join(dir, 'a.mp4'))
    const res = await env.call('session:open', { dir, kind: 'video' })
    expect(res).toMatchObject({ ok: false, error: { code: 'PATH_NOT_ALLOWED' } })
    expect(env.ctx.allowlist.roots()).toEqual([])
  })

  it('opens after a dialog-style approval, and a sub-folder of an approved root', async () => {
    env = await createEnv(undefined, { approveBase: false })
    const dir = path.join(env.base, 'in')
    await touch(path.join(dir, 'sub', 'a.mp4'))
    approveFolder(env.ctx, dir)
    const session = await env.ok<Session>('session:open', { dir: path.join(dir, 'sub'), kind: 'video' })
    expect(session.items).toHaveLength(1)
  })

  it('refuses UNC and device roots, relative paths and a ".." escape from an approved root', async () => {
    env = await createEnv()
    const inside = path.join(env.base, 'in')
    await mkdir(inside, { recursive: true })
    const outside = await makeBase('outside')
    extra.push(outside)
    for (const dir of ['\\\\server\\share', '\\\\?\\C:\\Users', path.join(inside, '..', '..', path.basename(outside))]) {
      const res = await env.call('session:open', { dir, kind: 'video' })
      expect(res).toMatchObject({ ok: false, error: { code: expect.stringMatching(/PATH_NOT_ALLOWED|VALIDATION/) } })
    }
  })

  it('refuses a junction inside an approved root that points to an unapproved folder', async () => {
    env = await createEnv()
    const outside = await makeBase('outside')
    extra.push(outside)
    await touch(path.join(outside, 'secret.mp4'))
    await symlink(outside, path.join(env.base, 'link'), 'junction')
    const res = await env.call('session:open', { dir: path.join(env.base, 'link'), kind: 'video' })
    expect(res).toMatchObject({ ok: false, error: { code: 'PATH_NOT_ALLOWED' } })
  })

  it('a junction session root still serves its files (M2) and releases both grants on close', async () => {
    env = await createEnv(undefined, { approveBase: false })
    const real = path.join(env.base, 'real')
    const file = await touch(path.join(real, 'a.mp4'))
    const link = path.join(env.base, 'link')
    await symlink(real, link, 'junction')
    approveFolder(env.ctx, link)
    const session = await env.ok<Session>('session:open', { dir: link, kind: 'video' })
    const viaLink = path.join(link, 'a.mp4')
    await expect(resolveAllowedPath(env.ctx.allowlist, viaLink)).resolves.toEqual(expect.stringContaining('a.mp4'))
    expect(env.ctx.allowlist.isAllowed(file)).toBe(true)
    await env.ok('session:close', { sessionId: session.id })
    expect(env.ctx.allowlist.roots()).toEqual([])
  })
})

describe('dropped items are approved by main (preload message)', () => {
  it('approves a dropped folder, and the folder of a dropped file', async () => {
    env = await createEnv(undefined, { approveBase: false })
    const folder = path.join(env.base, 'dropped')
    const file = await touch(path.join(env.base, 'single', 'v.mp4'))
    await mkdir(folder, { recursive: true })
    await approveDroppedPath(env.ctx, folder)
    await approveDroppedPath(env.ctx, file)
    expect(env.ctx.approvals.isAllowed(path.join(folder, 'x.mp4'))).toBe(true)
    expect(env.ctx.approvals.isAllowed(path.join(env.base, 'single', 'other.mp4'))).toBe(true)
    expect(env.ctx.approvals.isAllowed(path.join(env.base, 'unrelated.mp4'))).toBe(false)
  })

  it('ignores UNC paths and missing paths', async () => {
    env = await createEnv(undefined, { approveBase: false })
    await approveDroppedPath(env.ctx, '\\\\server\\share\\x')
    await approveDroppedPath(env.ctx, path.join(env.base, 'missing'))
    expect(env.ctx.approvals.roots()).toEqual([])
  })
})
