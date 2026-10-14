/**
 * Backup identity for in-place image edits (review H3, ADR-006).
 *
 * `<dir>/bkp/<name>` alone cannot tell WHICH image it belongs to: a new `IMG_0001.jpg` arriving
 * later would be "backed up" by the old copy and Ctrl+F would overwrite it with the wrong
 * picture. The index `<root>/.mediamaloi/backups.json` therefore records, per edited file, the
 * backup copy plus the SHA-256 of the original and of the bytes our last edit wrote. A backup is
 * reused / restored only while the file on disk still hashes to `editHash`.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { JOURNAL_DIR_NAME } from '../session/scan'

export const BackupRecordSchema = z.object({
  /** Backup path relative to the session root (`/` separators). */
  backup: z.string().min(1),
  originalHash: z.string().length(64),
  editHash: z.string().length(64),
  updatedAt: z.number()
})
export type BackupRecord = z.infer<typeof BackupRecordSchema>

const IndexSchema = z.record(z.string(), BackupRecordSchema)
type IndexData = z.infer<typeof IndexSchema>

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export interface BackupIndex {
  get(file: string): Promise<BackupRecord | undefined>
  set(file: string, record: BackupRecord): Promise<void>
  remove(file: string): Promise<void>
}

const chains = new Map<string, Promise<unknown>>()

/** Serialises read-modify-write per index file (one process owns it). */
function exclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
  const result = (chains.get(key) ?? Promise.resolve()).then(work, work)
  chains.set(
    key,
    result.catch(() => undefined)
  )
  return result
}

export function createBackupIndex(root: string): BackupIndex {
  const file = path.join(root, JOURNAL_DIR_NAME, 'backups.json')
  const keyOf = (target: string): string => {
    const rel = path.relative(root, target).split(path.sep).join('/')
    return process.platform === 'win32' ? rel.toLowerCase() : rel
  }

  const load = async (): Promise<IndexData> => {
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch (error: unknown) {
      const code: unknown = error instanceof Error ? Reflect.get(error, 'code') : undefined
      if (code === 'ENOENT') return {}
      throw error
    }
    const parsed = IndexSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : {}
  }

  const save = async (data: IndexData): Promise<void> => {
    await mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    try {
      await writeFile(tmp, JSON.stringify(data))
      await rename(tmp, file)
    } finally {
      await rm(tmp, { force: true })
    }
  }

  const mutate = (change: (data: IndexData) => void): Promise<void> =>
    exclusive(file, async () => {
      const data = await load()
      change(data)
      await save(data)
    })

  return {
    get: (target) => exclusive(file, async () => (await load())[keyOf(target)]),
    set: (target, record) =>
      mutate((data) => {
        data[keyOf(target)] = record
      }),
    remove: (target) =>
      mutate((data) => {
        delete data[keyOf(target)]
      })
  }
}
