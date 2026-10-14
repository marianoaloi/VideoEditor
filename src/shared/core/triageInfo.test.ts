import { describe, expect, it } from 'vitest'
import type { MediaInfo } from '../domain/media'
import { DEFAULT_SETTINGS } from '../domain/settings'
import {
  buildInfoFields,
  estimateFactors,
  estimateSelectionBytes,
  optimisedTimeSec,
  parseSizeText,
  selectionSummary,
  TRIAGE_INFO_FIELD_IDS,
  type InfoInput,
  type InfoOverrides,
  type TriageInfoField
} from './triageInfo'

const T = DEFAULT_SETTINGS.thresholds
const MiB = 1024 * 1024
const NO_OVERRIDES: InfoOverrides = { size: null, rate: null, avgrate: null, crop: null }

function media(over: Partial<MediaInfo>): MediaInfo {
  return {
    path: '/v/a.mp4',
    container: 'mov,mp4,m4a,3gp,3g2,mj2',
    formatLongName: null,
    durationMs: 60_000,
    sizeBytes: 1,
    bitrateKbps: 400,
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
    ...over
  }
}

function input(info: MediaInfo, fileSizeBytes: number, overrides = NO_OVERRIDES): InfoInput {
  return { info, fileSizeBytes, thresholds: T, overrides }
}

const byId = (fields: TriageInfoField[], id: string): TriageInfoField => {
  const found = fields.find((f) => f.id === id)
  if (found === undefined) throw new Error(`field ${id} missing`)
  return found
}

const A1 = input(
  media({
    width: 1920,
    height: 1080,
    displayWidth: 1920,
    displayHeight: 1080,
    bitrateKbps: 2500,
    durationMs: 600_000,
    fps: 30
  }),
  314_572_800
)

describe('TV-A1 1920x1080, 2500 kbit/s, 600 s, 300 MiB, 30 fps (checklist 27, 28)', () => {
  const fields = buildInfoFields(A1)

  it('formats and colours every field', () => {
    expect(byId(fields, 'fileSize')).toMatchObject({ text: '300.00M', color: 'red' })
    expect(byId(fields, 'durationTime')).toMatchObject({ text: '00:10:00', color: 'yellow' })
    expect(byId(fields, 'otimizedTime').text).toBe('00:04:20')
    expect(byId(fields, 'avgrate')).toMatchObject({ text: '30', color: 'green', editable: true })
    expect(byId(fields, 'size')).toMatchObject({ text: '1920x1080', color: 'red' })
    expect(byId(fields, 'crop').text).toBe('0|0|1920|1080')
    expect(byId(fields, 'rateVideo')).toMatchObject({ text: '2500', color: 'red' })
    expect(byId(fields, 'otimizedSize').text).toBe('13.33M')
    expect(byId(fields, 'audio')).toMatchObject({ text: 'aac', color: 'green' })
  })

  it('keeps the fixed field order and skips rotation 0', () => {
    const ids = fields.map((f) => f.id)
    expect(ids).toEqual(TRIAGE_INFO_FIELD_IDS.filter((id) => id !== 'rotate'))
  })

  it('has the legacy factors', () => {
    const f = estimateFactors(A1)
    expect(f).toMatchObject({ sizeBytes: 314_572_800, durationSec: 600 })
    expect(f?.pixelsFactor).toBeCloseTo(0.1111111111111111, 15)
    expect(f?.rateFactor).toBeCloseTo(0.4, 15)
  })

  it.each([
    [120_000, '00:02:00', 'green', '2.67M'],
    [600_000, '00:10:00', 'yellow', '13.33M'],
    [1_680_000, '00:28:00', 'red', '37.33M'],
    [599_999, '00:09:59', 'green', '13.33M']
  ])('selection %i ms', (ms, text, color, estimate) => {
    expect(selectionSummary(ms, T, estimateFactors(A1))).toEqual({ text, color, estimate })
  })
})

describe('TV-A2/A3/A4', () => {
  it('A2 640x360, 400 kbit/s: factors are 1', () => {
    const a2 = input(media({ durationMs: 90_000, fps: 25 }), 5_242_880)
    const fields = buildInfoFields(a2)
    expect(byId(fields, 'fileSize')).toMatchObject({ text: '5.00M', color: 'green' })
    expect(byId(fields, 'durationTime')).toMatchObject({ text: '00:01:30', color: 'green' })
    expect(byId(fields, 'otimizedTime').text).toBe('00:39:00')
    expect(byId(fields, 'avgrate')).toMatchObject({ text: '25', color: 'yellow' })
    expect(byId(fields, 'size')).toMatchObject({ text: '640x360', color: 'yellow' })
    expect(byId(fields, 'rateVideo')).toMatchObject({ text: '400', color: 'green' })
    expect(byId(fields, 'otimizedSize').text).toBe('5.00M')
  })

  it('A3 keeps the "* 2" quirk (600 kbit/s -> 1.667)', () => {
    const a3 = input(
      media({
        width: 1280,
        height: 720,
        displayWidth: 1280,
        displayHeight: 720,
        bitrateKbps: 600,
        durationMs: 1_700_000,
        fps: 24000 / 1001
      }),
      104_857_600
    )
    const fields = buildInfoFields(a3)
    expect(byId(fields, 'fileSize')).toMatchObject({ text: '100.00M', color: 'yellow' })
    expect(byId(fields, 'durationTime')).toMatchObject({ text: '00:28:20', color: 'red' })
    expect(byId(fields, 'otimizedTime').text).toBe('00:36:50')
    expect(byId(fields, 'avgrate')).toMatchObject({ text: '23', color: 'yellow' })
    expect(byId(fields, 'size').color).toBe('red')
    expect(byId(fields, 'rateVideo')).toMatchObject({ text: '600', color: 'yellow' })
    const f = estimateFactors(a3)
    expect(f?.pixelsFactor).toBe(0.25)
    expect(f?.rateFactor).toBeCloseTo(1.6666666666666667, 15)
    expect(byId(fields, 'otimizedSize').text).toBe('41.67M')
    expect(selectionSummary(60_000, T, f)).toEqual({
      text: '00:01:00',
      color: 'green',
      estimate: '1.47M'
    })
  })

  it('A4 3840x2160, 8000 kbit/s, 2 h, 1.5 GiB', () => {
    const a4 = input(
      media({
        width: 3840,
        height: 2160,
        displayWidth: 3840,
        displayHeight: 2160,
        bitrateKbps: 8000,
        durationMs: 7_200_000,
        fps: 60
      }),
      1_610_612_736
    )
    const fields = buildInfoFields(a4)
    expect(byId(fields, 'fileSize')).toMatchObject({ text: '1.50G', color: 'red' })
    expect(byId(fields, 'durationTime')).toMatchObject({ text: '02:00:00', color: 'red' })
    expect(byId(fields, 'otimizedTime').text).toBe('00:10:09')
    expect(byId(fields, 'avgrate')).toMatchObject({ text: '60', color: 'green' })
    const f = estimateFactors(a4)
    expect(f?.pixelsFactor).toBeCloseTo(0.027777777777777776, 15)
    expect(f?.rateFactor).toBe(0.125)
    expect(byId(fields, 'otimizedSize').text).toBe('5.33M')
  })
})

describe('TV-A boundaries', () => {
  const colorOf = (info: MediaInfo, size: number, id: string): string =>
    byId(buildInfoFields(input(info, size)), id).color

  it('file size 50 / 130 MiB (exclusive)', () => {
    const info = media({})
    expect(colorOf(info, 52_428_799, 'fileSize')).toBe('green')
    expect(colorOf(info, 52_428_800, 'fileSize')).toBe('yellow')
    expect(colorOf(info, 136_314_879, 'fileSize')).toBe('yellow')
    expect(colorOf(info, 136_314_880, 'fileSize')).toBe('red')
  })

  it('duration 599 / 600 / 1679 / 1680 s', () => {
    const at = (s: number): string => colorOf(media({ durationMs: s * 1000 }), MiB, 'durationTime')
    expect([at(599), at(600), at(1679), at(1680)]).toEqual(['green', 'yellow', 'yellow', 'red'])
  })

  it('avgrate 20 / 21 / 25 / 26', () => {
    const at = (fps: number): string => colorOf(media({ fps }), MiB, 'avgrate')
    expect([at(20), at(21), at(25), at(26)]).toEqual(['red', 'yellow', 'yellow', 'green'])
  })

  it('width 500 / 501 / 1000 / 1001', () => {
    const at = (w: number): string =>
      colorOf(media({ width: w, displayWidth: w }), MiB, 'size')
    expect([at(500), at(501), at(1000), at(1001)]).toEqual(['green', 'yellow', 'yellow', 'red'])
  })

  it('bitrate colours and factor 500 / 501 / 1000 / 1001', () => {
    const rate = (kbps: number): { color: string; factor: number } => {
      const i = input(media({ bitrateKbps: kbps }), MiB)
      return {
        color: byId(buildInfoFields(i), 'rateVideo').color,
        factor: estimateFactors(i)?.rateFactor ?? NaN
      }
    }
    expect(rate(500)).toEqual({ color: 'green', factor: 1 })
    expect(rate(501).color).toBe('yellow')
    expect(rate(501).factor).toBeCloseTo(1.996007984031936, 12)
    expect(rate(1000)).toEqual({ color: 'yellow', factor: 1 })
    expect(rate(1001).color).toBe('red')
    expect(rate(1001).factor).toBeCloseTo(0.999000999000999, 12)
  })

  it('selection colours use exclusive 600 000 / 1 680 000 ms and unbounded hours', () => {
    const color = (ms: number): string => selectionSummary(ms, T, null).color
    expect([color(599_999), color(600_000), color(1_679_999), color(1_680_000)]).toEqual([
      'green',
      'yellow',
      'yellow',
      'red'
    ])
    expect(selectionSummary(90_000_000, T, null).text).toBe('25:00:00')
    expect(selectionSummary(5000, T, null).estimate).toBeNull()
  })
})

describe('missing data and overrides (checklist 30, 31)', () => {
  it('no audio, no bitrate, no fps, rotation', () => {
    const info = media({ hasAudio: false, audioCodec: null, bitrateKbps: null, fps: null, rotation: -90 })
    const fields = buildInfoFields(input(info, MiB))
    expect(byId(fields, 'audio')).toMatchObject({ text: 'N_aud', color: 'red' })
    expect(byId(fields, 'rotate')).toMatchObject({ text: '-90', color: 'green' })
    expect(byId(fields, 'avgrate')).toMatchObject({ text: '25', color: 'none' })
    expect(byId(fields, 'rateVideo')).toMatchObject({ text: '500', color: 'none' })
  })

  it('crop default uses the displayed (rotated) frame size', () => {
    const info = media({ width: 1920, height: 1080, displayWidth: 1080, displayHeight: 1920, rotation: 90 })
    expect(byId(buildInfoFields(input(info, MiB)), 'crop').text).toBe('0|0|1080|1920')
  })

  it('overrides are shown as overrides and feed the estimates', () => {
    const overrides: InfoOverrides = {
      size: '640x360',
      rate: 800,
      avgrate: 30,
      crop: { x: 10, y: 20, w: 300, h: 200 }
    }
    const i = input(A1.info, A1.fileSizeBytes, overrides)
    const fields = buildInfoFields(i)
    expect(byId(fields, 'size')).toMatchObject({ text: '640x360', overridden: true, color: 'none' })
    expect(byId(fields, 'rateVideo')).toMatchObject({ text: '800', overridden: true })
    expect(byId(fields, 'avgrate')).toMatchObject({ text: '30', overridden: true })
    expect(byId(fields, 'crop')).toMatchObject({ text: '10|20|300|200', overridden: true })
    expect(estimateFactors(i)?.pixelsFactor).toBe(1)
    expect(estimateFactors(i)?.rateFactor).toBeCloseTo((500 / 800) * 2, 15)
  })

  it('an empty file or unknown duration has no derived values', () => {
    expect(optimisedTimeSec(600, 0, 1)).toBeNull()
    expect(estimateFactors(input(media({ durationMs: 0 }), MiB))).toBeNull()
    expect(estimateSelectionBytes(null, 1000)).toBeNull()
    const ids = buildInfoFields(input(media({ durationMs: 0 }), 0)).map((f) => f.id)
    expect(ids).not.toContain('durationTime')
    expect(ids).not.toContain('otimizedSize')
  })

  it('parses size text', () => {
    expect(parseSizeText('640x360')).toEqual({ width: 640, height: 360 })
    expect(parseSizeText('640:360')).toEqual({ width: 640, height: 360 })
    expect(parseSizeText('-1')).toBeNull()
  })
})
