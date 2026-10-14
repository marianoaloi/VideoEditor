import { ProcessingMode } from '@shared/domain/job'
import { useKeymap } from '../../app/keymap/useKeymap'
import type { KeyBinding } from '../../app/keymap/types'
import { SEEK_KEY_SPECS } from './cutterMath'
import type { CutterActions } from './useCutterActions'

interface CutterKeyHandlers {
  actions: CutterActions
  openCrop: () => void
  requestClose: () => void
  /** The scope is live while this is true (a video is shown and no dialog is open). */
  enabled: boolean
}

function seekBindings(actions: CutterActions): KeyBinding[] {
  return SEEK_KEY_SPECS.map((spec) => ({
    id: `cutter.seek.${spec.chord}`,
    keys: [spec.chord],
    description: spec.description,
    allowRepeat: true,
    run: () => actions.seekBy(spec.deltaMs)
  }))
}

/** The `cutter` keymap scope (MyVideos shortcuts; plain letters never fire inside text fields). */
export function useCutterKeys({ actions, openCrop, requestClose, enabled }: CutterKeyHandlers): void {
  const bindings: KeyBinding[] = [
    ...seekBindings(actions),
    { id: 'cutter.play', keys: ['S'], description: 'Play / pause', run: actions.togglePlay },
    { id: 'cutter.mark', keys: ['X'], description: 'Mark range start / end', run: actions.mark },
    {
      id: 'cutter.volumeDown',
      keys: ['ArrowLeft'],
      description: 'Volume down',
      allowRepeat: true,
      run: () => actions.volumeBy(-1)
    },
    {
      id: 'cutter.volumeUp',
      keys: ['ArrowRight'],
      description: 'Volume up',
      allowRepeat: true,
      run: () => actions.volumeBy(1)
    },
    { id: 'cutter.volumeTen', keys: ['End'], description: 'Volume 10%', run: actions.volumeEndKey },
    {
      id: 'cutter.cut',
      keys: ['C'],
      description: 'Save the job and process as cut',
      run: () => void actions.present(ProcessingMode.cut, false)
    },
    {
      id: 'cutter.concat',
      keys: ['V'],
      description: 'Save the job and process as concat',
      run: () => void actions.present(ProcessingMode.concat, false)
    },
    {
      id: 'cutter.cutToEnd',
      keys: ['Ctrl+Shift+C'],
      description: 'Range to the end of the video, then process as cut',
      run: () => void actions.present(ProcessingMode.cut, true)
    },
    {
      id: 'cutter.concatToEnd',
      keys: ['Ctrl+Shift+V'],
      description: 'Range to the end of the video, then process as concat',
      run: () => void actions.present(ProcessingMode.concat, true)
    },
    { id: 'cutter.crop', keys: ['Ctrl+Shift+S'], description: 'Crop and adjust', run: openCrop },
    { id: 'cutter.externalPlayer', keys: ['F8'], description: 'Open in the external player', run: () => void actions.externalPlayer() },
    { id: 'cutter.open', keys: ['Ctrl+O'], description: 'Open a video', run: () => void actions.openDialog() },
    { id: 'cutter.save', keys: ['Ctrl+S'], description: 'Save the job (times)', run: () => void actions.save() },
    { id: 'cutter.loadTimes', keys: ['Ctrl+Shift+O'], description: 'Load the saved times', run: () => void actions.loadTimes() },
    { id: 'cutter.close', keys: ['Escape'], description: 'Close the Cutter', run: requestClose }
  ]
  useKeymap('cutter', bindings, { enabled })
}
