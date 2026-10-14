/**
 * Image Triage state (F3, F16; image-triage.md). Owner (wave 2): ui-image.
 *
 * Same session / cursor / LIFO decision stack as Video Triage (ADR-006: one undo rule), through
 * the shared `triageReducers` and `createTriageThunks`. History strips derive from the item
 * statuses (`left` / `right` / `folder`). ui-image adds the strip, zoom and quick-crop logic here.
 */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { CropResult } from '@shared/domain/geometry'
import type { ScanProgress } from '@shared/domain/session'
import type { SerializedError } from '../../app/api'
import { createTriageCore, type TriageCoreState } from '../../app/triage/triageCore'
import { triageReducers } from '../../app/triage/triageReducers'
import { createTriageThunks } from '../../app/triage/triageThunks'
import type { RootState } from '../../app/store'

export type ImageTriageStatus = 'idle' | 'opening' | 'ready' | 'error'

/** A quick-crop button (LEG §3.2 F16): re-applies a stored crop with one click. */
export interface QuickCrop {
  id: string
  label: string
  crop: CropResult
}

export interface ImageTriageState extends TriageCoreState {
  status: ImageTriageStatus
  error: SerializedError | null
  scan: ScanProgress | null
  /** "No move": browse without file operations; D-like advance only. */
  noMove: boolean
  /** Editable destination names (initialised from `settings.imageTriage.leftDir/rightDir`). */
  leftName: string
  rightName: string
  quickCrops: QuickCrop[]
  /** The last accepted crop, for Ctrl+Shift+F ("apply to the next image"). */
  lastCrop: CropResult | null
  /** Auto-advance timer (key S). */
  timer: { running: boolean; intervalMs: number }
}

const initialState: ImageTriageState = {
  ...createTriageCore(),
  status: 'idle',
  error: null,
  scan: null,
  noMove: false,
  leftName: 'L',
  rightName: 'R',
  quickCrops: [],
  lastCrop: null,
  timer: { running: false, intervalMs: 1000 }
}

const imageTriageSlice = createSlice({
  name: 'imageTriage',
  initialState,
  reducers: {
    ...triageReducers,
    scanProgressed(state, action: PayloadAction<ScanProgress>) {
      state.scan = action.payload
    },
    noMoveSet(state, action: PayloadAction<boolean>) {
      state.noMove = action.payload
    },
    destinationNamesSet(state, action: PayloadAction<{ left?: string; right?: string }>) {
      if (action.payload.left !== undefined) state.leftName = action.payload.left
      if (action.payload.right !== undefined) state.rightName = action.payload.right
    },
    quickCropAdded(state, action: PayloadAction<QuickCrop>) {
      state.quickCrops.push(action.payload)
    },
    quickCropRemoved(state, action: PayloadAction<string>) {
      state.quickCrops = state.quickCrops.filter((q) => q.id !== action.payload)
    },
    lastCropSet(state, action: PayloadAction<CropResult | null>) {
      state.lastCrop = action.payload
    },
    timerChanged(state, action: PayloadAction<Partial<ImageTriageState['timer']>>) {
      Object.assign(state.timer, action.payload)
    }
  },
  extraReducers: (builder) => {
    builder.addMatcher(
      (action) => action.type === 'imageTriage/openFolder/pending',
      (state) => {
        state.status = 'opening'
        state.error = null
        state.scan = null
      }
    )
    builder.addMatcher(
      (action) => action.type === 'imageTriage/openFolder/rejected',
      (state, action: { payload?: SerializedError }) => {
        state.status = 'error'
        state.error = action.payload ?? { code: 'INTERNAL', message: 'Could not open the folder' }
      }
    )
    builder.addMatcher(
      (action) => action.type === 'imageTriage/sessionOpened',
      (state) => {
        state.status = 'ready'
      }
    )
  }
})

export const {
  sessionOpened,
  sessionClosed,
  decisionRecorded,
  trashRecorded,
  undoApplied,
  journalRestored,
  cursorSet,
  itemEdited,
  scanProgressed,
  noMoveSet,
  destinationNamesSet,
  quickCropAdded,
  quickCropRemoved,
  lastCropSet,
  timerChanged
} = imageTriageSlice.actions

export const selectImageTriage = (state: RootState): ImageTriageState => state.imageTriage

export const imageTriageThunks = createTriageThunks({
  name: 'imageTriage',
  select: selectImageTriage,
  actions: {
    sessionOpened,
    sessionClosed,
    decisionRecorded,
    trashRecorded,
    undoApplied,
    journalRestored
  }
})

export default imageTriageSlice.reducer
