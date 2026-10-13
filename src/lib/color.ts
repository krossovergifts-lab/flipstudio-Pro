/** Parses #rgb, #rrggbb, rgb() and rgba() into a hex colour plus alpha. */
export function parseColor(value: string | undefined): { hex: string; alpha: number } {
  const input = (value ?? '').trim().toLowerCase()
  if (!input || input === 'transparent') return { hex: '#ffffff', alpha: 0 }
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(input)
  if (short) return { hex: `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`, alpha: 1 }
  if (/^#[0-9a-f]{6}$/.test(input)) return { hex: input, alpha: 1 }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(input)
  if (rgb) {
    const hex = '#' + [rgb[1], rgb[2], rgb[3]].map((part) => Math.min(255, Number(part)).toString(16).padStart(2, '0')).join('')
    return { hex, alpha: rgb[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(rgb[4]))) }
  }
  return { hex: '#000000', alpha: 1 }
}

export function formatColor(hex: string, alpha: number): string {
  if (alpha >= 1) return hex
  if (alpha <= 0) return 'transparent'
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${Math.round(alpha * 100) / 100})`
}
