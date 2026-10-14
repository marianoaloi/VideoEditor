/**
 * Canvas of the ZoomViewer: draws the picture (nearest-neighbour when magnified) with the preview
 * adjustments, handles drag-to-pan and the wheel (plain wheel scrolls, Ctrl+wheel and the wheel
 * over the zoom label zoom). All geometry comes from `@shared/core/zoomMath`.
 */
import { useEffect, useMemo, useRef } from 'react'
import { clampPan, panForZoomAbout, wheelZoom, type Box, type Pan } from '@shared/core/zoomMath'
import { renderAdjusted, type AdjustParams } from '../CropDialog/previewCanvas'

/** Longest side of the adjusted offscreen copy; bigger pictures are drawn from a reduced copy. */
const MAX_SIDE = 8192

export interface ZoomCanvasProps {
  image: HTMLImageElement | null
  natural: Box
  viewport: Box
  scale: number
  pan: Pan
  rotation: number
  adjust: AdjustParams
  onView: (scale: number, pan: Pan) => void
}

function useAdjustedSource(image: HTMLImageElement | null, natural: Box, adjust: AdjustParams) {
  const { bright, contrast } = adjust
  return useMemo(() => {
    if (image === null) return null
    const reduce = Math.min(1, MAX_SIDE / Math.max(natural.width, natural.height, 1))
    const canvas = renderAdjusted(image, natural.width * reduce, natural.height * reduce, { bright, contrast })
    return canvas === null ? null : { canvas, reduce }
  }, [image, natural.width, natural.height, bright, contrast])
}

function draw(
  canvas: HTMLCanvasElement,
  source: { canvas: HTMLCanvasElement; reduce: number } | null,
  props: ZoomCanvasProps
): void {
  const ctx = canvas.getContext('2d')
  if (ctx === null) return
  const { natural, scale, pan, rotation, viewport } = props
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, viewport.width, viewport.height)
  if (source === null) return
  ctx.imageSmoothingEnabled = scale < 1
  ctx.translate(pan.x + (natural.width * scale) / 2, pan.y + (natural.height * scale) / 2)
  ctx.rotate((rotation * Math.PI) / 180)
  ctx.scale(scale / source.reduce, scale / source.reduce)
  ctx.drawImage(source.canvas, -source.canvas.width / 2, -source.canvas.height / 2)
}

export default function ZoomCanvas(props: ZoomCanvasProps) {
  const { image, natural, viewport, scale, pan, adjust, onView } = props
  const ref = useRef<HTMLCanvasElement>(null)
  const latest = useRef(props)
  latest.current = props
  const drag = useRef<{ x: number; y: number; pan: Pan } | null>(null)
  const source = useAdjustedSource(image, natural, adjust)

  useEffect(() => {
    if (ref.current !== null) draw(ref.current, source, props)
  })

  useEffect(() => {
    const node = ref.current
    if (node === null) return undefined
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const { scale: s, pan: p, natural: n, viewport: v, onView: view } = latest.current
      const box = node.getBoundingClientRect()
      const pointer = { x: event.clientX - box.left, y: event.clientY - box.top }
      if (event.ctrlKey) {
        const next = wheelZoom(s, event.deltaY)
        view(next, clampPan(panForZoomAbout(p, pointer, s, next), n, next, v))
      } else {
        view(s, clampPan({ x: p.x - event.deltaX, y: p.y - event.deltaY }, n, s, v))
      }
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <canvas
      ref={ref}
      width={Math.max(1, Math.round(viewport.width))}
      height={Math.max(1, Math.round(viewport.height))}
      aria-label="Zoomed picture"
      style={{ display: 'block', cursor: 'grab', touchAction: 'none' }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId)
        drag.current = { x: event.clientX, y: event.clientY, pan }
      }}
      onPointerMove={(event) => {
        const start = drag.current
        if (start === null) return
        const next = { x: start.pan.x + event.clientX - start.x, y: start.pan.y + event.clientY - start.y }
        onView(scale, clampPan(next, natural, scale, viewport))
      }}
      onPointerUp={() => {
        drag.current = null
      }}
      onPointerCancel={() => {
        drag.current = null
      }}
    />
  )
}
