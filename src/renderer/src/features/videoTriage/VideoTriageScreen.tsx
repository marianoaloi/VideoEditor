/**
 * Video Triage workspace (F2; video-triage.md). Wires the player, range slider, ranges list, info
 * bar and the key table to the slice and thunks. Decisions go through the shared triage thunks.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import LinearProgress from '@mui/material/LinearProgress'
import Typography from '@mui/material/Typography'
import {
  dragHandle, jumpToEnd, jumpToStart, loadRangeIntoHandles, rangeFromHandles, selectionMs, swapActive
} from '@shared/core/jobDraft'
import { collectDroppedPaths } from '../../app/dropFiles'
import {
  clampSeekTarget,
  effectiveDuration,
  scrubTarget,
  seekDeltaMs,
  wheelNotches,
  type ModifierState,
  type SeekKey,
  type WheelAccumulator
} from '@shared/core/seekStep'
import { dirname } from '@shared/core/paths'
import { fromPercent, toPercent, volumeDown, volumeMin, volumeUp } from '@shared/core/volume'
import { ProcessingMode } from '@shared/domain/job'
import { DEFAULT_SETTINGS } from '@shared/domain/settings'
import { call } from '../../app/api'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { workspaceActivated } from '../../app/keymap/keymapSlice'
import { fetchMediaInfo, prefetchMedia } from '../../app/mediaInfo/mediaInfoSlice'
import { notify, notifyApiError } from '../../app/notifications/notify'
import {
  durationChanged, fileOpened, playingChanged, positionChanged, speedSet, volumeSet
} from '../../app/player/playerSlice'
import { usePlayerZoom } from '../../app/player/usePlayerZoom'
import { countByStatus, currentItem, isEnd } from '../../app/triage/triageCore'
import CropDialog from '../../components/CropDialog'
import InfoBar from '../../components/InfoBar/InfoBar'
import MediaPlayer from '../../components/MediaPlayer/MediaPlayer'
import type { MediaPlayerHandle } from '../../components/MediaPlayer/types'
import RangeSlider from '../../components/RangeSlider/RangeSlider'
import TimeRanges from '../../components/TimeRanges/TimeRanges'
import ZoomViewer from '../../components/ZoomViewer'
import { updateSettings } from '../settings/settingsSlice'
import TriageToolbar, { type MenuEntry } from './TriageToolbar'
import { useFrameDialogs } from './useFrameDialogs'
import { useVideoTriageKeys, type TriageKeyActions } from './useVideoTriageKeys'
import {
  activateItem,
  decide,
  executeCustomFolder,
  openExternalPlayer,
  openPreviousInCutter,
  sendToCutter,
  saveTime,
  sendJob
} from './videoTriageThunks'
import { findFirstMatch, itemLabel, upcomingItems } from './videoTriageHelpers'
import {
  convertToggled,
  durationLoaded,
  flagsChanged,
  forceTranscodeToggled,
  handlesSet,
  overridesPatched,
  playheadTicked,
  rangeAdded,
  rangeEdited,
  rangeRemoved,
  rangeSelected,
  rangesReplaced,
  restartRequested,
  selectVideoTriage,
  videoTriageThunks
} from './videoTriageSlice'
import { splitRanges } from '@shared/core/splitRanges'

export default function VideoTriageScreen() {
  const dispatch = useAppDispatch()
  const vt = useAppSelector(selectVideoTriage)
  const settings = useAppSelector((s) => s.settings.value) ?? DEFAULT_SETTINGS
  const player = useAppSelector((s) => s.player)
  const zoom = usePlayerZoom()
  const item = currentItem(vt)
  const entry = useAppSelector((s) => (item === null ? undefined : s.mediaInfo.byPath[item.path]))
  const info = entry?.status === 'ready' ? entry.info : null
  const probeError = entry?.status === 'error' ? entry.error.message : null
  const analyse = settings.videoTriage.analyse
  const playerRef = useRef<MediaPlayerHandle>(null)
  const wheelAcc = useRef<WheelAccumulator>({ remainder: 0 })
  const restoreRef = useRef<{ low: number; high: number; active: 0 | 1 | -1 } | null>(null)
  const unreadable = useRef(0)
  const firstLoad = useRef(true)
  const [findError, setFindError] = useState<string | null>(null)
  const durationMs = info?.durationMs ?? player.durationMs
  const maxMs = effectiveDuration(durationMs)
  const handles = { low: vt.draft.low, high: vt.draft.high, active: vt.activeHandle }

  const seek = useCallback((ms: number) => playerRef.current?.seekToMs(ms), [])
  const pause = useCallback(() => playerRef.current?.pause(), [])
  const frames = useFrameDialogs(pause)

  // ---- per-item lifecycle ---------------------------------------------------------------
  const itemId = item?.id ?? null
  const itemPath = item?.path ?? null
  useEffect(() => {
    if (itemId === null || itemPath === null) {
      dispatch(fileOpened({ path: null }))
      return
    }
    dispatch(fileOpened({ path: itemPath }))
    void dispatch(activateItem(itemId))
  }, [dispatch, itemId, itemPath])

  useEffect(() => {
    if (itemPath !== null && analyse) void dispatch(fetchMediaInfo(itemPath))
  }, [dispatch, itemPath, analyse])

  useEffect(() => {
    if (info !== null) dispatch(durationLoaded({ durationMs: info.durationMs }))
  }, [dispatch, info])

  const prefetchCount = settings.thumbs.prefetch
  useEffect(() => {
    const next = upcomingItems(vt.items, vt.cursor, prefetchCount).map((i) => i.path)
    if (analyse && next.length > 0) void dispatch(prefetchMedia(next))
  }, [dispatch, vt.items, vt.cursor, prefetchCount, analyse])

  // "Error move R": unreadable files go straight to R, one summary toast (§2).
  useEffect(() => {
    if (itemPath !== null && probeError !== null && settings.videoTriage.errorMoveR) {
      unreadable.current += 1
      void dispatch(videoTriageThunks.moveItem({ kind: 'right' }))
    } else if (unreadable.current > 0 && (info !== null || isEnd(vt))) {
      dispatch(notify('info', `${unreadable.current} unreadable files moved to R`))
      unreadable.current = 0
    }
  }, [dispatch, itemPath, probeError, info, vt, settings.videoTriage.errorMoveR])

  // ---- actions --------------------------------------------------------------------------
  const setHandles = (move: { handles: typeof handles; seekMs: number | null }): void => {
    dispatch(handlesSet(move.handles))
    if (move.seekMs !== null) seek(move.seekMs)
  }
  const send = (arg: Parameters<typeof sendJob>[0]): void => {
    pause()
    void dispatch(sendJob(arg))
  }
  const openFolder = async (): Promise<void> => {
    try {
      const picked = await call('app:openDirectoryDialog', { title: 'Open a folder of videos' })
      if (picked.canceled || picked.path === null) return
      await openDir(picked.path)
    } catch (error: unknown) {
      dispatch(notifyApiError(error, 'Opening the folder'))
    }
  }
  const openDir = async (dir: string): Promise<void> => {
    zoom.zoomReset()
    if (vt.sessionId !== null) await dispatch(videoTriageThunks.closeFolder())
    await dispatch(
      videoTriageThunks.openFolder({
        dir,
        recursive: vt.flags.recursive,
        kind: 'video',
        requestId: 'videoTriage'
      })
    )
  }
  const setVolume = (percent: number): void => {
    dispatch(volumeSet(fromPercent(percent)))
  }
  const seekBy = (key: Pick<SeekKey, 'nominalSec'>, mods: ModifierState, dir: 1 | -1): void => {
    const delta = seekDeltaMs(key.nominalSec, mods, dir)
    const target = clampSeekTarget(
      playerRef.current?.getPositionMs() ?? player.positionMs,
      delta,
      maxMs
    )
    if (target !== null) seek(target)
  }

  const actions: TriageKeyActions = {
    moveLeft: () => void dispatch(decide({ kind: 'left' })),
    moveRight: () => void dispatch(decide({ kind: 'right' })),
    skip: () => void dispatch(decide({ kind: 'skip' })),
    undo: () => void dispatch(videoTriageThunks.undo()),
    trash: () => void dispatch(videoTriageThunks.trashItem(undefined)),
    copyPersonal: () => void dispatch(videoTriageThunks.copyToPersonal(undefined)),
    personalEnabled: settings.folders.personal !== null,
    addRange: () => {
      const range = rangeFromHandles(handles)
      if (range === null) dispatch(notify('warning', 'The handles are at the same position'))
      else dispatch(rangeAdded(range))
    },
    cut: () => send({ mode: ProcessingMode.cut }),
    concat: () => send({ mode: ProcessingMode.concat }),
    wholeVideo: () => send({ mode: ProcessingMode.cut, whole: true }),
    convertWholeVideo: () => send({ mode: ProcessingMode.cut, whole: true, convert: true }),
    swapHandle: () => setHandles(swapActive(handles)),
    handlesToStart: () => setHandles(jumpToStart(handles)),
    handlesToEnd: () => setHandles(jumpToEnd(handles, maxMs)),
    crop: () => void frames.startCrop(),
    openInCutter: () => void dispatch(openPreviousInCutter()),
    sendToCutter: () => {
      pause()
      void dispatch(sendToCutter())
    },
    toggleForceTranscode: () => dispatch(forceTranscodeToggled()),
    externalPlayer: () => {
      pause()
      void dispatch(openExternalPlayer())
    },
    volumeUp: () => setVolume(volumeUp(toPercent(player.volume))),
    volumeDown: () => setVolume(volumeDown(toPercent(player.volume))),
    volumeMin: () => setVolume(volumeMin()),
    togglePlay: () => playerRef.current?.toggle(),
    setSpeed: (speed) => dispatch(speedSet(speed)),
    seek: (key, event) => seekBy(key, event, key.direction),
    openFolder: () => void openFolder(),
    restart: () => {
      restoreRef.current = handles
      dispatch(restartRequested())
    },
    zoomIn: zoom.zoomIn,
    zoomOut: zoom.zoomOut,
    zoomReset: zoom.zoomReset
  }
  useVideoTriageKeys(actions)

  const onWheel = (event: WheelEvent | React.WheelEvent): void => {
    const result = wheelNotches(wheelAcc.current, -event.deltaY)
    wheelAcc.current = result.acc
    if (result.notches === 0) return
    const dir = result.notches > 0 ? 1 : -1
    for (let i = 0; i < Math.abs(result.notches); i += 1) seekBy({ nominalSec: 1 }, event, dir)
  }
  const onScrub = (event: MouseEvent<HTMLElement>): void => {
    if ((event.buttons & 1) === 0 && !vt.flags.scrubOnHover) return
    if (zoom.zoom > 1 && (event.buttons & 1) !== 0) return // a drag pans the zoomed picture
    const box = event.currentTarget.getBoundingClientRect()
    const target = scrubTarget(event.clientX - box.left, box.width, durationMs)
    if (target !== null) seek(target)
  }
  const onPosition = (ms: number): void => {
    dispatch(positionChanged(ms))
    dispatch(playheadTicked(ms))
    if (restoreRef.current !== null) {
      dispatch(handlesSet(restoreRef.current))
      restoreRef.current = null
    }
  }
  const onDrop = (event: DragEvent): void => {
    event.preventDefault()
    const dropped = collectDroppedPaths(event.dataTransfer)
    const dir =
      dropped.folders[0] ?? (dropped.videos[0] === undefined ? null : dirname(dropped.videos[0]))
    if (dir === null) dispatch(notify('warning', 'Drop a folder or a video file'))
    else void openDir(dir)
  }
  const find = (text: string): void => {
    const result = findFirstMatch(vt.items, text, navigator.userAgent.includes('Windows'))
    setFindError(result.ok ? null : result.message)
    if (result.ok) dispatch({ type: 'videoTriage/cursorSet', payload: result.index })
  }
  const patchSettings = (patch: Parameters<typeof updateSettings>[0]): void => {
    void dispatch(updateSettings(patch))
  }

  const entries = useMemo(() => {
    const file: MenuEntry[] = [
      { label: 'Open folder…', onClick: () => void openFolder() },
      { label: 'Save time', onClick: () => void dispatch(saveTime()), disabled: item === null },
      { label: 'Restart video', onClick: actions.restart, disabled: item === null },
      { label: 'Open the Cutter', onClick: () => dispatch(workspaceActivated('cutter')) }
    ]
    const options: MenuEntry[] = [
      {
        label: 'Open recursive',
        checked: vt.flags.recursive,
        onClick: () => dispatch(flagsChanged({ recursive: !vt.flags.recursive }))
      },
      {
        label: 'Analyse video',
        checked: analyse,
        onClick: () => patchSettings({ videoTriage: { analyse: !analyse } })
      },
      {
        label: 'Error move R',
        checked: settings.videoTriage.errorMoveR,
        onClick: () =>
          patchSettings({ videoTriage: { errorMoveR: !settings.videoTriage.errorMoveR } })
      },
      {
        label: 'Stay on top',
        checked: settings.player.stayOnTop,
        onClick: () => {
          const value = !settings.player.stayOnTop
          patchSettings({ player: { stayOnTop: value } })
          void call('app:setAlwaysOnTop', { value })
        }
      },
      {
        label: 'Scrub on hover',
        checked: vt.flags.scrubOnHover,
        onClick: () => dispatch(flagsChanged({ scrubOnHover: !vt.flags.scrubOnHover }))
      },
      { label: 'Zoom', onClick: () => void frames.startZoom(), disabled: item === null }
    ]
    const interfaces: MenuEntry[] = [
      {
        label: 'Enable thumbs',
        checked: settings.thumbs.enabled,
        onClick: () => patchSettings({ thumbs: { enabled: !settings.thumbs.enabled } })
      },
      {
        label: 'Duplicates (MD5 analysis)',
        onClick: () => dispatch(workspaceActivated('duplicates'))
      }
    ]
    return { file, options, interfaces }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vt.flags, analyse, settings, item, vt.sessionId])

  const counts = countByStatus(vt)

  return (
    <Box
      sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1, minHeight: '100%' }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <Typography variant="h6" component="h1">
        Video Triage
      </Typography>
      <TriageToolbar
        {...entries}
        convert={vt.draft.convert}
        onConvert={(value) => dispatch(convertToggled(value))}
        forceTranscode={vt.forceTranscode}
        onForceTranscode={() => dispatch(forceTranscodeToggled())}
        onExecute={() => void dispatch(executeCustomFolder(settings.folders.custom))}
        onFind={find}
        findError={findError}
      />
      {vt.status === 'opening' && <LinearProgress aria-label="Scanning" />}
      {vt.status === 'idle' && (
        <Button variant="contained" onClick={() => void openFolder()}>
          Open a folder
        </Button>
      )}
      {vt.status === 'error' && <Typography color="error">{vt.error?.message}</Typography>}
      {item !== null && (
        <>
          <Typography variant="body2" noWrap title={item.path} data-testid="item-label">
            {itemLabel(item, vt.items.length, vt.cursor)}
          </Typography>
          <Box
            data-testid="player-area"
            onMouseMove={onScrub}
            sx={{ height: '45vh', minHeight: 200, bgcolor: '#000' }}
          >
            {analyse ? (
              <MediaPlayer
                key={`${item.id}-${vt.restartNonce}`}
                ref={playerRef}
                path={item.path}
                info={info}
                autoPlay={!(firstLoad.current && settings.player.startPaused)}
                initialPositionMs={vt.restartNonce > 0 ? vt.draft.low : 0}
                speed={player.speed}
                volume={player.volume}
                muted={player.muted}
                forceTranscode={vt.forceTranscode}
                onPosition={onPosition}
                onDuration={(ms) => {
                  firstLoad.current = false
                  dispatch(durationChanged(ms))
                  dispatch(durationLoaded({ durationMs: ms }))
                }}
                onPlayingChange={(playing) => dispatch(playingChanged(playing))}
                onError={(message) => dispatch(notify('error', message))}
                onWheel={onWheel}
                zoom={zoom.zoom}
                pan={zoom.pan}
                onPanChange={zoom.onPanChange}
              />
            ) : (
              <Typography sx={{ p: 2, color: '#ccc' }}>Video analysis is off</Typography>
            )}
          </Box>
          <Box onWheel={onWheel}>
            <RangeSlider
              durationMs={maxMs}
              lowMs={vt.draft.low}
              highMs={vt.draft.high}
              positionMs={player.positionMs}
              ranges={vt.draft.ranges}
              disabled={!vt.handlesReady}
              onChange={(selection) =>
                setHandles(
                  selection.lowMs !== vt.draft.low
                    ? dragHandle(handles, 0, selection.lowMs, maxMs)
                    : dragHandle(handles, 1, selection.highMs, maxMs)
                )
              }
              onSeek={seek}
            />
          </Box>
          <TimeRanges
            ranges={vt.draft.ranges}
            durationMs={durationMs}
            mode={vt.draft.posExecution}
            selectedIndex={vt.selectedRange}
            onSelect={(index) => dispatch(rangeSelected(index))}
            onSeek={seek}
            onRemove={(index) => {
              const range = vt.draft.ranges[index]
              dispatch(rangeRemoved(index))
              if (range !== undefined) setHandles(loadRangeIntoHandles(range))
            }}
            onChange={(index, range) => dispatch(rangeEdited({ index, range }))}
            onModeChange={(mode) =>
              dispatch({ type: 'videoTriage/draftPatched', payload: { posExecution: mode } })
            }
            onSplit={(parts) => {
              const result = splitRanges(
                Math.min(handles.low, handles.high),
                Math.max(handles.low, handles.high),
                parts
              )
              if (result.ok) dispatch(rangesReplaced(result.ranges))
              else dispatch(notify('warning', result.message))
            }}
            thresholds={settings.thresholds.selection}
          />
          <InfoBar
            key={item.id}
            info={analyse ? info : null}
            fileSizeBytes={item.sizeBytes}
            positionMs={player.positionMs}
            selectedMs={selectionMs(handles)}
            thresholds={settings.thresholds}
            overrides={vt.draft.overrides}
            onOverridesChange={(patch) => dispatch(overridesPatched(patch))}
            error={probeError}
          />
          <Typography
            variant="caption"
            onWheel={(event) =>
              setVolume(
                event.deltaY < 0
                  ? volumeUp(toPercent(player.volume))
                  : volumeDown(toPercent(player.volume))
              )
            }
          >
            Volume {toPercent(player.volume)}% · Speed {player.speed}x
          </Typography>
        </>
      )}
      {vt.status === 'ready' && item === null && (
        <Box role="status" aria-label="End of list" data-testid="end-of-list">
          <Typography variant="subtitle1">End of list</Typography>
          <Typography variant="body2">
            L {counts.left} · R {counts.right} · CUSTOM {counts.custom} · skipped {counts.skipped} ·
            trashed {counts.trashed}
          </Typography>
        </Box>
      )}
      {frames.crop !== null && (
        <CropDialog
          open
          mode="video"
          title={frames.crop.frame.sourcePath}
          image={{
            url: frames.crop.frame.url,
            width: frames.crop.frame.width,
            height: frames.crop.frame.height
          }}
          initial={frames.crop.initial}
          detectBars={frames.detectBars}
          onAccept={frames.acceptCrop}
          onCancel={frames.cancelCrop}
        />
      )}
      {frames.zoom !== null && (
        <ZoomViewer
          open
          imageUrl={frames.zoom.url}
          width={frames.zoom.width}
          height={frames.zoom.height}
          onClose={frames.closeZoom}
        />
      )}
    </Box>
  )
}
