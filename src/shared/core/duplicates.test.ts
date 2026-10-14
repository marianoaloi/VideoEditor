import { describe, expect, it } from 'vitest'
import { HASH_KEYS, type HashKey, type HashRow } from '../domain/hash'
import { parseHashCsv } from './hashCsv'
import {
  dedupeByMembers,
  failedPaths,
  groupAllKeys,
  groupDuplicates,
  pathKey,
  summarizeGroups
} from './duplicates'

const CSV = `root,inFile,path,md5,pureMD5,hash16,hash8,thumbLight,thumbDark,worksdWell,sizeFile,comments
/d,a.mp4,/d/a.mp4,M1,P1,H1,E1,L1,D1,True,1000,
/d,a.mp4,/d/a.mp4,M1,P2,H2,E2,L2,D2,True,1000,
/d,a.mp4,/d/a.mp4,M1,P3,H2,E3,L3,D3,True,1000,
/d,b.mp4,/d/b.mp4,M2,P3,H3,E1,L4,D4,True,2000,
/d,b.mp4,/d/b.mp4,M2,P4,H1,E3,L5,D5,True,2000,
/d,c.mp4,/d/c.mp4,M1,P5,H4,E5,L6,D6,True,1000,
/d,bad.jpg,/d/bad.jpg,,,,,,,False,10,Not complete image truncated
/d,d.mp4,/d/d.mp4,M3,P2,H5,E6,L1,D7,True,3000,
`
const rows: HashRow[] = parseHashCsv(CSV)
const names = (g: { paths: string[] }): string[] => g.paths.map((p) => p.slice(3, 4))

describe('groupDuplicates (item 21, section 12a)', () => {
  const expected: Record<HashKey, Array<[string, string[]]>> = {
    md5: [['M1', ['a', 'c']]],
    pureMD5: [
      ['P2', ['a', 'd']],
      ['P3', ['a', 'b']]
    ],
    hash16: [['H1', ['a', 'b']]],
    hash8: [
      ['E1', ['a', 'b']],
      ['E3', ['a', 'b']]
    ],
    thumbLight: [['L1', ['a', 'd']]],
    thumbDark: []
  }
  for (const key of HASH_KEYS) {
    it(`key ${key}`, () => {
      const got = groupDuplicates(rows, key).map((g) => [g.value, names(g)])
      expect(got).toEqual(expected[key])
    })
  }

  it('md5 group lists every frame row of each copy, in CSV order', () => {
    const g = groupDuplicates(rows, 'md5')[0]
    expect(g?.rows).toHaveLength(4)
    expect(g?.id).toBe('md5:M1')
    expect(g?.sizeDiffPercent).toBe(0)
  })

  it('one value under one file only is not a group (H2 under a)', () => {
    expect(groupDuplicates(rows, 'hash16').some((g) => g.value === 'H2')).toBe(false)
  })

  it('summaries match the port labels', () => {
    const all = groupAllKeys(rows)
    const label = HASH_KEYS.map((k) => {
      const s = summarizeGroups(all[k])
      return `${s.groups}/${s.files}`
    })
    expect(label).toEqual(['1/2', '2/3', '1/2', '2/2', '1/2', '0/0'])
  })

  it('table rows de-duplicate by ordered member list (hash8 -> 1)', () => {
    const groups = groupDuplicates(rows, 'hash8')
    expect(dedupeByMembers(groups, (g) => g.paths)).toHaveLength(1)
  })

  it('ignores failure rows; Feedback lists them', () => {
    expect(failedPaths(rows)).toEqual(['/d/bad.jpg'])
  })

  it('paths differing only by case are one file when case-insensitive', () => {
    const two = parseHashCsv(CSV.replaceAll('/d/c.mp4', '/d/A.MP4').replaceAll('/d/a.mp4', '/d/a.MP4'))
    expect(groupDuplicates(two, 'md5')).toHaveLength(1)
    expect(groupDuplicates(two, 'md5', { caseInsensitivePaths: true })).toEqual([])
    expect(pathKey('C:\\X\\\\y\\', true)).toBe('c:/x/y')
  })

  it('computes the size difference', () => {
    const g = groupDuplicates(rows, 'pureMD5')[1]
    expect(g?.sizeDiffPercent).toBe(50)
  })
})
