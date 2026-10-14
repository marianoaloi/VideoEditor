/**
 * Image Triage actions that go beyond the shared triage thunks: folder open / reset, crop /
 * rotate / un-crop, apply-last-crop, quick-cut buttons, send (`L`), timer ticks.
 * Moves, skip, undo, copy and trash come from `imageTriageThunks` (ADR-006).
 */
import type { CropResult, Rect } from '@shared/domain/geometry'
import type { HookExit, HookName } from '@shared/domain/hooks'
import { cropLabel, fitRectToImage } from '@shared/core/cropMath'
import { toMediaUrl } from '@shared/ipc/mediaUrl'
import { call, onEvent, toSerializedError } from '../../app/api'
import { notify } from '../../app/notifications/notify'
import { currentItem, type TriageItem } from '../../app/triage/triageCore'
import { createAppAsyncThunk } from '../../app/thunk'
import { measureImage } from './imageSize'
import { planImageEdit } from './logic'
import {
  imageTriageThunks,
  itemEdited,
  lastCropSet,
  quickCropAdded,
  recursiveSet,
  selectImageTriage,
  timerChanged
} from './imageTriageSlice'

const join = (root: string, name: string): string =>
  `${root}${root.includes('\\') ? '\\' : '/'}${name}`

const itemById = (items: readonly TriageItem[], id?: string): TriageItem | null =>
  id === undefined ? null : (items.find((i) => i.id === id) ?? null)

/** Opens `dir` as the session and closes the previous one only after the new one is ready. */
export const openFolderReplacing = createAppAsyncThunk(
  'imageTriage/openFolderReplacing',
  async (arg: { dir: string; recursive?: boolean }, { dispatch, getState }) => {
    const before = selectImageTriage(getState())
    const recursive = arg.recursive ?? before.recursive
    const result = await dispatch(
      imageTriageThunks.openFolder({ dir: arg.dir, recursive, kind: 'image', requestId: 'imageTriage' })
    )
    // A failed open is already reported by the global error listener.
    if (result.meta.requestStatus !== 'fulfilled') return null
    if (before.sessionId !== null) {
      await call('session:close', { sessionId: before.sessionId }).catch((e: unknown) => {
        dispatch(notify('warning', 'The previous session could not be closed', { detail: String(e) }))
      })
    }
    return arg.dir
  }
)

/** File > Open (cancel changes nothing). */
export const chooseFolder = createAppAsyncThunk(
  'imageTriage/chooseFolder',
  async (_arg: void, { dispatch, getState, rejectWithValue }) => {
    try {
      const root = selectImageTriage(getState()).root
      const picked = await call('app:openDirectoryDialog', {
        title: 'Open IMG Folder',
        ...(root === null ? {} : { defaultPath: root })
      })
      if (picked.canceled || picked.path === null) return null
      await dispatch(openFolderReplacing({ dir: picked.path }))
      return picked.path
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

/** Recursive checkbox: rescans from scratch when a folder is open. */
export const setRecursive = createAppAsyncThunk(
  'imageTriage/setRecursive',
  async (value: boolean, { dispatch, getState }) => {
    dispatch(recursiveSet(value))
    const { root } = selectImageTriage(getState())
    if (root !== null) await dispatch(openFolderReplacing({ dir: root, recursive: value }))
  }
)

/** Reset L / Reset R: everything back to the root (collision-safe), then rescan. */
export const resetDestination = createAppAsyncThunk(
  'imageTriage/resetDestination',
  async (side: 'left' | 'right', { dispatch, getState, rejectWithValue }) => {
    const state = selectImageTriage(getState())
    if (state.sessionId === null || state.root === null) return null
    const folder = side === 'left' ? state.leftName : state.rightName
    try {
      const result = await call('fileops:resetFolder', { sessionId: state.sessionId, folder })
      if (result.failed.length > 0) {
        dispatch(notify('warning', `${result.failed.length} file(s) could not be moved back`))
      }
      await dispatch(openFolderReplacing({ dir: state.root }))
      return result.moved.length
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

/** A / F / buttons / clicks / timer: a move, or just an advance while "No move" is on. */
export const moveOrAdvance = createAppAsyncThunk(
  'imageTriage/moveOrAdvance',
  async (arg: { side: 'left' | 'right'; itemId?: string }, { dispatch, getState }) => {
    const state = selectImageTriage(getState())
    const current = currentItem(state)
    if (current === null) return false
    if (state.noMove) {
      if (arg.itemId !== undefined && arg.itemId !== current.id) return false
      await dispatch(imageTriageThunks.skipItem())
      return true
    }
    const folder = arg.side === 'left' ? state.leftName : state.rightName
    await dispatch(
      imageTriageThunks.moveItem({
        kind: arg.side,
        folder,
        ...(arg.itemId === undefined ? {} : { itemId: arg.itemId })
      })
    )
    return true
  }
)

/** Writes `edit` to the item in place (main makes the backup and journals it). */
async function writeEdit(
  itemId: string,
  edit: CropResult,
  ctx: { dispatch: (a: unknown) => unknown; getState: () => unknown }
): Promise<boolean> {
  const state = selectImageTriage(ctx.getState() as Parameters<typeof selectImageTriage>[0])
  const item = itemById(state.items, itemId)
  if (state.sessionId === null || item === null) return false
  const result = await call('media:imageEdit', { sessionId: state.sessionId, path: item.path, edit })
  ctx.dispatch(itemEdited({ itemId, version: result.version }))
  if (edit.crop !== null) {
    const label = cropLabel(edit.crop)
    const cropOnly: CropResult = { crop: edit.crop, bright: null, contrast: null, transpose: null }
    ctx.dispatch(lastCropSet(cropOnly))
    ctx.dispatch(quickCropAdded({ id: label, label, crop: cropOnly }))
  }
  return true
}

/** The CropDialog result for the current (or given) item. */
export const applyCropResult = createAppAsyncThunk(
  'imageTriage/applyCropResult',
  async (arg: { itemId?: string; result: CropResult }, thunk) => {
    const { dispatch, getState, rejectWithValue } = thunk
    const plan = planImageEdit(arg.result)
    for (const warning of plan.warnings) dispatch(notify('warning', warning))
    const id = arg.itemId ?? currentItem(selectImageTriage(getState()))?.id
    if (plan.edit === null || id === undefined) return false
    try {
      return await writeEdit(id, plan.edit, thunk)
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

/** Crops one item with a stored rectangle (quick-cut button, Ctrl+Shift+F). Validated first. */
export const applyCropRect = createAppAsyncThunk(
  'imageTriage/applyCropRect',
  async (arg: { itemId?: string; crop: Rect }, thunk) => {
    const { dispatch, getState, rejectWithValue } = thunk
    const state = selectImageTriage(getState())
    const item = arg.itemId === undefined ? currentItem(state) : itemById(state.items, arg.itemId)
    if (item === null) return false
    try {
      const size = await measureImage(toMediaUrl(item.path, { version: item.version }))
      const fitted = fitRectToImage(arg.crop, size)
      if (fitted === null) {
        dispatch(notify('error', `The crop does not fit ${item.name} (${size.width}x${size.height})`))
        return false
      }
      return await writeEdit(item.id, { crop: fitted, bright: null, contrast: null, transpose: null }, thunk)
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

/** Ctrl+Shift+F: move the current image left, then crop the new current one with `lastCrop`. */
export const cropNext = createAppAsyncThunk(
  'imageTriage/cropNext',
  async (_arg: void, { dispatch, getState }) => {
    const { lastCrop } = selectImageTriage(getState())
    if (lastCrop?.crop == null || currentItem(selectImageTriage(getState())) === null) return false
    await dispatch(moveOrAdvance({ side: 'left' }))
    const next = currentItem(selectImageTriage(getState()))
    if (next === null) return true
    await dispatch(applyCropRect({ itemId: next.id, crop: lastCrop.crop }))
    return true
  }
)

/** End: rotate 90 degrees counter-clockwise (backup + journal in main). */
export const rotateCurrent = createAppAsyncThunk(
  'imageTriage/rotateCurrent',
  async (_arg: void, { dispatch, getState, rejectWithValue }) => {
    const state = selectImageTriage(getState())
    const item = currentItem(state)
    if (state.sessionId === null || item === null) return false
    try {
      const result = await call('media:imageRotate', {
        sessionId: state.sessionId,
        path: item.path,
        rotation: 'ccw90'
      })
      dispatch(itemEdited({ itemId: item.id, version: result.version }))
      return true
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

/** Ctrl+F: restore the original from `bkp/`. */
export const uncropCurrent = createAppAsyncThunk(
  'imageTriage/uncropCurrent',
  async (_arg: void, { dispatch, getState, rejectWithValue }) => {
    const state = selectImageTriage(getState())
    const item = currentItem(state)
    if (state.sessionId === null || item === null) return false
    try {
      const result = await call('media:imageRestoreBackup', {
        sessionId: state.sessionId,
        path: item.path
      })
      if (!result.restored) {
        dispatch(notify('info', `No backup for ${item.name}`))
        return false
      }
      dispatch(itemEdited({ itemId: item.id, version: result.version }))
      return true
    } catch (error: unknown) {
      return rejectWithValue(toSerializedError(error))
    }
  }
)

/** Timer tick: the combo action, or stop at the end of the list. */
export const timerTick = createAppAsyncThunk(
  'imageTriage/timerTick',
  async (_arg: void, { dispatch, getState }) => {
    const state = selectImageTriage(getState())
    if (state.cursor >= state.items.length) {
      dispatch(timerChanged({ running: false }))
      return
    }
    if (state.timer.action === '') return
    await dispatch(moveOrAdvance({ side: state.timer.action === 'L' ? 'left' : 'right' }))
    const after = selectImageTriage(getState())
    if (after.cursor >= after.items.length) dispatch(timerChanged({ running: false }))
  }
)

// ---- send (`L`) ---------------------------------------------------------------------------

async function runHook(name: HookName, dir: string, root: string): Promise<string> {
  const seen: HookExit[] = []
  let wake: (() => void) | null = null
  const off = onEvent('hooks:exit', (event) => {
    seen.push(event)
    wake?.()
  })
  try {
    const started = await call('hooks:run', { name, context: { dir, root } })
    if (started.skipped) return 'disabled'
    for (;;) {
      const exit = seen.find((e) => e.runId === started.runId)
      if (exit !== undefined) return exit.code === 0 ? 'ok' : `exit ${exit.code ?? 'none'}`
      await new Promise<void>((resolve) => {
        wake = resolve
      })
    }
  } finally {
    off()
  }
}

let sending = false

/** One press at a time: pre-clean L, `deleteR` on R, `uploadImagesL`; every step reported. */
export const sendImages = createAppAsyncThunk(
  'imageTriage/sendImages',
  async (_arg: void, { dispatch, getState }) => {
    const state = selectImageTriage(getState())
    if (sending || state.sessionId === null || state.root === null) return null
    sending = true
    const { sessionId, root } = state
    const left = join(root, state.leftName)
    const right = join(root, state.rightName)
    const parts: string[] = []
    const step = async (label: string, work: () => Promise<string>): Promise<void> => {
      try {
        parts.push(`${label}: ${await work()}`)
      } catch (error: unknown) {
        parts.push(`${label}: failed (${toSerializedError(error).message})`)
      }
    }
    try {
      if (getState().settings.value?.imageTriage.sendPreclean ?? true) {
        await step('pre-clean L', async () => {
          const r = await call('fileops:preclean', { sessionId, folder: state.leftName })
          return `${r.trashed.length} trashed`
        })
      }
      await step('delete R', () => runHook('deleteR', right, root))
      await step('upload L', () => runHook('uploadImagesL', left, root))
      dispatch(notify('info', `Send: ${parts.join('; ')}`))
      return parts
    } finally {
      sending = false
    }
  }
)
