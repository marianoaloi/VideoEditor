/**
 * Plain-text "log" attached to an error toast (the log icon opens it). Pure: callers pass what they
 * know, nothing here reads the app state.
 */
import type { SerializedError } from '../api'

export type LogFields = Readonly<Record<string, string | number | boolean | null | undefined>>

/** `Label: value` lines (empty values are skipped), then an optional raw block. */
export function formatLog(
  title: string,
  fields: LogFields,
  raw?: string,
  now: Date = new Date()
): string {
  const lines = [title, `Time: ${now.toISOString()}`]
  for (const [label, value] of Object.entries(fields)) {
    if (value === null || value === undefined || value === '') continue
    lines.push(`${label}: ${String(value)}`)
  }
  const text = raw?.trim() ?? ''
  if (text !== '') lines.push('', '--- output ---', text)
  return lines.join('\n')
}

function stringify(details: unknown): string | undefined {
  if (details === undefined || details === null) return undefined
  if (typeof details === 'string') return details
  try {
    return JSON.stringify(details, null, 2)
  } catch {
    return String(details)
  }
}

/** The log of a failed IPC call about one file (ffprobe error text, code, details). */
export function describeFileError(title: string, path: string, error: SerializedError): string {
  return formatLog(
    title,
    { File: path, 'Error code': error.code, Details: stringify(error.details) },
    error.message
  )
}

/** Several failures in one log (the "N unreadable files moved to R" summary). */
export function joinLogs(blocks: readonly string[]): string {
  return blocks.join('\n\n==========\n\n')
}
