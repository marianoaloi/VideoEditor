import { describe, expect, it } from 'vitest'
import type { TriageItem } from '../../app/triage/triageCore'
import {
  historyItems,
  isAnimatedFormat,
  mainStripItems,
  needsConvertedPreview,
  planImageEdit,
  statusParts,
  stepInterval,
  validateDestinationName,
  wheelDirection
} from './logic'

function item(n: number, status: TriageItem['status'] = 'pending', name = `i${n}.jpg`): TriageItem {
  return { id: `i${n}`, path: `C:\\r\\${name}`, originalPath: `C:\\r\\${name}`, relDir: '', name, sizeBytes: 1536, mtimeMs: 1, kind: 'image', status, entryId: null, version: 1 }
}

function run(start: number, dirs: Array<1 | -1>): number[] {
  const out: number[] = []
  let ms = start
  for (const d of dirs) {
    ms = stepInterval(ms, d)
    out.push(ms)
  }
  return out
}

describe('timer (TV-20..24, checklist 47)', () => {
  it('TV-20/21 wheel down shortens, wheel up lengthens by 100 ms', () => {
    expect(run(1000, [-1, -1, -1])).toEqual([900, 800, 700])
    expect(run(1000, [1, 1, 1])).toEqual([1100, 1200, 1300])
  })
  it('TV-22 sixteen steps down', () => {
    expect(run(1000, Array(16).fill(-1))).toEqual([900, 800, 700, 600, 500, 400, 300, 200, 190, 180, 170, 160, 150, 140, 130, 120])
  })
  it('TV-23 asymmetric boundary', () => {
    expect(stepInterval(200, 1)).toBe(210)
    expect(run(290, [1, 1])).toEqual([300, 400])
  })
  it('TV-24 floor 100, and a 60000 ms cap', () => {
    expect(stepInterval(100, -1)).toBe(100)
    expect(stepInterval(60000, 1)).toBe(60000)
  })
  it('browser deltaY < 0 is wheel up', () => {
    expect(wheelDirection(-100)).toBe(1)
    expect(wheelDirection(100)).toBe(-1)
    expect(wheelDirection(0)).toBe(0)
  })
})

describe('destination names (TV-7, checklist 16)', () => {
  it('accepts a segment and rejects the invalid ones', () => {
    expect(validateDestinationName('keep', 'R', 'bkp')).toEqual({ ok: true, value: 'keep' })
    for (const bad of ['..', 'a/b', '', '  ']) {
      expect(validateDestinationName(bad, 'R', 'bkp').ok).toBe(false)
    }
  })
  it('refuses the other side and the backup folder', () => {
    expect(validateDestinationName('r', 'R', 'bkp').ok).toBe(false)
    expect(validateDestinationName('BKP', 'R', 'bkp').ok).toBe(false)
  })
})

describe('strips (TV-13, TV-15, checklist 11-12)', () => {
  const items = [0, 1, 2, 3, 4, 5].map((n) => item(n, n % 2 === 0 ? 'left' : 'right'))
  it('TV-13 history is newest first', () => {
    expect(historyItems(items, 6, 5, 'left').map((i) => i.id)).toEqual(['i4', 'i2', 'i0'])
    expect(historyItems(items, 6, 5, 'right').map((i) => i.id)).toEqual(['i5', 'i3', 'i1'])
  })
  it('TV-15 the look-back window is 100 items', () => {
    const many = [item(0, 'left'), ...Array.from({ length: 100 }, (_, n) => item(n + 1, 'skipped'))]
    expect(historyItems(many, 100, 1, 'left').map((i) => i.id)).toEqual(['i0'])
    expect(historyItems(many, 101, 1, 'left')).toEqual([])
  })
  it('shows at most four tiles', () => {
    const lefts = Array.from({ length: 8 }, (_, n) => item(n, 'left'))
    expect(historyItems(lefts, 8, 5, 'left')).toHaveLength(4)
  })
  it('main strip: current then the next undecided ones, decided look-aheads leave no hole', () => {
    const list = [item(0), item(1), item(2, 'left'), item(3), item(4), item(5)]
    expect(mainStripItems(list, 0, 4).map((i) => i.id)).toEqual(['i0', 'i1', 'i3', 'i4'])
    expect(mainStripItems(list, 6, 5)).toEqual([])
  })
})

describe('edit planning (TV-33, TV-34, checklist 36)', () => {
  const crop = { x: 1, y: 2, w: 3, h: 4 }
  it('TV-33 neutral does nothing', () => {
    expect(planImageEdit({ crop: null, bright: null, contrast: null, transpose: null })).toEqual({ edit: null, warnings: [] })
  })
  it('TV-34 a crop wins and the operator is told the adjustments were ignored', () => {
    const plan = planImageEdit({ crop, bright: 0.2, contrast: null, transpose: null })
    expect(plan.edit).toEqual({ crop, bright: null, contrast: null, transpose: null })
    expect(plan.warnings).toHaveLength(1)
  })
  it('a crop alone has no warning', () => {
    expect(planImageEdit({ crop, bright: null, contrast: null, transpose: null }).warnings).toEqual([])
  })
  it('adjust-only is kept, rotation is dropped with a warning', () => {
    const plan = planImageEdit({ crop: null, bright: 0.2, contrast: 1.5, transpose: -90 })
    expect(plan.edit).toEqual({ crop: null, bright: 0.2, contrast: 1.5, transpose: null })
    expect(plan.warnings).toHaveLength(1)
    expect(planImageEdit({ crop: null, bright: null, contrast: null, transpose: -45 }).edit).toBeNull()
  })
})

describe('status line and formats (TV-36, TV-41, checklist 14, 29)', () => {
  it('formats size and counter; end of list shows the root', () => {
    const list = [item(0), item(1)]
    expect(statusParts(list, 0, 'C:\\r')).toEqual({ size: '[1.50K]', path: 'C:\\r\\i0.jpg', counter: '2/1' })
    expect(statusParts(list, 2, 'C:\\r').path).toBe('C:\\r')
  })
  it('GIF and WEBP are animated, any case', () => {
    expect(isAnimatedFormat('a.gif')).toBe(true)
    expect(isAnimatedFormat('b.WEBP')).toBe(true)
    expect(isAnimatedFormat('c.jpg')).toBe(false)
  })
  it('tif and heic need the converted preview', () => {
    expect(needsConvertedPreview('a.TIF')).toBe(true)
    expect(needsConvertedPreview('a.png')).toBe(false)
  })
})
