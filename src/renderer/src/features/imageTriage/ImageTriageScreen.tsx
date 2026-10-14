/** Image Triage workspace (image-triage.md): strips, status line, keys, timer, crop and zoom. */
import { useEffect, useMemo, useState, type DragEvent } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { toMediaUrl } from '@shared/ipc/mediaUrl'
import { basename, dirname } from '@shared/core/paths'
import { mediaKindOf } from '@shared/core/mediaKind'
import { call, pathForFile } from '../../app/api'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import type { KeyBinding } from '../../app/keymap/types'
import { useKeymap } from '../../app/keymap/useKeymap'
import { useNotify } from '../../app/notifications/notify'
import { currentItem } from '../../app/triage/triageCore'
import CropDialog from '../../components/CropDialog/CropDialog'
import ConfirmDialog from '../settings/ConfirmDialog'
import ZoomViewer from '../../components/ZoomViewer/ZoomViewer'
import ControlsBar from './ControlsBar'
import ImageTile from './ImageTile'
import { measureImage } from './imageSize'
import {
  applyCropResult,
  cropNext,
  moveOrAdvance,
  openFolderReplacing,
  rotateCurrent,
  sendImages,
  timerTick,
  uncropCurrent
} from './imageTriageThunks'
import { imageTriageThunks, selectImageTriage, settingsSeeded, timerChanged } from './imageTriageSlice'
import {
  ANIMATED_STATUS_COLOR,
  historyItems,
  isAnimatedFormat,
  mainStripItems,
  sendConfirmMessage,
  statusParts
} from './logic'

interface Overlay {
  kind: 'crop' | 'zoom'
  url: string
  width: number
  height: number
  title: string
}

function useSeedFromSettings(): void {
  const dispatch = useAppDispatch()
  const cfg = useAppSelector((s) => s.settings.value?.imageTriage)
  useEffect(() => {
    if (cfg === undefined) return
    dispatch(settingsSeeded({ left: cfg.leftDir, right: cfg.rightDir, intervalMs: cfg.autoAdvanceMs }))
  }, [cfg, dispatch])
}

function useTimer(): void {
  const dispatch = useAppDispatch()
  const { running, intervalMs } = useAppSelector((s) => selectImageTriage(s).timer)
  useEffect(() => {
    if (!running) return undefined
    const id = window.setInterval(() => void dispatch(timerTick()), intervalMs)
    return () => window.clearInterval(id)
  }, [running, intervalMs, dispatch])
}

function History({ title, items }: { title: string; items: ReturnType<typeof historyItems> }) {
  return (
    <Box sx={{ flex: 1, minWidth: 0 }} aria-label={`${title} history`}>
      <Typography variant="caption">{title}</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5, height: 180 }}>
        {items.map((item) => (
          <ImageTile key={item.id} item={item} minHeight={60} />
        ))}
      </Box>
    </Box>
  )
}

export default function ImageTriageScreen() {
  const dispatch = useAppDispatch()
  const toast = useNotify()
  const s = useAppSelector(selectImageTriage)
  const visible = useAppSelector((st) => st.settings.value?.imageTriage.visibleCount ?? 5)
  const personal = useAppSelector((st) => st.settings.value?.folders.personal ?? null)
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [confirmSend, setConfirmSend] = useState(false)
  useSeedFromSettings()
  useTimer()

  const current = currentItem(s)
  const strip = useMemo(() => mainStripItems(s.items, s.cursor, visible), [s.items, s.cursor, visible])
  const left = useMemo(() => historyItems(s.items, s.cursor, visible, 'left'), [s.items, s.cursor, visible])
  const right = useMemo(() => historyItems(s.items, s.cursor, visible, 'right'), [s.items, s.cursor, visible])
  const status = statusParts(s.items, s.cursor, s.root)

  const openOverlay = (kind: Overlay['kind']): void => {
    if (current === null) return
    const url = toMediaUrl(current.path, { version: current.version })
    measureImage(url).then(
      (size) => setOverlay({ kind, url, title: current.name, ...size }),
      (error: unknown) => toast.apiError(error, current.name)
    )
  }
  const copyPersonal = (): void => {
    if (personal === null) toast.info('Set the personal folder in Settings to use P')
    else void dispatch(imageTriageThunks.copyToPersonal())
  }
  const openCurrentFolder = (): void => {
    if (current !== null) void dispatch(openFolderReplacing({ dir: dirname(current.path), recursive: false }))
  }

  const bindings: KeyBinding[] = [
    { id: 'imageTriage.moveLeft', keys: ['A', 'ArrowLeft'], description: 'Move to the left folder', allowRepeat: true, run: () => void dispatch(moveOrAdvance({ side: 'left' })) },
    { id: 'imageTriage.moveRight', keys: ['F', 'ArrowRight'], description: 'Move to the right folder', allowRepeat: true, run: () => void dispatch(moveOrAdvance({ side: 'right' })) },
    { id: 'imageTriage.skip', keys: ['D'], description: 'Skip (no file operation)', allowRepeat: true, run: () => void dispatch(imageTriageThunks.skipItem()) },
    { id: 'imageTriage.undo', keys: ['ArrowUp', 'B', 'W'], description: 'Undo the latest decision', allowRepeat: true, run: () => void dispatch(imageTriageThunks.undo()) },
    { id: 'imageTriage.rotate', keys: ['End'], description: 'Rotate 90 degrees counter-clockwise (backup first)', run: () => void dispatch(rotateCurrent()) },
    { id: 'imageTriage.crop', keys: ['Ctrl+Shift+S'], description: 'Crop the current image', run: () => openOverlay('crop') },
    { id: 'imageTriage.cropNext', keys: ['Ctrl+Shift+F'], description: 'Move left, then crop the next image with the last crop', run: () => void dispatch(cropNext()) },
    { id: 'imageTriage.uncrop', keys: ['Ctrl+F'], description: 'Restore the original from bkp/', run: () => void dispatch(uncropCurrent()) },
    { id: 'imageTriage.openFolder', keys: ['F6'], description: 'Open the folder of this image', run: openCurrentFolder },
    { id: 'imageTriage.copyPersonal', keys: ['P'], description: 'Copy to the personal folder', run: copyPersonal },
    { id: 'imageTriage.send', keys: ['L'], description: 'Send: clean L, trash R, upload L', enabled: s.sessionId !== null && !confirmSend, run: () => setConfirmSend(true) },
    { id: 'imageTriage.toggleTimer', keys: ['S'], description: 'Start or stop the auto-advance timer', run: () => dispatch(timerChanged({ running: !s.timer.running })) },
    { id: 'imageTriage.zoom', keys: ['Z'], description: 'Zoom the current image', run: () => openOverlay('zoom') }
  ]
  useKeymap('imageTriage', bindings)

  const onDrop = (event: DragEvent): void => {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (file === undefined) return
    const path = pathForFile(file)
    if (path === '') return
    const kind = mediaKindOf(basename(path))
    const dir = kind === 'image' || kind === 'gif' ? dirname(path) : path
    void dispatch(openFolderReplacing({ dir, recursive: false }))
  }

  const empty = s.sessionId !== null && s.items.length === 0
  const done = s.sessionId !== null && s.items.length > 0 && current === null

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <ControlsBar />
      <Box data-testid="status-line" sx={{ px: 1, py: 0.5, whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis', ...(current !== null && isAnimatedFormat(current.name) ? { bgcolor: ANIMATED_STATUS_COLOR, color: '#000' } : {}) }}>
        {s.sessionId === null ? 'Open a folder (or drop one here) to start' : `${status.size}${status.size ? '   ' : ''}${status.path}  ${status.counter}`}
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', gap: 0.5, p: 0.5 }} aria-label="Main strip">
        {strip.map((item, index) => (
          <ImageTile
            key={item.id}
            item={item}
            onLeftClick={s.noMove && index > 0 ? undefined : () => void dispatch(moveOrAdvance({ side: 'left', itemId: item.id }))}
            onRightClick={s.noMove && index > 0 ? undefined : () => void dispatch(moveOrAdvance({ side: 'right', itemId: item.id }))}
            minHeight={200}
          />
        ))}
        {s.status === 'opening' && <Typography>Scanning... {s.scan?.matched ?? 0} images</Typography>}
        {empty && <Typography>No images in this folder.</Typography>}
        {done && <Typography>All {s.items.length} images are decided. B steps back.</Typography>}
      </Box>
      <Box sx={{ display: 'flex', gap: 1, p: 0.5 }}>
        <History title={s.leftName} items={left} />
        <History title={s.rightName} items={right} />
      </Box>
      <ConfirmDialog
        open={confirmSend}
        title="Send"
        message={sendConfirmMessage(s.items.filter((i) => i.status === 'right').length, s.root, s.rightName, s.leftName)}
        confirmLabel="Send"
        onConfirm={() => {
          setConfirmSend(false)
          void dispatch(sendImages())
        }}
        onCancel={() => setConfirmSend(false)}
      />
      {overlay?.kind === 'crop' && (
        <CropDialog
          open
          mode="image"
          title={overlay.title}
          image={{ url: overlay.url, width: overlay.width, height: overlay.height }}
          detectBars={current === null ? undefined : () => call('media:detectBlackBars', { path: current.path })}
          onAccept={(result) => {
            setOverlay(null)
            void dispatch(applyCropResult({ result }))
          }}
          onCancel={() => setOverlay(null)}
        />
      )}
      {overlay?.kind === 'zoom' && (
        <ZoomViewer open imageUrl={overlay.url} width={overlay.width} height={overlay.height} title={overlay.title} onClose={() => setOverlay(null)} />
      )}
    </Box>
  )
}
