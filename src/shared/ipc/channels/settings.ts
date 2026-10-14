/** Settings channels. Owner (wave 2): svc-files. */
import { z } from 'zod';
import { defineInvoke, type InvokeMapOf } from '../define';
import { EmptyRequestSchema } from '../../domain/common';
import {
  isPlainObject,
  SettingsSectionSchema,
  type Settings,
  type SettingsPatch
} from '../../domain/settings';

/** Deep-partial patch; main merges it over the current settings and validates the result. */
export const UpdateSettingsRequestSchema = z.object({
  patch: z.custom<SettingsPatch>(isPlainObject, 'Expected a settings patch object')
});
export type UpdateSettingsRequest = z.input<typeof UpdateSettingsRequestSchema>;

/** Reset one section, or everything when `section` is omitted. */
export const ResetSettingsRequestSchema = z
  .object({ section: SettingsSectionSchema.optional() })
  .prefault({});
export type ResetSettingsRequest = z.input<typeof ResetSettingsRequestSchema>;

export const settingsInvoke = {
  'settings:get': defineInvoke(EmptyRequestSchema).returns<Settings>(),
  /** VALIDATION when the merged result is invalid; nothing is saved then. */
  'settings:update': defineInvoke(UpdateSettingsRequestSchema).returns<Settings>(),
  'settings:reset': defineInvoke(ResetSettingsRequestSchema).returns<Settings>()
} as const;

export type SettingsInvoke = InvokeMapOf<typeof settingsInvoke>;

export interface SettingsEvents {
  /** After every successful update or reset (also for changes made by main). */
  'settings:changed': Settings;
}
