/**
 * Video Triage state (F2, F4, F5, F7; video-triage.md). Owner: ui-video.
 *
 * Foundation by the architect: session list, cursor and the LIFO decision stack (ADR-006) with the
 * shared thunks `openFolder / moveItem / skipItem / copyToPersonal / trashItem / undo`. On top:
 * the per-item job draft (ranges, range-slider handles R1-R12, info-bar overrides), the
 * forced-transcode toggle and the playhead remembered per decision (PageUp, §10.1).
 *
 * The handle rules live in `@shared/core/jobDraft`; the reducers below only store their results.
 */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { effectiveDuration } from '@shared/core/seekStep'
import {
  initialHandles,
  applyPlayhead,
  type ActiveHandle,
  type Handles
} from '@shared/core/jobDraft'
import type { Range } from '@shared/domain/job'
import type { ScanProgress, Session } from '@shared/domain/session'
import type { SerializedError } from '../../app/api'
import { createJobDraft, type JobDraftOverrides, type JobDraftState } from '../../app/draft'
import type { RootState } from '../../app/store'
import { createTriageCore, type TriageCoreState } from '../../app/triage/triageCore'
import { triageReducers } from '../../app/triage/triageReducers'
import { createTriageThunks } from '../../app/triage/triageThunks'

export type VideoTriageStatus = 'idle' | 'opening' | 'ready' | 'error'

/** Legacy ChoiceVideos menu toggles that are session-local (the persistent ones are in Settings). */
export interface VideoTriageFlags {
  /** Open the next folder recursively (checkbox before "Open"). */
  recursive: boolean
  /** "Scrub on hover": mouse position over the player seeks. */
  scrubOnHover: boolean
}

export interface VideoTriageState extends TriageCoreState {
  status: VideoTriageStatus
  error: SerializedError | null
  scan: ScanProgress | null
  flags: VideoTriageFlags
  /** Ranges and overrides of the CURRENT item; reset when the cursor moves to another item. */
  draft: JobDraftState
  /** Which handle the playhead drives (R1). `draft.low/high` are the handle values. */
  activeHandle: ActiveHandle
  /** False until the first duration of the current item arrived (handles are then initialised). */
  handlesReady: boolean
  selectedRange: number | null
  /** `6`: play the current item through the transcode stream (ADR-004). */
  forceTranscode: boolean
  /** Bumped by "Restart actual video" to remount the player; handles and ranges are kept. */
  restartNonce: number
  /** Playhead (original timeline) when each item was decided, for PageUp -> Cutter. */
  positions: Record<string, number>
}

const initialState: VideoTriageState = {
  ...createTriageCore(),
  status: 'idle',
  error: null,
  scan: null,
  flags: { recursive: false, scrubOnHover: false },
  draft: createJobDraft(),
  activeHandle: 0,
  handlesReady: false,
  selectedRange: null,
  forceTranscode: false,
  restartNonce: 0,
  positions: {}
}

/** A fresh draft for the next item; the Convert checkbox is sticky across items (§7). */
function freshDraft(previous: JobDraftState): JobDraftState {
  return { ...createJobDraft(), convert: previous.convert }
}

const videoTriageSlice = createSlice({
  name: 'videoTriage',
  initialState,
  reducers: {
    ...triageReducers,
    scanProgressed(state, action: PayloadAction<ScanProgress>) {
      state.scan = action.payload
    },
    flagsChanged(state, action: PayloadAction<Partial<VideoTriageFlags>>) {
      Object.assign(state.flags, action.payload)
    },
    draftReset(state) {
      state.draft = createJobDraft()
      state.activeHandle = 0
      state.handlesReady = false
    },
    draftPatched(state, action: PayloadAction<Partial<Omit<JobDraftState, 'overrides'>>>) {
      Object.assign(state.draft, action.payload)
    },
    overridesPatched(state, action: PayloadAction<Partial<JobDraftOverrides>>) {
      Object.assign(state.draft.overrides, action.payload)
    },
    /** The current item changed (cursor moved, undo, Go to file): everything per-item restarts. */
    itemActivated(state) {
      state.draft = freshDraft(state.draft)
      state.activeHandle = 0
      state.handlesReady = false
      state.selectedRange = null
      state.forceTranscode = false
    },
    /** First duration of the item: handles become `[0, duration - 100]`, low active. */
    durationLoaded(state, action: PayloadAction<{ durationMs: number }>) {
      if (state.handlesReady) return
      const handles = initialHandles(effectiveDuration(action.payload.durationMs))
      state.draft.low = handles.low
      state.draft.high = handles.high
      state.activeHandle = handles.active
      state.handlesReady = true
    },
    /** R1/R2: every playhead tick drives the active handle. */
    playheadTicked(state, action: PayloadAction<number>) {
      const next = applyPlayhead(
        { low: state.draft.low, high: state.draft.high, active: state.activeHandle },
        action.payload
      )
      state.draft.low = next.low
      state.draft.high = next.high
    },
    handlesSet(state, action: PayloadAction<Handles>) {
      state.draft.low = action.payload.low
      state.draft.high = action.payload.high
      state.activeHandle = action.payload.active
    },
    rangeAdded(state, action: PayloadAction<Range>) {
      state.draft.ranges.push(action.payload)
    },
    rangeRemoved(state, action: PayloadAction<number>) {
      state.draft.ranges.splice(action.payload, 1)
      state.selectedRange = null
    },
    rangeEdited(state, action: PayloadAction<{ index: number; range: Range }>) {
      if (state.draft.ranges[action.payload.index] !== undefined) {
        state.draft.ranges[action.payload.index] = action.payload.range
      }
    },
    rangesReplaced(state, action: PayloadAction<Range[]>) {
      state.draft.ranges = action.payload
      state.selectedRange = null
    },
    rangeSelected(state, action: PayloadAction<number | null>) {
      state.selectedRange = action.payload
    },
    convertToggled(state, action: PayloadAction<boolean | undefined>) {
      state.draft.convert = action.payload ?? !state.draft.convert
    },
    /** `6` / `Ctrl+Shift+F`. */
    forceTranscodeToggled(state) {
      state.forceTranscode = !state.forceTranscode
    },
    /** Ctrl+Shift+G: remount the player; low, high, active and ranges stay. */
    restartRequested(state) {
      state.restartNonce += 1
      state.handlesReady = true
    },
    positionRemembered(state, action: PayloadAction<{ itemId: string; positionMs: number }>) {
      state.positions[action.payload.itemId] = Math.max(0, Math.round(action.payload.positionMs))
    },
    /** The sidecar `<video>.json` of the current item: ranges and overrides come back (K2). */
    sidecarLoaded(
      state,
      action: PayloadAction<{ ranges: Range[]; overrides: Partial<JobDraftOverrides> }>
    ) {
      state.draft.ranges = action.payload.ranges
      Object.assign(state.draft.overrides, action.payload.overrides)
    }
  },
  extraReducers: (builder) => {
    builder.addMatcher(
      (action) => action.type === 'videoTriage/openFolder/pending',
      (state) => {
        state.status = 'opening'
        state.error = null
        state.scan = null
      }
    )
    builder.addMatcher(
      (action) => action.type === 'videoTriage/openFolder/rejected',
      (state, action: { payload?: SerializedError }) => {
        state.status = 'error'
        state.error = action.payload ?? { code: 'INTERNAL', message: 'Could not open the folder' }
      }
    )
    builder.addMatcher(
      (action) => action.type === 'videoTriage/sessionOpened',
      (state, action: PayloadAction<Session>) => {
        state.status = 'ready'
        state.draft = createJobDraft()
        state.activeHandle = 0
        state.handlesReady = false
        state.selectedRange = null
        state.forceTranscode = false
        state.positions = {}
        state.flags.recursive = action.payload.recursive
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
  flagsChanged,
  draftReset,
  draftPatched,
  overridesPatched,
  itemActivated,
  durationLoaded,
  playheadTicked,
  handlesSet,
  rangeAdded,
  rangeRemoved,
  rangeEdited,
  rangesReplaced,
  rangeSelected,
  convertToggled,
  forceTranscodeToggled,
  restartRequested,
  positionRemembered,
  sidecarLoaded
} = videoTriageSlice.actions

export const selectVideoTriage = (state: RootState): VideoTriageState => state.videoTriage

export const selectHandles = (state: RootState): Handles => ({
  low: state.videoTriage.draft.low,
  high: state.videoTriage.draft.high,
  active: state.videoTriage.activeHandle
})

export const videoTriageThunks = createTriageThunks({
  name: 'videoTriage',
  select: selectVideoTriage,
  actions: {
    sessionOpened,
    sessionClosed,
    decisionRecorded,
    trashRecorded,
    undoApplied,
    journalRestored
  }
})

export default videoTriageSlice.reducer
