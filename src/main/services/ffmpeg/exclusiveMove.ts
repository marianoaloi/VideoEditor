/**
 * Move that never replaces an existing destination (review M6). `fs.rename` replaces a file on
 * Windows and "exists, then rename" races with writers outside our mutex, so the destination is
 * created exclusively: a hard link (atomic, fails with EEXIST) or, where links are unsupported
 * (FAT/exFAT/some network shares), `copyFile` with `COPYFILE_EXCL`; the source is removed afterwards.
 */
import { constants } from 'node:fs'
import { copyFile, link, rm } from 'node:fs/promises'

const LINK_UNSUPPORTED = new Set(['EPERM', 'ENOTSUP', 'EXDEV', 'EINVAL', 'ENOSYS', 'EACCES', 'UNKNOWN'])

export function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined
  const code: unknown = Reflect.get(error, 'code')
  return typeof code === 'string' ? code : undefined
}

export function isAlreadyExists(error: unknown): boolean {
  return errorCode(error) === 'EEXIST'
}

async function copyExclusive(source: string, dest: string): Promise<void> {
  try {
    await copyFile(source, dest, constants.COPYFILE_EXCL)
  } catch (error) {
    if (!isAlreadyExists(error)) await rm(dest, { force: true })
    throw error
  }
}

/** Rejects with an `EEXIST` error when `dest` exists; `source` is gone after a success. */
export async function moveExclusive(source: string, dest: string): Promise<void> {
  try {
    await link(source, dest)
  } catch (error) {
    const code = errorCode(error)
    if (code === undefined || !LINK_UNSUPPORTED.has(code)) throw error
    await copyExclusive(source, dest)
  }
  await rm(source, { force: true })
}
