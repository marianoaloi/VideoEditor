import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: vi.fn(async (from: string, to: string) => {
      if (String(from).includes('xdev')) {
        throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' })
      }
      return actual.rename(from, to)
    })
  }
})

const { createMutex, longPath, moveEntry, uniqueName } = await import('./fsutil')

let dir = ''
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

describe('moveEntry', () => {
  it('falls back to copy + unlink when rename crosses devices (ADR-006)', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'fsutil-'))
    const src = path.join(dir, 'xdev-a.mp4')
    await writeFile(src, 'payload')
    const dest = path.join(dir, 'sub', 'a.mp4')
    await moveEntry(src, dest)
    expect(await readFile(dest, 'utf8')).toBe('payload')
    await expect(readFile(src)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never overwrites in the copy fallback', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'fsutil-'))
    const src = path.join(dir, 'xdev-b.mp4')
    const dest = path.join(dir, 'b.mp4')
    await writeFile(src, 'new')
    await writeFile(dest, 'old')
    await expect(moveEntry(src, dest)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(dest, 'utf8')).toBe('old')
    expect(await readFile(src, 'utf8')).toBe('new')
  })
})

describe('uniqueName', () => {
  it('appends (n) until free and keeps the extension', () => {
    const taken = new Set([path.join('d', 'a.mp4'), path.join('d', 'a (1).mp4')])
    expect(uniqueName('d', 'a.mp4', (c) => taken.has(c)).name).toBe('a (2).mp4')
  })
})

describe('createMutex', () => {
  it('runs work one at a time in call order, even after a failure', async () => {
    const serial = createMutex()
    const order: string[] = []
    const slow = serial(async () => {
      await new Promise((r) => setTimeout(r, 30))
      order.push('slow')
      throw new Error('boom')
    })
    const fast = serial(async () => {
      order.push('fast')
    })
    await expect(slow).rejects.toThrow('boom')
    await fast
    expect(order).toEqual(['slow', 'fast'])
  })
})

describe('longPath', () => {
  it('leaves short paths alone and prefixes long ones on Windows only', () => {
    expect(longPath('C:\\short\\a.mp4')).toBe('C:\\short\\a.mp4')
    const long = `C:\\${'d'.repeat(250)}\\a.mp4`
    expect(longPath(long)).toBe(process.platform === 'win32' ? `\\\\?\\${long}` : long)
  })
})
