/** Drag-and-drop table (research ffmpeg-jobs §11): videos with their ffprobe columns. */
import { useState, type DragEvent } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { call } from '@renderer/app/api'
import { collectDroppedPaths } from '@renderer/app/dropFiles'
import { useAppDispatch, useAppSelector } from '@renderer/app/hooks'
import { workspaceActivated } from '@renderer/app/keymap/keymapSlice'
import { useNotify } from '@renderer/app/notifications/notify'
import { openCutterVideo } from '../cutter/cutterSlice'
import { addVideos, processRows } from './jobsActions'
import { infoColumns } from './jobsLogic'
import { enqueueFiles, rowsRemoved, type DropRow } from './jobsSlice'

const HEADERS = ['File Name', 'Size', 'Duration', 'Bit Rate', 'Size', 'Frame Rate', 'Codec', 'Audio']

function RowCells({ row }: { row: DropRow }) {
  const c = infoColumns(row.path, row.info)
  const cells = [c.name, c.size, c.duration, c.bitRate, c.dimensions, c.frameRate, c.codec, c.audio]
  return (
    <>
      {cells.map((text, i) => (
        <TableCell key={HEADERS[i] + String(i)} title={i === 0 ? row.path : undefined} sx={{ whiteSpace: 'nowrap' }}>
          {i === 0 && row.error !== null ? `${text} (${row.error})` : text}
        </TableCell>
      ))}
    </>
  )
}

export default function DropTable() {
  const dispatch = useAppDispatch()
  const toast = useNotify()
  const rows = useAppSelector((state) => state.jobs.rows)
  const options = useAppSelector((state) => state.jobs.options)
  const [over, setOver] = useState(false)

  const add = (paths: string[]): void => {
    if (paths.length > 0) void dispatch(addVideos(paths))
  }
  const onDrop = (event: DragEvent): void => {
    event.preventDefault()
    setOver(false)
    const dropped = collectDroppedPaths(event.dataTransfer)
    add(dropped.videos)
    if (dropped.folders.length > 0) {
      toast.warning('Folders are not expanded here', {
        detail: 'Use "Re-encode whole videos in folder" for a folder, or drop its video files.'
      })
    }
    if (dropped.ignored.length > 0) {
      toast.info(`Ignored ${String(dropped.ignored.length)} file(s) that are not videos`, {
        detail: dropped.ignored.slice(0, 5).join(', ')
      })
    }
  }
  const pickFiles = (): void => {
    call('app:openFilesDialog', { title: 'Choose videos', multi: true })
      .then((result) => add(result.canceled ? [] : result.paths))
      .catch((error: unknown) => toast.apiError(error, 'Choosing videos'))
  }
  const openInCutter = (path: string): void => {
    void dispatch(openCutterVideo(path))
    dispatch(workspaceActivated('cutter'))
  }
  const queueWhole = (path: string): void => {
    void dispatch(enqueueFiles({ paths: [path], options, force: true }))
      .unwrap()
      .then(() => toast.success('Queued whole video', { detail: path }))
      .catch(() => undefined) // the rejected thunk is reported by initApp
  }

  return (
    <Paper
      variant="outlined"
      aria-label="Drop videos here"
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      sx={{ p: 1, borderStyle: over ? 'dashed' : 'solid', borderColor: over ? 'primary.main' : 'divider' }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          Drag and drop videos ({rows.length})
        </Typography>
        <Button onClick={pickFiles}>Add videos</Button>
        <Button variant="contained" onClick={() => void dispatch(processRows())} disabled={rows.length === 0}>
          Process all
        </Button>
        <Button onClick={() => dispatch(rowsRemoved(undefined))} disabled={rows.length === 0}>
          Clear table
        </Button>
      </Stack>
      {rows.length === 0 ? (
        <Box sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>Drop video files here</Box>
      ) : (
        <TableContainer sx={{ maxHeight: 260 }}>
          <Table stickyHeader aria-label="Dropped videos">
            <TableHead>
              <TableRow>
                {HEADERS.map((h, i) => (
                  <TableCell key={h + String(i)}>{h}</TableCell>
                ))}
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.path} hover>
                  <RowCells row={row} />
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Button onClick={() => dispatch(rowsRemoved([row.path]))}>Remove</Button>
                    <Button onClick={() => openInCutter(row.path)}>Open in Cutter</Button>
                    <Button onClick={() => queueWhole(row.path)}>Queue whole video</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  )
}
