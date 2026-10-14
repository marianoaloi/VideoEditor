/**
 * Fallback for runs where electron-vite's `?modulePath` is not available (Vitest, plain Node):
 * bundles `hashWorker.ts` with esbuild into `node_modules/.cache` (so `require('sharp')` still
 * resolves) and returns that file. Never used in a packaged build.
 */
import { rmSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

interface EsbuildLike {
  build(options: Record<string, unknown>): Promise<unknown>
}

let cached: Promise<string> | null = null

async function bundle(): Promise<string> {
  // Variable specifier: the production bundler must not try to include esbuild.
  const specifier = 'esbuild'
  const esbuild = (await import(/* @vite-ignore */ specifier)) as EsbuildLike
  const root = process.cwd()
  const outdir = path.join(root, 'node_modules', '.cache', 'videoeditor-hash-worker', String(process.pid))
  await mkdir(outdir, { recursive: true })
  process.once('exit', () => rmSync(outdir, { recursive: true, force: true }))
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'hashWorker.ts')],
    outfile: path.join(outdir, 'hashWorker.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['sharp'],
    alias: {
      '@shared': path.join(root, 'src', 'shared'),
      '@main': path.join(root, 'src', 'main')
    },
    logLevel: 'silent'
  })
  return path.join(outdir, 'hashWorker.cjs')
}

export function devWorkerPath(): Promise<string> {
  cached ??= bundle()
  return cached
}
