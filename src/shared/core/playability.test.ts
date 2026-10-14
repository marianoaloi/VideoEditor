import { describe, expect, it } from 'vitest'
import type { MediaInfo } from '../domain/media'
import { checkPlayback, isDirectlyPlayable } from './playability'

function info(partial: Partial<MediaInfo>): MediaInfo {
  return {
    path: 'C:\\v\\a.mp4',
    container: 'mov,mp4,m4a,3gp,3g2,mj2',
    formatLongName: null,
    durationMs: 1000,
    sizeBytes: 1000,
    bitrateKbps: 500,
    hasVideo: true,
    width: 640,
    height: 360,
    displayWidth: 640,
    displayHeight: 360,
    rotation: 0,
    fps: 25,
    videoCodec: 'h264',
    pixFmt: 'yuv420p',
    hasAudio: true,
    audioCodec: 'aac',
    audioChannels: 2,
    streamCount: 2,
    ...partial
  }
}

describe('checkPlayback', () => {
  it('plays H.264/AAC in MP4 and VP9/Opus in WebM directly', () => {
    expect(isDirectlyPlayable(info({}))).toBe(true)
    expect(
      isDirectlyPlayable(
        info({ container: 'matroska,webm', videoCodec: 'vp9', audioCodec: 'opus' })
      )
    ).toBe(true)
    expect(isDirectlyPlayable(info({ hasAudio: false, audioCodec: null }))).toBe(true)
  })

  it('falls back for AVI, WMV, FLV and 3GP', () => {
    expect(
      checkPlayback(info({ container: 'avi', videoCodec: 'mpeg4', audioCodec: 'mp3' }))
    ).toEqual({
      direct: false,
      reason: 'container "avi"'
    })
    expect(
      isDirectlyPlayable(info({ container: 'asf', videoCodec: 'wmv3', audioCodec: 'wmav2' }))
    ).toBe(false)
    expect(isDirectlyPlayable(info({ container: 'flv', videoCodec: 'h264' }))).toBe(false)
    expect(isDirectlyPlayable(info({ videoCodec: 'h263', audioCodec: 'amr_nb' }))).toBe(false)
  })

  it('falls back for unsupported codecs, pixel formats and missing video', () => {
    expect(checkPlayback(info({ videoCodec: 'hevc' })).direct).toBe(false)
    expect(checkPlayback(info({ audioCodec: 'ac3' }))).toEqual({
      direct: false,
      reason: 'audio codec "ac3"'
    })
    expect(checkPlayback(info({ pixFmt: 'yuv444p10le' })).direct).toBe(false)
    expect(checkPlayback(info({ hasVideo: false, videoCodec: null })).direct).toBe(false)
  })

  it('accepts H.264 in Matroska but not MPEG-4 part 2', () => {
    expect(
      isDirectlyPlayable(
        info({ container: 'matroska,webm', videoCodec: 'h264', audioCodec: 'aac' })
      )
    ).toBe(true)
    expect(isDirectlyPlayable(info({ container: 'matroska,webm', videoCodec: 'mpeg4' }))).toBe(
      false
    )
  })
})
