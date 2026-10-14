/** Runtime channel names for `settings.ts` (zod-free: the preload bundles this file). */
import { channelNames } from '../define';
import type { SettingsEvents, SettingsInvoke } from './settings';

export const SETTINGS_INVOKE_CHANNELS = channelNames<keyof SettingsInvoke & string>()([
  'settings:get',
  'settings:update',
  'settings:reset'
]);

export const SETTINGS_EVENT_CHANNELS = channelNames<keyof SettingsEvents & string>()([
  'settings:changed'
]);
