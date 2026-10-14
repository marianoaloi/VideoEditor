/** `KeyboardEvent` to canonical chord (see `KEY_CHORD_PATTERN` in `@shared/domain/keymap`). */
import { KEY_CHORD_PATTERN, type KeyChord } from '@shared/domain/keymap'

/** The fields of a `KeyboardEvent` that matter (also satisfied by test objects). */
export interface KeyEventLike {
  readonly key: string
  readonly code: string
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
  readonly metaKey: boolean
}

const SYMBOL_KEYS: Readonly<Record<string, string>> = {
  '+': 'Plus',
  '-': 'Minus',
  '*': 'Multiply',
  '/': 'Divide',
  '.': 'Period',
  ',': 'Comma',
  NumpadAdd: 'Plus',
  NumpadSubtract: 'Minus',
  NumpadMultiply: 'Multiply',
  NumpadDivide: 'Divide',
  NumpadDecimal: 'Period'
}

const NAMED_KEYS: Readonly<Record<string, string>> = {
  ' ': 'Space',
  Spacebar: 'Space',
  Esc: 'Escape',
  Del: 'Delete'
}

const PLAIN_NAMES = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Insert',
  'Delete',
  'Backspace',
  'Enter',
  'Escape',
  'Space',
  'Tab'
])

/** True for keys that are only modifiers (no chord on their own). */
export function isModifierKey(key: string): boolean {
  return (
    key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta' || key === 'AltGraph'
  )
}

/**
 * Letters use the produced character, digits use the physical `Digit`/`Numpad` code (so Shift+1
 * is `Shift+1`, not `!`). Symbol keys drop Shift. Returns `null` for modifier-only events and for
 * keys outside the canonical set.
 */
export function eventToChord(event: KeyEventLike): KeyChord | null {
  if (isModifierKey(event.key)) return null
  let name: string | null = null
  let symbol = false
  const code = event.code
  const symbolByCode = SYMBOL_KEYS[code]
  // Ctrl+= is the unshifted key that carries '+' (zoom in); plain '=' stays unmapped.
  const symbolByKey = event.key === '=' && event.ctrlKey ? 'Plus' : SYMBOL_KEYS[event.key]
  if (/^Digit[0-9]$/.test(code)) name = code.slice(5)
  else if (/^Numpad[0-9]$/.test(code)) name = code.slice(6)
  else if (symbolByCode !== undefined) {
    name = symbolByCode
    symbol = true
  } else if (symbolByKey !== undefined) {
    name = symbolByKey
    symbol = true
  } else if (/^[A-Za-z]$/.test(event.key)) name = event.key.toUpperCase()
  else if (/^F([1-9]|1[0-2])$/.test(event.key)) name = event.key
  else {
    const mapped = NAMED_KEYS[event.key] ?? event.key
    if (PLAIN_NAMES.has(mapped)) name = mapped
  }
  if (name === null) return null

  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey && !symbol) parts.push('Shift')
  if (event.metaKey) parts.push('Meta')
  parts.push(name)
  const chord = parts.join('+')
  return KEY_CHORD_PATTERN.test(chord) ? chord : null
}
