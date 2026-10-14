/**
 * Settings persistence: `<userData>/settings.json`, tolerant load (`parseStoredSettings`), atomic
 * save (temp file + rename), writes serialised. A file that is not valid JSON is moved aside
 * (`settings.broken-<ts>.json`) and the defaults are used.
 */
import { readFileSync, renameSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseStoredSettings, type Settings } from '@shared/domain/settings'

export const SETTINGS_FILE_NAME = 'settings.json'

export interface LoadedSettings {
  readonly settings: Settings
  readonly warnings: string[]
}

export function settingsFilePath(userDataDir: string): string {
  return path.join(userDataDir, SETTINGS_FILE_NAME)
}

function readRaw(file: string): { raw: unknown; warnings: string[] } | 'missing' {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (Reflect.get(error as object, 'code') === 'ENOENT') return 'missing'
    return { raw: {}, warnings: [`Could not read ${file}: ${String(error)}`] }
  }
  try {
    return { raw: JSON.parse(text) as unknown, warnings: [] }
  } catch (error) {
    const aside = path.join(path.dirname(file), `settings.broken-${Date.now()}.json`)
    renameSync(file, aside)
    return { raw: {}, warnings: [`Settings file is not valid JSON (${String(error)}); moved to ${aside}`] }
  }
}

/** Synchronous load at startup (everything else reads settings lazily). */
export function loadSettings(file: string): LoadedSettings {
  const read = readRaw(file)
  if (read === 'missing') return parseStoredSettings({})
  const parsed = parseStoredSettings(read.raw)
  return { settings: parsed.settings, warnings: [...read.warnings, ...parsed.warnings] }
}

export interface SettingsWriter {
  save(settings: Settings): Promise<void>
}

/** Serialised atomic writer: concurrent `save` calls are applied in order. */
export function createSettingsWriter(file: string): SettingsWriter {
  let chain: Promise<void> = Promise.resolve()
  const write = async (settings: Settings): Promise<void> => {
    await mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    await writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
    await rename(tmp, file)
  }
  return {
    save(settings) {
      const next = chain.then(() => write(settings))
      chain = next.catch(() => undefined)
      return next
    }
  }
}
