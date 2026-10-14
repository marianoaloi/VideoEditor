import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, SettingsSchema, type Settings } from '@shared/domain/settings'
import { buildPatch, getIn, SECTIONS, setIn, textToList } from './fields'
import { argsToText, envToText, isBatchScript, sampleContext, textToArgs, textToEnv } from './hooksForm'
import { HOOK_NAMES } from '@shared/domain/hooks'

function leafPaths(value: unknown, prefix: string[] = []): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [prefix.join('.')]
  return Object.entries(value).flatMap(([k, v]) => leafPaths(v, [...prefix, k]))
}

describe('Settings editor coverage (image-triage §12)', () => {
  it('has a field for every non-hook key of the schema', () => {
    const fields = new Set(SECTIONS.flatMap((s) => s.fields.map((f) => f.path.join('.'))))
    const expected = leafPaths({ ...DEFAULT_SETTINGS, schemaVersion: undefined, hooks: undefined }).filter(
      (p) => !p.startsWith('schemaVersion') && !p.startsWith('hooks')
    )
    expect([...fields].sort()).toEqual(expected.sort())
  })
  it('the defaults validate and every field path resolves', () => {
    expect(SettingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true)
    for (const field of SECTIONS.flatMap((s) => s.fields)) {
      expect(getIn(DEFAULT_SETTINGS, field.path)).not.toBeUndefined()
    }
  })
})

describe('buildPatch', () => {
  it('only sends changed sections', () => {
    const draft = setIn(DEFAULT_SETTINGS, ['imageTriage', 'visibleCount'], 7)
    expect(buildPatch(DEFAULT_SETTINGS, draft)).toEqual({ imageTriage: draft.imageTriage })
  })
  it('clears removed hook env keys and cwd with empty values', () => {
    const base: Settings = setIn(DEFAULT_SETTINGS, ['hooks', 'moviesL'], {
      enabled: true,
      command: 'movies.exe',
      args: ['{dir}'],
      cwd: 'C:\\x',
      env: { upload: 'true', keep: '1' }
    })
    const draft = setIn(base, ['hooks', 'moviesL'], {
      enabled: true,
      command: 'movies.exe',
      args: ['{dir}'],
      env: { keep: '1' }
    })
    const patch = buildPatch(base, draft)
    expect(patch.hooks?.moviesL).toMatchObject({ cwd: '', env: { keep: '1', upload: '' } })
  })
})

describe('text conversions', () => {
  it('parses lists, args and env', () => {
    expect(textToList(' h264_nvenc, libx264 ,')).toEqual(['h264_nvenc', 'libx264'])
    expect(textToArgs('{dir}\n\n--x\r\n')).toEqual(['{dir}', '--x'])
    expect(argsToText(['a', 'b'])).toBe('a\nb')
    expect(textToEnv('A=1\nB=x=y\nC')).toEqual({ A: '1', B: 'x=y', C: '' })
    expect(textToEnv('  \n')).toBeUndefined()
    expect(envToText({ A: '1' })).toBe('A=1')
  })
  it('flags batch scripts and builds sample contexts that match HOOK_META', () => {
    expect(isBatchScript('C:\\x\\movies.BAT')).toBe(true)
    expect(isBatchScript('movies.exe')).toBe(false)
    for (const name of HOOK_NAMES) expect(Object.keys(sampleContext(name)).length).toBeGreaterThan(0)
    expect(sampleContext('moviesL')).toEqual({ dir: 'C:\\Videos\\L', root: 'C:\\Videos' })
  })
})
