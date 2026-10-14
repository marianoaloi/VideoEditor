/**
 * Job JSON on disk (`<video>.json`) and the batch folder scan (research §4, §10.2, B11).
 *
 * The scan never deletes anything: an orphan JSON (no video) or an empty one is reported and
 * moved to `<root>/<ruimFolder>/` by the caller; an invalid one stays where it is with its message.
 */
import { mkdir, readdir, readFile, rename, stat, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { mediaKindOf } from '@shared/core/mediaKind'
import { collisionName } from '@shared/core/naming'
import {
  createVideoJob,
  jobJsonPathFor,
  parseVideoJobText,
  serializeVideoJob
} from '@shared/core/videoJob'
import type { ReadJobResult, SaveJobResult, VideoJob, VideoJobDraft } from '@shared/domain/job'
import { AppError } from '../../ipc/errors'

const JSON_SUFFIX = /\.json$/i

/** Scan outcome for one `*.json`. */
export type ScanEntry =
  | {
      readonly kind: 'job'
      readonly jsonPath: string
      readonly videoPath: string
      readonly job: VideoJob
      readonly warnings: string[]
    }
  | {
      readonly kind: 'orphan' | 'empty' | 'invalid'
      readonly jsonPath: string
      readonly videoPath: string
      readonly reason: string
    }

function isNotFound(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, 'code') === 'ENOENT'
}

export async function exists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isFile()
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
}

/** The session root of a jobs folder: its parent when it is the CUSTOM folder, else itself. */
export function rootOfJobsDir(jobsDir: string, customName: string): string {
  const same =
    process.platform === 'win32'
      ? path.basename(jobsDir).toLowerCase() === customName.toLowerCase()
      : path.basename(jobsDir) === customName
  return same ? path.dirname(jobsDir) : jobsDir
}

/** The root for a video: `<root>/CUSTOM/x.mp4` belongs to `<root>`; anything else to its folder. */
export function rootOfVideo(videoPath: string, customName: string): string {
  return rootOfJobsDir(path.dirname(videoPath), customName)
}

export function videoPathOfJson(jsonPath: string): string {
  return jsonPath.replace(JSON_SUFFIX, '')
}

/** Atomic write: temp file in the same folder, then rename. */
async function writeFileAtomic(target: string, text: string, id: string): Promise<void> {
  const temp = `${target}.${id}.tmp`
  try {
    await writeFile(temp, text, 'utf8')
    await rename(temp, target)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

export async function saveJobFile(
  videoPath: string,
  draft: VideoJobDraft,
  tempId: string
): Promise<SaveJobResult> {
  if (mediaKindOf(path.basename(videoPath)) !== 'video') {
    throw new AppError('VALIDATION', 'Job files belong to video files', { path: videoPath })
  }
  const job = createVideoJob(videoPath, draft)
  const jsonPath = jobJsonPathFor(videoPath)
  await writeFileAtomic(jsonPath, serializeVideoJob(job), tempId)
  return { jsonPath, job }
}

/** Reads `<video>.json` in any format. Invalid files give `found: true` with a warning. */
export async function readJobFile(videoPath: string): Promise<ReadJobResult> {
  const jsonPath = jobJsonPathFor(videoPath)
  let text: string
  try {
    text = await readFile(jsonPath, 'utf8')
  } catch (error) {
    if (isNotFound(error)) return { found: false, job: null, format: null, warnings: [] }
    throw error
  }
  const parsed = parseVideoJobText(text, { videoPath })
  if (!parsed.ok) {
    return { found: true, job: null, format: null, warnings: [parsed.error, ...parsed.warnings] }
  }
  return { found: true, job: parsed.job, format: parsed.format, warnings: parsed.warnings }
}

/** Classifies one `*.json` path. Throws ENOENT when the file itself is missing. */
export async function scanJsonFile(jsonPath: string): Promise<ScanEntry> {
  const videoPath = videoPathOfJson(jsonPath)
  const info = await stat(jsonPath)
  if (info.size === 0) return { kind: 'empty', jsonPath, videoPath, reason: 'The job file is empty' }
  if (!(await isFile(videoPath))) {
    return { kind: 'orphan', jsonPath, videoPath, reason: 'The video of this job file is missing' }
  }
  const text = await readFile(jsonPath, 'utf8')
  if (text.trim() === '') return { kind: 'empty', jsonPath, videoPath, reason: 'The job file is empty' }
  const parsed = parseVideoJobText(text, { videoPath })
  if (!parsed.ok) return { kind: 'invalid', jsonPath, videoPath, reason: parsed.error }
  return { kind: 'job', jsonPath, videoPath, job: parsed.job, warnings: parsed.warnings }
}

/** Non-recursive, `/\.json$/i`, sorted ascending (checklist 24). */
export async function scanJobsDir(dir: string): Promise<ScanEntry[]> {
  const names = (await readdir(dir)).filter((name) => JSON_SUFFIX.test(name)).sort()
  const entries: ScanEntry[] = []
  for (const name of names) {
    const jsonPath = path.join(dir, name)
    if (await isFile(jsonPath)) entries.push(await scanJsonFile(jsonPath))
  }
  return entries
}

const DERIVED = /\.(copy|converted)\.mp4$/i
const NUMBERED_PART = /^(.+\.[A-Za-z0-9]+)\.\d+\.mp4$/

/** Output files of earlier runs (`v.mp4.0.mp4`, `v.mp4.mp4`, `v.mp4.copy.mp4`) are not sources. */
export function isDerivedOutput(name: string, siblings: ReadonlySet<string>): boolean {
  if (DERIVED.test(name)) return true
  const part = NUMBERED_PART.exec(name)
  if (part?.[1] !== undefined && mediaKindOf(part[1]) === 'video') return true
  if (/\.mp4$/i.test(name)) {
    const stem = name.slice(0, -'.mp4'.length)
    return mediaKindOf(stem) === 'video' && siblings.has(stem)
  }
  return false
}

/** Top-level videos of a folder for "force" jobs, sorted. */
export async function listFolderVideos(dir: string): Promise<string[]> {
  const names = await readdir(dir)
  const siblings = new Set(names)
  const videos = names
    .filter((name) => mediaKindOf(name) === 'video' && !isDerivedOutput(name, siblings))
    .sort()
  const result: string[] = []
  for (const name of videos) {
    const full = path.join(dir, name)
    if (await isFile(full)) result.push(full)
  }
  return result
}

/** Moves `source` into `<root>/<folder>/`, picking a free name. Returns the new path. */
export async function moveAside(source: string, root: string, folder: string): Promise<string> {
  const destDir = path.join(root, folder)
  await mkdir(destDir, { recursive: true })
  const name = path.basename(source)
  for (let n = 0; n < 1000; n += 1) {
    const target = path.join(destDir, collisionName(name, n))
    if (await exists(target)) continue
    await rename(source, target)
    return target
  }
  throw new AppError('ALREADY_EXISTS', `No free name for ${name} in ${destDir}`)
}
