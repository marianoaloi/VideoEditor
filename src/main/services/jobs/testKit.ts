/** Test helpers for the jobs service. Never import this from production code. */
import { mkdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_SETTINGS, type Settings } from '@shared/domain/settings'
import type { HookExit, HookRunRequest, HookRunStarted } from '@shared/domain/hooks'
import type { JobEvent } from '@shared/domain/job'
import type { JournalEntry } from '@shared/domain/fileops'
import {
  createMainContext,
  createSettingsAccess,
  type HookService,
  type MainContext,
  type NewJournalEntry
} from '../../ipc/context'
import { createMediaAllowlist } from '../../ipc/mediaAllowlist'

export interface Kit {
  readonly ctx: MainContext
  readonly events: JobEvent[]
  readonly trashed: string[]
  readonly journal: { root: string; entry: NewJournalEntry }[]
  readonly hookCalls: HookRunRequest[]
  setHookExit(code: number | null, skipped?: boolean): void
}

/** A context whose trash moves files into `<dir>/.trash` and whose services record calls. */
export function makeKit(dir: string, settings: Settings = DEFAULT_SETTINGS): Kit {
  let counter = 0
  const trashed: string[] = []
  const journal: Kit['journal'] = []
  const hookCalls: HookRunRequest[] = []
  let hookExit: { code: number | null; skipped: boolean } = { code: 0, skipped: false }
  const ctx = createMainContext({
    getWindow: () => null,
    settings: createSettingsAccess(settings),
    allowlist: createMediaAllowlist(),
    paths: { userData: dir, temp: dir },
    trashItem: async (file) => {
      const bin = path.join(dir, '.trash')
      await mkdir(bin, { recursive: true })
      await rename(file, path.join(bin, `${trashed.length}-${path.basename(file)}`))
      trashed.push(file)
    },
    newId: () => `id${++counter}`
  })
  ctx.approvals.addRoot(dir)
  ctx.services.provide('journal', {
    record: (root, entry, sessionId) => {
      journal.push({ root, entry })
      const full: JournalEntry = { ...entry, id: `j${journal.length}`, ts: 0, sessionId }
      return Promise.resolve(full)
    }
  })
  const hooks: HookService = {
    run: (request): Promise<HookRunStarted> => {
      hookCalls.push(request)
      return Promise.resolve({
        runId: `r${hookCalls.length}`,
        name: request.name,
        skipped: hookExit.skipped
      })
    },
    waitForExit: (runId): Promise<HookExit> =>
      Promise.resolve({
        runId,
        name: 'uploadOutputs',
        code: hookExit.code,
        durationMs: 1,
        error: null
      })
  }
  ctx.services.provide('hooks', hooks)
  return {
    ctx,
    events: [],
    trashed,
    journal,
    hookCalls,
    setHookExit(code, skipped = false) {
      hookExit = { code, skipped }
    }
  }
}

export function settingsWith(patch: (s: Settings) => Settings): Settings {
  return patch(structuredClone(DEFAULT_SETTINGS))
}
