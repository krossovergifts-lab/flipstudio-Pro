import { createClock, createSlideshowController, overlayStyle, sampleFrames, slideClassName, slideTransitionMs, timelineDuration, timelineLoops } from './engine.js'
import { HOTSPOT_MARKERS, cropStyle, frameStyle, resolveAction, skinClassName, skinStyle, styleFor } from './styles.js'
import { createFlipSound, flipSettings, themeVariables } from './theme.js'

// FlipStudio Pro publication reader.
//
// Mounted by the editor's Preview mode AND inlined into exported HTML/ZIP
// publications, so Preview is the export. It renders the real pages and objects,
// drives StPageFlip for page turns, runs slideshows through the shared
// slideshow controller and evaluates animations with the shared engine clock.
//
// `mountPublication` returns a handle whose destroy() cancels the animation
// frame, slideshow timers, observers, listeners and the PageFlip instance.

export function mountPublication(root, data, options) {
  const opts = options || {}
  const PageFlipCtor = opts.PageFlip || null
  const doc = root.ownerDocument
  const win = doc.defaultView
  const pages = data.pages || []
  const animations = data.animations || []
  const cleanups = []
  const controllers = []
  const animated = {}
  let currentPage = Math.min(Math.max(0, Number(opts.startPage) || 0), Math.max(0, pages.length - 1))
  let book = null
  let bookPortrait = null
  let pageFlipFailed = false
  let destroyed = false
  let selectMode = false
  let bookMouse = null
  const hasText = pages.some((page) => page.text && page.text.length)
  const readerSettings = data.reader || {}
  const textTools = hasText && readerSettings.textTools !== false
  const flip = flipSettings(readerSettings)
  const sound = createFlipSound(win, readerSettings.sound || 'paper', readerSettings.soundUrl)
  const storage = (() => { try { return win.localStorage } catch (error) { void error; return null } })()
  try { if (storage && storage.getItem('fs-sound-muted') === '1') sound.setMuted(true) } catch (error) { void error }
  const ZOOMS = [1, 1.6, 2.4]
  let zoom = 1
  let panX = 0
  let panY = 0
  const mouseFlipping = () => !selectMode && zoom === 1

  const make = (tag, className, attrs) => {
    const el = doc.createElement(tag)
    if (className) el.className = className
    if (attrs) Object.keys(attrs).forEach((key) => el.setAttribute(key, attrs[key]))
    return el
  }
  const listen = (target, type, handler, capture) => {
    target.addEventListener(type, handler, capture)
    cleanups.push(() => target.removeEventListener(type, handler, capture))
  }
  const applyStyle = (el, style) => {
    Object.keys(style).forEach((key) => {
      if (key.indexOf('--') === 0) el.style.setProperty(key, style[key])
      else el.style[key] = style[key]
    })
  }

  // ---------- chrome ----------
  root.replaceChildren()
  root.classList.add('fs-reader')
  const themeVars = themeVariables(readerSettings)
  applyStyle(root, themeVars)
  if (readerSettings.bookShadow === false) root.classList.add('fs-no-book-shadow')
  const ICONS = {
    prev: '<path d="M15 18l-6-6 6-6"/>',
    next: '<path d="M9 18l6-6-6-6"/>',
    pages: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    zoom: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>',
    zoomOut: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    select: '<path d="M9 4h6M9 20h6M12 4v16"/>',
    sound: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12"/>',
    muted: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  }
  const setIcon = (button, icon, label) => {
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + ICONS[icon] + '</svg><span class="fs-btn-label"></span>'
    button.lastChild.textContent = label
    button.setAttribute('aria-label', label)
    button.setAttribute('title', label)
  }
  const iconButton = (action, icon, label, extraClass, attrs) => {
    const button = make('button', 'fs-reader-btn fs-icon-btn' + (extraClass ? ' ' + extraClass : ''), Object.assign({ type: 'button', 'data-action': action }, attrs || {}))
    setIcon(button, icon, label)
    return button
  }
  const topBar = make('div', 'fs-reader-bar fs-reader-top')
  const leftGroup = make('div', 'fs-bar-group fs-bar-left')
  const centerGroup = make('div', 'fs-bar-group fs-bar-center')
  const rightGroup = make('div', 'fs-bar-group fs-bar-right')
  if (readerSettings.logo) {
    const logo = make(readerSettings.logoLink ? 'a' : 'span', 'fs-reader-logo')
    if (readerSettings.logoLink) {
      const href = resolveAction({ type: 'button', link: { type: 'url', value: readerSettings.logoLink } })
      if (href && href.kind === 'href') {
        logo.setAttribute('href', href.href)
        logo.setAttribute('target', '_blank')
        logo.setAttribute('rel', 'noopener noreferrer')
      }
    }
    logo.append(make('img', '', { src: readerSettings.logo, alt: '' }))
    leftGroup.append(logo)
  }
  const prevButton = iconButton('previous-page', 'prev', 'Previous page')
  const pageCount = make('span', 'fs-reader-count', { 'aria-live': 'polite', 'data-role': 'page-count' })
  const nextButton = iconButton('next-page', 'next', 'Next page')
  const thumbsButton = iconButton('thumbnails', 'pages', 'All pages', '', { 'aria-expanded': 'false' })
  const zoomButton = iconButton('zoom', 'zoom', 'Zoom in', '', { 'aria-pressed': 'false' })
  const fullscreenButton = iconButton('fullscreen', 'full', 'Full screen', 'fs-reader-fullscreen')
  const selectButton = iconButton('select-text', 'select', 'Select text', 'fs-reader-select', { 'aria-pressed': 'false' })
  const searchButton = iconButton('search', 'search', 'Search', 'fs-reader-search', { 'aria-expanded': 'false' })
  const soundButton = iconButton('sound', sound.muted ? 'muted' : 'sound', sound.muted ? 'Turn page sound on' : 'Mute page sound', 'fs-reader-sound', { 'aria-pressed': String(!sound.muted) })
  centerGroup.append(prevButton, pageCount, nextButton)
  if (pages.length > 2 && readerSettings.thumbnails !== false) rightGroup.append(thumbsButton)
  rightGroup.append(zoomButton)
  if (textTools) rightGroup.append(searchButton, selectButton)
  if (sound.enabled) rightGroup.append(soundButton)
  rightGroup.append(fullscreenButton)
  topBar.append(leftGroup, centerGroup, rightGroup)

  const stage = make('div', 'fs-stage')
  const host = make('div', 'fs-book-host')
  stage.append(host)

  const bottomBar = make('div', 'fs-reader-bar fs-reader-bottom')
  const playButton = make('button', 'fs-reader-btn', { type: 'button', 'data-action': 'play' })
  playButton.textContent = 'Play'
  const stopButton = make('button', 'fs-reader-btn', { type: 'button', 'data-action': 'stop' })
  stopButton.textContent = 'Stop'
  const duration = timelineDuration(animations)
  const loops = timelineLoops(animations)
  const scrubber = make('input', 'fs-reader-scrub', { type: 'range', min: '0', max: String(duration || 0), step: '0.01', value: '0', 'aria-label': 'Animation timeline', 'data-action': 'scrub' })
  const timeLabel = make('span', 'fs-reader-time', { 'data-role': 'time' })
  timeLabel.textContent = '0.00s'
  bottomBar.append(playButton, stopButton, scrubber, timeLabel)
  if (!animations.length) {
    bottomBar.hidden = true
  }
  root.append(topBar, stage, bottomBar)

  // ---------- objects ----------
  const createSlideshow = (overlay, el) => {
    const slides = overlay.slides || []
    const fit = 'fs-fit-' + (overlay.fit || 'cover')
    const wrap = make('div', 'fs-slides', { 'data-transition': overlay.transition || 'fade' })
    wrap.style.setProperty('--fs-transition', slideTransitionMs(overlay) + 'ms')
    const images = slides.map((slide, index) => {
      const img = make('img', 'fs-slide ' + fit, { alt: slide.alt || overlay.label || 'Slide ' + (index + 1), draggable: 'false', 'data-slide-index': String(index) })
      if (slide.src) img.src = slide.src
      applyStyle(img, cropStyle(overlay))
      wrap.append(img)
      return img
    })
    el.append(wrap)
    if (!slides.length) {
      const empty = make('div', 'fs-placeholder')
      empty.textContent = 'Slideshow has no images'
      el.append(empty)
      return
    }
    const indicators = overlay.showIndicators || 'dots'
    let marks = []
    if (slides.length > 1 && indicators === 'dots') {
      const dots = make('div', 'fs-ss-dots')
      marks = slides.map((_, index) => {
        const dot = make('button', 'fs-ss-dot', { type: 'button', 'aria-label': 'Show slide ' + (index + 1) })
        dot.addEventListener('click', (event) => { event.stopPropagation(); controller.goTo(index) })
        dots.append(dot)
        return dot
      })
      el.append(dots)
    } else if (slides.length > 1 && indicators === 'thumbnails') {
      const strip = make('div', 'fs-ss-thumbs')
      marks = slides.map((slide, index) => {
        const thumb = make('button', 'fs-ss-thumb', { type: 'button', 'aria-label': 'Show slide ' + (index + 1) })
        const img = make('img', '', { alt: '', draggable: 'false' })
        if (slide.src) img.src = slide.src
        thumb.append(img)
        thumb.addEventListener('click', (event) => { event.stopPropagation(); controller.goTo(index) })
        strip.append(thumb)
        return thumb
      })
      el.append(strip)
    }
    const render = (index, previous, direction) => {
      images.forEach((img, i) => { img.className = slideClassName(i, index, previous, direction) + ' ' + fit })
      marks.forEach((mark, i) => mark.classList.toggle('is-active', i === index))
      el.setAttribute('data-slide', String(index))
    }
    const controller = createSlideshowController(overlay, render)
    controllers.push(controller)
    if (slides.length > 1 && overlay.showControls !== false) {
      const prev = make('button', 'fs-ss-nav fs-ss-prev', { type: 'button', 'aria-label': 'Previous slide' })
      prev.textContent = '‹'
      const next = make('button', 'fs-ss-nav fs-ss-next', { type: 'button', 'aria-label': 'Next slide' })
      next.textContent = '›'
      prev.addEventListener('click', (event) => { event.stopPropagation(); controller.previous() })
      next.addEventListener('click', (event) => { event.stopPropagation(); controller.next() })
      el.append(prev, next)
    }
    el.addEventListener('pointerenter', () => controller.setHover(true))
    el.addEventListener('pointerleave', () => controller.setHover(false))
    if (overlay.autoplay) controller.play()
  }

  // ---------- actions (links, go to page, pop-ups) ----------
  let popupEl = null
  const closePopup = () => {
    if (popupEl) popupEl.remove()
    popupEl = null
  }
  const openPopup = (popup) => {
    closePopup()
    const backdrop = make('div', 'fs-popup-backdrop', { role: 'dialog', 'aria-modal': 'true', 'aria-label': popup.title || 'Details' })
    const card = make('div', 'fs-popup')
    const close = make('button', 'fs-popup-close', { type: 'button', 'aria-label': 'Close' })
    close.textContent = '\u00d7'
    close.addEventListener('click', closePopup)
    card.append(close)
    if (popup.image) card.append(make('img', '', { src: popup.image, alt: popup.title || '' }))
    const body = make('div', 'fs-popup-body')
    if (popup.title) {
      const title = make('h2', 'fs-popup-title')
      title.textContent = popup.title
      body.append(title)
    }
    if (popup.price) {
      const price = make('div', 'fs-popup-price')
      price.textContent = popup.price
      body.append(price)
    }
    if (popup.description) {
      const text = make('p', 'fs-popup-text')
      text.textContent = popup.description
      body.append(text)
    }
    const cta = popup.link ? resolveAction({ type: 'button', link: popup.link }) : null
    if (cta && cta.kind === 'href') {
      const link = make('a', 'fs-popup-cta', { href: cta.href })
      if (cta.newTab) {
        link.setAttribute('target', '_blank')
        link.setAttribute('rel', 'noopener noreferrer')
      }
      link.textContent = popup.buttonLabel || 'Learn more'
      body.append(link)
    } else if (cta && cta.kind === 'page') {
      const link = make('button', 'fs-popup-cta', { type: 'button' })
      link.textContent = popup.buttonLabel || 'Go to page'
      link.addEventListener('click', () => { closePopup(); openPage(cta.page) })
      body.append(link)
    }
    card.append(body)
    backdrop.append(card)
    backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closePopup() })
    stage.append(backdrop)
    popupEl = backdrop
    close.focus()
  }
  const runAction = (action, overlay) => {
    if (!action) return
    if (action.kind === 'page') openPage(action.page)
    else if (action.kind === 'popup' && overlay.popup) openPopup(overlay.popup)
  }

  const buildSkin = (overlay, page) => {
    const skin = make('div', skinClassName(overlay))
    applyStyle(skin, skinStyle(overlay, page, overlay.fontStack))
    const s = styleFor(overlay)
    if (overlay.type !== 'hotspot' || s.showLabel) {
      const text = make('span', 'fs-text', { dir: 'auto' })
      text.textContent = overlay.label || ''
      skin.append(text)
    }
    if (overlay.type === 'hotspot') {
      const marker = s.marker && s.marker !== 'none' ? s.marker : overlay.effect === 'beacon' ? 'dot' : 'none'
      if (marker !== 'none') {
        const dot = make('span', 'fs-marker', { 'data-marker': marker, 'aria-hidden': 'true' })
        dot.textContent = HOTSPOT_MARKERS[marker] || ''
        skin.append(dot)
      }
    }
    return skin
  }

  const createOverlay = (overlay, page) => {
    const action = resolveAction(overlay)
    const isHref = action && action.kind === 'href'
    const el = make(isHref ? 'a' : 'div', 'fs-overlay', { 'data-type': overlay.type, 'data-object-id': overlay.id })
    if (isHref) {
      el.setAttribute('href', action.href)
      if (action.newTab) {
        el.setAttribute('target', '_blank')
        el.setAttribute('rel', 'noopener noreferrer')
      }
      el.setAttribute('data-action', 'link')
    } else if (action) {
      el.setAttribute('role', 'button')
      el.setAttribute('tabindex', '0')
      el.setAttribute('data-action', action.kind)
      el.addEventListener('click', (event) => { event.preventDefault(); runAction(action, overlay) })
      el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); runAction(action, overlay) }
      })
    }
    if (overlay.type === 'text' || overlay.type === 'button' || overlay.type === 'hotspot') {
      el.append(buildSkin(overlay, page))
      el.setAttribute('aria-label', overlay.label || overlay.type)
    } else if (overlay.type === 'image') {
      if (overlay.src) {
        const img = make('img', 'fs-image fs-fit-' + (overlay.fit || 'cover'), { src: overlay.src, alt: overlay.label || '', draggable: 'false' })
        applyStyle(img, cropStyle(overlay))
        el.append(img)
      } else {
        const empty = make('div', 'fs-placeholder')
        empty.textContent = 'Missing image'
        el.append(empty)
      }
    } else if (overlay.type === 'slideshow') {
      createSlideshow(overlay, el)
    } else if (overlay.type === 'video' || overlay.type === 'audio') {
      if (overlay.src) {
        const media = make(overlay.type, '', { src: overlay.src, controls: '', preload: 'metadata' })
        media.style.width = '100%'
        media.style.height = '100%'
        el.append(media)
      } else {
        el.textContent = overlay.label || ''
      }
    } else {
      el.textContent = overlay.label || ''
    }
    if (overlay.tooltip) {
      const tip = make('span', 'fs-tooltip', { role: 'tooltip' })
      tip.textContent = overlay.tooltip
      el.append(tip)
    }
    applyStyle(el, overlayStyle(overlay, page, null))
    if (overlay.type === 'image' || overlay.type === 'slideshow') applyStyle(el, frameStyle(overlay, page))
    animated[overlay.id] = { el, overlay, page }
    return el
  }

  // ---------- text layer (selectable, copyable, searchable PDF text) ----------
  const textSpans = pages.map(() => [])
  const pageTexts = pages.map(() => ({ text: '', starts: [] }))
  const pct = (value) => Math.round(value * 1000000) / 10000 + '%'
  const buildTextLayer = (page, index) => {
    const layer = make('div', 'fs-textlayer')
    let joined = ''
    page.text.forEach((item) => {
      const span = make('span', '', { 'data-w': String(item.w) })
      span.textContent = item.s
      span.style.left = pct(item.x / page.width)
      span.style.top = pct(item.y / page.height)
      span.style.fontSize = Math.round((item.h / page.width) * 1000000) / 10000 + 'cqw'
      if (item.f) span.style.fontFamily = item.f
      if (item.a) span.style.setProperty('--fs-angle', item.a + 'deg')
      layer.append(span)
      if (item.eol) layer.append(make('br'))
      pageTexts[index].starts.push(joined.length)
      // Runs are joined with single spaces so phrases that wrap across lines are still found.
      joined += /\s$/.test(item.s) ? item.s : item.s + ' '
      textSpans[index].push(span)
    })
    pageTexts[index].text = joined
    return layer
  }
  /** Stretches each text run to the width it has in the PDF (font metrics differ). Size-independent, so done once. */
  const fitText = (index) => {
    const el = pageElements[index]
    if (!el || el.getAttribute('data-text-fit') === '1' || !textSpans[index].length) return
    const pageWidth = el.clientWidth
    if (!pageWidth) return
    const page = pages[index]
    textSpans[index].forEach((span) => {
      const natural = span.offsetWidth
      const target = (Number(span.getAttribute('data-w')) / page.width) * pageWidth
      if (natural > 0 && target > 0) span.style.setProperty('--fs-scale-x', String(Math.round((target / natural) * 10000) / 10000))
    })
    el.setAttribute('data-text-fit', '1')
  }
  const fitVisibleText = () => {
    if (!hasText) return
    visiblePages().forEach(fitText)
  }

  const pageElements = pages.map((page, index) => {
    const el = make('div', 'fs-page fs-book-page', { 'data-page-index': String(index), 'data-page-id': page.id })
    // Page images load lazily (only pages near the one being read), so a 250-page catalogue opens instantly.
    if (page.background) el.append(make('img', 'fs-page-bg', { alt: page.name || 'Page ' + (index + 1), draggable: 'false', decoding: 'async' }))
    else el.append(make('div', 'fs-page-blank'))
    if (page.text && page.text.length) el.append(buildTextLayer(page, index))
    ;(page.overlays || []).forEach((overlay) => {
      if (overlay.visible === false) return
      el.append(createOverlay(overlay, page))
    })
    return el
  })

  const pageImages = pageElements.map((el) => el.querySelector('img.fs-page-bg'))
  const LOAD_BEHIND = 3
  const LOAD_AHEAD = 6
  const KEEP = 14
  const loadPageImages = (around) => {
    const centre = typeof around === 'number' ? around : currentPage
    pageImages.forEach((img, index) => {
      if (!img) return
      const distance = index - centre
      if (distance >= -LOAD_BEHIND && distance <= LOAD_AHEAD) {
        if (img.getAttribute('src') !== pages[index].background) img.setAttribute('src', pages[index].background)
      } else if (Math.abs(distance) > KEEP && img.hasAttribute('src')) {
        img.removeAttribute('src')
      }
    })
  }
  loadPageImages(currentPage)

  // ---------- animation ----------
  const renderAnimations = (time, state) => {
    const frames = state === 'stopped' && opts.designStateWhenStopped ? {} : sampleFrames(animations, time)
    Object.keys(animated).forEach((id) => {
      const entry = animated[id]
      const css = overlayStyle(entry.overlay, entry.page, frames[id] || null)
      entry.el.style.left = css.left
      entry.el.style.top = css.top
      entry.el.style.opacity = css.opacity
      entry.el.style.transform = css.transform
    })
  }
  const clock = createClock({
    duration,
    loops,
    onTick: (time, state) => {
      renderAnimations(time, state)
      if (doc.activeElement !== scrubber) scrubber.value = String(Math.min(time, duration))
      timeLabel.textContent = time.toFixed(2) + 's'
      playButton.textContent = state === 'playing' ? 'Pause' : 'Play'
      playButton.setAttribute('data-state', state)
      root.setAttribute('data-playback', state)
      if (opts.onTimeChange) opts.onTimeChange(time, state)
    },
  })
  renderAnimations(0, 'paused')
  listen(playButton, 'click', () => { if (clock.state === 'playing') clock.pause(); else clock.play() })
  listen(stopButton, 'click', () => clock.stop())
  listen(scrubber, 'input', () => clock.seek(Number(scrubber.value)))

  // ---------- pages ----------
  /** Indices of the pages currently on screen (one page, or a two-page spread). */
  const visiblePages = () => {
    if (!book || bookPortrait || pages.length < 2) return [currentPage]
    if (pages.length > 2) {
      // showCover: the cover is alone, then spreads start on odd indices.
      if (currentPage === 0) return [0]
      const left = currentPage % 2 === 1 ? currentPage : currentPage - 1
      return left + 1 < pages.length ? [left, left + 1] : [left]
    }
    return [0, 1]
  }
  const updateCount = () => {
    const total = pages.length
    const spread = visiblePages()
    const first = spread[0]
    const last = spread[spread.length - 1]
    pageCount.textContent = (total ? (first === last ? String(first + 1) : (first + 1) + '–' + (last + 1)) : '0') + ' / ' + total
    prevButton.disabled = first <= 0
    nextButton.disabled = last >= total - 1
    root.setAttribute('data-current-page', String(currentPage))
  }
  const onPageOpened = () => {
    updateCount()
    loadPageImages()
    if (thumbsPanel) markThumbs()
    if (hasText) win.requestAnimationFrame(fitVisibleText)
    if (opts.onPageChange) opts.onPageChange(currentPage)
    if (animations.length && data.restartAnimationsOnPageTurn !== false) clock.restart()
  }

  const ratio = pages.length ? pages[0].width / pages[0].height : 0.707
  const measure = () => {
    const rect = stage.getBoundingClientRect()
    return { width: Math.max(0, rect.width - 16), height: Math.max(0, rect.height - 16) }
  }
  const wantsPortrait = (size) => pages.length < 2 || opts.forceSinglePage || size.width < size.height * ratio * 1.35

  const layoutFallback = () => {
    const size = measure()
    let height = size.height
    let width = height * ratio
    if (width > size.width) { width = size.width; height = width / ratio }
    pageElements.forEach((el, index) => {
      el.style.width = Math.max(1, Math.floor(width)) + 'px'
      el.style.height = Math.max(1, Math.floor(height)) + 'px'
      el.hidden = index !== currentPage
    })
  }

  const buildBook = () => {
    const size = measure()
    const portrait = wantsPortrait(size)
    const spreadRatio = portrait ? ratio : ratio * 2
    let width = Math.min(size.width, size.height * spreadRatio)
    if (!width || width < 40) width = Math.max(40, size.width)
    if (book && bookPortrait === portrait && bookMouse === mouseFlipping()) {
      host.firstElementChild.style.width = Math.floor(width) + 'px'
      book.update()
      return
    }
    if (book) {
      book.destroy()
      book = null
    }
    const mount = make('div', 'fs-book')
    mount.style.width = Math.floor(width) + 'px'
    host.replaceChildren(mount)
    bookPortrait = portrait
    if (!PageFlipCtor || pageFlipFailed || !pages.length) {
      pageElements.forEach((el) => mount.append(el))
      layoutFallback()
      updateCount()
      return
    }
    try {
      book = createBook(mount, portrait)
    } catch (error) {
      // A page-turn engine failure must not take the publication down: fall
      // back to one-page-at-a-time navigation with the same pages and objects.
      if (win.console) win.console.warn('FlipStudio: page-turn engine unavailable, using simple navigation.', error)
      book = null
      pageFlipFailed = true
      mount.replaceChildren(...pageElements)
      layoutFallback()
    }
    updateCount()
  }

  const createBook = (mount, portrait) => {
    const instance = new PageFlipCtor(mount, {
      width: pages[0].width,
      height: pages[0].height,
      size: 'stretch',
      minWidth: portrait ? 100000 : 1,
      maxWidth: 6000,
      minHeight: 1,
      maxHeight: 6000,
      usePortrait: portrait,
      autoSize: true,
      showCover: pages.length > 2,
      drawShadow: flip.shadow > 0,
      maxShadowOpacity: Math.max(0.01, flip.shadow),
      flippingTime: flip.time,
      startPage: currentPage,
      mobileScrollSupport: false,
      clickEventForward: true,
      disableFlipByClick: true,
      // While selecting text, dragging must select instead of turning the page.
      useMouseEvents: mouseFlipping(),
      showPageCorners: flip.corners,
    })
    bookMouse = mouseFlipping()
    mount.style.minWidth = '0'
    mount.style.minHeight = '0'
    try {
      instance.loadFromHTML(pageElements)
    } catch (error) {
      try { instance.destroy() } catch (destroyError) { void destroyError }
      host.replaceChildren(mount)
      throw error
    }
    // PageFlip's UI (created by loadFromHTML) sets min-width to minWidth×2; in portrait
    // mode that is the huge value used to force single pages, which would make the
    // book overflow the screen on phones. Reset it and lay out again.
    if (mount.style.minWidth !== '0px') {
      mount.style.minWidth = '0'
      mount.style.minHeight = '0'
      if (typeof instance.update === 'function') instance.update()
    }
    // StPageFlip always makes the cover a stiff board; "soft" lets it bend like the inner pages.
    if (flip.cover === 'soft' && typeof instance.getPage === 'function') {
      try {
        const count = typeof instance.getPageCount === 'function' ? instance.getPageCount() : pages.length
        ;[0, count - 1].forEach((index) => {
          const page = instance.getPage(index)
          if (page && typeof page.setDensity === 'function') page.setDensity('soft')
        })
      } catch (error) { void error }
    }
    instance.on('changeState', (event) => {
      if (event && event.data === 'flipping') sound.play()
    })
    instance.on('flip', (event) => {
      currentPage = Number(event.data) || 0
      onPageOpened()
    })
    return instance
  }

  const goPage = (direction) => {
    if (book) {
      if (direction > 0) book.flipNext()
      else book.flipPrev()
      return
    }
    const next = Math.min(pages.length - 1, Math.max(0, currentPage + direction))
    if (next === currentPage) return
    currentPage = next
    sound.play()
    layoutFallback()
    onPageOpened()
  }
  /** Opens a page by index (used by "go to page" links). */
  const openPage = (index) => {
    const target = Math.min(pages.length - 1, Math.max(0, index))
    loadPageImages(target)
    if (book) {
      if (typeof book.flip === 'function') book.flip(target)
      else book.turnToPage(target)
      return
    }
    if (target === currentPage) return
    currentPage = target
    layoutFallback()
    onPageOpened()
  }
  // ---------- select text & search ----------
  const setSelectMode = (on) => {
    selectMode = !!on
    root.classList.toggle('fs-selecting', selectMode)
    selectButton.setAttribute('aria-pressed', String(selectMode))
    setIcon(selectButton, 'select', selectMode ? 'Done selecting' : 'Select text')
    if (selectMode && zoom !== 1) setZoom(1)
    if (!selectMode && win.getSelection) {
      const selection = win.getSelection()
      if (selection && selection.removeAllRanges) selection.removeAllRanges()
    }
    if (book) buildBook()
    win.requestAnimationFrame(fitVisibleText)
  }
  listen(selectButton, 'click', () => setSelectMode(!selectMode))

  // ---------- zoom ----------
  const clampPan = () => {
    const rect = stage.getBoundingClientRect()
    const maxX = ((zoom - 1) * rect.width) / 2
    const maxY = ((zoom - 1) * rect.height) / 2
    panX = Math.max(-maxX, Math.min(maxX, panX))
    panY = Math.max(-maxY, Math.min(maxY, panY))
  }
  const applyZoom = () => {
    clampPan()
    host.style.transform = zoom === 1 ? '' : 'translate(' + Math.round(panX) + 'px, ' + Math.round(panY) + 'px) scale(' + zoom + ')'
    root.classList.toggle('fs-zoomed', zoom > 1)
    zoomButton.setAttribute('aria-pressed', String(zoom > 1))
    const last = zoom >= ZOOMS[ZOOMS.length - 1]
    setIcon(zoomButton, last ? 'zoomOut' : 'zoom', last ? 'Zoom out' : 'Zoom in')
  }
  /** Zooms to `level`, keeping the point (clientX, clientY) under the pointer. */
  const setZoom = (level, clientX, clientY) => {
    const previous = zoom
    const next = Math.max(1, Math.min(ZOOMS[ZOOMS.length - 1], level))
    if (next === previous) return
    if (next > 1 && selectMode) setSelectMode(false)
    const rect = stage.getBoundingClientRect()
    const px = (typeof clientX === 'number' ? clientX : rect.left + rect.width / 2) - (rect.left + rect.width / 2)
    const py = (typeof clientY === 'number' ? clientY : rect.top + rect.height / 2) - (rect.top + rect.height / 2)
    if (next === 1) {
      panX = 0
      panY = 0
    } else {
      panX = px - (px - panX) * (next / previous)
      panY = py - (py - panY) * (next / previous)
    }
    const flipModeChanged = (previous === 1) !== (next === 1)
    zoom = next
    applyZoom()
    // Dragging pans the zoomed page instead of turning it.
    if (flipModeChanged && book) buildBook()
  }
  listen(zoomButton, 'click', () => {
    const index = ZOOMS.indexOf(zoom)
    setZoom(index >= 0 && index < ZOOMS.length - 1 ? ZOOMS[index + 1] : 1)
  })
  listen(stage, 'dblclick', (event) => {
    if (selectMode || (event.target && event.target.closest && event.target.closest('.fs-overlay, .fs-search, .fs-thumbs, .fs-popup-backdrop'))) return
    event.preventDefault()
    setZoom(zoom === 1 ? 2 : 1, event.clientX, event.clientY)
  })
  listen(stage, 'wheel', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    setZoom(zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15), event.clientX, event.clientY)
  }, { passive: false })
  let panStart = null
  listen(stage, 'pointerdown', (event) => {
    if (zoom === 1 || selectMode || event.button !== 0) return
    if (event.target && event.target.closest && event.target.closest('.fs-overlay, .fs-search, .fs-thumbs, button, a')) return
    panStart = { x: event.clientX, y: event.clientY, panX, panY, id: event.pointerId }
    root.classList.add('fs-panning')
    if (stage.setPointerCapture) { try { stage.setPointerCapture(event.pointerId) } catch (error) { void error } }
  })
  listen(stage, 'pointermove', (event) => {
    if (!panStart || event.pointerId !== panStart.id) return
    panX = panStart.panX + (event.clientX - panStart.x)
    panY = panStart.panY + (event.clientY - panStart.y)
    applyZoom()
  })
  const endPan = () => {
    panStart = null
    root.classList.remove('fs-panning')
  }
  listen(stage, 'pointerup', endPan)
  listen(stage, 'pointercancel', endPan)

  // ---------- page-turn sound ----------
  listen(soundButton, 'click', () => {
    sound.setMuted(!sound.muted)
    try { if (storage) storage.setItem('fs-sound-muted', sound.muted ? '1' : '0') } catch (error) { void error }
    setIcon(soundButton, sound.muted ? 'muted' : 'sound', sound.muted ? 'Turn page sound on' : 'Mute page sound')
    soundButton.setAttribute('aria-pressed', String(!sound.muted))
  })

  // ---------- all pages (thumbnails) and go to page ----------
  let thumbsPanel = null
  let thumbButtons = []
  const markThumbs = () => {
    const visible = visiblePages()
    thumbButtons.forEach((button, index) => button.classList.toggle('is-current', visible.indexOf(index) >= 0))
  }
  const closeThumbs = () => {
    if (!thumbsPanel) return
    thumbsPanel.remove()
    thumbsPanel = null
    thumbButtons = []
    thumbsButton.setAttribute('aria-expanded', 'false')
  }
  const openThumbs = () => {
    if (thumbsPanel) { closeThumbs(); return }
    const panel = make('div', 'fs-thumbs', { role: 'dialog', 'aria-label': 'All pages' })
    const head = make('div', 'fs-thumbs-head')
    const title = make('strong')
    title.textContent = pages.length + ' pages'
    const form = make('form', 'fs-thumbs-go')
    const input = make('input', '', { type: 'number', min: '1', max: String(pages.length), placeholder: 'Page', 'aria-label': 'Go to page number' })
    const go = make('button', 'fs-reader-btn', { type: 'submit' })
    go.textContent = 'Go'
    form.append(input, go)
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const number = Math.floor(Number(input.value))
      if (number >= 1 && number <= pages.length) {
        closeThumbs()
        if (zoom !== 1) setZoom(1)
        openPage(number - 1)
      }
    })
    const close = make('button', 'fs-search-close', { type: 'button', 'aria-label': 'Close pages' })
    close.textContent = '\u00d7'
    close.addEventListener('click', closeThumbs)
    head.append(title, form, close)
    const grid = make('div', 'fs-thumbs-grid')
    thumbButtons = pages.map((page, index) => {
      const button = make('button', 'fs-thumb', { type: 'button', 'aria-label': 'Page ' + (index + 1) })
      const src = page.thumb || page.background
      if (src) button.append(make('img', '', { src, alt: '', loading: 'lazy', decoding: 'async' }))
      else button.append(make('span', 'fs-thumb-blank'))
      const label = make('span', 'fs-thumb-label')
      label.textContent = String(index + 1)
      button.append(label)
      button.addEventListener('click', () => {
        closeThumbs()
        if (zoom !== 1) setZoom(1)
        openPage(index)
      })
      grid.append(button)
      return button
    })
    panel.append(head, grid)
    stage.append(panel)
    thumbsPanel = panel
    thumbsButton.setAttribute('aria-expanded', 'true')
    markThumbs()
    const current = thumbButtons[currentPage]
    if (current && current.scrollIntoView) current.scrollIntoView({ block: 'center' })
    input.focus()
  }
  listen(thumbsButton, 'click', openThumbs)

  let searchPanel = null
  const clearHits = () => {
    root.querySelectorAll('.fs-textlayer .fs-hit').forEach((span) => span.classList.remove('fs-hit'))
  }
  /** All matches of `query` (case-insensitive) as { page, start, end }. */
  const findMatches = (query) => {
    const needle = query.replace(/\s+/g, ' ').toLocaleLowerCase()
    const results = []
    pageTexts.forEach((entry, page) => {
      const haystack = entry.text.toLocaleLowerCase()
      let from = 0
      while (needle && results.length < 200) {
        const at = haystack.indexOf(needle, from)
        if (at < 0) break
        results.push({ page, start: at, end: at + needle.length })
        from = at + needle.length
      }
    })
    return results
  }
  const highlight = (match) => {
    clearHits()
    const starts = pageTexts[match.page].starts
    textSpans[match.page].forEach((span, i) => {
      const start = starts[i]
      const end = start + span.textContent.length
      if (end > match.start && start < match.end) span.classList.add('fs-hit')
    })
    fitText(match.page)
  }
  const closeSearch = () => {
    if (!searchPanel) return
    searchPanel.remove()
    searchPanel = null
    clearHits()
    searchButton.setAttribute('aria-expanded', 'false')
  }
  const openSearch = () => {
    if (searchPanel) { searchPanel.querySelector('input').focus(); return }
    const panel = make('div', 'fs-search', { role: 'search' })
    const input = make('input', 'fs-search-input', { type: 'search', placeholder: 'Search text…', 'aria-label': 'Search text' })
    const close = make('button', 'fs-search-close', { type: 'button', 'aria-label': 'Close search' })
    close.textContent = '\u00d7'
    const status = make('div', 'fs-search-status', { 'aria-live': 'polite' })
    const list = make('ol', 'fs-search-results')
    const head = make('div', 'fs-search-head')
    head.append(input, close)
    panel.append(head, status, list)
    let timer = 0
    const run = () => {
      list.replaceChildren()
      const query = input.value.trim()
      if (query.length < 2) { status.textContent = query ? 'Type at least 2 letters.' : ''; clearHits(); return }
      const matches = findMatches(query)
      status.textContent = matches.length ? matches.length + (matches.length >= 200 ? '+' : '') + ' result' + (matches.length === 1 ? '' : 's') : 'No results'
      matches.slice(0, 100).forEach((match) => {
        const text = pageTexts[match.page].text
        const item = make('li')
        const button = make('button', 'fs-search-hit', { type: 'button' })
        const label = make('strong')
        label.textContent = 'Page ' + (match.page + 1)
        const before = text.slice(Math.max(0, match.start - 30), match.start).replace(/\s+/g, ' ')
        const after = text.slice(match.end, match.end + 40).replace(/\s+/g, ' ')
        const mark = make('mark')
        mark.textContent = text.slice(match.start, match.end)
        const snippet = make('span')
        snippet.append((match.start > 30 ? '…' : '') + before, mark, after + '…')
        button.append(label, snippet)
        button.addEventListener('click', () => {
          openPage(match.page)
          // Highlight once the page is on screen (after the flip starts).
          win.requestAnimationFrame(() => highlight(match))
          win.setTimeout(() => highlight(match), 750)
        })
        item.append(button)
        list.append(item)
      })
      if (matches[0]) highlight(matches[0])
    }
    input.addEventListener('input', () => { win.clearTimeout(timer); timer = win.setTimeout(run, 180) })
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { win.clearTimeout(timer); run(); const first = list.querySelector('button'); if (first) first.click() }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSearch(); searchButton.focus() }
    })
    close.addEventListener('click', closeSearch)
    stage.append(panel)
    searchPanel = panel
    searchButton.setAttribute('aria-expanded', 'true')
    input.focus()
  }
  listen(searchButton, 'click', () => { if (searchPanel) closeSearch(); else openSearch() })

  listen(prevButton, 'click', () => goPage(-1))
  listen(nextButton, 'click', () => goPage(1))
  listen(fullscreenButton, 'click', () => {
    if (doc.fullscreenElement) {
      if (doc.exitFullscreen) doc.exitFullscreen().catch(() => undefined)
    } else if (root.requestFullscreen) root.requestFullscreen().catch(() => undefined)
  })
  listen(doc, 'keydown', (event) => {
    const tag = event.target && event.target.tagName ? event.target.tagName.toLowerCase() : ''
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return
    if (event.key === 'Escape' && popupEl) {
      // The pop-up consumes Esc so a host (e.g. the editor's Preview) does not also react to it.
      event.preventDefault()
      event.stopPropagation()
      closePopup()
      return
    }
    if (event.key === 'Escape' && (searchPanel || selectMode || thumbsPanel || zoom !== 1)) {
      event.preventDefault()
      event.stopPropagation()
      if (thumbsPanel) closeThumbs()
      else if (searchPanel) closeSearch()
      else if (zoom !== 1) setZoom(1)
      else setSelectMode(false)
      return
    }
    if (event.key === 'Home') { openPage(0); return }
    if (event.key === 'End') { openPage(pages.length - 1); return }
    if (textTools && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      openSearch()
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') goPage(-1)
    if (event.key === 'ArrowRight' || event.key === 'PageDown') goPage(1)
  })

  let resizeFrame = 0
  const onResize = () => {
    if (resizeFrame) win.cancelAnimationFrame(resizeFrame)
    resizeFrame = win.requestAnimationFrame(() => {
      resizeFrame = 0
      if (destroyed) return
      buildBook()
      if (!book) layoutFallback()
    })
  }
  if (win.ResizeObserver) {
    const observer = new win.ResizeObserver(onResize)
    observer.observe(stage)
    cleanups.push(() => observer.disconnect())
  } else {
    listen(win, 'resize', onResize)
  }

  buildBook()
  updateCount()
  if (animations.length && opts.autoplay !== false) clock.play()

  return {
    get currentPage() { return currentPage },
    get clock() { return clock },
    get controllers() { return controllers.slice() },
    get book() { return book },
    get selecting() { return selectMode },
    setSelectMode,
    setZoom,
    get zoom() { return zoom },
    get sound() { return sound },
    search(query) { return findMatches(String(query || '')).map((match) => ({ page: match.page, start: match.start, end: match.end })) },
    goToPage(index) {
      const target = Math.min(pages.length - 1, Math.max(0, index))
      if (book) book.turnToPage(target)
      currentPage = target
      if (!book) layoutFallback()
      onPageOpened()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      closePopup()
      closeSearch()
      closeThumbs()
      sound.destroy()
      clock.destroy()
      controllers.forEach((controller) => controller.destroy())
      if (resizeFrame) win.cancelAnimationFrame(resizeFrame)
      cleanups.forEach((fn) => fn())
      if (book) {
        try { book.destroy() } catch (error) { void error }
      }
      book = null
      root.replaceChildren()
      root.classList.remove('fs-reader', 'fs-selecting', 'fs-zoomed', 'fs-no-book-shadow')
      Object.keys(themeVars).forEach((key) => root.style.removeProperty(key))
    },
  }
}
