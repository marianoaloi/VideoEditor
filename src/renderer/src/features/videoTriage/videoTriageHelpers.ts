/** Small pure helpers of the Video Triage screen (label, Go to file, prefetch window). */
import type { TriageItem } from '../../app/triage/triageCore'

/** `"<path> <total>/<index+1>"` (video-triage.md §1.4), for example `/in/a.mp4 120/3`. */
export function itemLabel(item: Pick<TriageItem, 'path'>, total: number, index: number): string {
  return `${item.path} ${total}/${index + 1}`
}

export type FindResult =
  | { readonly ok: true; readonly index: number }
  | { readonly ok: false; readonly reason: 'empty' | 'invalid' | 'none'; readonly message: string }

/**
 * Options > Go to file (§6): the first item from index 0 whose CURRENT path matches the regular
 * expression. Moved items count. An invalid expression and "no match" both give a message.
 */
export function findFirstMatch(
  items: readonly Pick<TriageItem, 'path'>[],
  text: string,
  ignoreCase: boolean
): FindResult {
  if (text.trim() === '') return { ok: false, reason: 'empty', message: 'Type part of a file name' }
  let pattern: RegExp
  try {
    pattern = new RegExp(text, ignoreCase ? 'i' : '')
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: 'invalid', message: `Not a valid pattern: ${detail}` }
  }
  const index = items.findIndex((item) => pattern.test(item.path))
  if (index < 0) return { ok: false, reason: 'none', message: `No file matches "${text}"` }
  return { ok: true, index }
}

/** The next `count` pending items after `cursor` (probe and thumbnail prefetch, §2 step 13). */
export function upcomingItems(
  items: readonly TriageItem[],
  cursor: number,
  count: number
): TriageItem[] {
  const result: TriageItem[] = []
  for (let i = cursor + 1; i < items.length && result.length < count; i += 1) {
    const item = items[i]
    if (item !== undefined && item.status === 'pending') result.push(item)
  }
  return result
}
