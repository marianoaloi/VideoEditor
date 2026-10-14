import { call } from '@renderer/app/api'

/** Native dialog for one directory or one file; `null` when cancelled. */
export async function browsePath(kind: 'dir' | 'file', title: string): Promise<string | null> {
  if (kind === 'dir') {
    const result = await call('app:openDirectoryDialog', { title })
    return result.canceled ? null : result.path
  }
  const result = await call('app:openFilesDialog', { title, multi: false })
  return result.canceled ? null : (result.paths[0] ?? null)
}
