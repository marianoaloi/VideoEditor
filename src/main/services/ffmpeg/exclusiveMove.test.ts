/** Review M6: moves never replace an existing destination. */
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isDerivedOutput, moveAside } from '../jobs/jobFiles'
import { isAlreadyExists, moveExclusive } from './exclusiveMove'
import { makeTempDir } from './testFixtures'

let dir = ''
beforeEach(async () => {
  dir = await makeTempDir('excl')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('moveExclusive', () => {
  it('moves a file and removes the source', async () => {
    await writeFile(path.join(dir, 'a'), 'A')
    await moveExclusive(path.join(dir, 'a'), path.join(dir, 'b'))
    expect(await readdir(dir)).toEqual(['b'])
    expect(await readFile(path.join(dir, 'b'), 'utf8')).toBe('A')
  })

  it('fails with EEXIST and leaves both files untouched when the destination exists', async () => {
    await writeFile(path.join(dir, 'a'), 'A')
    await writeFile(path.join(dir, 'b'), 'B')
    const error = await moveExclusive(path.join(dir, 'a'), path.join(dir, 'b')).catch((e: unknown) => e)
    expect(isAlreadyExists(error)).toBe(true)
    expect(await readFile(path.join(dir, 'b'), 'utf8')).toBe('B')
    expect(await readFile(path.join(dir, 'a'), 'utf8')).toBe('A')
  })
})

describe('moveAside / derived names', () => {
  it('picks a free name and never replaces the file already in the folder', async () => {
    await writeFile(path.join(dir, 'x.json'), 'src')
    await writeFile(path.join(dir, 'ruim'), 'not a dir')
    await rm(path.join(dir, 'ruim'))
    const first = await moveAside(path.join(dir, 'x.json'), dir, 'ruim')
    await writeFile(path.join(dir, 'x.json'), 'second')
    const second = await moveAside(path.join(dir, 'x.json'), dir, 'ruim')
    expect(path.basename(first)).toBe('x.json')
    expect(path.basename(second)).toBe('x (1).json')
    expect(await readFile(first, 'utf8')).toBe('src')
  })

  it('treats *.part.mp4 as a derived output, not a source', () => {
    expect(isDerivedOutput('v.mp4.0.part.mp4', new Set())).toBe(true)
    expect(isDerivedOutput('v.mp4.copy.part.mp4', new Set())).toBe(true)
  })
})
