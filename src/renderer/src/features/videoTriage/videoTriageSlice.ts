/**
 * Video Triage state (F2, F4, F5, F7; video-triage.md). Owner (wave 2): ui-video.
 *
 * Foundation by the architect: session list, cursor and the LIFO decision stack (ADR-006) with the
 * thunks `openFolder / moveItem / skipItem / copyToPersonal / trashItem / undo`. ui-video adds the
 * rest (draft editing, info-bar overrides, prefetch listeners) inside this file.
 */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { ScanProgress, Session } from '@shared/domain/session'
import { createJobDraft, type JobDraftOverrides, type JobDraftState } from '../../app/draft'
import { createTriageCore, type TriageCoreState } from '../../app/triage/triageCore'
import { triageReducers } from '../../app/triage/triageReducers'
import { createTriageThunks } from '../../app/triage/triageThunks'
import type { RootState } from '../../app/store'
import type { SerializedError } from '../../app/api'

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
}

const initialState: VideoTriageState = {
  ...createTriageCore(),
  status: 'idle',
  error: null,
  scan: null,
  flags: { recursive: false, scrubOnHover: false },
  draft: createJobDraft()
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
    },
    draftPatched(state, action: PayloadAction<Partial<Omit<JobDraftState, 'overrides'>>>) {
      Object.assign(state.draft, action.payload)
    },
    overridesPatched(state, action: PayloadAction<Partial<JobDraftOverrides>>) {
      Object.assign(state.draft.overrides, action.payload)
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
  overridesPatched
} = videoTriageSlice.actions

export const selectVideoTriage = (state: RootState): VideoTriageState => state.videoTriage

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
