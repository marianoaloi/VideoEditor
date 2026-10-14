/** HTTP `Range` header parsing for the `media://` file responses (single range only). */

export interface ByteRange {
  readonly start: number
  /** Inclusive. */
  readonly end: number
}

export type RangeParse =
  | { readonly kind: 'none' }
  | { readonly kind: 'range'; readonly range: ByteRange }
  | { readonly kind: 'unsatisfiable' }

const RANGE_RE = /^bytes=(\d*)-(\d*)$/

function suffixRange(length: number, size: number): RangeParse {
  if (length === 0 || size === 0) return { kind: 'unsatisfiable' }
  return { kind: 'range', range: { start: Math.max(0, size - length), end: size - 1 } }
}

/**
 * Parses `bytes=a-b`, `bytes=a-` and `bytes=-n` against a file of `size` bytes. Multi-range
 * requests and other units are ignored (the full file is served), as the spec allows.
 */
export function parseRange(header: string | null, size: number): RangeParse {
  if (header === null || header.includes(',')) return { kind: 'none' }
  const match = RANGE_RE.exec(header.trim())
  if (match === null) return { kind: 'none' }
  const rawStart = match[1] ?? ''
  const rawEnd = match[2] ?? ''
  if (rawStart === '' && rawEnd === '') return { kind: 'none' }
  if (rawStart === '') return suffixRange(Number(rawEnd), size)
  const start = Number(rawStart)
  if (start >= size) return { kind: 'unsatisfiable' }
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (end < start) return { kind: 'none' }
  return { kind: 'range', range: { start, end } }
}
