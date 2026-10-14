/**
 * The Video Triage key table (video-triage.md §5.1) registered through the central keymap
 * (`useKeymap`, never a raw `keydown`). The screen supplies the actions; this file only maps keys.
 * F1 (help) and the workspace switch belong to the `global` scope (ui-shell).
 */
import { SEEK_KEYS, type SeekKey } from '@shared/core/seekStep'
import { useKeymap } from '../../app/keymap/useKeymap'
import type { KeyBinding } from '../../app/keymap/types'
import { CTRL_SPEEDS, SPEEDS } from '../../app/player/playerSlice'

export interface TriageKeyActions {
  /** `PageDown`: move this video to the custom folder and open it in the Cutter. */
  sendToCutter(): void
  moveLeft(): void
  moveRight(): void
  skip(): void
  undo(): void
  trash(): void
  copyPersonal(): void
  /** `P` stays listed but inert until `folders.personal` is set (SPEC §4). */
  personalEnabled: boolean
  addRange(): void
  cut(): void
  concat(): void
  wholeVideo(): void
  convertWholeVideo(): void
  swapHandle(): void
  handlesToStart(): void
  handlesToEnd(): void
  crop(): void
  openInCutter(): void
  toggleForceTranscode(): void
  externalPlayer(): void
  volumeUp(): void
  volumeDown(): void
  volumeMin(): void
  togglePlay(): void
  setSpeed(speed: number): void
  seek(key: SeekKey, event: KeyboardEvent): void
  openFolder(): void
  restart(): void
}

function seekBinding(key: SeekKey, actions: TriageKeyActions): KeyBinding {
  return {
    id: key.id,
    keys: key.keys,
    description: key.description,
    allowRepeat: true,
    run: (event) => actions.seek(key, event)
  }
}

function speedBindings(actions: TriageKeyActions): KeyBinding[] {
  const make = (speeds: readonly number[], prefix: string, name: string): KeyBinding[] =>
    speeds.map((speed, index) => ({
      id: `videoTriage.${name}${index + 1}`,
      keys: [`${prefix}${index + 1}`],
      description: `Speed ${speed}x`,
      run: () => actions.setSpeed(speed)
    }))
  return [...make(SPEEDS, '', 'speed'), ...make(CTRL_SPEEDS, 'Ctrl+', 'speedCtrl')]
}

export function buildTriageBindings(actions: TriageKeyActions): KeyBinding[] {
  const bind = (
    id: string,
    keys: string[],
    description: string,
    run: () => void,
    extra: Partial<KeyBinding> = {}
  ): KeyBinding => ({ id: `videoTriage.${id}`, keys, description, run, ...extra })
  return [
    bind('moveLeft', ['A', 'ArrowLeft'], 'Move to L and go to the next video', actions.moveLeft),
    bind('moveRight', ['F', 'ArrowRight'], 'Move to R and go to the next video', actions.moveRight),
    bind('skip', ['D'], 'Skip: go to the next video without moving', actions.skip),
    bind('undo', ['B'], 'Undo the previous decision', actions.undo),
    bind('trash', ['Shift+Delete'], 'Send to the trash (cannot be undone)', actions.trash),
    bind('personal', ['P'], 'Copy to the personal folder', actions.copyPersonal, {
      enabled: actions.personalEnabled
    }),
    bind('addRange', ['X'], 'Add the handle range to the list', actions.addRange),
    bind('cut', ['C'], 'Cut job: move to CUSTOM with the ranges', actions.cut),
    bind('concat', ['V'], 'Concat job: move to CUSTOM, ranges joined', actions.concat),
    bind('wholeVideo', ['Ctrl+Shift+C'], 'Whole-video job to CUSTOM', actions.wholeVideo),
    bind(
      'convertWhole',
      ['Ctrl+Shift+X'],
      'Convert first, whole video, to CUSTOM',
      actions.convertWholeVideo
    ),
    bind('swapHandle', ['Z'], 'Swap the active handle', actions.swapHandle),
    bind('handlesStart', ['Ctrl+Home'], 'Low handle to the start', actions.handlesToStart),
    bind('handlesEnd', ['Ctrl+End'], 'High handle to the end', actions.handlesToEnd),
    bind('crop', ['Ctrl+Shift+S', 'Ctrl+Alt+X'], 'Crop dialog on the current frame', actions.crop),
    bind('openCutter', ['PageUp'], 'Open the previous video in the Cutter', actions.openInCutter),
    bind(
      'sendToCutter',
      ['PageDown'],
      'Send this video to CUSTOM and open it in the Cutter',
      actions.sendToCutter
    ),
    bind(
      'forceTranscode',
      ['6', 'Ctrl+Shift+F'],
      'Play through the fallback transcoder',
      actions.toggleForceTranscode
    ),
    bind('externalPlayer', ['F8', 'Plus'], 'Open in the external player', actions.externalPlayer),
    bind('volumeDown', ['Minus'], 'Volume down', actions.volumeDown, { allowRepeat: true }),
    bind('volumeUp', ['0'], 'Volume up', actions.volumeUp, { allowRepeat: true }),
    bind('volumeMin', ['Multiply'], 'Volume 1 %', actions.volumeMin),
    bind('playPause', ['S'], 'Play / pause', actions.togglePlay),
    bind('openFolder', ['Ctrl+O'], 'Open a folder', actions.openFolder),
    bind('restart', ['Ctrl+Shift+G'], 'Restart the current video', actions.restart),
    ...speedBindings(actions),
    ...SEEK_KEYS.map((key) => seekBinding(key, actions))
  ]
}

export function useVideoTriageKeys(actions: TriageKeyActions): void {
  useKeymap('videoTriage', buildTriageBindings(actions))
}
