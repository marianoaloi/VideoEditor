import { existsSync } from 'node:fs'
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { HookExit, HookOutput, HookPreview, HookRunStarted } from '@shared/domain/hooks'
import { createEnv, makeBase, touch, type TestEnv } from '../fileops/testSupport'
import { commandWarnings, isShellCommand, resolveCommandPath } from './resolveCommand'

let env: TestEnv
const extra: string[] = []
afterEach(async () => {
  env.dispose()
  await rm(env.base, { recursive: true, force: true })
  for (const dir of extra.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function runDeleteR(context: Record<string, unknown>): Promise<{ started: HookRunStarted; exit: HookExit }> {
  const started = await env.ok<HookRunStarted>('hooks:run', { name: 'deleteR', context })
  return { started, exit: await env.ctx.services.require('hooks').waitForExit(started.runId) }
}

function stderrOf(): string {
  return env.events
    .filter((e) => e.channel === 'hooks:output')
    .map((e) => e.payload as HookOutput)
    .filter((p) => p.stream === 'stderr')
    .flatMap((p) => p.lines)
    .join('\n')
}

describe('deleteR targets only <root>/R (review H1)', () => {
  it('refuses a dir that is not the R folder of the root (L, the root itself, another tree)', async () => {
    env = await createEnv()
    const root = path.join(env.base, 'in')
    await touch(path.join(root, 'L', 'keep.jpg'))
    await touch(path.join(root, 'R', 'x.jpg'))
    for (const dir of [path.join(root, 'L'), root, path.join(env.base, 'other')]) {
      const res = await env.call('hooks:run', { name: 'deleteR', context: { dir, root } })
      expect(res).toMatchObject({ ok: false, error: { code: 'PATH_NOT_ALLOWED' } })
    }
    expect(env.trashed).toEqual([])
    expect(existsSync(path.join(root, 'L', 'keep.jpg'))).toBe(true)
  })

  it('ignores renderer files that are not directly inside R and reports them', async () => {
    env = await createEnv()
    const root = path.join(env.base, 'in')
    const inside = await touch(path.join(root, 'R', 'a.jpg'))
    const outside = await touch(path.join(root, 'L', 'precious.jpg'))
    const nested = await touch(path.join(root, 'R', 'sub', 'deep.jpg'))
    const { exit } = await runDeleteR({ root, dir: path.join(root, 'R'), files: [inside, outside, nested] })
    expect(exit.trashed).toBe(1)
    expect(env.trashed).toEqual([inside])
    expect(existsSync(outside)).toBe(true)
    expect(existsSync(nested)).toBe(true)
    expect(stderrOf()).toContain('precious.jpg')
  })

  it('requires an approved root: an unapproved folder is refused, nothing is trashed', async () => {
    env = await createEnv(undefined, { approveBase: false })
    const root = path.join(env.base, 'in')
    await touch(path.join(root, 'R', 'a.jpg'))
    const res = await env.call('hooks:run', { name: 'deleteR', context: { root, dir: path.join(root, 'R') } })
    expect(res).toMatchObject({ ok: false, error: { code: 'PATH_NOT_ALLOWED' } })
    expect(env.trashed).toEqual([])
  })

  it('requires the session root', async () => {
    env = await createEnv()
    const res = await env.call('hooks:run', { name: 'deleteR', context: { dir: path.join(env.base, 'R') } })
    expect(res).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
  })

  it('without a dir it uses the configured R folder; a missing R trashes nothing', async () => {
    env = await createEnv()
    const root = path.join(env.base, 'in')
    await mkdir(root, { recursive: true })
    const { started, exit } = await runDeleteR({ root })
    expect(started).toMatchObject({ skipped: true, builtIn: true })
    expect(exit).toMatchObject({ code: 0, trashed: 0 })
  })

  it('does not follow an R junction/symlink that leaves the root', async () => {
    env = await createEnv()
    const root = path.join(env.base, 'in')
    const elsewhere = path.join(env.base, 'elsewhere')
    const victim = await touch(path.join(elsewhere, 'victim.jpg'))
    await mkdir(root, { recursive: true })
    await symlink(elsewhere, path.join(root, 'R'), 'junction')
    const res = await env.call('hooks:run', { name: 'deleteR', context: { root, dir: path.join(root, 'R') } })
    expect(res).toMatchObject({ ok: false, error: { code: 'PATH_NOT_ALLOWED' } })
    expect(existsSync(victim)).toBe(true)
  })

  it('rejects UNC and device roots', async () => {
    env = await createEnv()
    for (const root of ['\\\\server\\share\\in', '\\\\?\\C:\\in']) {
      const res = await env.call('hooks:run', { name: 'deleteR', context: { root } })
      expect(res).toMatchObject({ ok: false, error: { code: 'PATH_NOT_ALLOWED' } })
    }
  })

  it('other hooks also refuse paths outside approved folders (renderer-originated runs)', async () => {
    env = await createEnv()
    const outsideBase = await makeBase('outside')
    extra.push(outsideBase)
    await env.ok('settings:update', { patch: { hooks: { externalPlayer: { enabled: true, command: process.execPath, args: ['{file}'] } } } })
    const res = await env.call('hooks:run', { name: 'externalPlayer', context: { file: path.join(outsideBase, 'a.mp4') } })
    expect(res).toMatchObject({ ok: false, error: { code: 'PATH_NOT_ALLOWED' } })
  })
})

describe('commands are resolved to absolute paths (review M9)', () => {
  it('preview warns for shells and batch files, and for commands it cannot find', async () => {
    env = await createEnv()
    const preview = async (command: string): Promise<HookPreview> =>
      env.ok<HookPreview>('hooks:preview', {
        template: { enabled: true, command, args: ['{file}'] },
        context: { file: path.join(env.base, 'a.mp4') }
      })
    for (const shell of ['cmd', 'powershell', 'pwsh', 'sh', 'bash', 'zsh']) {
      expect((await preview(shell)).warnings?.some((w) => w.includes('is a shell'))).toBe(true)
    }
    expect((await preview(process.execPath)).warnings).toEqual([])
    expect((await preview('definitely-not-installed-xyz')).warnings?.join(' ')).toContain('not found on PATH')
  })

  it('isShellCommand ignores directory and extension', () => {
    expect(isShellCommand('C:\\Windows\\System32\\cmd.exe')).toBe(true)
    expect(isShellCommand('/usr/bin/bash')).toBe(true)
    expect(isShellCommand('ffplay')).toBe(false)
    expect(commandWarnings('play.bat', null).join(' ')).toContain('.cmd/.bat')
  })

  it('never looks in the working directory: a planted program is not found', async () => {
    env = await createEnv()
    const planted = path.join(env.base, process.platform === 'win32' ? 'planted.exe' : 'planted')
    await writeFile(planted, 'x')
    const original = process.cwd()
    process.chdir(env.base)
    try {
      expect(resolveCommandPath('planted', { PATH: '.' })).toBeNull()
      expect(resolveCommandPath('planted', { PATH: '' })).toBeNull()
      expect(resolveCommandPath('./planted', { PATH: env.base })).toBeNull()
      expect(resolveCommandPath('planted', { PATH: env.base })?.toLowerCase()).toBe(planted.toLowerCase())
    } finally {
      process.chdir(original)
    }
  })

  it('a bare command that is not on PATH fails with NOT_FOUND even if it exists in the hook cwd', async () => {
    env = await createEnv()
    const cwd = path.join(env.base, 'cwd')
    await touch(path.join(cwd, process.platform === 'win32' ? 'bare.exe' : 'bare'))
    await env.ok('settings:update', {
      patch: { hooks: { externalPlayer: { enabled: true, command: 'bare', args: [], cwd } } }
    })
    const started = await env.ok<HookRunStarted>('hooks:run', {
      name: 'externalPlayer',
      context: { file: path.join(env.base, 'a.mp4') }
    })
    const exit = await env.ctx.services.require('hooks').waitForExit(started.runId)
    expect(exit.error).toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('hook processes die with the app (review L3)', () => {
  it('dispose() cancels a running hook', async () => {
    env = await createEnv()
    const sleeper = path.join(env.base, 'sleep.js')
    await writeFile(sleeper, 'setTimeout(function () {}, 30000)') // braces in -e would read as placeholders
    await env.ok('settings:update', {
      patch: { hooks: { externalPlayer: { enabled: true, command: process.execPath, args: [sleeper] } } }
    })
    const started = await env.ok<HookRunStarted>('hooks:run', {
      name: 'externalPlayer',
      context: { file: path.join(env.base, 'a.mp4') }
    })
    await new Promise((resolve) => setTimeout(resolve, 300))
    env.dispose()
    const exit = await env.ctx.services.require('hooks').waitForExit(started.runId)
    expect(exit.error).toMatchObject({ code: 'CANCELLED' })
  })
})
