/**
 * File-operation channels (ADR-006). Owner (wave 2): svc-files.
 * Every request names a session: main resolves its root, recursive flag and journal from it and
 * rejects paths outside the root (PATH_NOT_ALLOWED).
 */
import { defineInvoke, type InvokeMapOf } from '../define';
import {
  CopyToPersonalRequestSchema,
  JournalListRequestSchema,
  MoveManyRequestSchema,
  MoveRequestSchema,
  PeekUndoRequestSchema,
  PrecleanRequestSchema,
  ResetFolderRequestSchema,
  TrashRequestSchema,
  UndoRequestSchema,
  type CopyResult,
  type FileopsChanged,
  type JournalEntry,
  type MoveManyResult,
  type MoveResult,
  type PrecleanResult,
  type TrashResult,
  type UndoResult
} from '../../domain/fileops';

export {
  CopyToPersonalRequestSchema,
  JournalListRequestSchema,
  MoveManyRequestSchema,
  MoveRequestSchema,
  PeekUndoRequestSchema,
  PrecleanRequestSchema,
  ResetFolderRequestSchema,
  TrashRequestSchema,
  UndoRequestSchema
};

export const fileopsInvoke = {
  /** Collision-safe move (` (n)` suffix), sidecar `.json` follows, recursive prefix, journaled. */
  'fileops:move': defineInvoke(MoveRequestSchema).returns<MoveResult>(),
  /** Duplicates "Move to R" / ruim: each path independently; failures listed, others proceed. */
  'fileops:moveMany': defineInvoke(MoveManyRequestSchema).returns<MoveManyResult>(),
  /**
   * Reverse one entry: `entryId` (the triage decision stack pops these, ADR-006), or the latest
   * undoable entry of the session root when omitted (stack empty, e.g. after a restart).
   * NOTHING_TO_UNDO when there is none. The result carries the restored `item` when it can.
   */
  'fileops:undo': defineInvoke(UndoRequestSchema).returns<UndoResult>(),
  /** The entry `fileops:undo` would reverse (latest undoable of the root); null when none. */
  'fileops:peekUndo': defineInvoke(PeekUndoRequestSchema).returns<JournalEntry | null>(),
  /** Shift+Del. Not undoable. */
  'fileops:trash': defineInvoke(TrashRequestSchema).returns<TrashResult>(),
  /** `P`. NOT_CONFIGURED while `settings.folders.personal` is null. */
  'fileops:copyToPersonal': defineInvoke(CopyToPersonalRequestSchema).returns<CopyResult>(),
  /** Image Triage "Reset L/R": everything in `<root>/<folder>` back to the root. */
  'fileops:resetFolder': defineInvoke(ResetFolderRequestSchema).returns<MoveManyResult>(),
  /** Image `L` pre-clean: trash zero-byte and `*.log` files of a destination folder. */
  'fileops:preclean': defineInvoke(PrecleanRequestSchema).returns<PrecleanResult>(),
  /** Latest entries of the session root's journal, newest first. */
  'fileops:journal': defineInvoke(JournalListRequestSchema).returns<JournalEntry[]>()
} as const;

export type FileopsInvoke = InvokeMapOf<typeof fileopsInvoke>;

export interface FileopsEvents {
  'fileops:changed': FileopsChanged;
}
