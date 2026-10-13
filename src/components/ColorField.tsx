import { useId } from 'react'
import { formatColor, parseColor } from '../lib/color'

interface ColorFieldProps {
  label: string
  value: string | undefined
  onChange: (value: string, mergeKey?: string) => void
  allowAlpha?: boolean
}

export function ColorField({ label, value, onChange, allowAlpha = true }: ColorFieldProps) {
  const id = useId()
  const { hex, alpha } = parseColor(value)
  return (
    <div className="color-field">
      <label htmlFor={id}>{label}</label>
      <div className="color-row">
        <input
          id={id}
          type="color"
          value={hex}
          onChange={(event) => onChange(formatColor(event.target.value, alpha === 0 ? 1 : alpha), `color-${label}`)}
        />
        <input
          type="text"
          className="color-hex"
          aria-label={`${label} hex`}
          value={hex}
          maxLength={7}
          onChange={(event) => {
            if (/^#[0-9a-f]{6}$/i.test(event.target.value)) onChange(formatColor(event.target.value.toLowerCase(), alpha === 0 ? 1 : alpha), `color-${label}`)
          }}
        />
        {allowAlpha && (
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={alpha}
            aria-label={`${label} opacity`}
            title={`Opacity ${Math.round(alpha * 100)}%`}
            onChange={(event) => onChange(formatColor(hex, Number(event.target.value)), `alpha-${label}`)}
          />
        )}
      </div>
    </div>
  )
}
