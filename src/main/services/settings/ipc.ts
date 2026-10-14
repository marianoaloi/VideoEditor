/** Settings service: `settings:get|update|reset`, persisted in `<userData>/settings.json`. */
import {
  applySettingsPatch,
  DEFAULT_SETTINGS,
  SettingsSchema,
  type Settings,
  type SettingsSection
} from '@shared/domain/settings'
import type { MainContext } from '../../ipc/context'
import { handle } from '../../ipc/handle'
import {
  createSettingsWriter,
  loadSettings,
  settingsFilePath,
  type SettingsWriter
} from './store'

function resetSettings(current: Settings, section: SettingsSection | undefined): Settings {
  if (section === undefined) return DEFAULT_SETTINGS
  return SettingsSchema.parse({ ...current, [section]: DEFAULT_SETTINGS[section] })
}

export function registerSettingsIpc(ctx: MainContext): void {
  const file = settingsFilePath(ctx.paths.userData)
  const loaded = loadSettings(file)
  for (const warning of loaded.warnings) console.warn(`[settings] ${warning}`)
  ctx.settings.set(loaded.settings)
  const writer: SettingsWriter = createSettingsWriter(file)

  // Every change (including those made by main) reaches the renderer.
  ctx.settings.onChange((settings) => ctx.sendEvent('settings:changed', settings))

  const commit = async (next: Settings): Promise<Settings> => {
    await writer.save(next)
    ctx.settings.set(next)
    return next
  }

  handle('settings:get', () => ctx.settings.get())
  handle('settings:update', (req) => commit(applySettingsPatch(ctx.settings.get(), req.patch)))
  handle('settings:reset', (req) => commit(resetSettings(ctx.settings.get(), req.section)))
}
