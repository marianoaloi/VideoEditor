/**
 * Folder sessions (F1). A session is an opened root: it lists the media files, it is the scope of
 * file operations and the journal, and its root is added to the `media://` allowlist.
 * Owner (wave 2): svc-files.
 */
import { z } from 'zod';
import { AbsPathSchema, IdSchema, NonNegIntSchema, TimestampMsSchema } from './common';
import { MediaKindSchema } from './media';

/**
 * Which files a session lists (legacy ValidateFile):
 * - `video` → video files (`.3gp` always counts as video);
 * - `image` → images **including GIFs** (legacy `validateFileIMG` matches `image/gif`);
 * - `gif`   → GIFs only;
 * - `any`   → all three kinds.
 */
export const SessionKindFilterSchema = z.enum(['video', 'image', 'gif', 'any']);
export type SessionKindFilter = z.infer<typeof SessionKindFilterSchema>;

/** `size-desc` is the legacy order (largest first, ties by name). */
export const SessionSortSchema = z.enum(['size-desc', 'name']);
export type SessionSort = z.infer<typeof SessionSortSchema>;

export const OpenFolderRequestSchema = z.object({
  dir: AbsPathSchema,
  recursive: z.boolean().default(false),
  kind: SessionKindFilterSchema,
  sort: SessionSortSchema.default('size-desc'),
  /** Echoed in `session:scanProgress`, so the caller can match events before the result arrives. */
  requestId: z.string().min(1).max(100).optional()
});
export type OpenFolderRequest = z.input<typeof OpenFolderRequestSchema>;

export const SessionItemSchema = z.object({
  /** Stable for the life of the session, even after the file moves. */
  id: IdSchema,
  /** Absolute path at scan time. Moves return the new path; the session list itself is immutable. */
  path: AbsPathSchema,
  /** Folder relative to the root (`path.relative`, OS separators); `''` for files in the root. */
  relDir: z.string(),
  name: z.string().min(1),
  sizeBytes: NonNegIntSchema,
  mtimeMs: z.number().nonnegative(),
  kind: MediaKindSchema
});
export type SessionItem = z.infer<typeof SessionItemSchema>;

export const SessionSchema = z.object({
  id: IdSchema,
  root: AbsPathSchema,
  recursive: z.boolean(),
  kind: SessionKindFilterSchema,
  sort: SessionSortSchema,
  items: z.array(SessionItemSchema),
  openedAt: TimestampMsSchema,
  /** Folders the scan skipped (ADR-006: destination folders, `.mediamaloi/`, the thumb cache). */
  skippedDirs: z.array(z.string())
});
export type Session = z.infer<typeof SessionSchema>;

export const SessionRefSchema = z.object({ sessionId: IdSchema });
export type SessionRef = z.input<typeof SessionRefSchema>;

/** Event `session:scanProgress`, throttled by main (at most ~10/s plus the final `done`). */
export const ScanProgressSchema = z.object({
  requestId: z.string().optional(),
  root: AbsPathSchema,
  scanned: NonNegIntSchema,
  matched: NonNegIntSchema,
  done: z.boolean()
});
export type ScanProgress = z.infer<typeof ScanProgressSchema>;
