import { fireEvent, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createAppStore } from '../../app/store'
import ZoomViewer from './ZoomViewer'

beforeAll(() => {
  // jsdom has no 2D canvas; the viewer must still render and handle input without one.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

function setup(onClose = vi.fn()) {
  const store = createAppStore()
  render(
    <Provider store={store}>
      <ZoomViewer open imageUrl="media://local/x" width={640} height={360} title="x.jpg" onClose={onClose} />
    </Provider>
  )
  return { onClose, store }
}

describe('ZoomViewer (cutter checklist 43-45)', () => {
  it('opens at 100 %', () => {
    setup()
    expect(screen.getByTestId('zoom-label').textContent).toBe('+1.00 x')
  })

  it('the wheel over the zoom label steps x1.1 / x0.9 (TV-10)', () => {
    setup()
    const label = screen.getByTestId('zoom-label')
    fireEvent.wheel(label, { deltaY: -120 })
    fireEvent.wheel(label, { deltaY: -120 })
    expect(label.textContent).toBe('+1.21 x')
    fireEvent.wheel(label, { deltaY: 120 })
    expect(label.textContent).toBe('+1.09 x')
  })

  it('double-click on the label returns to 1', () => {
    setup()
    const label = screen.getByTestId('zoom-label')
    fireEvent.wheel(label, { deltaY: -120 })
    fireEvent.doubleClick(label)
    expect(label.textContent).toBe('+1.00 x')
  })

  it('the zoom slider maps value/100 (250 -> +2.50 x)', () => {
    setup()
    fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '250' } })
    expect(screen.getByTestId('zoom-label').textContent).toBe('+2.50 x')
  })

  it('the X button reports onClose', () => {
    const { onClose } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('has brightness, contrast and rotation sliders', () => {
    setup()
    for (const name of [/Brightness/, /Contrast/, /Rotation/]) {
      expect(screen.getByRole('slider', { name })).toBeTruthy()
    }
  })
})
