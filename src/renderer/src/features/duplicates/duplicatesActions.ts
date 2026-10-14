/**
 * Thunks of the Duplicates workspace: scan, probe, save/concat/clean, Move to R / ruim and the
 * `openList` hook. Everything goes through `call()`; errors reject with a `SerializedError`
 * (`initApp` turns them into toasts).
 */
import type { MoveManyResult } from '@shared/domain/fileops'
import type { HookExit } from '@shared/domain/hooks'
import type { HashKind } from '@shared/domain/hash'
import { call, onEvent, toSerializedError } from '../../app/api'
import { notify } from '../../app/notifications/notify'
import { createAppAsyncThunk } from '../../app/thunk'
import {
  buildHashTable,
  factsReceived,
  loadHashTable,
  probingChanged,
  rowsReplaced,
  selectionChanged
} from './duplicatesSlice'
import {
  applyMoveFileTags,
  firstLinePaths,
  orderRows,
  parseMoveFileOutput,
  pathsOf,
  tableRowsForKey,
  type FileFacts
} from './grouping'

const PROBE_CHUNK = 500

function newTaskId(): string {
  return `dup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Scans (or rebuilds) `dir`, then loads the CSV that was written. */
export const scanFolder = createAppAsyncThunk(
  'duplicates/scan',
  async (arg: { dir: string; kind: HashKind; rebuild: boolean }, { dispatch, rejectWithValue }) => {
    const request = { taskId: newTaskId(), dir: arg.dir, kind: arg.kind, rebuild: arg.rebuild }
    const built = await dispatch(buildHashTable(request))
    if (buildHashTable.rejected.match(built)) return rejectWithValue(built.payload ?? { code: 'INTERNAL', message: 'Hashing failed' })
    if (built.payload.cancelled) return null
    const loaded = await dispatch(loadHashTable({ source: { dir: arg.dir, kind: arg.kind } }))
    if (loadHashTable.rejected.match(loaded)) return rejectWithValue(loaded.payload ?? { code: 'INTERNAL', message: 'Could not load the CSV' })
    return built.payload
  }
)

/** Probes the files of the active key that have no facts yet. */
export const probeActivePaths = createAppAsyncThunk(
  'duplicates/probe',
  async (_arg: void, { dispatch, getState, rejectWithValue }) => {
    const { rows, activeKey, facts } = getState().duplicates
    if (activeKey === null) return 0
    const todo = pathsOf(tableRowsForKey(rows, activeKey)).filter((p) => facts[p] === undefined)
    if (todo.length === 0) return 0
    dispatch(probingChanged(true))
    try {
      for (let i = 0; i < todo.length; i += PROBE_CHUNK) {
        const { results } = await call('media:probeMany', { paths: todo.slice(i, i + PROBE_CHUNK) })
        const batch: Record<string, FileFacts | null> = {}
        for (const item of results) batch[item.path] = item.ok ? toFacts(item.info) : null
        dispatch(factsReceived(batch))
      }
      return todo.length
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    } finally {
      dispatch(probingChanged(false))
    }
  }
)

function toFacts(info: {
  displayWidth: number
  displayHeight: number
  bitrateKbps: number | null
  hasAudio: boolean
  sizeBytes: number
}): FileFacts {
  return {
    width: info.displayWidth,
    height: info.displayHeight,
    bitrateKbps: info.bitrateKbps ?? 0,
    hasAudio: info.hasAudio,
    sizeBytes: info.sizeBytes
  }
}

/** "Clean analyses": drop rows of missing files (main saves the CSV). */
export const cleanTable = createAppAsyncThunk(
  'duplicates/clean',
  async (_arg: void, { dispatch, getState, rejectWithValue }) => {
    const { csvPath } = getState().duplicates
    if (csvPath === null) return 0
    try {
      const result = await call('hashing:clean', { csvPath })
      dispatch(rowsReplaced({ csvPath: result.table.csvPath, rows: result.table.rows }))
      return result.removed
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

/** "Save DataFrame": clean, then write the canonical layout. */
export const saveTable = createAppAsyncThunk(
  'duplicates/save',
  async (_arg: void, { dispatch, getState, rejectWithValue }) => {
    try {
      await dispatch(cleanTable()).unwrap()
      const { csvPath, rows } = getState().duplicates
      if (csvPath === null) return null
      const saved = await call('hashing:save', { csvPath, rows })
      dispatch(notify('success', `Saved ${saved.rowCount} rows`, { detail: saved.csvPath }))
      return saved
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

/** "Concat other data": merge a CSV chosen in the file dialog. */
export const concatOther = createAppAsyncThunk(
  'duplicates/concat',
  async (_arg: void, { dispatch, getState, rejectWithValue }) => {
    const { csvPath } = getState().duplicates
    if (csvPath === null) return null
    try {
      const picked = await call('app:openFilesDialog', {
        title: 'Concat other analysis data',
        filters: [{ name: 'Analysis CSV', extensions: ['txt', 'csv'] }]
      })
      const other = picked.paths[0]
      if (picked.canceled || other === undefined) return null
      const result = await call('hashing:concat', { csvPath, otherCsvPath: other })
      dispatch(
        rowsReplaced({ csvPath: result.table.csvPath, rows: result.table.rows, warning: result.warning })
      )
      dispatch(notify('info', `Added ${result.added} rows`))
      return result.added
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

export interface MovePathsArg {
  paths: string[]
  /** A single folder name under the scan root. */
  folder: string
}

/**
 * Opens a session on the scanned folder, moves the paths with the ADR-006 move, closes the
 * session and re-reads the CSV (clean) so counts and table refresh.
 */
export const movePaths = createAppAsyncThunk(
  'duplicates/move',
  async (arg: MovePathsArg, { dispatch, getState, rejectWithValue }) => {
    const { dir } = getState().duplicates
    if (dir === null || arg.paths.length === 0) return null
    try {
      const session = await call('session:open', {
        dir,
        kind: 'any',
        recursive: true,
        requestId: 'duplicates'
      })
      let result: MoveManyResult
      try {
        result = await call('fileops:moveMany', {
          sessionId: session.id,
          paths: arg.paths,
          destination: { type: 'folder', name: arg.folder }
        })
      } finally {
        await call('session:close', { sessionId: session.id })
      }
      reportMove(dispatch, result.moved.length, result.failed.map((f) => f.path), arg.folder)
      dispatch(selectionChanged([]))
      await dispatch(cleanTable()).unwrap()
      return result
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

function reportMove(
  dispatch: (action: ReturnType<typeof notify>) => unknown,
  moved: number,
  failed: string[],
  folder: string
): void {
  if (moved > 0) dispatch(notify('success', `Moved ${moved} file(s) to ${folder}`))
  if (failed.length > 0) {
    dispatch(notify('warning', `${failed.length} file(s) could not be moved`, { detail: failed.join('\n') }))
  }
}

function waitForHookExit(runId: string, buffered: Map<string, HookExit>): Promise<HookExit> {
  const early = buffered.get(runId)
  if (early !== undefined) return Promise.resolve(early)
  return new Promise((resolve) => {
    const off = onEvent('hooks:exit', (exit) => {
      if (exit.runId !== runId) return
      off()
      resolve(exit)
    })
  })
}

/**
 * "Open first line analyses": one path per row to the `openList` hook; its `##MOVEFILE` output
 * selects (R) or deselects (L) members.
 */
export const openFirstLines = createAppAsyncThunk(
  'duplicates/openList',
  async (_arg: void, { dispatch, getState, rejectWithValue }) => {
    const state = getState().duplicates
    if (state.activeKey === null) return null
    const rows = orderRows(tableRowsForKey(state.rows, state.activeKey), state.kind, state.facts)
    const files = firstLinePaths(rows, state.facts)
    if (files.length === 0) return null
    const output = new Map<string, string[]>()
    const exits = new Map<string, HookExit>()
    const offOut = onEvent('hooks:output', (e) => {
      output.set(e.runId, [...(output.get(e.runId) ?? []), ...e.lines])
    })
    const offExit = onEvent('hooks:exit', (e) => exits.set(e.runId, e))
    try {
      const started = await call('hooks:run', { name: 'openList', context: { files } })
      if (started.skipped) {
        dispatch(notify('info', 'The "openList" hook is not configured (Settings > Hooks)'))
        return null
      }
      const exit = await waitForHookExit(started.runId, exits)
      if (exit.error !== null || (exit.code ?? 0) !== 0) {
        dispatch(notify('error', 'The openList hook failed', { detail: exit.error?.message ?? `exit code ${String(exit.code)}` }))
      }
      const tags = parseMoveFileOutput((output.get(started.runId) ?? []).join('\n'))
      const next = applyMoveFileTags(getState().duplicates.selectedPaths, tags, rows)
      dispatch(selectionChanged(next))
      return next.length
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    } finally {
      offOut()
      offExit()
    }
  }
)
