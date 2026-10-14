import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { serializeHashCsv } from '@shared/core/hashCsv'
import { DEFAULT_SETTINGS } from '@shared/domain/settings'
import type { HashRow, HashTable } from '@shared/domain/hash'
import { createMediaAllowlist } from '../../ipc/mediaAllowlist'
import { createMainContext, createSettingsAccess } from '../../ipc/context'
import { dispatch, resetHandlers } from '../../ipc/handle'
import { makeTempDir } from '../ffmpeg/testFixtures'
import { registerHashingIpc } from './ipc'
import { writePattern } from './testImages'

let parent = ''
let scan = ''
const events: unknown[] = []

beforeEach(async () => {
  parent = await makeTempDir('hash-ipc')
  scan = path.join(parent, 'photos')
  await mkdir(scan, { recursive: true })
  events.length = 0
  resetHandlers()
  const base = createMainContext({
    getWindow: () => null,
    settings: createSettingsAccess(DEFAULT_SETTINGS),
    allowlist: createMediaAllowlist(),
    paths: { userData: path.join(parent, 'userData'), temp: parent },
    trashItem: async () => undefined,
    newId: () => 'id'
  })
  base.approvals.addRoot(parent)
  registerHashingIpc({ ...base, sendEvent: (_c, p) => void events.push(p) })
})
afterEach(async () => {
  resetHandlers()
  await rm(parent, { recursive: true, force: true })
})

async function ok<T>(channel: string, req: unknown): Promise<T> {
  const res = await dispatch(channel, req)
  if (!res.ok) throw new Error(`${channel}: ${res.error.code} ${res.error.message}`)
  return res.data as T
}

const row = (file: string, over: Partial<HashRow> = {}): HashRow => ({
  root: path.dirname(file),
  inFile: path.basename(file),
  path: file,
  md5: 'M',
  pureMD5: 'P',
  hash16: 'H',
  hash8: 'E',
  thumbLight: 'L',
  thumbDark: 'D',
  worksdWell: true,
  sizeFile: 1,
  comments: '',
  ...over
})

describe('hashing ipc', () => {
  it('csvPath reports the parent location and existence; load is NOT_FOUND before a build', async () => {
    const info = await ok<{ csvPath: string; exists: boolean }>('hashing:csvPath', {
      dir: scan,
      kind: 'image'
    })
    expect(info).toEqual({ csvPath: path.join(parent, 'photos_img_resultsMD5.txt'), exists: false })
    const res = await dispatch('hashing:load', { source: { dir: scan, kind: 'image' } })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND')
  })

  it('build -> load -> rebuild round trip, with progress events', async () => {
    await writePattern(scan, 'a.png', 'png')
    await writePattern(scan, 'b.png', 'png')
    const built = await ok<{ csvPath: string; rowCount: number; cancelled: boolean }>(
      'hashing:build',
      { taskId: 'k1', dir: scan, kind: 'image' }
    )
    expect(built).toMatchObject({ rowCount: 2, cancelled: false })
    expect(events.length).toBeGreaterThan(0)
    const loaded = await ok<HashTable>('hashing:load', { source: { dir: scan, kind: 'image' } })
    expect(loaded.rows).toHaveLength(2)
    await writePattern(scan, 'c.png', 'png')
    const again = await ok<{ rowCount: number }>('hashing:rebuild', {
      taskId: 'k2',
      dir: scan,
      kind: 'image'
    })
    expect(again.rowCount).toBe(3)
  })

  it('a CSV of another folder is refused when loaded by folder, accepted by file (item 8)', async () => {
    const csv = path.join(parent, 'img_resultsMD5.txt')
    await writeFile(csv, serializeHashCsv([row('/home/old/x.jpg', { root: '/home/old' })]))
    const res = await dispatch('hashing:load', { source: { dir: scan, kind: 'image' } })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('CONFLICT')
    const byFile = await ok<HashTable>('hashing:load', { source: { csvPath: csv } })
    expect(byFile.rows[0]?.path).toBe('/home/old/x.jpg')
  })

  it('save writes the canonical layout; clean drops rows of missing files and saves', async () => {
    const keep = path.join(scan, 'keep.png')
    await writePattern(scan, 'keep.png', 'png')
    const csv = path.join(parent, 'saved.txt')
    const rows = [row(keep), row(keep, { pureMD5: 'P2' }), row(path.join(scan, 'gone.png'))]
    expect(await ok('hashing:save', { csvPath: csv, rows })).toEqual({ csvPath: csv, rowCount: 3 })
    expect((await readFile(csv, 'utf8')).startsWith('root,inFile,path,md5')).toBe(true)
    const cleaned = await ok<{ table: HashTable; removed: number }>('hashing:clean', {
      csvPath: csv
    })
    expect(cleaned.removed).toBe(1)
    expect(cleaned.table.rows).toHaveLength(2)
    const reread = await ok<HashTable>('hashing:load', { source: { csvPath: csv } })
    expect(reread.rows).toHaveLength(2)
  })

  it('H4: sibling folders get their own CSV; rebuilding one keeps the other and a failed rebuild keeps the old CSV', async () => {
    const other = path.join(parent, 'holiday')
    await mkdir(other)
    await writePattern(scan, 'a.png', 'png')
    await writePattern(other, 'z.png', 'png')
    const a = await ok<{ csvPath: string }>('hashing:build', {
      taskId: 'a',
      dir: scan,
      kind: 'image'
    })
    const b = await ok<{ csvPath: string }>('hashing:build', {
      taskId: 'b',
      dir: other,
      kind: 'image'
    })
    expect(a.csvPath).not.toBe(b.csvPath)
    const before = await readFile(a.csvPath, 'utf8')
    await ok('hashing:rebuild', { taskId: 'b2', dir: other, kind: 'image' })
    expect(await readFile(a.csvPath, 'utf8')).toBe(before)
    await rm(other, { recursive: true })
    const failed = await dispatch('hashing:rebuild', { taskId: 'b3', dir: other, kind: 'image' })
    expect(failed.ok).toBe(false)
    expect((await readFile(b.csvPath, 'utf8')).length).toBeGreaterThan(0)
  })

  it('H4: a legacy fixed-name CSV of this folder is still loaded, and a rebuild leaves it in place', async () => {
    await writePattern(scan, 'a.png', 'png')
    const legacy = path.join(parent, 'img_resultsMD5.txt')
    await writeFile(legacy, serializeHashCsv([row(path.join(scan, 'a.png'), { root: scan })]))
    const info = await ok<{ csvPath: string; exists: boolean }>('hashing:csvPath', {
      dir: scan,
      kind: 'image'
    })
    expect(info).toEqual({ csvPath: legacy, exists: true })
    expect(
      (await ok<HashTable>('hashing:load', { source: { dir: scan, kind: 'image' } })).csvPath
    ).toBe(legacy)
    const built = await ok<{ csvPath: string }>('hashing:rebuild', {
      taskId: 'r',
      dir: scan,
      kind: 'image'
    })
    expect(built.csvPath).toBe(path.join(parent, 'photos_img_resultsMD5.txt'))
    expect((await stat(legacy)).isFile()).toBe(true)
    const loaded = await ok<HashTable>('hashing:load', { source: { dir: scan, kind: 'image' } })
    expect(loaded.csvPath).toBe(built.csvPath)
  })

  it('M7: clean keeps a .bak of the old file', async () => {
    await writePattern(scan, 'keep.png', 'png')
    const csv = path.join(parent, 'c.txt')
    const keep = path.join(scan, 'keep.png')
    await writeFile(csv, serializeHashCsv([row(keep), row(path.join(scan, 'gone.png'))]))
    const original = await readFile(csv, 'utf8')
    await ok('hashing:clean', { csvPath: csv })
    expect(await readFile(`${csv}.bak`, 'utf8')).toBe(original)
  })

  it('M7: clean refuses when the CSV root folder is missing (unmounted drive) and touches nothing', async () => {
    const csv = path.join(parent, 'c.txt')
    const text = serializeHashCsv([row(path.join(parent, 'unplugged', 'x.png'))])
    await writeFile(csv, text)
    const res = await dispatch('hashing:clean', { csvPath: csv })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('VALIDATION')
      expect(res.error.message).toContain('not available')
    }
    expect(await readFile(csv, 'utf8')).toBe(text)
  })

  it('M7: clean refuses when it would remove every row', async () => {
    const csv = path.join(parent, 'c.txt')
    const text = serializeHashCsv([
      row(path.join(scan, 'gone1.png')),
      row(path.join(scan, 'gone2.png'))
    ])
    await writeFile(csv, text)
    const res = await dispatch('hashing:clean', { csvPath: csv })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.message).toContain('every row')
    expect(await readFile(csv, 'utf8')).toBe(text)
  })

  it('concat keeps current rows, appends only matching pureMD5, warns on mixed origins (item 30)', async () => {
    const a = path.join(parent, 'a.txt')
    const b = path.join(parent, 'b.txt')
    await writeFile(
      a,
      serializeHashCsv([row('/x/1', { pureMD5: 'P1' }), row('/x/2', { pureMD5: null })])
    )
    await writeFile(
      b,
      serializeHashCsv([
        row('/y/1', { pureMD5: 'P1' }),
        row('/y/2', { pureMD5: 'ZZ' }),
        row('/y/3', { pureMD5: null })
      ])
    )
    await writeFile(`${a}.meta.json`, JSON.stringify({ origin: 'videoeditor-ts', algo: 1 }))
    const res = await ok<{ table: HashTable; added: number; warning: string | null }>(
      'hashing:concat',
      { csvPath: a, otherCsvPath: b }
    )
    expect(res.added).toBe(1)
    expect(res.table.rows.map((r) => r.path)).toEqual(['/x/1', '/x/2', '/y/1'])
    expect(res.warning).not.toBeNull()
    const same = await ok<{ warning: string | null }>('hashing:concat', {
      csvPath: b,
      otherCsvPath: b
    })
    expect(same.warning).toBeNull()
  })

  it('rejects non-csv targets and cancel of an unknown task is a no-op', async () => {
    const res = await dispatch('hashing:save', { csvPath: path.join(parent, 'x.exe'), rows: [] })
    expect(res.ok).toBe(false)
    expect((await dispatch('hashing:cancel', { taskId: 'nope' })).ok).toBe(true)
    await expect(stat(path.join(parent, 'x.exe'))).rejects.toThrow()
  })
})
