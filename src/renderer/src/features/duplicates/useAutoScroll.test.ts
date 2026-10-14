import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clampScroll, useAutoScroll } from './useAutoScroll'

describe('auto-scroll (checklist 26)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('clamps scrollTop - v into [0, max]', () => {
    expect(clampScroll(10, 5, 100)).toBe(5)
    expect(clampScroll(2, 5, 100)).toBe(0)
    expect(clampScroll(98, -5, 100)).toBe(100)
  })

  it('A adds 5, F subtracts 5 and every 100 ms tick scrolls by the speed', () => {
    let top = 500
    const el = {
      scrollHeight: 1000,
      clientHeight: 100,
      get scrollTop() {
        return top
      },
      set scrollTop(v: number) {
        top = v
      }
    } as unknown as HTMLElement
    const { result } = renderHook(() => useAutoScroll({ current: el }))
    act(() => result.current.slower())
    expect(result.current.speed).toBe(-5)
    act(() => result.current.toggle())
    act(() => void vi.advanceTimersByTime(300))
    expect(top).toBe(515)
    act(() => {
      result.current.faster()
      result.current.faster()
    })
    act(() => void vi.advanceTimersByTime(100))
    expect(top).toBe(510)
    act(() => result.current.toggle())
    act(() => void vi.advanceTimersByTime(500))
    expect(top).toBe(510)
  })
})
