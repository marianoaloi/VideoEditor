/**
 * Hook command resolution (review M9): a bare command name is looked up on PATH ONLY, never in
 * the hook's working directory (Windows' `CreateProcess` searches the cwd first), and the program
 * is started by absolute path. Also detects shells, which would put file names into a command line.
 */
import { statSync } from 'node:fs'
import path from 'node:path'

const SHELLS = new Set(['cmd', 'powershell', 'pwsh', 'sh', 'bash', 'zsh'])
const BATCH = /\.(cmd|bat)$/i
const DEFAULT_PATHEXT = '.COM;.EXE'

function isFile(candidate: string): boolean {
  return statSync(candidate, { throwIfNoEntry: false })?.isFile() === true
}

/** Lower-case program name without a Windows executable extension. */
export function programName(command: string): string {
  return path.basename(command.replace(/\\/g, '/')).toLowerCase().replace(/\.(exe|com|cmd|bat)$/, '')
}

export function isShellCommand(command: string): boolean {
  return SHELLS.has(programName(command))
}

export function isBatchFile(command: string): boolean {
  return BATCH.test(command)
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase())
  return key === undefined ? undefined : env[key]
}

function candidatesIn(dir: string, command: string, extensions: readonly string[]): string[] {
  const base = path.join(dir, command)
  if (extensions.length === 0 || path.extname(command) !== '') return [base]
  return [...extensions.map((ext) => base + ext), base]
}

/**
 * Absolute path of `command`, or `null` when it cannot be found. A command with a directory part
 * must itself be absolute (relative ones depend on the cwd and are refused: `null`).
 */
export function resolveCommandPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string | null {
  const native = platform === 'win32' ? path.win32 : path.posix
  if (command.length === 0 || command.includes('\0')) return null
  if (/[\\/]/.test(command)) return native.isAbsolute(command) && isFile(command) ? command : null
  const dirs = (envValue(env, 'PATH') ?? '').split(native.delimiter).filter((d) => d.length > 0 && d !== '.')
  const extensions =
    platform === 'win32'
      ? (envValue(env, 'PATHEXT') ?? DEFAULT_PATHEXT).split(';').filter((e) => e.length > 0)
      : []
  for (const dir of dirs) {
    if (!native.isAbsolute(dir)) continue
    const found = candidatesIn(dir, command, extensions).find(isFile)
    if (found !== undefined) return found
  }
  return null
}

/** Human hints for Settings (`hooks:preview`). */
export function commandWarnings(command: string, resolved: string | null): string[] {
  const warnings: string[] = []
  if (isShellCommand(command)) {
    warnings.push(
      `"${command}" is a shell: file names would be interpreted by it. Prefer a real program and pass files as separate arguments.`
    )
  }
  if (isBatchFile(command)) {
    warnings.push('.cmd/.bat files need a shell; point the hook at an .exe or a wrapper instead.')
  }
  if (resolved === null && command.length > 0) {
    warnings.push(
      /[\\/]/.test(command)
        ? 'The command is not an existing absolute file path.'
        : `"${command}" was not found on PATH (the working directory is never searched).`
    )
  }
  return warnings
}
