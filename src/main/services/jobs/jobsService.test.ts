/**
 * Batch scan, orphan/empty/invalid JSON, post-job hooks and delete rules (checklist 24-34 subset),
 * plus a real-ffmpeg batch of 2 JSON files (B12).
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { serializeVideoJob, createVideoJob } from '@shared/core/videoJob'
import type { JobEvent } from '@shared/domain/job'
import type { MediaInfo } from '@shared/domain/media'
import { DEFAULT_SETTINGS } from '@shared/domain/settings'
import { findTestTools, generateVideo, makeTempDir } from '../ffmpeg/testFixtures'
import type { StepExecutor } from '../ffmpeg/runnerSteps'
import { JobsService } from './jobsService'
import { makeKit, settingsWith, type Kit } from './testKit'
import { parseH264Encoders, parseHwaccels, parseVersion } from './toolsStatus'

let dir = ''
let custom = ''
beforeEach(async () => {
  dir = await makeTempDir('jobs')
  custom = path.join(dir, 'CUSTOM')
  await mkdir(custom)
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const INFO: MediaInfo = {
  path: '/x',
  container: 'mp4',
  formatLongName: null,
  durationMs: 10_000,
  sizeBytes: 1,
  bitrateKbps: 400,
  hasVideo: true,
  width: 320,
  height: 240,
  displayWidth: 320,
  displayHeight: 240,
  rotation: 0,
  fps: 25,
  videoCodec: 'h264',
  pixFmt: 'yuv420p',
  hasAudio: true,
  audioCodec: 'aac',
  audioChannels: 1,
  streamCount: 2
}

async function addJob(name: string, over: Parameters<typeof createVideoJob>[1] = { times: [[0, 1000]] }): Promise<string> {
  const video = path.join(custom, name)
  await writeFile(video, 'video')
  await writeFile(`${video}.json`, serializeVideoJob(createVideoJob(video, over)))
  return video
}

/** A service whose ffmpeg is fake: it records argv and writes 5000 bytes. */
function fakeService(kit: Kit, argvLog: string[][] = []): JobsService {
  const stepExecutor = (): StepExecutor => async (req) => {
    argvLog.push([...req.argv])
    await writeFile(req.argv[req.argv.length - 2] ?? '', Buffer.alloc(5000, 1))
    return { status: 'exited', exitCode: 0 }
  }
  return new JobsService(kit.ctx, {
    emit: (e: JobEvent) => kit.events.push(e),
    logFlushMs: 5,
    executorDeps: {
      tools: () => ({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }),
      probe: () => Promise.resolve(INFO),
      stepExecutor
    }
  })
}

describe('batch folder scan (checklist 24-26)', () => {
  it('queues sorted JSONs, ignores videos without JSON, never deletes, moves orphan/empty aside', async () => {
    const kit = makeKit(dir)
    await addJob('b.mp4')
    await addJob('a.mp4')
    await writeFile(path.join(custom, 'lonely.mp4'), 'x')
    await writeFile(path.join(custom, 'ghost.mp4.json'), serializeVideoJob(createVideoJob(path.join(custom, 'ghost.mp4'), {})))
    await writeFile(path.join(custom, 'empty.mp4'), 'v')
    await writeFile(path.join(custom, 'empty.mp4.json'), '')
    await writeFile(path.join(custom, 'bad.mp4'), 'v')
    await writeFile(path.join(custom, 'bad.mp4.json'), '{nope')
    const service = fakeService(kit)
    const result = await service.enqueueFolder({ dir: custom, options: parsedOptions(), force: false })
    await service.queue.idle()
    expect(service.list().map((j) => path.basename(j.videoPath))).toEqual(['a.mp4', 'b.mp4'])
    expect(result.jobIds).toHaveLength(2)
    const byName = Object.fromEntries(result.skipped.map((s) => [path.basename(s.path), s]))
    expect(byName['ghost.mp4.json']?.movedTo).toBe(path.join(dir, 'ruimFolder', 'ghost.mp4.json'))
    expect(byName['empty.mp4.json']?.movedTo).toBe(path.join(dir, 'ruimFolder', 'empty.mp4.json'))
    expect(byName['bad.mp4.json']?.movedTo).toBeNull()
    expect(byName['bad.mp4.json']?.reason).toContain('Invalid job file')
    expect((await readdir(path.join(dir, 'ruimFolder'))).sort()).toEqual(['empty.mp4.json', 'ghost.mp4.json'])
    expect(await readdir(custom)).toContain('bad.mp4.json')
    expect(kit.journal.map((j) => j.entry.op)).toEqual(['move', 'move'])
  })

  it('collision-safe move aside and the saved originalPath is kept', async () => {
    const kit = makeKit(dir)
    await mkdir(path.join(dir, 'ruimFolder'))
    await writeFile(path.join(dir, 'ruimFolder', 'ghost.mp4.json'), 'old')
    await writeFile(path.join(custom, 'ghost.mp4.json'), '{}')
    const service = fakeService(kit)
    const result = await service.enqueueFolder({ dir: custom, options: parsedOptions(), force: false })
    expect(result.skipped[0]?.movedTo).toBe(path.join(dir, 'ruimFolder', 'ghost.mp4 (1).json'))
    expect(await readFile(path.join(dir, 'ruimFolder', 'ghost.mp4.json'), 'utf8')).toBe('old')
    const video = await addJob('k.mp4', { originalPath: '/orig/k.mp4', times: [[0, 500]] })
    expect((await service.readJob(video)).job?.originalPath).toBe('/orig/k.mp4')
  })

  it('two JSONs start two jobs with the right argv (B12) and skip duplicates', async () => {
    const kit = makeKit(dir)
    const a = await addJob('a.mp4', { times: [[1000, 3000]] })
    await addJob('b.mp4', { times: [[0, 500]], size: '200x100' })
    const argvs: string[][] = []
    const service = fakeService(kit, argvs)
    await service.enqueueFolder({ dir: custom, options: parsedOptions(), force: false })
    await service.queue.idle()
    expect(kit.events.filter((e) => e.type === 'started')).toHaveLength(2)
    const first = argvs.find((v) => v.includes(`${a}`))
    expect(first).toContain('-ss')
    expect(first).toContain('1000ms')
    expect(argvs.some((v) => v.includes('scale=200:100'))).toBe(true)
    const again = await service.enqueueFiles({ paths: [a], options: parsedOptions(), force: false })
    expect(again.jobIds).toHaveLength(1)
  })

  it('force mode makes whole-video jobs and skips earlier outputs', async () => {
    const kit = makeKit(dir)
    await writeFile(path.join(dir, 'x.mp4'), 'v')
    await writeFile(path.join(dir, 'x.mp4.0.mp4'), 'o')
    await writeFile(path.join(dir, 'x.mp4.mp4'), 'o')
    await writeFile(path.join(dir, 'x.mp4.copy.mp4'), 'o')
    await writeFile(path.join(dir, 'notes.txt'), 't')
    const service = fakeService(kit)
    await service.enqueueFolder({ dir, options: parsedOptions(), force: true })
    await service.queue.idle()
    expect(service.list().map((j) => path.basename(j.videoPath))).toEqual(['x.mp4'])
    expect(service.list()[0]).toMatchObject({ jsonPath: null, status: 'done' })
  })

  it('enqueueFiles reports videos without JSON and non-videos', async () => {
    const kit = makeKit(dir)
    const video = path.join(dir, 'plain.mp4')
    await writeFile(video, 'v')
    await writeFile(path.join(dir, 'a.txt'), 't')
    const result = await fakeService(kit).enqueueFiles({
      paths: [video, path.join(dir, 'a.txt'), path.join(dir, 'missing.mp4')],
      options: parsedOptions(),
      force: false
    })
    expect(result.jobIds).toEqual([])
    expect(result.skipped).toHaveLength(3)
  })
})

describe('post-job rules (checklist 27-34)', () => {
  it('failure keeps the video and JSON, writes <video>.log, runs no hook', async () => {
    const kit = makeKit(dir)
    const video = await addJob('f.mp4')
    const service = new JobsService(kit.ctx, {
      emit: (e) => kit.events.push(e),
      executorDeps: {
        tools: () => ({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }),
        probe: () => Promise.resolve(INFO),
        stepExecutor: () => () => Promise.resolve({ status: 'exited', exitCode: 1 })
      }
    })
    await service.enqueueFiles({
      paths: [video],
      options: parsedOptions({ upload: true, deleteOriginal: true }),
      force: false
    })
    await service.queue.idle()
    expect(kit.events.some((e) => e.type === 'error')).toBe(true)
    expect(kit.trashed).toEqual([])
    expect(kit.hookCalls).toEqual([])
    expect(await readFile(`${video}.log`, 'utf8')).toContain('Attempt 8/8')
    expect(service.list()[0]?.logPath).toBe(`${video}.log`)
  })

  it('success writes no log; deleteOriginal trashes video + json (journalled)', async () => {
    const kit = makeKit(dir)
    const video = await addJob('s.mp4')
    const service = fakeService(kit)
    await service.enqueueFiles({ paths: [video], options: parsedOptions({ deleteOriginal: true }), force: false })
    await service.queue.idle()
    expect(kit.trashed).toEqual([video, `${video}.json`])
    expect(kit.journal.filter((j) => j.entry.op === 'trash').map((j) => j.entry.from)).toEqual([video, `${video}.json`])
    expect((await readdir(custom)).some((n) => n.endsWith('.log'))).toBe(false)
  })

  it('without deleteOriginal nothing is trashed; a disabled hook is skipped', async () => {
    const kit = makeKit(dir)
    const video = await addJob('n.mp4')
    const service = fakeService(kit)
    kit.setHookExit(0, true)
    await service.enqueueFiles({ paths: [video], options: parsedOptions({ upload: true }), force: false })
    await service.queue.idle()
    expect(kit.trashed).toEqual([])
    expect(kit.hookCalls).toHaveLength(1)
    expect(kit.hookCalls[0]).toMatchObject({
      name: 'uploadOutputs',
      context: { file: video, root: dir, outputs: [`${video}.0.mp4`] }
    })
  })

  it('a failing upload hook blocks the delete; a successful one allows it', async () => {
    const kit = makeKit(dir)
    const video = await addJob('u.mp4')
    const service = fakeService(kit)
    kit.setHookExit(3)
    await service.enqueueFiles({ paths: [video], options: parsedOptions({ upload: true, deleteOriginal: true }), force: false })
    await service.queue.idle()
    expect(kit.trashed).toEqual([])
    kit.setHookExit(0)
    await service.enqueueFiles({ paths: [video], options: parsedOptions({ upload: true, deleteOriginal: true }), force: false })
    await service.queue.idle()
    expect(kit.trashed).toEqual([video, `${video}.json`])
  })

  it('computes {md5} only when the hook references it', async () => {
    const settings = settingsWith((s) => {
      s.hooks.uploadOutputs = { enabled: true, command: 'x', args: ['{outputs}'], env: { md5: '{md5}' } }
      return s
    })
    const kit = makeKit(dir, settings)
    const video = await addJob('m.mp4')
    await fakeService(kit).enqueueFiles({ paths: [video], options: parsedOptions({ upload: true }), force: false })
    const service = fakeService(kit)
    await service.queue.idle()
    await service.enqueueFiles({ paths: [video], options: parsedOptions({ upload: true }), force: false })
    await service.queue.idle()
    const withMd5 = kit.hookCalls.find((c) => c.context.md5 !== undefined)
    expect(withMd5?.context.md5).toMatch(/^[0-9a-f]{32}$/)
  })

  it('uploadAll runs once when the batch drains, with every output', async () => {
    const kit = makeKit(dir)
    await addJob('a.mp4')
    await addJob('b.mp4')
    const service = fakeService(kit)
    await service.enqueueFolder({ dir: custom, options: parsedOptions({ uploadAll: true }), force: false })
    await service.queue.idle()
    const calls = kit.hookCalls.filter((c) => c.name === 'uploadAll')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.context.outputs).toEqual([
      path.join(custom, 'a.mp4.0.mp4'),
      path.join(custom, 'b.mp4.0.mp4')
    ])
  })

  it('cancel and clearQueue through the service; unknown ids are NOT_FOUND', async () => {
    const kit = makeKit(dir)
    const service = fakeService(kit)
    expect(() => service.cancel('nope')).toThrow(/Unknown job/)
    expect(service.clearQueue()).toEqual({ cancelled: 0 })
    expect(() => service.log('nope')).toThrow(/Unknown job/)
  })
})

describe('saveJob / readJob', () => {
  it('writes the v2 file and reads it back; absent file is found:false', async () => {
    const kit = makeKit(dir)
    const service = fakeService(kit)
    const video = path.join(custom, 'z.mp4')
    expect((await service.readJob(video)).found).toBe(false)
    const saved = await service.saveJob({ videoPath: video, job: { times: [[10, 20]], rate: 700 } })
    expect(saved.jsonPath).toBe(`${video}.json`)
    const read = await service.readJob(video)
    expect(read).toMatchObject({ found: true, format: 'v2' })
    expect(read.job?.rate).toBe(700)
    await expect(service.saveJob({ videoPath: path.join(custom, 'x.txt'), job: {} })).rejects.toThrow()
    await writeFile(`${video}.json`, '{bad')
    expect(await service.readJob(video)).toMatchObject({ found: true, job: null })
  })
})

describe('tools parsing', () => {
  it('parses version, encoders and hwaccels', () => {
    expect(parseVersion('ffmpeg version 8.0.1-full_build Copyright')).toBe('8.0.1-full_build')
    const encoders = ' V....D libx264              H.264\n V....D h264_nvenc           NVIDIA\n V....D hevc_nvenc  x\n A....D aac  y'
    expect(parseH264Encoders(encoders)).toEqual(['libx264', 'h264_nvenc'])
    expect(parseHwaccels('Hardware acceleration methods:\ncuda\ndxva2\n')).toEqual(['cuda', 'dxva2'])
  })
})

function parsedOptions(over: Partial<ReturnType<typeof defaults>> = {}): ReturnType<typeof defaults> {
  return { ...defaults(), ...over }
}
function defaults(): {
  upload: boolean
  uploadAll: boolean
  deleteOriginal: boolean
  ignoreErrors: boolean
  sameSize: boolean
  keepParts: boolean
} {
  return { upload: false, uploadAll: false, deleteOriginal: false, ignoreErrors: false, sameSize: false, keepParts: false }
}

const tools = findTestTools()
describe.skipIf(tools === null)('real ffmpeg batch', () => {
  it('processes a folder with 2 JSONs end to end (cut + concat) and trashes originals', async () => {
    if (tools === null) return
    const kit = makeKit(dir, { ...DEFAULT_SETTINGS, ffmpeg: { ...DEFAULT_SETTINGS.ffmpeg, encoders: ['libx264'], hwaccel: 'none' } })
    const a = await generateVideo(tools, custom, 'a.mp4', { seconds: 3 })
    const b = await generateVideo(tools, custom, 'b.mp4', { seconds: 3 })
    await writeFile(`${a}.json`, serializeVideoJob(createVideoJob(a, { times: [[500, 1500]] })))
    await writeFile(`${b}.json`, serializeVideoJob(createVideoJob(b, { posExecution: 2, times: [[0, 1000], [1500, 2500]] })))
    const service = new JobsService(kit.ctx, {
      emit: (e) => kit.events.push(e),
      executorDeps: {
        tools: () => ({ ffmpeg: tools.ffmpeg, ffprobe: tools.ffprobe })
      }
    })
    await service.enqueueFolder({ dir: custom, options: parsedOptions({ deleteOriginal: true }), force: false })
    await service.queue.idle()
    const done = kit.events.filter((e) => e.type === 'done')
    expect(done).toHaveLength(2)
    const names = (await readdir(custom)).sort()
    expect(names).toContain('a.mp4.0.mp4')
    expect(names).toContain('b.mp4.mp4')
    expect(names).not.toContain('b.mp4.0.mp4')
    expect(names).not.toContain('a.mp4')
    expect(kit.trashed).toContain(a)
    expect(kit.trashed).toContain(b)
  })
})
