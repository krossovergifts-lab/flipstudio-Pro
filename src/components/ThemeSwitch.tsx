import { useEffect, useState } from 'react'
import { THEME_LABELS, loadAppTheme, onAppThemeChange, setAppTheme, type AppTheme } from '../lib/appTheme'
import { Icon } from './Icon'

const ORDER: AppTheme[] = ['system', 'light', 'dark']
const ICONS = { system: 'monitor', light: 'sun', dark: 'moon' } as const

/** Light / dark / match-Windows switch. `compact` shows one button that cycles. */
export function ThemeSwitch({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<AppTheme>(loadAppTheme)
  useEffect(() => onAppThemeChange(setTheme), [])
  if (compact) {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]
    return (
      <button type="button" className="icon-button theme-cycle" aria-label={`App theme: ${THEME_LABELS[theme]}`} title={`Theme: ${THEME_LABELS[theme]} — click for ${THEME_LABELS[next]}`} onClick={() => setAppTheme(next)}>
        <Icon name={ICONS[theme]} />
      </button>
    )
  }
  return (
    <div className="theme-switch" role="radiogroup" aria-label="App theme">
      {ORDER.map((option) => (
        <button key={option} type="button" role="radio" aria-checked={theme === option} title={THEME_LABELS[option]} aria-label={THEME_LABELS[option]} onClick={() => setAppTheme(option)}>
          <Icon name={ICONS[option]} size={15} />
        </button>
      ))}
    </div>
  )
}
