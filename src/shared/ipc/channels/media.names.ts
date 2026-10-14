/** Runtime channel names for `media.ts` (zod-free: the preload bundles this file). */
import { channelNames } from '../define';
import type { MediaEvents, MediaInvoke } from './media';

export const MEDIA_INVOKE_CHANNELS = channelNames<keyof MediaInvoke & string>()([
  'media:probe',
  'media:probeMany',
  'media:grabFrame',
  'media:mosaic',
  'media:prefetch',
  'media:generateMosaics',
  'media:cancelTask',
  'media:detectBlackBars',
  'media:imageEdit',
  'media:imageRotate',
  'media:imageRestoreBackup'
]);

export const MEDIA_EVENT_CHANNELS = channelNames<keyof MediaEvents & string>()([
  'media:mosaicProgress'
]);
