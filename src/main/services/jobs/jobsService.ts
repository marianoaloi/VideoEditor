/**
 * The jobs service: save/read job JSON, enqueue folders and files, cancel, list, logs, tools.
 * `ipc.ts` maps the channels onto it; tests build it with a fake context and a fake executor.
 */
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { createVideoJob } from '@shared/core/videoJob'
import type { z } from 'zod'
import {
  EnqueueFilesRequestSchema,
  EnqueueFolderRequestSchema,
  type ClearQueueResult,
  type EnqueueOptions,
  type EnqueueResult,
  type JobEvent,
  type JobLogResult,
  type JobSummary,
  type ReadJobResult,
  type SaveJobRequest,
  type SaveJobResult,
  type ToolsStatus
} from '@shared/domain/job'
import type { Settings } from '@shared/domain/settings'
import { AppError } from '../../ipc/errors'
import type { MainContext } from '../../ipc/context'
import { requireTool } from '../ffmpeg/locate'
import { probeMedia } from '../ffmpeg/probe'
import { executeJob, type ExecutorDeps, type JobPayload } from './jobExecutor'
import {
  listFolderVideos,
  moveAside,
  readJobFile,
  rootOfVideo,
  saveJobFile,
  scanJobsDir,
  scanJsonFile,
  type ScanEntry
} from './jobFiles'
import { postJob, runUploadAll, type PostDeps } from './jobPost'
import { JobQueue } from './jobQueue'
import { readToolsStatus } from './toolsStatus'
import { mediaKindOf } from '@shared/core/mediaKind'

export interface JobsServiceOptions {
  /** Where events go; defaults to `ctx.sendEvent('jobs:event', ...)`. */
  emit?: (event: JobEvent) => void
  /** Replaces the whole probe/convert/ladder execution (tests). */
  executorDeps?: Partial<ExecutorDeps>
  progressIntervalMs?: number
  logFlushMs?: number
}

type Skipped = EnqueueResult['skipped'][number]
type FolderRequest = z.output<typeof EnqueueFolderRequestSchema>
type FilesRequest = z.output<typeof EnqueueFilesRequestSchema>

export class JobsService {
  readonly queue: JobQueue<JobPayload>
  private readonly emit: (event: JobEvent) => void

  constructor(
    private readonly ctx: MainContext,
    private readonly options: JobsServiceOptions = {}
  ) {
    this.emit = options.emit ?? ((event) => ctx.sendEvent('jobs:event', event))
    this.queue = new JobQueue<JobPayload>({
      concurrency: () => this.settings().ffmpeg.concurrency,
      execute: (payload, _summary, handle) => executeJob(this.executorDeps(), payload, handle),
      afterDone: (payload, summary, handle) => postJob(this.postDeps(), payload, summary.outputs, handle),
      onBatchSettled: (batchId, jobs) => this.finishBatch(batchId, jobs),
      emit: this.emit,
      ...(options.progressIntervalMs === undefined ? {} : { progressIntervalMs: options.progressIntervalMs }),
      ...(options.logFlushMs === undefined ? {} : { logFlushMs: options.logFlushMs })
    })
  }

  private settings(): Settings {
    return this.ctx.settings.get()
  }

  private executorDeps(): ExecutorDeps {
    return {
      settings: () => this.settings(),
      tools: () => {
        const config = this.settings().ffmpeg
        return {
          ffmpeg: requireTool('ffmpeg', config).path,
          ffprobe: requireTool('ffprobe', config).path
        }
      },
      probe: (file, ffprobePath) => probeMedia(file, { ffprobePath }),
      trash: (file, root) => this.trashWithJournal(file, root),
      ...this.options.executorDeps
    }
  }

  private postDeps(): PostDeps {
    return {
      hooks: this.ctx.services.has('hooks') ? this.ctx.services.require('hooks') : null,
      hookTemplate: (name) => this.settings().hooks[name],
      trash: (file, root) => this.trashWithJournal(file, root),
      probeDurationMs: async (file) => {
        const deps = this.executorDeps()
        const info = await deps.probe(file, deps.tools().ffprobe)
        return info.durationMs > 0 ? info.durationMs : null
      }
    }
  }

  /** Moves to the OS trash and records it in the journal (ADR-006). Never deletes permanently. */
  private async trashWithJournal(file: string, root: string): Promise<void> {
    await this.ctx.trashItem(file)
    if (!this.ctx.services.has('journal')) return
    await this.ctx.services
      .require('journal')
      .record(root, { op: 'trash', from: file, to: null, sidecars: [], undoable: false }, null)
  }

  // ---- job files ------------------------------------------------------------------------

  saveJob(request: SaveJobRequest): Promise<SaveJobResult> {
    return saveJobFile(request.videoPath, request.job, this.ctx.newId())
  }

  readJob(videoPath: string): Promise<ReadJobResult> {
    return readJobFile(videoPath)
  }

  // ---- enqueue --------------------------------------------------------------------------

  async enqueueFolder(request: FolderRequest): Promise<EnqueueResult> {
    await this.requireDirectory(request.dir)
    const entries = request.force
      ? this.forcedEntries(await listFolderVideos(request.dir))
      : await scanJobsDir(request.dir)
    return this.enqueueEntries(entries, request.options)
  }

  async enqueueFiles(request: FilesRequest): Promise<EnqueueResult> {
    const entries: ScanEntry[] = []
    const skipped: Skipped[] = []
    for (const target of request.paths) {
      await this.expandPath(target, request.force, entries, skipped)
    }
    const result = await this.enqueueEntries(entries, request.options)
    return { ...result, skipped: [...skipped, ...result.skipped] }
  }

  private async expandPath(
    target: string,
    force: boolean,
    entries: ScanEntry[],
    skipped: Skipped[]
  ): Promise<void> {
    let info
    try {
      info = await stat(target)
    } catch (error) {
      skipped.push({ path: target, reason: `Not found: ${error instanceof Error ? error.message : ''}`, movedTo: null })
      return
    }
    if (info.isDirectory()) {
      const found = force ? this.forcedEntries(await listFolderVideos(target)) : await scanJobsDir(target)
      entries.push(...found)
    } else if (/\.json$/i.test(target)) {
      entries.push(await scanJsonFile(target))
    } else if (mediaKindOf(path.basename(target)) !== 'video') {
      skipped.push({ path: target, reason: 'Not a video file', movedTo: null })
    } else if (force) {
      entries.push(...this.forcedEntries([target]))
    } else {
      entries.push(await this.sidecarEntry(target))
    }
  }

  private async sidecarEntry(videoPath: string): Promise<ScanEntry> {
    const jsonPath = `${videoPath}.json`
    try {
      return await scanJsonFile(jsonPath)
    } catch (error) {
      if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
        return { kind: 'invalid', jsonPath, videoPath, reason: 'No job file for this video (cut it first or process it whole)' }
      }
      throw error
    }
  }

  /** "Force": a full-length job per video, with no JSON. */
  private forcedEntries(videos: readonly string[]): ScanEntry[] {
    return videos.map((videoPath) => ({
      kind: 'job',
      jsonPath: '',
      videoPath,
      job: createVideoJob(videoPath, { times: [] }),
      warnings: []
    }))
  }

  private async enqueueEntries(entries: readonly ScanEntry[], options: EnqueueOptions): Promise<EnqueueResult> {
    const batchId = this.ctx.newId()
    const jobIds: string[] = []
    const skipped: Skipped[] = []
    for (const entry of entries) {
      if (entry.kind !== 'job') {
        skipped.push(await this.skipEntry(entry))
      } else if (this.queue.hasActiveJobFor(entry.videoPath)) {
        skipped.push({ path: entry.videoPath, reason: 'Already queued or running', movedTo: null })
      } else {
        jobIds.push(this.addJob(entry, options, batchId))
      }
    }
    return { batchId, jobIds, skipped }
  }

  private addJob(entry: Extract<ScanEntry, { kind: 'job' }>, options: EnqueueOptions, batchId: string): string {
    const id = this.ctx.newId()
    const root = rootOfVideo(entry.videoPath, this.settings().folders.custom)
    const jsonPath = entry.jsonPath === '' ? null : entry.jsonPath
    const summary: JobSummary = {
      id,
      videoPath: entry.videoPath,
      jsonPath,
      mode: entry.job.posExecution,
      status: 'queued',
      progress: 0,
      outputs: [],
      error: null,
      options,
      batchId,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      logPath: null
    }
    this.queue.add(summary, { videoPath: entry.videoPath, jsonPath, job: entry.job, options, root })
    return id
  }

  /** Orphan/empty JSON go to `<root>/<ruimFolder>/`; invalid ones stay put (B11). */
  private async skipEntry(entry: Exclude<ScanEntry, { kind: 'job' }>): Promise<Skipped> {
    if (entry.kind === 'invalid') {
      return { path: entry.jsonPath, reason: `Invalid job file: ${entry.reason}`, movedTo: null }
    }
    const settings = this.settings()
    const root = rootOfVideo(entry.videoPath, settings.folders.custom)
    try {
      const movedTo = await moveAside(entry.jsonPath, root, settings.folders.ruim)
      await this.journalMove(root, entry.jsonPath, movedTo)
      return { path: entry.jsonPath, reason: entry.reason, movedTo }
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error)
      return { path: entry.jsonPath, reason: `${entry.reason}; it could not be moved aside: ${why}`, movedTo: null }
    }
  }

  private async journalMove(root: string, from: string, to: string): Promise<void> {
    if (!this.ctx.services.has('journal')) return
    await this.ctx.services
      .require('journal')
      .record(root, { op: 'move', from, to, sidecars: [], undoable: true }, null)
  }

  private async requireDirectory(dir: string): Promise<void> {
    let info
    try {
      info = await stat(dir)
    } catch {
      throw new AppError('NOT_FOUND', `Folder not found: ${dir}`, { path: dir })
    }
    if (!info.isDirectory()) throw new AppError('VALIDATION', `Not a folder: ${dir}`, { path: dir })
  }

  // ---- queue control --------------------------------------------------------------------

  cancel(jobId: string): void {
    if (this.queue.get(jobId) === undefined) {
      throw new AppError('NOT_FOUND', `Unknown job: ${jobId}`, { jobId })
    }
    this.queue.cancel(jobId)
  }

  clearQueue(): ClearQueueResult {
    return { cancelled: this.queue.clearQueued() }
  }

  list(): JobSummary[] {
    return this.queue.list()
  }

  log(jobId: string): JobLogResult {
    const found = this.queue.logOf(jobId)
    if (found === undefined) throw new AppError('NOT_FOUND', `Unknown job: ${jobId}`, { jobId })
    return { jobId, lines: found.lines, logPath: found.logPath }
  }

  tools(refresh: boolean): Promise<ToolsStatus> {
    return readToolsStatus(this.settings().ffmpeg, refresh)
  }

  dispose(): void {
    this.queue.abortAll()
  }

  // ---- batch ----------------------------------------------------------------------------

  private async finishBatch(batchId: string, jobs: readonly JobSummary[]): Promise<void> {
    const wanted = jobs.filter((j) => j.status === 'done' && j.options.uploadAll)
    const outputs = wanted.flatMap((j) => j.outputs)
    const last = jobs[jobs.length - 1]
    if (outputs.length === 0 || last === undefined) return
    await runUploadAll(this.postDeps(), outputs, (line) => {
      this.queue.note(last.id, line)
    })
  }
}
