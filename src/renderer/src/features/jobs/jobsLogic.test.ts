import { describe, expect, it } from 'vitest'
import type { MediaInfo } from '@shared/domain/media'
import {
  countJobs,
  formatCounter,
  infoColumns,
  joinPath,
  lastRunningLine,
  resolveRoot
} from './jobsLogic'

const INFO: MediaInfo = {
  path: 'C:\\v\\clip.mp4',
  container: 'mov,mp4',
  formatLongName: null,
  durationMs: 90_061_000,
  sizeBytes: 1536,
  bitrateKbps: 799.6,
  hasVideo: true,
  width: 1920,
  height: 1080,
  displayWidth: 1080,
  displayHeight: 1920,
  rotation: 90,
  fps: 29.97,
  videoCodec: 'h264',
  pixFmt: 'yuv420p',
  hasAudio: false,
  audioCodec: null,
  audioChannels: null,
  streamCount: 1
}

describe('Jobs counter (ffmpeg-jobs §10.5)', () => {
  it('shows [running] [queued]', () => {
    const counts = countJobs([
      { status: 'running' },
      { status: 'queued' },
      { status: 'queued' },
      { status: 'done' }
    ])
    expect(counts).toEqual({ running: 1, queued: 2 })
    expect(formatCounter(counts)).toBe('[1] [2]')
  })
})

describe('drop table columns (ffmpeg-jobs §11)', () => {
  it('formats the eight data columns with legacy truncation', () => {
    expect(infoColumns(INFO.path, INFO)).toEqual({
      name: 'clip.mp4',
      size: '1.50K',
      duration: '25:01:01',
      bitRate: '799 kbit/s',
      dimensions: '1080x1920',
      frameRate: '29',
      codec: 'h264',
      audio: 'N_aud'
    })
  })
  it('leaves cells blank for an unreadable file', () => {
    expect(infoColumns('/a/b/c.mkv', null)).toMatchObject({ name: 'c.mkv', size: '', duration: '' })
  })
})

describe('folders (ffmpeg-jobs §10.1)', () => {
  it('derives the root from the CUSTOM folder, else uses the folder itself', () => {
    expect(resolveRoot('D:\\media\\CUSTOM', 'CUSTOM')).toBe('D:\\media')
    expect(resolveRoot('/data/media/CUSTOM', 'CUSTOM')).toBe('/data/media')
    expect(resolveRoot('/data/other', 'CUSTOM')).toBe('/data/other')
  })
  it('joins with the separator of the base', () => {
    expect(joinPath('D:\\media\\', 'L')).toBe('D:\\media\\L')
    expect(joinPath('/data/media', 'L')).toBe('/data/media/L')
  })
  it('FF label shows the last non-empty line of the running job', () => {
    expect(
      lastRunningLine([
        { status: 'done', logTail: ['old'] },
        { status: 'running', logTail: ['a', 'frame=10', ' '] }
      ])
    ).toBe('frame=10')
  })
})
