/** Duplicates workspace (F10): build/load the hash CSV, review duplicate groups, Move to R. */
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import LinearProgress from '@mui/material/LinearProgress'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { useEffect, useMemo, useRef, useState } from 'react'
import { HASH_KEYS, type HashKind } from '@shared/domain/hash'
import { call } from '../../app/api'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { useKeymap } from '../../app/keymap/useKeymap'
import { useNotify } from '../../app/notifications/notify'
import {
  cleanTable,
  concatOther,
  movePaths,
  openFirstLines,
  probeActivePaths,
  saveTable,
  scanFolder
} from './duplicatesActions'
import {
  activeKeyChanged,
  cancelHashing,
  feedbackClosed,
  feedbackOpened,
  kindChanged,
  loadHashTable,
  selectionChanged
} from './duplicatesSlice'
import DuplicatesTable from './DuplicatesTable'
import FeedbackDialog from './FeedbackDialog'
import {
  exportScreenData,
  keyCounts,
  orderRows,
  sanitizeFolderName,
  selectAll,
  tableRowsForKey,
  toggleSelected,
  unreadablePaths,
  unselectFirstColumn
} from './grouping'
import { DEFAULT_CELL } from './MemberCells'
import { useAutoScroll } from './useAutoScroll'

const KIND_LABEL: Record<HashKind, string> = { video: 'Video', image: 'Image', gif: 'GIF' }
const KINDS = Object.keys(KIND_LABEL) as HashKind[]

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export default function DuplicatesScreen() {
  const dispatch = useAppDispatch()
  const toast = useNotify()
  const state = useAppSelector((s) => s.duplicates)
  const folders = useAppSelector((s) => s.settings.value?.folders)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const scroll = useAutoScroll(scrollRef)
  const [cellSize, setCellSize] = useState(DEFAULT_CELL)
  const [folderText, setFolderText] = useState('')

  const counts = useMemo(() => keyCounts(state.rows), [state.rows])
  const tableRows = useMemo(
    () =>
      state.activeKey === null
        ? []
        : orderRows(tableRowsForKey(state.rows, state.activeKey), state.kind, state.facts),
    [state.rows, state.activeKey, state.kind, state.facts]
  )
  const unreadable = useMemo(() => unreadablePaths(state.rows), [state.rows])
  const busy = state.status === 'building' || state.status === 'loading'
  const hasTable = state.csvPath !== null && state.status !== 'building'
  const dir = state.dir

  useEffect(() => {
    void dispatch(probeActivePaths())
  }, [dispatch, state.rows, state.activeKey])

  // The unreadable list is shown after each load/rebuild, not on every list change.
  useEffect(() => {
    if (state.status === 'ready' && unreadable.length > 0) {
      dispatch(feedbackOpened({ panel: 'unreadable' }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, state.csvPath])

  useKeymap('duplicates', [
    { id: 'duplicates.togglePlay', keys: ['S'], description: 'Play/pause table auto-scroll', run: scroll.toggle },
    { id: 'duplicates.faster', keys: ['A'], description: 'Auto-scroll speed +5 (up)', run: scroll.faster, allowRepeat: true },
    { id: 'duplicates.slower', keys: ['F'], description: 'Auto-scroll speed -5 (down)', run: scroll.slower, allowRepeat: true },
    {
      id: 'duplicates.fitAll',
      keys: ['Ctrl+Shift+S'],
      description: 'Reset all cells to the default size',
      run: () => setCellSize(DEFAULT_CELL)
    }
  ])

  const scan = (rebuild: boolean): void => {
    if (dir !== null) void dispatch(scanFolder({ dir, kind: state.kind, rebuild }))
  }

  const chooseFolder = async (): Promise<void> => {
    try {
      const picked = await call('app:openDirectoryDialog', { title: 'Folder to analyse' })
      if (picked.canceled || picked.path === null) return
      await dispatch(loadHashTable({ source: { dir: picked.path, kind: state.kind } }))
    } catch (error: unknown) {
      toast.apiError(error, 'Choosing the folder')
    }
  }

  const moveToR = (): void => {
    const folder = sanitizeFolderName(folderText, folders?.purge ?? 'md5Purge')
    if (folder === null) return void toast.error('Invalid folder name')
    if (state.selectedPaths.length === 0) return void toast.info('Nothing selected')
    void dispatch(movePaths({ paths: state.selectedPaths, folder }))
  }

  const moveToRuim = (): void => {
    void dispatch(movePaths({ paths: unreadable, folder: folders?.ruim ?? 'ruimFolder' })).then(() =>
      dispatch(feedbackClosed())
    )
  }

  const copy = (): void => {
    navigator.clipboard.writeText(state.exportText).then(
      () => toast.success('Copied'),
      (error: unknown) => toast.apiError(error, 'Copying')
    )
  }

  const progress = state.progress
  const determinate = progress !== null && progress.total > 0
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ p: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h6" component="h1">Duplicates</Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={state.kind}
          disabled={busy}
          aria-label="Kind"
          onChange={(_e, value: HashKind | null) => value !== null && dispatch(kindChanged(value))}
        >
          {KINDS.map((k) => (
            <ToggleButton key={k} value={k}>{KIND_LABEL[k]}</ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Button variant="outlined" size="small" disabled={busy} onClick={() => void chooseFolder()}>
          Choose folder
        </Button>
        <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 360 }}>
          {dir ?? 'No folder'}
        </Typography>
        <Button size="small" disabled={busy || dir === null} onClick={() => scan(false)}>Build / load</Button>
        <Button size="small" disabled={busy || dir === null} onClick={() => scan(true)}>Rebuild</Button>
        {state.status === 'building' && state.taskId !== null && (
          <Button size="small" color="warning" onClick={() => state.taskId !== null && void dispatch(cancelHashing(state.taskId))}>
            Cancel
          </Button>
        )}
      </Stack>

      {state.status === 'building' && (
        <Box sx={{ px: 1 }}>
          <LinearProgress
            variant={determinate ? 'determinate' : 'indeterminate'}
            value={determinate ? (100 * progress.done) / progress.total : 0}
          />
          <Typography variant="caption">
            {progress ? `${progress.phase}: ${progress.done}/${progress.total} (${progress.failed} failed)` : 'Starting...'}
          </Typography>
        </Box>
      )}
      {state.status === 'error' && state.error?.code === 'NOT_FOUND' && dir !== null && (
        <Alert severity="info" sx={{ m: 1 }} action={<Button color="inherit" size="small" onClick={() => scan(false)}>Build</Button>}>
          No analysis exists for this folder yet.
        </Alert>
      )}
      {state.status === 'error' && state.error?.code !== 'NOT_FOUND' && (
        <Alert severity="error" sx={{ m: 1 }}>{state.error?.message}</Alert>
      )}
      {state.warning !== null && <Alert severity="warning" sx={{ m: 1 }}>{state.warning}</Alert>}

      {hasTable && (
        <>
          <Stack direction="row" spacing={1} useFlexGap sx={{ px: 1, flexWrap: 'wrap' }}>
            {HASH_KEYS.map((key) => {
              const c = counts.find((x) => x.key === key)
              const groups = c?.groups ?? 0
              return (
                <Button
                  key={key}
                  size="small"
                  variant={state.activeKey === key ? 'contained' : 'outlined'}
                  disabled={groups === 0}
                  onClick={() => dispatch(activeKeyChanged(key))}
                >
                  {`${key}: ${plural(groups, 'group')} / ${plural(c?.files ?? 0, 'file')}`}
                </Button>
              )
            })}
          </Stack>
          <Stack direction="row" spacing={1} useFlexGap sx={{ p: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button size="small" onClick={() => dispatch(selectionChanged(selectAll(tableRows)))}>Select all</Button>
            <Button size="small" onClick={() => dispatch(selectionChanged([]))}>Select none</Button>
            <Button size="small" onClick={() => dispatch(selectionChanged(selectAll(tableRows)))}>
              Select only picture column
            </Button>
            <Button size="small" onClick={() => dispatch(selectionChanged(unselectFirstColumn(tableRows, state.selectedPaths)))}>
              Unselect first column
            </Button>
            <TextField
              size="small"
              label="Folder name"
              placeholder={folders?.purge ?? 'md5Purge'}
              value={folderText}
              onChange={(e) => setFolderText(e.target.value)}
              sx={{ width: 160 }}
            />
            <Button size="small" variant="contained" color="warning" disabled={state.selectedPaths.length === 0} onClick={moveToR}>
              {`Move to R (${state.selectedPaths.length})`}
            </Button>
            <Button size="small" onClick={() => void dispatch(openFirstLines())}>Open first line analyses</Button>
            <Button size="small" onClick={() => dispatch(feedbackOpened({ panel: 'export', text: exportScreenData(tableRows) }))}>
              Export screen data
            </Button>
            <Button size="small" disabled={unreadable.length === 0} onClick={() => dispatch(feedbackOpened({ panel: 'unreadable' }))}>
              {`Feedback (${unreadable.length})`}
            </Button>
            <Button size="small" onClick={() => void dispatch(saveTable())}>Save</Button>
            <Button size="small" onClick={() => void dispatch(concatOther())}>Concat other data</Button>
            <Button size="small" onClick={() => void dispatch(cleanTable())}>Clean</Button>
            <Button size="small" variant={scroll.playing ? 'contained' : 'outlined'} onClick={scroll.toggle}>
              {scroll.playing ? 'Pause' : 'Play'}
            </Button>
            <Typography
              variant="body2"
              aria-label="Scroll speed"
              onWheel={(e) => (e.deltaY < 0 ? scroll.faster() : scroll.slower())}
              sx={{ minWidth: 28, textAlign: 'right' }}
            >
              {String(scroll.speed).padStart(2, '0')}
            </Typography>
            <Button size="small" onClick={() => setCellSize(DEFAULT_CELL)}>Fit all</Button>
            {state.probing && <Typography variant="caption">Reading file info...</Typography>}
          </Stack>
          <DuplicatesTable
            rows={tableRows}
            kind={state.kind}
            facts={state.facts}
            selected={state.selectedPaths}
            cellSize={cellSize}
            scrollRef={scrollRef}
            onToggle={(path) => dispatch(selectionChanged(toggleSelected(state.selectedPaths, path)))}
          />
        </>
      )}

      <FeedbackDialog
        open={state.feedback !== null}
        panel={state.feedback}
        text={state.feedback === 'export' ? state.exportText : unreadable.join('\n')}
        onClose={() => dispatch(feedbackClosed())}
        onMoveToRuim={moveToRuim}
        onCopy={copy}
      />
    </Box>
  )
}
