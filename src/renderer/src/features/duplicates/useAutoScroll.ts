/** Table auto-scroll ("play", duplicates-thumbs.md §8.5): 100 ms timer, `v` unbounded, clamped scrollTop. */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

export const AUTO_SCROLL_INTERVAL_MS = 100
export const AUTO_SCROLL_STEP = 5

export function clampScroll(top: number, speed: number, max: number): number {
  return Math.min(Math.max(top - speed, 0), Math.max(max, 0))
}

export interface AutoScroll {
  playing: boolean
  speed: number
  toggle(): void
  /** `A`: speed + 5 (scrolls up). */
  faster(): void
  /** `F`: speed - 5 (from 0 scrolls down). */
  slower(): void
}

export function useAutoScroll(target: RefObject<HTMLElement | null>): AutoScroll {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(0)
  const speedRef = useRef(speed)
  speedRef.current = speed

  useEffect(() => {
    if (!playing) return undefined
    const timer = setInterval(() => {
      const el = target.current
      if (el === null) return
      el.scrollTop = clampScroll(el.scrollTop, speedRef.current, el.scrollHeight - el.clientHeight)
    }, AUTO_SCROLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [playing, target])

  const toggle = useCallback(() => setPlaying((p) => !p), [])
  const faster = useCallback(() => setSpeed((v) => v + AUTO_SCROLL_STEP), [])
  const slower = useCallback(() => setSpeed((v) => v - AUTO_SCROLL_STEP), [])
  return { playing, speed, toggle, faster, slower }
}
