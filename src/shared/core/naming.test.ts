import { describe, expect, it } from 'vitest'
import {
  collisionName,
  limitName,
  prefixedName,
  recursivePrefix,
  resolveDestination
} from './naming'

const never = (): boolean => false

describe('recursivePrefix', () => {
  it('joins the sub-folders without separators', () => {
    expect(recursivePrefix('C:\\r', 'C:\\r\\a\\b\\x.mp4')).toBe('ab')
    expect(recursivePrefix('/r', '/r/a b/c/x.mp4')).toBe('a bc')
  })
  it('is empty for files in the root and null outside it', () => {
    expect(recursivePrefix('C:\\r', 'C:\\r\\x.mp4')).toBe('')
    expect(recursivePrefix('C:\\r', 'C:\\other\\x.mp4')).toBeNull()
    expect(recursivePrefix('/r', '/rr/x.mp4')).toBeNull()
  })
  it('ignores drive-letter case on Windows paths', () => {
    expect(recursivePrefix('c:\\R', 'C:\\r\\sub\\x.mp4')).toBe('sub')
  })
})

describe('names', () => {
  it('adds "_" only for a non-empty prefix and keeps spaces', () => {
    expect(prefixedName('a b.mp4', 'sub')).toBe('sub_a b.mp4')
    expect(prefixedName('a b.mp4', '')).toBe('a b.mp4')
  })
  it('puts the collision suffix before the extension', () => {
    expect(collisionName('clip.final.mp4', 2)).toBe('clip.final (2).mp4')
    expect(collisionName('noext', 1)).toBe('noext (1)')
    expect(collisionName('clip.mp4', 0)).toBe('clip.mp4')
  })
})

describe('limitName', () => {
  it('keeps short names and trims the start of long ones', () => {
    expect(limitName('a.mp4', 'C:\\r\\L')).toBe('a.mp4')
    const dir = 'C:\\r\\L'
    const out = limitName(`${'x'.repeat(400)}END.mp4`, dir)
    expect(out).not.toBeNull()
    expect(out?.endsWith('END.mp4')).toBe(true)
    expect((out?.length ?? 0) + dir.length + 1).toBeLessThanOrEqual(254)
  })
  it('bounds the name at 255 when the folder is short', () => {
    const out = limitName(`${'y'.repeat(300)}.mp4`, '/r/L')
    expect(out?.length).toBeLessThanOrEqual(250)
    expect(out?.endsWith('.mp4')).toBe(true)
  })
  it('refuses when nothing usable fits', () => {
    expect(limitName('a.mp4', `C:\\${'d'.repeat(250)}`)).toBeNull()
  })
})

describe('resolveDestination', () => {
  it('moves into root/folder with the plain name', () => {
    const r = resolveDestination({
      root: 'C:\\r',
      folder: 'L',
      sourcePath: 'C:\\r\\x.mp4',
      recursive: false,
      exists: never
    })
    expect(r).toEqual({
      ok: true,
      value: { name: 'x.mp4', dir: 'C:\\r\\L', path: 'C:\\r\\L\\x.mp4', collisions: 0 }
    })
  })
  it('prefixes recursive moves and uses POSIX separators for POSIX roots', () => {
    const r = resolveDestination({
      root: '/r/',
      folder: 'R',
      sourcePath: '/r/a/b/x.mp4',
      recursive: true,
      exists: never
    })
    expect(r.ok && r.value.path).toBe('/r/R/ab_x.mp4')
  })
  it('never overwrites: finds the first free (n)', () => {
    const taken = new Set(['C:\\r\\L\\x.mp4', 'C:\\r\\L\\x (1).mp4'])
    const r = resolveDestination({
      root: 'C:\\r',
      folder: 'L',
      sourcePath: 'C:\\r\\x.mp4',
      recursive: false,
      exists: (p) => taken.has(p)
    })
    expect(r.ok && r.value.name).toBe('x (2).mp4')
    expect(r.ok && r.value.collisions).toBe(2)
  })
  it('keeps the suffix and the extension when the name is long', () => {
    const long = `${'z'.repeat(300)}.mp4`
    const first = resolveDestination({
      root: 'C:\\r',
      folder: 'L',
      sourcePath: `C:\\r\\${long}`,
      recursive: false,
      exists: never
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = resolveDestination({
      root: 'C:\\r',
      folder: 'L',
      sourcePath: `C:\\r\\${long}`,
      recursive: false,
      exists: (p) => p === first.value.path
    })
    expect(second.ok && second.value.name.endsWith(' (1).mp4')).toBe(true)
    expect(second.ok && second.value.path.length).toBeLessThanOrEqual(254)
  })
  it('reports files outside the root of a recursive session', () => {
    const r = resolveDestination({
      root: 'C:\\r',
      folder: 'L',
      sourcePath: 'D:\\x\\y.mp4',
      recursive: true,
      exists: never
    })
    expect(r).toEqual({ ok: false, error: 'OUTSIDE_ROOT' })
  })
})
