import { ThemeProvider } from '@mui/material/styles'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '@renderer/App'
import { theme } from '@renderer/app/theme'

function renderApp(): void {
  render(
    <ThemeProvider theme={theme}>
      <App />
    </ThemeProvider>
  )
}

describe('App shell', () => {
  it('lists the six workspaces in the navigation', () => {
    renderApp()
    const nav = screen.getByRole('navigation', { name: 'Workspaces' })
    const labels = within(nav)
      .getAllByRole('button')
      .map((button) => button.textContent)
    expect(labels).toEqual([
      'Video Triage',
      'Image Triage',
      'Cutter',
      'Jobs',
      'Duplicates',
      'Settings'
    ])
  })

  it('starts on Video Triage and switches the main area on click', async () => {
    const user = userEvent.setup()
    renderApp()
    expect(screen.getByRole('heading', { name: 'Video Triage' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cutter' }))

    expect(screen.getByRole('heading', { name: 'Cutter' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Video Triage' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cutter' })).toHaveAttribute('aria-current', 'page')
  })
})
