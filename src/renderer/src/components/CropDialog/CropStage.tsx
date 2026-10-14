/**
 * The picture, its preview adjustments and the rubber band, drawn with react-konva. Pointer input
 * is captured on the wrapper `div` (pointer capture keeps a drag alive outside the picture) and
 * reported in DISPLAYED image pixels; the state machine lives in `selection.ts`.
 */
import { useMemo, useRef, type PointerEvent } from 'react'
import { Group, Image as KonvaImage, Layer, Rect, Stage } from 'react-konva'
import { displayedSize, type FloatRect, type Point } from '@shared/core/cropMath'
import type { Size } from '@shared/domain/geometry'
import { renderAdjusted, type AdjustParams } from './previewCanvas'

export interface CropStageProps {
  image: HTMLImageElement | null
  /** Source pixel size of the image (unrotated). */
  source: Size
  /** Preview rotation in degrees clockwise. */
  rotation: number
  adjust: AdjustParams
  /** View pixels per image pixel. */
  scale: number
  /** Selection in displayed image pixels. */
  selection: FloatRect | null
  onPress: (point: Point) => void
  onMove: (point: Point) => void
  onRelease: () => void
}

const HANDLE = 8

function usePreviewCanvas(
  image: HTMLImageElement | null,
  source: Size,
  scale: number,
  adjust: AdjustParams
): HTMLCanvasElement | null {
  const { bright, contrast } = adjust
  return useMemo(() => {
    if (image === null || scale <= 0) return null
    return renderAdjusted(image, source.width * scale, source.height * scale, { bright, contrast })
  }, [image, source.width, source.height, scale, bright, contrast])
}

function Overlay({ rect, scale, view }: { rect: FloatRect; scale: number; view: Size }) {
  const x = rect.x * scale
  const y = rect.y * scale
  const w = rect.w * scale
  const h = rect.h * scale
  const dim = { fill: 'rgba(0,0,0,0.45)', listening: false }
  const corners: Point[] = [
    { x, y },
    { x: x + w, y },
    { x, y: y + h },
    { x: x + w, y: y + h }
  ]
  return (
    <Layer listening={false}>
      <Rect x={0} y={0} width={view.width} height={y} {...dim} />
      <Rect x={0} y={y + h} width={view.width} height={view.height - y - h} {...dim} />
      <Rect x={0} y={y} width={x} height={h} {...dim} />
      <Rect x={x + w} y={y} width={view.width - x - w} height={h} {...dim} />
      <Rect x={x} y={y} width={w} height={h} stroke="#ffffff" strokeWidth={1} />
      <Rect x={x} y={y} width={w} height={h} stroke="#000000" strokeWidth={1} dash={[4, 4]} />
      {corners.map((c) => (
        <Rect
          key={`${c.x}-${c.y}`}
          x={c.x - HANDLE / 2}
          y={c.y - HANDLE / 2}
          width={HANDLE}
          height={HANDLE}
          fill="#ffffff"
          stroke="#000000"
          strokeWidth={1}
        />
      ))}
    </Layer>
  )
}

export default function CropStage(props: CropStageProps) {
  const { image, source, rotation, adjust, scale, selection, onPress, onMove, onRelease } = props
  const wrapper = useRef<HTMLDivElement>(null)
  const display = displayedSize(source, rotation)
  const view: Size = {
    width: Math.max(1, Math.round(display.width * scale)),
    height: Math.max(1, Math.round(display.height * scale))
  }
  const preview = usePreviewCanvas(image, source, scale, adjust)

  const toPoint = (event: PointerEvent<HTMLDivElement>): Point => {
    const box = wrapper.current?.getBoundingClientRect()
    return { x: (event.clientX - (box?.left ?? 0)) / scale, y: (event.clientY - (box?.top ?? 0)) / scale }
  }
  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    onPress(toPoint(event))
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.buttons === 1) onMove(toPoint(event))
  }

  return (
    <div
      ref={wrapper}
      data-testid="crop-stage"
      style={{ width: view.width, height: view.height, cursor: 'crosshair', touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onRelease}
      onPointerCancel={onRelease}
    >
      <Stage width={view.width} height={view.height}>
        <Layer listening={false}>
          <Rect x={0} y={0} width={view.width} height={view.height} fill="#000000" />
          {preview !== null && (
            <Group x={view.width / 2} y={view.height / 2} rotation={rotation}>
              <KonvaImage
                image={preview}
                x={-preview.width / 2}
                y={-preview.height / 2}
                width={preview.width}
                height={preview.height}
              />
            </Group>
          )}
        </Layer>
        {selection !== null && <Overlay rect={selection} scale={scale} view={view} />}
      </Stage>
    </div>
  )
}
