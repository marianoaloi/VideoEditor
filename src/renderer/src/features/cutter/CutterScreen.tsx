import { useCallback, useEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { fromMsToEnd, pendingLengthMs, totalSelectedMs } from '@shared/core/rangeEditor'
import { basename } from '@shared/core/paths'
import { ProcessingMode, type Range } from '@shared/domain/job'
import { pathForFile } from '../../app/api'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { fetchMediaInfo } from '../../app/mediaInfo/mediaInfoSlice'
import { notify } from '../../app/notifications/notify'
import {
  durationChanged,
  fileOpened,
  playingChanged,
  positionChanged
} from '../../app/player/playerSlice'
import { usePlayerZoom } from '../../app/player/usePlayerZoom'
import CropDialog from '../../components/CropDialog/CropDialog'
import InfoBar from '../../components/InfoBar/InfoBar'
import MediaPlayer from '../../components/MediaPlayer/MediaPlayer'
import type { MediaPlayerHandle } from '../../components/MediaPlayer/types'
import { RangeSlider } from '../../components/RangeSlider/RangeSlider'
import { TimeRanges } from '../../components/TimeRanges/TimeRanges'
import { planDrop, scrubMs, wheelSteps } from './cutterMath'
import {
  editorApplied,
  handlesSet,
  modeSet,
  openOptionsConsumed,
  overridesPatched,
  selectedSet,
  cutterClosed
} from './cutterSlice'
import { CutterToolbar } from './CutterToolbar'
import { ProcessDialog } from './ProcessDialog'
import { RangeFields } from './RangeFields'
import { SaveDiscardDialog } from './SaveDiscardDialog'
import { useCropFlow } from './useCropFlow'
import { useCutterActions } from './useCutterActions'
import { useCutterKeys } from './useCutterKeys'

const WHEEL_SEEK_MS = 5000

/** Cutter workspace (MyVideos): player, range editor, info bar, crop and "process now". */
export default function CutterScreen() {
  const dispatch = useAppDispatch()
  const playerRef = useRef<MediaPlayerHandle | null>(null)
  const videoBoxRef = useRef<HTMLDivElement>(null)
  const wheelRemainder = useRef(0)
  const scrubbing = useRef(false)
  const [confirmClose, setConfirmClose] = useState(false)

  const cutter = useAppSelector((s) => s.cutter)
  const player = useAppSelector((s) => s.player)
  const zoom = usePlayerZoom()
  const settings = useAppSelector((s) => s.settings.value)
  const info = useAppSelector((s) =>
    s.cutter.videoPath === null ? undefined : s.mediaInfo.byPath[s.cutter.videoPath]
  )
  const { videoPath, draft } = cutter
  const probed = info?.status === 'ready' ? info.info : null
  const duration = player.durationMs
  const actions = useCutterActions(playerRef)
  const crop = useCropFlow(playerRef)

  const requestClose = useCallback(() => {
    if (videoPath === null) return
    if (cutter.dirty && draft.ranges.length > 0) setConfirmClose(true)
    else actions.close()
  }, [videoPath, cutter.dirty, draft.ranges.length, actions])

  const keysEnabled = videoPath !== null && !cutter.process.open && crop.dialogProps === null && !confirmClose
  useCutterKeys({ actions, zoom, openCrop: () => void crop.start(), requestClose, enabled: keysEnabled })

  // A new video (opened here, by a drop on the Jobs screen or by Video Triage): reset the player.
  useEffect(() => {
    if (videoPath === null) return
    dispatch(fileOpened({ path: videoPath }))
    void dispatch(fetchMediaInfo(videoPath))
  }, [videoPath, dispatch])

  // The probe knows the duration before the player does: slider span and the open options.
  const probedDuration = probed?.durationMs ?? 0
  useEffect(() => {
    if (probedDuration <= 0) return
    dispatch(durationChanged(probedDuration))
    dispatch(handlesSet({ low: 0, high: probedDuration }))
  }, [probedDuration, dispatch])

  const pendingOpen = cutter.pendingOpen
  useEffect(() => {
    if (pendingOpen === null || probedDuration <= 0) return
    if (pendingOpen.fromMsToEnd !== null) {
      dispatch(editorApplied(fromMsToEnd(pendingOpen.fromMsToEnd, probedDuration)))
      dispatch(modeSet(ProcessingMode.concat))
    }
    const seekMs = pendingOpen.seekMs ?? pendingOpen.fromMsToEnd
    if (seekMs !== null) {
      playerRef.current?.seekToMs(seekMs)
      dispatch(positionChanged(seekMs))
    }
    dispatch(openOptionsConsumed())
  }, [pendingOpen, probedDuration, dispatch])

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    const paths = Array.from(event.dataTransfer.files).map((file) => pathForFile(file))
    const plan = planDrop(paths)
    if (plan.open === null) {
      dispatch(notify('warning', 'Drop a video file to open it'))
      return
    }
    actions.open({ path: plan.open })
    if (plan.ignored.length > 0) {
      const names = plan.ignored.map((p) => basename(p)).join(', ')
      dispatch(notify('info', `Opened the first video; ignored ${plan.ignored.length} other(s)`, { detail: names }))
    }
  }

  const scrub = (event: PointerEvent<HTMLDivElement>) => {
    const box = videoBoxRef.current?.getBoundingClientRect()
    if (!scrubbing.current || box === undefined) return
    const target = scrubMs(event.clientX - box.left, box.width, duration)
    if (target !== null) actions.seekTo(target)
  }

  const wheelSeek = (deltaY: number) => {
    const next = wheelSteps(wheelRemainder.current, deltaY)
    wheelRemainder.current = next.remainder
    if (next.steps !== 0) actions.seekBy(next.steps * WHEEL_SEEK_MS)
  }

  const volumePercent = Math.round(player.volume * 100)
  const selectedMs = totalSelectedMs(draft.ranges, duration)
  const editor = { ranges: draft.ranges, pendingStartMs: draft.pendingStartMs }

  return (
    <Box
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, p: 1, gap: 1 }}
    >
      <CutterToolbar actions={actions} openCrop={() => void crop.start()} onClose={requestClose} />
      {videoPath === null ? (
        <Typography color="text.secondary" sx={{ p: 4, textAlign: 'center' }}>
          Open a video (Ctrl+O) or drop one here.
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', gap: 1, flex: 1, minHeight: 0 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, gap: 1 }}>
            <Box
              ref={videoBoxRef}
              onPointerDown={(event) => {
                scrubbing.current = event.button === 0
              }}
              onPointerMove={scrub}
              onPointerUp={() => {
                scrubbing.current = false
              }}
              sx={{ flex: 1, minHeight: 120, bgcolor: 'common.black', position: 'relative' }}
            >
              <MediaPlayer
                ref={playerRef}
                path={videoPath}
                info={probed}
                autoPlay={cutter.origin === 'standalone' && settings?.player.startPaused !== true}
                speed={player.speed}
                volume={player.volume}
                muted={player.muted}
                onPosition={(ms) => dispatch(positionChanged(ms))}
                onDuration={(ms) => dispatch(durationChanged(ms))}
                onPlayingChange={(playing) => dispatch(playingChanged(playing))}
                onWheel={(event) => wheelSeek(event.deltaY)}
                zoom={zoom.zoom}
                pan={zoom.pan}
                onPanChange={zoom.onPanChange}
                onError={(message, log) => dispatch(notify('error', message, log === undefined ? {} : { log }))}
              />
            </Box>
            <Box onWheel={(event) => wheelSeek(event.deltaY)}>
              <RangeSlider
                durationMs={duration}
                lowMs={draft.low}
                highMs={draft.high}
                positionMs={player.positionMs}
                ranges={draft.ranges}
                onChange={({ lowMs, highMs }) => dispatch(handlesSet({ low: lowMs, high: highMs }))}
                onSeek={actions.seekTo}
              />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <RangeFields
                positionMs={player.positionMs}
                pendingStartMs={draft.pendingStartMs}
                pendingLengthMs={pendingLengthMs(editor, player.positionMs)}
                onSeekTyped={actions.seekTyped}
                onPendingStartTyped={actions.setPendingStart}
                onMark={actions.mark}
              />
              <Typography
                variant="body2"
                aria-label="Volume"
                title="Volume (mouse wheel)"
                onWheel={(event) => {
                  event.preventDefault()
                  actions.volumeBy(event.deltaY < 0 ? 1 : -1)
                }}
                sx={{ fontFamily: 'monospace', minWidth: 48, cursor: 'ns-resize' }}
              >
                {volumePercent}%
              </Typography>
            </Box>
          </Box>
          <Box sx={{ width: 380, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <TimeRanges
              ranges={draft.ranges as Range[]}
              durationMs={duration}
              mode={draft.posExecution}
              selectedIndex={cutter.selectedIndex}
              onSelect={(index) => dispatch(selectedSet(index))}
              onSeek={actions.seekTo}
              onRemove={actions.removeAt}
              onChange={actions.editAt}
              onModeChange={(mode) => dispatch(modeSet(mode))}
              onSplit={actions.split}
              thresholds={
                settings?.thresholds.selection ?? { greenBelowMs: 600000, yellowBelowMs: 1680000 }
              }
            />
          </Box>
        </Box>
      )}
      {videoPath !== null && settings !== null && (
        <InfoBar
          info={probed}
          fileSizeBytes={probed?.sizeBytes ?? 0}
          positionMs={player.positionMs}
          selectedMs={draft.ranges.length === 0 ? duration : selectedMs}
          thresholds={settings.thresholds}
          overrides={draft.overrides}
          onOverridesChange={(patch) => dispatch(overridesPatched(patch))}
          error={info?.status === 'error' ? info.error.message : null}
        />
      )}
      <ProcessDialog onFinished={() => dispatch(cutterClosed())} />
      {crop.dialogProps !== null && <CropDialog {...crop.dialogProps} />}
      <SaveDiscardDialog
        open={confirmClose}
        onSave={() => {
          setConfirmClose(false)
          void actions.save().then(actions.close)
        }}
        onDiscard={() => {
          setConfirmClose(false)
          actions.close()
        }}
        onCancel={() => setConfirmClose(false)}
      />
    </Box>
  )
}
