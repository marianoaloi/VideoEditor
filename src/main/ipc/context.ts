/**
 * `MainContext`: what every service receives in `register<Service>Ipc(ctx)`.
 *
 * Cross-service calls go through typed service slots (`ctx.services.require('journal')`), never
 * through imports between service folders. The slot owner calls `ctx.services.provide(...)` when
 * it registers; consumers `require` lazily inside handlers, so registration order does not matter.
 */
import type { BrowserWindow } from 'electron'
import type { HookExit, HookRunRequest, HookRunStarted } from '@shared/domain/hooks'
import type { JournalEntry } from '@shared/domain/fileops'
import type { EventChannel, EventPayload } from '@shared/ipc/contract'
import type { Settings } from '@shared/domain/settings'
import type { SessionItem, SessionKindFilter, SessionSort } from '@shared/domain/session'
import { AppError } from './errors'
import { createMediaAllowlist, type MediaAllowlist } from './mediaAllowlist'

// ---- settings -------------------------------------------------------------------------------

/**
 * In-memory view of the validated settings. The settings service (svc-files) loads the file,
 * calls `set` and emits `settings:changed`; every other service only reads (`get`) or subscribes.
 */
export interface SettingsAccess {
  get(): Settings
  set(next: Settings): void
  onChange(listener: (settings: Settings) => void): () => void
}

export function createSettingsAccess(initial: Settings): SettingsAccess {
  let current = initial
  const listeners = new Set<(settings: Settings) => void>()
  return {
    get: () => current,
    set(next) {
      current = next
      for (const listener of [...listeners]) listener(next)
    },
    onChange(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

// ---- service slots (implemented in wave 2) --------------------------------------------------

/** What other services need to know about an open session. `items` stay in the session service. */
export interface SessionRecord {
  readonly id: string
  readonly root: string
  readonly recursive: boolean
  readonly kind: SessionKindFilter
  readonly sort: SessionSort
  readonly openedAt: number
}

/** Provided by svc-files (`services/session`). */
export interface SessionStore {
  get(sessionId: string): SessionRecord | undefined
  /** Throws `SESSION_NOT_FOUND`. */
  require(sessionId: string): SessionRecord
  /** Builds a fresh `SessionItem` for a file under the session root (stat + kind), or null. */
  itemFor(sessionId: string, absPath: string): Promise<SessionItem | null>
}

/** A journal entry before main assigns `id` and `ts`. */
export type NewJournalEntry = Omit<JournalEntry, 'id' | 'ts' | 'sessionId'>

/**
 * Provided by svc-files (`services/fileops/journal`). `record` appends to
 * `<root>/.mediamaloi/journal.jsonl` and emits `fileops:changed`.
 */
export interface JournalService {
  record(root: string, entry: NewJournalEntry, sessionId: string | null): Promise<JournalEntry>
}

/** Provided by svc-files (`services/hooks`). */
export interface HookService {
  run(request: HookRunRequest): Promise<HookRunStarted>
  /** Resolves when `runId` exits (never rejects; failures arrive as `error` in the exit). */
  waitForExit(runId: string): Promise<HookExit>
}

export interface ServiceMap {
  sessions: SessionStore
  journal: JournalService
  hooks: HookService
}

export interface ServiceLocator {
  provide<K extends keyof ServiceMap>(key: K, impl: ServiceMap[K]): void
  /** Throws `INTERNAL` when the slot owner has not provided it. */
  require<K extends keyof ServiceMap>(key: K): ServiceMap[K]
  has(key: keyof ServiceMap): boolean
}

export function createServiceLocator(): ServiceLocator {
  const slots = new Map<keyof ServiceMap, ServiceMap[keyof ServiceMap]>()
  return {
    provide(key, impl) {
      if (slots.has(key)) throw new Error(`Service slot "${key}" is already provided`)
      slots.set(key, impl)
    },
    require<K extends keyof ServiceMap>(key: K): ServiceMap[K] {
      const impl = slots.get(key)
      if (impl === undefined) {
        throw new AppError('INTERNAL', `Service "${key}" is not available`, { slot: key })
      }
      return impl as ServiceMap[K]
    },
    has: (key) => slots.has(key)
  }
}

// ---- the context ----------------------------------------------------------------------------

export interface MainContext {
  /** The app window, or `null` before it exists / after it closed. */
  getWindow(): BrowserWindow | null
  /** Pushes an event to the renderer. A no-op without a live window. */
  sendEvent<C extends EventChannel>(channel: C, payload: EventPayload<C>): void
  settings: SettingsAccess
  allowlist: MediaAllowlist
  /**
   * Roots/files the USER approved natively (dialog result, drop). The only way a renderer-named
   * folder can start a session or be probed/hashed (`pathGuard.resolveGuardedPath`).
   */
  approvals: MediaAllowlist
  services: ServiceLocator
  /** `app.getPath('userData')` and `os.tmpdir()`-style temp dir for this app. */
  paths: { readonly userData: string; readonly temp: string }
  /** `shell.trashItem`. Rejects when the OS cannot trash the file. */
  trashItem(absPath: string): Promise<void>
  /** Opaque unique id (`crypto.randomUUID`). */
  newId(): string
}

export interface MainContextDeps {
  getWindow: () => BrowserWindow | null
  settings: SettingsAccess
  allowlist: MediaAllowlist
  approvals?: MediaAllowlist
  paths: { userData: string; temp: string }
  trashItem: (absPath: string) => Promise<void>
  newId: () => string
}

export function createMainContext(deps: MainContextDeps): MainContext {
  return {
    getWindow: deps.getWindow,
    sendEvent(channel, payload) {
      const win = deps.getWindow()
      if (win === null || win.isDestroyed() || win.webContents.isDestroyed()) return
      win.webContents.send(channel, payload)
    },
    settings: deps.settings,
    allowlist: deps.allowlist,
    approvals: deps.approvals ?? createMediaAllowlist(),
    services: createServiceLocator(),
    paths: deps.paths,
    trashItem: deps.trashItem,
    newId: deps.newId
  }
}
