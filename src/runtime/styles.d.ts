// Type declarations for the shared styling runtime (styles.js).

export type TextAlign = 'left' | 'center' | 'right' | 'justify'
export type VerticalAlign = 'top' | 'middle' | 'bottom'
export type ShadowKind = 'none' | 'soft' | 'medium' | 'strong' | 'glow' | 'inset'
export type TextEffect = 'none' | 'shadow' | 'hard' | 'glow' | 'outline' | 'emboss'
export type HotspotShape = 'rect' | 'rounded' | 'pill' | 'circle'
export type HotspotMarker = 'none' | 'plus' | 'info' | 'cart' | 'eye' | 'play' | 'star' | 'dot'
export type HotspotReveal = 'always' | 'hover' | 'never'
export type IdleEffect = 'none' | 'pulse' | 'glow' | 'shine' | 'bounce' | 'float' | 'wiggle' | 'blink' | 'ripple' | 'beacon' | 'heartbeat'
export type HoverEffect = 'none' | 'lift' | 'grow' | 'glow' | 'darken' | 'highlight' | 'shine' | 'underline'

export interface Gradient {
  from: string
  to: string
  angle: number
}

export interface ObjectStyle {
  fontFamily: string
  fontWeight: number
  italic: boolean
  underline: boolean
  uppercase: boolean
  textAlign: TextAlign
  verticalAlign: VerticalAlign
  color: string
  lineHeight: number
  letterSpacing: number
  background: string
  gradient: Gradient | null
  textGradient: Gradient | null
  borderColor: string
  borderWidth: number
  borderStyle: 'solid' | 'dashed' | 'dotted'
  radius: number
  padding: number
  shadow: ShadowKind
  textEffect: TextEffect
  effectColor: string
  shape?: HotspotShape
  marker?: HotspotMarker
  markerColor?: string
  markerBackground?: string
  reveal?: HotspotReveal
  showLabel?: boolean
}

export type LinkType = 'none' | 'url' | 'page' | 'email' | 'phone' | 'whatsapp' | 'popup'

export interface LinkAction {
  type: LinkType
  value?: string
  newTab?: boolean
  subject?: string
  message?: string
}

export type ResolvedAction =
  | { kind: 'href'; href: string; newTab: boolean }
  | { kind: 'page'; page: number }
  | { kind: 'popup' }
  | null

export interface StyledObject {
  type: string
  fontSize?: number
  style?: Partial<ObjectStyle>
  effect?: IdleEffect
  hoverEffect?: HoverEffect
  link?: LinkAction
  url?: string
  popup?: unknown
}

export const DEFAULT_STYLES: Record<'text' | 'button' | 'hotspot', ObjectStyle>
export const IDLE_EFFECTS: IdleEffect[]
export const HOVER_EFFECTS: HoverEffect[]
export const HOTSPOT_MARKERS: Record<HotspotMarker, string>
export function styleFor(overlay: StyledObject): ObjectStyle
export function skinStyle(overlay: StyledObject, page: { width: number; height: number }, fontStack?: string): Record<string, string>
export interface CropSettings { zoom: number; x: number; y: number }
export function frameStyle(overlay: StyledObject, page: { width: number; height: number }): Record<string, string>
export function cropStyle(overlay: { crop?: Partial<CropSettings> }): Record<string, string>
export function skinClassName(overlay: StyledObject): string
export function normalizeWebUrl(value: unknown): string
export function resolveAction(overlay: StyledObject): ResolvedAction
export interface VideoSource { kind: 'youtube' | 'vimeo' | 'file'; src: string; id?: string; thumb?: string }
export function videoSource(url: unknown, options?: { autoplay?: boolean; muted?: boolean; loop?: boolean; controls?: boolean }): VideoSource | null
