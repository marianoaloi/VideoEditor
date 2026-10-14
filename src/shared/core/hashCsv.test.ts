import { describe, expect, it } from 'vitest'
import type { HashRow } from '../domain/hash'
import { parseCsvRecords, parseHashCsv, serializeHashCsv } from './hashCsv'

const base: HashRow = {
  root: '/d',
  inFile: 'a,b.jpg',
  path: '/d/a,b.jpg',
  md5: 'M',
  pureMD5: 'P',
  hash16: 'H',
  hash8: 'E',
  thumbLight: 'L',
  thumbDark: 'D',
  worksdWell: true,
  sizeFile: 1234,
  comments: ''
}
const bad: HashRow = {
  ...base,
  inFile: 'bad.jpg',
  path: '/d/bad.jpg',
  md5: null,
  pureMD5: null,
  hash16: null,
  hash8: null,
  thumbLight: null,
  thumbDark: null,
  worksdWell: false,
  sizeFile: 10,
  comments: 'Not complete image image file is truncated (3 bytes not processed)'
}
const quoted: HashRow = {
  ...bad,
  inFile: 'q"x.mp4',
  path: '/d/q"x.mp4',
  sizeFile: 0,
  comments: 'float division by zero'
}

const LEGACY =
  'root,inFile,path,md5,pureMD5,hash16,hash8,thumbLight,thumbDark,worksdWell,sizeFile,comments\r\n' +
  '/d,"a,b.jpg","/d/a,b.jpg",M,P,H,E,L,D,True,1234,\r\n' +
  '/d,bad.jpg,/d/bad.jpg,,,,,,,False,10,Not complete image image file is truncated (3 bytes not processed)\r\n' +
  '/d,"q""x.mp4","/d/q""x.mp4",,,,,,,False,0,float division by zero\r\n'

describe('hash CSV (items 3, 31)', () => {
  it('writes the legacy bytes (section 3 example)', () => {
    expect(serializeHashCsv([base, bad, quoted])).toBe(LEGACY)
  })

  it('round trips', () => {
    expect(parseHashCsv(serializeHashCsv([base, bad, quoted]))).toEqual([base, bad, quoted])
  })

  it('reads LF endings, BOM and multi-line quoted comments', () => {
    const lf = LEGACY.replace(/\r\n/g, '\n').replace('float division by zero', '"two\nlines"')
    const rows = parseHashCsv('﻿' + lf)
    expect(rows).toHaveLength(3)
    expect(rows[2]?.comments).toBe('two\nlines')
  })

  it('reads the pandas to_csv layout (index first, DB last)', () => {
    const text =
      'path,root,inFile,md5,pureMD5,hash16,hash8,thumbLight,thumbDark,worksdWell,sizeFile,comments,DB\n' +
      '/d/x.mp4,/d,x.mp4,M,P,H,E,L,D,True,5,,False\n'
    expect(parseHashCsv(text)).toEqual([{ ...base, inFile: 'x.mp4', path: '/d/x.mp4', sizeFile: 5 }])
  })

  it('accepts true/FALSE spellings and keeps hashes opaque', () => {
    const text =
      'root,inFile,path,md5,pureMD5,hash16,hash8,thumbLight,thumbDark,worksdWell,sizeFile,comments\n' +
      '/d,a,/d/a,000,0001,,,,,TRUE,7,\n/d,b,/d/b,,,,,,,false,8,x\n'
    const rows = parseHashCsv(text)
    expect(rows.map((r) => r.worksdWell)).toEqual([true, false])
    expect(rows[0]?.md5).toBe('000')
    expect(rows[0]?.pureMD5).toBe('0001')
  })

  it('rejects text that is not a hash CSV, accepts an empty file', () => {
    expect(() => parseHashCsv('a,b\n1,2\n')).toThrow()
    expect(parseHashCsv('')).toEqual([])
  })

  it('parseCsvRecords skips blank lines and keeps trailing empty fields', () => {
    expect(parseCsvRecords('a,b,\n\nc,,\n')).toEqual([
      ['a', 'b', ''],
      ['c', '', '']
    ])
  })
})
