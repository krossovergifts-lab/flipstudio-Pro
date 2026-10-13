import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  createSlideshowController,
  initialSlideIndex,
  slideClassName,
  slideTransitionMs,
  type SlideshowController,
} from '../runtime/engine.js'
import type { OverlayObject, ProjectState } from '../lib/project'
import { cropStyle } from '../runtime/styles.js'
import { resolveSource } from '../lib/project'

interface SlideshowViewProps {
  overlay: OverlayObject
  assets: ProjectState['assets']
  /** Editor playback toggle. The editor never autoplays on its own. */
  playing: boolean
  /** Registers the controller so the inspector can step through slides. */
  onController?: (id: string, controller: SlideshowController | null) => void
  onIndexChange?: (id: string, index: number, playing: boolean) => void
}

/**
 * Editor-canvas slideshow. Uses the same controller and class names as the
 * reader runtime (Preview/export), so transitions look identical.
 */
export function SlideshowView({ overlay, assets, playing, onController, onIndexChange }: SlideshowViewProps) {
  const slides = useMemo(() => overlay.slides ?? [], [overlay.slides])
  const [view, setView] = useState(() => ({ index: initialSlideIndex(overlay), previous: initialSlideIndex(overlay), direction: 0 }))
  const controllerRef = useRef<SlideshowController | null>(null)
  const callbacks = useRef({ onController, onIndexChange })
  useLayoutEffect(() => {
    callbacks.current = { onController, onIndexChange }
  }, [onController, onIndexChange])

  // Recreate the controller only when playback-relevant settings change.
  const configKey = [
    overlay.id,
    slides.map((slide) => slide.id).join(','),
    overlay.looping,
    overlay.duration,
    overlay.startIndex,
    overlay.pauseOnHover,
  ].join('|')

  useEffect(() => {
    const config = { slides, looping: overlay.looping, duration: overlay.duration, startIndex: overlay.startIndex, pauseOnHover: overlay.pauseOnHover }
    const controller = createSlideshowController(config, (index, previous, direction) => {
      setView({ index, previous, direction })
      callbacks.current.onIndexChange?.(overlay.id, index, controllerRef.current?.playing ?? false)
    })
    controller.onStateChange = (current) => callbacks.current.onIndexChange?.(overlay.id, current.index, current.playing)
    controllerRef.current = controller
    callbacks.current.onController?.(overlay.id, controller)
    return () => {
      controller.destroy()
      if (controllerRef.current === controller) controllerRef.current = null
      callbacks.current.onController?.(overlay.id, null)
    }
    // configKey captures every field the controller reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey])

  useEffect(() => {
    const controller = controllerRef.current
    if (!controller) return
    if (playing) controller.play()
    else controller.pause()
  }, [playing, configKey])

  const fit = `fs-fit-${overlay.fit ?? 'cover'}`
  if (!slides.length) {
    return <div className="fs-placeholder">Slideshow · add images in the inspector</div>
  }
  return (
    <>
      <div
        className="fs-slides"
        data-transition={overlay.transition ?? 'fade'}
        style={{ '--fs-transition': `${slideTransitionMs(overlay)}ms` } as React.CSSProperties}
      >
        {slides.map((slide, index) => (
          <img
            key={slide.id}
            className={`${slideClassName(index, view.index, view.previous, view.direction)} ${fit}`}
            src={resolveSource({ assets }, slide) || undefined}
            alt={slide.alt ?? `Slide ${index + 1}`}
            draggable={false}
            data-slide-index={index}
            style={cropStyle(overlay) as React.CSSProperties}
          />
        ))}
      </div>
      {slides.length > 1 && (overlay.showIndicators ?? 'dots') === 'dots' && (
        <div className="fs-ss-dots" aria-hidden="true">
          {slides.map((slide, index) => (
            <span key={slide.id} className={`fs-ss-dot ${index === view.index ? 'is-active' : ''}`} />
          ))}
        </div>
      )}
      <div className="slideshow-meta">{view.index + 1}/{slides.length}</div>
    </>
  )
}
