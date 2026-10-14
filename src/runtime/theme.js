// FlipStudio Pro reader theme: page-turn presets, colours/background and the
// page-flip sound. Shared by Preview, exported files and online publications
// (inlined like engine.js). Rules: no imports, plain ES2020, top-level
// `function`/`const` only.

/** Page-turn feel. `cover: 'soft'` lets the cover bend like paper instead of turning as a stiff board. */
export const FLIP_PRESETS = {
  smooth: { label: 'Smooth catalogue', time: 850, shadow: 0.5, cover: 'soft', corners: true },
  magazine: { label: 'Magazine (thin paper)', time: 650, shadow: 0.32, cover: 'soft', corners: true },
  hardcover: { label: 'Hardcover book', time: 1000, shadow: 0.6, cover: 'hard', corners: true },
  quick: { label: 'Quick', time: 420, shadow: 0.3, cover: 'soft', corners: false },
}

export const SOUND_PRESETS = {
  none: 'No sound',
  paper: 'Paper page',
  soft: 'Soft page',
  crisp: 'Crisp catalogue page',
  custom: 'My own sound',
}

/** Page-turn settings after applying the preset and any overrides. */
export function flipSettings(reader) {
  const r = reader || {}
  const preset = FLIP_PRESETS[r.flip] || FLIP_PRESETS.smooth
  const speed = Number(r.flipSpeed)
  return {
    time: speed >= 200 && speed <= 3000 ? Math.round(speed) : preset.time,
    shadow: r.pageShadow === false ? 0 : preset.shadow,
    cover: r.cover === 'hard' || r.cover === 'soft' ? r.cover : preset.cover,
    corners: preset.corners,
  }
}

const HEX = /^#[0-9a-f]{3,8}$/i
const color = (value, fallback) => (typeof value === 'string' && (HEX.test(value) || /^rgba?\([\d\s.,%]+\)$/i.test(value)) ? value : fallback)

/** CSS custom properties for the reader chrome and background. */
export function themeVariables(reader) {
  const r = reader || {}
  const bg = color(r.background, '#0b1220')
  let background = bg
  if (r.backgroundMode === 'gradient') {
    background = 'linear-gradient(' + (Number(r.backgroundAngle) || 160) + 'deg, ' + bg + ', ' + color(r.backgroundTo, '#1e293b') + ')'
  } else if (r.backgroundMode === 'image' && typeof r.backgroundImage === 'string' && r.backgroundImage) {
    const safe = r.backgroundImage.replace(/["\\\n\r]/g, '')
    background = bg + ' url("' + safe + '") center / cover no-repeat'
  }
  const vars = {
    '--fs-reader-bg': background,
    '--fs-reader-bar': color(r.toolbar, 'rgba(2,6,23,0.55)'),
    '--fs-reader-text': color(r.toolbarText, '#e2e8f0'),
    '--fs-reader-btn': color(r.button, 'rgba(30,41,59,0.9)'),
    '--fs-accent': color(r.accent, '#2563eb'),
  }
  return vars
}

/** Solid colour for the page behind the reader (first paint, overscroll). */
export function themeBaseColor(reader) {
  return color(reader && reader.background, '#0b1220')
}

/**
 * Page-turn sound. Built-in sounds are synthesised (filtered noise shaped like
 * a page sliding and settling), so there is no audio file and no licence.
 * `custom` plays an uploaded sound file.
 */
export function createFlipSound(win, kind, customUrl) {
  let ctx = null
  let muted = false
  let audio = null
  let last = 0
  const AudioCtx = win.AudioContext || win.webkitAudioContext
  const tone = {
    paper: { dur: 0.42, from: 900, peak: 3800, end: 1700, q: 0.7, gain: 0.55, thump: 0.12, grains: 5 },
    soft: { dur: 0.5, from: 600, peak: 2400, end: 1100, q: 0.6, gain: 0.42, thump: 0.08, grains: 3 },
    crisp: { dur: 0.32, from: 1400, peak: 5200, end: 2600, q: 0.9, gain: 0.5, thump: 0.18, grains: 7 },
  }[kind]

  const synth = () => {
    if (!AudioCtx || !tone) return
    if (!ctx) ctx = new AudioCtx()
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume()
    const now = ctx.currentTime
    const length = Math.ceil(ctx.sampleRate * tone.dur)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    // Pink-ish noise with a few "grain" bursts: the rustle of paper fibres.
    let b0 = 0
    let b1 = 0
    const grains = []
    for (let g = 0; g < tone.grains; g += 1) grains.push({ at: 0.1 + Math.random() * 0.7, width: 0.015 + Math.random() * 0.03, amp: 0.4 + Math.random() * 0.6 })
    for (let i = 0; i < length; i += 1) {
      const t = i / length
      const white = Math.random() * 2 - 1
      b0 = 0.99765 * b0 + white * 0.099046
      b1 = 0.963 * b1 + white * 0.2965
      let sample = (b0 + b1 + white * 0.1848) * 0.35
      // Swell then settle: quick attack, longer tail.
      const env = t < 0.12 ? t / 0.12 : Math.pow(1 - (t - 0.12) / 0.88, 1.6)
      let grain = 0
      for (let g = 0; g < grains.length; g += 1) {
        const d = (t - grains[g].at) / grains[g].width
        if (d > -3 && d < 3) grain += grains[g].amp * Math.exp(-d * d)
      }
      sample *= env * (0.65 + grain)
      data[i] = sample
    }
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.Q.value = tone.q
    band.frequency.setValueAtTime(tone.from, now)
    band.frequency.exponentialRampToValueAtTime(tone.peak, now + tone.dur * 0.3)
    band.frequency.exponentialRampToValueAtTime(tone.end, now + tone.dur)
    const high = ctx.createBiquadFilter()
    high.type = 'highpass'
    high.frequency.value = 350
    const gain = ctx.createGain()
    gain.gain.value = tone.gain
    source.connect(band)
    band.connect(high)
    high.connect(gain)
    gain.connect(ctx.destination)
    source.start(now)
    // The page landing: a short, low, soft tap at the end.
    if (tone.thump > 0) {
      const osc = ctx.createOscillator()
      const tapGain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(140, now + tone.dur * 0.82)
      osc.frequency.exponentialRampToValueAtTime(70, now + tone.dur * 0.82 + 0.09)
      tapGain.gain.setValueAtTime(0.0001, now)
      tapGain.gain.setValueAtTime(0.0001, now + tone.dur * 0.82)
      tapGain.gain.exponentialRampToValueAtTime(tone.thump, now + tone.dur * 0.82 + 0.008)
      tapGain.gain.exponentialRampToValueAtTime(0.0001, now + tone.dur * 0.82 + 0.1)
      osc.connect(tapGain)
      tapGain.connect(ctx.destination)
      osc.start(now + tone.dur * 0.8)
      osc.stop(now + tone.dur + 0.15)
    }
  }

  return {
    get enabled() { return kind !== 'none' && (kind !== 'custom' || !!customUrl) },
    get muted() { return muted },
    setMuted(value) { muted = !!value },
    /** Call from a click/touch/key handler: browsers only start audio after a user gesture. */
    unlock() {
      if (kind === 'none' || kind === 'custom' || !AudioCtx) return
      try {
        if (!ctx) ctx = new AudioCtx()
        if (ctx.state === 'suspended' && ctx.resume) ctx.resume()
      } catch (error) {
        void error
      }
    },
    play() {
      if (muted || kind === 'none') return
      const time = Date.now()
      if (time - last < 350) return
      last = time
      try {
        if (kind === 'custom') {
          if (!customUrl) return
          if (!audio) audio = new win.Audio(customUrl)
          audio.currentTime = 0
          const playing = audio.play()
          if (playing && playing.catch) playing.catch(() => undefined)
          return
        }
        synth()
      } catch (error) {
        void error
      }
    },
    destroy() {
      if (ctx && ctx.close) ctx.close().catch(() => undefined)
      ctx = null
      if (audio) audio.pause()
      audio = null
    },
  }
}
