/** One Settings field, rendered from its `FieldDef`. */
import { useState } from 'react'
import Button from '@mui/material/Button'
import FormControlLabel from '@mui/material/FormControlLabel'
import InputAdornment from '@mui/material/InputAdornment'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import { useNotify } from '@renderer/app/notifications/notify'
import { browsePath } from './browse'
import { listToText, textToList, type FieldDef } from './fields'

interface Props {
  def: FieldDef
  value: unknown
  onChange: (value: unknown) => void
}

function BrowseField({ def, value, onChange }: Props) {
  const toast = useNotify()
  const kind = def.kind === 'dir' ? 'dir' : 'file'
  const text = typeof value === 'string' ? value : ''
  const pick = (): void => {
    browsePath(kind, def.label)
      .then((path) => {
        if (path !== null) onChange(path)
      })
      .catch((error: unknown) => toast.apiError(error, 'Choosing a path'))
  }
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
      <TextField
        label={def.label}
        value={text}
        helperText={def.help}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        sx={{ flex: 1 }}
      />
      <Button variant="outlined" onClick={pick} aria-label={`Browse ${def.label}`}>
        Browse
      </Button>
    </Stack>
  )
}

function ListField({ def, value, onChange }: Props) {
  // Keep the raw text while typing: "a, " must not collapse to "a".
  const [text, setText] = useState(listToText(value))
  return (
    <TextField
      label={def.label}
      value={text}
      helperText={def.help}
      onChange={(e) => {
        setText(e.target.value)
        onChange(textToList(e.target.value))
      }}
    />
  )
}

export default function FieldControl(props: Props) {
  const { def, value, onChange } = props
  switch (def.kind) {
    case 'bool':
      return (
        <FormControlLabel
          label={def.label}
          control={
            <Switch checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          }
        />
      )
    case 'dir':
    case 'file':
      return <BrowseField {...props} />
    case 'list':
      return <ListField {...props} />
    case 'enum':
      return (
        <TextField
          select
          label={def.label}
          value={typeof value === 'string' ? value : ''}
          helperText={def.help}
          onChange={(e) => onChange(e.target.value)}
        >
          {(def.options ?? []).map((option) => (
            <MenuItem key={option} value={option}>
              {option}
            </MenuItem>
          ))}
        </TextField>
      )
    case 'int':
    case 'number':
      return (
        <TextField
          type="number"
          label={def.label}
          value={typeof value === 'number' ? value : ''}
          helperText={def.help}
          onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
          slotProps={{
            htmlInput: { step: def.kind === 'int' ? 1 : 'any' },
            input:
              def.unit === undefined
                ? undefined
                : { endAdornment: <InputAdornment position="end">{def.unit}</InputAdornment> }
          }}
        />
      )
    default:
      return (
        <TextField
          label={def.label}
          value={typeof value === 'string' ? value : ''}
          helperText={def.help}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}
