import { describe, expect, it } from 'vitest'
import {
  SEEK_KEYS,
  clampSeekTarget,
  effectiveDuration,
  modifierFactor,
  scrubTarget,
  seekDeltaMs,
  wheelNotches,
  type ModifierState
} from './seekStep'

const NONE: ModifierState = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }
const mods = (m: Partial<ModifierState>): ModifierState => ({ ...NONE, ...m })

/** Modifiers implied by a chord such as `Ctrl+Shift+ArrowUp`. */
function modsOf(chord: string): ModifierState {
  return mods({
    ctrlKey: chord.includes('Ctrl+'),
    shiftKey: chord.includes('Shift+'),
    altKey: chord.includes('Alt+')
  })
}

describe('modifierFactor (§5.2, checklist 24)', () => {
  it.each([
    [{}, 1],
    [{ ctrlKey: true }, 3],
    [{ shiftKey: true }, 0.3],
    [{ altKey: true }, 5],
    [{ ctrlKey: true, shiftKey: true }, 10],
    [{ metaKey: true }, 1],
    [{ ctrlKey: true, altKey: true }, 1],
    [{ altKey: true, shiftKey: true }, 1],
    [{ ctrlKey: true, shiftKey: true, altKey: true }, 1],
    [{ metaKey: true, ctrlKey: true }, 1]
  ])('%j -> x%s', (m, factor) => {
    expect(modifierFactor(mods(m))).toBe(factor)
  })

  it('rounds products to whole ms', () => {
    expect(seekDeltaMs(0.1, mods({ ctrlKey: true }), 1)).toBe(300)
    expect(seekDeltaMs(0.01, mods({ ctrlKey: true, shiftKey: true }), -1)).toBe(-100)
  })
})

describe('TV-B seek keys at 10 000 ms, media 60 000 ms', () => {
  const duration = effectiveDuration(60_000)
  const press = (chord: string, position = 10_000): number | null => {
    const key = SEEK_KEYS.find((k) => k.keys.includes(chord))
    if (key === undefined) throw new Error(`no seek key ${chord}`)
    return clampSeekTarget(
      position,
      seekDeltaMs(key.nominalSec, modsOf(chord), key.direction),
      duration
    )
  }

  it.each([
    ['E', 10_500],
    ['W', 9_500],
    ['Ctrl+E', 10_300],
    ['Ctrl+W', 9_700],
    ['Ctrl+Shift+E', 10_100],
    ['Ctrl+Shift+W', 9_900],
    ['R', 11_000],
    ['Q', 9_000],
    ['Ctrl+R', 25_000],
    ['Ctrl+Q', 0],
    ['Ctrl+Shift+R', 59_899],
    ['Ctrl+Shift+Q', 0],
    ['ArrowUp', 15_000],
    ['ArrowDown', 5_000],
    ['Ctrl+ArrowUp', 59_899],
    ['Ctrl+ArrowDown', 0],
    ['Shift+ArrowUp', 23_500],
    ['Shift+ArrowDown', 0],
    ['Ctrl+Shift+ArrowUp', 59_899],
    ['Ctrl+Shift+ArrowDown', 0]
  ])('%s -> %i', (chord, expected) => {
    expect(press(chord)).toBe(expected)
  })

  it('clamps at both ends and ignores unknown duration', () => {
    expect(press('ArrowUp', 59_000)).toBe(59_899)
    expect(press('Ctrl+ArrowDown', 3_000)).toBe(0)
    expect(clampSeekTarget(10, 5, 0)).toBeNull()
    expect(clampSeekTarget(10, 5, Number.NaN)).toBeNull()
  })

  it('registers 20 keys without duplicate chords or ids', () => {
    expect(SEEK_KEYS).toHaveLength(20)
    const chords = SEEK_KEYS.flatMap((k) => k.keys)
    expect(new Set(chords).size).toBe(20)
    expect(new Set(SEEK_KEYS.map((k) => k.id)).size).toBe(20)
  })

  it('wheel: nominal 1 s x modifiers (up positive)', () => {
    const wheel = (m: Partial<ModifierState>, dir: 1 | -1): number | null =>
      clampSeekTarget(10_000, seekDeltaMs(1, mods(m), dir), duration)
    expect(wheel({}, 1)).toBe(11_000)
    expect(wheel({ ctrlKey: true }, 1)).toBe(13_000)
    expect(wheel({ shiftKey: true }, 1)).toBe(10_300)
    expect(wheel({ altKey: true }, 1)).toBe(15_000)
    expect(wheel({ ctrlKey: true, shiftKey: true }, 1)).toBe(20_000)
    expect(wheel({}, -1)).toBe(9_000)
  })
})

describe('wheelNotches (checklist 16)', () => {
  it('accumulates small deltas and emits trunc(acc / 100) notches', () => {
    let result = wheelNotches({ remainder: 0 }, -60)
    expect(result.notches).toBe(0)
    result = wheelNotches(result.acc, -60)
    expect(result.notches).toBe(-1)
    expect(result.acc.remainder).toBe(-20)
    expect(wheelNotches({ remainder: 0 }, 250).notches).toBe(2)
  })
})

describe('TV-H scrub (checklist 15)', () => {
  it('matches the vectors', () => {
    expect(scrubTarget(250, 1000, 60_000)).toBe(14_975)
    expect(scrubTarget(999, 1000, 60_000)).toBe(59_840)
    expect(scrubTarget(0, 1000, 60_000)).toBe(0)
    expect(scrubTarget(1000, 1000, 60_000)).toBe(59_900)
    expect(scrubTarget(1001, 1000, 60_000)).toBeNull()
    expect(scrubTarget(-1, 1000, 60_000)).toBeNull()
    expect(scrubTarget(5, 0, 60_000)).toBeNull()
  })
})
