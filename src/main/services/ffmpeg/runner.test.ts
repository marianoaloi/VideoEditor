/**
 * Checklist items 13-21 of `.swarm/research/ffmpeg-jobs.md` §15 with a fake ffmpeg, plus real
 * ffmpeg runs (lavfi fixtures) for cut, concat, crop, scale, transpose, copy-then-cut and the
 * nvenc -> libx264 fallback. Without ffmpeg the real runs skip.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { VideoJob } from '@shared/domain/job'
import type { MediaInfo } from '@shared/domain/media'
import { buildLadder } from './runnerLadder'
import { ProgressParser } from './runnerProgress'
import { createProcessExecutor, fileSize, type StepExecutor, type StepRequest } from './runnerSteps'
import { runFfmpegJob, type FfmpegJobRequest, type RunnerProgress } from './runner'
import { findTestTools, generateVideo, makeTempDir } from './testFixtures'
import { probeMedia } from './probe'

let dir = ''
beforeEach(async () => {
  dir = await makeTempDir('runner')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function job(over: Partial<VideoJob> = {}): VideoJob {
  return {
    filename: '/x/v.mp4',
    originalPath: '/x/v.mp4',
    crop: null,
    bright: null,
    contrast: null,
    transpose: null,
    mediaPath: null,
    convert: false,
    size: null,
    rate: null,
    avgrate: null,
    times: [[1000, 3000]],
    posExecution: 1,
    version: 2,
    ...over
  }
}

const MEDIA = { durationMs: 10_000, width: 320, height: 240, bitrateKbps: 400, rotation: 0, hasAudio: true }

function request(over: Partial<FfmpegJobRequest> & { executor?: StepExecutor } = {}): FfmpegJobRequest {
  return {
    ffmpegPath: 'ffmpeg',
    job: job(),
    media: MEDIA,
    inputPath: path.join(dir, 'v.mp4'),
    encoders: ['h264_nvenc', 'libx264'],
    gpu: true,
    sameSize: false,
    maxRateKbps: 500,
    maxSide: 640,
    minOutputBytes: 1000,
    ...over
  }
}

type Script = (call: number, argv: readonly string[], req: StepRequest) => Promise<FakeResult> | FakeResult
interface FakeResult {
  exit?: number
  bytes?: number
  status?: 'exited' | 'cancelled' | 'spawn-error'
}

/** A fake ffmpeg: records every argv, writes `bytes` to the output (`argv[length-2]`). */
function fake(script: Script): { executor: StepExecutor; calls: string[][] } {
  const calls: string[][] = []
  const executor: StepExecutor = async (req) => {
    calls.push([...req.argv])
    const result = await script(calls.length - 1, req.argv, req)
    const output = req.argv[req.argv.length - 2] ?? ''
    if ((result.bytes ?? 5000) > 0 && result.status === undefined) {
      await writeFile(output, Buffer.alloc(result.bytes ?? 5000, 1))
    }
    return {
      status: result.status ?? 'exited',
      exitCode: result.status === undefined || result.status === 'exited' ? (result.exit ?? 0) : null,
      ...(result.status === 'spawn-error' ? { spawnError: 'ENOENT' } : {})
    }
  }
  return { executor, calls }
}

async function files(): Promise<string[]> {
  return (await readdir(dir)).sort()
}

describe('attempt ladder (checklist 13)', () => {
  it('has the §7.2 shape', () => {
    const ladder = buildLadder(['h264_nvenc', 'libx264'], true)
    expect(ladder).toHaveLength(8)
    expect(ladder.slice(0, 4)).toEqual([
      { encoder: 'h264_nvenc', hwaccel: true, strategy: 'direct' },
      { encoder: 'h264_nvenc', hwaccel: true, strategy: 'copyThenCut' },
      { encoder: 'libx264', hwaccel: true, strategy: 'direct' },
      { encoder: 'libx264', hwaccel: true, strategy: 'copyThenCut' }
    ])
    expect(ladder[6]).toEqual({ encoder: 'libx264', hwaccel: false, strategy: 'direct' })
    expect(buildLadder(['h264_nvenc', 'libx264'], false)).toHaveLength(4)
    expect(buildLadder(['libx264'], true)).toHaveLength(4)
    expect(buildLadder(['libx264', 'libx264'], false)).toHaveLength(2)
  })

  it('gives every attempt the right encoder, hwaccel and strategy; stops at the first success', async () => {
    const { executor, calls } = fake((call) => ({ exit: call < 6 ? 1 : 0 }))
    const result = await runFfmpegJob(request({ executor }))
    expect(result.ok).toBe(true)
    // direct attempts have one step, copyThenCut attempts two (the copy fails first)
    const encoders = calls.map((argv) => argv[argv.indexOf('-c:v') + 1])
    const hw = calls.map((argv) => argv.includes('-hwaccel'))
    const strategies = calls.map((argv) => argv.includes('-c') && argv[argv.indexOf('-c') + 1] === 'copy')
    expect(calls).toHaveLength(7)
    expect(encoders.filter((e) => e === 'h264_nvenc')).toHaveLength(2)
    expect(strategies.filter(Boolean)).toHaveLength(3)
    // the stream-copy steps never carry hwaccel flags
    expect(hw).toEqual([true, false, true, false, false, false, false])
    if (result.ok) {
      expect(result.attempt).toEqual({ encoder: 'libx264', hwaccel: false, strategy: 'direct' })
    }
  })

  it('one attempt failing does not leave outputs and the next starts clean (checklist 15)', async () => {
    const { executor } = fake((call) => ({ exit: call === 0 ? 1 : 0 }))
    const input = path.join(dir, 'v.mp4')
    const result = await runFfmpegJob(
      request({ executor, job: job({ posExecution: 2, times: [[0, 1000], [2000, 3000]] }) })
    )
    expect(result).toMatchObject({ ok: true, outputs: [`${input}.mp4`] })
    expect(await files()).toEqual(['v.mp4.0.mp4', 'v.mp4.1.mp4', 'v.mp4.mp4'])
  })
})

describe('success rule (checklist 14, 21)', () => {
  it('999 bytes with exit 0 fails and the file is deleted; 1000 bytes succeeds', async () => {
    const small = fake(() => ({ bytes: 999 }))
    const bad = await runFfmpegJob(request({ executor: small.executor, encoders: ['libx264'], gpu: false }))
    expect(bad.ok).toBe(false)
    expect(await files()).toEqual([])
    const edge = fake(() => ({ bytes: 1000 }))
    const good = await runFfmpegJob(request({ executor: edge.executor, encoders: ['libx264'], gpu: false }))
    expect(good.ok).toBe(true)
  })

  it('exit 1 with a 5 MB file fails and the file is deleted', async () => {
    const { executor } = fake(() => ({ exit: 1, bytes: 5_000_000 }))
    const result = await runFfmpegJob(request({ executor, encoders: ['libx264'], gpu: false }))
    expect(result.ok).toBe(false)
    expect(await files()).toEqual([])
  })

  it('exit 0 with decoder-init warnings on stderr is a success', async () => {
    const { executor } = fake((_call, _argv, req) => {
      req.onStderrLine('[h264 @ 000] cuvidCreateDecoder failed: CUDA_ERROR_INVALID_VALUE')
      req.onStderrLine('Failed setup for format cuda: hwaccel initialisation returned error')
      return { exit: 0 }
    })
    const result = await runFfmpegJob(request({ executor }))
    expect(result).toMatchObject({ ok: true })
    if (result.ok) expect(result.attempt.encoder).toBe('h264_nvenc')
  })

  it('reports every attempt failure with the last ffmpeg lines when all fail', async () => {
    const { executor, calls } = fake((_c, _a, req) => {
      req.onStderrLine('boom')
      return { exit: 1 }
    })
    const result = await runFfmpegJob(request({ executor }))
    expect(calls.length).toBeGreaterThanOrEqual(8)
    expect(result).toMatchObject({ ok: false, cancelled: false, lastLines: ['boom'] })
    expect(await files()).toEqual([])
  })

  it('a missing ffmpeg binary stops the ladder at once', async () => {
    const { executor, calls } = fake(() => ({ status: 'spawn-error' }))
    const result = await runFfmpegJob(request({ executor }))
    expect(calls).toHaveLength(1)
    expect(result).toMatchObject({ ok: false })
  })
})

describe('temp copy and parts', () => {
  it('deletes a stale <video>.copy.part.mp4 before the copy step and the copy after the re-encode (checklist 20)', async () => {
    const stale = path.join(dir, 'v.mp4.copy.part.mp4')
    await writeFile(stale, 'stale')
    const seen: (number | null)[] = []
    const { executor } = fake(async (call, argv) => {
      if (argv.includes('copy')) seen.push(await fileSize(stale))
      return { exit: call === 0 ? 1 : 0 }
    })
    const result = await runFfmpegJob(request({ executor, encoders: ['libx264'], gpu: false }))
    expect(result.ok).toBe(true)
    // the copy step wrote a 5000 B file AFTER being deleted; at call time it must have been absent
    expect(seen).toEqual([null])
    expect(await files()).toEqual(['v.mp4.0.mp4'])
  })

  it('trashes concat parts only after the concat succeeded (checklist 18)', async () => {
    const trashed: string[] = []
    const concatSeen: string[][] = []
    const { executor } = fake((_c, argv) => {
      if (argv.includes('-filter_complex')) concatSeen.push([...trashed])
      return { exit: 0 }
    })
    const input = path.join(dir, 'v.mp4')
    const result = await runFfmpegJob(
      request({
        executor,
        job: job({ posExecution: 2, times: [[0, 1000], [2000, 3000]] }),
        trashPart: async (p) => {
          trashed.push(p)
        }
      })
    )
    expect(concatSeen).toEqual([[]])
    expect(trashed).toEqual([`${input}.0.part.mp4`, `${input}.1.part.mp4`])
    expect(result).toMatchObject({ ok: true, outputs: [`${input}.mp4`] })
  })

  it('keepParts keeps them and a failing concat trashes nothing', async () => {
    const trashed: string[] = []
    const keep = fake(() => ({ exit: 0 }))
    await runFfmpegJob(
      request({
        executor: keep.executor,
        keepParts: true,
        job: job({ posExecution: 2, times: [[0, 1000], [2000, 3000]] }),
        trashPart: async (p) => {
          trashed.push(p)
        }
      })
    )
    expect(trashed).toEqual([])
    const failing = fake((_c, argv) => ({ exit: argv.includes('-filter_complex') ? 1 : 0 }))
    const result = await runFfmpegJob(
      request({
        executor: failing.executor,
        encoders: ['libx264'],
        gpu: false,
        job: job({ posExecution: 2, times: [[0, 1000], [2000, 3000]] }),
        trashPart: async (p) => {
          trashed.push(p)
        }
      })
    )
    expect(result.ok).toBe(false)
    expect(trashed).toEqual([])
  })
})

describe('outputs are never overwritten (review H5)', () => {
  const input = (): string => path.join(dir, 'v.mp4')

  it('ffmpeg writes *.part.mp4 and the final name appears only after success', async () => {
    const written: string[] = []
    const { executor } = fake(async (_c, argv) => {
      written.push(path.basename(argv[argv.length - 2] ?? ''))
      expect(await files()).not.toContain('v.mp4.0.mp4')
      return { exit: 0 }
    })
    const result = await runFfmpegJob(request({ executor }))
    expect(written).toEqual(['v.mp4.0.part.mp4'])
    expect(result).toMatchObject({ ok: true, outputs: [`${input()}.0.mp4`] })
    expect(await files()).toEqual(['v.mp4.0.mp4'])
  })

  it('an existing output goes through trashExisting before the new file takes its name', async () => {
    await writeFile(`${input()}.0.mp4`, 'OLD')
    const trashed: string[] = []
    const { executor } = fake(() => ({ exit: 0 }))
    const result = await runFfmpegJob(
      request({
        executor,
        trashExisting: async (p) => {
          trashed.push(p)
          await rm(p)
        }
      })
    )
    expect(trashed).toEqual([`${input()}.0.mp4`])
    expect(result).toMatchObject({ ok: true, outputs: [`${input()}.0.mp4`] })
    expect(await fileSize(`${input()}.0.mp4`)).toBe(5000)
  })

  it('without trashExisting the existing output stays and the new one gets a collision name', async () => {
    await writeFile(`${input()}.0.mp4`, 'OLD')
    const { executor } = fake(() => ({ exit: 0 }))
    const result = await runFfmpegJob(request({ executor }))
    expect(result).toMatchObject({ ok: true, outputs: [path.join(dir, 'v.mp4.0 (1).mp4')] })
    expect(await readFile(`${input()}.0.mp4`, 'utf8')).toBe('OLD')
  })

  it('a failed run removes only its own part files, never an earlier output', async () => {
    await writeFile(`${input()}.0.mp4`, 'OLD')
    const { executor } = fake(() => ({ exit: 1, bytes: 5000 }))
    const result = await runFfmpegJob(request({ executor, encoders: ['libx264'], gpu: false }))
    expect(result.ok).toBe(false)
    expect(await files()).toEqual(['v.mp4.0.mp4'])
    expect(await readFile(`${input()}.0.mp4`, 'utf8')).toBe('OLD')
  })

  it('keepParts promotes the cut parts to their final names after the concat', async () => {
    const { executor } = fake(() => ({ exit: 0 }))
    const result = await runFfmpegJob(
      request({ executor, keepParts: true, job: job({ posExecution: 2, times: [[0, 1000], [2000, 3000]] }) })
    )
    expect(result).toMatchObject({ ok: true, outputs: [`${input()}.mp4`] })
    expect(await files()).toEqual(['v.mp4.0.mp4', 'v.mp4.1.mp4', 'v.mp4.mp4'])
  })
})

describe('progress, cancel, dry run (checklist 17, 19)', () => {
  it('maps out_time to overall progress over the steps', async () => {
    const seen: RunnerProgress[] = []
    const { executor } = fake((_c, _a, req) => {
      req.onProgress({ outTimeMs: 1000, speed: 2, end: false })
      return { exit: 0 }
    })
    await runFfmpegJob(
      request({
        executor,
        job: job({ times: [[0, 2000], [4000, 6000]] }),
        onProgress: (p) => seen.push(p)
      })
    )
    expect(seen.map((p) => p.progress)).toEqual([0.25, 0.5, 0.75, 1])
    expect(seen[0]).toMatchObject({ stepIndex: 0, stepCount: 2, outTimeMs: 1000, speed: 2 })
  })

  it('cancelling through the AbortSignal removes the outputs and reports cancelled', async () => {
    const controller = new AbortController()
    const { executor } = fake(async (_c, _a, req) => {
      controller.abort()
      await new Promise((r) => setTimeout(r, 10))
      expect(req.signal?.aborted).toBe(true)
      return { status: 'cancelled', bytes: 4000 }
    })
    const result = await runFfmpegJob(request({ executor, signal: controller.signal }))
    expect(result).toMatchObject({ ok: false, cancelled: true })
    expect(await files()).toEqual([])
  })

  it('an already aborted signal does not start anything', async () => {
    const controller = new AbortController()
    controller.abort()
    const { executor, calls } = fake(() => ({}))
    const result = await runFfmpegJob(request({ executor, signal: controller.signal }))
    expect(calls).toHaveLength(0)
    expect(result).toMatchObject({ ok: false, cancelled: true })
  })

  it('dryRun logs the argv and touches no file', async () => {
    const { executor, calls } = fake(() => ({}))
    const lines: string[] = []
    const result = await runFfmpegJob(
      request({ executor, dryRun: true, onLog: (l) => lines.push(l), trashPart: () => Promise.reject(new Error('no')) })
    )
    expect(calls).toHaveLength(0)
    expect(result.ok).toBe(true)
    expect(lines.some((l) => l.startsWith('$ ffmpeg '))).toBe(true)
    expect(await files()).toEqual([])
  })

  it('a whole-video job with an unknown duration fails without running ffmpeg', async () => {
    const { executor, calls } = fake(() => ({}))
    const result = await runFfmpegJob(
      request({ executor, job: job({ times: [] }), media: { ...MEDIA, durationMs: 0 } })
    )
    expect(calls).toHaveLength(0)
    expect(result).toMatchObject({ ok: false })
  })
})

describe('ProgressParser', () => {
  it('uses out_time_us and ends a block on progress=', () => {
    const parser = new ProgressParser()
    const lines = ['frame=10', 'out_time_us=1500000', 'out_time_ms=1500000', 'speed=1.5x', 'progress=continue']
    const samples = lines.map((l) => parser.feed(l)).filter((s) => s !== null)
    expect(samples).toEqual([{ outTimeMs: 1500, speed: 1.5, end: false }])
    expect(parser.feed('out_time_us=N/A')).toBeNull()
    expect(parser.feed('speed=N/A')).toBeNull()
    expect(parser.feed('progress=end')).toEqual({ outTimeMs: null, speed: null, end: true })
  })
})

const tools = findTestTools()

describe.skipIf(tools === null)('real ffmpeg', () => {
  async function prepare(options: { rotate?: number } = {}): Promise<{ input: string; media: MediaInfo }> {
    if (tools === null) throw new Error('unreachable')
    const input = await generateVideo(tools, dir, 'src.mp4', { seconds: 4, ...options })
    return { input, media: await probeMedia(input, { ffprobePath: tools.ffprobe }) }
  }

  function real(input: string, media: MediaInfo, over: Partial<FfmpegJobRequest>): FfmpegJobRequest {
    return {
      ffmpegPath: tools?.ffmpeg ?? '',
      job: job(),
      media,
      inputPath: input,
      encoders: ['libx264'],
      gpu: false,
      sameSize: false,
      maxRateKbps: 500,
      maxSide: 640,
      minOutputBytes: 1000,
      ...over
    }
  }

  async function info(file: string): Promise<MediaInfo> {
    if (tools === null) throw new Error('unreachable')
    return probeMedia(file, { ffprobePath: tools.ffprobe })
  }

  it('cuts a range (output seeking) and reports progress', async () => {
    const { input, media } = await prepare()
    const progress: number[] = []
    const result = await runFfmpegJob(
      real(input, media, { job: job({ times: [[500, 2500]] }), onProgress: (p) => progress.push(p.progress) })
    )
    expect(result).toMatchObject({ ok: true, outputs: [`${input}.0.mp4`] })
    const out = await info(`${input}.0.mp4`)
    expect(out.durationMs).toBeGreaterThan(1800)
    expect(out.durationMs).toBeLessThan(2400)
    expect(progress.at(-1)).toBe(1)
  })

  it('concatenates two ranges into <video>.mp4 and trashes the parts', async () => {
    const { input, media } = await prepare()
    const trashed: string[] = []
    const result = await runFfmpegJob(
      real(input, media, {
        job: job({ posExecution: 2, times: [[0, 1000], [2000, 3000]] }),
        trashPart: async (p) => {
          trashed.push(p)
          await rm(p)
        }
      })
    )
    expect(result).toMatchObject({ ok: true, outputs: [`${input}.mp4`] })
    expect(trashed).toHaveLength(2)
    const out = await info(`${input}.mp4`)
    expect(out.durationMs).toBeGreaterThan(1800)
    expect(out.durationMs).toBeLessThan(2500)
    expect(out.hasAudio).toBe(true)
  })

  it('crops without scaling', async () => {
    const { input, media } = await prepare()
    const result = await runFfmpegJob(
      real(input, media, { job: job({ crop: { x: 10, y: 10, w: 160, h: 120 }, size: '800x600' }) })
    )
    expect(result.ok).toBe(true)
    const out = await info(`${input}.0.mp4`)
    expect([out.width, out.height]).toEqual([160, 120])
  })

  it('scales to a typed size', async () => {
    const { input, media } = await prepare()
    await runFfmpegJob(real(input, media, { job: job({ size: '200x100' }) }))
    const out = await info(`${input}.0.mp4`)
    expect([out.width, out.height]).toEqual([200, 100])
  })

  it('transposes 90 degrees', async () => {
    const { input, media } = await prepare()
    await runFfmpegJob(real(input, media, { job: job({ transpose: 90 }) }))
    const out = await info(`${input}.0.mp4`)
    expect([out.width, out.height]).toEqual([240, 320])
  })

  it('keeps a rotated phone video un-scaled and upright', async () => {
    const { input, media } = await prepare({ rotate: 90 })
    expect(media.rotation).not.toBe(0)
    await runFfmpegJob(real(input, media, { job: job() }))
    const out = await info(`${input}.0.mp4`)
    expect([out.width, out.height]).toEqual([240, 320])
  })

  it('whole video and copy-then-cut work end to end', async () => {
    const { input, media } = await prepare()
    const whole = await runFfmpegJob(real(input, media, { job: job({ times: [] }) }))
    expect(whole.ok).toBe(true)
    const copy = await runFfmpegJob(
      real(input, media, {
        job: job({ times: [[1000, 3000]] }),
        encoders: ['libx264'],
        executor: realWithFailingDirect()
      })
    )
    expect(copy).toMatchObject({ ok: true, attempt: { strategy: 'copyThenCut' } })
    expect(await files()).not.toContain('src.mp4.copy.mp4')
  })

  function realWithFailingDirect(): StepExecutor {
    const real = createProcessExecutor(tools?.ffmpeg ?? '')
    return async (req) => {
      const isDirectCut = req.argv.includes('-i') && req.argv.includes('-ss') && req.argv.includes('-c:v')
      if (isDirectCut) return { status: 'exited', exitCode: 1 }
      return real(req)
    }
  }

  it('falls back from a failing h264_nvenc attempt to libx264 (GPU-less machines too)', async () => {
    const { input, media } = await prepare()
    const realExec = createProcessExecutor(tools?.ffmpeg ?? '')
    const encoders: string[] = []
    const executor: StepExecutor = async (req) => {
      const encoder = req.argv[req.argv.indexOf('-c:v') + 1]
      if (encoder !== undefined) encoders.push(`${encoder}:${req.argv.includes('-hwaccel')}`)
      if (encoder === 'h264_nvenc') return { status: 'exited', exitCode: 1 }
      if (req.argv.includes('-hwaccel')) {
        // pretend GPU decoding is unavailable on this machine too
        return { status: 'exited', exitCode: 1 }
      }
      return realExec(req)
    }
    const result = await runFfmpegJob(
      real(input, media, { encoders: ['h264_nvenc', 'libx264'], gpu: true, executor })
    )
    expect(result).toMatchObject({ ok: true, attempt: { encoder: 'libx264', hwaccel: false } })
    expect(encoders[0]).toBe('h264_nvenc:true')
    await mkdir(path.join(dir, 'ok'), { recursive: true })
    expect((await info(`${input}.0.mp4`)).hasVideo).toBe(true)
  })
})
