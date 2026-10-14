/** Runtime channel names for `hooks.ts` (zod-free: the preload bundles this file). */
import { channelNames } from '../define';
import type { HooksEvents, HooksInvoke } from './hooks';

export const HOOKS_INVOKE_CHANNELS = channelNames<keyof HooksInvoke & string>()([
  'hooks:run',
  'hooks:preview'
]);

export const HOOKS_EVENT_CHANNELS = channelNames<keyof HooksEvents & string>()([
  'hooks:output',
  'hooks:exit'
]);
