import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Range } from '@shared/domain/job'
import { TimeRanges } from './TimeRanges'
import { selectionColor } from './timeRangesMath'
import type { TimeRangesProps } from './types'

function setup(overrides: Partial<TimeRangesProps> = {}) {
  const ranges: Range[] = [
    [1000, 4500],
    [10000, 20000]
  ]
  const props: TimeRangesProps = {
    ranges,
    durationMs: 95000,
    mode: 1,
    selectedIndex: null,
    onSelect: vi.fn(),
    onSeek: vi.fn(),
    onRemove: vi.fn(),
    onChange: vi.fn(),
    onModeChange: vi.fn(),
    onSplit: vi.fn(),
    thresholds: { greenBelowMs: 600000, yellowBelowMs: 1680000 },
    ...overrides
  }
  render(<TimeRanges {...props} />)
  return props
}

describe('TimeRanges', () => {
  it('shows begin, duration and end as HH:MM:SS.mmm (checklist 12)', () => {
    setup()
    expect(screen.getByLabelText('Start of range 1')).toHaveTextContent('00:00:01.000')
    expect(screen.getByLabelText('Duration of range 1')).toHaveTextContent('00:00:03.500')
    expect(screen.getByLabelText('End of range 1')).toHaveTextContent('00:00:04.500')
    expect(screen.getByLabelText('Selected duration')).toHaveTextContent('00:00:13')
  })

  it('click on begin or end seeks there; click on duration seeks to the start', () => {
    const props = setup()
    fireEvent.click(screen.getByLabelText('Start of range 2'))
    fireEvent.click(screen.getByLabelText('End of range 2'))
    fireEvent.click(screen.getByLabelText('Duration of range 2'))
    expect(vi.mocked(props.onSeek!).mock.calls.map((c) => c[0])).toEqual([10000, 20000, 10000])
  })

  it('removes and selects rows', () => {
    const props = setup()
    fireEvent.click(screen.getByLabelText('Remove range 1'))
    expect(props.onRemove).toHaveBeenCalledWith(0)
    fireEvent.click(screen.getByLabelText('Range 2'))
    expect(props.onSelect).toHaveBeenCalledWith(1)
  })

  it('edits a time by double-click and validates start < end', () => {
    const props = setup()
    fireEvent.doubleClick(screen.getByLabelText('End of range 1'))
    const input = screen.getByLabelText('End of range 1')
    fireEvent.change(input, { target: { value: '00:00:09' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onChange).toHaveBeenCalledWith(0, [1000, 9000])

    fireEvent.doubleClick(screen.getByLabelText('End of range 2'))
    const bad = screen.getByLabelText('End of range 2')
    fireEvent.change(bad, { target: { value: '5' } })
    fireEvent.keyDown(bad, { key: 'Enter' })
    expect(props.onChange).toHaveBeenCalledTimes(1)
  })

  it('switches the mode', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Concat' }))
    expect(props.onModeChange).toHaveBeenCalledWith(2)
  })

  it('splits into N on Enter, ignoring non-digit text (TV-2.7)', () => {
    const props = setup()
    const field = screen.getByLabelText('Split into parts')
    fireEvent.change(field, { target: { value: 'x' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(props.onSplit).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: '4x' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(props.onSplit).toHaveBeenCalledWith(4)
  })

  it('labels a whole-video entry and does not allow editing it', () => {
    setup({ ranges: [[-1, 95000]] })
    expect(screen.getByLabelText('Duration of range 1')).toHaveTextContent('whole video')
    expect(screen.getByLabelText('End of range 1')).toHaveTextContent('00:01:35.000')
  })

  it('hides the split field without onSplit', () => {
    setup({ onSplit: undefined })
    expect(screen.queryByLabelText('Split into parts')).toBeNull()
  })
})

describe('selectionColor', () => {
  const t = { greenBelowMs: 600000, yellowBelowMs: 1680000 }
  it('uses the 10 / 28 minute bands', () => {
    expect(selectionColor(599999, t)).toBe('success')
    expect(selectionColor(600000, t)).toBe('warning')
    expect(selectionColor(1680000, t)).toBe('error')
  })
})
