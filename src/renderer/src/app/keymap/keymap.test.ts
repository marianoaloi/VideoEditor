import { describe, expect, it, vi } from 'vitest'
import { eventToChord, type KeyEventLike } from './chord'
import { findConflicts } from './conflicts'
import { clearHandlers, registerHandlers, resolveBinding } from './registry'
import type { RegisteredBinding } from './types'

function ev(partial: Partial<KeyEventLike> & { key: string }): KeyEventLike {
  return {
    code: '',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...partial
  }
}

describe('eventToChord', () => {
  it('upper-cases letters and orders modifiers Ctrl+Alt+Shift+Meta', () => {
    expect(eventToChord(ev({ key: 'a' }))).toBe('A')
    expect(eventToChord(ev({ key: 'F', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+F')
    expect(
      eventToChord(ev({ key: 'x', ctrlKey: true, altKey: true, shiftKey: true, metaKey: true }))
    ).toBe('Ctrl+Alt+Shift+Meta+X')
  })
  it('uses the physical digit so Shift+1 is not "!"', () => {
    expect(eventToChord(ev({ key: '!', code: 'Digit1', shiftKey: true }))).toBe('Shift+1')
    expect(eventToChord(ev({ key: '3', code: 'Numpad3', ctrlKey: true }))).toBe('Ctrl+3')
  })
  it('maps symbol keys and drops Shift for them', () => {
    expect(eventToChord(ev({ key: '+', code: 'Equal', shiftKey: true }))).toBe('Plus')
    expect(eventToChord(ev({ key: '+', code: 'NumpadAdd' }))).toBe('Plus')
    expect(eventToChord(ev({ key: '-', code: 'Minus' }))).toBe('Minus')
  })
  it('names every Ctrl zoom variant (US, Brazilian, Italian, numpad) as Ctrl+Plus / Ctrl+Minus', () => {
    expect(eventToChord(ev({ key: '+', code: 'Equal', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Plus')
    expect(eventToChord(ev({ key: '=', code: 'Equal', ctrlKey: true }))).toBe('Ctrl+Plus')
    expect(eventToChord(ev({ key: '+', code: 'BracketRight', ctrlKey: true }))).toBe('Ctrl+Plus')
    expect(eventToChord(ev({ key: '+', code: 'NumpadAdd', ctrlKey: true }))).toBe('Ctrl+Plus')
    expect(eventToChord(ev({ key: '-', code: 'Minus', ctrlKey: true }))).toBe('Ctrl+Minus')
    expect(eventToChord(ev({ key: '-', code: 'NumpadSubtract', ctrlKey: true }))).toBe('Ctrl+Minus')
    expect(eventToChord(ev({ key: '0', code: 'Digit0', ctrlKey: true }))).toBe('Ctrl+0')
    expect(eventToChord(ev({ key: '0', code: 'Numpad0', ctrlKey: true }))).toBe('Ctrl+0')
    expect(eventToChord(ev({ key: '=', code: 'Equal' }))).toBeNull()
  })
  it('names special keys and function keys', () => {
    expect(eventToChord(ev({ key: 'ArrowUp' }))).toBe('ArrowUp')
    expect(eventToChord(ev({ key: ' ', code: 'Space' }))).toBe('Space')
    expect(eventToChord(ev({ key: 'Delete', shiftKey: true }))).toBe('Shift+Delete')
    expect(eventToChord(ev({ key: 'F1' }))).toBe('F1')
    expect(eventToChord(ev({ key: 'F12' }))).toBe('F12')
  })
  it('ignores modifiers alone and unknown keys', () => {
    expect(eventToChord(ev({ key: 'Shift', shiftKey: true }))).toBeNull()
    expect(eventToChord(ev({ key: 'Dead' }))).toBeNull()
  })
})

describe('findConflicts', () => {
  it('flags the same chord twice in a scope and workspace-vs-global clashes', () => {
    const conflicts = findConflicts([
      { id: 'videoTriage.a', keys: ['A'], description: 'x', scope: 'videoTriage' },
      { id: 'videoTriage.b', keys: ['A', 'B'], description: 'x', scope: 'videoTriage' },
      { id: 'global.help', keys: ['F1'], description: 'x', scope: 'global' },
      { id: 'imageTriage.help', keys: ['F1'], description: 'x', scope: 'imageTriage' },
      { id: 'cutter.a', keys: ['A'], description: 'x', scope: 'cutter' }
    ])
    expect(conflicts).toEqual([
      { chord: 'F1', scope: 'imageTriage', bindingIds: ['imageTriage.help', 'global.help'] },
      { chord: 'A', scope: 'videoTriage', bindingIds: ['videoTriage.a', 'videoTriage.b'] }
    ])
  })
  it('allows the same chord in different workspaces', () => {
    expect(
      findConflicts([
        { id: 'cutter.a', keys: ['A'], description: 'x', scope: 'cutter' },
        { id: 'jobs.a', keys: ['A'], description: 'x', scope: 'jobs' }
      ])
    ).toEqual([])
  })
})

describe('resolveBinding', () => {
  const run = vi.fn()
  const make = (
    id: string,
    scope: RegisteredBinding['scope'],
    keys: string[],
    extra = {}
  ): RegisteredBinding => ({
    id,
    scope,
    keys,
    description: id,
    run,
    ...extra
  })
  const source = [
    make('videoTriage.a', 'videoTriage', ['A']),
    make('global.help', 'global', ['F1']),
    make('crop.close', 'crop', ['Escape']),
    make('videoTriage.seek', 'videoTriage', ['ArrowRight'], { allowRepeat: true }),
    make('videoTriage.off', 'videoTriage', ['Q'], { enabled: false }),
    make('videoTriage.name', 'videoTriage', ['N'], { allowInInput: true })
  ]
  const idle = { repeat: false, inInput: false }

  it('prefers the active workspace, then global', () => {
    const state = { activeWorkspace: 'videoTriage' as const, modalStack: [] }
    expect(resolveBinding('A', state, idle, source)?.id).toBe('videoTriage.a')
    expect(resolveBinding('F1', state, idle, source)?.id).toBe('global.help')
    expect(
      resolveBinding('A', { ...state, activeWorkspace: 'jobs' as const }, idle, source)
    ).toBeNull()
  })
  it('lets only the top modal scope handle keys', () => {
    const state = { activeWorkspace: 'videoTriage' as const, modalStack: ['crop' as const] }
    expect(resolveBinding('A', state, idle, source)).toBeNull()
    expect(resolveBinding('F1', state, idle, source)).toBeNull()
    expect(resolveBinding('Escape', state, idle, source)?.id).toBe('crop.close')
  })
  it('filters disabled bindings, auto-repeat and typing in inputs', () => {
    const state = { activeWorkspace: 'videoTriage' as const, modalStack: [] }
    expect(resolveBinding('Q', state, idle, source)).toBeNull()
    expect(resolveBinding('A', state, { repeat: true, inInput: false }, source)).toBeNull()
    expect(resolveBinding('ArrowRight', state, { repeat: true, inInput: false }, source)?.id).toBe(
      'videoTriage.seek'
    )
    expect(resolveBinding('A', state, { repeat: false, inInput: true }, source)).toBeNull()
    expect(resolveBinding('N', state, { repeat: false, inInput: true }, source)?.id).toBe(
      'videoTriage.name'
    )
  })
})

describe('registerHandlers', () => {
  it('unregisters exactly what it registered', () => {
    clearHandlers()
    const off = registerHandlers('cutter', [
      { id: 'cutter.x', keys: ['X'], description: 'x', run: () => undefined }
    ])
    const state = { activeWorkspace: 'cutter' as const, modalStack: [] }
    expect(resolveBinding('X', state, { repeat: false, inInput: false })?.id).toBe('cutter.x')
    off()
    expect(resolveBinding('X', state, { repeat: false, inInput: false })).toBeNull()
  })
})
