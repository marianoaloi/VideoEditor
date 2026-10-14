/** Duplicate-hash channels (F10; ADR-007). Owner (wave 2): svc-hash. */
import { defineInvoke, type InvokeMapOf } from '../define';
import {
  HashBuildRequestSchema,
  HashCancelRequestSchema,
  HashCleanRequestSchema,
  HashConcatRequestSchema,
  HashCsvPathRequestSchema,
  HashLoadRequestSchema,
  HashSaveRequestSchema,
  type HashBuildResult,
  type HashCleanResult,
  type HashConcatResult,
  type HashCsvPathResult,
  type HashProgress,
  type HashSaveResult,
  type HashTable
} from '../../domain/hash';

export {
  HashBuildRequestSchema,
  HashCancelRequestSchema,
  HashCleanRequestSchema,
  HashConcatRequestSchema,
  HashCsvPathRequestSchema,
  HashLoadRequestSchema,
  HashSaveRequestSchema
};

export const hashingInvoke = {
  /** Scan `dir` recursively and write the CSV; resolves when done or cancelled. */
  'hashing:build': defineInvoke(HashBuildRequestSchema).returns<HashBuildResult>(),
  /** "Rebuild same folder": delete the CSV, then build. */
  'hashing:rebuild': defineInvoke(HashBuildRequestSchema).returns<HashBuildResult>(),
  /** NOT_FOUND when the CSV doesn't exist (the UI then offers to build it). */
  'hashing:load': defineInvoke(HashLoadRequestSchema).returns<HashTable>(),
  'hashing:save': defineInvoke(HashSaveRequestSchema).returns<HashSaveResult>(),
  'hashing:concat': defineInvoke(HashConcatRequestSchema).returns<HashConcatResult>(),
  'hashing:clean': defineInvoke(HashCleanRequestSchema).returns<HashCleanResult>(),
  /** Default CSV location for `{dir, kind}` (parent folder, legacy) and whether it exists. */
  'hashing:csvPath': defineInvoke(HashCsvPathRequestSchema).returns<HashCsvPathResult>(),
  'hashing:cancel': defineInvoke(HashCancelRequestSchema).returns<void>()
} as const;

export type HashingInvoke = InvokeMapOf<typeof hashingInvoke>;

export interface HashingEvents {
  'hashing:progress': HashProgress;
}
