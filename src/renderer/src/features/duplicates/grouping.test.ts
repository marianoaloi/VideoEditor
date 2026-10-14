import { describe, expect, it } from 'vitest'
import { groupDuplicates, pathKey, roundHalfEven } from '@shared/core/duplicates'
import type { HashRow } from '@shared/domain/hash'
import {
  applyMoveFileTags,
  difBadge,
  exportScreenData,
  firstLinePaths,
  keyCounts,
  orderRows,
  parseMoveFileOutput,
  sanitizeFolderName,
  tableRowsForKey,
  unreadablePaths,
  unselectFirstColumn
} from './grouping'

type Keys = Partial<Record<'md5' | 'pureMD5' | 'hash16' | 'hash8' | 'thumbLight' | 'thumbDark', string>>

function row(path: string, keys: Keys, extra: Partial<HashRow> = {}): HashRow {
  return {
    root: '/d',
    inFile: path.slice(3),
    path,
    md5: null,
    pureMD5: null,
    hash16: null,
    hash8: null,
    thumbLight: null,
    thumbDark: null,
    worksdWell: true,
    sizeFile: 1000,
    comments: '',
    ...keys,
    ...extra
  }
}

// Test vector (a) of duplicates-thumbs.md section 12
const CSV: HashRow[] = [
  row('/d/a.mp4', { md5: 'M1', pureMD5: 'P1', hash16: 'H1', hash8: 'E1', thumbLight: 'L1', thumbDark: 'D1' }),
  row('/d/a.mp4', { md5: 'M1', pureMD5: 'P2', hash16: 'H2', hash8: 'E2', thumbLight: 'L2', thumbDark: 'D2' }),
  row('/d/a.mp4', { md5: 'M1', pureMD5: 'P3', hash16: 'H2', hash8: 'E3', thumbLight: 'L3', thumbDark: 'D3' }),
  row('/d/b.mp4', { md5: 'M2', pureMD5: 'P3', hash16: 'H3', hash8: 'E1', thumbLight: 'L4', thumbDark: 'D4' }, { sizeFile: 2000 }),
  row('/d/b.mp4', { md5: 'M2', pureMD5: 'P4', hash16: 'H1', hash8: 'E3', thumbLight: 'L5', thumbDark: 'D5' }, { sizeFile: 2000 }),
  row('/d/c.mp4', { md5: 'M1', pureMD5: 'P5', hash16: 'H4', hash8: 'E5', thumbLight: 'L6', thumbDark: 'D6' }),
  row('/d/bad.jpg', {}, { worksdWell: false, sizeFile: 10 }),
  row('/d/d.mp4', { md5: 'M3', pureMD5: 'P2', hash16: 'H5', hash8: 'E6', thumbLight: 'L1', thumbDark: 'D7' }, { sizeFile: 3000 })
]

const facts = (bitrateKbps: number, height = 1, hasAudio = false) => ({
  width: 1,
  height,
  bitrateKbps,
  hasAudio,
  sizeBytes: 1
})

describe('grouping (checklist 21-23, vector a)', () => {
  it('21: reproduces the groups of all six keys', () => {
    const names = (key: Parameters<typeof groupDuplicates>[1]) =>
      groupDuplicates(CSV, key).map((g) => [g.value, g.paths])
    expect(names('md5')).toEqual([['M1', ['/d/a.mp4', '/d/c.mp4']]])
    expect(names('pureMD5')).toEqual([
      ['P2', ['/d/a.mp4', '/d/d.mp4']],
      ['P3', ['/d/a.mp4', '/d/b.mp4']]
    ])
    expect(names('hash16')).toEqual([['H1', ['/d/a.mp4', '/d/b.mp4']]])
    expect(names('hash8')).toHaveLength(2)
    expect(names('thumbLight')).toEqual([['L1', ['/d/a.mp4', '/d/d.mp4']]])
    expect(names('thumbDark')).toEqual([])
  })

  it('23: counts are groups / distinct files, in the legacy key order', () => {
    expect(keyCounts(CSV).map((c) => [c.key, c.groups, c.files])).toEqual([
      ['md5', 1, 2],
      ['pureMD5', 2, 3],
      ['hash16', 1, 2],
      ['hash8', 2, 2],
      ['thumbLight', 1, 2],
      ['thumbDark', 0, 0]
    ])
  })

  it('22: hash8 shows one table row (same ordered member list)', () => {
    expect(tableRowsForKey(CSV, 'hash8')).toHaveLength(1)
    expect(tableRowsForKey(CSV, 'pureMD5')).toHaveLength(2)
  })

  it('the Windows auto-fold lives in pathKey: case, slashes and duplicate separators', () => {
    expect(pathKey('C:\\Pics\\A.JPG')).toBe(pathKey('c:/pics//a.jpg'))
    expect(pathKey('\\\\NAS\\Share\\x')).toBe('/nas/share/x')
    expect(pathKey('/d/A.mp4')).not.toBe(pathKey('/d/a.mp4'))
    expect(pathKey('/d/A.mp4', true)).toBe(pathKey('/d/a.mp4'))
  })

  it('Windows paths differing only in case are one file, so no group', () => {
    const rows = [row('C:/d/A.mp4', { md5: 'X' }), row('C:/d/a.mp4', { md5: 'X' })]
    expect(groupDuplicates(rows, 'md5')).toEqual([])
  })

  it('22: orders by bitrate desc, unreadable last, hides rows with < 2 readable members', () => {
    const rows = tableRowsForKey(CSV, 'md5')
    const ordered = orderRows(rows, 'video', { '/d/a.mp4': facts(100), '/d/c.mp4': facts(900) })
    expect(ordered[0]?.members.map((m) => m.path)).toEqual(['/d/c.mp4', '/d/a.mp4'])
    expect(orderRows(rows, 'video', { '/d/a.mp4': facts(1), '/d/c.mp4': null })).toEqual([])
  })

  it('22: images order by height desc, stable on ties', () => {
    const rows = tableRowsForKey(CSV, 'md5')
    const same = orderRows(rows, 'image', { '/d/a.mp4': facts(0, 5), '/d/c.mp4': facts(0, 5) })
    expect(same[0]?.members.map((m) => m.path)).toEqual(['/d/a.mp4', '/d/c.mp4'])
    const taller = orderRows(rows, 'image', { '/d/a.mp4': facts(0, 5), '/d/c.mp4': facts(0, 9) })
    expect(taller[0]?.members[0]?.path).toBe('/d/c.mp4')
  })

  it('29: the feedback list holds distinct worksdWell=False paths', () => {
    expect(unreadablePaths(CSV)).toEqual(['/d/bad.jpg'])
  })
})

describe('DIF badge (checklist 24, vector c)', () => {
  const cases: Array<[number, number, string]> = [
    [1010, 1010, 'none'],
    [1010, 1004, 'red 1'],
    [1010, 1000, 'red 1'],
    [1000, 1004, 'blue'],
    [1000, 1010, 'blue'],
    [2000, 1000, 'red 100'],
    [1000, 2000, 'blue'],
    [1000, 995, 'red 1'],
    [1000, 994, 'red 1'],
    [1125, 1000, 'red 12']
  ]
  it.each(cases)('first %i vs %i -> %s', (first, size, expected) => {
    const badge = difBadge(first, size)
    expect(badge.kind === 'red' ? `red ${badge.percent}` : badge.kind).toBe(expected)
  })

  it('rounds ties half to even like Python', () => {
    expect([0.5, 1.5, 2.5, 12.5, 13.5].map(roundHalfEven)).toEqual([0, 2, 2, 12, 14])
  })

  it('a zero size shows nothing instead of dividing by zero', () => {
    expect(difBadge(1000, 0)).toEqual({ kind: 'none' })
  })
})

describe('selection helpers and openList (checklist 27, 32)', () => {
  const rows = tableRowsForKey(CSV, 'pureMD5')

  it('unselect first column selects all but the first member of every row, additively', () => {
    expect(unselectFirstColumn(rows, ['/d/zzz.mp4']).sort()).toEqual(['/d/b.mp4', '/d/d.mp4', '/d/zzz.mp4'])
  })

  it('first line: the first member with audio, else the first member', () => {
    expect(firstLinePaths(rows, {})).toEqual(['/d/a.mp4', '/d/a.mp4'])
    const withAudio = { '/d/d.mp4': facts(1, 1, true), '/d/b.mp4': facts(1, 1, true) }
    expect(firstLinePaths(rows, withAudio)).toEqual(['/d/d.mp4', '/d/b.mp4'])
  })

  it('parses ##MOVEFILE lines; R selects, L deselects, others are ignored', () => {
    const text = 'noise\n##MOVEFILE R /d/b.mp4,/d/d.mp4\n##MOVEFILE L /d/a.mp4\n##MOVEFILE X /d/c.mp4\n'
    const tags = parseMoveFileOutput(text)
    expect([...tags.keys()]).toEqual(['R', 'L', 'X'])
    expect(applyMoveFileTags(['/d/a.mp4'], tags, rows).sort()).toEqual(['/d/b.mp4', '/d/d.mp4'])
  })

  it('exports [[path, key], ...] row-major', () => {
    expect(JSON.parse(exportScreenData(tableRowsForKey(CSV, 'md5')))).toEqual([
      ['/d/a.mp4', 'M1'],
      ['/d/c.mp4', 'M1']
    ])
  })

  it('folder names: empty = default, separators and .. rejected', () => {
    expect(sanitizeFolderName('  ', 'md5Purge')).toBe('md5Purge')
    expect(sanitizeFolderName(' out ', 'md5Purge')).toBe('out')
    expect(sanitizeFolderName('a/b', 'x')).toBeNull()
    expect(sanitizeFolderName('..', 'x')).toBeNull()
  })
})
