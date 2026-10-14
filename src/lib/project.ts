import JSZip from 'jszip'
import engineSource from '../runtime/engine.js?raw'
import readerSource from '../runtime/reader.js?raw'
import publicationCss from '../runtime/publication.css?raw'
import readerCss from '../runtime/reader.css?raw'
import pageFlipSource from 'page-flip/dist/js/page-flip.browser.js?raw'
import {
  animationValue,
  sampleFrame,
  timelineDuration,
  type AnimationEasing,
  type AnimationFrame,
  type AnimationType,
  type EngineAnimation,
} from '../runtime/engine.js'
import stylesSource from '../runtime/styles.js?raw'
import themeSource from '../runtime/theme.js?raw'
import type { PublicationData, PublicationOverlay } from '../runtime/reader.js'
import type { HoverEffect, IdleEffect, LinkAction, ObjectStyle } from '../runtime/styles.js'
import { allFonts, findFont, fontFaceCss, type FontDefinition, type ProjectFont } from './fonts'

export type { AnimationEasing, AnimationFrame, AnimationType, HoverEffect, IdleEffect, LinkAction, ObjectStyle, ProjectFont }

/** Product information card opened by a button/hotspot/text/image with a "pop-up" action. */
export interface PopupContent {
  title: string
  description: string
  price?: string
  assetId?: string
  buttonLabel?: string
  link?: LinkAction
}

export const PROJECT_VERSION = 3

export type OverlayType = 'image' | 'text' | 'button' | 'hotspot' | 'slideshow' | 'video' | 'audio'
export type ImageFit = 'cover' | 'contain' | 'fill'
export type SlideTransition = 'fade' | 'slide' | 'instant'
export type SlideIndicators = 'dots' | 'thumbnails' | 'none'

/** A managed binary asset. Stored once per project and referenced by ID. */
export interface ProjectAsset {
  id: string
  name: string
  mimeType: string
  dataUrl: string
  byteSize: number
  width?: number
  height?: number
}

export interface SlideImage {
  id: string
  /** Managed asset reference (preferred). */
  assetId?: string
  /** Legacy/remote source, used only when no asset is set. */
  src?: string
  alt?: string
  /** A video slide: an uploaded video file (assetId) or a YouTube / Vimeo / .mp4 link. */
  kind?: 'image' | 'video'
  videoUrl?: string
}

export interface ProjectAnimation extends EngineAnimation {
  delay: number
  alternate: boolean
}

export interface OverlayObject {
  id: string
  type: OverlayType
  label: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  visible: boolean
  locked?: boolean
  fontSize?: number
  /** Legacy (v1) per-object animation; migrated into project.animations. */
  animation?: {
    start: number
    duration: number
    easing: string
    entrance: string
    exit: string
  }
  assetId?: string
  src?: string
  /** Legacy (v3.0) web link; migrated into `link`. */
  url?: string
  /** Visual styling for text, button and hotspot objects (merged over type defaults). */
  style?: Partial<ObjectStyle>
  /** Looping attention effect (pulse, glow, ripple…). */
  effect?: IdleEffect
  hoverEffect?: HoverEffect
  /** What happens on click in Preview and exports. */
  link?: LinkAction
  tooltip?: string
  popup?: PopupContent
  /** Crop of an image/slideshow inside its frame: zoom ≥ 1 and focal point in percent. */
  crop?: { zoom: number; x: number; y: number }
  fit?: ImageFit
  slides?: SlideImage[]
  autoplay?: boolean
  looping?: boolean
  /** Seconds each slide stays on screen. */
  duration?: number
  transition?: SlideTransition
  /** Transition length in seconds. */
  transitionDuration?: number
  showControls?: boolean
  showIndicators?: SlideIndicators
  pauseOnHover?: boolean
  startIndex?: number
  /** Video objects: YouTube / Vimeo / .mp4 link (used when no file is uploaded), sound off. */
  videoUrl?: string
  muted?: boolean
}

export interface PageDefinition {
  id: string
  name: string
  width: number
  height: number
  overlays: OverlayObject[]
  pdfPageNumber?: number
  previewUrl?: string
  /** Small JPEG (about 240 px wide) for page lists and the reader's thumbnails. */
  thumbUrl?: string
  /** Section bookmark: shown as a coloured tab on the book edge and in Contents. */
  bookmark?: PageBookmark
  /** Text kept from the PDF (page units, top-left origin) for selection, copy and search. */
  text?: PageTextItem[]
}

export interface PageBookmark {
  label: string
  /** Tab colour (hex). */
  color?: string
  /** Tab text colour (hex). */
  textColor?: string
}

/** One run of PDF text: string, box in page units, optional angle (deg) and generic family. */
export interface PageTextItem {
  s: string
  x: number
  y: number
  w: number
  h: number
  a?: number
  f?: 'serif' | 'monospace'
  eol?: boolean
}

/** Reader options a publisher picks per book (PubHTML5-style "Book info" / "Theme"). */
export type FlipPreset = 'smooth' | 'magazine' | 'hardcover' | 'quick'
export type FlipSoundKind = 'none' | 'paper' | 'soft' | 'crisp' | 'custom'

/** Reader look and feel a publisher picks per book (theme editor). */
export interface ReaderSettings {
  /** Show the text-select / search tools when the book has a text layer. */
  textTools?: boolean
  backgroundMode?: 'solid' | 'gradient' | 'image'
  /** Main background colour (and gradient start). */
  background?: string
  backgroundTo?: string
  backgroundAngle?: number
  backgroundImageAssetId?: string
  /** Toolbar background, text/icon colour, button colour and accent. */
  toolbar?: string
  toolbarText?: string
  button?: string
  accent?: string
  /** Page-turn feel. */
  flip?: FlipPreset
  /** Page-turn duration in ms (overrides the preset). */
  flipSpeed?: number
  cover?: 'soft' | 'hard'
  pageShadow?: boolean
  bookShadow?: boolean
  sound?: FlipSoundKind
  soundAssetId?: string
  thumbnails?: boolean
  logoAssetId?: string
  logoLink?: string
  /** Bookmark tabs on the book edge, and their hover effect. */
  tabs?: boolean
  tabEffect?: 'slide' | 'grow' | 'glow' | 'none'
  /** Toolbar features. */
  contents?: boolean
  readerBookmarks?: boolean
  share?: boolean
  sideArrows?: boolean
  showTitle?: boolean
  autoFlipButton?: boolean
  autoFlip?: { startOnOpen?: boolean; interval?: number; startDelay?: number; loop?: boolean }
  /** A PDF readers can download (stored as a project asset). */
  downloadAssetId?: string
  downloadName?: string
  /** Centre a lone cover / last page instead of leaving it on one side of the spread. */
  centerSinglePages?: boolean
  /** Google Analytics 4 measurement ID (G-XXXXXXX) for published / exported copies. */
  analyticsId?: string
  /** Ask visitors before counting them (cookie notice + Google consent mode). */
  analyticsConsent?: boolean
  /** Search engines: title shown in Google (defaults to the publication title), language, and hide from search. */
  seoTitle?: string
  language?: string
  noIndex?: boolean
  /** Readers' address bar follows the page (…/#page=12), so links can open on a page. */
  pageLinks?: boolean
}

export interface ProjectState {
  id: string
  title: string
  version: number
  pages: PageDefinition[]
  animations: ProjectAnimation[]
  assets: Record<string, ProjectAsset>
  /** Fonts imported into this project (bytes stored in assets). */
  fonts: ProjectFont[]
  description?: string
  category?: string
  keywords?: string
  reader?: ReaderSettings
  lastSavedAt?: string
}

type ProjectInput = Partial<Omit<ProjectState, 'pages' | 'animations' | 'assets' | 'fonts'>> & {
  fonts?: ProjectFont[]
  pages?: Array<Partial<Omit<PageDefinition, 'overlays'>> & { overlays?: Array<Partial<OverlayObject>> }>
  animations?: Array<Partial<ProjectAnimation>>
  assets?: Record<string, ProjectAsset>
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit hash. Used to derive stable, content-based asset IDs. */
export function hashString(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function mimeTypeOfDataUrl(dataUrl: string): string {
  const match = /^data:([^;,]+)/i.exec(dataUrl)
  return match ? match[1].toLowerCase() : 'application/octet-stream'
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',')
  if (!dataUrl.startsWith('data:') || comma < 0) throw new Error('Asset data is not a valid data URL.')
  const header = dataUrl.slice(0, comma)
  const payload = dataUrl.slice(comma + 1)
  if (/;base64/i.test(header)) {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  }
  return new TextEncoder().encode(decodeURIComponent(payload))
}

function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return 0
  const payload = dataUrl.length - comma - 1
  return /;base64/i.test(dataUrl.slice(0, comma)) ? Math.floor((payload * 3) / 4) : payload
}

/** Builds an asset whose ID is derived from its content, so identical files are stored once. */
export function createAsset(input: { name: string; dataUrl: string; width?: number; height?: number }): ProjectAsset {
  return {
    id: `asset-${hashString(input.dataUrl)}-${input.dataUrl.length.toString(36)}`,
    name: input.name,
    mimeType: mimeTypeOfDataUrl(input.dataUrl),
    dataUrl: input.dataUrl,
    byteSize: estimateDataUrlBytes(input.dataUrl),
    width: input.width,
    height: input.height,
  }
}

/** Adds assets, reusing existing entries with identical content. Returns the new map and the IDs in input order. */
export function mergeAssets(
  existing: Record<string, ProjectAsset>,
  incoming: ProjectAsset[],
): { assets: Record<string, ProjectAsset>; ids: string[] } {
  const assets = { ...existing }
  const ids = incoming.map((asset) => {
    let id = asset.id
    let suffix = 1
    while (assets[id] && assets[id].dataUrl !== asset.dataUrl) {
      suffix += 1
      id = `${asset.id}-${suffix}`
    }
    if (!assets[id]) assets[id] = { ...asset, id }
    return id
  })
  return { assets, ids }
}

export function resolveSource(project: Pick<ProjectState, 'assets'>, ref: { assetId?: string; src?: string }): string {
  if (ref.assetId) return project.assets[ref.assetId]?.dataUrl ?? ''
  return ref.src ?? ''
}

/** IDs of assets that objects reference but the project does not contain. */
export function findMissingAssets(project: ProjectState): string[] {
  return [...referencedAssetIds(project)].filter((id) => !project.assets[id])
}

export function referencedAssetIds(project: Pick<ProjectState, 'pages' | 'fonts'> & { reader?: ReaderSettings }): Set<string> {
  const used = new Set<string>()
  for (const id of [project.reader?.backgroundImageAssetId, project.reader?.logoAssetId, project.reader?.soundAssetId, project.reader?.downloadAssetId]) if (id) used.add(id)
  for (const page of project.pages) {
    for (const overlay of page.overlays) {
      if (overlay.assetId) used.add(overlay.assetId)
      if (overlay.popup?.assetId) used.add(overlay.popup.assetId)
      for (const slide of overlay.slides ?? []) if (slide.assetId) used.add(slide.assetId)
    }
  }
  for (const font of project.fonts ?? []) used.add(font.assetId)
  return used
}

/** Drops assets no object references (history snapshots keep their own maps, so this is safe at save time). */
export function pruneUnusedAssets(project: ProjectState): ProjectState {
  const used = referencedAssetIds(project)
  const assets: Record<string, ProjectAsset> = {}
  for (const id of Object.keys(project.assets)) if (used.has(id)) assets[id] = project.assets[id]
  return { ...project, assets }
}

// ---------------------------------------------------------------------------
// Project creation, normalization and migration
// ---------------------------------------------------------------------------

const ANIMATION_TYPES: AnimationType[] = ['fade-in', 'fade-out', 'move-x', 'move-y', 'scale', 'rotation']
const EASING_VALUES: AnimationEasing[] = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'ease-out-back']

function normalizeEasing(easing: unknown): AnimationEasing {
  return EASING_VALUES.includes(easing as AnimationEasing) ? (easing as AnimationEasing) : 'ease-out'
}

function finite(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function normalizeOverlay(overlay: Partial<OverlayObject>, fallbackId: string): OverlayObject {
  const type = (overlay.type ?? 'image') as OverlayType
  const normalized: OverlayObject = {
    id: overlay.id ?? fallbackId,
    type,
    label: overlay.label ?? 'Untitled object',
    x: finite(overlay.x, 0),
    y: finite(overlay.y, 0),
    width: Math.max(1, finite(overlay.width, 200)),
    height: Math.max(1, finite(overlay.height, 120)),
    rotation: finite(overlay.rotation, 0),
    opacity: Math.min(1, Math.max(0, finite(overlay.opacity, 1))),
    visible: overlay.visible ?? true,
    locked: overlay.locked ?? false,
    fontSize: finite(overlay.fontSize, type === 'button' ? 24 : 32),
    animation: overlay.animation,
    assetId: overlay.assetId,
    src: overlay.src,
    fit: overlay.fit ?? 'cover',
  }
  if (overlay.style && typeof overlay.style === 'object') normalized.style = { ...overlay.style }
  if (overlay.effect && overlay.effect !== 'none') normalized.effect = overlay.effect
  if (overlay.hoverEffect && overlay.hoverEffect !== 'none') normalized.hoverEffect = overlay.hoverEffect
  if (overlay.tooltip) normalized.tooltip = String(overlay.tooltip)
  if (overlay.crop && typeof overlay.crop === 'object') {
    normalized.crop = {
      zoom: Math.min(5, Math.max(1, finite(overlay.crop.zoom, 1))),
      x: Math.min(100, Math.max(0, finite(overlay.crop.x, 50))),
      y: Math.min(100, Math.max(0, finite(overlay.crop.y, 50))),
    }
  }
  if (overlay.popup && typeof overlay.popup === 'object') normalized.popup = { ...overlay.popup, title: overlay.popup.title ?? '', description: overlay.popup.description ?? '' }
  if (overlay.link && typeof overlay.link === 'object' && overlay.link.type) normalized.link = { ...overlay.link }
  else if (overlay.url) normalized.link = { type: 'url', value: overlay.url, newTab: true }
  if (type === 'video') {
    if (typeof overlay.videoUrl === 'string' && overlay.videoUrl) normalized.videoUrl = overlay.videoUrl
    normalized.autoplay = overlay.autoplay ?? false
    normalized.looping = overlay.looping ?? false
    normalized.muted = overlay.muted ?? false
    normalized.showControls = overlay.showControls ?? true
  }
  if (type === 'slideshow' || overlay.slides?.length) {
    normalized.slides = (overlay.slides ?? []).map((slide, index) => ({
      id: slide.id ?? `${normalized.id}-slide-${index + 1}`,
      assetId: slide.assetId,
      src: slide.src,
      alt: slide.alt,
      ...(slide.kind === 'video' ? { kind: 'video' as const, videoUrl: typeof slide.videoUrl === 'string' ? slide.videoUrl : undefined } : {}),
    }))
    normalized.autoplay = overlay.autoplay ?? true
    normalized.looping = overlay.looping ?? true
    normalized.duration = Math.max(0.5, finite(overlay.duration, 3))
    normalized.transition = overlay.transition ?? 'fade'
    normalized.transitionDuration = Math.min(5, Math.max(0, finite(overlay.transitionDuration, 0.6)))
    normalized.showControls = overlay.showControls ?? true
    normalized.showIndicators = overlay.showIndicators ?? 'dots'
    normalized.pauseOnHover = overlay.pauseOnHover ?? false
    normalized.startIndex = Math.max(0, Math.floor(finite(overlay.startIndex, 0)))
  }
  return normalized
}

function normalizeAnimation(animation: Partial<ProjectAnimation>, index: number): ProjectAnimation {
  return {
    id: animation.id ?? `animation-${index + 1}`,
    targetId: animation.targetId ?? '',
    type: ANIMATION_TYPES.includes(animation.type as AnimationType) ? (animation.type as AnimationType) : 'fade-in',
    start: Math.max(0, finite(animation.start, 0)),
    delay: Math.max(0, finite(animation.delay, 0)),
    duration: Math.max(0.01, finite(animation.duration, 1)),
    easing: normalizeEasing(animation.easing),
    from: finite(animation.from, 0),
    to: finite(animation.to, 1),
    loop: Boolean(animation.loop),
    alternate: Boolean(animation.alternate),
  }
}

/** v2 stored absolute x/y/rotation/opacity values; v3 stores values relative to the object. */
function toRelativeAnimation(animation: ProjectAnimation, overlay: OverlayObject | undefined): ProjectAnimation {
  if (!overlay) return animation
  const convert = (value: number): number => {
    if (animation.type === 'move-x') return value - overlay.x
    if (animation.type === 'move-y') return value - overlay.y
    if (animation.type === 'rotation') return value - overlay.rotation
    if (animation.type === 'fade-in' || animation.type === 'fade-out') {
      return overlay.opacity > 0 ? Math.min(1, Math.max(0, value / overlay.opacity)) : value
    }
    return value
  }
  return { ...animation, from: convert(animation.from), to: convert(animation.to) }
}

function validTextItem(item: PageTextItem): boolean {
  return !!item && typeof item.s === 'string' && [item.x, item.y, item.w, item.h].every((value) => Number.isFinite(value))
}

export function createProject(input: ProjectInput = {}): ProjectState {
  const version = finite(input.version, 1)
  let assets: Record<string, ProjectAsset> = { ...(input.assets ?? {}) }

  const pages: PageDefinition[] = (input.pages ?? []).map((page, pageIndex) => ({
    id: page.id ?? `page-${pageIndex + 1}`,
    name: page.name ?? `Page ${pageIndex + 1}`,
    width: Math.max(1, finite(page.width, 1000)),
    height: Math.max(1, finite(page.height, 1400)),
    pdfPageNumber: page.pdfPageNumber,
    previewUrl: page.previewUrl,
    ...(page.thumbUrl ? { thumbUrl: page.thumbUrl } : {}),
    ...(page.bookmark && typeof page.bookmark.label === 'string' && page.bookmark.label.trim() ? { bookmark: { ...page.bookmark, label: page.bookmark.label.trim() } } : {}),
    ...(Array.isArray(page.text) && page.text.length ? { text: page.text.filter(validTextItem) } : {}),
    overlays: (page.overlays ?? []).map((overlay, overlayIndex) =>
      normalizeOverlay(overlay, `overlay-${pageIndex + 1}-${overlayIndex + 1}`),
    ),
  }))

  if (pages.length === 0) {
    pages.push({ id: 'page-1', name: 'Page 1', width: 1000, height: 1400, overlays: [] })
  }

  // Move inline image data into the managed asset store (one copy per unique file).
  for (const page of pages) {
    for (const overlay of page.overlays) {
      if (!overlay.assetId && overlay.src?.startsWith('data:') && (overlay.type === 'image' || overlay.type === 'video' || overlay.type === 'audio')) {
        const merged = mergeAssets(assets, [createAsset({ name: overlay.label, dataUrl: overlay.src })])
        assets = merged.assets
        overlay.assetId = merged.ids[0]
        delete overlay.src
      }
      for (const slide of overlay.slides ?? []) {
        if (!slide.assetId && slide.src?.startsWith('data:')) {
          const merged = mergeAssets(assets, [createAsset({ name: slide.alt ?? slide.id, dataUrl: slide.src })])
          assets = merged.assets
          slide.assetId = merged.ids[0]
          delete slide.src
        }
      }
    }
  }

  let animations = (input.animations ?? []).map(normalizeAnimation)

  if (version < 2 && !input.animations) {
    for (const page of pages) {
      for (const overlay of page.overlays) {
        const legacy = overlay.animation
        if (!legacy) continue
        if (legacy.entrance !== 'fade' || legacy.exit !== 'fade' || legacy.start !== 0 || legacy.duration !== 1) {
          animations.push({
            id: `migrated-${overlay.id}`,
            targetId: overlay.id,
            type: legacy.entrance === 'fade' ? 'fade-in' : 'move-y',
            start: Math.max(0, legacy.start),
            delay: 0,
            duration: Math.max(0.01, legacy.duration),
            easing: normalizeEasing(legacy.easing),
            from: legacy.entrance === 'fade' ? 0 : overlay.y + 40,
            to: legacy.entrance === 'fade' ? overlay.opacity : overlay.y,
            loop: false,
            alternate: false,
          })
        }
      }
    }
  }
  for (const page of pages) for (const overlay of page.overlays) delete overlay.animation

  if (version < 3) {
    const overlays = new Map(pages.flatMap((page) => page.overlays.map((overlay) => [overlay.id, overlay] as const)))
    animations = animations.map((animation) => toRelativeAnimation(animation, overlays.get(animation.targetId)))
  }

  return {
    id: input.id ?? 'project-1',
    title: input.title ?? 'Untitled project',
    version: PROJECT_VERSION,
    pages,
    animations,
    assets,
    fonts: (input.fonts ?? []).filter((font) => font && font.assetId && font.family).map((font) => ({ ...font, weight: finite(font.weight, 400) })),
    description: input.description,
    category: input.category,
    keywords: input.keywords,
    reader: input.reader ? { ...input.reader } : undefined,
    lastSavedAt: input.lastSavedAt ?? new Date().toISOString(),
  }
}

export function serializeProject(project: ProjectState): string {
  const pruned = pruneUnusedAssets(project)
  return JSON.stringify({ ...pruned, version: PROJECT_VERSION, lastSavedAt: new Date().toISOString() }, null, 2)
}

export function validateProject(project: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!project || typeof project !== 'object') {
    return { valid: false, errors: ['Project data not found.'] }
  }

  const data = project as Partial<ProjectState>
  if (typeof data.version === 'number' && data.version > PROJECT_VERSION) {
    errors.push(`This project was saved by a newer FlipStudio Pro (format ${data.version}); this version reads up to format ${PROJECT_VERSION}.`)
  }
  if (!Array.isArray(data.pages)) {
    errors.push('Project pages are missing.')
  }
  if (data.animations !== undefined && !Array.isArray(data.animations)) {
    errors.push('Project animations are not a list.')
  }
  if (data.assets !== undefined && (typeof data.assets !== 'object' || data.assets === null || Array.isArray(data.assets))) {
    errors.push('Project assets are not valid.')
  }

  data.pages?.forEach((page, index) => {
    if (!page || typeof page !== 'object') {
      errors.push(`Page ${index + 1} is not a valid object.`)
      return
    }

    if (!Array.isArray(page.overlays)) {
      errors.push(`Page ${page.name ?? index + 1} is missing overlay data.`)
    }
  })

  return { valid: errors.length === 0, errors }
}

// ---------------------------------------------------------------------------
// Animation helpers (thin wrappers over the shared engine)
// ---------------------------------------------------------------------------

export function getAnimationValue(animation: ProjectAnimation, timelineTime: number): number {
  return animationValue(animation, timelineTime)
}

export function getTimelineDuration(animations: EngineAnimation[]): number {
  return timelineDuration(animations)
}

export function getAnimationFrame(animations: EngineAnimation[], targetId: string, time: number): AnimationFrame {
  return sampleFrame(animations, targetId, time)
}

export interface AnimationTrackPreset {
  type: AnimationType
  from: number
  to: number
  easing: AnimationEasing
  loop?: boolean
  alternate?: boolean
  /** Fraction of the preset duration this track lasts (default 1). */
  span?: number
}

export interface AnimationPreset {
  label: string
  group: 'Entrance' | 'Exit' | 'Emphasis'
  duration: number
  tracks: AnimationTrackPreset[]
}

/** Animation presets. Multi-track presets add several synchronised animations at once. Values are relative to the object. */
export const ANIMATION_PRESETS: Record<string, AnimationPreset> = {
  'fade-in': { label: 'Fade in', group: 'Entrance', duration: 0.8, tracks: [{ type: 'fade-in', from: 0, to: 1, easing: 'ease-out' }] },
  'pop-in': { label: 'Pop in', group: 'Entrance', duration: 0.6, tracks: [{ type: 'fade-in', from: 0, to: 1, easing: 'ease-out', span: 0.5 }, { type: 'scale', from: 0.5, to: 1, easing: 'ease-out-back' }] },
  'rise-in': { label: 'Rise in', group: 'Entrance', duration: 0.8, tracks: [{ type: 'fade-in', from: 0, to: 1, easing: 'ease-out' }, { type: 'move-y', from: 80, to: 0, easing: 'ease-out' }] },
  'drop-in': { label: 'Drop in', group: 'Entrance', duration: 0.8, tracks: [{ type: 'fade-in', from: 0, to: 1, easing: 'ease-out', span: 0.4 }, { type: 'move-y', from: -160, to: 0, easing: 'ease-out-back' }] },
  'slide-left': { label: 'Slide in from left', group: 'Entrance', duration: 0.9, tracks: [{ type: 'fade-in', from: 0, to: 1, easing: 'ease-out', span: 0.5 }, { type: 'move-x', from: -300, to: 0, easing: 'ease-out' }] },
  'slide-right': { label: 'Slide in from right', group: 'Entrance', duration: 0.9, tracks: [{ type: 'fade-in', from: 0, to: 1, easing: 'ease-out', span: 0.5 }, { type: 'move-x', from: 300, to: 0, easing: 'ease-out' }] },
  'slide-top': { label: 'Slide in from top', group: 'Entrance', duration: 0.9, tracks: [{ type: 'fade-in', from: 0, to: 1, easing: 'ease-out', span: 0.5 }, { type: 'move-y', from: -300, to: 0, easing: 'ease-out' }] },
  'slide-bottom': { label: 'Slide in from bottom', group: 'Entrance', duration: 0.9, tracks: [{ type: 'fade-in', from: 0, to: 1, easing: 'ease-out', span: 0.5 }, { type: 'move-y', from: 300, to: 0, easing: 'ease-out' }] },
  'zoom-in': { label: 'Zoom in', group: 'Entrance', duration: 0.8, tracks: [{ type: 'fade-in', from: 0, to: 1, easing: 'ease-out', span: 0.5 }, { type: 'scale', from: 0.4, to: 1, easing: 'ease-out' }] },
  'swing-in': { label: 'Swing in', group: 'Entrance', duration: 0.9, tracks: [{ type: 'fade-in', from: 0, to: 1, easing: 'ease-out', span: 0.5 }, { type: 'rotation', from: -20, to: 0, easing: 'ease-out-back' }] },
  'spin-in': { label: 'Spin in', group: 'Entrance', duration: 1, tracks: [{ type: 'fade-in', from: 0, to: 1, easing: 'ease-out', span: 0.5 }, { type: 'rotation', from: -360, to: 0, easing: 'ease-out' }, { type: 'scale', from: 0.3, to: 1, easing: 'ease-out' }] },
  'fade-out': { label: 'Fade out', group: 'Exit', duration: 0.8, tracks: [{ type: 'fade-out', from: 1, to: 0, easing: 'ease-in' }] },
  'zoom-out': { label: 'Zoom out', group: 'Exit', duration: 0.6, tracks: [{ type: 'scale', from: 1, to: 0, easing: 'ease-in' }, { type: 'fade-out', from: 1, to: 0, easing: 'ease-in' }] },
  'slide-out-right': { label: 'Slide out to right', group: 'Exit', duration: 0.8, tracks: [{ type: 'move-x', from: 0, to: 300, easing: 'ease-in' }, { type: 'fade-out', from: 1, to: 0, easing: 'ease-in' }] },
  pulse: { label: 'Pulse', group: 'Emphasis', duration: 0.8, tracks: [{ type: 'scale', from: 1, to: 1.08, easing: 'ease-in-out', loop: true, alternate: true }] },
  breathe: { label: 'Breathe (slow)', group: 'Emphasis', duration: 2, tracks: [{ type: 'scale', from: 1, to: 1.04, easing: 'ease-in-out', loop: true, alternate: true }] },
  hover: { label: 'Float up and down', group: 'Emphasis', duration: 1.6, tracks: [{ type: 'move-y', from: 0, to: -14, easing: 'ease-in-out', loop: true, alternate: true }] },
  rock: { label: 'Rock', group: 'Emphasis', duration: 0.7, tracks: [{ type: 'rotation', from: -4, to: 4, easing: 'ease-in-out', loop: true, alternate: true }] },
  flash: { label: 'Flash', group: 'Emphasis', duration: 0.6, tracks: [{ type: 'fade-out', from: 1, to: 0.3, easing: 'linear', loop: true, alternate: true }] },
  spin: { label: 'Spin continuously', group: 'Emphasis', duration: 3, tracks: [{ type: 'rotation', from: 0, to: 360, easing: 'linear', loop: true }] },
}

/** Default from/to values when an animation's type is changed by hand. */
export const TYPE_DEFAULTS: Record<AnimationType, { from: number; to: number }> = {
  'fade-in': { from: 0, to: 1 },
  'fade-out': { from: 1, to: 0 },
  'move-x': { from: -300, to: 0 },
  'move-y': { from: 300, to: 0 },
  scale: { from: 0.4, to: 1 },
  rotation: { from: -360, to: 0 },
}

// ---------------------------------------------------------------------------
// Slideshow helpers
// ---------------------------------------------------------------------------

export function getSlideshowStateForIndex(
  overlay: Partial<OverlayObject>,
  index: number,
): { currentIndex: number; totalSlides: number; activeImage: string } {
  const slides = overlay.slides ?? []
  if (!slides.length) {
    return { currentIndex: 0, totalSlides: 0, activeImage: '' }
  }

  const boundedIndex = ((index % slides.length) + slides.length) % slides.length
  return {
    currentIndex: boundedIndex,
    totalSlides: slides.length,
    activeImage: slides[boundedIndex]?.assetId ?? slides[boundedIndex]?.src ?? '',
  }
}

// ---------------------------------------------------------------------------
// Publication (Preview + export)
// ---------------------------------------------------------------------------

/** Converts the editable project into reader data. `assetUrl` decides how assets are addressed. */
/** Every font available to a project: its imported fonts, then bundled and system fonts. */
export function projectFonts(project: Pick<ProjectState, 'fonts' | 'assets'>): FontDefinition[] {
  return allFonts(project.fonts ?? [], (assetId) => project.assets[assetId]?.dataUrl ?? '')
}

const STYLED_TYPES = new Set(['text', 'button', 'hotspot'])

/** Fonts actually used by visible objects (only these are embedded in exports). */
export function usedFonts(project: ProjectState): FontDefinition[] {
  const fonts = projectFonts(project)
  const used = new Map<string, FontDefinition>()
  for (const page of project.pages) {
    for (const overlay of page.overlays) {
      if (!overlay.visible || !STYLED_TYPES.has(overlay.type)) continue
      const font = findFont(overlay.style?.fontFamily ?? 'inter', fonts)
      used.set(font.id, font)
    }
  }
  return [...used.values()]
}

/** Reader settings as the runtime needs them: asset references become URLs. */
function readerData(reader: ReaderSettings | undefined, assetUrl: (assetId: string) => string): PublicationData['reader'] {
  if (!reader) return undefined
  const { backgroundImageAssetId, logoAssetId, soundAssetId, downloadAssetId, ...rest } = reader
  return {
    ...rest,
    downloadUrl: downloadAssetId ? assetUrl(downloadAssetId) || undefined : undefined,
    backgroundImage: backgroundImageAssetId ? assetUrl(backgroundImageAssetId) || undefined : undefined,
    logo: logoAssetId ? assetUrl(logoAssetId) || undefined : undefined,
    soundUrl: soundAssetId ? assetUrl(soundAssetId) || undefined : undefined,
  }
}

export function buildPublicationData(
  project: ProjectState,
  assetUrl: (asset: ProjectAsset) => string = (asset) => asset.dataUrl,
  pageUrl: (page: PageDefinition) => string | null = (page) => page.previewUrl ?? null,
  thumbUrl: (page: PageDefinition) => string | null = (page) => page.thumbUrl ?? null,
): PublicationData {
  const url = (ref: { assetId?: string; src?: string }): string => {
    if (ref.assetId) {
      const asset = project.assets[ref.assetId]
      return asset ? assetUrl(asset) : ''
    }
    return ref.src ?? ''
  }
  const fonts = projectFonts(project)
  return {
    id: project.id,
    title: project.title,
    reader: readerData(project.reader, (assetId) => url({ assetId })),
    animations: project.animations.map((animation) => ({ ...animation })),
    pages: project.pages.map((page) => ({
      id: page.id,
      name: page.name,
      width: page.width,
      height: page.height,
      background: pageUrl(page),
      thumb: thumbUrl(page) ?? undefined,
      bookmark: page.bookmark,
      text: page.text,
      overlays: page.overlays.filter((overlay) => overlay.visible).map((overlay): PublicationOverlay => ({
        id: overlay.id,
        type: overlay.type,
        label: overlay.label,
        x: overlay.x,
        y: overlay.y,
        width: overlay.width,
        height: overlay.height,
        rotation: overlay.rotation,
        opacity: overlay.opacity,
        visible: overlay.visible,
        fontSize: overlay.fontSize,
        src: overlay.type === 'slideshow' ? undefined : url(overlay),
        url: overlay.url,
        link: overlay.link,
        style: overlay.style,
        fontStack: STYLED_TYPES.has(overlay.type) ? findFont(overlay.style?.fontFamily ?? 'inter', fonts).stack : undefined,
        effect: overlay.effect,
        hoverEffect: overlay.hoverEffect,
        tooltip: overlay.tooltip,
        popup: overlay.popup
          ? {
              title: overlay.popup.title,
              description: overlay.popup.description,
              price: overlay.popup.price,
              image: overlay.popup.assetId ? url({ assetId: overlay.popup.assetId }) : '',
              buttonLabel: overlay.popup.buttonLabel,
              link: overlay.popup.link,
            }
          : undefined,
        fit: overlay.fit,
        crop: overlay.crop,
        slides: overlay.slides?.map((slide) => ({ id: slide.id, src: slide.kind === 'video' && !slide.assetId ? slide.videoUrl ?? '' : url(slide), alt: slide.alt, kind: slide.kind === 'video' ? 'video' : undefined })),
        videoUrl: overlay.type === 'video' && !overlay.assetId ? overlay.videoUrl : undefined,
        muted: overlay.type === 'video' ? overlay.muted : undefined,
        autoplay: overlay.autoplay,
        looping: overlay.looping,
        duration: overlay.duration,
        transition: overlay.transition,
        transitionDuration: overlay.transitionDuration,
        showControls: overlay.showControls,
        showIndicators: overlay.showIndicators,
        pauseOnHover: overlay.pauseOnHover,
        startIndex: overlay.startIndex,
      })),
    })),
  }
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)

/** Makes source text safe to place inside an inline <script>. */
function inlineScript(source: string): string {
  return source.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')
}

/** Turns an ES module from src/runtime into plain script text. */
function moduleToScript(source: string): string {
  return source.replace(/^import\s.*$/gm, '').replace(/^export\s+/gm, '')
}

export const RUNTIME_SCRIPT = moduleToScript(engineSource) + '\n' + moduleToScript(stylesSource) + '\n' + moduleToScript(themeSource) + '\n' + moduleToScript(readerSource)

const PAGE_FLIP_NOTICE = 'StPageFlip (page-flip) 2.0.7 - Copyright (c) 2020 Nodlik - MIT License'

/** Extra <head> metadata for publications hosted online (search engines, WhatsApp/Facebook/LinkedIn link previews). */
export interface PublicationMeta {
  description?: string
  keywords?: string
  /** Absolute URL of the publication page. */
  url?: string
  /** Absolute URL of the share image (1200×630 JPEG). */
  image?: string
  siteName?: string
  /** Last update (ISO date) for search engines. */
  modified?: string
}

const GA_ID = /^G-[A-Z0-9]{4,16}$/i

/** Google Analytics 4 tag. Page views are sent by the reader (one per page or spread), so the tag does not send its own. */
export function analyticsTag(reader: PublicationData['reader']): string {
  const id = String(reader?.analyticsId ?? '').trim().toUpperCase()
  if (!GA_ID.test(id)) return ''
  const consent = reader?.analyticsConsent
    ? `var fsGranted=false;try{fsGranted=localStorage.getItem('fs-consent')==='granted'}catch(e){}gtag('consent','default',{analytics_storage:fsGranted?'granted':'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});`
    : ''
  return `    <script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}${consent}gtag('js',new Date());gtag('config','${id}',{send_page_view:false});</script>
`
}

/** Plain text of one page (PDF text plus text objects), for search engines and screen readers. */
export function pagePlainText(page: PublicationData['pages'][number]): string {
  let text = ''
  for (const item of page.text ?? []) text += item.s + (item.eol ? '\n' : /\s$/.test(item.s) ? '' : ' ')
  return text.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim()
}

/**
 * Hidden-from-view but crawlable copy of the publication: title, description, every
 * page's text, product pop-ups and links. Search engines index the catalogue's words
 * and follow its product links; screen readers get the same content.
 */
export function seoContent(data: PublicationData, meta?: PublicationMeta): string {
  const parts: string[] = []
  parts.push(`<h1>${escapeHtml(data.reader?.seoTitle || data.title)}</h1>`)
  if (meta?.description) parts.push(`<p>${escapeHtml(meta.description)}</p>`)
  data.pages.forEach((page, index) => {
    const lines: string[] = []
    const heading = page.bookmark?.label ? `${page.bookmark.label} — page ${index + 1}` : `Page ${index + 1}`
    const text = pagePlainText(page).slice(0, 6000)
    if (text) lines.push(`<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`)
    for (const overlay of page.overlays) {
      if ((overlay.type === 'text' || overlay.type === 'button') && overlay.label) lines.push(`<p>${escapeHtml(overlay.label)}</p>`)
      if (overlay.popup?.title) lines.push(`<h3>${escapeHtml(overlay.popup.title)}</h3>${overlay.popup.price ? `<p>${escapeHtml(overlay.popup.price)}</p>` : ''}${overlay.popup.description ? `<p>${escapeHtml(overlay.popup.description)}</p>` : ''}`)
      const link = overlay.link?.type === 'url' ? String(overlay.link.value ?? '') : ''
      if (/^https?:\/\//i.test(link)) lines.push(`<a href="${escapeHtml(link)}">${escapeHtml(overlay.label || link)}</a>`)
      if (overlay.type === 'image' && overlay.label && !/\.(png|jpe?g|webp|gif|svg)$/i.test(overlay.label)) lines.push(`<p>${escapeHtml(overlay.label)}</p>`)
    }
    if (lines.length) parts.push(`<section id="seo-page-${index + 1}"><h2>${escapeHtml(heading)}</h2>${lines.join('')}</section>`)
  })
  return `    <div class="fs-seo">\n      ${parts.join('\n      ')}\n    </div>\n`
}

function structuredData(data: PublicationData, meta: PublicationMeta): string {
  const json: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Book',
    name: data.reader?.seoTitle || data.title,
    bookFormat: 'https://schema.org/EBook',
    numberOfPages: data.pages.length,
    inLanguage: data.reader?.language || 'en',
  }
  if (meta.description) json.description = meta.description
  if (meta.keywords) json.keywords = meta.keywords
  if (meta.url) json.url = meta.url
  if (meta.image) json.image = meta.image
  if (meta.modified) json.dateModified = meta.modified
  if (meta.siteName) json.publisher = { '@type': 'Organization', name: meta.siteName }
  const sections = data.pages.map((page, index) => (page.bookmark?.label ? { '@type': 'Chapter', name: page.bookmark.label, pageStart: index + 1, ...(meta.url ? { url: `${meta.url}#page=${index + 1}` } : {}) } : null)).filter(Boolean)
  if (sections.length) json.hasPart = sections
  return `    <script type="application/ld+json">${JSON.stringify(json).replace(/</g, '\\u003c')}</script>\n`
}

function metaTags(data: PublicationData, meta?: PublicationMeta): string {
  const tags: string[] = []
  if (data.reader?.noIndex) tags.push('    <meta name="robots" content="noindex, nofollow" />')
  if (!meta) return tags.length ? tags.join('\n') + '\n' : ''
  const add = (attr: 'name' | 'property', key: string, value?: string) => {
    if (value) tags.push(`    <meta ${attr}="${key}" content="${escapeHtml(value)}" />`)
  }
  add('name', 'description', meta.description)
  add('name', 'keywords', meta.keywords)
  add('property', 'og:type', 'book')
  add('property', 'og:title', data.reader?.seoTitle || data.title)
  add('property', 'og:description', meta.description)
  add('property', 'og:url', meta.url)
  add('property', 'og:site_name', meta.siteName)
  add('property', 'og:image', meta.image)
  if (meta.image) {
    add('property', 'og:image:width', '1200')
    add('property', 'og:image:height', '630')
    add('property', 'og:image:alt', data.title)
  }
  add('name', 'twitter:card', meta.image ? 'summary_large_image' : 'summary')
  add('name', 'twitter:title', data.reader?.seoTitle || data.title)
  add('name', 'twitter:description', meta.description)
  add('name', 'twitter:image', meta.image)
  if (meta.url) tags.push(`    <link rel="canonical" href="${escapeHtml(meta.url)}" />`)
  if (data.reader?.language) add('property', 'og:locale', data.reader.language.replace('-', '_'))
  return tags.join('\n') + '\n' + (data.reader?.noIndex ? '' : structuredData(data, meta))
}

export function buildPublicationHtml(data: PublicationData, fontCss = '', meta?: PublicationMeta): string {
  const background = /^#[0-9a-f]{3,8}$/i.test(data.reader?.background ?? '') ? data.reader!.background! : '#0b1220'
  const json = JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029')
  return `<!DOCTYPE html>
<html lang="${escapeHtml(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(data.reader?.language ?? '') ? data.reader!.language! : 'en')}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="generator" content="FlipStudio Pro" />
    <meta name="theme-color" content="${background}" />
    <title>${escapeHtml(data.reader?.seoTitle || data.title)}</title>
${metaTags(data, meta)}${analyticsTag(data.reader)}    <style>
      html, body { margin: 0; height: 100%; background: ${background}; }
      #publication { height: 100vh; height: 100dvh; }
      .fs-seo { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: normal; border: 0; }
${publicationCss}
${readerCss}
    </style>
    <style id="fs-fonts">
${fontCss}
    </style>
  </head>
  <body>
    <div id="publication" role="main" aria-label="${escapeHtml(data.title)}"></div>
${seoContent(data, meta)}    <noscript><p style="color:#fff;padding:16px">This publication needs JavaScript to display its pages.</p></noscript>
    <script type="application/json" id="fs-data">${json}</script>
    <script>/* ${PAGE_FLIP_NOTICE} */
${inlineScript(pageFlipSource)}</script>
    <script>
(function () {
  'use strict';
${inlineScript(RUNTIME_SCRIPT)}
  var data = JSON.parse(document.getElementById('fs-data').textContent);
  var PageFlip = window.St && window.St.PageFlip ? window.St.PageFlip : null;
  window.flipstudioPublication = mountPublication(document.getElementById('publication'), data, { PageFlip: PageFlip, showTimeline: false, standalone: true });
})();
    </script>
  </body>
</html>`
}

/** Standalone HTML with every asset embedded as a data URL. */
export function buildExportHtml(project: ProjectState): string {
  return buildPublicationHtml(buildPublicationData(project))
}

export interface ExportOptions {
  /** Loads a bundled font file. Defaults to fetch(); overridable in tests. */
  loadFont?: (url: string) => Promise<Uint8Array>
  /** Called for each non-fatal problem (for example a font that could not be embedded). */
  onWarning?: (message: string) => void
}

async function defaultFontLoader(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

/**
 * Builds @font-face CSS for the fonts a project uses. `place` decides where each
 * font file goes: embedded as a data URL, or written into the ZIP.
 */
async function buildFontCss(
  project: ProjectState,
  options: ExportOptions,
  place: (bytes: Uint8Array, name: string, mime: string) => string,
): Promise<string> {
  const load = options.loadFont ?? defaultFontLoader
  const fonts = usedFonts(project)
  const urls = new Map<string, string>()
  for (const font of fonts) {
    for (const face of font.faces) {
      const key = face.url
      if (urls.has(key)) continue
      try {
        let bytes: Uint8Array
        let mime = 'font/woff2'
        if (face.url.startsWith('data:')) {
          bytes = dataUrlToBytes(face.url)
          mime = mimeTypeOfDataUrl(face.url)
        } else {
          bytes = await load(face.url)
        }
        const extension = mime.split('/')[1]?.replace('x-font-', '') || 'woff2'
        const name = `${font.id.replace(/[^a-z0-9-]+/gi, '-')}-${face.weight}${face.unicodeRange?.startsWith('U+0600') ? '-arabic' : ''}.${extension}`
        urls.set(key, place(bytes, name, mime))
      } catch (error) {
        options.onWarning?.(`Font "${font.name}" (${face.weight}) could not be embedded (${error instanceof Error ? error.message : 'unknown error'}); viewers will see a fallback font.`)
      }
    }
  }
  return fontFaceCss(fonts, (face) => urls.get(face.url) ?? '')
}

export async function buildSelfContainedExportHtml(project: ProjectState, options: ExportOptions = {}): Promise<string> {
  const embedded = await embedProjectAssets(project)
  const fontCss = await buildFontCss(embedded, options, (bytes, _name, mime) => `data:${mime};base64,${bytesToBase64(bytes)}`)
  return buildPublicationHtml(buildPublicationData(embedded), fontCss)
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
}

/** ZIP publication: index.html plus page and asset files referenced by relative paths. */
export interface PublicationFile {
  /** Path relative to the publication folder, e.g. "pages/page-001.jpg". */
  path: string
  data: Uint8Array | string
}

/**
 * Every file of a multi-file publication (index.html, pages/, assets/, fonts/),
 * with relative links between them. Used by the ZIP export and by web publishing.
 */
export async function buildPublicationFiles(
  project: ProjectState,
  options: ExportOptions & { meta?: PublicationMeta } = {},
): Promise<{ files: PublicationFile[]; project: ProjectState }> {
  const embedded = await embedProjectAssets(project)
  const files: PublicationFile[] = []
  const fontCss = await buildFontCss(embedded, options, (bytes, name) => {
    files.push({ path: `fonts/${name}`, data: bytes })
    return `fonts/${name}`
  })
  const assetPaths = new Map<string, string>()
  for (const asset of Object.values(pruneUnusedAssets(embedded).assets)) {
    if (asset.mimeType.startsWith('font/')) continue
    const path = `assets/${asset.id}.${EXTENSIONS[asset.mimeType] ?? 'bin'}`
    files.push({ path, data: dataUrlToBytes(asset.dataUrl) })
    assetPaths.set(asset.id, path)
  }
  const pagePaths = new Map<string, string>()
  const thumbPaths = new Map<string, string>()
  embedded.pages.forEach((page, index) => {
    if (!page.previewUrl) return
    if (page.previewUrl.startsWith('data:')) {
      const path = `pages/page-${String(index + 1).padStart(3, '0')}.${EXTENSIONS[mimeTypeOfDataUrl(page.previewUrl)] ?? 'png'}`
      files.push({ path, data: dataUrlToBytes(page.previewUrl) })
      pagePaths.set(page.id, path)
    }
    if (page.thumbUrl?.startsWith('data:')) {
      const path = `pages/thumb-${String(index + 1).padStart(3, '0')}.${EXTENSIONS[mimeTypeOfDataUrl(page.thumbUrl)] ?? 'jpg'}`
      files.push({ path, data: dataUrlToBytes(page.thumbUrl) })
      thumbPaths.set(page.id, path)
    }
  })
  const data = buildPublicationData(
    embedded,
    (asset) => assetPaths.get(asset.id) ?? asset.dataUrl,
    (page) => pagePaths.get(page.id) ?? page.previewUrl ?? null,
    (page) => thumbPaths.get(page.id) ?? page.thumbUrl ?? null,
  )
  if (options.meta?.url) data.shareUrl = options.meta.url
  files.unshift({ path: 'index.html', data: buildPublicationHtml(data, fontCss, options.meta) })
  return { files, project: embedded }
}

export async function buildExportZip(project: ProjectState, options: ExportOptions = {}): Promise<Blob> {
  const zip = new JSZip()
  const { files, project: embedded } = await buildPublicationFiles(project, options)
  for (const file of files) zip.file(`publication/${file.path}`, file.data)
  zip.file('publication/project.flipstudio.json', serializeProject(embedded))
  zip.file(
    'README.txt',
    [
      'FlipStudio Pro publication',
      '',
      'Open publication/index.html in a web browser. Pages and images live in',
      'publication/pages and publication/assets and are referenced by relative paths,',
      'so keep the publication folder together when you move or upload it.',
      '',
      'To host it, upload the contents of the publication folder to any static web',
      'host. To check it locally, double-click index.html, or run a static server in',
      'the publication folder (for example: npx serve publication).',
      '',
      'publication/project.flipstudio.json is the editable project. Open it in',
      'FlipStudio Pro to keep editing.',
      '',
      'Third-party notices:',
      PAGE_FLIP_NOTICE,
      ...usedFonts(embedded).filter((font) => font.licence).map((font) => `Font: ${font.name} - ${font.licence} (https://openfontlicense.org)`),
      '',
    ].join('\n'),
  )
  return zip.generateAsync({ type: 'blob' })
}

async function blobToDataUrl(blob: Blob, label: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error(`Unable to encode publication asset ${label}`))
    reader.readAsDataURL(blob)
  })
}

/** Downloads any remote media into the managed asset store so the export never links outside itself. */
export async function embedProjectAssets(project: ProjectState): Promise<ProjectState> {
  const cache = new Map<string, string>()
  const fetchDataUrl = async (source: string): Promise<string> => {
    const cached = cache.get(source)
    if (cached) return cached
    let response: Response
    try {
      response = await fetch(source)
    } catch (error) {
      throw new Error(`Unable to include publication asset ${source}: ${error instanceof Error ? error.message : 'network request failed'}`)
    }
    if (!response.ok) throw new Error(`Unable to include publication asset ${source}: HTTP ${response.status}`)
    const dataUrl = await blobToDataUrl(await response.blob(), source)
    cache.set(source, dataUrl)
    return dataUrl
  }
  const isRemote = (source?: string): source is string => Boolean(source && !source.startsWith('data:'))

  let assets = { ...project.assets }
  const toAsset = async (source: string, name: string): Promise<string> => {
    const merged = mergeAssets(assets, [createAsset({ name, dataUrl: await fetchDataUrl(source) })])
    assets = merged.assets
    return merged.ids[0]
  }

  const pages: PageDefinition[] = []
  for (const page of project.pages) {
    const overlays: OverlayObject[] = []
    for (const overlay of page.overlays) {
      const next: OverlayObject = { ...overlay }
      if (!next.assetId && isRemote(next.src)) {
        next.assetId = await toAsset(next.src, next.label)
        delete next.src
      }
      if (next.slides) {
        const slides: SlideImage[] = []
        for (const slide of next.slides) {
          if (!slide.assetId && isRemote(slide.src)) {
            const assetId = await toAsset(slide.src, slide.alt ?? slide.id)
            slides.push({ id: slide.id, assetId, alt: slide.alt })
          } else {
            slides.push(slide)
          }
        }
        next.slides = slides
      }
      overlays.push(next)
    }
    pages.push({
      ...page,
      previewUrl: isRemote(page.previewUrl) ? await fetchDataUrl(page.previewUrl) : page.previewUrl,
      overlays,
    })
  }

  return { ...project, pages, assets }
}
