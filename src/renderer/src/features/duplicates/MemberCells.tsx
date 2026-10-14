/** The cell pair of one member: thumbnail (picture cell) and info cell (duplicates-thumbs.md §8.3). */
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useEffect, useState } from 'react'
import { formatSize } from '@shared/core/timeFormat'
import type { HashKind } from '@shared/domain/hash'
import { toMediaUrl } from '@shared/ipc/mediaUrl'
import { call } from '../../app/api'
import { difBadge, type FileFacts, type TableMember } from './grouping'

export const DEFAULT_CELL = 310
export const INFO_WIDTH = 300

function splitPath(path: string): { dir: string; name: string } {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf(String.fromCharCode(92)))
  return index < 0 ? { dir: '', name: path } : { dir: path.slice(0, index), name: path.slice(index + 1) }
}

/** Video thumbnail: the cached 4x4 mosaic (`media:mosaic`); failures are shown, never cached. */
function useMosaicUrl(path: string, enabled: boolean): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false })
  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    call('media:mosaic', { path })
      .then((ref) => {
        if (!cancelled) setState({ url: ref.url, failed: false })
      })
      .catch(() => {
        if (!cancelled) setState({ url: null, failed: true })
      })
    return () => {
      cancelled = true
    }
  }, [path, enabled])
  return state
}

export function PictureCell(props: { member: TableMember; kind: HashKind; size: number }) {
  const { member, kind, size } = props
  const isImage = kind === 'image'
  const mosaic = useMosaicUrl(member.path, !isImage)
  const src = isImage ? toMediaUrl(member.path) : mosaic.url
  return (
    <Box sx={{ width: size, height: size, flex: 'none', display: 'grid', placeItems: 'center' }}>
      {src === null ? (
        <Typography variant="caption" color={mosaic.failed ? 'error' : 'text.secondary'}>
          {mosaic.failed ? 'No thumbnail' : 'Loading...'}
        </Typography>
      ) : (
        <img
          src={src}
          alt={splitPath(member.path).name}
          loading="lazy"
          draggable={false}
          style={{ width: size - 10, height: size - 10, objectFit: isImage ? 'fill' : 'contain' }}
        />
      )}
    </Box>
  )
}

function DifSlot(props: { firstSize: number; size: number }) {
  const badge = difBadge(props.firstSize, props.size)
  if (badge.kind === 'none') return null
  if (badge.kind === 'blue') return <Typography sx={{ color: '#0d47a1', fontWeight: 700 }}>DIF</Typography>
  return (
    <Typography sx={{ color: '#c62828', fontWeight: 700 }}>
      DIF <span data-testid="dif-percent">{badge.percent}%</span>
    </Typography>
  )
}

export function InfoCell(props: {
  member: TableMember
  kind: HashKind
  facts: FileFacts | null | undefined
  firstSize: number
  height: number
}) {
  const { member, kind, facts, firstSize, height } = props
  const { dir, name } = splitPath(member.path)
  const isImage = kind === 'image'
  return (
    <Box
      sx={{
        width: INFO_WIDTH,
        height,
        flex: 'none',
        p: 1,
        overflow: 'auto',
        wordBreak: 'break-all',
        ...(isImage ? { bgcolor: '#fff59d', color: '#0d1b6b' } : {})
      }}
    >
      {isImage ? (
        <>
          <Typography variant="h6" component="h3">
            {facts ? `(${facts.height}, ${facts.width}, 3)` : 'Empty'}
          </Typography>
          <Typography variant="body2">{name}</Typography>
          <Typography variant="caption" sx={{ display: 'block' }}>{member.row.root}</Typography>
          <Typography variant="caption" sx={{ display: 'block' }}>{member.value}</Typography>
          <Typography variant="body2">{formatSize(member.row.sizeFile)}</Typography>
          <DifSlot firstSize={firstSize} size={member.row.sizeFile} />
        </>
      ) : (
        <>
          <Typography variant="h6" component="h3">{facts?.hasAudio === true ? 'AA' : 'NA'}</Typography>
          <Typography variant="body2">
            {facts ? `${facts.bitrateKbps}K ${facts.width}X${facts.height}` : '...'}
          </Typography>
          <Typography variant="caption" sx={{ display: 'block' }}>{member.value}</Typography>
          <Typography variant="body2">{name}</Typography>
          <Typography variant="caption" sx={{ display: 'block' }}>{dir}</Typography>
          <Typography variant="body2">{formatSize(facts?.sizeBytes ?? member.row.sizeFile)}</Typography>
        </>
      )}
    </Box>
  )
}
