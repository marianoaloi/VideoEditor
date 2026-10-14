import { existsSync } from 'node:fs'
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import type { ImageEditResult, ImageRestoreResult } from '@shared/domain/media'
import type { Session } from '@shared/domain/session'
import { createEnv, touch, type TestEnv } from '../fileops/testSupport'
import { registerMediaIpc } from './ipc'

let env: TestEnv
afterEach(async () => {
  await rm(env.base, { recursive: true, force: true })
})

const CROP = { crop: { x: 0, y: 0, w: 20, h: 20 }, bright: null, contrast: null, transpose: null }

async function png(file: string, colour: string, size = 60): Promise<string> {
  await touch(file, '')
  await sharp({ create: { width: size, height: size, channels: 3, background: colour } })
    .png()
    .toFile(file)
  return file
}

async function setup(): Promise<{ root: string; sessionId: string }> {
  env = await createEnv()
  registerMediaIpc(env.ctx)
  const root = path.join(env.base, 'in')
  await png(path.join(root, 'seed.png'), '#000000')
  const session = await env.ok<Session>('session:open', { dir: root, kind: 'image' })
  return { root, sessionId: session.id }
}

async function edit(sessionId: string, file: string): Promise<ImageEditResult> {
  return env.ok<ImageEditResult>('media:imageEdit', { sessionId, path: file, edit: CROP })
}

async function restore(sessionId: string, file: string): Promise<ImageRestoreResult> {
  return env.ok<ImageRestoreResult>('media:imageRestoreBackup', { sessionId, path: file })
}

describe('backup identity (review H3)', () => {
  it('a new image with the same name gets its own backup; restore never uses the stale one', async () => {
    const { root, sessionId } = await setup()
    const file = path.join(root, 'IMG_0001.jpg')
    await png(file, '#ff0000')
    const first = await edit(sessionId, file)
    expect(first.backupCreated).toBe(true)
    const oldBackup = await readFile(first.backupPath)

    // The camera writes a different IMG_0001.jpg later (the old one was moved away).
    const blue = await sharp({ create: { width: 60, height: 60, channels: 3, background: '#0000ff' } }).png().toBuffer()
    await writeFile(file, blue)
    const second = await edit(sessionId, file)
    expect(second.backupCreated).toBe(true)
    expect(second.backupPath).not.toBe(first.backupPath)
    expect(await readFile(first.backupPath)).toEqual(oldBackup)
    expect(await readFile(second.backupPath)).toEqual(blue)

    const restored = await restore(sessionId, file)
    expect(restored.restored).toBe(true)
    expect(await readFile(file)).toEqual(blue)
    expect(existsSync(second.backupPath)).toBe(false)
    expect(existsSync(first.backupPath)).toBe(true)
  })

  it('re-editing the same image keeps the first original', async () => {
    const { root, sessionId } = await setup()
    const file = await png(path.join(root, 'a.png'), '#336699')
    const original = await readFile(file)
    const first = await edit(sessionId, file)
    const second = await edit(sessionId, file)
    expect(second.backupCreated).toBe(false)
    expect(second.backupPath).toBe(first.backupPath)
    expect(await readFile(second.backupPath)).toEqual(original)
    expect((await restore(sessionId, file)).restored).toBe(true)
    expect(await readFile(file)).toEqual(original)
  })

  it('refuses to restore when the file changed after our last edit (stale backup)', async () => {
    const { root, sessionId } = await setup()
    const file = await png(path.join(root, 'b.png'), '#336699')
    const edited = await edit(sessionId, file)
    const replacement = await sharp({ create: { width: 30, height: 30, channels: 3, background: '#00ff00' } }).png().toBuffer()
    await writeFile(file, replacement)
    const res = await env.call('media:imageRestoreBackup', { sessionId, path: file })
    expect(res).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(await readFile(file)).toEqual(replacement)
    expect(existsSync(edited.backupPath)).toBe(true)
  })

  it('refuses a legacy backup of unknown origin, and reports "no backup" when there is none', async () => {
    const { root, sessionId } = await setup()
    const file = await png(path.join(root, 'c.png'), '#336699')
    expect(await restore(sessionId, file)).toMatchObject({ restored: false, backupPath: null })
    await touch(path.join(root, 'bkp', 'c.png'), 'someone else')
    const res = await env.call('media:imageRestoreBackup', { sessionId, path: file })
    expect(res).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(await readFile(path.join(root, 'bkp', 'c.png'), 'utf8')).toBe('someone else')
  })

  it('an unrelated pre-existing bkp/<name> is never overwritten: a numbered copy is made', async () => {
    const { root, sessionId } = await setup()
    const file = await png(path.join(root, 'd.png'), '#336699')
    await touch(path.join(root, 'bkp', 'd.png'), 'old')
    const res = await edit(sessionId, file)
    expect(path.basename(res.backupPath)).toBe('d (1).png')
    expect(await readFile(path.join(root, 'bkp', 'd.png'), 'utf8')).toBe('old')
    expect((await readdir(path.join(root, 'bkp'))).sort()).toEqual(['d (1).png', 'd.png'])
  })

  it('refuses an edit outside the session folder and through a junction (M3)', async () => {
    const { root, sessionId } = await setup()
    const outside = await png(path.join(env.base, 'elsewhere', 'x.png'), '#ffffff')
    expect(await env.call('media:imageEdit', { sessionId, path: outside, edit: CROP })).toMatchObject({
      ok: false,
      error: { code: 'PATH_NOT_ALLOWED' }
    })
    const { symlink } = await import('node:fs/promises')
    await symlink(path.dirname(outside), path.join(root, 'link'), 'junction')
    expect(
      await env.call('media:imageEdit', { sessionId, path: path.join(root, 'link', 'x.png'), edit: CROP })
    ).toMatchObject({ ok: false, error: { code: 'PATH_NOT_ALLOWED' } })
  })
})

describe('write format follows the content (review M4, checklist 37)', () => {
  it('a JPEG named .png stays a JPEG', async () => {
    const { root, sessionId } = await setup()
    const file = path.join(root, 'liar.png')
    await sharp({ create: { width: 60, height: 60, channels: 3, background: '#336699' } }).jpeg().toFile(file)
    await edit(sessionId, file)
    expect((await sharp(file).metadata()).format).toBe('jpeg')
  })

  it('a PNG named .jpg stays a PNG; an unreadable file is a VALIDATION error before any backup', async () => {
    const { root, sessionId } = await setup()
    const file = path.join(root, 'liar.jpg')
    await sharp({ create: { width: 60, height: 60, channels: 3, background: '#336699' } }).png().toFile(file)
    await edit(sessionId, file)
    expect((await sharp(file).metadata()).format).toBe('png')
    const broken = await touch(path.join(root, 'broken.png'), 'not an image')
    expect(await env.call('media:imageEdit', { sessionId, path: broken, edit: CROP })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' }
    })
    expect(existsSync(path.join(root, 'bkp', 'broken.png'))).toBe(false)
  })

  it('an embedded ICC profile is converted to sRGB instead of being dropped', async () => {
    const { root, sessionId } = await setup()
    const file = path.join(root, 'p3.jpg')
    await sharp({ create: { width: 60, height: 60, channels: 3, background: '#c86432' } })
      .withIccProfile('p3')
      .jpeg({ quality: 100 })
      .toFile(file)
    expect((await sharp(file).metadata()).icc).toBeDefined()
    await edit(sessionId, file)
    const { data } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
    // P3 (200,100,50) is more saturated than sRGB, so the red channel must change when converted.
    expect(data[0]).not.toBe(200)
  })
})
