/**
 * Pure expansion of a hook command template (ADR-008). Owner: svc-files.
 *
 * - Placeholders: `{file}` `{files}` `{dir}` `{root}` `{md5}` `{outputs}`; `{{` and `}}` are literal braces.
 * - `args` are expanded per argv entry; an entry with a list placeholder (`{files}`, `{outputs}`)
 *   becomes one entry per value (the rest of the entry is repeated around each value).
 * - `env` values and `cwd`: list values are joined with a newline (Nautilus convention).
 * - Unknown placeholders, unbalanced braces and placeholders without a value are errors.
 */
import type { CommandTemplate, HookContext } from '../domain/hooks'

export const LIST_PLACEHOLDERS = ['files', 'outputs'] as const
export const SCALAR_PLACEHOLDERS = ['file', 'dir', 'root', 'md5'] as const
type ListName = (typeof LIST_PLACEHOLDERS)[number]
type PlaceholderName = ListName | (typeof SCALAR_PLACEHOLDERS)[number]

export class HookExpansionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HookExpansionError'
  }
}

export interface ExpandedCommand {
  readonly command: string
  readonly args: string[]
  readonly cwd: string | null
  readonly env: Record<string, string>
}

type Part = { readonly text: string } | { readonly placeholder: PlaceholderName }

function isListName(name: PlaceholderName): name is ListName {
  return (LIST_PLACEHOLDERS as readonly string[]).includes(name)
}

function isKnownName(name: string): name is PlaceholderName {
  return (
    (LIST_PLACEHOLDERS as readonly string[]).includes(name) ||
    (SCALAR_PLACEHOLDERS as readonly string[]).includes(name)
  )
}

function readPlaceholder(source: string, start: number): { name: PlaceholderName; end: number } {
  const close = source.indexOf('}', start)
  const inner = source.slice(start + 1, close)
  if (close < 0 || inner.includes('{')) {
    throw new HookExpansionError(`Unbalanced "{" in "${source}"`)
  }
  if (!isKnownName(inner)) throw new HookExpansionError(`Unknown placeholder {${inner}}`)
  return { name: inner, end: close + 1 }
}

/** Splits a template string into literal text and placeholders. */
export function parseTemplateString(source: string): Part[] {
  const parts: Part[] = []
  let text = ''
  let i = 0
  while (i < source.length) {
    const ch = source.charAt(i)
    const next = source.charAt(i + 1)
    if ((ch === '{' || ch === '}') && next === ch) {
      text += ch
      i += 2
    } else if (ch === '}') {
      throw new HookExpansionError(`Unbalanced "}" in "${source}"`)
    } else if (ch === '{') {
      const { name, end } = readPlaceholder(source, i)
      if (text.length > 0) parts.push({ text })
      text = ''
      parts.push({ placeholder: name })
      i = end
    } else {
      text += ch
      i += 1
    }
  }
  if (text.length > 0) parts.push({ text })
  return parts
}

function valueOf(context: HookContext, name: PlaceholderName): string | string[] {
  const value = context[name]
  if (value === undefined || (Array.isArray(value) && value.length === 0)) {
    throw new HookExpansionError(`Placeholder {${name}} has no value in this context`)
  }
  return value
}

function scalarOf(context: HookContext, name: PlaceholderName): string {
  const value = valueOf(context, name)
  return Array.isArray(value) ? value.join('\n') : value
}

/** Expands one `args` entry into one or more argv entries. */
export function expandArg(entry: string, context: HookContext): string[] {
  const parts = parseTemplateString(entry)
  const listNames = parts.flatMap((p) => ('placeholder' in p && isListName(p.placeholder) ? [p.placeholder] : []))
  if (listNames.length > 1) {
    throw new HookExpansionError(`Only one list placeholder per argument: "${entry}"`)
  }
  const render = (listValue: string): string =>
    parts
      .map((p) => {
        if ('text' in p) return p.text
        return isListName(p.placeholder) ? listValue : scalarOf(context, p.placeholder)
      })
      .join('')
  const listName = listNames[0]
  if (listName === undefined) return [render('')]
  const values = valueOf(context, listName)
  return (Array.isArray(values) ? values : [values]).map((v) => render(v))
}

/** Expands text for `env` / `cwd`: list values are joined with a newline. */
export function expandText(source: string, context: HookContext): string {
  return parseTemplateString(source)
    .map((p) => ('text' in p ? p.text : scalarOf(context, p.placeholder)))
    .join('')
}

/** Expands a whole template. Throws `HookExpansionError`. */
export function expandTemplate(template: CommandTemplate, context: HookContext): ExpandedCommand {
  const args = template.args.flatMap((entry) => expandArg(entry, context))
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(template.env ?? {})) env[key] = expandText(value, context)
  const cwd =
    template.cwd === undefined || template.cwd.length === 0 ? null : expandText(template.cwd, context)
  return { command: template.command, args, cwd, env }
}
