/** Small DOM hooks of the crop and zoom dialogs. */
import { useCallback, useEffect, useRef, useState, type RefCallback } from 'react'
import type { Size } from '@shared/domain/geometry'

/** Measures an element with a ResizeObserver (`size` stays `null` where none exists, e.g. jsdom). */
export function useElementSize<T extends HTMLElement>(): {
  ref: RefCallback<T>
  size: Size | null
} {
  const [size, setSize] = useState<Size | null>(null)
  const observer = useRef<ResizeObserver | null>(null)
  const ref = useCallback<RefCallback<T>>((node) => {
    observer.current?.disconnect()
    observer.current = null
    if (node === null || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      setSize({ width: node.clientWidth, height: node.clientHeight })
    }
    measure()
    observer.current = new ResizeObserver(measure)
    observer.current.observe(node)
  }, [])
  useEffect(
    () => () => {
      observer.current?.disconnect()
    },
    []
  )
  return { ref, size }
}

export interface LoadedImage {
  image: HTMLImageElement | null
  error: boolean
}

/** Loads `url` into an `HTMLImageElement`; `null` url loads nothing. */
export function useLoadedImage(url: string | null): LoadedImage {
  const [state, setState] = useState<{ url: string | null } & LoadedImage>({
    url: null,
    image: null,
    error: false
  })
  useEffect(() => {
    if (url === null) return undefined
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (!cancelled) setState({ url, image: img, error: false })
    }
    img.onerror = () => {
      if (!cancelled) setState({ url, image: null, error: true })
    }
    img.src = url
    return () => {
      cancelled = true
    }
  }, [url])
  return state.url === url ? { image: state.image, error: state.error } : { image: null, error: false }
}
