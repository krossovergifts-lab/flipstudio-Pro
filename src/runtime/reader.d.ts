import type { ClockState, EngineAnimation, PlaybackClock, SlideshowController } from './engine.js'
import type { HoverEffect, IdleEffect, LinkAction, ObjectStyle } from './styles.js'

export interface PublicationSlide {
  id: string
  src: string
  alt?: string
  kind?: 'image' | 'video'
}

export interface PublicationOverlay {
  id: string
  type: string
  label: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  visible: boolean
  fontSize?: number
  src?: string
  url?: string
  link?: LinkAction
  style?: Partial<ObjectStyle>
  fontStack?: string
  effect?: IdleEffect
  hoverEffect?: HoverEffect
  tooltip?: string
  popup?: { title: string; description: string; price?: string; image?: string; buttonLabel?: string; link?: LinkAction }
  fit?: 'cover' | 'contain' | 'fill'
  crop?: { zoom?: number; x?: number; y?: number }
  slides?: PublicationSlide[]
  autoplay?: boolean
  looping?: boolean
  duration?: number
  transition?: 'fade' | 'slide' | 'instant'
  transitionDuration?: number
  showControls?: boolean
  showIndicators?: 'dots' | 'thumbnails' | 'none'
  pauseOnHover?: boolean
  startIndex?: number
  videoUrl?: string
  muted?: boolean
}

export interface PublicationPage {
  id: string
  name: string
  width: number
  height: number
  background: string | null
  overlays: PublicationOverlay[]
  thumb?: string
  bookmark?: { label: string; color?: string; textColor?: string }
  text?: Array<{ s: string; x: number; y: number; w: number; h: number; a?: number; f?: string; eol?: boolean }>
}

export interface PublicationData {
  title: string
  pages: PublicationPage[]
  animations: EngineAnimation[]
  restartAnimationsOnPageTurn?: boolean
  reader?: {
    textTools?: boolean
    backgroundMode?: 'solid' | 'gradient' | 'image'
    background?: string
    backgroundTo?: string
    backgroundAngle?: number
    backgroundImage?: string
    toolbar?: string
    toolbarText?: string
    button?: string
    accent?: string
    flip?: string
    flipSpeed?: number
    cover?: 'soft' | 'hard'
    pageShadow?: boolean
    bookShadow?: boolean
    sound?: string
    soundUrl?: string
    thumbnails?: boolean
    logo?: string
    logoLink?: string
    tabs?: boolean
    tabEffect?: string
    contents?: boolean
    readerBookmarks?: boolean
    share?: boolean
    sideArrows?: boolean
    showTitle?: boolean
    autoFlipButton?: boolean
    autoFlip?: { startOnOpen?: boolean; interval?: number; startDelay?: number; loop?: boolean }
    downloadUrl?: string
    downloadName?: string
    centerSinglePages?: boolean
    analyticsId?: string
    analyticsConsent?: boolean
    seoTitle?: string
    language?: string
    noIndex?: boolean
    pageLinks?: boolean
  }
  id?: string
  shareUrl?: string
}

export interface PublicationHandle {
  readonly currentPage: number
  readonly clock: PlaybackClock
  readonly controllers: SlideshowController[]
  readonly book: unknown
  readonly selecting: boolean
  setSelectMode(on: boolean): void
  setZoom(level: number, clientX?: number, clientY?: number): void
  readonly zoom: number
  readonly sound: { readonly enabled: boolean; readonly muted: boolean; setMuted(muted: boolean): void; play(): void }
  search(query: string): Array<{ page: number; start: number; end: number }>
  goToPage(index: number): void
  destroy(): void
}

export interface MountOptions {
  PageFlip?: unknown
  startPage?: number
  autoplay?: boolean
  forceSinglePage?: boolean
  /** Show the animation play/stop/timeline bar (default true; exported books hide it). */
  showTimeline?: boolean
  designStateWhenStopped?: boolean
  onPageChange?: (page: number) => void
  onTimeChange?: (time: number, state: ClockState) => void
  /** Published / exported copy: the address bar follows the page and analytics may run. */
  standalone?: boolean
  /** Called for every reader event (page view, search, share…), also when analytics is off. */
  onTrack?: (name: string, params: Record<string, unknown>) => void
}

export function mountPublication(root: HTMLElement, data: PublicationData, options?: MountOptions): PublicationHandle
