import { describe, expect, it } from 'vitest'
import type { TriageItem } from '../../app/triage/triageCore'
import { findFirstMatch, itemLabel, upcomingItems } from './videoTriageHelpers'

function item(n: number, status: TriageItem['status'] = 'pending'): TriageItem {
  return {
    id: `i${n}`,
    path: `/in/clip${n}.mp4`,
    originalPath: `/in/clip${n}.mp4`,
    relDir: '',
    name: `clip${n}.mp4`,
    sizeBytes: 1,
    mtimeMs: 1,
    kind: 'video',
    status,
    entryId: null,
    version: 1
  }
}

describe('Go to file (checklist 49)', () => {
  const items = [item(0), item(1, 'left'), item(2)]

  it('finds the first match from index 0, moved items included', () => {
    expect(findFirstMatch(items, 'clip[12]', false)).toEqual({ ok: true, index: 1 })
  })

  it('is case sensitive unless asked', () => {
    expect(findFirstMatch(items, 'CLIP2', false)).toMatchObject({ ok: false, reason: 'none' })
    expect(findFirstMatch(items, 'CLIP2', true)).toEqual({ ok: true, index: 2 })
  })

  it('reports an invalid pattern and an empty one', () => {
    expect(findFirstMatch(items, '(', false)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(findFirstMatch(items, '  ', false)).toMatchObject({ ok: false, reason: 'empty' })
  })
})

describe('labels and prefetch window', () => {
  it('formats the legacy label', () => {
    expect(itemLabel({ path: '/in/a.mp4' }, 120, 2)).toBe('/in/a.mp4 120/3')
  })

  it('takes the next pending items only', () => {
    const list = [item(0), item(1), item(2, 'skipped'), item(3), item(4)]
    expect(upcomingItems(list, 0, 2).map((i) => i.id)).toEqual(['i1', 'i3'])
    expect(upcomingItems(list, 4, 2)).toEqual([])
  })
})
