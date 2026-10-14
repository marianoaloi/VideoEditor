/**
 * Media facts with colour thresholds, the editable job overrides and the size/time estimates
 * (video-triage.md §7). Props: `./types.ts`. All numbers come from `@shared/core/triageInfo`.
 *
 * Editable fields (`avgrate`, `size`, `crop`, `rateVideo`) commit on Enter or blur. An unchanged
 * value never becomes an override (legacy marked the field on focus-out even without a change);
 * an invalid value is refused with a message and nothing is sent; an empty value clears the
 * override.
 */
import { useMemo, useState, type KeyboardEvent } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import {
  parseAvgrateOverride,
  parseCropOverride,
  parseRateOverride,
  parseSizeOverride,
  type ParseResult
} from '@shared/core/jobDraft'
import {
  buildInfoFields,
  estimateFactors,
  selectionSummary,
  type TriageInfoField
} from '@shared/core/triageInfo'
import { formatMillis } from '@shared/core/timeFormat'
import type { JobDraftOverrides } from '../../app/draft'
import type { InfoBarProps, InfoColor, InfoFieldId } from './types'

const COLORS: Readonly<Record<InfoColor, string>> = {
  green: '#2e7d32',
  yellow: '#b28704',
  red: '#c62828',
  none: 'transparent'
}

type OverridePatch = Partial<JobDraftOverrides>

const PARSERS: Partial<Record<InfoFieldId, (text: string) => ParseResult<OverridePatch>>> = {
  size: (text) => mapResult(parseSizeOverride(text), (size) => ({ size })),
  rateVideo: (text) => mapResult(parseRateOverride(text), (rate) => ({ rate })),
  avgrate: (text) => mapResult(parseAvgrateOverride(text), (avgrate) => ({ avgrate })),
  crop: (text) => mapResult(parseCropOverride(text), (crop) => ({ crop }))
}

function mapResult<T, U>(result: ParseResult<T>, map: (value: T) => U): ParseResult<U> {
  return result.ok ? { ok: true, value: map(result.value) } : result
}

interface FieldCellProps {
  field: TriageInfoField
  onCommit: (patch: OverridePatch) => void
}

function FieldCell({ field, onCommit }: FieldCellProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const shown = draft ?? field.text
  const swatch = COLORS[field.color]

  const commit = (): void => {
    if (draft === null) return
    const parse = PARSERS[field.id]
    if (parse === undefined || draft === field.text) {
      setDraft(null)
      setError(null)
      return
    }
    const result = parse(draft)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setDraft(null)
    setError(null)
    onCommit(result.value)
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') commit()
    if (event.key === 'Escape') {
      setDraft(null)
      setError(null)
    }
  }

  return (
    <Box
      data-testid={`info-${field.id}`}
      data-color={field.color}
      sx={{
        minWidth: 92,
        px: 1,
        py: 0.5,
        borderRadius: 1,
        borderLeft: 4,
        borderColor: swatch,
        bgcolor: field.overridden ? 'action.selected' : 'transparent'
      }}
    >
      {field.editable ? (
        <TextField
          size="small"
          variant="standard"
          label={field.label}
          value={shown}
          error={error !== null}
          helperText={error ?? (field.overridden ? 'Override' : undefined)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          slotProps={{ htmlInput: { 'aria-label': field.label }, inputLabel: { shrink: true } }}
        />
      ) : (
        <>
          <Typography variant="caption" color="text.secondary" component="div">
            {field.label}
          </Typography>
          <Typography variant="body2" component="div">
            {field.text}
          </Typography>
        </>
      )}
    </Box>
  )
}

export function InfoBar(props: InfoBarProps) {
  const { info, fileSizeBytes, positionMs, selectedMs, thresholds, overrides, onOverridesChange } =
    props
  const input = useMemo(
    () =>
      info === null
        ? null
        : {
            info,
            fileSizeBytes,
            thresholds,
            overrides: {
              size: overrides.size,
              rate: overrides.rate,
              avgrate: overrides.avgrate,
              crop: overrides.crop
            }
          },
    [info, fileSizeBytes, thresholds, overrides.size, overrides.rate, overrides.avgrate, overrides.crop]
  )
  const fields = useMemo(() => (input === null ? [] : buildInfoFields(input)), [input])
  const summary = useMemo(
    () => selectionSummary(selectedMs, thresholds, input === null ? null : estimateFactors(input)),
    [selectedMs, thresholds, input]
  )

  if (props.error !== undefined && props.error !== null) {
    return (
      <Alert severity="error" role="alert" aria-label="Media information">
        {props.error}
      </Alert>
    )
  }

  return (
    <Box
      role="group"
      aria-label="Media information"
      sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'flex-start' }}
    >
      {fields.map((field) => (
        <FieldCell key={field.id} field={field} onCommit={onOverridesChange} />
      ))}
      <Box data-testid="info-position" sx={{ minWidth: 92, px: 1, py: 0.5 }}>
        <Typography variant="caption" color="text.secondary" component="div">
          Position
        </Typography>
        <Typography variant="body2" component="div">
          {formatMillis(positionMs)}
        </Typography>
      </Box>
      <Box
        data-testid="info-selection"
        data-color={summary.color}
        sx={{ minWidth: 120, px: 1, py: 0.5, borderLeft: 4, borderColor: COLORS[summary.color] }}
      >
        <Typography variant="caption" color="text.secondary" component="div">
          Selection
        </Typography>
        <Typography variant="body2" component="div">
          {summary.text}
        </Typography>
      </Box>
      <Box data-testid="info-estimate" sx={{ minWidth: 92, px: 1, py: 0.5 }}>
        <Typography variant="caption" color="text.secondary" component="div">
          Estimated size
        </Typography>
        <Typography variant="body2" component="div">
          {summary.estimate ?? '—'}
        </Typography>
      </Box>
    </Box>
  )
}

export default InfoBar
