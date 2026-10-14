import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMediaAllowlist } from './mediaAllowlist'
import { createPathApprovals } from './pathApprovals'
import {
  assertRealInside,
  isForbiddenPathSyntax,
  realpathNearest,
  resolveGuardedPath,
  resolveGuardedPaths
} from './pathGuard'

let base: string
beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'pathguard-'))
})
afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

const guardFor = (...approved: string[]) => {
  const approvals = createMediaAllowlist()
  for (const dir of approved) approvals.addRoot(dir)
  return { allowlist: createMediaAllowlist(), approvals }
}

describe('isForbiddenPathSyntax (H2)', () => {
  it.each([
    '\\\\server\\share\\a.mp4',
    '//server/share/a.mp4',
    '\\\\?\\C:\\a.mp4',
    '\\\\.\\pipe\\x',
    '',
    'relative/a.mp4',
    '..\\a.mp4',
    'C:\\a\0.mp4'
  ])('refuses %j', (value) => {
    expect(isForbiddenPathSyntax(value)).toBe(true)
  })

  it('accepts an absolute local path', () => {
    expect(isForbiddenPathSyntax(path.join(base, 'a.mp4'))).toBe(false)
  })
})

describe('resolveGuardedPath', () => {
  it('refuses paths outside every approved root, including ".." escapes', async () => {
    const root = path.join(base, 'approved')
    await mkdir(root)
    const guard = guardFor(root)
    await expect(resolveGuardedPath(guard, path.join(base, 'other', 'a.mp4'))).rejects.toMatchObject({
      code: 'PATH_NOT_ALLOWED'
    })
    await expect(resolveGuardedPath(guard, path.join(root, '..', 'other', 'a.mp4'))).rejects.toMatchObject({
      code: 'PATH_NOT_ALLOWED'
    })
    await expect(resolveGuardedPath(guard, path.join(root, 'sub', 'a.mp4'))).resolves.toBe(
      path.join(root, 'sub', 'a.mp4')
    )
  })

  it('refuses UNC and device paths even when a root "contains" them lexically', async () => {
    const guard = guardFor(base)
    for (const unc of ['\\\\server\\share\\a.mp4', '\\\\?\\' + path.join(base, 'a.mp4'), '//host/x/a.mp4']) {
      await expect(resolveGuardedPath(guard, unc)).rejects.toMatchObject({ code: 'PATH_NOT_ALLOWED' })
    }
  })

  it('refuses a junction inside the root that leads outside (M3)', async () => {
    const root = path.join(base, 'approved')
    const secret = path.join(base, 'secret')
    await mkdir(root)
    await mkdir(secret)
    await writeFile(path.join(secret, 'key.txt'), 'x')
    await symlink(secret, path.join(root, 'link'), 'junction')
    const guard = guardFor(root)
    await expect(resolveGuardedPath(guard, path.join(root, 'link', 'key.txt'))).rejects.toMatchObject({
      code: 'PATH_NOT_ALLOWED'
    })
    // A not-yet-existing file below the junction is judged by its nearest existing ancestor.
    await expect(resolveGuardedPath(guard, path.join(root, 'link', 'new', 'out.mp4'))).rejects.toMatchObject({
      code: 'PATH_NOT_ALLOWED'
    })
  })

  it('accepts an approved root that is itself a junction (real and lexical forms)', async () => {
    const real = path.join(base, 'real')
    const link = path.join(base, 'link')
    await mkdir(real)
    await writeFile(path.join(real, 'a.mp4'), 'x')
    await symlink(real, link, 'junction')
    const guard = guardFor(link)
    await expect(resolveGuardedPath(guard, path.join(link, 'a.mp4'))).resolves.toBe(path.join(link, 'a.mp4'))
  })

  it('accepts files granted exactly and open session roots (allowlist)', async () => {
    const file = path.join(base, 'one.mp4')
    await writeFile(file, 'x')
    const guard = { allowlist: createMediaAllowlist(), approvals: createMediaAllowlist() }
    await expect(resolveGuardedPath(guard, file)).rejects.toMatchObject({ code: 'PATH_NOT_ALLOWED' })
    guard.approvals.addFile(file)
    await expect(resolveGuardedPath(guard, file)).resolves.toBe(file)
    guard.allowlist.addRoot(base)
    await expect(resolveGuardedPath(guard, path.join(base, 'two.mp4'))).resolves.toBe(path.join(base, 'two.mp4'))
  })

  it('resolveGuardedPaths fails on the first offender', async () => {
    const guard = guardFor(base)
    await expect(
      resolveGuardedPaths(guard, [path.join(base, 'a.mp4'), path.join(tmpdir(), 'zzz-outside.mp4')])
    ).rejects.toMatchObject({ code: 'PATH_NOT_ALLOWED' })
  })
})

describe('realpathNearest / assertRealInside', () => {
  it('appends the missing tail to the nearest existing ancestor', async () => {
    const real = await realpathNearest(base)
    expect(await realpathNearest(path.join(base, 'a', 'b', 'c.txt'))).toBe(path.join(real, 'a', 'b', 'c.txt'))
  })

  it('compares real paths', async () => {
    const root = path.join(base, 'root')
    const outside = path.join(base, 'outside')
    await mkdir(root)
    await mkdir(outside)
    await symlink(outside, path.join(root, 'j'), 'junction')
    await expect(assertRealInside(root, path.join(root, 'fine.txt'))).resolves.toBeUndefined()
    await expect(assertRealInside(root, path.join(root, 'j', 'x.txt'))).rejects.toMatchObject({
      code: 'PATH_NOT_ALLOWED'
    })
  })
})

describe('createPathApprovals persistence (H2 c)', () => {
  it('reloads roots approved in an earlier run and ignores UNC or garbage', async () => {
    const file = path.join(base, 'approved-roots.json')
    const dir = path.join(base, 'media')
    const first = createPathApprovals(file)
    first.addRoot(dir)
    first.addRoot('\\\\server\\share')
    await new Promise((resolve) => setTimeout(resolve, 200))
    const second = createPathApprovals(file)
    expect(second.isAllowed(path.join(dir, 'x.mp4'))).toBe(true)
    expect(second.roots()).toHaveLength(1)
    await writeFile(file, '{not json')
    expect(createPathApprovals(file).roots()).toEqual([])
  })
})
