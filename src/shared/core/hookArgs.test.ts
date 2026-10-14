import { describe, expect, it } from 'vitest'
import type { CommandTemplate } from '../domain/hooks'
import { HookExpansionError, expandArg, expandTemplate, parseTemplateString } from './hookArgs'

const tpl = (over: Partial<CommandTemplate>): CommandTemplate => ({
  enabled: true,
  command: 'x',
  args: [],
  ...over
})

describe('hookArgs', () => {
  it('substitutes scalars per argv entry without splitting spaces', () => {
    const r = expandTemplate(tpl({ args: ['--in={file}', '{dir}'] }), {
      file: 'C:\\a b\\c d.mp4',
      dir: 'C:\\a b'
    })
    expect(r.args).toEqual(['--in=C:\\a b\\c d.mp4', 'C:\\a b'])
  })

  it('expands a list placeholder to one argv entry per value', () => {
    expect(expandArg('{files}', { files: ['/a', '/b c'] })).toEqual(['/a', '/b c'])
    expect(expandArg('-i={outputs}', { outputs: ['/a', '/b'] })).toEqual(['-i=/a', '-i=/b'])
  })

  it('joins list values with newline in env and cwd', () => {
    const r = expandTemplate(tpl({ env: { PATHS: '{files}' }, cwd: '{dir}' }), {
      files: ['/a', '/b'],
      dir: '/d'
    })
    expect(r.env).toEqual({ PATHS: '/a\n/b' })
    expect(r.cwd).toBe('/d')
  })

  it('treats doubled braces as literals', () => {
    expect(expandArg('{{x}} {file}', { file: '/f' })).toEqual(['{x} /f'])
    expect(parseTemplateString('}}')).toEqual([{ text: '}' }])
  })

  it('rejects unknown, unbalanced and valueless placeholders', () => {
    expect(() => expandArg('{nope}', {})).toThrow(HookExpansionError)
    expect(() => expandArg('{file', { file: '/f' })).toThrow(/Unbalanced/)
    expect(() => expandArg('a}', {})).toThrow(/Unbalanced/)
    expect(() => expandArg('{file}', {})).toThrow(/no value/)
    expect(() => expandArg('{files}', { files: [] })).toThrow(/no value/)
    expect(() => expandArg('{files}{outputs}', { files: ['a'], outputs: ['b'] })).toThrow(/one list/)
  })

  it('does not reinterpret substituted values', () => {
    expect(expandArg('{file}', { file: '/a/{dir}' })).toEqual(['/a/{dir}'])
  })

  it('leaves cwd null when empty or unset', () => {
    expect(expandTemplate(tpl({}), {}).cwd).toBeNull()
    expect(expandTemplate(tpl({ cwd: '' }), {}).cwd).toBeNull()
  })
})
