import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { describe, expect, it, vi } from 'vitest'
import { createAppStore } from '../../app/store'
import CropDialog from './CropDialog'
import type { CropDialogProps } from './types'

// Konva needs a real canvas; the stage is replaced by a stub that forwards pointer calls.
vi.mock('./CropStage', () => ({
  default: (props: {
    selection: { x: number; y: number; w: number; h: number } | null
    onPress: (p: { x: number; y: number }) => void
    onMove: (p: { x: number; y: number }) => void
    onRelease: () => void
  }) => (
    <div>
      <span data-testid="selection">{props.selection ? JSON.stringify(props.selection) : 'none'}</span>
      <button
        type="button"
        onClick={() => {
          props.onPress({ x: 100, y: 50 })
          props.onMove({ x: 300, y: 150 })
          props.onRelease()
        }}
      >
        drag
      </button>
      <button
        type="button"
        onClick={() => {
          props.onPress({ x: 100, y: 50 })
          props.onMove({ x: 400, y: 400 })
          props.onRelease()
        }}
      >
        drag-big
      </button>
      <button
        type="button"
        onClick={() => {
          props.onPress({ x: 5, y: 5 })
          props.onRelease()
        }}
      >
        click-empty
      </button>
    </div>
  )
}))

function setup(overrides: Partial<CropDialogProps> = {}) {
  const props: CropDialogProps = {
    open: true,
    image: { url: 'media://local/x', width: 640, height: 360 },
    mode: 'image',
    title: 'x.jpg',
    onAccept: vi.fn(),
    onCancel: vi.fn(),
    ...overrides
  }
  const store = createAppStore()
  render(
    <Provider store={store}>
      <CropDialog {...props} />
    </Provider>
  )
  return { props, store }
}

function setSlider(name: string, value: number): void {
  const input = screen.getByRole('slider', { name: new RegExp(name) })
  fireEvent.change(input, { target: { value: String(value) } })
}

describe('CropDialog (cutter checklist 33-39)', () => {
  it('a neutral accept calls onCancel and not onAccept', () => {
    const { props } = setup()
    fireEvent.click(screen.getByRole('button', { name: /Apply/ }))
    expect(props.onCancel).toHaveBeenCalledTimes(1)
    expect(props.onAccept).not.toHaveBeenCalled()
  })

  it('maps the sliders to bright/255, contrast/100 and transpose = -rotation', () => {
    const { props } = setup()
    setSlider('Brightness', 50)
    setSlider('Contrast', 150)
    setSlider('Rotation', 45)
    fireEvent.click(screen.getByRole('button', { name: /Apply/ }))
    expect(props.onAccept).toHaveBeenCalledWith({
      crop: null,
      bright: 50 / 255,
      contrast: 1.5,
      transpose: -45
    })
  })

  it('a dragged rectangle becomes a source-pixel crop', () => {
    const { props } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'drag' }))
    fireEvent.click(screen.getByRole('button', { name: /Apply/ }))
    expect(props.onAccept).toHaveBeenCalledWith({
      crop: { x: 100, y: 50, w: 200, h: 100 },
      bright: null,
      contrast: null,
      transpose: null
    })
  })

  it('a click on empty space hides the band', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'drag' }))
    expect(screen.getByTestId('selection').textContent).not.toBe('none')
    fireEvent.click(screen.getByRole('button', { name: 'click-empty' }))
    expect(screen.getByTestId('selection').textContent).toBe('none')
  })

  it('with a quarter turn the crop is converted to source coordinates (TV-6)', () => {
    const { props } = setup({ mode: 'video', image: { url: 'u', width: 1920, height: 1080 } })
    setSlider('Rotation', 90)
    fireEvent.click(screen.getByRole('button', { name: 'drag-big' }))
    fireEvent.click(screen.getByRole('button', { name: /Apply/ }))
    // displayed (100,50,300,350) on a 1080x1920 canvas -> (yd, H-xd-wd, hd, wd) = (50, 680, 350, 300)
    expect(props.onAccept).toHaveBeenCalledWith({
      crop: { x: 50, y: 680, w: 350, h: 300 },
      bright: null,
      contrast: null,
      transpose: -90
    })
  })

  it('video mode offers quarter turns only', () => {
    setup({ mode: 'video' })
    const rotation = screen.getByRole('slider', { name: /Rotation/ })
    expect(rotation.getAttribute('step')).toBe('90')
  })

  it('Vertical Default applies at once: 218,0,204,360 on 640x360 (cutter 3.6)', () => {
    const { props } = setup()
    fireEvent.click(screen.getByRole('button', { name: /Vertical Default/ }))
    expect(props.onAccept).toHaveBeenCalledWith(
      expect.objectContaining({ crop: { x: 218, y: 0, w: 204, h: 360 } })
    )
  })

  it('Strip Image selects the detected area (source pixels) and waits for Apply', async () => {
    const detectBars = vi.fn().mockResolvedValue({ x: 10, y: 20, w: 300, h: 200 })
    const { props } = setup({ detectBars })
    fireEvent.click(screen.getByRole('button', { name: /Strip Image/ }))
    await waitFor(() => expect(screen.getByTestId('selection').textContent).toContain('"w":300'))
    expect(props.onAccept).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Apply/ }))
    expect(props.onAccept).toHaveBeenCalledWith(
      expect.objectContaining({ crop: { x: 10, y: 20, w: 300, h: 200 } })
    )
  })

  it('hides Strip Image without detectBars and cancels with the Cancel button', () => {
    const { props } = setup()
    expect(screen.queryByRole('button', { name: /Strip Image/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }))
    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })

  it('seeds the band from initial.crop and the sliders from the seed', () => {
    const { props } = setup({
      initial: { crop: { x: 20, y: 10, w: 300, h: 200 }, bright: 0.2, contrast: null, transpose: null }
    })
    expect(screen.getByTestId('selection').textContent).toContain('"x":20')
    fireEvent.click(screen.getByRole('button', { name: /Apply/ }))
    expect(props.onAccept).toHaveBeenCalledWith(
      expect.objectContaining({ crop: { x: 20, y: 10, w: 300, h: 200 }, bright: 0.2 })
    )
  })
})
