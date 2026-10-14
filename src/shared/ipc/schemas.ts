/**
 * Request schemas of every invoke channel, for main's `handle()` (zod at runtime).
 * Do not import this from the preload: use `contract.ts` there.
 * Owner: frozen (lead).
 */
import type { z } from 'zod';
import type { InvokeChannel } from './contract';
import type { InvokeDef } from './define';
import { appInvoke } from './channels/app';
import { fileopsInvoke } from './channels/fileops';
import { hashingInvoke } from './channels/hashing';
import { hooksInvoke } from './channels/hooks';
import { jobsInvoke } from './channels/jobs';
import { mediaInvoke } from './channels/media';
import { sessionInvoke } from './channels/session';
import { settingsInvoke } from './channels/settings';

export const invokeDefs = {
  ...sessionInvoke,
  ...fileopsInvoke,
  ...settingsInvoke,
  ...hooksInvoke,
  ...appInvoke,
  ...mediaInvoke,
  ...jobsInvoke,
  ...hashingInvoke
} as const satisfies Record<InvokeChannel, InvokeDef>;

/** The zod schema that validates `channel`'s request. */
export function requestSchemaFor(channel: InvokeChannel): z.ZodType {
  const def: InvokeDef = invokeDefs[channel];
  return def.req;
}
