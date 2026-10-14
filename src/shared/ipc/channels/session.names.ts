/** Runtime channel names for `session.ts` (zod-free: the preload bundles this file). */
import { channelNames } from '../define';
import type { SessionEvents, SessionInvoke } from './session';

export const SESSION_INVOKE_CHANNELS = channelNames<keyof SessionInvoke & string>()([
  'session:open',
  'session:rescan',
  'session:close'
]);

export const SESSION_EVENT_CHANNELS = channelNames<keyof SessionEvents & string>()([
  'session:scanProgress'
]);
