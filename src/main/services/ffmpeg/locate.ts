/**
 * Finds ffmpeg / ffprobe (ADR-005): the path from Settings first, then a PATH walk (with PATHEXT
 * on Windows). Results are cached per tool, configured path and PATH value; `clearToolCache()`
 * forces a new lookup (the Settings screen "refresh" button).
 *
 * `.cmd` / `.bat` shims are skipped on purpose: they cannot be started with `shell: false`.
 */
import { statSync } from 'node:fs'
import path from 'node:path'
import { AppError } from '../../ipc/errors'

export type ToolName = 'ffmpeg' | 'ffprobe'

export interface LocatedTool {
  readonly name: ToolName
  readonly path: string
  readonly source: 'settings' | 'path' | 'sibling'
  /** Set when a configured path was ignored (missing file) and PATH was used instead. */
  readonly warning?: string
}

export interface LocateOptions {
  /** `settings.ffmpeg.ffmpegPath` / `ffprobePath`; `null` means "look on PATH". */
  readonly configuredPath?: string | null
  readonly env?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  /** Injectable for tests. */
  readonly isFile?: (candidate: string) => boolean
  /** Bypass the cache. */
  readonly noCache?: boolean
}

function defaultIsFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile()
  } catch {
    return false
  }
}

function envValue(env: NodeJS.ProcessEnv, key: string, platform: NodeJS.Platform): string {
  if (platform !== 'win32') return env[key] ?? ''
  const actual = Object.keys(env).find((k) => k.toUpperCase() === key.toUpperCase())
  return actual === undefined ? '' : (env[actual] ?? '')
}

function executableExtensions(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  if (platform !== 'win32') return ['']
  const raw = envValue(env, 'PATHEXT', platform) || '.COM;.EXE;.BAT;.CMD'
  const exts = raw
    .split(';')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0)
    .filter((e) => !/^\.(cmd|bat)$/i.test(e))
  // Always try the bare name too: the user may have typed "ffmpeg.exe".
  return ['', ...(exts.length > 0 ? exts : ['.exe'])]
}

/** Pure PATH walk. Returns the first match or `null`. */
export function findOnPath(
  command: string,
  options: Pick<LocateOptions, 'env' | 'platform' | 'isFile'> = {}
): string | null {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const isFile = options.isFile ?? defaultIsFile
  const lib = platform === 'win32' ? path.win32 : path.posix
  const dirs = envValue(env, 'PATH', platform)
    .split(lib.delimiter)
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1'))
    .filter((d) => d.length > 0)
  const exts = executableExtensions(env, platform)
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = lib.join(dir, command + ext)
      if (isFile(candidate)) return candidate
    }
  }
  return null
}

const cache = new Map<string, LocatedTool | null>()

export function clearToolCache(): void {
  cache.clear()
}

/** Locates one tool. `null` when neither Settings nor PATH has it. */
export function locateTool(name: ToolName, options: LocateOptions = {}): LocatedTool | null {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const isFile = options.isFile ?? defaultIsFile
  const configured = options.configuredPath ?? null
  const key = `${name}|${configured ?? ''}|${envValue(env, 'PATH', platform)}`
  if (options.noCache !== true && cache.has(key)) return cache.get(key) ?? null

  let result: LocatedTool | null = null
  let warning: string | undefined
  if (configured !== null && configured.length > 0) {
    if (isFile(configured)) {
      result = { name, path: configured, source: 'settings' }
    } else {
      warning = `Configured ${name} path does not exist: ${configured}`
    }
  }
  if (result === null) {
    const found = findOnPath(name, { env, platform, isFile })
    if (found !== null) {
      result =
        warning === undefined
          ? { name, path: found, source: 'path' }
          : { name, path: found, source: 'path', warning }
    }
  }
  if (options.noCache !== true) cache.set(key, result)
  return result
}

export interface FfmpegToolsConfig {
  readonly ffmpegPath: string | null
  readonly ffprobePath: string | null
}

export interface LocatedTools {
  readonly ffmpeg: LocatedTool | null
  readonly ffprobe: LocatedTool | null
}

/**
 * Both tools. When ffprobe is not configured nor on PATH, a `ffprobe` next to the located ffmpeg
 * is used (typical for a downloaded build that is not on PATH).
 */
export function locateTools(config: FfmpegToolsConfig, options: LocateOptions = {}): LocatedTools {
  const ffmpeg = locateTool('ffmpeg', { ...options, configuredPath: config.ffmpegPath })
  let ffprobe = locateTool('ffprobe', { ...options, configuredPath: config.ffprobePath })
  if (ffprobe === null && ffmpeg !== null) {
    const platform = options.platform ?? process.platform
    const lib = platform === 'win32' ? path.win32 : path.posix
    const isFile = options.isFile ?? defaultIsFile
    const dir = lib.dirname(ffmpeg.path)
    for (const ext of platform === 'win32' ? ['.exe', ''] : ['']) {
      const candidate = lib.join(dir, `ffprobe${ext}`)
      if (isFile(candidate)) {
        ffprobe = { name: 'ffprobe', path: candidate, source: 'sibling' }
        break
      }
    }
  }
  return { ffmpeg, ffprobe }
}

/** Like `locateTool` but throws `FFMPEG_NOT_FOUND` (with a hint for the Settings screen). */
export function requireTool(
  name: ToolName,
  config: FfmpegToolsConfig,
  options: LocateOptions = {}
): LocatedTool {
  const tools = locateTools(config, options)
  const tool = name === 'ffmpeg' ? tools.ffmpeg : tools.ffprobe
  if (tool === null) {
    throw new AppError(
      'FFMPEG_NOT_FOUND',
      `${name} was not found. Set its path in Settings or add it to PATH.`,
      { tool: name, setting: name === 'ffmpeg' ? 'ffmpeg.ffmpegPath' : 'ffmpeg.ffprobePath' }
    )
  }
  return tool
}
