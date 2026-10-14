import { readFile, rm, readdir, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '@shared/domain/settings'
import { createEnv, type TestEnv } from '../fileops/testSupport'
import { loadSettings, settingsFilePath } from './store'

let env: TestEnv
afterEach(async () => {
  await rm(env.base, { recursive: true, force: true })
})

describe('settings service', () => {
  it('returns the defaults on first run', async () => {
    env = await createEnv()
    expect(await env.ok<Settings>('settings:get', {})).toEqual(DEFAULT_SETTINGS)
  })

  it('update merges deeply, persists, emits settings:changed and updates ctx.settings', async () => {
    env = await createEnv()
    const next = await env.ok<Settings>('settings:update', { patch: { player: { volume: 0.9 }, folders: { personal: path.join(env.base, 'p') } } })
    expect(next.player).toEqual({ ...DEFAULT_SETTINGS.player, volume: 0.9 })
    expect(env.ctx.settings.get().player.volume).toBe(0.9)
    const onDisk = JSON.parse(await readFile(settingsFilePath(env.userData), 'utf8')) as Settings
    expect(onDisk.player.volume).toBe(0.9)
    const event = env.events.find((e) => e.channel === 'settings:changed')
    expect((event?.payload as Settings).player.volume).toBe(0.9)
  })

  it('an invalid patch saves nothing and answers VALIDATION', async () => {
    env = await createEnv()
    const r = await env.call('settings:update', { patch: { player: { volume: 7 } } })
    expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(env.ctx.settings.get().player.volume).toBe(DEFAULT_SETTINGS.player.volume)
    await expect(readFile(settingsFilePath(env.userData))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(env.events.filter((e) => e.channel === 'settings:changed')).toHaveLength(0)
  })

  it('reset restores one section or everything', async () => {
    env = await createEnv()
    await env.ok('settings:update', { patch: { player: { volume: 0.1 }, thumbs: { enabled: true } } })
    const one = await env.ok<Settings>('settings:reset', { section: 'player' })
    expect(one.player).toEqual(DEFAULT_SETTINGS.player)
    expect(one.thumbs.enabled).toBe(true)
    const all = await env.ok<Settings>('settings:reset', {})
    expect(all).toEqual(DEFAULT_SETTINGS)
  })

  it('concurrent updates are written in order', async () => {
    env = await createEnv()
    await Promise.all([1, 2, 3, 4].map((n) => env.ok('settings:update', { patch: { imageTriage: { visibleCount: n } } })))
    const onDisk = JSON.parse(await readFile(settingsFilePath(env.userData), 'utf8')) as Settings
    expect(onDisk.imageTriage.visibleCount).toBe(env.ctx.settings.get().imageTriage.visibleCount)
  })
})

describe('loadSettings', () => {
  it('falls back per section and warns; a broken file is moved aside', async () => {
    env = await createEnv()
    const file = settingsFilePath(env.userData)
    await mkdir(env.userData, { recursive: true })
    await writeFile(file, JSON.stringify({ player: { volume: 'loud' }, thumbs: { enabled: true } }))
    const partial = loadSettings(file)
    expect(partial.settings.player).toEqual(DEFAULT_SETTINGS.player)
    expect(partial.settings.thumbs.enabled).toBe(true)
    expect(partial.warnings.some((w) => w.includes('player'))).toBe(true)

    await writeFile(file, '{ nope')
    const broken = loadSettings(file)
    expect(broken.settings).toEqual(DEFAULT_SETTINGS)
    expect(broken.warnings[0]).toContain('not valid JSON')
    expect((await readdir(env.userData)).some((n) => n.startsWith('settings.broken-'))).toBe(true)
  })
})
