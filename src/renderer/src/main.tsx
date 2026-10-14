import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'
import { Provider } from 'react-redux'
import App from '@renderer/App'
import { initApp } from '@renderer/app/init'
import { store } from '@renderer/app/store'
import { theme } from '@renderer/app/theme'

const container = document.getElementById('root')
if (!container) throw new Error('index.html is missing the #root element')

initApp(store)

createRoot(container).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      <Provider store={store}>
        <App />
      </Provider>
    </ThemeProvider>
  </StrictMode>
)
