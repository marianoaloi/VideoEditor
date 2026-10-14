/** Virtualised table: one row per duplicate group, one picture+info pair per member. */
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { RefObject } from 'react'
import type { HashKind } from '@shared/domain/hash'
import { InfoCell, INFO_WIDTH, PictureCell } from './MemberCells'
import { pathKey } from '@shared/core/duplicates'
import type { FactsMap, TableRow } from './grouping'

export interface DuplicatesTableProps {
  rows: readonly TableRow[]
  kind: HashKind
  facts: FactsMap
  selected: readonly string[]
  cellSize: number
  scrollRef: RefObject<HTMLDivElement | null>
  onToggle(path: string): void
}

export default function DuplicatesTable(props: DuplicatesTableProps) {
  const { rows, kind, facts, selected, cellSize, scrollRef, onToggle } = props
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => cellSize,
    overscan: 2,
    // jsdom has no layout: give the virtualizer a viewport so tests render rows.
    initialRect: { width: 1200, height: 800 }
  })
  const chosen = new Set(selected.map((p) => pathKey(p)))
  return (
    <Box ref={scrollRef} data-testid="dup-scroll" sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
      {rows.length === 0 && (
        <Typography sx={{ p: 2 }} color="text.secondary">No duplicate groups for this key.</Typography>
      )}
      <Box sx={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth: 'max-content' }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]
          if (row === undefined) return null
          const firstSize = row.members[0]?.row.sizeFile ?? 0
          return (
            <Box
              key={row.id}
              data-testid="dup-row"
              sx={{ position: 'absolute', top: 0, left: 0, display: 'flex', height: cellSize }}
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {row.members.map((member) => {
                const isSel = chosen.has(pathKey(member.path))
                return (
                  <Box
                    key={member.path}
                    role="button"
                    aria-pressed={isSel}
                    aria-label={member.path}
                    data-selected={isSel}
                    onClick={() => onToggle(member.path)}
                    sx={{
                      display: 'flex',
                      width: cellSize + INFO_WIDTH,
                      height: cellSize,
                      cursor: 'pointer',
                      border: 2,
                      borderColor: isSel ? 'primary.main' : 'divider',
                      bgcolor: isSel ? 'action.selected' : 'transparent'
                    }}
                  >
                    <PictureCell member={member} kind={kind} size={cellSize} />
                    <InfoCell
                      member={member}
                      kind={kind}
                      facts={facts[member.path]}
                      firstSize={firstSize}
                      height={cellSize}
                    />
                  </Box>
                )
              })}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
