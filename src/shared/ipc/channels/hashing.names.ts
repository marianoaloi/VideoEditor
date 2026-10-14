/** Runtime channel names for `hashing.ts` (zod-free: the preload bundles this file). */
import { channelNames } from '../define';
import type { HashingEvents, HashingInvoke } from './hashing';

export const HASHING_INVOKE_CHANNELS = channelNames<keyof HashingInvoke & string>()([
  'hashing:build',
  'hashing:rebuild',
  'hashing:load',
  'hashing:save',
  'hashing:concat',
  'hashing:clean',
  'hashing:csvPath',
  'hashing:cancel'
]);

export const HASHING_EVENT_CHANNELS = channelNames<keyof HashingEvents & string>()([
  'hashing:progress'
]);
