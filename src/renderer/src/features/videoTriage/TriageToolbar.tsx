/** Menus (File, Options, Interfaces), Go to file, Convert and fallback toggles of Video Triage (§6). */
import { useState, type MouseEvent } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'

export interface MenuEntry {
  label: string
  onClick: () => void
  checked?: boolean
  disabled?: boolean
}

function MenuButton({ label, entries }: { label: string; entries: MenuEntry[] }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const open = (event: MouseEvent<HTMLElement>): void => setAnchor(event.currentTarget)
  return (
    <>
      <Button size="small" onClick={open} aria-haspopup="menu">
        {label}
      </Button>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {entries.map((entry) => (
          <MenuItem
            key={entry.label}
            disabled={entry.disabled}
            onClick={() => {
              setAnchor(null)
              entry.onClick()
            }}
          >
            {entry.checked === undefined ? null : (
              <Checkbox size="small" checked={entry.checked} tabIndex={-1} disableRipple />
            )}
            {entry.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

export interface TriageToolbarProps {
  file: MenuEntry[]
  options: MenuEntry[]
  interfaces: MenuEntry[]
  convert: boolean
  onConvert: (value: boolean) => void
  forceTranscode: boolean
  onForceTranscode: () => void
  onExecute: () => void
  onFind: (text: string) => void
  findError: string | null
}

export function TriageToolbar(props: TriageToolbarProps) {
  const [text, setText] = useState('')
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      <MenuButton label="File" entries={props.file} />
      <MenuButton label="Options" entries={props.options} />
      <MenuButton label="Interfaces" entries={props.interfaces} />
      <TextField
        size="small"
        label="Go to file"
        value={text}
        error={props.findError !== null}
        helperText={props.findError ?? undefined}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') props.onFind(text)
        }}
        slotProps={{ htmlInput: { 'aria-label': 'Go to file' } }}
      />
      <FormControlLabel
        label="Convert first"
        control={
          <Checkbox
            size="small"
            checked={props.convert}
            onChange={(event) => props.onConvert(event.target.checked)}
          />
        }
      />
      <ToggleButton
        size="small"
        value="fallback"
        selected={props.forceTranscode}
        onChange={props.onForceTranscode}
        aria-label="Fallback player"
      >
        Fallback player
      </ToggleButton>
      <Button size="small" variant="outlined" onClick={props.onExecute}>
        Execute movie
      </Button>
    </Box>
  )
}

export default TriageToolbar
