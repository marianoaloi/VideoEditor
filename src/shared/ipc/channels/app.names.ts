/** Runtime channel names for `app.ts` (zod-free: the preload bundles this file). */
import { channelNames } from '../define';
import type { AppEvents, AppInvoke } from './app';

export const APP_INVOKE_CHANNELS = channelNames<keyof AppInvoke & string>()([
  'app:openDirectoryDialog',
  'app:openFilesDialog',
  'app:revealInFolder',
  'app:openFolder',
  'app:setAlwaysOnTop',
  'app:info'
]);

export const APP_EVENT_CHANNELS = channelNames<keyof AppEvents & string>()([]);
