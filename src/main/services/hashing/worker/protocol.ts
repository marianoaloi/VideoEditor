/** Messages between the hash worker pool (main thread) and `hashWorker.ts` (ADR-007). */
import type { PerceptualKeys } from '@shared/core/hashPrimitives'

export interface WorkerTools {
  readonly ffmpegPath: string
  readonly ffprobePath: string
}

interface JobBase {
  readonly id: number
  readonly path: string
  readonly cascade: boolean
  /** Reject inputs with more pixels than this (sharp `limitInputPixels`). */
  readonly maxPixels: number
}

export type HashJob =
  | (JobBase & { readonly op: 'image' })
  | (JobBase & { readonly op: 'video'; readonly tools: WorkerTools })

export type ToWorker =
  | { readonly type: 'job'; readonly job: HashJob }
  | { readonly type: 'cancel'; readonly id: number }

export type FromWorker =
  | { readonly type: 'result'; readonly id: number; readonly keys: PerceptualKeys[] }
  | { readonly type: 'error'; readonly id: number; readonly message: string }

/** Default cap on decoded pixels (268 MP, about 16400 x 16400). */
export const DEFAULT_MAX_PIXELS = 268_435_456
