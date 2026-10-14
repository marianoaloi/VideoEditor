/**
 * Test helpers for every service that needs real media: fixtures are generated with ffmpeg lavfi
 * sources in `os.tmpdir()` at test time (SWARM_PLAN §4). Never import this from production code.
 *
 *   const tools = findTestTools()            // null → `describe.skipIf(tools === null)`
 *   const dir = await makeTempDir('mytest')  // remove with `rm(dir, { recursive: true, force: true })`
 *   const video = await generateVideo(tools, dir, 'a.mp4', { seconds: 3, rotate: 90 })
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { locateTools } from './locate'
import { isSuccess, run } from '../process/run'

export interface TestTools {
  readonly ffmpeg: string
  readonly ffprobe: string
}

/** ffmpeg + ffprobe from PATH, or `null` when either is missing (the test then skips). */
export function findTestTools(): TestTools | null {
  const tools = locateTools({ ffmpegPath: null, ffprobePath: null })
  if (tools.ffmpeg === null || tools.ffprobe === null) return null
  return { ffmpeg: tools.ffmpeg.path, ffprobe: tools.ffprobe.path }
}

export async function makeTempDir(prefix = 'videoeditor-test'): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `${prefix}-`))
}

export interface VideoFixtureOptions {
  readonly seconds?: number
  readonly width?: number
  readonly height?: number
  readonly fps?: number
  /** Add a sine audio track. Default true. */
  readonly audio?: boolean
  /** `h264` (libx264, default) or `mpeg4` (use with `.avi`/`.mkv`). */
  readonly codec?: 'h264' | 'mpeg4'
  /** Display-matrix rotation in degrees (ffmpeg `-display_rotation`, counter-clockwise). */
  readonly rotate?: number
}

async function ffmpeg(tools: TestTools, args: readonly string[]): Promise<void> {
  const result = await run({
    command: tools.ffmpeg,
    args: ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args],
    timeoutMs: 60_000
  })
  if (!isSuccess(result))
    throw new Error(`ffmpeg fixture failed: ${result.stderr || result.status}`)
}

export async function generateVideo(
  tools: TestTools,
  dir: string,
  name: string,
  options: VideoFixtureOptions = {}
): Promise<string> {
  const { seconds = 3, width = 320, height = 240, fps = 25, audio = true } = options
  const codec = options.codec ?? 'h264'
  const out = path.join(dir, name)
  const target = options.rotate === undefined ? out : path.join(dir, `.pre-${name}`)
  const args = ['-f', 'lavfi', '-i', `testsrc=size=${width}x${height}:rate=${fps}`]
  if (audio) args.push('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100')
  args.push('-t', String(seconds))
  if (codec === 'h264') args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p')
  else args.push('-c:v', 'mpeg4', '-q:v', '5')
  if (audio) args.push('-c:a', codec === 'h264' ? 'aac' : 'mp3', '-ac', '1')
  args.push(target)
  await ffmpeg(tools, args)
  if (options.rotate !== undefined) {
    await ffmpeg(tools, [
      '-display_rotation:v:0',
      String(options.rotate),
      '-i',
      target,
      '-c',
      'copy',
      out
    ])
  }
  return out
}

export async function generateImage(
  tools: TestTools,
  dir: string,
  name: string,
  options: { width?: number; height?: number } = {}
): Promise<string> {
  const { width = 64, height = 48 } = options
  const out = path.join(dir, name)
  await ffmpeg(tools, [
    '-f',
    'lavfi',
    '-i',
    `testsrc=size=${width}x${height}:rate=1`,
    '-frames:v',
    '1',
    out
  ])
  return out
}

export async function generateAudio(tools: TestTools, dir: string, name: string): Promise<string> {
  const out = path.join(dir, name)
  await ffmpeg(tools, ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', out])
  return out
}
