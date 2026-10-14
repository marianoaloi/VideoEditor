/**
 * The IPC contract (ADR-003): merged channel maps, the runtime allowlists and the bridge type.
 *
 * This module has NO runtime dependency on zod: it imports the per-domain maps as types and the
 * channel names from the zod-free `channels/*.names.ts`. The sandboxed preload bundles it.
 * The request schemas (zod) are merged separately in `schemas.ts`, which only main imports.
 *
 * Owner: frozen (lead). Domains add channels in their own `channels/<domain>.ts` + `.names.ts`.
 */
import type { IpcResult } from '../domain/errors';
import type { AppEvents, AppInvoke } from './channels/app';
import type { FileopsEvents, FileopsInvoke } from './channels/fileops';
import type { HashingEvents, HashingInvoke } from './channels/hashing';
import type { HooksEvents, HooksInvoke } from './channels/hooks';
import type { JobsEvents, JobsInvoke } from './channels/jobs';
import type { MediaEvents, MediaInvoke } from './channels/media';
import type { SessionEvents, SessionInvoke } from './channels/session';
import type { SettingsEvents, SettingsInvoke } from './channels/settings';
import { APP_EVENT_CHANNELS, APP_INVOKE_CHANNELS } from './channels/app.names';
import { FILEOPS_EVENT_CHANNELS, FILEOPS_INVOKE_CHANNELS } from './channels/fileops.names';
import { HASHING_EVENT_CHANNELS, HASHING_INVOKE_CHANNELS } from './channels/hashing.names';
import { HOOKS_EVENT_CHANNELS, HOOKS_INVOKE_CHANNELS } from './channels/hooks.names';
import { JOBS_EVENT_CHANNELS, JOBS_INVOKE_CHANNELS } from './channels/jobs.names';
import { MEDIA_EVENT_CHANNELS, MEDIA_INVOKE_CHANNELS } from './channels/media.names';
import { SESSION_EVENT_CHANNELS, SESSION_INVOKE_CHANNELS } from './channels/session.names';
import { SETTINGS_EVENT_CHANNELS, SETTINGS_INVOKE_CHANNELS } from './channels/settings.names';

export type { IpcResult };

export type InvokeMap = SessionInvoke &
  FileopsInvoke &
  SettingsInvoke &
  HooksInvoke &
  AppInvoke &
  MediaInvoke &
  JobsInvoke &
  HashingInvoke;

export type EventMap = SessionEvents &
  FileopsEvents &
  SettingsEvents &
  HooksEvents &
  AppEvents &
  MediaEvents &
  JobsEvents &
  HashingEvents;

export type InvokeChannel = keyof InvokeMap & string;
export type EventChannel = keyof EventMap & string;

/** What the renderer sends (zod input: defaults may be omitted). */
export type InvokeRequest<C extends InvokeChannel> = InvokeMap[C]['req'];
/** What the main handler receives (zod output: defaults applied). */
export type InvokeParsedRequest<C extends InvokeChannel> = InvokeMap[C]['parsed'];
export type InvokeResponse<C extends InvokeChannel> = InvokeMap[C]['res'];
export type EventPayload<C extends EventChannel> = EventMap[C];

export const INVOKE_CHANNELS: readonly InvokeChannel[] = [
  ...SESSION_INVOKE_CHANNELS,
  ...FILEOPS_INVOKE_CHANNELS,
  ...SETTINGS_INVOKE_CHANNELS,
  ...HOOKS_INVOKE_CHANNELS,
  ...APP_INVOKE_CHANNELS,
  ...MEDIA_INVOKE_CHANNELS,
  ...JOBS_INVOKE_CHANNELS,
  ...HASHING_INVOKE_CHANNELS
];

export const EVENT_CHANNELS: readonly EventChannel[] = [
  ...SESSION_EVENT_CHANNELS,
  ...FILEOPS_EVENT_CHANNELS,
  ...SETTINGS_EVENT_CHANNELS,
  ...HOOKS_EVENT_CHANNELS,
  ...APP_EVENT_CHANNELS,
  ...MEDIA_EVENT_CHANNELS,
  ...JOBS_EVENT_CHANNELS,
  ...HASHING_EVENT_CHANNELS
];

/**
 * `window.api` (preload `createBridge()`).
 * - `invoke` always resolves with the envelope; `app/api.ts` unwraps it into a thrown `ApiError`.
 * - `on` returns an unsubscribe function; listeners receive only the payload, never the event.
 * - `getPathForFile` is `webUtils.getPathForFile` for drag and drop (ADR-003).
 */
export interface RendererApi {
  invoke<C extends InvokeChannel>(
    channel: C,
    request: InvokeRequest<C>
  ): Promise<IpcResult<InvokeResponse<C>>>;
  on<C extends EventChannel>(channel: C, listener: (payload: EventPayload<C>) => void): () => void;
  getPathForFile(file: File): string;
}
