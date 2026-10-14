import { describe, expect, it } from 'vitest'
import { applySettingsPatch, DEFAULT_SETTINGS, type SettingsPatch } from './settings'

describe('applySettingsPatch', () => {
  it('replaces a hook env map so a removed variable is really deleted', () => {
    const withEnv = applySettingsPatch(DEFAULT_SETTINGS, {
      hooks: { moviesL: { env: { A: '1', B: '2' } } }
    } as SettingsPatch)
    expect(withEnv.hooks.moviesL.env).toEqual({ A: '1', B: '2' })

    const trimmed = applySettingsPatch(withEnv, {
      hooks: { moviesL: { env: { A: '1' } } }
    } as SettingsPatch)
    expect(trimmed.hooks.moviesL.env).toEqual({ A: '1' })
  })

  it('still deep-merges other fields', () => {
    const next = applySettingsPatch(DEFAULT_SETTINGS, {
      hooks: { moviesL: { enabled: true } }
    } as SettingsPatch)
    expect(next.hooks.moviesL.enabled).toBe(true)
    expect(next.hooks.moviesL.args).toEqual(DEFAULT_SETTINGS.hooks.moviesL.args)
  })
})
