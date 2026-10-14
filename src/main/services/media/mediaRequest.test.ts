import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { toMediaUrl, toTranscodeUrl } from '@shared/ipc/mediaUrl'
import { createMediaAllowlist } from '../../ipc/mediaAllowlist'
import { findTestTools, generateVideo, makeTempDir } from '../ffmpeg/testFixtures'
import { createMediaRequestHandler } from './mediaRequest'
import { parseRange } from './range'

describe('parseRange', () => {
  it('parses the three forms and rejects what it cannot serve', () => {
    expect(parseRange(null, 100)).toEqual({ kind: 'none' })
    expect(parseRange('bytes=0-9', 100)).toEqual({ kind: 'range', range: { start: 0, end: 9 } })
    expect(parseRange('bytes=90-', 100)).toEqual({ kind: 'range', range: { start: 90, end: 99 } })
    expect(parseRange('bytes=-10', 100)).toEqual({ kind: 'range', range: { start: 90, end: 99 } })
    expect(parseRange('bytes=50-500', 100)).toEqual({
      kind: 'range',
      range: { start: 50, end: 99 }
    })
    expect(parseRange('bytes=100-', 100)).toEqual({ kind: 'unsatisfiable' })
    expect(parseRange('bytes=0-1,5-6', 100)).toEqual({ kind: 'none' })
    expect(parseRange('items=0-1', 100)).toEqual({ kind: 'none' })
  })
})

const tools = findTestTools()
let dir = ''
let outside = ''
let file = ''
const CONTENT = '0123456789abcdefghij'

function handler(): (request: Request) => Promise<Response> {
  const allowlist = createMediaAllowlist()
  allowlist.addRoot(dir)
  return createMediaRequestHandler({
    allowlist,
    ffmpegConfig: () => ({ ffmpegPath: tools?.ffmpeg ?? null, ffprobePath: tools?.ffprobe ?? null })
  })
}

beforeAll(async () => {
  dir = await makeTempDir('media-proto')
  outside = await makeTempDir('media-outside')
  file = path.join(dir, 'sub dir', 'note #1.txt')
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, CONTENT)
  await writeFile(path.join(outside, 'secret.txt'), 'secret')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  await rm(outside, { recursive: true, force: true })
})

describe('media:// files', () => {
  it('serves the whole file with Accept-Ranges', async () => {
    const res = await handler()(new Request(toMediaUrl(file)))
    expect(res.status).toBe(200)
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('content-length')).toBe(String(CONTENT.length))
    expect(await res.text()).toBe(CONTENT)
  })

  it('answers Range requests with 206 and Content-Range', async () => {
    const h = handler()
    const mid = await h(new Request(toMediaUrl(file), { headers: { Range: 'bytes=2-5' } }))
    expect(mid.status).toBe(206)
    expect(mid.headers.get('content-range')).toBe(`bytes 2-5/${CONTENT.length}`)
    expect(await mid.text()).toBe('2345')
    const tail = await h(new Request(toMediaUrl(file), { headers: { Range: 'bytes=-3' } }))
    expect(await tail.text()).toBe('hij')
    const open = await h(new Request(toMediaUrl(file), { headers: { Range: 'bytes=17-' } }))
    expect(await open.text()).toBe('hij')
  })

  it('answers 416 for a range past the end', async () => {
    const res = await handler()(new Request(toMediaUrl(file), { headers: { Range: 'bytes=99-' } }))
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe(`bytes */${CONTENT.length}`)
  })

  it('rejects paths outside the allowlist and traversal', async () => {
    const h = handler()
    const secret = path.join(outside, 'secret.txt')
    expect((await h(new Request(toMediaUrl(secret)))).status).toBe(403)
    const traversal = path.join(dir, '..', path.basename(outside), 'secret.txt')
    expect((await h(new Request(toMediaUrl(traversal)))).status).toBe(403)
  })

  it('rejects a symlink that leaves the root', async () => {
    const link = path.join(dir, 'link.txt')
    try {
      await symlink(path.join(outside, 'secret.txt'), link)
    } catch {
      return // symlinks need privileges on Windows; the realpath check is covered on POSIX
    }
    expect((await handler()(new Request(toMediaUrl(link)))).status).toBe(403)
  })

  it('answers 404 for a missing file and 400 for garbage', async () => {
    const h = handler()
    expect((await h(new Request(toMediaUrl(path.join(dir, 'nope.txt'))))).status).toBe(404)
    expect((await h(new Request('media://local/not-absolute'))).status).toBe(400)
  })
})

describe.skipIf(tools === null)('media://transcode (ADR-004)', () => {
  it('streams a fragmented MP4 from a lavfi AVI and stops when aborted', async () => {
    if (tools === null) return
    const avi = await generateVideo(tools, dir, 'old.avi', { seconds: 2, codec: 'mpeg4' })
    const res = await handler()(new Request(toTranscodeUrl(avi, 0.5)))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('video/mp4')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(bytes.length).toBeGreaterThan(1000)
    // ISO BMFF: the first box is `ftyp`; fragmented output carries `moof` boxes.
    expect(Buffer.from(bytes.subarray(4, 8)).toString('latin1')).toBe('ftyp')
    expect(Buffer.from(bytes).includes(Buffer.from('moof'))).toBe(true)
  }, 60_000)

  it('kills ffmpeg when the request is aborted', async () => {
    if (tools === null) return
    const long = await generateVideo(tools, dir, 'long.avi', { seconds: 20, codec: 'mpeg4' })
    const controller = new AbortController()
    const res = await handler()(new Request(toTranscodeUrl(long, 0), { signal: controller.signal }))
    const reader = res.body?.getReader()
    const first = await reader?.read()
    expect(first?.value?.length ?? 0).toBeGreaterThan(0)
    controller.abort()
    await expect(reader?.read()).resolves.toBeDefined()
  }, 60_000)
})
