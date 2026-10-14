import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { JournalEntry, MoveManyResult, MoveResult } from '@shared/domain/fileops'
import type { Session } from '@shared/domain/session'
import { createEnv, touch, type TestEnv } from './testSupport'

let env: TestEnv
let root: string
let outside: string
let session: Session

beforeEach(async () => {
  env = await createEnv()
  root = path.join(env.base, 'in')
  outside = path.join(env.base, 'outside')
  await mkdir(root, { recursive: true })
  await mkdir(outside, { recursive: true })
})
afterEach(async () => {
  await rm(env.base, { recursive: true, force: true })
})

async function open(kind: 'video' | 'image' = 'video'): Promise<void> {
  session = await env.ok<Session>('session:open', { dir: root, kind })
}

describe('real-path containment for file operations (review M3)', () => {
  it('moves, copies and trashes through a junction that leaves the root are refused', async () => {
    const victim = await touch(path.join(outside, 'victim.mp4'))
    await symlink(outside, path.join(root, 'link'), 'junction')
    await open()
    const through = path.join(root, 'link', 'victim.mp4')
    await env.ok('settings:update', { patch: { folders: { personal: path.join(env.base, 'personal') } } })
    for (const [channel, request] of [
      ['fileops:move', { sessionId: session.id, path: through, destination: { type: 'role', role: 'left' } }],
      ['fileops:trash', { sessionId: session.id, path: through }],
      ['fileops:copyToPersonal', { sessionId: session.id, path: through }]
    ] as const) {
      expect(await env.call(channel, request)).toMatchObject({ ok: false, error: { code: 'PATH_NOT_ALLOWED' } })
    }
    expect(existsSync(victim)).toBe(true)
    expect(env.trashed).toEqual([])
  })

  it('refuses to move a file into an L folder that is a junction to the outside', async () => {
    const file = await touch(path.join(root, 'a.mp4'))
    await symlink(outside, path.join(root, 'L'), 'junction')
    await open()
    const res = await env.call('fileops:move', {
      sessionId: session.id,
      path: file,
      destination: { type: 'role', role: 'left' }
    })
    expect(res).toMatchObject({ ok: false, error: { code: 'PATH_NOT_ALLOWED' } })
    expect(existsSync(file)).toBe(true)
    expect(await readdir(outside)).toEqual([])
  })

  it('moveMany reports the escaping path as failed and still moves the others', async () => {
    const good = await touch(path.join(root, 'a.mp4'))
    await touch(path.join(outside, 'b.mp4'))
    await symlink(outside, path.join(root, 'link'), 'junction')
    await open()
    const result = await env.ok<MoveManyResult>('fileops:moveMany', {
      sessionId: session.id,
      paths: [good, path.join(root, 'link', 'b.mp4')],
      destination: { type: 'role', role: 'left' }
    })
    expect(result.moved).toHaveLength(1)
    expect(result.failed.map((f) => f.error.code)).toEqual(['PATH_NOT_ALLOWED'])
  })

  it('refuses a ".." path and a sibling folder with the same prefix', async () => {
    await touch(path.join(env.base, 'in-evil', 'x.mp4'))
    await open()
    for (const file of [path.join(root, '..', 'in-evil', 'x.mp4'), path.join(env.base, 'in-evil', 'x.mp4')]) {
      expect(
        await env.call('fileops:move', { sessionId: session.id, path: file, destination: { type: 'role', role: 'left' } })
      ).toMatchObject({ ok: false, error: { code: 'PATH_NOT_ALLOWED' } })
    }
  })
})

describe('undo does not trust the journal file blindly', () => {
  it('a forged journal entry that points outside the session is refused', async () => {
    const file = await touch(path.join(root, 'a.mp4'))
    await open()
    const moved = await env.ok<MoveResult>('fileops:move', {
      sessionId: session.id,
      path: file,
      destination: { type: 'role', role: 'left' }
    })
    const journalFile = path.join(root, '.mediamaloi', 'journal.jsonl')
    const forged: JournalEntry = { ...moved.entry, id: 'forged', from: path.join(outside, 'planted.mp4') }
    const { appendFile } = await import('node:fs/promises')
    await appendFile(journalFile, `${JSON.stringify(forged)}\n`)
    const res = await env.call('fileops:undo', { sessionId: session.id, entryId: 'forged' })
    expect(res).toMatchObject({ ok: false, error: { code: 'PATH_NOT_ALLOWED' } })
    expect(existsSync(moved.newPath)).toBe(true)
  })

  it('undoing a copy never trashes anything outside the personal folder', async () => {
    const file = await touch(path.join(root, 'a.mp4'))
    const personal = path.join(env.base, 'personal')
    await env.ok('settings:update', { patch: { folders: { personal } } })
    await open()
    await env.ok('fileops:copyToPersonal', { sessionId: session.id, path: file })
    const victim = await touch(path.join(outside, 'victim.mp4'))
    const { appendFile } = await import('node:fs/promises')
    const forged: JournalEntry = {
      id: 'forged-copy',
      ts: Date.now(),
      sessionId: session.id,
      op: 'copy',
      from: file,
      to: victim,
      sidecars: [],
      undoable: true
    }
    await appendFile(path.join(root, '.mediamaloi', 'journal.jsonl'), `${JSON.stringify(forged)}\n`)
    const res = await env.call('fileops:undo', { sessionId: session.id, entryId: 'forged-copy' })
    expect(res).toMatchObject({ ok: false, error: { code: 'PATH_NOT_ALLOWED' } })
    expect(env.trashed).toEqual([])
    expect(existsSync(victim)).toBe(true)
  })
})

describe('resetFolder keeps backup folders in place (review H3)', () => {
  it('does not move L/bkp into the root, but still returns the files', async () => {
    await touch(path.join(root, 'L', 'one.jpg'))
    await touch(path.join(root, 'L', 'bkp', 'one.jpg'), 'backup')
    await touch(path.join(root, 'L', 'two.jpg'))
    await open('image')
    const result = await env.ok<MoveManyResult>('fileops:resetFolder', { sessionId: session.id, folder: 'L' })
    expect(result.moved).toHaveLength(2)
    expect(existsSync(path.join(root, 'bkp'))).toBe(false)
    expect(existsSync(path.join(root, 'L', 'bkp', 'one.jpg'))).toBe(true)
    expect((await readdir(root)).sort()).toEqual(['.mediamaloi', 'L', 'one.jpg', 'two.jpg'])
  })

  it('refuses to reset the backup folder itself', async () => {
    await touch(path.join(root, 'bkp', 'x.jpg'))
    await open('image')
    expect(await env.call('fileops:resetFolder', { sessionId: session.id, folder: 'bkp' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' }
    })
  })
})
