// Type declarations for the shared runtime engine (engine.js).

export type AnimationType = 'fade-in' | 'fade-out' | 'move-x' | 'move-y' | 'scale' | 'rotation'
export type AnimationEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'ease-out-back'
export type FrameProperty = 'x' | 'y' | 'opacity' | 'scale' | 'rotation'

export interface EngineAnimation {
  id: string
  targetId: string
  type: AnimationType
  start: number
  delay?: number
  duration: number
  easing: AnimationEasing
  from: number
  to: number
  loop: boolean
  alternate?: boolean
}

export interface AnimationFrame {
  x: number
  y: number
  opacity: number
  scale: number
  rotation: number
}

export interface EngineOverlayGeometry {
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  opacity?: number
  fontSize?: number
}

export interface EnginePageGeometry {
  width: number
  height: number
}

export interface OverlayCss {
  left: string
  top: string
  width: string
  height: string
  opacity: string
  transform: string
}

export interface EngineSlideshow {
  slides?: unknown[]
  looping?: boolean
  duration?: number
  transition?: 'fade' | 'slide' | 'instant'
  transitionDuration?: number
  pauseOnHover?: boolean
  startIndex?: number
}

export interface SlideshowController {
  onStateChange: ((controller: SlideshowController) => void) | null
  readonly index: number
  readonly playing: boolean
  play(): void
  pause(): void
  toggle(): void
  next(): void
  previous(): void
  goTo(index: number): void
  setHover(hovered: boolean): void
  reset(): void
  destroy(): void
}

export type ClockState = 'stopped' | 'playing' | 'paused'

export interface PlaybackClock {
  readonly time: number
  readonly state: ClockState
  readonly duration: number
  configure(options: { duration?: number; loops?: boolean }): void
  play(): void
  pause(): void
  stop(): void
  restart(): void
  seek(time: number): void
  destroy(): void
}

export interface ClockOptions {
  duration: number
  loops?: boolean
  onTick?: (time: number, state: ClockState) => void
  onEnd?: () => void
  requestFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (id: number) => void
  now?: () => number
}

export const ANIMATION_PROPERTY: Record<AnimationType, FrameProperty>
export const EASINGS: AnimationEasing[]
export function clamp(value: number, min: number, max: number): number
export function ease(progress: number, easing: AnimationEasing | string): number
export function animationBegin(animation: Pick<EngineAnimation, 'start' | 'delay'>): number
export function animationEnd(animation: Pick<EngineAnimation, 'start' | 'delay' | 'duration'>): number
export function animationValue(animation: EngineAnimation, time: number): number
export function identityFrame(): AnimationFrame
export function orderAnimations<T extends EngineAnimation>(animations: T[]): T[]
export function sampleFrame(animations: EngineAnimation[], targetId: string, time: number): AnimationFrame
export function sampleFrames(animations: EngineAnimation[], time: number): Record<string, AnimationFrame>
export function timelineDuration(animations: EngineAnimation[]): number
export function timelineLoops(animations: EngineAnimation[]): boolean
export function overlayStyle(overlay: EngineOverlayGeometry, page: EnginePageGeometry, frame?: AnimationFrame | null): OverlayCss
export function textFontSize(overlay: EngineOverlayGeometry, page: EnginePageGeometry): string
export function stepSlide(index: number, count: number, direction: number, loop: boolean): { index: number; ended: boolean }
export function slideClassName(slideIndex: number, activeIndex: number, previousIndex: number, direction: number): string
export function safeLinkUrl(url: unknown): string
export function slideIntervalMs(overlay: EngineSlideshow): number
export function slideTransitionMs(overlay: EngineSlideshow): number
export function initialSlideIndex(overlay: EngineSlideshow): number
export function createSlideshowController(
  overlay: EngineSlideshow,
  render: (index: number, previousIndex: number, direction: number) => void,
  timers?: { setTimeout: (fn: () => void, ms: number) => number; clearTimeout: (id: number) => void },
): SlideshowController
export function createClock(options: ClockOptions): PlaybackClock
