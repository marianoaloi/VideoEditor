/** Brightness / contrast / rotation sliders of the CropDialog. Double-click resets one slider. */
import Box from '@mui/material/Box'
import Slider from '@mui/material/Slider'
import Typography from '@mui/material/Typography'
import {
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  CONTRAST_MAX,
  CONTRAST_MIN,
  NEUTRAL_BRIGHTNESS,
  NEUTRAL_CONTRAST,
  NEUTRAL_ROTATION,
  ROTATION_MAX,
  ROTATION_MIN,
  contrastLabel,
  type SliderValues
} from '@shared/core/adjustments'

interface Props {
  values: SliderValues
  /** 90 for video hosts (quarter turns only), 1 for images (any angle; PageUp/Down = 45). */
  rotationStep: number
  onChange: (next: SliderValues) => void
}

interface RowProps {
  label: string
  value: number
  display: string
  min: number
  max: number
  step: number
  neutral: number
  shiftStep?: number
  marks?: boolean
  onValue: (value: number) => void
}

function SliderRow(props: RowProps) {
  const { label, value, display, min, max, step, neutral, shiftStep, marks, onValue } = props
  return (
    <Box sx={{ flex: 1, minWidth: 180, px: 1 }}>
      <Typography variant="caption" id={`crop-${label}`}>
        {label}: {display}
      </Typography>
      <Slider
        size="small"
        aria-labelledby={`crop-${label}`}
        value={value}
        min={min}
        max={max}
        step={step}
        marks={marks}
        {...(shiftStep === undefined ? {} : { shiftStep })}
        onChange={(_, v) => onValue(Array.isArray(v) ? (v[0] ?? neutral) : v)}
        onDoubleClick={() => onValue(neutral)}
      />
    </Box>
  )
}

export default function CropSliders({ values, rotationStep, onChange }: Props) {
  const set = (patch: Partial<SliderValues>): void => onChange({ ...values, ...patch })
  return (
    <Box sx={{ display: 'flex', gap: 2, px: 2, flexWrap: 'wrap' }}>
      <SliderRow
        label="Brightness"
        value={values.brightness}
        display={String(values.brightness)}
        min={BRIGHTNESS_MIN}
        max={BRIGHTNESS_MAX}
        step={5}
        neutral={NEUTRAL_BRIGHTNESS}
        onValue={(brightness) => set({ brightness })}
      />
      <SliderRow
        label="Contrast"
        value={values.contrast}
        display={contrastLabel(values.contrast)}
        min={CONTRAST_MIN}
        max={CONTRAST_MAX}
        step={5}
        neutral={NEUTRAL_CONTRAST}
        onValue={(contrast) => set({ contrast })}
      />
      <SliderRow
        label="Rotation"
        value={values.rotation}
        display={`${values.rotation}°`}
        min={ROTATION_MIN}
        max={ROTATION_MAX}
        step={rotationStep}
        neutral={NEUTRAL_ROTATION}
        marks={rotationStep >= 45}
        {...(rotationStep < 45 ? { shiftStep: 45 } : {})}
        onValue={(rotation) => set({ rotation })}
      />
    </Box>
  )
}
