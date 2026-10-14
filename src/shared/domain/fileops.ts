/**
 * File operations and the operation journal (ADR-006).
 * Owner (wave 2): svc-files.
 */
import { z } from 'zod';
import { AbsPathSchema, FolderNameSchema, IdSchema, TimestampMsSchema } from './common';
import { IpcErrorSchema } from './errors';
import { SessionItemSchema } from './session';

/** Well-known destinations, resolved through `settings.folders`. */
export const DestinationRoleSchema = z.enum(['left', 'right', 'custom', 'purge', 'ruim']);
export type DestinationRole = z.infer<typeof DestinationRoleSchema>;

/**
 * Where a move goes, always a folder directly under the session root.
 * `folder` covers the editable image-triage names and the typed duplicates folder.
 */
export const DestinationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('role'), role: DestinationRoleSchema }),
  z.object({ type: z.literal('folder'), name: FolderNameSchema })
]);
export type Destination = z.infer<typeof DestinationSchema>;

export const JournalOpSchema = z.enum(['move', 'copy', 'trash', 'write', 'undo']);
export type JournalOp = z.infer<typeof JournalOpSchema>;

export const SidecarMoveSchema = z.object({ from: AbsPathSchema, to: AbsPathSchema });
export type SidecarMove = z.infer<typeof SidecarMoveSchema>;

/**
 * One line of `<root>/.mediamaloi/journal.jsonl`. ADR-006 fields plus:
 * `undoable` (false for trash and for entries already undone), `undoOf` (on `undo` entries) and
 * `backup` (ADR-006; on `write` entries: the `bkp/` copy taken before an in-place edit).
 */
export const JournalEntrySchema = z.object({
  id: IdSchema,
  ts: TimestampMsSchema,
  op: JournalOpSchema,
  from: AbsPathSchema,
  /** `null` for `trash`. Equal to `from` for `write`. */
  to: AbsPathSchema.nullable(),
  sidecars: z.array(SidecarMoveSchema),
  sessionId: IdSchema.nullable(),
  undoable: z.boolean(),
  undoOf: IdSchema.optional(),
  backup: AbsPathSchema.optional()
});
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

// ---- requests / results -------------------------------------------------------------------

export const MoveRequestSchema = z.object({
  sessionId: IdSchema,
  path: AbsPathSchema,
  destination: DestinationSchema
});
export type MoveRequest = z.input<typeof MoveRequestSchema>;

export const MoveResultSchema = z.object({
  entry: JournalEntrySchema,
  newPath: AbsPathSchema
});
export type MoveResult = z.infer<typeof MoveResultSchema>;

export const MoveManyRequestSchema = z.object({
  sessionId: IdSchema,
  paths: z.array(AbsPathSchema).min(1).max(100000),
  destination: DestinationSchema
});
export type MoveManyRequest = z.input<typeof MoveManyRequestSchema>;

export const FailedPathSchema = z.object({ path: AbsPathSchema, error: IpcErrorSchema });
export type FailedPath = z.infer<typeof FailedPathSchema>;

export const MoveManyResultSchema = z.object({
  moved: z.array(MoveResultSchema),
  failed: z.array(FailedPathSchema)
});
export type MoveManyResult = z.infer<typeof MoveManyResultSchema>;

/** Undo `entryId`, or the latest undoable entry of the session's root when omitted. */
export const UndoRequestSchema = z.object({
  sessionId: IdSchema,
  entryId: IdSchema.optional()
});
export type UndoRequest = z.input<typeof UndoRequestSchema>;

export const UndoResultSchema = z.object({
  undone: JournalEntrySchema,
  compensating: JournalEntrySchema,
  restoredPath: AbsPathSchema,
  /**
   * The restored file as a session item (fresh size/mtime) when it belongs to the session's root
   * and kind filter. The renderer re-inserts it when the decision stack was empty (ADR-006).
   */
  item: SessionItemSchema.nullable()
});
export type UndoResult = z.infer<typeof UndoResultSchema>;

/** Which entry `fileops:undo` would reverse without `entryId` (null: nothing to undo). */
export const PeekUndoRequestSchema = z.object({ sessionId: IdSchema });
export type PeekUndoRequest = z.input<typeof PeekUndoRequestSchema>;

/** Shift+Del: `shell.trashItem` on the file and its sidecars. Not undoable. */
export const TrashRequestSchema = z.object({ sessionId: IdSchema, path: AbsPathSchema });
export type TrashRequest = z.input<typeof TrashRequestSchema>;
export const TrashResultSchema = z.object({ entry: JournalEntrySchema });
export type TrashResult = z.infer<typeof TrashResultSchema>;

/** `P`: copy (never move) into `settings.folders.personal`. `NOT_CONFIGURED` until it is set. */
export const CopyToPersonalRequestSchema = z.object({ sessionId: IdSchema, path: AbsPathSchema });
export type CopyToPersonalRequest = z.input<typeof CopyToPersonalRequestSchema>;
export const CopyResultSchema = z.object({ entry: JournalEntrySchema, newPath: AbsPathSchema });
export type CopyResult = z.infer<typeof CopyResultSchema>;

/** Image triage "Reset L/R": move every file of `<root>/<folder>/` back to the root. */
export const ResetFolderRequestSchema = z.object({ sessionId: IdSchema, folder: FolderNameSchema });
export type ResetFolderRequest = z.input<typeof ResetFolderRequestSchema>;

/**
 * Image Triage `L` ("send") pre-clean (settings `imageTriage.sendPreclean`): trash the zero-byte
 * files and `*.log` files that sit directly in `<root>/<folder>`. Journaled as `trash`.
 */
export const PrecleanRequestSchema = z.object({ sessionId: IdSchema, folder: FolderNameSchema });
export type PrecleanRequest = z.input<typeof PrecleanRequestSchema>;
export const PrecleanResultSchema = z.object({ trashed: z.array(AbsPathSchema) });
export type PrecleanResult = z.infer<typeof PrecleanResultSchema>;

export const JournalListRequestSchema = z.object({
  sessionId: IdSchema,
  limit: z.number().int().min(1).max(5000).default(200)
});
export type JournalListRequest = z.input<typeof JournalListRequestSchema>;

/** Event `fileops:changed`: emitted after every journaled operation, for any workspace on `root`. */
export const FileopsChangedSchema = z.object({
  root: AbsPathSchema,
  sessionId: IdSchema.nullable(),
  entries: z.array(JournalEntrySchema)
});
export type FileopsChanged = z.infer<typeof FileopsChangedSchema>;
