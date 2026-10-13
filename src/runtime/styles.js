// FlipStudio Pro shared object styling: text, button and hotspot appearance,
// idle/hover effects, link actions. Used by the editor canvas, Preview and
// exported publications (inlined verbatim like engine.js), so an object looks
// and behaves the same everywhere.
//
// Rules: no imports, plain ES2020, top-level `function`/`const` only.
//
// Sizes stored in page units (the same units as x/y/width/height) and are
// converted to container-query width units (cqw) of the page, so styling
// scales exactly with the page at any zoom, in Preview and in exports.

export const DEFAULT_STYLES = {
  text: {
    fontFamily: 'inter',
    fontWeight: 700,
    italic: false,
    underline: false,
    uppercase: false,
    textAlign: 'left',
    verticalAlign: 'top',
    color: '#111827',
    lineHeight: 1.15,
    letterSpacing: 0,
    background: 'transparent',
    gradient: null,
    textGradient: null,
    borderColor: '#111827',
    borderWidth: 0,
    borderStyle: 'solid',
    radius: 0,
    padding: 0,
    shadow: 'none',
    textEffect: 'none',
    effectColor: '#000000',
  },
  button: {
    fontFamily: 'inter',
    fontWeight: 700,
    italic: false,
    underline: false,
    uppercase: false,
    textAlign: 'center',
    verticalAlign: 'middle',
    color: '#ffffff',
    lineHeight: 1.1,
    letterSpacing: 0,
    background: '#2563eb',
    gradient: null,
    textGradient: null,
    borderColor: '#1d4ed8',
    borderWidth: 0,
    borderStyle: 'solid',
    radius: 14,
    padding: 10,
    shadow: 'soft',
    textEffect: 'none',
    effectColor: '#000000',
  },
  hotspot: {
    fontFamily: 'inter',
    fontWeight: 700,
    italic: false,
    underline: false,
    uppercase: false,
    textAlign: 'center',
    verticalAlign: 'middle',
    color: '#ffffff',
    lineHeight: 1.1,
    letterSpacing: 0,
    background: 'rgba(251,191,36,0.22)',
    gradient: null,
    textGradient: null,
    borderColor: 'rgba(245,158,11,0.9)',
    borderWidth: 3,
    borderStyle: 'dashed',
    radius: 8,
    padding: 0,
    shadow: 'none',
    textEffect: 'none',
    effectColor: '#f59e0b',
    shape: 'rounded',
    marker: 'none',
    markerColor: '#ffffff',
    markerBackground: '#ef4444',
    reveal: 'always',
    showLabel: false,
  },
}

export const IDLE_EFFECTS = ['none', 'pulse', 'glow', 'shine', 'bounce', 'float', 'wiggle', 'blink', 'ripple', 'beacon', 'heartbeat']
export const HOVER_EFFECTS = ['none', 'lift', 'grow', 'glow', 'darken', 'highlight', 'shine', 'underline']

export function styleFor(overlay) {
  const defaults = DEFAULT_STYLES[overlay.type] || DEFAULT_STYLES.text
  return Object.assign({}, defaults, overlay.style || {})
}

function unit(value, page) {
  return Math.round(((Number(value) || 0) / page.width) * 100 * 10000) / 10000 + 'cqw'
}

function shadowCss(kind, color, page) {
  const c = color || 'rgba(15,23,42,0.35)'
  if (kind === 'soft') return '0 ' + unit(4, page) + ' ' + unit(12, page) + ' rgba(15,23,42,0.22)'
  if (kind === 'medium') return '0 ' + unit(8, page) + ' ' + unit(24, page) + ' rgba(15,23,42,0.32)'
  if (kind === 'strong') return '0 ' + unit(14, page) + ' ' + unit(40, page) + ' rgba(15,23,42,0.45)'
  if (kind === 'glow') return '0 0 ' + unit(24, page) + ' ' + c
  if (kind === 'inset') return 'inset 0 0 0 ' + unit(2, page) + ' ' + c
  return 'none'
}

function textEffectCss(kind, color, page) {
  const c = color || '#000000'
  if (kind === 'shadow') return '0 ' + unit(2, page) + ' ' + unit(6, page) + ' rgba(0,0,0,0.45)'
  if (kind === 'hard') return unit(3, page) + ' ' + unit(3, page) + ' 0 ' + c
  if (kind === 'glow') return '0 0 ' + unit(10, page) + ' ' + c + ', 0 0 ' + unit(22, page) + ' ' + c
  if (kind === 'outline') {
    const w = unit(1.5, page)
    return [w + ' 0 0 ' + c, '-' + w + ' 0 0 ' + c, '0 ' + w + ' 0 ' + c, '0 -' + w + ' 0 ' + c, w + ' ' + w + ' 0 ' + c, '-' + w + ' -' + w + ' 0 ' + c, w + ' -' + w + ' 0 ' + c, '-' + w + ' ' + w + ' 0 ' + c].join(', ')
  }
  if (kind === 'emboss') return '0 ' + unit(1, page) + ' 0 rgba(255,255,255,0.6), 0 -' + unit(1, page) + ' 0 rgba(0,0,0,0.35)'
  return 'none'
}

function gradientCss(gradient) {
  if (!gradient || !gradient.from || !gradient.to) return ''
  return 'linear-gradient(' + (Number(gradient.angle) || 135) + 'deg, ' + gradient.from + ', ' + gradient.to + ')'
}

/**
 * CSS for the inner "skin" element of a text, button or hotspot object.
 * `fontStack` is the resolved CSS font-family list for style.fontFamily.
 */
export function skinStyle(overlay, page, fontStack) {
  const s = styleFor(overlay)
  const css = {
    fontFamily: fontStack || "'Segoe UI', system-ui, sans-serif",
    fontSize: round((Number(overlay.fontSize) || 32) / page.width * 100) + 'cqw',
    fontWeight: String(s.fontWeight || 400),
    fontStyle: s.italic ? 'italic' : 'normal',
    textDecoration: s.underline ? 'underline' : 'none',
    textTransform: s.uppercase ? 'uppercase' : 'none',
    textAlign: s.textAlign,
    justifyContent: s.verticalAlign === 'middle' ? 'center' : s.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start',
    color: s.color,
    lineHeight: String(s.lineHeight || 1.2),
    letterSpacing: (Number(s.letterSpacing) || 0) + 'em',
    padding: unit(s.padding, page),
    borderWidth: unit(s.borderWidth, page),
    borderStyle: Number(s.borderWidth) > 0 ? s.borderStyle : 'none',
    borderColor: s.borderColor,
    borderRadius: s.shape === 'circle' ? '50%' : s.shape === 'pill' ? '999px' : s.shape === 'rect' ? '0' : unit(s.radius, page),
    boxShadow: shadowCss(s.shadow, s.effectColor, page),
    textShadow: textEffectCss(s.textEffect, s.effectColor, page),
    background: gradientCss(s.gradient) || s.background || 'transparent',
    '--fs-effect-color': s.effectColor || '#3b82f6',
    '--fs-marker-color': s.markerColor || '#ffffff',
    '--fs-marker-bg': s.markerBackground || '#ef4444',
  }
  if (s.textGradient && s.textGradient.from && s.textGradient.to) {
    css['--fs-text-gradient'] = gradientCss(s.textGradient)
  }
  return css
}

export function skinClassName(overlay) {
  const s = styleFor(overlay)
  const classes = ['fs-skin']
  if (overlay.effect && overlay.effect !== 'none') classes.push('fs-fx-' + overlay.effect)
  if (overlay.hoverEffect && overlay.hoverEffect !== 'none') classes.push('fs-hover-' + overlay.hoverEffect)
  if (s.textGradient && s.textGradient.from && s.textGradient.to) classes.push('fs-text-gradient')
  if (overlay.type === 'hotspot' && s.reveal === 'hover') classes.push('fs-reveal-hover')
  if (overlay.type === 'hotspot' && s.reveal === 'never') classes.push('fs-reveal-never')
  return classes.join(' ')
}

/**
 * Frame for image and slideshow objects: rounded corners (or a circle/oval),
 * border and shadow. Applied to the object box, which clips its content.
 */
export function frameStyle(overlay, page) {
  const s = overlay.style || {}
  const shape = s.shape || (Number(s.radius) > 0 ? 'rounded' : 'rect')
  const width = Number(s.borderWidth) || 0
  return {
    borderRadius: shape === 'circle' ? '50%' : shape === 'rect' ? '0' : unit(s.radius, page),
    border: width > 0 ? unit(width, page) + ' ' + (s.borderStyle || 'solid') + ' ' + (s.borderColor || '#ffffff') : 'none',
    boxShadow: shadowCss(s.shadow || 'none', s.effectColor, page),
  }
}

/**
 * Crop inside the frame: `zoom` (1 = fit the frame) and the focal point x/y in
 * percent. Implemented by enlarging the image box rather than a transform, so
 * it never conflicts with slideshow transition animations.
 */
export function cropStyle(overlay) {
  const crop = overlay.crop || {}
  const zoom = Math.min(5, Math.max(1, Number(crop.zoom) || 1))
  const x = Math.min(100, Math.max(0, crop.x === undefined ? 50 : Number(crop.x)))
  const y = Math.min(100, Math.max(0, crop.y === undefined ? 50 : Number(crop.y)))
  const size = round(zoom * 100) + '%'
  return {
    position: 'absolute',
    width: size,
    height: size,
    left: round((1 - zoom) * x) + '%',
    top: round((1 - zoom) * y) + '%',
    objectPosition: round(x) + '% ' + round(y) + '%',
  }
}

/** Markers (small icons) shown on hotspots. Text glyphs keep exports dependency-free. */
export const HOTSPOT_MARKERS = { none: '', plus: '+', info: 'i', cart: '\u{1F6D2}', eye: '\u{1F441}', play: '▶', star: '★', dot: '' }

function round(value) {
  return Math.round(value * 10000) / 10000
}

/** Turns "www.site.com" into "https://www.site.com"; rejects unsafe schemes. */
export function normalizeWebUrl(value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return ''
  return 'https://' + trimmed.replace(/^\/+/, '')
}

/**
 * Resolves an object's click action.
 * Returns { kind: 'href', href, newTab } | { kind: 'page', page } | { kind: 'popup' } | null.
 * Legacy objects with only `url` behave as a web link.
 */
export function resolveAction(overlay) {
  const link = overlay.link || (overlay.url ? { type: 'url', value: overlay.url, newTab: true } : null)
  if (!link || !link.type || link.type === 'none') return null
  const value = String(link.value || '').trim()
  if (link.type === 'url') {
    const href = normalizeWebUrl(value)
    return href ? { kind: 'href', href, newTab: link.newTab !== false } : null
  }
  if (link.type === 'email') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null
    const subject = link.subject ? '?subject=' + encodeURIComponent(link.subject) : ''
    return { kind: 'href', href: 'mailto:' + value + subject, newTab: false }
  }
  if (link.type === 'phone') {
    const digits = value.replace(/[^\d+]/g, '')
    return digits.replace(/\D/g, '').length >= 5 ? { kind: 'href', href: 'tel:' + digits, newTab: false } : null
  }
  if (link.type === 'whatsapp') {
    const digits = value.replace(/\D/g, '')
    if (digits.length < 7) return null
    const text = link.message ? '?text=' + encodeURIComponent(link.message) : ''
    return { kind: 'href', href: 'https://wa.me/' + digits + text, newTab: true }
  }
  if (link.type === 'page') {
    const page = Math.floor(Number(value))
    return page >= 1 ? { kind: 'page', page: page - 1 } : null
  }
  if (link.type === 'popup') return overlay.popup ? { kind: 'popup' } : null
  return null
}
