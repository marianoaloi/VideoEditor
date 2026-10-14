/**
 * Checklist items 1-12 of `.swarm/research/ffmpeg-jobs.md` §15; vectors V01-V16 of §3 token for token.
 * Notation in the vectors: HW = the three CUDA flags, LL = `-loglevel error`, IN = the input path.
 */
import { describe, expect, it } from 'vitest'
import type { VideoJob } from '../domain/job'
import {
  buildConvertStep,
  buildFfmpegArgs,
  defaultSize,
  FfmpegArgsError,
  normaliseTypedSize,
  resolveRate,
  runnerPrefix,
  videoFilter,
  type BuilderMedia,
  type BuilderOpts
} from './ffmpegArgs'

const IN = '/d/v.mp4'
const HW = '-extra_hw_frames 8 -hwaccel cuda -hwaccel_device 0'

function vec(text: string): string[] {
  return text
    .replaceAll('HW', HW)
    .replaceAll('LL', '-loglevel error')
    .replaceAll('IN', IN)
    .split(' ')
}

function job(over: Partial<VideoJob> = {}): VideoJob {
  return {
    filename: IN,
    originalPath: IN,
    crop: null,
    bright: null,
    contrast: null,
    transpose: null,
    mediaPath: null,
    convert: false,
    size: null,
    rate: null,
    avgrate: null,
    times: [],
    posExecution: 1,
    version: 2,
    ...over
  }
}

function media(over: Partial<BuilderMedia> & { bps?: number | null } = {}): BuilderMedia {
  const { bps, ...rest } = over
  const kbps = bps === undefined ? 3000 : bps === null ? null : Math.trunc(bps / 1000)
  return {
    durationMs: 100_000,
    width: 1920,
    height: 1080,
    bitrateKbps: kbps,
    rotation: 0,
    hasAudio: true,
    ...rest
  }
}

const NVENC: BuilderOpts = {
  encoder: 'h264_nvenc',
  hwaccel: true,
  strategy: 'direct',
  sameSize: false,
  verbose: false,
  maxRateKbps: 500,
  maxSide: 640
}
const CPU: BuilderOpts = { ...NVENC, encoder: 'libx264', hwaccel: false }

function argvs(j: VideoJob, m: BuilderMedia, o: BuilderOpts): string[][] {
  return buildFfmpegArgs(j, m, IN, o).map((s) => s.argv)
}

describe('buildFfmpegArgs vectors (checklist 2)', () => {
  it('V01 plain cut, 2 ranges', () => {
    const out = argvs(job({ times: [[18054, 46182], [18054, 45735]] }), media(), NVENC)
    expect(out).toEqual([
      vec(
        'HW LL -i IN -b:a 128k -b:v 500k -bufsize 130M -c:a aac -c:v h264_nvenc -crf 28 -flush_packets 1 -maxrate 500k -pix_fmt yuv420p -r 25 -ss 18054ms -t 28128ms -vf scale=640:360 IN.0.mp4 -y'
      ),
      vec(
        'HW LL -i IN -b:a 128k -b:v 500k -bufsize 130M -c:a aac -c:v h264_nvenc -crf 28 -flush_packets 1 -maxrate 500k -pix_fmt yuv420p -r 25 -ss 18054ms -t 27681ms -vf scale=640:360 IN.1.mp4 -y'
      )
    ])
  })

  it('V02 crop wins over a typed size, CPU, -ss 0ms emitted', () => {
    const j = job({ times: [[0, 10000]], crop: { x: 0, y: 140, w: 1920, h: 800 }, size: '640x360' })
    expect(argvs(j, media({ bps: 800000 }), CPU)).toEqual([
      vec(
        'LL -i IN -b:a 128k -b:v 500k -bufsize 130M -c:a aac -c:v libx264 -crf 28 -flush_packets 1 -maxrate 500k -pix_fmt yuv420p -r 25 -ss 0ms -t 10000ms -vf crop=1920:800:0:140 IN.0.mp4 -y'
      )
    ])
  })

  it('V03 typed WxH size and typed rate (uncapped)', () => {
    const j = job({ times: [[5000, 65000]], size: '854x480', rate: 700 })
    expect(argvs(j, media(), NVENC)).toEqual([
      vec(
        'HW LL -i IN -b:a 128k -b:v 700k -bufsize 130M -c:a aac -c:v h264_nvenc -crf 28 -flush_packets 1 -maxrate 700k -pix_fmt yuv420p -r 25 -ss 5000ms -t 60000ms -vf scale=854:480 IN.0.mp4 -y'
      )
    ])
  })

  it('V04 portrait source without rotation metadata', () => {
    const m = media({ width: 1080, height: 1920, bps: 2000000 })
    expect(argvs(job({ times: [[1000, 11000]] }), m, NVENC)).toEqual([
      vec(
        'HW LL -i IN -b:a 128k -b:v 500k -bufsize 130M -c:a aac -c:v h264_nvenc -crf 28 -flush_packets 1 -maxrate 500k -pix_fmt yuv420p -r 25 -ss 1000ms -t 10000ms -vf scale=360:640 IN.0.mp4 -y'
      )
    ])
  })

  it('V05 rotated source: no scale, no -vf (checklist 6)', () => {
    const m = media({ rotation: -90, bps: 4500000 })
    expect(argvs(job({ times: [[2000, 12000]] }), m, NVENC)).toEqual([
      vec(
        'HW LL -i IN -b:a 128k -b:v 500k -bufsize 130M -c:a aac -c:v h264_nvenc -crf 28 -flush_packets 1 -maxrate 500k -pix_fmt yuv420p -r 25 -ss 2000ms -t 10000ms IN.0.mp4 -y'
      )
    ])
  })

  it('V06 whole video: no -ss/-t, rate below the cap (checklist 3)', () => {
    const m = media({ width: 1280, height: 720, bps: 231869, durationMs: 90500 })
    expect(argvs(job(), m, NVENC)).toEqual([
      vec(
        'HW LL -i IN -b:a 128k -b:v 231k -bufsize 130M -c:a aac -c:v h264_nvenc -crf 28 -flush_packets 1 -maxrate 231k -pix_fmt yuv420p -r 25 -vf scale=640:360 IN.0.mp4 -y'
      )
    ])
  })

  it('V07 transpose 90 + brightness + contrast', () => {
    const j = job({ times: [[0, 5000]], transpose: 90, bright: 0.18, contrast: 1.46 })
    const m = media({ width: 1280, height: 720, bps: 1500000 })
    expect(argvs(j, m, NVENC)).toEqual([
      vec(
        'HW LL -i IN -b:a 128k -b:v 500k -bufsize 130M -c:a aac -c:v h264_nvenc -crf 28 -flush_packets 1 -maxrate 500k -pix_fmt yuv420p -r 25 -ss 0ms -t 5000ms -vf scale=640:360,transpose=1,eq=brightness=0.18:contrast=1.46 IN.0.mp4 -y'
      )
    ])
  })

  it('V08 transpose -180 + contrast only', () => {
    const j = job({ times: [[1000, 4000]], transpose: -180, contrast: 1.2 })
    const m = media({ width: 1280, height: 720, bps: 1500000 })
    expect(argvs(j, m, NVENC)).toEqual([
      vec(
        'HW LL -i IN -b:a 128k -b:v 500k -bufsize 130M -c:a aac -c:v h264_nvenc -crf 28 -flush_packets 1 -maxrate 500k -pix_fmt yuv420p -r 25 -ss 1000ms -t 3000ms -vf scale=640:360,transpose=2,transpose=2,eq=contrast=1.2 IN.0.mp4 -y'
      )
    ])
  })

  it('V09 transpose 270 + negative brightness, contrast 0 ignored', () => {
    const j = job({ times: [[1000, 4000]], transpose: 270 as number, bright: -0.25, contrast: 0 })
    const m = media({ width: 1280, height: 720, bps: 1500000 })
    expect(argvs(j, m, NVENC)).toEqual([
      vec(
        'HW LL -i IN -b:a 128k -b:v 500k -bufsize 130M -c:a aac -c:v h264_nvenc -crf 28 -flush_packets 1 -maxrate 500k -pix_fmt yuv420p -r 25 -ss 1000ms -t 3000ms -vf scale=640:360,transpose=1,transpose=1,transpose=1,eq=brightness=-0.25 IN.0.mp4 -y'
      )
    ])
  })

  it('V10 concat with audio', () => {
    const j = job({ posExecution: 2, times: [[1000, 3000], [5000, 9000]] })
    const steps = buildFfmpegArgs(j, media(), IN, NVENC)
    expect(steps.map((s) => s.kind)).toEqual(['cut', 'cut', 'concat'])
    expect(steps.map((s) => s.argv)).toEqual([
      vec(
        'HW LL -i IN -b:a 128k -b:v 500k -bufsize 130M -c:a aac -c:v h264_nvenc -crf 28 -flush_packets 1 -maxrate 500k -pix_fmt yuv420p -r 25 -ss 1000ms -t 2000ms -vf scale=640:360 IN.0.mp4 -y'
      ),
      vec(
        'HW LL -i IN -b:a 128k -b:v 500k -bufsize 130M -c:a aac -c:v h264_nvenc -crf 28 -flush_packets 1 -maxrate 500k -pix_fmt yuv420p -r 25 -ss 5000ms -t 4000ms -vf scale=640:360 IN.1.mp4 -y'
      ),
      vec(
        'HW LL -i IN.0.mp4 HW LL -i IN.1.mp4 -filter_complex [0:v][0:a][1:v][1:a]concat=a=1:n=2:v=1[s0][a0];[s0]fps=fps=25[s1] -map [s1] -map [a0] -b:a 128k -b:v 500k -bufsize 130M -c:a aac -c:v h264_nvenc -crf 28 -flush_packets 1 -maxrate 500k -pix_fmt yuv420p -r 25 IN.mp4 -y'
      )
    ])
  })

  it('V11 concat without audio, CPU', () => {
    const j = job({ posExecution: 2, times: [[1000, 3000], [5000, 9000]] })
    expect(argvs(j, media({ hasAudio: false }), CPU)).toEqual([
      vec(
        'LL -i IN -b:v 500k -bufsize 130M -c:v libx264 -crf 28 -flush_packets 1 -maxrate 500k -pix_fmt yuv420p -r 25 -ss 1000ms -t 2000ms -vf scale=640:360 IN.0.mp4 -y'
      ),
      vec(
        'LL -i IN -b:v 500k -bufsize 130M -c:v libx264 -crf 28 -flush_packets 1 -maxrate 500k -pix_fmt yuv420p -r 25 -ss 5000ms -t 4000ms -vf scale=640:360 IN.1.mp4 -y'
      ),
      vec(
        'LL -i IN.0.mp4 LL -i IN.1.mp4 -filter_complex [0:v][1:v]concat=a=0:n=2:v=1[s0];[s0]fps=fps=25[s1] -map [s1] -b:v 500k -bufsize 130M -c:v libx264 -crf 28 -flush_packets 1 -maxrate 500k -pix_fmt yuv420p -r 25 IN.mp4 -y'
      )
    ])
  })

  it('V12 encoder / GPU fallback attempts', () => {
    const j = job({ times: [[18054, 46182]] })
    const a = argvs(j, media(), { ...NVENC, encoder: 'libx264' })
    const b = argvs(j, media(), CPU)
    expect(a).toEqual([
      vec(
        'HW LL -i IN -b:a 128k -b:v 500k -bufsize 130M -c:a aac -c:v libx264 -crf 28 -flush_packets 1 -maxrate 500k -pix_fmt yuv420p -r 25 -ss 18054ms -t 28128ms -vf scale=640:360 IN.0.mp4 -y'
      )
    ])
    expect(b).toEqual([
      vec(
        'LL -i IN -b:a 128k -b:v 500k -bufsize 130M -c:a aac -c:v libx264 -crf 28 -flush_packets 1 -maxrate 500k -pix_fmt yuv420p -r 25 -ss 18054ms -t 28128ms -vf scale=640:360 IN.0.mp4 -y'
      )
    ])
  })

  it('V13 copy-then-cut (tolerance flags BEFORE -i; recode has no -ss/-t)', () => {
    const j = job({ times: [[18054, 46182]] })
    const steps = buildFfmpegArgs(j, media(), IN, { ...NVENC, strategy: 'copyThenCut' })
    expect(steps.map((s) => s.kind)).toEqual(['copy', 'cut'])
    expect(steps.map((s) => s.argv)).toEqual([
      vec('LL -err_detect ignore_err -fflags +discardcorrupt -i IN -c copy -ss 18054ms -t 28128ms IN.copy.mp4 -y'),
      vec(
        'HW LL -i IN.copy.mp4 -b:a 128k -b:v 500k -bufsize 130M -c:a aac -c:v h264_nvenc -crf 28 -flush_packets 1 -maxrate 500k -pix_fmt yuv420p -r 25 -vf scale=640:360 IN.0.mp4 -y'
      )
    ])
    expect(steps[1]?.expectedMs).toBe(28128)
    expect(steps[0]?.expectedMs).toBeNull()
  })

  it('V14 Same Size + verbose', () => {
    const m = media({ width: 1921, height: 1081 })
    const o = { ...NVENC, sameSize: true, verbose: true }
    expect(argvs(job({ times: [[0, 5000]] }), m, o)).toEqual([
      vec(
        'HW -i IN -b:a 128k -b:v 500k -bufsize 130M -c:a aac -c:v h264_nvenc -crf 28 -flush_packets 1 -maxrate 500k -pix_fmt yuv420p -r 25 -ss 0ms -t 5000ms -vf scale=1922:1082 IN.0.mp4 -y'
      )
    ])
  })

  it('V15 typed odd size is evened', () => {
    expect(argvs(job({ times: [[0, 5000]], size: '641x361' }), media(), CPU)).toEqual([
      vec(
        'LL -i IN -b:a 128k -b:v 500k -bufsize 130M -c:a aac -c:v libx264 -crf 28 -flush_packets 1 -maxrate 500k -pix_fmt yuv420p -r 25 -ss 0ms -t 5000ms -vf scale=642:362 IN.0.mp4 -y'
      )
    ])
  })

  it('V16 concat built from copy-then-cut parts', () => {
    const j = job({ posExecution: 2, times: [[1000, 3000], [5000, 9000]] })
    const steps = buildFfmpegArgs(j, media(), IN, { ...NVENC, strategy: 'copyThenCut' })
    expect(steps.map((s) => s.kind)).toEqual(['copy', 'cut', 'copy', 'cut', 'concat'])
    expect(steps.slice(0, 4).map((s) => s.argv)).toEqual([
      vec('LL -err_detect ignore_err -fflags +discardcorrupt -i IN -c copy -ss 1000ms -t 2000ms IN.copy.mp4 -y'),
      vec(
        'HW LL -i IN.copy.mp4 -b:a 128k -b:v 500k -bufsize 130M -c:a aac -c:v h264_nvenc -crf 28 -flush_packets 1 -maxrate 500k -pix_fmt yuv420p -r 25 -vf scale=640:360 IN.0.mp4 -y'
      ),
      vec('LL -err_detect ignore_err -fflags +discardcorrupt -i IN -c copy -ss 5000ms -t 4000ms IN.copy.mp4 -y'),
      vec(
        'HW LL -i IN.copy.mp4 -b:a 128k -b:v 500k -bufsize 130M -c:a aac -c:v h264_nvenc -crf 28 -flush_packets 1 -maxrate 500k -pix_fmt yuv420p -r 25 -vf scale=640:360 IN.1.mp4 -y'
      )
    ])
    const plain = buildFfmpegArgs(j, media(), IN, NVENC)
    expect(steps[4]?.argv).toEqual(plain[2]?.argv)
  })
})

describe('builder rules', () => {
  it('checklist 1: pure, does not mutate frozen inputs', () => {
    const j = Object.freeze(job({ times: Object.freeze([[1, 2000]]) as unknown as VideoJob['times'] }))
    const m = Object.freeze(media())
    const o = Object.freeze({ ...NVENC })
    const first = buildFfmpegArgs(j, m, IN, o)
    expect(buildFfmpegArgs(j, m, IN, o)).toEqual(first)
  })

  it('checklist 2: the output is argv[length-2] and -y is last', () => {
    const steps = buildFfmpegArgs(job({ posExecution: 2, times: [[0, 1000], [2000, 3000]] }), media(), IN, NVENC)
    for (const s of steps) {
      expect(s.argv.at(-1)).toBe('-y')
      expect(s.argv.at(-2)).toBe(s.output)
    }
  })

  it('checklist 3: empty times with unknown duration throws', () => {
    expect(() => buildFfmpegArgs(job(), media({ durationMs: 0 }), IN, NVENC)).toThrow(FfmpegArgsError)
  })

  it('checklist 4: reversed pair and the -1 whole-video marker', () => {
    const rev = argvs(job({ times: [[9000, 1000] as unknown as [number, number]] }), media(), CPU)
    expect(rev[0]).toContain('1000ms')
    expect(rev[0]).toContain('8000ms')
    const whole = argvs(job({ times: [[-1, 5000]] }), media(), CPU)
    expect(whole[0]).not.toContain('-ss')
    expect(whole[0]).not.toContain('-t')
  })

  it('checklist 5: default size table (sides even and >= 2)', () => {
    const rows: [number, number, string, string][] = [
      [1920, 1080, '640:360', '1920:1080'],
      [1280, 720, '640:360', '1280:720'],
      [1080, 1920, '360:640', '1080:1920'],
      [720, 1280, '360:640', '720:1280'],
      [854, 480, '640:360', '854:480'],
      [1000, 563, '640:360', '1000:564'],
      [800, 600, '640:480', '800:600'],
      [640, 480, '640:480', '640:480'],
      [640, 640, '640:640', '640:640'],
      [700, 700, '640:640', '700:700'],
      [321, 241, '322:242', '322:242'],
      [641, 100, '640:100', '642:100'],
      [3840, 2160, '640:360', '3840:2160'],
      [0, 0, '640:360', '640:360']
    ]
    for (const [w, h, normal, same] of rows) {
      expect(defaultSize(w, h, false, 640)).toBe(normal)
      expect(defaultSize(w, h, true, 640)).toBe(same)
    }
    expect(defaultSize(3000, 1, false, 640)).toBe('640:2')
  })

  it('checklist 5: rate table', () => {
    const rate = (bps: number | null, typed: number | null = null): number =>
      resolveRate({ rate: typed }, media({ bps }), 500)
    expect(rate(231869)).toBe(231)
    expect(rate(499999)).toBe(499)
    expect(rate(500999)).toBe(500)
    expect(rate(1200000)).toBe(500)
    expect(rate(null)).toBe(500)
    expect(rate(0)).toBe(500)
    expect(rate(999)).toBe(500)
    expect(rate(3000000, 700)).toBe(700)
    expect(rate(3000000, 800)).toBe(800)
  })

  it('checklist 6: rotation of 0 is not rotated; crop never scales', () => {
    const j = job({ times: [[0, 1000]] })
    expect(videoFilter(j, media({ rotation: 90 }), NVENC)).toBe('')
    expect(videoFilter(j, media({ rotation: 0 }), NVENC)).toBe('scale=640:360')
    const cropped = job({ crop: { x: 1, y: 2, w: 30, h: 40 }, size: '800x600' })
    expect(videoFilter(cropped, media(), NVENC)).toBe('crop=30:40:1:2')
  })

  it('checklist 7: eq rules and filter order', () => {
    const eq = (bright: number | null, contrast: number | null): string =>
      videoFilter(job({ bright, contrast }), media({ rotation: 90 }), NVENC)
    expect(eq(1.7, null)).toBe('eq=brightness=1')
    expect(eq(null, 1.2)).toBe('eq=contrast=1.2')
    expect(eq(0, 0)).toBe('')
    expect(eq(null, null)).toBe('')
    expect(eq(null, 1)).toBe('eq=contrast=1')
    const all = videoFilter(job({ bright: 0.5, transpose: 90, crop: { x: 0, y: 0, w: 4, h: 4 } }), media(), NVENC)
    expect(all).toBe('crop=4:4:0:0,transpose=1,eq=brightness=0.5')
  })

  it('checklist 8: transpose table', () => {
    const t = (degrees: number | null): string =>
      videoFilter(job({ transpose: degrees }), media({ rotation: 90 }), NVENC)
    expect(t(45)).toBe('')
    expect(t(-45)).toBe('')
    expect(t(89)).toBe('')
    expect(t(0)).toBe('')
    expect(t(null)).toBe('')
    expect(t(135)).toBe('transpose=1')
    expect(t(-135)).toBe('transpose=2')
    expect(t(90)).toBe('transpose=1')
    expect(t(-90)).toBe('transpose=2')
    expect(t(180)).toBe('transpose=1,transpose=1')
    expect(t(-180)).toBe('transpose=2,transpose=2')
    expect(t(270)).toBe('transpose=1,transpose=1,transpose=1')
    expect(t(360)).toBe('transpose=1,transpose=1,transpose=1,transpose=1')
  })

  it('checklist 9: no audio means no audio flags, no [n:a] pads, no -map [a0]', () => {
    const j = job({ posExecution: 2, times: [[0, 1000], [2000, 3000]] })
    const steps = buildFfmpegArgs(j, media({ hasAudio: false }), IN, NVENC)
    for (const s of steps) {
      expect(s.argv).not.toContain('-b:a')
      expect(s.argv).not.toContain('-c:a')
      expect(s.argv.join(' ')).not.toContain(':a]')
      expect(s.argv).not.toContain('[a0]')
    }
  })

  it('checklist 10: typed size and rate normalisation', () => {
    expect(normaliseTypedSize('641x361')).toEqual({ kind: 'size', value: '642:362' })
    expect(normaliseTypedSize('640X360')).toEqual({ kind: 'size', value: '640:360' })
    expect(normaliseTypedSize('640:360')).toEqual({ kind: 'size', value: '640:360' })
    expect(normaliseTypedSize('-1')).toEqual({ kind: 'keep' })
    expect(normaliseTypedSize('abc')).toBeNull()
    expect(normaliseTypedSize('')).toBeNull()
    expect(normaliseTypedSize(null)).toBeNull()
    expect(normaliseTypedSize('0x0')).toBeNull()
    const keep = videoFilter(job({ size: '-1' }), media(), NVENC)
    expect(keep).toBe('')
    expect(videoFilter(job({ size: 'abc' }), media(), NVENC)).toBe('scale=640:360')
  })

  it('checklist 11: parts are named <video>.<i>.mp4 and the concat <video>.mp4', () => {
    const j = job({ posExecution: 2, times: [[0, 1000], [2000, 3000], [4000, 5000]] })
    const steps = buildFfmpegArgs(j, media(), IN, NVENC)
    expect(steps.map((s) => s.output)).toEqual([`${IN}.0.mp4`, `${IN}.1.mp4`, `${IN}.2.mp4`, `${IN}.mp4`])
    expect(steps[3]?.expectedMs).toBe(3000)
  })

  it('checklist 12: hwaccel=false removes every hw flag, verbose removes every -loglevel', () => {
    const j = job({ posExecution: 2, times: [[0, 1000], [2000, 3000]] })
    const cpu = buildFfmpegArgs(j, media(), IN, CPU).flatMap((s) => s.argv)
    expect(cpu).not.toContain('-hwaccel')
    expect(cpu.filter((a) => a === '-loglevel')).toHaveLength(4)
    const verbose = buildFfmpegArgs(j, media(), IN, { ...NVENC, verbose: true }).flatMap((s) => s.argv)
    expect(verbose).not.toContain('-loglevel')
    expect(verbose.filter((a) => a === '-hwaccel')).toHaveLength(4)
  })

  it('outputBase renames outputs while reading another input (convert pre-step)', () => {
    const steps = buildFfmpegArgs(job({ times: [[0, 1000]] }), media(), '/d/v.mp4.converted.mp4', {
      ...CPU,
      strategy: 'copyThenCut',
      outputBase: IN
    })
    expect(steps.map((s) => s.output)).toEqual([`${IN}.copy.mp4`, `${IN}.0.mp4`])
    expect(steps[0]?.argv).toContain('/d/v.mp4.converted.mp4')
  })

  it('exposes the runner prefix and the convert step', () => {
    expect(runnerPrefix()).toEqual(['-hide_banner', '-nostdin', '-progress', 'pipe:1', '-nostats'])
    const c = buildConvertStep(IN, { hasAudio: true, verbose: false })
    expect(c.output).toBe(`${IN}.converted.mp4`)
    expect(c.argv.at(-2)).toBe(c.output)
    expect(c.argv.join(' ')).toContain('-c:a aac -b:a 128k')
    expect(buildConvertStep(IN, { hasAudio: false, verbose: true }).argv).not.toContain('-loglevel')
  })
})
