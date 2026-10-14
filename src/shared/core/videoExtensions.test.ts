import { describe, expect, it } from 'vitest'
import { DEFAULT_VIDEO_EXTENSIONS, isVideoFileName, normaliseExtension } from './videoExtensions'

describe('videoExtensions (TV-I accept)', () => {
  it('accepts video names case-insensitively', () => {
    for (const name of ['a.MP4', 'a.mkv', 'x.3gp', '.clip.mp4', 'C:\r\a.MoV']) {
      expect(isVideoFileName(name), name).toBe(true)
    }
  })

  it('rejects non-video names and the legacy 3gp substring rule', () => {
    for (const name of ['a.jpg', 'a.json', 'a.txt', 'a.mp3', 'a.3gp.txt', 'noext', '.mp4']) {
      expect(isVideoFileName(name), name).toBe(false)
    }
  })

  it('honours a custom list with or without dots', () => {
    expect(isVideoFileName('a.xyz', ['xyz'])).toBe(true)
    expect(isVideoFileName('a.mp4', ['.xyz'])).toBe(false)
  })

  it('has unique, dotted, lower-case defaults', () => {
    expect(new Set(DEFAULT_VIDEO_EXTENSIONS).size).toBe(DEFAULT_VIDEO_EXTENSIONS.length)
    for (const ext of DEFAULT_VIDEO_EXTENSIONS) expect(ext).toBe(normaliseExtension(ext))
  })
})
