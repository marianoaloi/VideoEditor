import { createHash } from 'node:crypto'
import { copyFile, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PerceptualKeys } from '@shared/core/hashPrimitives'
import { findTestTools, generateVideo, makeTempDir } from '../ffmpeg/testFixtures'
import {
  createTsHashProvider,
  decodeImage,
  frameIndices,
  readTail,
  usesColourPath
} from './tsProvider'
import { writePattern } from './testImages'

const md5 = (d: Uint8Array): string => createHash('md5').update(d).digest('hex')
const tools = findTestTools()
const provider = createTsHashProvider({
  md5,
  tools: () => {
    if (tools === null) throw new Error('no ffmpeg')
    return { ffmpegPath: tools.ffmpeg, ffprobePath: tools.ffprobe }
  }
})

function hamming(a: string, b: string): number {
  let bits = 0
  for (let i = 0; i < a.length; i++) {
    const x = Number.parseInt(a.charAt(i), 16) ^ Number.parseInt(b.charAt(i), 16)
    bits += x.toString(2).replaceAll('0', '').length
  }
  return bits
}

let dir = ''
beforeAll(async () => {
  dir = await makeTempDir('hash-provider')
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function keysOf(file: string): Promise<PerceptualKeys> {
  const [k] = await provider.hashImage(file)
  if (k === undefined) throw new Error('no keys')
  return k
}

describe('trailer test (item 10)', () => {
  it('FF D9 and 60 82 take the colour path, anything else the grey path', () => {
    expect(usesColourPath(Buffer.from([0xff, 0xd9]))).toBe(true)
    expect(usesColourPath(Buffer.from([0x60, 0x82]))).toBe(true)
    expect(usesColourPath(Buffer.from([0x00, 0x3b]))).toBe(false)
    expect(usesColourPath(Buffer.from([0xd9]))).toBe(false)
  })

  it('readTail reads 2 bytes, or what exists for a 1-byte file', async () => {
    const one = path.join(dir, 'one.bin')
    await writeFile(one, Buffer.from([0x41]))
    expect([...(await readTail(one))]).toEqual([0x41])
    const png = await writePattern(dir, 'tail.png', 'png')
    expect([...(await readTail(png))]).toEqual([0x60, 0x82])
    const jpg = await writePattern(dir, 'tail.jpg', 'jpeg')
    expect([...(await readTail(jpg))]).toEqual([0xff, 0xd9])
  })
})

describe('image keys', () => {
  it('shapes: hash8 16 hex, hash16 64 hex, md5 keys 32 hex', async () => {
    const k = await keysOf(await writePattern(dir, 'a.png', 'png'))
    expect(k.hash8).toMatch(/^[0-9a-f]{16}$/)
    expect(k.hash16).toMatch(/^[0-9a-f]{64}$/)
    for (const v of [k.pureMD5, k.thumbLight, k.thumbDark]) expect(v).toMatch(/^[0-9a-f]{32}$/)
  })

  it('identical files give identical keys (deterministic)', async () => {
    const a = await writePattern(dir, 'same1.png', 'png')
    const b = path.join(dir, 'same2.png')
    await copyFile(a, b)
    expect(await keysOf(a)).toEqual(await keysOf(b))
  })

  it('decodes colour files as 3-channel BGR and grey-path files as 1 channel', async () => {
    const png = await decodeImage(await writePattern(dir, 'c.png', 'png'))
    expect([png.width, png.height, png.channels]).toEqual([160, 120, 3])
    const webp = await decodeImage(await writePattern(dir, 'g.webp', 'webp'))
    expect(webp.channels).toBe(1)
    // BGR order: the top-left pixel has r=40, stored last in memory.
    expect(png.data[2]).toBe(40)
  })

  it('a rescaled copy stays close on the perceptual hash, different content less so', async () => {
    const big = await keysOf(await writePattern(dir, 'big.png', 'png', { width: 320, height: 240 }))
    const small = await keysOf(await writePattern(dir, 'small.png', 'png'))
    const other = await keysOf(
      await writePattern(dir, 'other.png', 'png', { width: 160, height: 120 }, 2.3)
    )
    const near = hamming(big.hash16, small.hash16)
    expect(near).toBeLessThanOrEqual(24)
    expect(hamming(small.hash16, other.hash16)).toBeGreaterThanOrEqual(near)
  })

  it('png and a q95 jpeg of the same picture have near hashes', async () => {
    const png = await keysOf(await writePattern(dir, 'p.png', 'png'))
    const jpg = await keysOf(await writePattern(dir, 'p.jpg', 'jpeg'))
    expect(hamming(png.hash8, jpg.hash8)).toBeLessThanOrEqual(6)
  })

  it('gif and webp use the grey path and still produce keys', async () => {
    expect((await keysOf(await writePattern(dir, 'x.gif', 'gif'))).hash8).toHaveLength(16)
    expect((await keysOf(await writePattern(dir, 'x.webp', 'webp'))).hash8).toHaveLength(16)
  })

  it('failure messages keep the legacy prefixes', async () => {
    await expect(provider.hashImage(path.join(dir, 'missing.png'))).rejects.toThrow(
      'Not exist image'
    )
    const junk = path.join(dir, 'junk.jpg')
    await writeFile(junk, 'this is not an image at all')
    await expect(provider.hashImage(junk)).rejects.toThrow(/^Not (iddentify is|complete) image/)
    const bytes = await readFile(await writePattern(dir, 'trunc.png', 'png'))
    const trunc = path.join(dir, 'trunc2.png')
    await writeFile(trunc, bytes.subarray(0, Math.floor(bytes.length / 2)))
    await expect(provider.hashImage(trunc)).rejects.toThrow(/^Not (iddentify is|complete) image/)
  })
})

describe('frameIndices', () => {
  it('maps the legacy timestamps to unique frame indices', () => {
    expect(frameIndices(60000, 25)).toEqual([150, 146, 0, 25, 50, 75, 100])
    expect(frameIndices(10000, 25)).toEqual([25, 24, 0, 50, 75, 100])
  })
})

describe.skipIf(tools === null)('video keys (lavfi)', () => {
  it('samples several frames of a 3 s clip, all with valid keys', async () => {
    if (tools === null) return
    const video = await generateVideo(tools, dir, 'clip.mp4', { seconds: 3, audio: false })
    const keys = await provider.hashVideo(video)
    expect(keys.length).toBeGreaterThanOrEqual(3)
    expect(keys.length).toBeLessThanOrEqual(5)
    for (const k of keys) expect(k.hash16).toHaveLength(64)
    expect(new Set(keys.map((k) => k.pureMD5)).size).toBeGreaterThan(1)
  })

  it('rotated clips are sampled at their display size', async () => {
    if (tools === null) return
    const video = await generateVideo(tools, dir, 'rot.mp4', {
      seconds: 2,
      audio: false,
      rotate: 90
    })
    expect((await provider.hashVideo(video)).length).toBeGreaterThan(0)
  })
})
