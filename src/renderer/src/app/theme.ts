import { createTheme } from '@mui/material/styles'

/** System font stack: no web fonts are bundled or fetched. Segoe UI is the Windows UI font. */
const FONT_FAMILY = [
  '"Segoe UI"',
  'system-ui',
  '-apple-system',
  'Roboto',
  '"Helvetica Neue"',
  'Arial',
  'sans-serif'
].join(',')

/** Accent colour; it doubles as the keyboard focus ring colour. */
const FOCUS_COLOR = '#6cb6ff'

/** Elements that take keyboard focus but have no built-in focus style. */
const FOCUSABLE_NON_INPUTS = [
  'button',
  'a[href]',
  '[role="button"]',
  '[tabindex]:not([tabindex="-1"])'
]
  .map((selector) => `${selector}:focus-visible`)
  .join(', ')

/**
 * Dark, dense, keyboard-oriented theme: small controls, no ripples, a visible focus ring and no
 * page scrolling (every screen manages its own scroll areas).
 */
export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: FOCUS_COLOR },
    secondary: { main: '#f0a35e' },
    background: { default: '#121212', paper: '#1a1b1e' }
  },
  shape: { borderRadius: 4 },
  typography: {
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    button: { textTransform: 'none' }
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        'html, body, #root': { height: '100%' },
        body: { overflow: 'hidden' },
        [FOCUSABLE_NON_INPUTS]: { outline: `2px solid ${FOCUS_COLOR}`, outlineOffset: -2 }
      }
    },
    MuiButtonBase: { defaultProps: { disableRipple: true } },
    MuiButton: { defaultProps: { size: 'small', disableElevation: true } },
    MuiIconButton: { defaultProps: { size: 'small' } },
    MuiToggleButton: { defaultProps: { size: 'small' } },
    MuiToggleButtonGroup: { defaultProps: { size: 'small' } },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiFormControl: { defaultProps: { size: 'small' } },
    MuiSelect: { defaultProps: { size: 'small' } },
    MuiAutocomplete: { defaultProps: { size: 'small' } },
    MuiCheckbox: { defaultProps: { size: 'small' } },
    MuiRadio: { defaultProps: { size: 'small' } },
    MuiSwitch: { defaultProps: { size: 'small' } },
    MuiSlider: { defaultProps: { size: 'small' } },
    MuiChip: { defaultProps: { size: 'small' } },
    MuiTable: { defaultProps: { size: 'small' } },
    MuiToolbar: { defaultProps: { variant: 'dense' } },
    MuiList: { defaultProps: { dense: true } },
    MuiMenuItem: { defaultProps: { dense: true } },
    MuiTooltip: { defaultProps: { arrow: true, enterDelay: 500, enterNextDelay: 200 } }
  }
})
