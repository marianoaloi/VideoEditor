/** Runtime channel names for `fileops.ts` (zod-free: the preload bundles this file). */
import { channelNames } from '../define';
import type { FileopsEvents, FileopsInvoke } from './fileops';

export const FILEOPS_INVOKE_CHANNELS = channelNames<keyof FileopsInvoke & string>()([
  'fileops:move',
  'fileops:moveMany',
  'fileops:undo',
  'fileops:trash',
  'fileops:copyToPersonal',
  'fileops:resetFolder',
  'fileops:journal'
]);

export const FILEOPS_EVENT_CHANNELS = channelNames<keyof FileopsEvents & string>()([
  'fileops:changed'
]);
