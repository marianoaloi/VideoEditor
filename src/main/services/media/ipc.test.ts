import { copyFile, readFile, rm, stat, truncate, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/domain/settings'
import type { JournalEntry } from '@shared/domain/fileops'
import type { InvokeChannel, InvokeRequest, InvokeResponse } from '@shared/ipc/contract'
import {
  createMainContext,
  createSettingsAccess,
  type MainContext,
  type NewJournalEntry
} from '../../ipc/context'
import { dispatch, resetHandlers } from '../../ipc/handle'
import { createMediaAllowlist } from '../../ipc/mediaAllowlist'
import { findTestTools, generateImage, generateVideo, makeTempDir } from '../ffmpeg/testFixtures'
import { registerMediaIpc } from './ipc'
import { createPreviewService, hasTrailer } from './preview'
import { tileFrameIndexes, MOSAIC_SIZE } from './mosaic'
import { tenPercentCandidates } from './frames'

const tools = findTestTools()
let work = ''
let ctx: MainContext
const journal: { root: string; entry: NewJournalEntry; sessionId: string | null }[] = []
const events: unknown[] = []

async function call<C extends InvokeChannel>(
  channel: C,
  req: InvokeRequest<C>
): Promise<InvokeResponse<C>> {
  const res = await dispatch(channel, req)
  if (!res.ok) throw new Error(`${channel}: ${res.error.code} ${res.error.message}`)
  return res.data as InvokeResponse<C>
}

async function callError<C extends InvokeChannel>(
  channel: C,
  req: InvokeRequest<C>
): Promise<string> {
  const res = await dispatch(channel, req)
  return res.ok ? 'ok' : res.error.code
}

beforeAll(async () => {
  work = await makeTempDir('media-svc')
  const base = {
    ...DEFAULT_SETTINGS,
    ffmpeg: {
      ...DEFAULT_SETTINGS.ffmpeg,
      ffmpegPath: tools?.ffmpeg ?? null,
      ffprobePath: tools?.ffprobe ?? null
    },
    thumbs: { ...DEFAULT_SETTINGS.thumbs, cacheDir: path.join(work, 'cache') }
  }
  ctx = createMainContext({
    getWindow: () => null,
    settings: createSettingsAccess(base),
    allowlist: createMediaAllowlist(),
    paths: { userData: path.join(work, 'userData'), temp: path.join(work, 'temp') },
    trashItem: () => Promise.resolve(),
    newId: () => Math.random().toString(36).slice(2)
  })
  const sessionRoot = path.join(work, 'session')
  ctx.services.provide('sessions', {
    get: () => undefined,
    require: (id) => ({
      id,
      root: sessionRoot,
      recursive: false,
      kind: 'any',
      sort: 'name',
      openedAt: 0
    }),
    itemFor: () => Promise.resolve(null)
  })
  ctx.services.provide('journal', {
    record: (root, entry, sessionId) => {
      journal.push({ root, entry, sessionId })
      return Promise.resolve({
        ...entry,
        id: `j${journal.length}`,
        ts: 1,
        sessionId
      } satisfies JournalEntry)
    }
  })
  registerMediaIpc(ctx)
  await import('node:fs/promises').then((fs) => fs.mkdir(sessionRoot, { recursive: true }))
})

afterEach(() => {
  journal.length = 0
  events.length = 0
})

afterAll(async () => {
  resetHandlers()
  await rm(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
})

describe('pure helpers', () => {
  it('tileFrameIndexes: 16 tiles skipping 10 s at both ends, or the whole clip when short', () => {
    const long = tileFrameIndexes(2500, 25)
    expect(long).toHaveLength(16)
    expect(long[0]).toBe(250)
    expect(tileFrameIndexes(10, 25)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(tileFrameIndexes(1, 25)).toEqual([0])
  })

  it('tenPercentCandidates matches the legacy vectors (60 s and 4 s)', () => {
    expect(tenPercentCandidates(60000)).toEqual([6000, 5825, 0, 1000, 2000, 3000, 4000])
    expect(tenPercentCandidates(4000)).toEqual([400, 388, 0, 1000, 2000, 3000])
  })
})

describe.skipIf(tools === null)('media:probe / grabFrame / mosaic / black bars', () => {
  let video = ''

  beforeAll(async () => {
    if (tools === null) return
    video = await generateVideo(tools, work, 'clip.mp4', { seconds: 4, width: 320, height: 180 })
    ctx.allowlist.addRoot(work)
  })

  it('probes and caches', async () => {
    const info = await call('media:probe', { path: video })
    expect(info.hasVideo).toBe(true)
    expect(info.width).toBe(320)
    const many = await call('media:probeMany', { paths: [video, path.join(work, 'missing.mp4')] })
    expect(many.results.map((r) => r.ok)).toEqual([true, false])
    expect(await callError('media:probe', { path: path.join(work, 'nope.mp4') })).toBe(
      'PROBE_FAILED'
    )
  })

  it('grabs a frame at source size into an allowlisted temp file', async () => {
    const frame = await call('media:grabFrame', { path: video, atMs: 1500 })
    expect(frame.width).toBe(320)
    expect(frame.height).toBe(180)
    expect(ctx.allowlist.isAllowed(frame.path)).toBe(true)
    expect((await sharp(frame.path).metadata()).format).toBe('jpeg')
    const small = await call('media:grabFrame', {
      path: video,
      atMs: 0,
      format: 'png',
      maxWidth: 160
    })
    expect(small.width).toBe(160)
  })

  it('falls back to the 10 % frame when the position is past the end', async () => {
    const frame = await call('media:grabFrame', { path: video, atMs: 999_000 })
    expect(frame.width).toBe(320)
  })

  it('builds a 4x4 mosaic of 300x300, caches it by content and rebuilds on force', async () => {
    const first = await call('media:mosaic', { path: video })
    expect(first.width).toBe(MOSAIC_SIZE)
    expect(first.height).toBe(MOSAIC_SIZE)
    expect(path.extname(first.path)).toBe('.jpeg')
    expect(ctx.allowlist.isAllowed(first.path)).toBe(true)
    const meta = await sharp(first.path).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 300, 300])
    const before = (await stat(first.path)).mtimeMs
    const copy = path.join(work, 'renamed copy.mp4')
    await copyFile(video, copy)
    const second = await call('media:mosaic', { path: copy })
    expect(second.path).toBe(first.path)
    expect((await stat(first.path)).mtimeMs).toBe(before)
    await call('media:mosaic', { path: video, force: true })
    expect((await stat(first.path)).mtimeMs).toBeGreaterThanOrEqual(before)
  }, 60_000)

  it('generateMosaics reports progress and the totals; cancelTask is a no-op when unknown', async () => {
    const result = await call('media:generateMosaics', {
      taskId: 't-1',
      paths: [video, path.join(work, 'missing.mp4')]
    })
    expect(result).toEqual({ taskId: 't-1', done: 1, failed: 1, cancelled: false })
    await expect(call('media:cancelTask', { taskId: 'unknown' })).resolves.toBeUndefined()
    await expect(call('media:prefetch', { paths: [video], what: ['probe'] })).resolves.toEqual({
      queued: 1
    })
  }, 60_000)

  it('detects black bars on a synthetic letterboxed frame', async () => {
    if (tools === null) return
    const boxed = path.join(work, 'boxed.mp4')
    const { run } = await import('../process/run')
    const r = await run({
      command: tools.ffmpeg,
      args: [
        ...[
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-f',
          'lavfi',
          '-i',
          'color=c=white:s=200x100:d=2:r=10'
        ],
        ...['-vf', 'pad=320:240:60:70:black', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', boxed]
      ]
    })
    expect(r.exitCode).toBe(0)
    const rect = await call('media:detectBlackBars', { path: boxed, atMs: 500 })
    expect(Math.abs(rect.x - 60)).toBeLessThanOrEqual(2)
    expect(Math.abs(rect.y - 70)).toBeLessThanOrEqual(2)
    expect(Math.abs(rect.w - 200)).toBeLessThanOrEqual(3)
    expect(Math.abs(rect.h - 100)).toBeLessThanOrEqual(3)
  })

  it('detects bars on an image file too', async () => {
    const img = path.join(work, 'bars.png')
    const solid = await sharp({
      create: { width: 100, height: 50, channels: 3, background: '#ffffff' }
    })
      .png()
      .toBuffer()
    await sharp({ create: { width: 160, height: 90, channels: 3, background: '#000000' } })
      .composite([{ input: solid, left: 30, top: 20 }])
      .png()
      .toFile(img)
    expect(await call('media:detectBlackBars', { path: img })).toEqual({
      x: 30,
      y: 20,
      w: 100,
      h: 50
    })
  })
})

describe('image edits (ADR-006)', () => {
  let session = ''
  const sessionId = 's1'

  async function makePng(name: string, w = 120, h = 80): Promise<string> {
    session = path.join(work, 'session')
    const file = path.join(session, name)
    await sharp({ create: { width: w, height: h, channels: 3, background: '#336699' } })
      .png()
      .toFile(file)
    return file
  }

  it('crop: backs up first, keeps the first original, journals a write that names the backup', async () => {
    const file = await makePng('crop.png')
    const original = await readFile(file)
    const res = await call('media:imageEdit', {
      sessionId,
      path: file,
      edit: { crop: { x: 10, y: 10, w: 50, h: 30 }, bright: null, contrast: null, transpose: null }
    })
    expect([res.width, res.height, res.backupCreated]).toEqual([50, 30, true])
    expect(res.backupPath).toBe(path.join(session, 'bkp', 'crop.png'))
    expect(await readFile(res.backupPath)).toEqual(original)
    expect(journal).toHaveLength(1)
    expect(journal[0]?.entry).toMatchObject({
      op: 'write',
      from: file,
      to: file,
      undoable: false,
      backup: res.backupPath
    })
    const second = await call('media:imageEdit', {
      sessionId,
      path: file,
      edit: { crop: { x: 0, y: 0, w: 20, h: 20 }, bright: null, contrast: null, transpose: null }
    })
    expect(second.backupCreated).toBe(false)
    expect(await readFile(second.backupPath)).toEqual(original)
    expect((await sharp(file).metadata()).width).toBe(20)
  })

  it('crop then restore round-trips to the original pixels and consumes the backup (checklist 41)', async () => {
    const file = await makePng('round.png')
    const original = await readFile(file)
    await call('media:imageEdit', {
      sessionId,
      path: file,
      edit: { crop: { x: 5, y: 5, w: 40, h: 40 }, bright: null, contrast: null, transpose: null }
    })
    const restored = await call('media:imageRestoreBackup', { sessionId, path: file })
    expect(restored.restored).toBe(true)
    expect(await readFile(file)).toEqual(original)
    await expect(stat(path.join(session, 'bkp', 'round.png'))).rejects.toThrow()
    expect(journal.at(-1)?.entry.backup).toBe(restored.backupPath)
    const none = await call('media:imageRestoreBackup', {
      sessionId,
      path: await makePng('fresh.png')
    })
    expect(none).toMatchObject({ restored: false, backupPath: null })
  })

  it('rotate ccw90 swaps the canvas and moves the top-right corner to the top-left', async () => {
    const file = path.join(work, 'session', 'rot.png')
    const red = await sharp({
      create: { width: 20, height: 20, channels: 3, background: '#ff0000' }
    })
      .png()
      .toBuffer()
    await sharp({ create: { width: 120, height: 80, channels: 3, background: '#000000' } })
      .composite([{ input: red, left: 100, top: 0 }])
      .png()
      .toFile(file)
    const res = await call('media:imageRotate', { sessionId, path: file, rotation: 'ccw90' })
    expect([res.width, res.height]).toEqual([80, 120])
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
    expect(info.channels).toBeGreaterThanOrEqual(3)
    expect([data[0], data[1], data[2]]).toEqual([255, 0, 0])
  })

  it('adjust-only applies brightness; neutral edits and bad requests change nothing', async () => {
    const file = await makePng('adj.png')
    await call('media:imageEdit', {
      sessionId,
      path: file,
      edit: { crop: null, bright: 0.2, contrast: null, transpose: null }
    })
    const { data } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
    expect(data[0]).toBeGreaterThan(0x33 + 40)
    const other = await makePng('neutral.png')
    expect(
      await callError('media:imageEdit', {
        sessionId,
        path: other,
        edit: { crop: null, bright: 0, contrast: 1, transpose: 0 }
      })
    ).toBe('VALIDATION')
    expect(
      await callError('media:imageEdit', {
        sessionId,
        path: other,
        edit: {
          crop: { x: 500, y: 0, w: 10, h: 10 },
          bright: null,
          contrast: null,
          transpose: null
        }
      })
    ).toBe('VALIDATION')
    await expect(stat(path.join(session, 'bkp', 'neutral.png'))).rejects.toThrow()
  })

  it('refuses non-editable formats and paths outside the session before touching anything', async () => {
    const gif = path.join(work, 'session', 'a.gif')
    await writeFile(gif, 'GIF89a')
    expect(await callError('media:imageRotate', { sessionId, path: gif, rotation: 'cw90' })).toBe(
      'VALIDATION'
    )
    await expect(stat(path.join(work, 'session', 'bkp', 'a.gif'))).rejects.toThrow()
    const outside = path.join(work, 'elsewhere.png')
    await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } })
      .png()
      .toFile(outside)
    expect(
      await callError('media:imageRotate', { sessionId, path: outside, rotation: 'cw90' })
    ).toBe('PATH_NOT_ALLOWED')
  })

  it('free rotation keeps the canvas size', async () => {
    const file = await makePng('free.png', 100, 60)
    const res = await call('media:imageEdit', {
      sessionId,
      path: file,
      edit: { crop: null, bright: null, contrast: null, transpose: -45 }
    })
    expect([res.width, res.height]).toEqual([100, 60])
  })
})

describe('converted preview (image-triage §5)', () => {
  it('leaves good files alone and converts a truncated JPEG without touching it', async () => {
    const good = path.join(work, 'good.jpg')
    await sharp({ create: { width: 64, height: 48, channels: 3, background: '#abcdef' } })
      .jpeg()
      .toFile(good)
    const previews = createPreviewService(ctx)
    expect(await hasTrailer(good)).toBe(true)
    expect(await previews.preview(good)).toEqual({ reason: null, preview: null })
    const bad = path.join(work, 'bad.jpg')
    await copyFile(good, bad)
    const size = (await stat(bad)).size
    await truncate(bad, size - 2)
    const before = await readFile(bad)
    const result = await previews.preview(bad)
    expect(result.reason).toBe('trailer-missing')
    expect(result.preview?.width).toBe(64)
    expect(ctx.allowlist.isAllowed(result.preview?.path ?? '')).toBe(true)
    expect(await readFile(bad)).toEqual(before)
    expect((await previews.preview(good, true)).reason).toBe('forced')
  })
})

describe.skipIf(tools === null)('fixtures', () => {
  it('generateImage fixture decodes', async () => {
    if (tools === null) return
    const img = await generateImage(tools, work, 'fx.png', { width: 32, height: 16 })
    expect((await sharp(img).metadata()).width).toBe(32)
  })
})
