import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseHashCsv } from '@shared/core/hashCsv'
import { HASH_CSV_COLUMNS, type HashProgress } from '@shared/domain/hash'
import { findTestTools, generateVideo, makeTempDir } from '../ffmpeg/testFixtures'
import { buildHashCsv } from './build'
import { csvPathFor, isTsOrigin } from './csvStore'
import { writePattern } from './testImages'
import { createTsHashProvider } from './tsProvider'
import { walkFiles } from './walk'
import { acceptsFile } from './kinds'

const md5 = (d: Uint8Array): string => createHash('md5').update(d).digest('hex')
const tools = findTestTools()
const provider = createTsHashProvider({
  md5,
  tools: () => {
    if (tools === null) throw new Error('no ffmpeg')
    return { ffmpegPath: tools.ffmpeg, ffprobePath: tools.ffprobe }
  }
})

let parent = ''
let scan = ''

beforeEach(async () => {
  parent = await makeTempDir('hash-build')
  scan = path.join(parent, 'photos')
  await mkdir(path.join(scan, 'sub'), { recursive: true })
  await mkdir(path.join(scan, '.hidden'), { recursive: true })
  await mkdir(path.join(scan, 'md5Purge'), { recursive: true })
})
afterEach(async () => {
  await rm(parent, { recursive: true, force: true })
})

async function populate(): Promise<void> {
  await writePattern(scan, 'b.png', 'png')
  await writePattern(scan, 'a.png', 'png')
  await writePattern(path.join(scan, 'sub'), 'c.jpg', 'jpeg')
  await writePattern(path.join(scan, '.hidden'), 'd.png', 'png')
  await writePattern(path.join(scan, 'md5Purge'), 'skip.png', 'png')
  await writeFile(path.join(scan, 'notes.txt'), 'not media')
  await writeFile(path.join(scan, 'bad.jpg'), 'definitely not a jpeg')
}

const base = { excludeNames: ['md5Purge', 'ruimFolder', 'bkp', '.mediamaloi'] }

describe('file kinds (item 1) and walk (item 2)', () => {
  it('accepts by lower-cased extension of the name only', () => {
    expect(acceptsFile('image', 'A.JPG')).toBe(true)
    expect(acceptsFile('image', 'a.mp4')).toBe(false)
    expect(acceptsFile('video', 'x.MKV')).toBe(true)
    expect(acceptsFile('video', 'clip.3gp.txt')).toBe(false)
    expect(acceptsFile('gif', 'a.gif')).toBe(true)
    expect(acceptsFile('gif', 'a.png')).toBe(false)
  })

  it('is recursive, includes hidden folders, skips exclusions, files before sub-folders, sorted', async () => {
    await populate()
    const { files } = await walkFiles(scan, {
      accept: (n) => acceptsFile('image', n),
      excludeNames: ['MD5PURGE'],
      excludePaths: []
    })
    const rel = files.map((f) => path.relative(scan, f.path).replaceAll('\\', '/'))
    expect(rel).toEqual(['a.png', 'b.png', 'bad.jpg', '.hidden/d.png', 'sub/c.jpg'])
    expect(files[0]?.root).toBe(scan)
  })

  it('skips an excluded absolute path', async () => {
    await populate()
    const { files } = await walkFiles(scan, {
      accept: () => true,
      excludeNames: [],
      excludePaths: [path.join(scan, 'sub')]
    })
    expect(files.some((f) => f.path.includes(`${path.sep}sub${path.sep}`))).toBe(false)
  })
})

describe('buildHashCsv (items 3-9)', () => {
  it('writes <prefix>resultsMD5.txt in the PARENT with the legacy header, rows in walk order', async () => {
    await populate()
    const out = await buildHashCsv({
      dir: scan,
      kind: 'image',
      taskId: 't1',
      provider,
      ...base
    })
    expect(out.csvPath).toBe(path.join(parent, 'img_resultsMD5.txt'))
    expect(out.csvPath).toBe(csvPathFor(scan, 'image'))
    expect(out).toMatchObject({ fileCount: 5, rowCount: 5, failedCount: 1, cancelled: false })
    const text = await readFile(out.csvPath, 'utf8')
    expect(text.split('\r\n')[0]).toBe(HASH_CSV_COLUMNS.join(','))
    expect(text.endsWith('\r\n')).toBe(true)
    const rows = parseHashCsv(text)
    expect(rows.map((r) => r.inFile)).toEqual(['a.png', 'b.png', 'bad.jpg', 'd.png', 'c.jpg'])
  })

  it('md5 is the md5 of the file bytes and sizeFile its byte size', async () => {
    await populate()
    const out = await buildHashCsv({ dir: scan, kind: 'image', taskId: 't2', provider, ...base })
    const rows = parseHashCsv(await readFile(out.csvPath, 'utf8'))
    const a = rows.find((r) => r.inFile === 'a.png')
    const bytes = await readFile(path.join(scan, 'a.png'))
    expect(a?.md5).toBe(md5(bytes))
    expect(a?.sizeFile).toBe(bytes.length)
    expect(a?.worksdWell).toBe(true)
    expect(a?.root).toBe(scan)
  })

  it('a failing file gets one failure row with empty hashes and the real size (item 7)', async () => {
    await populate()
    const out = await buildHashCsv({ dir: scan, kind: 'image', taskId: 't3', provider, ...base })
    const rows = parseHashCsv(await readFile(out.csvPath, 'utf8'))
    const bad = rows.find((r) => r.inFile === 'bad.jpg')
    expect(bad).toMatchObject({
      md5: null,
      pureMD5: null,
      hash16: null,
      worksdWell: false,
      sizeFile: 'definitely not a jpeg'.length
    })
    expect(bad?.comments).toMatch(/^Not (iddentify is|complete) image/)
  })

  it('identical files share every key (so they group)', async () => {
    await populate()
    await writePattern(scan, 'copy.png', 'png')
    const out = await buildHashCsv({ dir: scan, kind: 'image', taskId: 't4', provider, ...base })
    const rows = parseHashCsv(await readFile(out.csvPath, 'utf8'))
    const a = rows.find((r) => r.inFile === 'a.png')
    const copy = rows.find((r) => r.inFile === 'copy.png')
    expect({ ...copy, root: '', inFile: '', path: '' }).toEqual({ ...a, root: '', inFile: '', path: '' })
  })

  it('leaves no temp file, writes the origin sidecar, ends progress with done (item 9)', async () => {
    await populate()
    const events: HashProgress[] = []
    const out = await buildHashCsv({
      dir: scan,
      kind: 'image',
      taskId: 't5',
      provider,
      onProgress: (p) => events.push(p),
      progressIntervalMs: 1_000_000,
      ...base
    })
    await expect(stat(`${out.csvPath}.tmp`)).rejects.toThrow()
    expect(await isTsOrigin(out.csvPath)).toBe(true)
    expect(events[0]?.phase).toBe('scanning')
    const last = events.at(-1)
    expect(last).toMatchObject({ phase: 'done', done: 5, total: 5, failed: 1, taskId: 't5' })
    expect(events.map((e) => e.phase)).toEqual(['scanning', 'hashing', 'writing', 'done'])
  })

  it('cancellation leaves no CSV and reports cancelled (item 4)', async () => {
    await populate()
    const controller = new AbortController()
    controller.abort()
    const out = await buildHashCsv({
      dir: scan,
      kind: 'image',
      taskId: 't6',
      provider,
      signal: controller.signal,
      ...base
    })
    expect(out.cancelled).toBe(true)
    await expect(stat(out.csvPath)).rejects.toThrow()
    await expect(stat(`${out.csvPath}.tmp`)).rejects.toThrow()
  })

  it('cancelling mid-scan removes the partial file', async () => {
    await populate()
    const controller = new AbortController()
    const out = await buildHashCsv({
      dir: scan,
      kind: 'image',
      taskId: 't7',
      provider,
      signal: controller.signal,
      concurrency: 1,
      onProgress: (p) => {
        if (p.phase === 'hashing' && p.done >= 1) controller.abort()
      },
      progressIntervalMs: 0,
      ...base
    })
    expect(out.cancelled).toBe(true)
    await expect(stat(out.csvPath)).rejects.toThrow()
    await expect(stat(`${out.csvPath}.tmp`)).rejects.toThrow()
  })

  it('rejects a missing folder with NOT_FOUND', async () => {
    await expect(
      buildHashCsv({ dir: path.join(parent, 'nope'), kind: 'image', taskId: 't8', provider })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('a trailing separator still puts the CSV in the parent (legacy trap a)', async () => {
    await writePattern(scan, 'a.png', 'png')
    const out = await buildHashCsv({
      dir: scan + path.sep,
      kind: 'image',
      taskId: 't9',
      provider,
      ...base
    })
    expect(path.dirname(out.csvPath)).toBe(parent)
  })
})

describe.skipIf(tools === null)('video scan (lavfi)', () => {
  it('one row per kept frame; only the perceptual columns differ (item 6)', async () => {
    if (tools === null) return
    const vids = path.join(parent, 'vids')
    await mkdir(vids)
    await generateVideo(tools, vids, 'clip.mp4', { seconds: 3, audio: false })
    const out = await buildHashCsv({ dir: vids, kind: 'video', taskId: 'v1', provider })
    const rows = parseHashCsv(await readFile(out.csvPath, 'utf8'))
    expect(out.csvPath).toBe(path.join(parent, 'vdo_resultsMD5.txt'))
    expect(rows.length).toBeGreaterThanOrEqual(3)
    expect(out.rowCount).toBe(rows.length)
    expect(new Set(rows.map((r) => r.md5)).size).toBe(1)
    expect(new Set(rows.map((r) => r.sizeFile)).size).toBe(1)
    expect(new Set(rows.map((r) => r.pureMD5)).size).toBeGreaterThan(1)
    expect(rows.every((r) => r.worksdWell)).toBe(true)
  })

  it('a video that cannot be decoded gets a failure row', async () => {
    if (tools === null) return
    const vids = path.join(parent, 'vids2')
    await mkdir(vids)
    await writeFile(path.join(vids, 'broken.mp4'), 'not a video')
    const out = await buildHashCsv({ dir: vids, kind: 'video', taskId: 'v2', provider })
    const rows = parseHashCsv(await readFile(out.csvPath, 'utf8'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ worksdWell: false, md5: null })
    expect(out.failedCount).toBe(1)
  })
})
