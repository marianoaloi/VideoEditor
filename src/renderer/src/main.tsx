import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'
import App from '@renderer/App'
import { theme } from '@renderer/app/theme'

const container = document.getElementById('root')
if (!container) throw new Error('index.html is missing the #root element')

// SWARM-WIRE(store): wrap <App /> in react-redux's <Provider store={store}> (app/store.ts)
createRoot(container).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      <App />
    </ThemeProvider>
  </StrictMode>
)
