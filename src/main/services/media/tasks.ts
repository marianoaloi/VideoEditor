/**
 * Background work for `media:prefetch`, `media:generateMosaics` and `media:cancelTask`:
 * a small concurrency-limited queue, cancellable tasks and throttled progress events.
 */
import type {
  GenerateMosaicsResult,
  ImageRef,
  MediaInfo,
  MosaicProgress,
  PrefetchResult
} from '@shared/domain/media'
import { AppError, toIpcError } from '../../ipc/errors'

const MOSAIC_CONCURRENCY = 2
const PROGRESS_INTERVAL_MS = 100

export interface TaskDeps {
  readonly probe: (file: string) => Promise<MediaInfo>
  readonly mosaic: (file: string, signal?: AbortSignal) => Promise<ImageRef>
  readonly emit: (progress: MosaicProgress) => void
  readonly onBackgroundError: (file: string, error: unknown) => void
  readonly now?: () => number
}

export interface MediaTasks {
  prefetch(paths: readonly string[], what: readonly ('probe' | 'mosaic')[]): PrefetchResult
  generate(taskId: string, paths: readonly string[]): Promise<GenerateMosaicsResult>
  cancel(taskId: string): void
}

export function createMediaTasks(deps: TaskDeps): MediaTasks {
  const now = deps.now ?? Date.now
  const running = new Map<string, AbortController>()
  let prefetchChain: Promise<void> = Promise.resolve()

  const prefetch: MediaTasks['prefetch'] = (paths, what) => {
    for (const file of paths) {
      prefetchChain = prefetchChain.then(async () => {
        try {
          if (what.includes('probe')) await deps.probe(file)
          if (what.includes('mosaic')) await deps.mosaic(file)
        } catch (error: unknown) {
          deps.onBackgroundError(file, error)
        }
      })
    }
    return { queued: paths.length }
  }

  const generate: MediaTasks['generate'] = async (taskId, paths) => {
    if (running.has(taskId)) throw new AppError('CONFLICT', `Task ${taskId} is already running`)
    const controller = new AbortController()
    running.set(taskId, controller)
    const state = { done: 0, failed: 0, processed: 0, lastEmit: 0, next: 0 }
    const report = (file: string, error?: unknown): void => {
      state.processed += 1
      const last = state.processed === paths.length
      if (!last && error === undefined && now() - state.lastEmit < PROGRESS_INTERVAL_MS) return
      state.lastEmit = now()
      deps.emit({
        taskId,
        done: state.processed,
        total: paths.length,
        path: file,
        ...(error === undefined ? {} : { error: toIpcError(error) })
      })
    }
    const worker = async (): Promise<void> => {
      for (let i = state.next++; i < paths.length; i = state.next++) {
        if (controller.signal.aborted) return
        const file = paths[i] as string
        try {
          await deps.mosaic(file, controller.signal)
          state.done += 1
          report(file)
        } catch (error: unknown) {
          if (controller.signal.aborted) return
          state.failed += 1
          report(file, error)
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: MOSAIC_CONCURRENCY }, worker))
      return {
        taskId,
        done: state.done,
        failed: state.failed,
        cancelled: controller.signal.aborted
      }
    } finally {
      running.delete(taskId)
    }
  }

  return { prefetch, generate, cancel: (taskId) => running.get(taskId)?.abort() }
}
