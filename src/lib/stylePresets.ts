import type { HoverEffect, IdleEffect, ObjectStyle } from '../runtime/styles.js'

export interface StylePreset {
  id: string
  label: string
  style: Partial<ObjectStyle>
  fontSize?: number
  effect?: IdleEffect
  hoverEffect?: HoverEffect
}

const GOLD = { from: '#b8860b', to: '#f5d77a', angle: 120 }

export const TEXT_PRESETS: StylePreset[] = [
  { id: 'headline', label: 'Editorial headline', fontSize: 64, style: { fontFamily: 'playfair-display', fontWeight: 700, color: '#111827', lineHeight: 1.05, textAlign: 'left' } },
  { id: 'modern', label: 'Modern heading', fontSize: 44, style: { fontFamily: 'montserrat', fontWeight: 700, uppercase: true, letterSpacing: 0.08, color: '#0f172a' } },
  { id: 'subheading', label: 'Subheading', fontSize: 30, style: { fontFamily: 'poppins', fontWeight: 400, color: '#334155', lineHeight: 1.25 } },
  { id: 'body', label: 'Body copy', fontSize: 20, style: { fontFamily: 'inter', fontWeight: 400, color: '#1f2937', lineHeight: 1.5 } },
  { id: 'caption', label: 'Caption', fontSize: 15, style: { fontFamily: 'inter', fontWeight: 400, color: '#64748b', italic: true, lineHeight: 1.4 } },
  { id: 'luxury', label: 'Luxury serif', fontSize: 52, style: { fontFamily: 'cormorant-garamond', fontWeight: 700, letterSpacing: 0.04, textGradient: GOLD, textAlign: 'center' } },
  { id: 'script', label: 'Elegant script', fontSize: 56, style: { fontFamily: 'great-vibes', fontWeight: 400, color: '#7c2d12', textAlign: 'center' } },
  { id: 'price', label: 'Price tag', fontSize: 48, style: { fontFamily: 'bebas-neue', fontWeight: 400, color: '#dc2626', letterSpacing: 0.02 } },
  { id: 'badge', label: 'Sale badge', fontSize: 22, style: { fontFamily: 'montserrat', fontWeight: 700, uppercase: true, letterSpacing: 0.1, color: '#ffffff', background: '#dc2626', radius: 999, padding: 10, textAlign: 'center', verticalAlign: 'middle' } },
  { id: 'label-dark', label: 'Label on dark', fontSize: 22, style: { fontFamily: 'inter', fontWeight: 700, color: '#ffffff', background: 'rgba(15,23,42,0.78)', radius: 10, padding: 12, verticalAlign: 'middle' } },
  { id: 'on-photo', label: 'White on photo', fontSize: 48, style: { fontFamily: 'poppins', fontWeight: 700, color: '#ffffff', textEffect: 'shadow' } },
  { id: 'neon', label: 'Neon glow', fontSize: 44, style: { fontFamily: 'oswald', fontWeight: 700, color: '#ffffff', textEffect: 'glow', effectColor: '#22d3ee', uppercase: true } },
  { id: 'outline', label: 'Outline poster', fontSize: 60, style: { fontFamily: 'anton', fontWeight: 400, color: '#fde047', textEffect: 'outline', effectColor: '#111827', uppercase: true } },
  { id: 'arabic', label: 'Arabic heading', fontSize: 44, style: { fontFamily: 'cairo', fontWeight: 700, color: '#111827', textAlign: 'right' } },
]

export const BUTTON_PRESETS: StylePreset[] = [
  { id: 'primary', label: 'Primary', hoverEffect: 'lift', style: { background: '#2563eb', color: '#ffffff', radius: 12, shadow: 'soft', fontFamily: 'inter', fontWeight: 700 } },
  { id: 'dark', label: 'Solid dark', hoverEffect: 'lift', style: { background: '#0f172a', color: '#ffffff', radius: 8, shadow: 'medium', fontFamily: 'montserrat', fontWeight: 700, uppercase: true, letterSpacing: 0.06 } },
  { id: 'outline', label: 'Outline', hoverEffect: 'highlight', style: { background: 'transparent', color: '#0f172a', borderWidth: 3, borderColor: '#0f172a', radius: 10, shadow: 'none', fontFamily: 'inter', fontWeight: 700 } },
  { id: 'pill', label: 'Gradient pill', hoverEffect: 'glow', style: { gradient: { from: '#6366f1', to: '#ec4899', angle: 120 }, color: '#ffffff', radius: 999, shadow: 'medium', effectColor: '#a855f7', fontFamily: 'poppins', fontWeight: 700 } },
  { id: 'gold', label: 'Gold luxury', hoverEffect: 'shine', style: { gradient: { from: '#a16207', to: '#facc15', angle: 120 }, color: '#1c1917', radius: 4, shadow: 'medium', fontFamily: 'cormorant-garamond', fontWeight: 700, uppercase: true, letterSpacing: 0.12 } },
  { id: 'whatsapp', label: 'WhatsApp', hoverEffect: 'lift', effect: 'pulse', style: { background: '#25d366', color: '#ffffff', radius: 999, shadow: 'soft', fontFamily: 'inter', fontWeight: 700 } },
  { id: 'shop', label: 'Shop now', hoverEffect: 'grow', effect: 'shine', style: { background: '#dc2626', color: '#ffffff', radius: 6, shadow: 'medium', fontFamily: 'montserrat', fontWeight: 700, uppercase: true, letterSpacing: 0.08 } },
  { id: 'ghost', label: 'Ghost on photo', hoverEffect: 'highlight', style: { background: 'rgba(255,255,255,0.14)', color: '#ffffff', borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)', radius: 999, shadow: 'none', fontFamily: 'inter', fontWeight: 700 } },
  { id: 'beige', label: 'Minimal beige', hoverEffect: 'darken', style: { background: '#e7dccb', color: '#3f3a33', radius: 2, shadow: 'none', fontFamily: 'dm-sans', fontWeight: 700, uppercase: true, letterSpacing: 0.14 } },
  { id: 'link', label: 'Text link', hoverEffect: 'underline', style: { background: 'transparent', color: '#2563eb', radius: 0, padding: 0, shadow: 'none', fontFamily: 'inter', fontWeight: 700 } },
]

export const HOTSPOT_PRESETS: StylePreset[] = [
  { id: 'subtle', label: 'Subtle highlight', hoverEffect: 'highlight', style: { background: 'rgba(255,255,255,0.12)', borderWidth: 2, borderStyle: 'solid', borderColor: 'rgba(255,255,255,0.7)', shape: 'rounded', radius: 10, reveal: 'always', marker: 'none' } },
  { id: 'invisible', label: 'Invisible click area', style: { background: 'transparent', borderWidth: 0, reveal: 'never', marker: 'none' } },
  { id: 'hover-reveal', label: 'Show on hover', hoverEffect: 'glow', style: { background: 'rgba(59,130,246,0.18)', borderWidth: 2, borderStyle: 'solid', borderColor: '#3b82f6', effectColor: '#3b82f6', shape: 'rounded', radius: 10, reveal: 'hover', marker: 'none' } },
  { id: 'beacon', label: 'Pulsing beacon', effect: 'beacon', style: { background: 'transparent', borderWidth: 0, reveal: 'always', marker: 'dot', markerBackground: '#ef4444' } },
  { id: 'plus', label: 'Plus marker', effect: 'beacon', hoverEffect: 'grow', style: { background: 'transparent', borderWidth: 0, reveal: 'always', marker: 'plus', markerBackground: '#ffffff', markerColor: '#0f172a' } },
  { id: 'info', label: 'Info marker', effect: 'pulse', style: { background: 'transparent', borderWidth: 0, reveal: 'always', marker: 'info', markerBackground: '#2563eb', markerColor: '#ffffff' } },
  { id: 'shop', label: 'Shop marker', effect: 'bounce', style: { background: 'transparent', borderWidth: 0, reveal: 'always', marker: 'cart', markerBackground: '#f59e0b', markerColor: '#ffffff' } },
  { id: 'ripple', label: 'Ripple ring', effect: 'ripple', style: { background: 'rgba(255,255,255,0.08)', borderWidth: 3, borderStyle: 'solid', borderColor: '#ffffff', effectColor: '#ffffff', shape: 'circle', reveal: 'always', marker: 'none' } },
  { id: 'glow', label: 'Glowing area', effect: 'glow', style: { background: 'rgba(250,204,21,0.12)', borderWidth: 2, borderStyle: 'solid', borderColor: '#facc15', effectColor: '#facc15', shape: 'rounded', radius: 12, reveal: 'always', marker: 'none' } },
  { id: 'dashed', label: 'Dashed outline', hoverEffect: 'highlight', style: { background: 'rgba(251,191,36,0.15)', borderWidth: 3, borderStyle: 'dashed', borderColor: '#f59e0b', shape: 'rounded', radius: 8, reveal: 'always', marker: 'none' } },
]

export const EFFECT_LABELS: Record<IdleEffect, string> = {
  none: 'None',
  pulse: 'Pulse',
  glow: 'Glow',
  shine: 'Shine sweep',
  bounce: 'Bounce',
  float: 'Float',
  wiggle: 'Wiggle',
  blink: 'Blink',
  ripple: 'Ripple ring',
  beacon: 'Beacon (marker)',
  heartbeat: 'Heartbeat',
}

export const HOVER_LABELS: Record<HoverEffect, string> = {
  none: 'None',
  lift: 'Lift',
  grow: 'Grow',
  glow: 'Glow',
  darken: 'Darken',
  highlight: 'Highlight',
  shine: 'Shine sweep',
  underline: 'Underline',
}
