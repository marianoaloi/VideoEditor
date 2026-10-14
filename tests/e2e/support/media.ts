/** Fixture generation (ffmpeg lavfi) and probing. Everything lives under `os.tmpdir()`. */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, statSync, truncateSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function makeTempDir(prefix = 've-e2e-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

function ffmpeg(args: string[]): void {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'pipe' })
}

export interface VideoSpec {
  seconds?: number
  width?: number
  height?: number
  /** `mp4` (h264+aac) or `avi` (mpeg4+mp3: forces the transcode fallback). */
  format?: 'mp4' | 'avi'
  /** A different pattern per spec keeps file sizes distinct. */
  pattern?: 'testsrc2' | 'testsrc' | 'mandelbrot' | 'smptebars'
  freq?: number
}

export function makeVideo(path: string, spec: VideoSpec = {}): string {
  const {
    seconds = 3,
    width = 320,
    height = 180,
    format = 'mp4',
    pattern = 'testsrc2',
    freq = 440
  } = spec
  const codecs =
    format === 'avi'
      ? ['-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'libmp3lame']
      : [
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-movflags',
          '+faststart'
        ]
  ffmpeg([
    '-f',
    'lavfi',
    '-t',
    String(seconds),
    '-i',
    `${pattern}=size=${width}x${height}:rate=25`,
    '-f',
    'lavfi',
    '-t',
    String(seconds),
    '-i',
    `sine=frequency=${freq}`,
    ...codecs,
    '-shortest',
    path
  ])
  return path
}

/** A noise-free but distinctive PNG/JPG. `seed` selects the picture; equal seeds give identical files. */
export function makeImage(
  path: string,
  seed: 'a' | 'b' | 'c' = 'a',
  width = 160,
  height = width
): string {
  const source: Record<string, string> = {
    a: `testsrc=size=${width}x${height}:rate=1`,
    b: `smptebars=size=${width}x${height}:rate=1`,
    c: `mandelbrot=size=${width}x${height}:rate=1`
  }
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    source[seed] ?? source['a']!,
    '-frames:v',
    '1',
    '-update',
    '1',
    path
  ])
  return path
}

export interface ProbedVideo {
  codec: string
  durationSec: number
  width: number
  height: number
}

/** ffprobe a file; throws when it is not a playable video. */
export function probeVideo(path: string): ProbedVideo {
  const out = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name,width,height:format=duration',
      '-of',
      'json',
      path
    ],
    { encoding: 'utf8' }
  )
  const json = JSON.parse(out) as {
    streams: { codec_name: string; width: number; height: number }[]
    format: { duration: string }
  }
  const stream = json.streams[0]
  if (stream === undefined) throw new Error(`no video stream in ${path}`)
  return {
    codec: stream.codec_name,
    width: stream.width,
    height: stream.height,
    durationSec: Number(json.format.duration)
  }
}

export function sizeOf(path: string): number {
  return statSync(path).size
}

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Kills stray electron/ffmpeg processes started from this repo or from the temp fixtures. */
export function killLeftovers(): void {
  if (process.platform !== 'win32') return
  const script =
    "Get-CimInstance Win32_Process | Where-Object { ($_.Name -in 'ffmpeg.exe','ffprobe.exe' -and $_.CommandLine -like '*ve-e2e-*') -or ($_.Name -eq 'electron.exe' -and $_.CommandLine -like '*ve-e2e-*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
  spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore' })
}

/** Cuts a file to the first `fraction` of its bytes (a damaged download). */
export function truncateFile(path: string, fraction: number): void {
  const size = statSync(path).size
  truncateSync(path, Math.floor(size * fraction))
}
