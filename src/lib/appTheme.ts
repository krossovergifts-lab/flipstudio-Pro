/** App colour theme: follow Windows ("system"), or always light / dark. Stored per computer. */
export type AppTheme = 'system' | 'light' | 'dark'

const KEY = 'fs-app-theme'
const listeners = new Set<(theme: AppTheme) => void>()

export function loadAppTheme(): AppTheme {
  try {
    const value = localStorage.getItem(KEY)
    if (value === 'light' || value === 'dark' || value === 'system') return value
  } catch {
    // Storage unavailable: use the default.
  }
  return 'system'
}

export function applyAppTheme(theme: AppTheme = loadAppTheme()): void {
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', theme)
}

export function setAppTheme(theme: AppTheme): void {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Still applied for this session.
  }
  applyAppTheme(theme)
  listeners.forEach((listener) => listener(theme))
}

export function onAppThemeChange(listener: (theme: AppTheme) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const THEME_LABELS: Record<AppTheme, string> = { system: 'Match Windows', light: 'Light', dark: 'Dark' }
