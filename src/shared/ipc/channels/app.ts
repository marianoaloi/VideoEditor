/**
 * App-level channels: native dialogs, Explorer integration, window flags, app info.
 * Owner (wave 2): svc-files.
 */
import { z } from 'zod';
import { defineInvoke, type InvokeMapOf } from '../define';
import { AbsPathSchema, EmptyRequestSchema } from '../../domain/common';

export const OpenDirectoryDialogRequestSchema = z
  .object({
    title: z.string().max(200).optional(),
    defaultPath: AbsPathSchema.optional()
  })
  .prefault({});
export type OpenDirectoryDialogRequest = z.input<typeof OpenDirectoryDialogRequestSchema>;

export interface OpenDirectoryDialogResult {
  canceled: boolean;
  path: string | null;
}

export const FileFilterSchema = z.object({
  name: z.string().min(1).max(100),
  extensions: z.array(z.string().regex(/^(\*|[A-Za-z0-9]+)$/)).min(1).max(100)
});

export const OpenFilesDialogRequestSchema = z
  .object({
    title: z.string().max(200).optional(),
    defaultPath: AbsPathSchema.optional(),
    multi: z.boolean().default(true),
    filters: z.array(FileFilterSchema).max(20).optional()
  })
  .prefault({});
export type OpenFilesDialogRequest = z.input<typeof OpenFilesDialogRequestSchema>;

export interface OpenFilesDialogResult {
  canceled: boolean;
  paths: string[];
}

export const PathRequestSchema = z.object({ path: AbsPathSchema });
export type PathRequest = z.input<typeof PathRequestSchema>;

export const SetAlwaysOnTopRequestSchema = z.object({ value: z.boolean() });
export type SetAlwaysOnTopRequest = z.input<typeof SetAlwaysOnTopRequestSchema>;

export interface AppInfo {
  version: string;
  platform: string;
  arch: string;
  userDataDir: string;
  tempDir: string;
  versions: { electron: string; chrome: string; node: string };
}

export const appInvoke = {
  'app:openDirectoryDialog': defineInvoke(OpenDirectoryDialogRequestSchema).returns<OpenDirectoryDialogResult>(),
  'app:openFilesDialog': defineInvoke(OpenFilesDialogRequestSchema).returns<OpenFilesDialogResult>(),
  /** Select the file in Explorer (`shell.showItemInFolder`). */
  'app:revealInFolder': defineInvoke(PathRequestSchema).returns<void>(),
  /** Open a FOLDER in Explorer (`shell.openPath`). Files are refused: that would run them. */
  'app:openFolder': defineInvoke(PathRequestSchema).returns<void>(),
  'app:setAlwaysOnTop': defineInvoke(SetAlwaysOnTopRequestSchema).returns<void>(),
  'app:info': defineInvoke(EmptyRequestSchema).returns<AppInfo>()
} as const;

export type AppInvoke = InvokeMapOf<typeof appInvoke>;

/** No app events yet. */
export type AppEvents = Record<never, never>;
