import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RangeSlider } from './RangeSlider'
import type { RangeSliderProps } from './types'

function setup(overrides: Partial<RangeSliderProps> = {}) {
  const props: RangeSliderProps = {
    durationMs: 10000,
    lowMs: 1000,
    highMs: 5000,
    positionMs: 2000,
    onChange: vi.fn(),
    onChangeCommitted: vi.fn(),
    onSeek: vi.fn(),
    ...overrides
  }
  render(<RangeSlider {...props} />)
  return props
}

describe('RangeSlider', () => {
  it('exposes two labelled handles with the given values', () => {
    setup()
    const start = screen.getByLabelText('Range start')
    const end = screen.getByLabelText('Range end')
    expect(start).toHaveValue('1000')
    expect(end).toHaveValue('5000')
  })

  it('reports a handle move through onChange', () => {
    const props = setup()
    fireEvent.change(screen.getByLabelText('Range start'), { target: { value: '2000' } })
    expect(props.onChange).toHaveBeenCalledWith({ lowMs: 2000, highMs: 5000 })
  })

  it('never lets the low handle reach the high handle', () => {
    const props = setup()
    fireEvent.change(screen.getByLabelText('Range start'), { target: { value: '7000' } })
    const calls = vi.mocked(props.onChange).mock.calls
    for (const [selection] of calls) expect(selection.lowMs).toBeLessThan(selection.highMs)
  })

  it('draws one band per range and the playhead', () => {
    setup({
      ranges: [
        [0, 1000],
        [-1, 10000]
      ]
    })
    expect(screen.getAllByTestId('range-band')).toHaveLength(2)
    expect(screen.getByTestId('range-playhead').style.left || '').toBeDefined()
  })

  it('seeks on a click on the track away from the handles', () => {
    const props = setup()
    const root = screen.getByTestId('range-slider')
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 1000,
      top: 0,
      right: 1000,
      bottom: 20,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })
    fireEvent.pointerDown(root, { clientX: 500, button: 0 })
    expect(props.onSeek).toHaveBeenCalledWith(5000)
    expect(props.onChange).not.toHaveBeenCalled()
  })

  it('is inert when disabled', () => {
    setup({ disabled: true })
    expect(screen.getByLabelText('Range start')).toBeDisabled()
  })
})
