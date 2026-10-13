import type { ClockState, EngineAnimation, PlaybackClock, SlideshowController } from './engine.js'
import type { HoverEffect, IdleEffect, LinkAction, ObjectStyle } from './styles.js'

export interface PublicationSlide {
  id: string
  src: string
  alt?: string
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
}

export interface PublicationPage {
  id: string
  name: string
  width: number
  height: number
  background: string | null
  overlays: PublicationOverlay[]
  text?: Array<{ s: string; x: number; y: number; w: number; h: number; a?: number; f?: string; eol?: boolean }>
}

export interface PublicationData {
  title: string
  pages: PublicationPage[]
  animations: EngineAnimation[]
  restartAnimationsOnPageTurn?: boolean
  reader?: { textTools?: boolean; background?: string; toolbar?: string }
}

export interface PublicationHandle {
  readonly currentPage: number
  readonly clock: PlaybackClock
  readonly controllers: SlideshowController[]
  readonly book: unknown
  readonly selecting: boolean
  setSelectMode(on: boolean): void
  search(query: string): Array<{ page: number; start: number; end: number }>
  goToPage(index: number): void
  destroy(): void
}

export interface MountOptions {
  PageFlip?: unknown
  startPage?: number
  autoplay?: boolean
  forceSinglePage?: boolean
  designStateWhenStopped?: boolean
  onPageChange?: (page: number) => void
  onTimeChange?: (time: number, state: ClockState) => void
}

export function mountPublication(root: HTMLElement, data: PublicationData, options?: MountOptions): PublicationHandle
