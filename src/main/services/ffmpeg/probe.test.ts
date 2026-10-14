import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppError } from '../../ipc/errors'
import {
  FfprobeOutputSchema,
  normaliseRotation,
  parseFrameRate,
  probeMedia,
  toMediaInfo
} from './probe'
import {
  findTestTools,
  generateAudio,
  generateImage,
  generateVideo,
  makeTempDir
} from './testFixtures'

describe('parseFrameRate / normaliseRotation', () => {
  it('parses fractions and rejects 0/0', () => {
    expect(parseFrameRate('25/1')).toBe(25)
    expect(parseFrameRate('30000/1001')).toBeCloseTo(29.97, 2)
    expect(parseFrameRate('0/0')).toBeNull()
    expect(parseFrameRate('1/0')).toBeNull()
    expect(parseFrameRate(undefined)).toBeNull()
  })
  it('normalises to (-180, 180]', () => {
    expect(normaliseRotation(270)).toBe(-90)
    expect(normaliseRotation(-90)).toBe(-90)
    expect(normaliseRotation(180)).toBe(180)
    expect(normaliseRotation(-180)).toBe(180)
    expect(normaliseRotation(360)).toBe(0)
    expect(normaliseRotation(450)).toBe(90)
  })
})

describe('toMediaInfo (pure)', () => {
  const parse = (raw: unknown) => FfprobeOutputSchema.parse(raw)

  it('maps a typical H.264 + AAC file', () => {
    const info = toMediaInfo(
      'C:\\v\\a.mp4',
      parse({
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 1280,
            height: 720,
            pix_fmt: 'yuv420p',
            avg_frame_rate: '30000/1001',
            bit_rate: '900000'
          },
          { codec_type: 'audio', codec_name: 'aac', channels: 2 }
        ],
        format: {
          format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
          duration: '12.3456',
          size: '1048576',
          bit_rate: '1234567'
        }
      })
    )
    expect(info).toMatchObject({
      container: 'mov,mp4,m4a,3gp,3g2,mj2',
      durationMs: 12345,
      sizeBytes: 1048576,
      bitrateKbps: 1234,
      hasVideo: true,
      width: 1280,
      height: 720,
      displayWidth: 1280,
      displayHeight: 720,
      rotation: 0,
      videoCodec: 'h264',
      pixFmt: 'yuv420p',
      hasAudio: true,
      audioCodec: 'aac',
      audioChannels: 2,
      streamCount: 2
    })
    expect(info.fps).toBeCloseTo(29.97, 2)
  })

  it('swaps the display size for ±90° rotation (side data)', () => {
    const info = toMediaInfo(
      'C:\\v\\r.mp4',
      parse({
        streams: [
          {
            codec_type: 'video',
            width: 1920,
            height: 1080,
            side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }]
          }
        ],
        format: { duration: '1' }
      })
    )
    expect(info.rotation).toBe(-90)
    expect([info.displayWidth, info.displayHeight]).toEqual([1080, 1920])
    expect([info.width, info.height]).toEqual([1920, 1080])
  })

  it('converts the old clockwise tags.rotate and falls back to the stream bitrate/duration', () => {
    const info = toMediaInfo(
      'C:\\v\\old.mp4',
      parse({
        streams: [
          {
            codec_type: 'video',
            width: 640,
            height: 360,
            duration: '2.5',
            bit_rate: '500000',
            tags: { rotate: '90' }
          }
        ],
        format: {}
      })
    )
    expect(info.rotation).toBe(-90)
    expect(info.durationMs).toBe(2500)
    expect(info.bitrateKbps).toBe(500)
  })

  it('ignores cover art and reports audio-only files', () => {
    const info = toMediaInfo(
      'C:\\v\\song.mp3',
      parse({
        streams: [
          { codec_type: 'audio', codec_name: 'mp3', channels: 2 },
          {
            codec_type: 'video',
            codec_name: 'mjpeg',
            width: 500,
            height: 500,
            disposition: { attached_pic: 1 }
          }
        ],
        format: { duration: '3' }
      })
    )
    expect(info.hasVideo).toBe(false)
    expect(info.width).toBe(0)
    expect(info.bitrateKbps).toBeNull()
    expect(info.hasAudio).toBe(true)
  })

  it('fails without streams', () => {
    expect(() => toMediaInfo('C:\\v\\x.bin', parse({ streams: [], format: {} }))).toThrow(AppError)
  })
})

const tools = findTestTools()

describe.skipIf(tools === null)('probeMedia (real ffprobe)', () => {
  let dir = ''
  beforeAll(async () => {
    dir = await makeTempDir('probe')
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const ffprobePath = (): string => tools?.ffprobe ?? ''

  it('probes a generated H.264/AAC clip', async () => {
    if (tools === null) return
    const file = await generateVideo(tools, dir, 'clip.mp4', {
      seconds: 3,
      width: 320,
      height: 240,
      fps: 25
    })
    const info = await probeMedia(file, { ffprobePath: ffprobePath() })
    expect(info.path).toBe(file)
    expect(info.hasVideo).toBe(true)
    expect([info.width, info.height]).toEqual([320, 240])
    expect(info.fps).toBeCloseTo(25, 1)
    expect(info.durationMs).toBeGreaterThan(2800)
    expect(info.durationMs).toBeLessThan(3300)
    expect(info.videoCodec).toBe('h264')
    expect(info.hasAudio).toBe(true)
    expect(info.audioCodec).toBe('aac')
    expect(info.rotation).toBe(0)
    expect(info.container).toContain('mp4')
    expect(info.bitrateKbps).toBeGreaterThan(0)
    expect(info.sizeBytes).toBeGreaterThan(1000)
  })

  it('reads rotation from the display matrix and swaps the display size', async () => {
    if (tools === null) return
    const file = await generateVideo(tools, dir, 'rot.mp4', {
      seconds: 1,
      width: 320,
      height: 240,
      rotate: 90
    })
    const info = await probeMedia(file, { ffprobePath: ffprobePath() })
    expect(Math.abs(info.rotation)).toBe(90)
    expect([info.width, info.height]).toEqual([320, 240])
    expect([info.displayWidth, info.displayHeight]).toEqual([240, 320])
  })

  it('probes a video without audio, an image and an audio-only file', async () => {
    if (tools === null) return
    const silent = await generateVideo(tools, dir, 'silent.mp4', { seconds: 1, audio: false })
    expect((await probeMedia(silent, { ffprobePath: ffprobePath() })).hasAudio).toBe(false)

    const image = await generateImage(tools, dir, 'pic.png', { width: 64, height: 48 })
    const imageInfo = await probeMedia(image, { ffprobePath: ffprobePath() })
    expect(imageInfo.hasVideo).toBe(true)
    expect([imageInfo.width, imageInfo.height]).toEqual([64, 48])

    const audio = await generateAudio(tools, dir, 'tone.wav')
    const audioInfo = await probeMedia(audio, { ffprobePath: ffprobePath() })
    expect(audioInfo.hasVideo).toBe(false)
    expect(audioInfo.hasAudio).toBe(true)
  })

  it('fails with PROBE_FAILED for a corrupt file and for a missing one', async () => {
    const bad = path.join(dir, 'garbage.mp4')
    await writeFile(bad, Buffer.from('this is not a media file at all'))
    await expect(probeMedia(bad, { ffprobePath: ffprobePath() })).rejects.toMatchObject({
      code: 'PROBE_FAILED'
    })
    await expect(
      probeMedia(path.join(dir, 'missing.mp4'), { ffprobePath: ffprobePath() })
    ).rejects.toMatchObject({ code: 'PROBE_FAILED' })
  })

  it('reports FFMPEG_NOT_FOUND for a bad ffprobe path and honours abort', async () => {
    await expect(
      probeMedia(path.join(dir, 'clip.mp4'), { ffprobePath: path.join(dir, 'no-ffprobe.exe') })
    ).rejects.toMatchObject({ code: 'FFMPEG_NOT_FOUND' })
    const ac = new AbortController()
    ac.abort()
    await expect(
      probeMedia(path.join(dir, 'clip.mp4'), { ffprobePath: ffprobePath(), signal: ac.signal })
    ).rejects.toMatchObject({ code: 'CANCELLED' })
  })
})
