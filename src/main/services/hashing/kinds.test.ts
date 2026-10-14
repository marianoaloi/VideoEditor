import { describe, expect, it } from 'vitest'
import { DEFAULT_VIDEO_EXTENSIONS } from '@shared/core/videoExtensions'
import { acceptsFile } from './kinds'

describe('acceptsFile (M12: one video extension list)', () => {
  it('accepts every extension of shared/core/videoExtensions, including .mpa .m2v .mpv .movie', () => {
    for (const ext of DEFAULT_VIDEO_EXTENSIONS) expect(acceptsFile('video', `clip${ext.toUpperCase()}`)).toBe(true)
    for (const name of ['a.mpa', 'a.m2v', 'a.mpv', 'a.movie']) expect(acceptsFile('video', name)).toBe(true)
  })

  it('matches the file name extension only and keeps image and gif kinds apart', () => {
    expect(acceptsFile('video', 'dir.mp4/readme.txt')).toBe(false)
    expect(acceptsFile('image', 'a.JPG')).toBe(true)
    expect(acceptsFile('gif', 'a.gif')).toBe(true)
    expect(acceptsFile('gif', 'a.png')).toBe(false)
  })
})
