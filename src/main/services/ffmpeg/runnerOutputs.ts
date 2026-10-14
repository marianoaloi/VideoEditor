/**
 * Output safety for the ffmpeg runner (review H5): ffmpeg writes `<name>.part.mp4`; only a
 * successful attempt promotes the part to its final name. An existing final file is never
 * overwritten: it goes to the trash (journalled by the caller) or the new file takes a
 * `name (n).mp4` collision name. The builder's argv vectors keep the final names; this module
 * rewrites exactly the tokens that equal a step output.
 */
import path from 'node:path'
import { collisionName } from '@shared/core/naming'
import type { FfmpegStep } from '@shared/core/ffmpegArgs'
import { isAlreadyExists, moveExclusive } from './exclusiveMove'
import { fileSize } from './runnerSteps'

const MAX_COLLISIONS = 1000

/** `v.mp4.0.mp4` -> `v.mp4.0.part.mp4`. */
export function partPath(finalPath: string): string {
  return finalPath.toLowerCase().endsWith('.mp4')
    ? `${finalPath.slice(0, -'.mp4'.length)}.part.mp4`
    : `${finalPath}.part`
}

/** The same steps writing (and reading intermediate files) under part names. */
export function toPartSteps(steps: readonly FfmpegStep[]): FfmpegStep[] {
  const names = new Map(steps.map((s) => [s.output, partPath(s.output)] as const))
  return steps.map((s) => ({
    ...s,
    argv: s.argv.map((token) => names.get(token) ?? token),
    output: partPath(s.output)
  }))
}

export interface PromoteOptions {
  /** Sends an existing file to the trash. Without it the new file takes a collision name. */
  readonly trashExisting?: (path: string) => Promise<void>
  readonly log: (line: string) => void
}

function collisionPath(finalPath: string, n: number): string {
  return path.join(path.dirname(finalPath), collisionName(path.basename(finalPath), n))
}

async function makeRoomFor(finalPath: string, options: PromoteOptions): Promise<void> {
  if ((await fileSize(finalPath)) === null || options.trashExisting === undefined) return
  try {
    await options.trashExisting(finalPath)
    options.log(`The existing ${finalPath} was sent to the trash`)
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    options.log(`Could not trash the existing ${finalPath} (${why}); using a new name`)
  }
}

/** Moves `part` to `finalPath` (or a collision name) without replacing anything. Returns the path used. */
export async function promotePart(
  part: string,
  finalPath: string,
  options: PromoteOptions
): Promise<string> {
  await makeRoomFor(finalPath, options)
  for (let n = 0; n < MAX_COLLISIONS; n += 1) {
    const target = collisionPath(finalPath, n)
    try {
      await moveExclusive(part, target)
      if (n > 0) options.log(`${finalPath} exists; wrote ${target} instead`)
      return target
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
    }
  }
  throw new Error(`No free output name for ${finalPath}`)
}
