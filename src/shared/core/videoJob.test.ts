/** Checklist 26 of `.swarm/research/ffmpeg-jobs.md` (job JSON formats) and §4.3 / B02. */
import { describe, expect, it } from 'vitest'
import {
  createVideoJob,
  jobJsonPathFor,
  parseAnyVideoJob,
  parseVideoJobText,
  serializeVideoJob
} from './videoJob'

const VIDEO = '/data/CUSTOM/a.mp4'
const ctx = { videoPath: VIDEO }

describe('parseAnyVideoJob', () => {
  it('reads the real legacy sample (current format, no version)', () => {
    const result = parseAnyVideoJob(
      {
        filename: 'CUSTOM/20250124_211732.mp4',
        originalPath: '/home/maloi/Videos/img/20250124_211732.mp4',
        crop: null,
        bright: null,
        contrast: null,
        transpose: null,
        mediaPath: null,
        convert: false,
        size: null,
        rate: null,
        avgrate: null,
        times: [
          [18054, 46182],
          [18054, 45735]
        ],
        posExecution: 1
      },
      ctx
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.format).toBe('legacy')
    expect(result.job.filename).toBe(VIDEO)
    expect(result.job.originalPath).toBe('/home/maloi/Videos/img/20250124_211732.mp4')
    expect(result.job.times).toEqual([
      [18054, 46182],
      [18054, 45735]
    ])
    expect(result.job.version).toBe(2)
  })

  it('converts the old format; both definedSize and definedRate present do not throw (B02)', () => {
    const result = parseAnyVideoJob(
      {
        definedSize: '854x480',
        definedRate: '700',
        times: [
          { st: 1000, du: 5000 },
          { st: 9000, du: 2000 }
        ],
        posExecution: 'f'
      },
      ctx
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.format).toBe('legacy-old')
    expect(result.job.size).toBe('854x480')
    expect(result.job.rate).toBe(700)
    expect(result.job.posExecution).toBe(2)
    // TimeDTO sorts every pair: [9000, 2000] becomes [2000, 9000]
    expect(result.job.times).toEqual([
      [1000, 5000],
      [2000, 9000]
    ])
  })

  it('old format with only definedRate or none of the legacy keys behaves', () => {
    const rate = parseAnyVideoJob({ definedRate: 600, times: [], posExecution: 'd' }, ctx)
    expect(rate.ok && rate.job.rate).toBe(600)
    expect(rate.ok && rate.job.posExecution).toBe(1)
    const bare = parseAnyVideoJob({ definedSize: null, times: [{ st: 0, du: 10 }] }, ctx)
    expect(bare.ok && bare.job.size).toBeNull()
  })

  it('keeps the whole-video marker and normalises WxH spellings', () => {
    const result = parseAnyVideoJob({ times: [[-1, 90500]], size: '640X360', rate: '500' }, ctx)
    expect(result.ok && result.job.times).toEqual([[-1, 90500]])
    expect(result.ok && result.job.size).toBe('640x360')
    expect(result.ok && result.job.rate).toBe(500)
  })

  it('accepts v2 and version 1, rejects unknown versions and non-objects', () => {
    const v2 = createVideoJob(VIDEO, { times: [[0, 1000]] })
    expect(parseAnyVideoJob(v2, ctx)).toMatchObject({ ok: true, format: 'v2' })
    expect(parseAnyVideoJob({ ...v2, version: 1 }, ctx)).toMatchObject({ ok: true })
    expect(parseAnyVideoJob({ ...v2, version: 3 }, ctx)).toMatchObject({ ok: false })
    expect(parseAnyVideoJob([1, 2], ctx)).toMatchObject({ ok: false })
  })

  it('drops bad ranges with a warning instead of failing', () => {
    const result = parseAnyVideoJob({ times: [[5, 5], ['x', 1], [10, 20]] }, ctx)
    expect(result.ok && result.job.times).toEqual([[10, 20]])
    expect(result.warnings.length).toBeGreaterThanOrEqual(2)
  })
})

describe('parseVideoJobText / serialize', () => {
  it('reports empty and invalid text', () => {
    expect(parseVideoJobText('', ctx)).toMatchObject({ ok: false })
    expect(parseVideoJobText('   \n', ctx)).toMatchObject({ ok: false })
    expect(parseVideoJobText('{nope', ctx)).toMatchObject({ ok: false })
  })

  it('round-trips and keeps the legacy key order with version last', () => {
    const job = createVideoJob(VIDEO, { times: [[1, 2]], posExecution: 2, rate: 700 })
    const text = serializeVideoJob(job)
    expect(Object.keys(JSON.parse(text) as object)).toEqual([
      'filename',
      'originalPath',
      'crop',
      'bright',
      'contrast',
      'transpose',
      'mediaPath',
      'convert',
      'size',
      'rate',
      'avgrate',
      'times',
      'posExecution',
      'version'
    ])
    const back = parseVideoJobText(text, ctx)
    expect(back.ok && back.job).toEqual(job)
    expect(jobJsonPathFor(VIDEO)).toBe(`${VIDEO}.json`)
  })
})
