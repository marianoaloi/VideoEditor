import { describe, expect, it } from 'vitest'
import { createMediaAllowlist } from './mediaAllowlist'

describe('media allowlist (win32)', () => {
  it('allows files under a root, case-insensitively, and nothing else', () => {
    const list = createMediaAllowlist('win32')
    list.addRoot('C:\\Videos\\Set')
    expect(list.isAllowed('C:\\Videos\\Set\\a.mp4')).toBe(true)
    expect(list.isAllowed('c:/videos/set/sub/b.mp4')).toBe(true)
    expect(list.isAllowed('C:\\Videos\\SetOther\\a.mp4')).toBe(false)
    expect(list.isAllowed('C:\\Videos\\Set')).toBe(false)
    expect(list.isAllowed('D:\\Videos\\Set\\a.mp4')).toBe(false)
  })
  it('does not let ".." escape a root', () => {
    const list = createMediaAllowlist('win32')
    list.addRoot('C:\\Videos\\Set')
    expect(list.isAllowed('C:\\Videos\\Set\\..\\Secret\\x.mp4')).toBe(false)
    expect(list.isAllowed('C:\\Videos\\Set\\sub\\..\\a.mp4')).toBe(true)
  })
  it('reference-counts roots and files', () => {
    const list = createMediaAllowlist('win32')
    list.addRoot('C:\\r')
    list.addRoot('C:\\r\\')
    list.removeRoot('C:\\r')
    expect(list.isAllowed('C:\\r\\a.png')).toBe(true)
    list.removeRoot('C:\\r')
    expect(list.isAllowed('C:\\r\\a.png')).toBe(false)
    list.addFile('C:\\tmp\\frame.png')
    expect(list.isAllowed('C:\\tmp\\frame.png')).toBe(true)
    expect(list.isAllowed('C:\\tmp\\other.png')).toBe(false)
    list.removeFile('C:\\tmp\\frame.png')
    expect(list.isAllowed('C:\\tmp\\frame.png')).toBe(false)
  })
  it('rejects relative paths and NUL bytes', () => {
    const list = createMediaAllowlist('win32')
    list.addRoot('C:\\r')
    expect(list.isAllowed('a.mp4')).toBe(false)
    expect(list.isAllowed('C:\\r\\a\0.mp4')).toBe(false)
  })
})

describe('media allowlist (posix)', () => {
  it('is case-sensitive', () => {
    const list = createMediaAllowlist('linux')
    list.addRoot('/data/Set')
    expect(list.isAllowed('/data/Set/a.mp4')).toBe(true)
    expect(list.isAllowed('/data/set/a.mp4')).toBe(false)
    expect(list.isAllowed('/data/Set/../x.mp4')).toBe(false)
  })
})
