import { describe, expect, it } from 'vitest'
import {
  animationValue,
  createClock,
  createSlideshowController,
  ease,
  overlayStyle,
  sampleFrame,
  sampleFrames,
  slideClassName,
  stepSlide,
  timelineDuration,
  type EngineAnimation,
} from './engine.js'

const base: EngineAnimation = {
  id: 'a',
  targetId: 'obj',
  type: 'move-x',
  start: 1,
  delay: 0,
  duration: 2,
  easing: 'linear',
  from: -100,
  to: 0,
  loop: false,
}

/** Manual requestAnimationFrame + clock, so playback is deterministic. */
function fakeFrames() {
  let now = 0
  let nextId = 1
  const pending = new Map<number, FrameRequestCallback>()
  return {
    now: () => now,
    requestFrame: (callback: FrameRequestCallback) => {
      const id = nextId++
      pending.set(id, callback)
      return id
    },
    cancelFrame: (id: number) => {
      pending.delete(id)
    },
    pendingCount: () => pending.size,
    advance(ms: number) {
      now += ms
      const callbacks = [...pending.values()]
      pending.clear()
      callbacks.forEach((callback) => callback(now))
    },
  }
}

function fakeTimers() {
  let nextId = 1
  const timers = new Map<number, { fn: () => void; at: number }>()
  let now = 0
  return {
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextId++
      timers.set(id, { fn, at: now + ms })
      return id
    },
    clearTimeout: (id: number) => {
      timers.delete(id)
    },
    count: () => timers.size,
    advance(ms: number) {
      const target = now + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = due[1].at
        due[1].fn()
      }
      now = target
    },
  }
}

describe('easing', () => {
  it('maps progress through each curve', () => {
    expect(ease(0.5, 'linear')).toBe(0.5)
    expect(ease(0.5, 'ease-in')).toBe(0.25)
    expect(ease(0.5, 'ease-out')).toBe(0.75)
    expect(ease(0.5, 'ease-in-out')).toBe(0.5)
    expect(ease(0.25, 'ease-in-out')).toBe(0.125)
    expect(ease(1, 'ease-out-back')).toBeCloseTo(1)
    expect(ease(0.6, 'ease-out-back')).toBeGreaterThan(1)
    expect(ease(-1, 'linear')).toBe(0)
    expect(ease(2, 'linear')).toBe(1)
  })
})

describe('animation evaluation', () => {
  it('holds the initial value before start and delay', () => {
    expect(animationValue(base, 0)).toBe(-100)
    expect(animationValue({ ...base, delay: 0.5 }, 1.4)).toBe(-100)
  })

  it('interpolates mid-animation and honours delay', () => {
    expect(animationValue(base, 2)).toBe(-50)
    expect(animationValue({ ...base, delay: 1 }, 3)).toBe(-50)
    expect(animationValue({ ...base, easing: 'ease-in' }, 2)).toBe(-75)
  })

  it('completes at the final value and stays there', () => {
    expect(animationValue(base, 3)).toBe(0)
    expect(animationValue(base, 99)).toBe(0)
  })

  it('loops and ping-pongs', () => {
    const loop = { ...base, loop: true }
    expect(animationValue(loop, 3.5)).toBe(-75)
    expect(animationValue(loop, 4)).toBe(-50)
    expect(animationValue(loop, 5)).toBe(-100)
    const pingPong = { ...base, loop: true, alternate: true }
    expect(animationValue(pingPong, 3)).toBe(0)
    expect(animationValue(pingPong, 4)).toBe(-50)
    expect(animationValue(pingPong, 5)).toBe(-100)
  })

  it('starts every object from a deterministic initial state', () => {
    const fadeIn: EngineAnimation = { ...base, id: 'f', type: 'fade-in', from: 0, to: 1, start: 2 }
    expect(sampleFrame([fadeIn], 'obj', 0)).toEqual({ x: 0, y: 0, opacity: 0, scale: 1, rotation: 0 })
    expect(sampleFrame([fadeIn], 'other', 0)).toEqual({ x: 0, y: 0, opacity: 1, scale: 1, rotation: 0 })
  })

  it('combines properties and sequences animations on the same property', () => {
    const slideIn = { ...base, start: 0, duration: 1 }
    const slideOut = { ...base, id: 'b', start: 2, duration: 1, from: 0, to: 200 }
    const fade = { ...base, id: 'c', type: 'fade-in' as const, start: 0, duration: 1, from: 0, to: 1 }
    expect(sampleFrame([slideOut, slideIn, fade], 'obj', 0.5)).toMatchObject({ x: -50, opacity: 0.5 })
    expect(sampleFrame([slideOut, slideIn, fade], 'obj', 1.5)).toMatchObject({ x: 0, opacity: 1 })
    expect(sampleFrame([slideOut, slideIn, fade], 'obj', 2.5)).toMatchObject({ x: 100 })
  })

  it('evaluates multiple animated objects independently', () => {
    const frames = sampleFrames([
      { ...base, targetId: 'one' },
      { ...base, id: 'two', targetId: 'two', type: 'scale', from: 0.5, to: 1 },
    ], 2)
    expect(frames.one.x).toBe(-50)
    expect(frames.two.scale).toBe(0.75)
    expect(frames.two.x).toBe(0)
    expect(timelineDuration([base, { ...base, start: 4, delay: 1 }])).toBe(7)
  })

  it('produces page-relative geometry composed with the object design state', () => {
    const style = overlayStyle(
      { x: 100, y: 200, width: 250, height: 100, rotation: 10, opacity: 0.8 },
      { width: 1000, height: 1000 },
      { x: -100, y: 0, opacity: 0.5, scale: 2, rotation: 5 },
    )
    expect(style).toEqual({ left: '0%', top: '20%', width: '25%', height: '10%', opacity: '0.4', transform: 'rotate(15deg) scale(2)' })
  })
})

describe('playback clock', () => {
  it('plays, pauses, resumes, scrubs and stops on one frame loop', () => {
    const frames = fakeFrames()
    const ticks: Array<[number, string]> = []
    const clock = createClock({ duration: 4, ...frames, onTick: (time, state) => ticks.push([time, state]) })

    clock.play()
    clock.play()
    expect(frames.pendingCount()).toBe(1)
    frames.advance(1000)
    expect(clock.time).toBeCloseTo(1)
    clock.pause()
    expect(frames.pendingCount()).toBe(0)
    frames.advance(1000)
    expect(clock.time).toBeCloseTo(1)
    clock.play()
    frames.advance(500)
    expect(clock.time).toBeCloseTo(1.5)
    clock.seek(3)
    frames.advance(250)
    expect(clock.time).toBeCloseTo(3.25)
    clock.stop()
    expect(clock.time).toBe(0)
    expect(clock.state).toBe('stopped')
    expect(frames.pendingCount()).toBe(0)
    expect(ticks.at(-1)).toEqual([0, 'stopped'])
  })

  it('scrubbing while stopped moves the playhead without starting playback', () => {
    const frames = fakeFrames()
    const clock = createClock({ duration: 2, ...frames })
    clock.seek(1.2)
    expect(clock.state).toBe('paused')
    expect(clock.time).toBe(1.2)
    expect(frames.pendingCount()).toBe(0)
    clock.seek(50)
    expect(clock.time).toBe(2)
  })

  it('pauses at the end and restarts from zero', () => {
    const frames = fakeFrames()
    const clock = createClock({ duration: 1, ...frames })
    clock.play()
    frames.advance(1500)
    expect(clock.state).toBe('paused')
    expect(clock.time).toBe(1)
    clock.play()
    expect(clock.time).toBe(0)
  })

  it('keeps running when the timeline loops and cancels on destroy', () => {
    const frames = fakeFrames()
    const clock = createClock({ duration: 1, loops: true, ...frames })
    clock.play()
    frames.advance(2500)
    expect(clock.state).toBe('playing')
    expect(clock.time).toBeCloseTo(2.5)
    clock.destroy()
    expect(frames.pendingCount()).toBe(0)
  })
})

describe('slideshow playback model', () => {
  it('steps with and without looping', () => {
    expect(stepSlide(2, 3, 1, true)).toEqual({ index: 0, ended: false })
    expect(stepSlide(2, 3, 1, false)).toEqual({ index: 2, ended: true })
    expect(stepSlide(0, 3, -1, true)).toEqual({ index: 2, ended: false })
    expect(stepSlide(0, 0, 1, true)).toEqual({ index: 0, ended: true })
  })

  it('advances on its interval and never stacks timers', () => {
    const timers = fakeTimers()
    const seen: number[] = []
    const controller = createSlideshowController(
      { slides: [1, 2, 3], duration: 1, looping: true },
      (index) => seen.push(index),
      timers,
    )
    controller.play()
    controller.play()
    controller.play()
    expect(timers.count()).toBe(1)
    timers.advance(1000)
    timers.advance(1000)
    timers.advance(1000)
    expect(seen).toEqual([0, 1, 2, 0])
    controller.pause()
    expect(timers.count()).toBe(0)
    controller.next()
    controller.previous()
    controller.goTo(2)
    expect(seen.slice(-3)).toEqual([1, 0, 2])
    controller.destroy()
    expect(timers.count()).toBe(0)
  })

  it('stops at the last slide when looping is off and pauses on hover', () => {
    const timers = fakeTimers()
    const seen: number[] = []
    const controller = createSlideshowController({ slides: [1, 2], duration: 1, looping: false, pauseOnHover: true }, (index) => seen.push(index), timers)
    controller.play()
    controller.setHover(true)
    timers.advance(5000)
    expect(seen).toEqual([0])
    controller.setHover(false)
    timers.advance(1000)
    timers.advance(1000)
    expect(seen).toEqual([0, 1])
    expect(controller.playing).toBe(false)
    expect(timers.count()).toBe(0)
  })

  it('assigns transition classes to entering and leaving slides', () => {
    expect(slideClassName(1, 1, 0, 1)).toBe('fs-slide is-active dir-forward')
    expect(slideClassName(0, 1, 0, 1)).toBe('fs-slide is-leaving dir-forward')
    expect(slideClassName(2, 1, 0, 1)).toBe('fs-slide')
    expect(slideClassName(0, 0, 0, 0)).toBe('fs-slide is-active')
  })
})
