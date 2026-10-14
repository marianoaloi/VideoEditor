/**
 * One picture cell. Shows the original through `media://`; a decode error or a format the browser
 * cannot draw switches to the converted preview (original untouched, badge), and if that fails
 * too a placeholder with the file name (the item stays triageable).
 */
import { useEffect, useState, type MouseEvent } from 'react'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import { toMediaUrl } from '@shared/ipc/mediaUrl'
import type { TriageItem } from '../../app/triage/triageCore'
import { needsConvertedPreview } from './logic'
import { requestPreview } from './preview'

type Source = { kind: 'original' } | { kind: 'preview'; url: string } | { kind: 'failed' }

interface Props {
  item: TriageItem
  onLeftClick?: () => void
  onRightClick?: () => void
  minHeight?: number
}

export default function ImageTile({ item, onLeftClick, onRightClick, minHeight = 80 }: Props) {
  const direct = !needsConvertedPreview(item.name)
  const [source, setSource] = useState<Source>(direct ? { kind: 'original' } : { kind: 'failed' })

  const convert = (force: boolean): void => {
    void requestPreview(item.path, force).then((preview) => {
      setSource(preview === null ? { kind: 'failed' } : { kind: 'preview', url: preview.url })
    })
  }

  useEffect(() => {
    setSource(direct ? { kind: 'original' } : { kind: 'failed' })
    if (!direct) convert(false)
    // Reset when the file or its edit version changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.path, item.version])

  const handle = (event: MouseEvent, action?: () => void): void => {
    event.preventDefault()
    action?.()
  }
  const url = source.kind === 'preview' ? source.url : toMediaUrl(item.path, { version: item.version })

  return (
    <Box
      data-testid="image-tile"
      onClick={(e) => handle(e, onLeftClick)}
      onContextMenu={(e) => handle(e, onRightClick)}
      sx={{ position: 'relative', flex: 1, minWidth: 0, minHeight, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', bgcolor: 'action.hover' }}
    >
      {source.kind === 'failed' ? (
        <Typography variant="caption" noWrap sx={{ px: 1 }}>
          {item.name}
        </Typography>
      ) : (
        <img
          src={url}
          alt={item.name}
          draggable={false}
          onError={() => {
            if (source.kind === 'original') convert(true)
            else setSource({ kind: 'failed' })
          }}
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        />
      )}
      {source.kind === 'preview' && (
        <Chip size="small" label="preview, original untouched" sx={{ position: 'absolute', bottom: 2, left: 2 }} />
      )}
    </Box>
  )
}
