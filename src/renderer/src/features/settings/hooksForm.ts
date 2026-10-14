/** Text <-> structure conversions for the hooks editor, plus the sample context of the "Test" button. */
import { HOOK_META, type HookContext, type HookName } from '@shared/domain/hooks'

export function argsToText(args: readonly string[]): string {
  return args.join('\n')
}

/** One argv entry per non-empty line. */
export function textToArgs(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.trim() !== '')
}

export function envToText(env: Readonly<Record<string, string>> | undefined): string {
  return Object.entries(env ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

/** `KEY=value` per line (split at the first `=`); `undefined` when empty so the key is omitted. */
export function textToEnv(text: string): Record<string, string> | undefined {
  const env: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const at = trimmed.indexOf('=')
    if (at < 0) env[trimmed] = ''
    else env[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1)
  }
  return Object.keys(env).length === 0 ? undefined : env
}

/** Windows refuses to spawn these with `shell:false`. */
export function isBatchScript(command: string): boolean {
  return /\.(cmd|bat)$/i.test(command.trim())
}

const SAMPLE: Required<HookContext> = {
  file: 'C:\\Videos\\sample.mp4',
  files: ['C:\\Videos\\one.mp4', 'C:\\Videos\\two.mp4'],
  dir: 'C:\\Videos\\L',
  root: 'C:\\Videos',
  md5: '0123456789abcdef0123456789abcdef',
  outputs: ['C:\\Videos\\sample.0.mp4', 'C:\\Videos\\sample.1.mp4']
}

/** Sample values for exactly the placeholders this hook receives at run time. */
export function sampleContext(name: HookName): HookContext {
  const context: Record<string, unknown> = {}
  for (const token of HOOK_META[name].provides) {
    const key = token.slice(1, -1) as keyof HookContext
    context[key] = SAMPLE[key]
  }
  return context as HookContext
}
