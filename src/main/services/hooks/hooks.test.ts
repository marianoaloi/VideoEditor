import { existsSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { HookExit, HookOutput, HookPreview, HookRunStarted } from '@shared/domain/hooks'
import { createEnv, touch, type TestEnv } from '../fileops/testSupport'
import { BATCH_FILE_MESSAGE } from './service'

let env: TestEnv
afterEach(async () => {
  await rm(env.base, { recursive: true, force: true })
})

const NODE = process.execPath
const DUMP_SOURCE = 'process.stdout.write(JSON.stringify({argv:process.argv.slice(2),env:process.env.HOOK_PATHS}))'

/** Braces in `node -e` code would be read as placeholders, so the probe lives in a file. */
async function writeDump(): Promise<string> {
  const file = path.join(env.base, 'dump.js')
  await writeFile(file, DUMP_SOURCE)
  return file
}

async function configure(name: string, template: Record<string, unknown>): Promise<void> {
  await env.ok('settings:update', { patch: { hooks: { [name]: { enabled: true, ...template } } } })
}

async function runHook(name: string, context: Record<string, unknown>): Promise<{ started: HookRunStarted; exit: HookExit }> {
  const started = await env.ok<HookRunStarted>('hooks:run', { name, context })
  const exit = await env.ctx.services.require('hooks').waitForExit(started.runId)
  return { started, exit }
}

function stdoutOf(): string {
  return env.events
    .filter((e) => e.channel === 'hooks:output')
    .map((e) => e.payload as HookOutput)
    .filter((p) => p.stream === 'stdout')
    .flatMap((p) => p.lines)
    .join('')
}

describe('hooks:run (ADR-008)', () => {
  it('is skipped while disabled or unconfigured', async () => {
    env = await createEnv()
    const { started, exit } = await runHook('externalPlayer', { file: path.join(env.base, 'a.mp4') })
    expect(started.skipped).toBe(true)
    expect(exit).toMatchObject({ code: null, error: null })
    expect(env.events.filter((e) => e.channel === 'hooks:exit')).toHaveLength(0)
  })

  it('passes expanded argv verbatim (spaces, no shell), env with newline-joined lists, and emits output + exit', async () => {
    env = await createEnv()
    await configure('openList', {
      command: NODE,
      args: [await writeDump(), '{files}', '--x={files}'],
      env: { HOOK_PATHS: '{files}' }
    })
    const files = [path.join(env.base, 'a b.mp4'), path.join(env.base, 'c & d.mp4')]
    const { started, exit } = await runHook('openList', { files })
    expect(started.skipped).toBe(false)
    expect(exit).toMatchObject({ code: 0, error: null })
    const out = JSON.parse(stdoutOf()) as { argv: string[]; env: string }
    expect(out.argv).toEqual([...files, ...files.map((f) => `--x=${f}`)])
    expect(out.env).toBe(files.join('\n'))
    expect(env.events.find((e) => e.channel === 'hooks:exit')?.payload).toMatchObject({ runId: started.runId, code: 0 })
  })

  it('reports a non-zero exit', async () => {
    env = await createEnv()
    await configure('externalPlayer', { command: NODE, args: ['-e', 'process.exit(4)'] })
    const { exit } = await runHook('externalPlayer', { file: path.join(env.base, 'a.mp4') })
    expect(exit.code).toBe(4)
    expect(exit.error).toMatchObject({ code: 'PROCESS_FAILED' })
  })

  it('reports a missing executable as NOT_FOUND', async () => {
    env = await createEnv()
    await configure('externalPlayer', { command: path.join(env.base, 'nope-player'), args: ['{file}'] })
    const { exit } = await runHook('externalPlayer', { file: path.join(env.base, 'a.mp4') })
    expect(exit.code).toBeNull()
    expect(exit.error).toMatchObject({ code: 'NOT_FOUND' })
  })

  it.skipIf(process.platform !== 'win32')('explains that .cmd/.bat cannot be spawned (EINVAL)', async () => {
    env = await createEnv()
    const script = path.join(env.base, 'play.cmd')
    await writeFile(script, '@echo off\r\n')
    await configure('externalPlayer', { command: script, args: ['{file}'] })
    const { exit } = await runHook('externalPlayer', { file: path.join(env.base, 'a.mp4') })
    expect(exit.error?.message).toBe(BATCH_FILE_MESSAGE)
  })

  it('rejects an unknown placeholder or a missing value before starting (VALIDATION)', async () => {
    env = await createEnv()
    await configure('externalPlayer', { command: NODE, args: ['{nope}'] })
    expect(await env.call('hooks:run', { name: 'externalPlayer', context: {} })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' }
    })
    await configure('externalPlayer', { command: NODE, args: ['{file}'] })
    expect(await env.call('hooks:run', { name: 'externalPlayer', context: {} })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' }
    })
  })

  it('deleteR trashes the top-level files of its folder even when the command is off, keeps sub-folders', async () => {
    env = await createEnv()
    const r = path.join(env.base, 'in', 'R')
    await touch(path.join(r, 'a.jpg'))
    await touch(path.join(r, '.hid.jpg'))
    await touch(path.join(r, 'sub', 'keep.jpg'))
    const { started, exit } = await runHook('deleteR', { dir: r, root: path.join(env.base, 'in') })
    expect(started).toMatchObject({ skipped: true, builtIn: true })
    expect(exit.trashed).toBe(2)
    expect(exit).toMatchObject({ code: 0, error: null })
    expect(env.trashed.map((p) => path.basename(p)).sort()).toEqual(['.hid.jpg', 'a.jpg'])
    expect(existsSync(path.join(r, 'sub', 'keep.jpg'))).toBe(true)
    const journal = await env.ok<{ op: string }[]>('fileops:journal', {
      sessionId: (await env.ok<{ id: string }>('session:open', { dir: path.join(env.base, 'in'), kind: 'image' })).id
    })
    expect(journal.map((e) => e.op)).toEqual(['trash', 'trash'])
  })

  it('deleteR then runs the optional command with the trashed files as {files}', async () => {
    env = await createEnv()
    const r = path.join(env.base, 'in', 'R')
    const a = await touch(path.join(r, 'a.jpg'))
    await configure('deleteR', { command: NODE, args: [await writeDump(), '{files}'], env: { HOOK_PATHS: '{dir}' } })
    const { started, exit } = await runHook('deleteR', { dir: r, root: path.join(env.base, 'in') })
    expect(started.skipped).toBe(false)
    expect(exit.code).toBe(0)
    expect(stdoutOf()).toContain(JSON.stringify(a).slice(1, -1))
  })

  it('deleteR reports files that could not be trashed and never hard-deletes', async () => {
    env = await createEnv()
    const r = path.join(env.base, 'in', 'R')
    await touch(path.join(r, 'stuck.jpg'))
    env.ctx.trashItem = () => Promise.reject(new Error('locked'))
    const { exit } = await runHook('deleteR', { dir: r, root: path.join(env.base, 'in') })
    expect(exit.code).toBe(1)
    expect(exit.trashed).toBe(0)
    expect(existsSync(path.join(r, 'stuck.jpg'))).toBe(true)
    expect(exit.error).toMatchObject({ code: 'PROCESS_FAILED' })
  })
})

describe('hooks:preview', () => {
  it('expands without running', async () => {
    env = await createEnv()
    const template = { enabled: true, command: 'player', args: ['{files}', '-r={root}'], env: { P: '{files}' }, cwd: '{dir}' }
    const r = await env.ok<HookPreview>('hooks:preview', {
      template,
      context: { files: [path.join(env.base, 'a'), path.join(env.base, 'b')], root: env.base, dir: env.base }
    })
    expect(r.args).toEqual([path.join(env.base, 'a'), path.join(env.base, 'b'), `-r=${env.base}`])
    expect(r.env).toEqual({ P: `${path.join(env.base, 'a')}\n${path.join(env.base, 'b')}` })
    expect(r.cwd).toBe(env.base)
  })

  it('answers VALIDATION for bad placeholders', async () => {
    env = await createEnv()
    const r = await env.call('hooks:preview', {
      template: { enabled: true, command: 'x', args: ['{bogus}'] },
      context: {}
    })
    expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION', message: expect.stringContaining('bogus') } })
  })
})
