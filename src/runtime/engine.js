// FlipStudio Pro shared runtime engine.
//
// This file is the single source of truth for animation timing, frame
// evaluation, overlay geometry, slideshow stepping and the playback clock.
// It is imported as an ES module by the editor and Preview, and its source is
// inlined verbatim (export keywords stripped) into exported publications, so
// the editor, Preview and export can never drift apart.
//
// Rules for this file: no imports, no references to bundler globals, plain
// ES2020 only, and every top-level declaration must be a `function` or `const`.

export const ANIMATION_PROPERTY = {
  'fade-in': 'opacity',
  'fade-out': 'opacity',
  'move-x': 'x',
  'move-y': 'y',
  scale: 'scale',
  rotation: 'rotation',
}

export const EASINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'ease-out-back']

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function ease(progress, easing) {
  const p = clamp(progress, 0, 1)
  if (easing === 'ease-in') return p * p
  if (easing === 'ease-out') return 1 - (1 - p) * (1 - p)
  if (easing === 'ease-in-out') return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
  if (easing === 'ease-out-back') {
    const c1 = 1.70158
    const c3 = c1 + 1
    return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2)
  }
  return p
}

/** Absolute timeline second at which an animation begins moving. */
export function animationBegin(animation) {
  return Math.max(0, Number(animation.start) || 0) + Math.max(0, Number(animation.delay) || 0)
}

/** Timeline second at which a non-looping animation reaches its final value. */
export function animationEnd(animation) {
  return animationBegin(animation) + Math.max(0.01, Number(animation.duration) || 0.01)
}

/**
 * Value of one animation at timeline time `time` (seconds).
 * Before it begins: `from`. After it ends (non-looping): `to`.
 * Looping animations repeat forever after they begin; `alternate` ping-pongs.
 */
export function animationValue(animation, time) {
  const duration = Math.max(0.01, Number(animation.duration) || 0.01)
  const elapsed = time - animationBegin(animation)
  if (elapsed <= 0) return animation.from
  let progress
  if (!animation.loop) {
    if (elapsed >= duration) return animation.alternate ? animation.from : animation.to
    progress = elapsed / duration
    if (animation.alternate) progress = progress < 0.5 ? progress * 2 : (1 - progress) * 2
  } else if (animation.alternate) {
    const cycle = (elapsed % (duration * 2)) / duration
    progress = cycle <= 1 ? cycle : 2 - cycle
  } else {
    progress = (elapsed % duration) / duration
  }
  return animation.from + (animation.to - animation.from) * ease(progress, animation.easing)
}

/** The neutral frame: no offset, full opacity multiplier, unit scale. */
export function identityFrame() {
  return { x: 0, y: 0, opacity: 1, scale: 1, rotation: 0 }
}

/** Animations ordered by begin time, then by their order in the project. */
export function orderAnimations(animations) {
  return animations
    .map((animation, index) => ({ animation, index }))
    .sort((a, b) => animationBegin(a.animation) - animationBegin(b.animation) || a.index - b.index)
    .map((entry) => entry.animation)
}

/**
 * Frame for one object at `time`. Values are relative to the object's design
 * state: x/y/rotation are offsets added to the base, opacity and scale are
 * multipliers. For each property the earliest animation defines the initial
 * state; later animations on the same property take over once they begin.
 */
export function sampleFrame(animations, targetId, time) {
  const frame = identityFrame()
  const applied = {}
  const ordered = orderAnimations(animations)
  for (let i = 0; i < ordered.length; i += 1) {
    const animation = ordered[i]
    if (animation.targetId !== targetId) continue
    const property = ANIMATION_PROPERTY[animation.type]
    if (!property) continue
    if (applied[property] && time < animationBegin(animation)) continue
    frame[property] = animationValue(animation, time)
    applied[property] = true
  }
  return frame
}

/** Frames for every animated object, keyed by object ID. */
export function sampleFrames(animations, time) {
  const frames = {}
  const targets = {}
  for (let i = 0; i < animations.length; i += 1) targets[animations[i].targetId] = true
  Object.keys(targets).forEach((targetId) => {
    frames[targetId] = sampleFrame(animations, targetId, time)
  })
  return frames
}

export function timelineDuration(animations) {
  let duration = 0
  for (let i = 0; i < animations.length; i += 1) duration = Math.max(duration, animationEnd(animations[i]))
  return duration
}

export function timelineLoops(animations) {
  return animations.some((animation) => Boolean(animation.loop))
}

function round(value) {
  return Math.round(value * 10000) / 10000
}

/**
 * CSS geometry for an object on a page, in page-relative percentages so the
 * same object lines up at any canvas, Preview or export scale.
 */
export function overlayStyle(overlay, page, frame) {
  const f = frame || identityFrame()
  const rotation = (Number(overlay.rotation) || 0) + f.rotation
  const opacity = clamp((overlay.opacity === undefined ? 1 : Number(overlay.opacity)) * f.opacity, 0, 1)
  return {
    left: round(((overlay.x + f.x) / page.width) * 100) + '%',
    top: round(((overlay.y + f.y) / page.height) * 100) + '%',
    width: round((overlay.width / page.width) * 100) + '%',
    height: round((overlay.height / page.height) * 100) + '%',
    opacity: String(round(opacity)),
    transform: 'rotate(' + round(rotation) + 'deg) scale(' + round(f.scale) + ')',
  }
}

/** Font size expressed in container-query width units of the page. */
export function textFontSize(overlay, page) {
  const size = Number(overlay.fontSize) || 32
  return round((size / page.width) * 100) + 'cqw'
}

/**
 * Next slide index. Returns `{ index, ended }`; `ended` is true when a
 * non-looping slideshow tried to move past its last (or first) slide.
 */
export function stepSlide(index, count, direction, loop) {
  if (!count || count < 1) return { index: 0, ended: true }
  const next = index + direction
  if (next >= count) return loop ? { index: 0, ended: false } : { index: count - 1, ended: true }
  if (next < 0) return loop ? { index: count - 1, ended: false } : { index: 0, ended: true }
  return { index: next, ended: false }
}

/**
 * Class list for one slide image. Direction 0 means "no transition" (initial
 * paint); otherwise the entering and leaving slides receive the transition
 * classes defined in publication.css.
 */
export function slideClassName(slideIndex, activeIndex, previousIndex, direction) {
  const dir = direction < 0 ? ' dir-back' : direction > 0 ? ' dir-forward' : ''
  if (slideIndex === activeIndex) return 'fs-slide is-active' + dir
  if (slideIndex === previousIndex && direction !== 0) return 'fs-slide is-leaving' + dir
  return 'fs-slide'
}

/** Only these URL schemes become clickable links in Preview and export. */
export function safeLinkUrl(url) {
  if (typeof url !== 'string') return ''
  const trimmed = url.trim()
  return /^(https?:|mailto:|tel:)/i.test(trimmed) ? trimmed : ''
}

export function slideIntervalMs(overlay) {
  return Math.max(500, (Number(overlay.duration) || 3) * 1000)
}

export function slideTransitionMs(overlay) {
  if (overlay.transition === 'instant') return 0
  const value = overlay.transitionDuration === undefined ? 0.6 : Number(overlay.transitionDuration)
  return Math.round(clamp(value || 0, 0, 5) * 1000)
}

export function initialSlideIndex(overlay) {
  const count = (overlay.slides || []).length
  if (!count) return 0
  return clamp(Math.floor(Number(overlay.startIndex) || 0), 0, count - 1)
}

/**
 * Timer-driven slideshow controller shared by Preview and export.
 * `render(index, previousIndex, direction)` paints the slideshow; the
 * controller owns exactly one timeout at a time, so repeated play() calls can
 * never stack timers.
 */
export function createSlideshowController(overlay, render, timers) {
  const setT = (timers && timers.setTimeout) || ((fn, ms) => setTimeout(fn, ms))
  const clearT = (timers && timers.clearTimeout) || ((id) => clearTimeout(id))
  const count = (overlay.slides || []).length
  let index = initialSlideIndex(overlay)
  let timer = 0
  let playing = false
  let hoverPaused = false
  let held = false
  let destroyed = false
  const schedule = () => {
    if (timer) clearT(timer)
    timer = 0
    if (!playing || hoverPaused || held || destroyed || count < 2) return
    timer = setT(() => {
      timer = 0
      const result = stepSlide(index, count, 1, overlay.looping !== false)
      if (result.ended) {
        playing = false
        notify()
        return
      }
      go(result.index, 1)
      schedule()
    }, slideIntervalMs(overlay))
  }
  const notify = () => {
    if (api.onStateChange) api.onStateChange(api)
  }
  const go = (nextIndex, direction) => {
    const previous = index
    index = nextIndex
    render(index, previous, direction)
  }
  const api = {
    onStateChange: null,
    get index() { return index },
    get playing() { return playing },
    play() {
      if (destroyed || playing) return
      playing = true
      schedule()
      notify()
    },
    pause() {
      if (!playing) return
      playing = false
      schedule()
      notify()
    },
    toggle() { if (playing) api.pause(); else api.play() },
    next() {
      const result = stepSlide(index, count, 1, overlay.looping !== false)
      if (result.index !== index) go(result.index, 1)
      schedule()
    },
    previous() {
      const result = stepSlide(index, count, -1, overlay.looping !== false)
      if (result.index !== index) go(result.index, -1)
      schedule()
    },
    goTo(target) {
      const bounded = clamp(Math.floor(target), 0, Math.max(0, count - 1))
      if (bounded !== index) go(bounded, bounded > index ? 1 : -1)
      schedule()
    },
    /** Holds the current slide (e.g. while a video slide plays) without leaving play mode. */
    hold(on) {
      held = !!on
      schedule()
    },
    setHover(hovered) {
      if (!overlay.pauseOnHover) return
      hoverPaused = hovered
      schedule()
    },
    reset() {
      playing = false
      schedule()
      go(initialSlideIndex(overlay), -1)
    },
    destroy() {
      destroyed = true
      playing = false
      if (timer) clearT(timer)
      timer = 0
    },
  }
  render(index, index, 0)
  return api
}

/**
 * The single cancellable playback clock. Exactly one requestAnimationFrame
 * callback is pending while playing; play() while playing is a no-op.
 * States: 'stopped' (design state, time 0), 'playing', 'paused'.
 */
export function createClock(options) {
  const raf = options.requestFrame || ((cb) => requestAnimationFrame(cb))
  const caf = options.cancelFrame || ((id) => cancelAnimationFrame(id))
  const now = options.now || (() => performance.now())
  let duration = Math.max(0, Number(options.duration) || 0)
  let loops = Boolean(options.loops)
  let time = 0
  let state = 'stopped'
  let frameId = 0
  let originWall = 0
  let originTime = 0
  let destroyed = false

  const emit = () => { if (!destroyed && options.onTick) options.onTick(time, state) }
  const cancel = () => { if (frameId) caf(frameId); frameId = 0 }
  const current = () => originTime + (now() - originWall) / 1000
  const tick = () => {
    frameId = 0
    if (state !== 'playing' || destroyed) return
    const t = current()
    if (!loops && t >= duration) {
      time = duration
      state = 'paused'
      emit()
      if (options.onEnd) options.onEnd()
      return
    }
    time = t
    emit()
    frameId = raf(tick)
  }

  return {
    get time() { return time },
    get state() { return state },
    get duration() { return duration },
    configure(next) {
      if (next.duration !== undefined) duration = Math.max(0, Number(next.duration) || 0)
      if (next.loops !== undefined) loops = Boolean(next.loops)
      if (!loops && time > duration) time = duration
    },
    play() {
      if (destroyed || state === 'playing') return
      if (!loops && time >= duration) time = 0
      originWall = now()
      originTime = time
      state = 'playing'
      emit()
      cancel()
      frameId = raf(tick)
    },
    pause() {
      if (state !== 'playing') return
      time = loops ? current() : Math.min(duration, current())
      cancel()
      state = 'paused'
      emit()
    },
    stop() {
      cancel()
      time = 0
      state = 'stopped'
      emit()
    },
    restart() {
      cancel()
      time = 0
      state = 'stopped'
      this.play()
    },
    seek(target) {
      const upper = loops ? Math.max(duration, Number(target) || 0) : duration
      time = clamp(Number(target) || 0, 0, upper)
      if (state === 'playing') {
        originWall = now()
        originTime = time
      } else {
        state = 'paused'
      }
      emit()
    },
    destroy() {
      cancel()
      destroyed = true
      state = 'stopped'
    },
  }
}
