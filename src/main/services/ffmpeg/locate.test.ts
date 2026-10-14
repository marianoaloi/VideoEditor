import { afterEach, describe, expect, it } from 'vitest'
import { clearToolCache, findOnPath, locateTool, locateTools, requireTool } from './locate'

afterEach(() => clearToolCache())

const winFiles = new Set([
  'C:\\bin\\ffmpeg.exe',
  'C:\\other\\ffmpeg.cmd',
  'C:\\tools\\ffmpeg.exe',
  'C:\\tools\\ffprobe.exe'
])
// Windows file systems are case-insensitive, and PATHEXT is upper case.
const winLower = new Set([...winFiles].map((f) => f.toLowerCase()))
const winIsFile = (p: string): boolean => winLower.has(p.toLowerCase())
const winEnv = { Path: 'C:\\nothing;"C:\\other";C:\\bin', PATHEXT: '.COM;.EXE;.BAT;.CMD' }

describe('findOnPath', () => {
  it('walks PATH with PATHEXT, case-insensitive env key, skipping .cmd/.bat shims', () => {
    expect(findOnPath('ffmpeg', { env: winEnv, platform: 'win32', isFile: winIsFile })).toBe(
      'C:\\bin\\ffmpeg.exe'
    )
  })
  it('finds POSIX binaries without extensions', () => {
    const r = findOnPath('ffprobe', {
      env: { PATH: '/usr/local/bin:/usr/bin' },
      platform: 'linux',
      isFile: (p) => p === '/usr/bin/ffprobe'
    })
    expect(r).toBe('/usr/bin/ffprobe')
  })
  it('returns null when absent', () => {
    expect(
      findOnPath('ffmpeg', { env: { PATH: '/x' }, platform: 'linux', isFile: () => false })
    ).toBeNull()
  })
})

describe('locateTool', () => {
  it('prefers the configured path', () => {
    const r = locateTool('ffmpeg', {
      configuredPath: 'C:\\tools\\ffmpeg.exe',
      env: winEnv,
      platform: 'win32',
      isFile: winIsFile
    })
    expect(r).toEqual({ name: 'ffmpeg', path: 'C:\\tools\\ffmpeg.exe', source: 'settings' })
  })
  it('falls back to PATH with a warning when the configured file is missing', () => {
    const r = locateTool('ffmpeg', {
      configuredPath: 'C:\\gone\\ffmpeg.exe',
      env: winEnv,
      platform: 'win32',
      isFile: winIsFile
    })
    expect(r?.source).toBe('path')
    expect(r?.warning).toContain('C:\\gone\\ffmpeg.exe')
  })
  it('caches until cleared', () => {
    let calls = 0
    const isFile = (p: string): boolean => {
      calls += 1
      return p === '/b/ffmpeg'
    }
    const opts = { env: { PATH: '/b' }, platform: 'linux' as const, isFile }
    expect(locateTool('ffmpeg', opts)?.path).toBe('/b/ffmpeg')
    const first = calls
    locateTool('ffmpeg', opts)
    expect(calls).toBe(first)
    clearToolCache()
    locateTool('ffmpeg', opts)
    expect(calls).toBeGreaterThan(first)
  })
})

describe('locateTools / requireTool', () => {
  it('finds ffprobe next to a configured ffmpeg', () => {
    const t = locateTools(
      { ffmpegPath: 'C:\\tools\\ffmpeg.exe', ffprobePath: null },
      { env: { Path: 'C:\\nothing' }, platform: 'win32', isFile: winIsFile }
    )
    expect(t.ffprobe).toEqual({
      name: 'ffprobe',
      path: 'C:\\tools\\ffprobe.exe',
      source: 'sibling'
    })
  })
  it('throws FFMPEG_NOT_FOUND', () => {
    expect(() =>
      requireTool(
        'ffmpeg',
        { ffmpegPath: null, ffprobePath: null },
        {
          env: { PATH: '' },
          platform: 'linux',
          isFile: () => false
        }
      )
    ).toThrow(/ffmpeg was not found/)
  })
})
