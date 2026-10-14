import { describe, expect, it } from 'vitest'
import { planTranscodeSeek, toElementSec, toOriginalMs } from './timeline'

describe('transcode timeline mapping', () => {
  it('maps element time to the original timeline', () => {
    expect(toOriginalMs(0, 12.345)).toBe(12345)
    expect(toOriginalMs(90_000, 2.5)).toBe(92_500)
    expect(toOriginalMs(5000, Number.NaN)).toBe(5000)
    expect(toOriginalMs(5000, -1)).toBe(5000)
  })
  it('maps back for direct seeks', () => {
    expect(toElementSec(0, 12_345)).toBe(12.345)
    expect(toElementSec(90_000, 92_500)).toBe(2.5)
    expect(toElementSec(90_000, 1000)).toBe(0)
  })
  it('seeks inside the buffered part of the stream, else restarts it', () => {
    expect(planTranscodeSeek(60_000, 65_000, 10)).toEqual({ kind: 'in-stream', currentTimeSec: 5 })
    expect(planTranscodeSeek(60_000, 80_000, 10)).toEqual({ kind: 'restart', offsetMs: 80_000 })
    expect(planTranscodeSeek(60_000, 30_000, 10)).toEqual({ kind: 'restart', offsetMs: 30_000 })
  })
})
