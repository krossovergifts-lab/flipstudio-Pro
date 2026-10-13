import { useId, useState } from 'react'

interface NumberFieldProps {
  label: string
  value: number
  onCommit: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  ariaLabel?: string
  suffix?: string
}

/**
 * Numeric input that keeps the user's in-progress text (empty, "-", "1.")
 * instead of snapping it to 0, and commits only finite numbers.
 */
export function NumberField({ label, value, onCommit, min, max, step, disabled, ariaLabel }: NumberFieldProps) {
  const id = useId()
  const [text, setText] = useState(() => formatNumber(value))
  const [focused, setFocused] = useState(false)
  // While focused, show what the user is typing; otherwise always show the project value.
  const display = focused ? text : formatNumber(value)

  return (
    <label htmlFor={id}>
      {label}
      <input
        id={id}
        type="number"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={display}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onFocus={() => {
          setText(formatNumber(value))
          setFocused(true)
        }}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          setText(event.target.value)
          const parsed = Number(event.target.value)
          if (event.target.value.trim() !== '' && Number.isFinite(parsed)) onCommit(parsed)
        }}
      />
    </label>
  )
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return String(Math.round(value * 1000) / 1000)
}
