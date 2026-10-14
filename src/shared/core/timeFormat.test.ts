import { describe, expect, it } from 'vitest'
import { formatMillis, formatSize, hms, parseTimeInput } from './timeFormat'

describe('formatSize (legacy vectors)', () => {
  it.each([
    [0, '0.00B'],
    [1023, '1023.00B'],
    [1024, '1.00K'],
    [1152, '1.12K'],
    [1536, '1.50K'],
    [2621440, '2.50M'],
    [52428800, '50.00M'],
    [136314880, '130.00M'],
    [1048575, '1024.00K'],
    [1048576, '1.00M'],
    [1073741824, '1.00G'],
    [1099511627776, '1099511627776B']
  ])('%d → %s', (bytes, text) => {
    expect(formatSize(bytes)).toBe(text)
  })
  it('clamps negatives', () => {
    expect(formatSize(-5)).toBe('0.00B')
  })
})

describe('formatMillis / hms', () => {
  it('matches the cutter vectors and does not wrap hours', () => {
    expect(formatMillis(0)).toBe('00:00:00')
    expect(formatMillis(59999)).toBe('00:00:59')
    expect(formatMillis(3723000)).toBe('01:02:03')
    expect(formatMillis(86400000)).toBe('24:00:00')
    expect(formatMillis(90061000)).toBe('25:01:01')
    expect(hms(3725)).toBe('01:02:05')
  })
  it('optionally prints milliseconds', () => {
    expect(formatMillis(3723456, { millis: true })).toBe('01:02:03.456')
    expect(formatMillis(-1)).toBe('00:00:00')
    expect(formatMillis(Number.NaN)).toBe('00:00:00')
  })
})

describe('parseTimeInput', () => {
  it('parses clock and plain-second forms', () => {
    expect(parseTimeInput('01:02:03')).toBe(3723000)
    expect(parseTimeInput('02:03.5')).toBe(123500)
    expect(parseTimeInput('90')).toBe(90000)
    expect(parseTimeInput(' 1.5 ')).toBe(1500)
  })
  it('rejects garbage', () => {
    expect(parseTimeInput('')).toBeNull()
    expect(parseTimeInput('1:2:3:4')).toBeNull()
    expect(parseTimeInput('a:b')).toBeNull()
    expect(parseTimeInput('-5')).toBeNull()
  })
})
