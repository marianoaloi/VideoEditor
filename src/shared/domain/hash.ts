/**
 * Duplicate finder data (LEG §2.3, §4.5; ADR-007): the hash CSV and duplicate groups.
 * Owner (wave 2): svc-hash (grouping in `core/duplicates.ts`).
 */
import { z } from 'zod';
import { AbsPathSchema, NonNegIntSchema, TaskIdSchema } from './common';

export const HashKindSchema = z.enum(['video', 'image', 'gif']);
export type HashKind = z.infer<typeof HashKindSchema>;

/** CSV file name: `<prefix>resultsMD5.txt`, written in the PARENT of the scanned folder (legacy). */
export const HASH_CSV_PREFIX: Readonly<Record<HashKind, string>> = {
  video: 'vdo_',
  image: 'img_',
  gif: 'gif_'
};
export const HASH_CSV_SUFFIX = 'resultsMD5.txt';

export const HASH_KEYS = ['md5', 'pureMD5', 'hash16', 'hash8', 'thumbLight', 'thumbDark'] as const;
export const HashKeySchema = z.enum(HASH_KEYS);
export type HashKey = z.infer<typeof HashKeySchema>;

/** Exact legacy column order (`localMD5.COLUNS_FILE`); `worksdWell` keeps its legacy spelling. */
export const HASH_CSV_COLUMNS = [
  'root',
  'inFile',
  'path',
  'md5',
  'pureMD5',
  'hash16',
  'hash8',
  'thumbLight',
  'thumbDark',
  'worksdWell',
  'sizeFile',
  'comments'
] as const;
export type HashCsvColumn = (typeof HASH_CSV_COLUMNS)[number];

const HashValue = z.string().min(1).nullable();

/**
 * One CSV row, parsed. Videos have one row per sampled frame (same `md5`, different perceptual
 * keys). In the file: empty cell = `null`; `worksdWell` is `True`/`False`; `sizeFile` is bytes.
 */
export const HashRowSchema = z.object({
  root: z.string(),
  inFile: z.string(),
  path: z.string().min(1),
  md5: HashValue,
  pureMD5: HashValue,
  hash16: HashValue,
  hash8: HashValue,
  thumbLight: HashValue,
  thumbDark: HashValue,
  worksdWell: z.boolean(),
  sizeFile: NonNegIntSchema,
  comments: z.string()
});
export type HashRow = z.infer<typeof HashRowSchema>;

/** A value of `key` shared by more than one distinct path (`MD5Files.processData`). */
export const DuplicateGroupSchema = z.object({
  id: z.string().min(1),
  key: HashKeySchema,
  value: z.string().min(1),
  /** Distinct paths, at least two, in CSV order. */
  paths: z.array(z.string().min(1)).min(2),
  rows: z.array(HashRowSchema),
  /** (max size − min size) / max size × 100 across `paths`. */
  sizeDiffPercent: z.number().nonnegative()
});
export type DuplicateGroup = z.infer<typeof DuplicateGroupSchema>;

export const HashTableSchema = z.object({
  csvPath: AbsPathSchema,
  rows: z.array(HashRowSchema)
});
export type HashTable = z.infer<typeof HashTableSchema>;

/** Event `hashing:progress`, throttled (~4/s) plus a final `done`. */
export const HashProgressSchema = z.object({
  taskId: TaskIdSchema,
  dir: AbsPathSchema,
  phase: z.enum(['scanning', 'hashing', 'writing', 'done']),
  done: NonNegIntSchema,
  total: NonNegIntSchema,
  failed: NonNegIntSchema,
  currentPath: AbsPathSchema.optional()
});
export type HashProgress = z.infer<typeof HashProgressSchema>;

// ---- requests / results -------------------------------------------------------------------

export const HashBuildRequestSchema = z.object({
  taskId: TaskIdSchema,
  dir: AbsPathSchema,
  kind: HashKindSchema
});
export type HashBuildRequest = z.input<typeof HashBuildRequestSchema>;

export const HashBuildResultSchema = z.object({
  taskId: TaskIdSchema,
  csvPath: AbsPathSchema,
  fileCount: NonNegIntSchema,
  rowCount: NonNegIntSchema,
  failedCount: NonNegIntSchema,
  cancelled: z.boolean()
});
export type HashBuildResult = z.infer<typeof HashBuildResultSchema>;

/** Load by explicit CSV path, or the default CSV of `{dir, kind}`. Missing CSV → NOT_FOUND. */
export const HashSourceSchema = z.union([
  z.object({ csvPath: AbsPathSchema }),
  z.object({ dir: AbsPathSchema, kind: HashKindSchema })
]);
export const HashLoadRequestSchema = z.object({ source: HashSourceSchema });
export type HashLoadRequest = z.input<typeof HashLoadRequestSchema>;

export const HashSaveRequestSchema = z.object({
  csvPath: AbsPathSchema,
  rows: z.array(HashRowSchema)
});
export type HashSaveRequest = z.input<typeof HashSaveRequestSchema>;
export const HashSaveResultSchema = z.object({ csvPath: AbsPathSchema, rowCount: NonNegIntSchema });
export type HashSaveResult = z.infer<typeof HashSaveResultSchema>;

/** "Concat other data": merge `otherCsvPath` into `csvPath`, keeping matching `pureMD5` only. */
export const HashConcatRequestSchema = z.object({
  csvPath: AbsPathSchema,
  otherCsvPath: AbsPathSchema
});
export type HashConcatRequest = z.input<typeof HashConcatRequestSchema>;
export const HashConcatResultSchema = z.object({
  table: HashTableSchema,
  added: NonNegIntSchema,
  /** ADR-007: keys from different hash origins don't group reliably. */
  warning: z.string().nullable()
});
export type HashConcatResult = z.infer<typeof HashConcatResultSchema>;

/** "Clean analyses": drop rows whose files no longer exist, then save. */
export const HashCleanRequestSchema = z.object({ csvPath: AbsPathSchema });
export type HashCleanRequest = z.input<typeof HashCleanRequestSchema>;
export const HashCleanResultSchema = z.object({
  table: HashTableSchema,
  removed: NonNegIntSchema
});
export type HashCleanResult = z.infer<typeof HashCleanResultSchema>;

export const HashCsvPathRequestSchema = z.object({ dir: AbsPathSchema, kind: HashKindSchema });
export type HashCsvPathRequest = z.input<typeof HashCsvPathRequestSchema>;
export const HashCsvPathResultSchema = z.object({ csvPath: AbsPathSchema, exists: z.boolean() });
export type HashCsvPathResult = z.infer<typeof HashCsvPathResultSchema>;

export const HashCancelRequestSchema = z.object({ taskId: TaskIdSchema });
export type HashCancelRequest = z.input<typeof HashCancelRequestSchema>;
