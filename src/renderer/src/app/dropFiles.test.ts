import { afterEach, describe, expect, it } from 'vitest'
import type { Binding } from '@shared/domain/keymap'
import { setBridge } from './api'
import { collectDroppedPaths } from './dropFiles'
import { bindingsFor, relevantConflicts } from './keymap/helpModel'

type Bridge = NonNullable<Parameters<typeof setBridge>[0]>

afterEach(() => setBridge(null))

function fakeDrop(entries: { name: string; dir?: boolean }[]): DataTransfer {
  const items = entries.map(({ name, dir }) => ({
    kind: 'file',
    getAsFile: () => new File(['x'], name),
    webkitGetAsEntry: () => ({ isDirectory: dir === true })
  }))
  return { items, files: [] } as unknown as DataTransfer
}

describe('collectDroppedPaths (ADR-003)', () => {
  it('separates videos, folders and other files and drops duplicates', () => {
    setBridge({
      invoke: () => Promise.resolve({ ok: true, data: null }),
      on: () => () => undefined,
      getPathForFile: (file: File) => `/drop/${file.name}`
    } as unknown as Bridge)
    const result = collectDroppedPaths(
      fakeDrop([
        { name: 'a.MP4' },
        { name: 'a.MP4' },
        { name: 'notes.txt' },
        { name: 'clips', dir: true },
        { name: 'b.mkv' }
      ])
    )
    expect(result).toEqual({
      videos: ['/drop/a.MP4', '/drop/b.mkv'],
      folders: ['/drop/clips'],
      ignored: ['notes.txt']
    })
  })
})

describe('F1 help model', () => {
  const bindings: Record<string, Binding> = {
    'global.help': { id: 'global.help', keys: ['F1'], description: 'Help', scope: 'global' },
    'jobs.a': { id: 'jobs.a', keys: ['F1', 'A'], description: 'Clash', scope: 'jobs' },
    'cutter.a': { id: 'cutter.a', keys: ['A'], description: 'Other', scope: 'cutter' }
  }

  it('lists a scope sorted by id and warns only about the shown scopes', () => {
    expect(bindingsFor(bindings, 'jobs').map((b) => b.id)).toEqual(['jobs.a'])
    expect(relevantConflicts(bindings, ['jobs', 'global'])).toEqual([
      { chord: 'F1', scope: 'jobs', bindingIds: ['jobs.a', 'global.help'] }
    ])
    expect(relevantConflicts(bindings, ['cutter', 'global'])).toEqual([])
  })
})
