/**
 * Seam between the scanner and the way perceptual keys are computed (ADR-007). The default
 * implementation is the pure-TS provider (`tsProvider.ts`); a native/OpenCV provider could be
 * plugged in later without touching the scanner or the CSV code.
 */
import type { PerceptualKeys } from '@shared/core/hashPrimitives'

export interface HashProvider {
  /** Stored in the CSV sidecar so mixed origins can be detected (never compare across ids). */
  readonly id: string
  /** Keys of an image: exactly one entry. Throws an `Error` whose message becomes `comments`. */
  hashImage(path: string, signal?: AbortSignal): Promise<PerceptualKeys[]>
  /** Keys of a video/gif: one entry per kept frame; an empty list means "no decodable frame". */
  hashVideo(path: string, signal?: AbortSignal): Promise<PerceptualKeys[]>
}

/** Version of the algorithm written to `<csv>.meta.json`; bump when the key definitions change. */
export const HASH_ALGO_VERSION = 1
export const HASH_ORIGIN = 'videoeditor-ts'

export interface CsvMeta {
  readonly origin: typeof HASH_ORIGIN
  readonly algo: number
  readonly provider: string
  readonly root: string
}
