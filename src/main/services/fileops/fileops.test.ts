import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  CopyResult,
  JournalEntry,
  MoveManyResult,
  MoveResult,
  PrecleanResult,
  UndoResult
} from '@shared/domain/fileops'
import type { Session } from '@shared/domain/session'
import { createEnv, touch, type TestEnv } from './testSupport'

let env: TestEnv
let root: string
let session: Session

async function setup(): Promise<void> {
  env = await createEnv()
  root = path.join(env.base, 'in')
  await mkdir(root, { recursive: true })
}

async function openSession(kind: 'video' | 'image' = 'video', recursive = false): Promise<void> {
  session = await env.ok<Session>('session:open', { dir: root, kind, recursive })
}

const role = (r: 'left' | 'right' | 'custom' | 'purge' | 'ruim') => ({ type: 'role', role: r }) as const

async function move(file: string, destination: unknown = role('left')): Promise<MoveResult> {
  return env.ok<MoveResult>('fileops:move', { sessionId: session.id, path: file, destination })
}

beforeEach(async () => {
  await setup()
})
afterEach(async () => {
  await rm(env.base, { recursive: true, force: true })
})

describe('fileops:move (video-triage §8.2, checklist 32-35)', () => {
  it('moves into the role folder, creating it, and journals it (35)', async () => {
    const file = await touch(path.join(root, 'a.mp4'))
    await openSession()
    const r = await move(file)
    expect(r.newPath).toBe(path.join(root, 'L', 'a.mp4'))
    expect(existsSync(file)).toBe(false)
    expect(r.entry).toMatchObject({ op: 'move', from: file, to: r.newPath, undoable: true, sessionId: session.id })
    const lines = (await readFile(path.join(root, '.mediamaloi', 'journal.jsonl'), 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ id: r.entry.id, op: 'move' })
    expect(env.events.at(-1)).toMatchObject({ channel: 'fileops:changed', payload: { root, sessionId: session.id } })
  })

  it('uses configured role names and typed folder names', async () => {
    const a = await touch(path.join(root, 'a.mp4'))
    const b = await touch(path.join(root, 'b.mp4'))
    await openSession()
    expect((await move(a, role('purge'))).newPath).toBe(path.join(root, 'md5Purge', 'a.mp4'))
    expect((await move(b, { type: 'folder', name: 'My Folder' })).newPath).toBe(path.join(root, 'My Folder', 'b.mp4'))
  })

  it('never overwrites: adds " (n)" before the extension (33)', async () => {
    await touch(path.join(root, 'L', 'a.mp4'))
    await touch(path.join(root, 'L', 'a (1).mp4'))
    const file = await touch(path.join(root, 'a.mp4'), 'new')
    await openSession()
    const r = await move(file)
    expect(r.newPath).toBe(path.join(root, 'L', 'a (2).mp4'))
    expect(await readFile(path.join(root, 'L', 'a.mp4'), 'utf8')).toBe('x')
  })

  it('moves the .json sidecar with the same suffix (33, 34)', async () => {
    await touch(path.join(root, 'L', 'a.mp4'))
    const file = await touch(path.join(root, 'a.mp4'))
    await touch(`${file}.json`, '{"k":1}')
    await openSession()
    const r = await move(file)
    expect(r.newPath).toBe(path.join(root, 'L', 'a (1).mp4'))
    expect(existsSync(`${file}.json`)).toBe(false)
    expect(await readFile(`${r.newPath}.json`, 'utf8')).toBe('{"k":1}')
    expect(r.entry.sidecars).toEqual([{ from: `${file}.json`, to: `${r.newPath}.json` }])
  })

  it('treats a stray sidecar at the destination as a collision', async () => {
    await touch(path.join(root, 'L', 'a.mp4.json'), 'stray')
    const file = await touch(path.join(root, 'a.mp4'))
    await touch(`${file}.json`, 'mine')
    await openSession()
    const r = await move(file)
    expect(r.newPath).toBe(path.join(root, 'L', 'a (1).mp4'))
    expect(await readFile(path.join(root, 'L', 'a.mp4.json'), 'utf8')).toBe('stray')
  })

  it('recursive sessions prefix with the sub-folders, no leading underscore at the root, spaces kept (32)', async () => {
    const root1 = await touch(path.join(root, 'top.mp4'))
    const deep = await touch(path.join(root, 'my sub', 'b', 'x.mp4'))
    await openSession('video', true)
    expect((await move(root1)).newPath).toBe(path.join(root, 'L', 'top.mp4'))
    expect((await move(deep)).newPath).toBe(path.join(root, 'L', 'my subb_x.mp4'))
  })

  it('two sub-folders with the same file name do not collide destructively (33)', async () => {
    const a = await touch(path.join(root, 'a', 'x.mp4'), '1')
    const c = await touch(path.join(root, 'b', 'x.mp4'), '2')
    await openSession('video', true)
    const first = await move(a)
    const second = await move(c)
    expect(first.newPath).toBe(path.join(root, 'L', 'a_x.mp4'))
    expect(second.newPath).toBe(path.join(root, 'L', 'b_x.mp4'))
  })

  it('trims the START of an overlong name so the extension survives (32, TV-E)', async () => {
    const longFile = path.join(root, `${'n'.repeat(200)}END.mp4`)
    await touch(longFile)
    await openSession()
    const r = await move(longFile)
    expect(path.basename(r.newPath).endsWith('END.mp4')).toBe(true)
    expect(r.newPath.length).toBeLessThanOrEqual(254)
    expect(path.basename(r.newPath).length).toBeLessThan(207)
  })

  it('rejects paths outside the session and missing files', async () => {
    await touch(path.join(root, 'a.mp4'))
    const outside = await touch(path.join(env.base, 'out.mp4'))
    await openSession()
    const r1 = await env.call('fileops:move', { sessionId: session.id, path: outside, destination: role('left') })
    expect(r1).toMatchObject({ ok: false, error: { code: 'PATH_NOT_ALLOWED' } })
    const r2 = await env.call('fileops:move', { sessionId: session.id, path: path.join(root, 'zz.mp4'), destination: role('left') })
    expect(r2).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    const r3 = await env.call('fileops:move', { sessionId: 'nope', path: outside, destination: role('left') })
    expect(r3).toMatchObject({ ok: false, error: { code: 'SESSION_NOT_FOUND' } })
  })

  it('refuses a destination name that escapes the root (schema)', async () => {
    const file = await touch(path.join(root, 'a.mp4'))
    await openSession()
    const r = await env.call('fileops:move', { sessionId: session.id, path: file, destination: { type: 'folder', name: '..' } })
    expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
  })
})

describe('fileops:moveMany', () => {
  it('moves each path independently and reports failures (duplicates)', async () => {
    const a = await touch(path.join(root, 'a.mp4'))
    const b = await touch(path.join(root, 'b.mp4'))
    await openSession()
    const r = await env.ok<MoveManyResult>('fileops:moveMany', {
      sessionId: session.id,
      paths: [a, path.join(root, 'missing.mp4'), b],
      destination: { type: 'folder', name: 'md5Purge' }
    })
    expect(r.moved.map((m) => path.basename(m.newPath))).toEqual(['a.mp4', 'b.mp4'])
    expect(r.failed).toHaveLength(1)
    expect(r.failed[0]?.error.code).toBe('NOT_FOUND')
    const events = env.events.filter((e) => e.channel === 'fileops:changed')
    expect(events).toHaveLength(1)
    expect((events[0]?.payload as { entries: unknown[] }).entries).toHaveLength(2)
  })
})

describe('fileops:undo (ADR-006, checklist 36)', () => {
  it('restores file and sidecar to the original path and appends a compensating entry', async () => {
    const file = await touch(path.join(root, 'a.mp4'))
    await touch(`${file}.json`, 'job')
    await openSession()
    const moved = await move(file)
    const r = await env.ok<UndoResult>('fileops:undo', { sessionId: session.id, entryId: moved.entry.id })
    expect(r.restoredPath).toBe(file)
    expect(existsSync(file)).toBe(true)
    expect(await readFile(`${file}.json`, 'utf8')).toBe('job')
    expect(existsSync(moved.newPath)).toBe(false)
    expect(r.undone.id).toBe(moved.entry.id)
    expect(r.compensating).toMatchObject({ op: 'undo', undoOf: moved.entry.id, undoable: false })
    expect(r.item).toMatchObject({ name: 'a.mp4', path: file })
  })

  it('restores collision-safe when the original name is taken', async () => {
    const file = await touch(path.join(root, 'a.mp4'), 'one')
    await openSession()
    const moved = await move(file)
    await touch(file, 'two')
    const r = await env.ok<UndoResult>('fileops:undo', { sessionId: session.id, entryId: moved.entry.id })
    expect(r.restoredPath).toBe(path.join(root, 'a (1).mp4'))
    expect(await readFile(file, 'utf8')).toBe('two')
  })

  it('without entryId reverses the latest undoable entry; each entry only once; NOTHING_TO_UNDO at the end', async () => {
    const a = await touch(path.join(root, 'a.mp4'))
    const b = await touch(path.join(root, 'b.mp4'))
    await openSession()
    await move(a)
    const mb = await move(b, role('right'))
    expect((await env.ok<JournalEntry | null>('fileops:peekUndo', { sessionId: session.id }))?.id).toBe(mb.entry.id)
    const u1 = await env.ok<UndoResult>('fileops:undo', { sessionId: session.id })
    expect(u1.restoredPath).toBe(b)
    const u2 = await env.ok<UndoResult>('fileops:undo', { sessionId: session.id })
    expect(u2.restoredPath).toBe(a)
    expect(await env.ok('fileops:peekUndo', { sessionId: session.id })).toBeNull()
    const none = await env.call('fileops:undo', { sessionId: session.id })
    expect(none).toMatchObject({ ok: false, error: { code: 'NOTHING_TO_UNDO' } })
    const again = await env.call('fileops:undo', { sessionId: session.id, entryId: mb.entry.id })
    expect(again).toMatchObject({ ok: false, error: { code: 'NOTHING_TO_UNDO' } })
  })

  it('works across restarts: a new session on the same root finds the journal (fallback)', async () => {
    const a = await touch(path.join(root, 'a.mp4'))
    await openSession()
    await move(a)
    await openSession()
    const r = await env.ok<UndoResult>('fileops:undo', { sessionId: session.id })
    expect(r.restoredPath).toBe(a)
    expect(r.item?.name).toBe('a.mp4')
  })

  it('reports NOT_FOUND when the moved file vanished and leaves the entry undoable', async () => {
    const a = await touch(path.join(root, 'a.mp4'))
    await openSession()
    const m = await move(a)
    await rm(m.newPath)
    const r = await env.call('fileops:undo', { sessionId: session.id })
    expect(r).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect((await env.ok<JournalEntry | null>('fileops:peekUndo', { sessionId: session.id }))?.id).toBe(m.entry.id)
  })

  it('never reverses trash entries (checklist 37) and undoing a copy trashes the copy', async () => {
    const personal = path.join(env.base, 'personal')
    await env.ok('settings:update', { patch: { folders: { personal } } })
    const a = await touch(path.join(root, 'a.mp4'))
    const t = await touch(path.join(root, 't.mp4'))
    await openSession()
    const copy = await env.ok<CopyResult>('fileops:copyToPersonal', { sessionId: session.id, path: a })
    await env.ok('fileops:trash', { sessionId: session.id, path: t })
    const r = await env.ok<UndoResult>('fileops:undo', { sessionId: session.id })
    expect(r.undone.id).toBe(copy.entry.id)
    expect(env.trashed).toContain(copy.newPath)
    expect(existsSync(a)).toBe(true)
    const none = await env.call('fileops:undo', { sessionId: session.id })
    expect(none).toMatchObject({ ok: false, error: { code: 'NOTHING_TO_UNDO' } })
  })
})

describe('fileops:trash / copyToPersonal (checklist 37, 38)', () => {
  it('trashes the file and its sidecar through the OS trash, not undoable', async () => {
    const a = await touch(path.join(root, 'a.mp4'))
    await touch(`${a}.json`)
    await openSession()
    const r = await env.ok<{ entry: JournalEntry }>('fileops:trash', { sessionId: session.id, path: a })
    expect(env.trashed).toEqual([a, `${a}.json`])
    expect(r.entry).toMatchObject({ op: 'trash', to: null, undoable: false })
    expect(await env.call('fileops:trash', { sessionId: session.id, path: a })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' }
    })
  })

  it('copy needs the personal folder (NOT_CONFIGURED), copies collision-safe and keeps the original', async () => {
    const a = await touch(path.join(root, 'a.mp4'))
    await openSession()
    const refused = await env.call('fileops:copyToPersonal', { sessionId: session.id, path: a })
    expect(refused).toMatchObject({ ok: false, error: { code: 'NOT_CONFIGURED' } })
    const personal = path.join(env.base, 'p', 'q')
    await env.ok('settings:update', { patch: { folders: { personal } } })
    const c1 = await env.ok<CopyResult>('fileops:copyToPersonal', { sessionId: session.id, path: a })
    const c2 = await env.ok<CopyResult>('fileops:copyToPersonal', { sessionId: session.id, path: a })
    expect(c1.newPath).toBe(path.join(personal, 'a.mp4'))
    expect(c2.newPath).toBe(path.join(personal, 'a (1).mp4'))
    expect(existsSync(a)).toBe(true)
    expect(c1.entry.op).toBe('copy')
  })
})

describe('fileops:resetFolder (image-triage §2.6)', () => {
  it('moves every entry (hidden, sub-folders) back to the root, collision-safe, journaled and undoable', async () => {
    await touch(path.join(root, 'a.jpg'), 'root')
    await touch(path.join(root, 'L', 'a.jpg'), 'inL')
    await touch(path.join(root, 'L', '.hid.jpg'))
    await touch(path.join(root, 'L', 'sub', 'z.jpg'))
    await touch(path.join(root, 'L', 'p.jpg'))
    await touch(path.join(root, 'L', 'p.jpg.json'), '{}')
    await openSession('image')
    const r = await env.ok<MoveManyResult>('fileops:resetFolder', { sessionId: session.id, folder: 'L' })
    expect(r.failed).toEqual([])
    expect((await readdir(root)).sort()).toEqual(['.hid.jpg', '.mediamaloi', 'L', 'a (1).jpg', 'a.jpg', 'p.jpg', 'p.jpg.json', 'sub'])
    expect(await readdir(path.join(root, 'L'))).toEqual([])
    expect(await readFile(path.join(root, 'a.jpg'), 'utf8')).toBe('root')
    expect(r.moved.every((m) => m.entry.op === 'move')).toBe(true)
    const undo = await env.ok<UndoResult>('fileops:undo', { sessionId: session.id })
    expect(undo.undone.from.startsWith(path.join(root, 'L'))).toBe(true)
  })

  it('answers NOT_FOUND when the folder does not exist', async () => {
    await openSession('image')
    const r = await env.call('fileops:resetFolder', { sessionId: session.id, folder: 'R' })
    expect(r).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })
})

describe('fileops:preclean (image-triage §7.1 step 1)', () => {
  it('trashes zero-byte files and *.log directly in the folder only', async () => {
    await touch(path.join(root, 'L', 'empty.jpg'), '')
    await touch(path.join(root, 'L', 'run.LOG'), 'log text')
    await touch(path.join(root, 'L', 'keep.jpg'), 'data')
    await touch(path.join(root, 'L', 'sub', 'empty2.jpg'), '')
    await openSession('image')
    const r = await env.ok<PrecleanResult>('fileops:preclean', { sessionId: session.id, folder: 'L' })
    expect(r.trashed.map((p) => path.basename(p)).sort()).toEqual(['empty.jpg', 'run.LOG'])
    expect(existsSync(path.join(root, 'L', 'keep.jpg'))).toBe(true)
    expect(existsSync(path.join(root, 'L', 'sub', 'empty2.jpg'))).toBe(true)
    const journal = await env.ok<JournalEntry[]>('fileops:journal', { sessionId: session.id })
    expect(journal.map((e) => e.op)).toEqual(['trash', 'trash'])
  })

  it('returns an empty list when the folder is missing', async () => {
    await openSession('image')
    expect(await env.ok('fileops:preclean', { sessionId: session.id, folder: 'L' })).toEqual({ trashed: [] })
  })
})

describe('fileops:journal', () => {
  it('lists newest first and honours limit', async () => {
    const a = await touch(path.join(root, 'a.mp4'))
    const b = await touch(path.join(root, 'b.mp4'))
    await openSession()
    const ma = await move(a)
    const mb = await move(b)
    const list = await env.ok<JournalEntry[]>('fileops:journal', { sessionId: session.id })
    expect(list.map((e) => e.id)).toEqual([mb.entry.id, ma.entry.id])
    expect(await env.ok<JournalEntry[]>('fileops:journal', { sessionId: session.id, limit: 1 })).toHaveLength(1)
  })

  it('ignores corrupt lines instead of failing', async () => {
    const a = await touch(path.join(root, 'a.mp4'))
    await openSession()
    const m = await move(a)
    const file = path.join(root, '.mediamaloi', 'journal.jsonl')
    await writeFile(file, `not json\n${await readFile(file, 'utf8')}{"bad":true}\n`)
    const list = await env.ok<JournalEntry[]>('fileops:journal', { sessionId: session.id })
    expect(list.map((e) => e.id)).toEqual([m.entry.id])
  })
})
