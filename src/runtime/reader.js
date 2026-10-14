import { createClock, createSlideshowController, overlayStyle, sampleFrames, slideClassName, slideTransitionMs, timelineDuration, timelineLoops } from './engine.js'
import { HOTSPOT_MARKERS, cropStyle, frameStyle, resolveAction, skinClassName, skinStyle, styleFor, videoSource } from './styles.js'
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
  // ---------- analytics (Google Analytics 4) ----------
  // The GA tag itself is in the published page's <head>; the reader reports what readers do.
  const analyticsId = /^G-[A-Z0-9]{4,16}$/i.test(String(readerSettings.analyticsId || '').trim()) ? String(readerSettings.analyticsId).trim().toUpperCase() : ''
  // ---------- own statistics (Cloudflare collector on the same website) ----------
  const statsCfg = opts.standalone && data.stats && data.stats.url ? data.stats : null
  const statQueue = []
  let statTimer = 0
  let referrerHost = ''
  try { const ref = doc.referrer ? new URL(doc.referrer) : null; if (ref && ref.host !== win.location.host) referrerHost = ref.host.replace(/^www\./, '') } catch (error) { void error }
  const flushStats = (leaving) => {
    if (!statsCfg) return
    while (statQueue.length) {
      const body = JSON.stringify({ p: statsCfg.pub || '', r: referrerHost, e: statQueue.splice(0, 40) })
      try {
        if (leaving && win.navigator.sendBeacon) win.navigator.sendBeacon(statsCfg.url, body)
        else win.fetch(statsCfg.url, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => undefined)
      } catch (error) { void error }
    }
  }
  const stat = (metric, key) => {
    if (!statsCfg) return
    statQueue.push([metric, key == null ? '' : String(key).slice(0, 140)])
    win.clearTimeout(statTimer)
    statTimer = win.setTimeout(() => flushStats(false), 4000)
  }
  const STAT_OF = { page_view: ['page', 'page_number'], search: ['search', 'search_term'], click: ['click', 'link_url'], view_item: ['item', 'item_name'], share: ['share', 'method'], file_download: ['download', 'file_name'], video_start: ['video', 'video_title'], bookmark_page: ['bookmark', 'page_number'] }
  const track = (name, params) => {
    const mapped = STAT_OF[name]
    if (mapped && statsCfg) {
      let key = params ? params[mapped[1]] : ''
      if (name === 'search') key = String(key || '').trim().toLowerCase()
      if (name === 'click') key = /^https:\/\/wa\.me\//.test(String(key)) ? 'WhatsApp' : String(key || '').replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '')
      stat(mapped[0], key)
    }
    const payload = Object.assign({ publication_title: data.title || '' }, params || {})
    if (opts.onTrack) { try { opts.onTrack(name, payload) } catch (error) { void error } }
    if (!opts.standalone) return
    if (analyticsId && typeof win.gtag === 'function') {
      try { win.gtag('event', name, payload) } catch (error) { void error }
    }
    adEvent(name, params || {})
  }
  /** Meta Pixel standard events and the LinkedIn enquiry conversion (when those tags are on the page). */
  const linkedinConversion = String(readerSettings.linkedinConversionId || '').replace(/\D/g, '')
  function adEvent(name, params) {
    const fbq = typeof win.fbq === 'function' ? win.fbq : null
    const enquiry = name === 'click' && /^(https:\/\/wa\.me\/|mailto:|tel:)/.test(String(params.link_url || ''))
    try {
      if (fbq) {
        if (name === 'page_view') fbq('trackCustom', 'FlipPage', { page: params.page_number, section: params.section || '' })
        else if (name === 'search') fbq('track', 'Search', { search_string: params.search_term })
        else if (name === 'view_item') fbq('track', 'ViewContent', { content_name: params.item_name, content_type: 'product' })
        else if (enquiry) fbq('track', 'Contact', { content_name: params.link_text || '' })
        else if (name === 'click') fbq('trackCustom', 'OutboundClick', { url: params.link_url })
        else if (name === 'share') fbq('trackCustom', 'Share', { method: params.method })
        else if (name === 'file_download') fbq('trackCustom', 'DownloadPDF')
        else if (name === 'video_start') fbq('trackCustom', 'VideoPlay', { title: params.video_title })
      }
      if (linkedinConversion && typeof win.lintrk === 'function' && name === 'click') win.lintrk('track', { conversion_id: Number(linkedinConversion) })
    } catch (error) { void error }
  }
  // ---------- page links (…/#page=12) ----------
  const pageLinks = !!opts.standalone && readerSettings.pageLinks !== false && pages.length > 1
  const pageFromAddress = () => {
    try {
      const match = String(win.location.hash || '').match(/page=(\d+)/i) || String(win.location.search || '').match(/[?&]page=(\d+)/i)
      return match ? Math.max(0, Math.min(pages.length - 1, Number(match[1]) - 1)) : -1
    } catch (error) { void error; return -1 }
  }
  if (pageLinks) {
    const linked = pageFromAddress()
    if (linked >= 0) currentPage = linked
  }
  const ZOOMS = [1, 2, 3]
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
  // Layout: top bar (logo, title, search) · stage (book, side arrows, bookmark tabs,
  // panels) · tool bar (view tools | page navigation | share tools), all centred.
  root.replaceChildren()
  root.classList.add('fs-reader')
  const themeVars = themeVariables(readerSettings)
  applyStyle(root, themeVars)
  if (readerSettings.bookShadow === false) root.classList.add('fs-no-book-shadow')
  const ICONS = {
    prev: '<path d="M15 18l-6-6 6-6"/>',
    next: '<path d="M9 18l6-6-6-6"/>',
    first: '<path d="M17 18l-6-6 6-6M7 6v12"/>',
    last: '<path d="M7 18l6-6-6-6M17 6v12"/>',
    pages: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    toc: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    zoom: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>',
    zoomReset: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    select: '<path d="M9 4h6M9 20h6M12 4v16"/>',
    sound: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12"/>',
    muted: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    auto: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l5 3.5-5 3.5z"/>',
    autoStop: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9h1.8v6H9.5zM12.7 9h1.8v6h-1.8z"/>',
    share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    play: '<path d="M8 5.5v13l11-6.5z"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
  }
  const svgIcon = (icon) => '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + ICONS[icon] + '</svg>'
  const setIcon = (button, icon, label) => {
    button.innerHTML = svgIcon(icon) + '<span class="fs-btn-label"></span>'
    button.lastChild.textContent = label
    button.setAttribute('aria-label', label)
    button.setAttribute('title', label)
  }
  const iconButton = (action, icon, label, extraClass, attrs) => {
    const button = make('button', 'fs-reader-btn fs-icon-btn' + (extraClass ? ' ' + extraClass : ''), Object.assign({ type: 'button', 'data-action': action }, attrs || {}))
    setIcon(button, icon, label)
    return button
  }

  // Top bar
  const topBar = make('div', 'fs-reader-bar fs-reader-top')
  const brand = make('div', 'fs-top-brand')
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
    brand.append(logo)
  }
  if (readerSettings.showTitle !== false && data.title) {
    const title = make('span', 'fs-top-title')
    title.textContent = data.title
    brand.append(title)
  }
  const searchForm = make('form', 'fs-top-search', { role: 'search' })
  searchForm.innerHTML = svgIcon('search')
  const searchInput = make('input', 'fs-top-search-input', { type: 'search', placeholder: 'Search…', 'aria-label': 'Search text', autocomplete: 'off' })
  searchForm.append(searchInput)
  topBar.append(brand)
  if (textTools) topBar.append(searchForm)

  // Stage
  const stage = make('div', 'fs-stage')
  const host = make('div', 'fs-book-host')
  // Large arrows at the sides (duplicates of the toolbar buttons, so hidden from assistive tech).
  const sidePrev = make('button', 'fs-side-nav fs-side-prev', { type: 'button', tabindex: '-1', 'aria-hidden': 'true', 'data-action': 'side-previous' })
  sidePrev.innerHTML = svgIcon('prev')
  const sideNext = make('button', 'fs-side-nav fs-side-next', { type: 'button', tabindex: '-1', 'aria-hidden': 'true', 'data-action': 'side-next' })
  sideNext.innerHTML = svgIcon('next')
  stage.append(host)
  if (readerSettings.sideArrows !== false) stage.append(sidePrev, sideNext)

  // Tool bar
  const toolsBar = make('div', 'fs-reader-bar fs-reader-tools')
  const leftGroup = make('div', 'fs-bar-group fs-bar-left')
  const centerGroup = make('div', 'fs-bar-group fs-bar-center')
  const rightGroup = make('div', 'fs-bar-group fs-bar-right')
  const zoomButton = iconButton('zoom', 'zoom', 'Zoom in', '', { 'aria-pressed': 'false' })
  const thumbsButton = iconButton('thumbnails', 'pages', 'All pages', '', { 'aria-expanded': 'false' })
  const tocButton = iconButton('contents', 'toc', 'Contents', '', { 'aria-expanded': 'false' })
  const marksButton = iconButton('bookmarks', 'bookmark', 'My bookmarks', '', { 'aria-expanded': 'false' })
  const autoButton = iconButton('auto-flip', 'auto', 'Auto flip', '', { 'aria-pressed': 'false' })
  const soundButton = iconButton('sound', sound.muted ? 'muted' : 'sound', sound.muted ? 'Turn page sound on' : 'Mute page sound', 'fs-reader-sound', { 'aria-pressed': String(!sound.muted) })
  const firstButton = iconButton('first-page', 'first', 'First page')
  const prevButton = iconButton('previous-page', 'prev', 'Previous page')
  const pageCount = make('button', 'fs-reader-count', { type: 'button', 'aria-live': 'polite', 'data-role': 'page-count', title: 'Go to page' })
  const nextButton = iconButton('next-page', 'next', 'Next page')
  const lastButton = iconButton('last-page', 'last', 'Last page')
  const shareButton = iconButton('share', 'share', 'Share', '', { 'aria-expanded': 'false' })
  const downloadLink = make('a', 'fs-reader-btn fs-icon-btn', { 'data-action': 'download', href: readerSettings.downloadUrl || '#', download: readerSettings.downloadName || ((data.title || 'catalogue') + '.pdf') })
  downloadLink.innerHTML = svgIcon('download') + '<span class="fs-btn-label">Download PDF</span>'
  downloadLink.setAttribute('aria-label', 'Download PDF')
  downloadLink.setAttribute('title', 'Download PDF')
  const emailButton = iconButton('email', 'mail', 'Email')
  const selectButton = iconButton('select-text', 'select', 'Select text', 'fs-reader-select', { 'aria-pressed': 'false' })
  const fullscreenButton = iconButton('fullscreen', 'full', 'Full screen', 'fs-reader-fullscreen')
  const moreButton = iconButton('more', 'more', 'More', 'fs-more-btn', { 'aria-expanded': 'false', 'aria-haspopup': 'dialog' })
  // Embedded in another website (iframe or ?embed=1): a quieter top bar and a button to open the full catalogue.
  let embedded = false
  try { embedded = !!opts.standalone && (/[?&]embed=1/.test(String(win.location.search)) || win.self !== win.top) } catch (error) { void error; embedded = !!opts.standalone }
  const openFullButton = iconButton('open-full', 'external', 'Open full catalogue')
  const shareUrl = () => data.shareUrl || (/^https?:/i.test(String(win.location && win.location.href)) ? String(win.location.href).split('#')[0] : '')
  const many = pages.length > 2

  leftGroup.append(zoomButton)
  if (many && readerSettings.thumbnails !== false) leftGroup.append(thumbsButton)
  if (many && readerSettings.contents !== false) leftGroup.append(tocButton)
  if (many && readerSettings.readerBookmarks !== false) leftGroup.append(marksButton)
  if (pages.length > 1 && readerSettings.autoFlipButton !== false) leftGroup.append(autoButton)
  if (sound.enabled) leftGroup.append(soundButton)
  centerGroup.append(firstButton, prevButton, pageCount, nextButton, lastButton)
  if (readerSettings.share !== false) rightGroup.append(shareButton)
  if (readerSettings.downloadUrl) rightGroup.append(downloadLink)
  if (readerSettings.share !== false) rightGroup.append(emailButton)
  if (textTools) rightGroup.append(selectButton)
  if (embedded) {
    root.classList.add('fs-embedded')
    rightGroup.append(openFullButton)
  }
  rightGroup.append(fullscreenButton, moreButton)
  toolsBar.append(leftGroup, centerGroup, rightGroup)

  // Animation timeline (editor Preview only; published books just play their animations)
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
  if (!animations.length || opts.showTimeline === false) {
    bottomBar.hidden = true
  }
  root.append(topBar, stage, toolsBar, bottomBar)

  // ---------- objects ----------
  // ---------- video ----------
  // Videos load and play only while their page is on screen, and stop when it is turned away.
  const media = []
  let shownPages = []
  const pageShown = (index) => shownPages.indexOf(index) >= 0
  const keepPointer = (el) => {
    // Using the video's own controls must not start a page turn.
    ;['pointerdown', 'mousedown', 'touchstart'].forEach((type) => el.addEventListener(type, (event) => event.stopPropagation(), { passive: true }))
  }
  const playQuietly = (video) => {
    try {
      const attempt = video.play()
      // Browsers may block sound before the reader has clicked: retry muted.
      if (attempt && attempt.catch) attempt.catch(() => { video.muted = true; const again = video.play(); if (again && again.catch) again.catch(() => undefined) })
    } catch (error) { void error }
  }
  /**
   * Builds a video player. `options.lite`: show a poster with a play button and
   * load the YouTube/Vimeo player only when clicked (fast, no cookies before play).
   */
  const buildVideo = (url, options, label) => {
    const o = options || {}
    const fileLike = /^(data:video\/|blob:)/i.test(url) || (!/^https?:/i.test(url) && /\.(mp4|webm|ogv|mov|m4v)$/i.test(url))
    const source = fileLike ? { kind: 'file', src: url } : videoSource(url, { autoplay: o.autoplay, muted: o.muted, loop: o.loop, controls: o.controls })
    const box = make('div', 'fs-video')
    if (!source) {
      const empty = make('div', 'fs-placeholder')
      empty.textContent = url ? 'This video link is not supported' : 'No video yet'
      box.append(empty)
      return { el: box, activate() {}, deactivate() {}, kind: 'none' }
    }
    let started = false
    const report = (name) => track(name, { video_title: label || '', video_provider: source.kind, video_url: /^https?:/i.test(url) ? url : '' })
    if (source.kind === 'file') {
      const video = make('video', 'fs-video-el fs-fit-' + (o.fit || 'cover'), { preload: 'metadata', playsinline: '', 'webkit-playsinline': '' })
      if (o.controls !== false) video.setAttribute('controls', '')
      video.muted = !!o.muted
      video.loop = !!o.loop
      video.addEventListener('play', () => { if (!started) { started = true; report('video_start') } })
      video.addEventListener('ended', () => report('video_complete'))
      box.append(video)
      return {
        el: box,
        kind: 'file',
        video,
        load() { if (!video.getAttribute('src')) video.setAttribute('src', source.src) },
        activate() { this.load(); if (o.autoplay) playQuietly(video) },
        deactivate() { if (!video.paused) video.pause() },
      }
    }
    const frame = () => make('iframe', 'fs-video-frame', { title: label || 'Video', allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: '', referrerpolicy: 'strict-origin-when-cross-origin' })
    let iframe = null
    const poster = make('button', 'fs-video-poster', { type: 'button', 'aria-label': 'Play video' + (label ? ': ' + label : '') })
    if (source.thumb) poster.append(make('img', '', { src: source.thumb, alt: '', loading: 'lazy', draggable: 'false' }))
    const playIcon = make('span', 'fs-video-play', { 'aria-hidden': 'true' })
    playIcon.innerHTML = svgIcon('play')
    poster.append(playIcon)
    box.append(poster)
    const open = (autoplay) => {
      if (iframe) return
      iframe = frame()
      iframe.setAttribute('src', autoplay && source.src.indexOf('autoplay=1') < 0 ? source.src + '&autoplay=1' : source.src)
      box.append(iframe)
      box.classList.add('is-playing')
      if (!started) { started = true; report('video_start') }
    }
    const close = () => {
      if (!iframe) return
      iframe.remove()
      iframe = null
      box.classList.remove('is-playing')
    }
    poster.addEventListener('click', (event) => { event.stopPropagation(); open(true); if (o.onPlay) o.onPlay() })
    return { el: box, kind: source.kind, activate() { if (o.autoplay) open(false) }, deactivate: close }
  }
  const createVideoObject = (overlay, el, pageIndex) => {
    const player = buildVideo(overlay.src || overlay.videoUrl || '', { autoplay: !!overlay.autoplay, muted: !!overlay.muted, loop: !!overlay.looping, controls: overlay.showControls !== false, fit: overlay.fit === 'contain' ? 'contain' : 'cover' }, overlay.label)
    keepPointer(el)
    el.append(player.el)
    media.push({ page: pageIndex, activate: () => player.activate(), deactivate: () => player.deactivate() })
  }

  const createSlideshow = (overlay, el, pageIndex) => {
    const slides = overlay.slides || []
    const fit = 'fs-fit-' + (overlay.fit || 'cover')
    const wrap = make('div', 'fs-slides', { 'data-transition': overlay.transition || 'fade' })
    wrap.style.setProperty('--fs-transition', slideTransitionMs(overlay) + 'ms')
    const players = []
    let controller = null
    const images = slides.map((slide, index) => {
      if (slide.kind === 'video') {
        const player = buildVideo(slide.src || '', { muted: true, controls: true, fit: overlay.fit === 'contain' ? 'contain' : 'cover', onPlay: () => { if (controller) controller.hold(true) } }, slide.alt || overlay.label)
        player.el.classList.add('fs-slide', fit)
        player.el.setAttribute('data-slide-index', String(index))
        if (player.video) {
          player.video.removeAttribute('controls')
          player.video.addEventListener('ended', () => { if (!controller) return; controller.hold(false); if (controller.playing) controller.next() })
        }
        players[index] = player
        wrap.append(player.el)
        return player.el
      }
      const img = make('img', 'fs-slide ' + fit, { alt: slide.alt || overlay.label || 'Slide ' + (index + 1), draggable: 'false', 'data-slide-index': String(index) })
      if (slide.src) img.src = slide.src
      applyStyle(img, cropStyle(overlay))
      wrap.append(img)
      return img
    })
    if (players.length) keepPointer(el)
    let activeIndex = -1
    // A video slide plays while it is the current slide and its page is on screen; the slideshow waits for it to end.
    const syncSlideVideo = () => {
      if (controller) controller.hold(false)
      players.forEach((player, i) => {
        if (!player) return
        if (i === activeIndex && pageShown(pageIndex) && player.video) {
          player.load()
          player.video.muted = true
          try { player.video.currentTime = 0 } catch (error) { void error }
          if (controller) controller.hold(true)
          playQuietly(player.video)
        } else {
          player.deactivate()
        }
      })
    }
    if (players.length) media.push({ page: pageIndex, activate: syncSlideVideo, deactivate: () => { players.forEach((player) => player && player.deactivate()); if (controller) controller.hold(false) } })
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
      images.forEach((img, i) => { img.className = slideClassName(i, index, previous, direction) + ' ' + fit + (players[i] ? ' fs-video' + (img.classList.contains('is-playing') ? ' is-playing' : '') : '') })
      if (index !== activeIndex) {
        activeIndex = index
        if (players.length) syncSlideVideo()
      }
      marks.forEach((mark, i) => mark.classList.toggle('is-active', i === index))
      el.setAttribute('data-slide', String(index))
    }
    controller = createSlideshowController(overlay, render)
    activeIndex = controller.index
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
    else if (action.kind === 'popup' && overlay.popup) {
      openPopup(overlay.popup)
      track('view_item', { item_name: overlay.popup.title || overlay.label || '', price: overlay.popup.price || '' })
    }
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
      el.addEventListener('click', () => track('click', { link_url: action.href, link_text: overlay.label || '', outbound: /^https?:/i.test(action.href), page_number: pages.indexOf(page) + 1 }))
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
      createSlideshow(overlay, el, pages.indexOf(page))
    } else if (overlay.type === 'video') {
      createVideoObject(overlay, el, pages.indexOf(page))
    } else if (overlay.type === 'audio') {
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
    if (overlay.type === 'image' || overlay.type === 'slideshow' || overlay.type === 'video') applyStyle(el, frameStyle(overlay, page))
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
    if (!pageCount.querySelector('input')) pageCount.textContent = (total ? (first === last ? String(first + 1) : (first + 1) + '–' + (last + 1)) : '0') + ' / ' + total
    prevButton.disabled = first <= 0
    firstButton.disabled = first <= 0
    sidePrev.disabled = first <= 0
    nextButton.disabled = last >= total - 1
    lastButton.disabled = last >= total - 1
    sideNext.disabled = last >= total - 1
    root.setAttribute('data-current-page', String(currentPage))
    markTabs()
  }
  /** Starts videos on the pages now on screen and stops the rest. */
  const syncMedia = () => {
    shownPages = visiblePages()
    media.forEach((item) => {
      try {
        if (pageShown(item.page)) item.activate()
        else item.deactivate()
      } catch (error) { void error }
    })
  }
  let viewTimer = 0
  let lastViewed = ''
  const reportPageView = () => {
    const spread = visiblePages()
    const first = spread[0] + 1
    const last = spread[spread.length - 1] + 1
    const key = first + '-' + last
    if (key === lastViewed) return
    lastViewed = key
    const label = first === last ? 'Page ' + first : 'Pages ' + first + '–' + last
    let location = ''
    try { location = String(win.location.href).split('#')[0] + (first > 1 ? '#page=' + first : '') } catch (error) { void error }
    track('page_view', { page_title: (data.title || 'Catalogue') + ' · ' + label, page_location: location, page_number: first, page_label: label, section: (sections[currentSection()] || {}).label || '' })
  }
  const updateAddress = () => {
    if (!pageLinks) return
    try {
      const first = visiblePages()[0] + 1
      const base = String(win.location.pathname || '') + String(win.location.search || '').replace(/([?&])page=\d+&?/i, '$1').replace(/[?&]$/, '')
      const next = first > 1 ? base + '#page=' + first : base
      if (String(win.location.pathname) + String(win.location.search) + String(win.location.hash) !== next) win.history.replaceState(win.history.state, '', next)
    } catch (error) { void error }
  }
  const onPageOpened = () => {
    updateCount()
    syncMedia()
    updateAddress()
    win.clearTimeout(viewTimer)
    viewTimer = win.setTimeout(reportPageView, 700)
    loadPageImages()
    layoutTabs()
    centerBook()
    if (thumbsPanel) markThumbs()
    if (drawer) markDrawer()
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
      layoutTabs()
      centerBook()
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
      // StPageFlip's stretch mode resets the block to width:100%; keep the fitted width.
      mount.style.width = Math.floor(width) + 'px'
      try { book.update() } catch (error) { void error }
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
    layoutTabs()
    // No transition for the first placement.
    const placed = bookMount()
    if (placed) {
      placed.classList.add('fs-no-transition')
      centerBook()
      win.requestAnimationFrame(() => placed.classList.remove('fs-no-transition'))
    }
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
    mount.append(tabRail)
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
      const state = event && event.data
      flipState = state
      if (state === 'flipping') {
        sound.play()
        beginTurn(instance)
      } else if (state === 'user_fold') {
        beginTurn(instance)
      } else if (state === 'read') {
        endTurn()
      }
    })
    instance.on('flip', (event) => {
      currentPage = Number(event.data) || 0
      // Drag-and-release turns do not pass through the "flipping" state: make sure they sound too.
      if (Date.now() - lastSoundAt > 1200) sound.play()
      endTurn()
      onPageOpened()
    })
    return instance
  }

  // ---------- centring, page-turn fixes and bookmark tabs ----------
  let flipState = 'read'
  let lastSoundAt = 0
  const playSound = sound.play
  sound.play = () => { lastSoundAt = Date.now(); playSound() }
  const bookMount = () => (book ? host.firstElementChild : null)
  /** Shift (px) that centres a lone cover (shown on the right) or a lone last page (shown on the left). */
  const centreShift = (shown) => {
    if (!book || bookPortrait || readerSettings.centerSinglePages === false) return 0
    let rect = null
    try { rect = book.getBoundsRect() } catch (error) { void error }
    if (!rect || !rect.pageWidth) return 0
    if (shown.length !== 1) return 0
    if (shown[0] === 0) return -rect.pageWidth / 2
    if (shown[0] === pages.length - 1 && pages.length % 2 === 0) return rect.pageWidth / 2
    return 0
  }
  const applyShift = (shift) => {
    const mount = bookMount()
    if (!mount) return
    mount.style.transform = shift ? 'translateX(' + Math.round(shift) + 'px)' : ''
  }
  const centerBook = () => applyShift(centreShift(visiblePages()))
  let hiddenDuringTurn = []
  /** At the start of a turn: centre for the destination, and hide the page being lifted off a lone cover/last page. */
  const beginTurn = (instance) => {
    let controller = null
    try { controller = instance.getFlipController ? instance.getFlipController() : null } catch (error) { void error }
    const flipping = controller && controller.flippingPage
    const bottom = controller && controller.bottomPage
    if (!flipping || !bottom) return
    const indexOf = (page) => pageElements.indexOf(page && page.getElement ? page.getElement() : page && page.element)
    const a = indexOf(flipping)
    const b = indexOf(bottom)
    if (a < 0 || b < 0) return
    const destination = a === b ? [a] : [Math.min(a, b), Math.max(a, b)]
    applyShift(centreShift(destination))
    // StPageFlip keeps drawing the old page under a turn that ends on a single page
    // (back to the cover, or on to a lone last page). Hide it so the turn looks real.
    if (a === b && !bookPortrait) {
      const shown = visiblePages()
      const lifted = a === 0 ? shown[0] : shown[shown.length - 1]
      const el = typeof lifted === 'number' && lifted !== a ? pageElements[lifted] : null
      if (el && hiddenDuringTurn.indexOf(el) < 0) {
        el.classList.add('fs-turn-hidden')
        hiddenDuringTurn.push(el)
      }
    }
  }
  const endTurn = () => {
    hiddenDuringTurn.forEach((el) => el.classList.remove('fs-turn-hidden'))
    hiddenDuringTurn = []
  }

  // Bookmark tabs on the edge of the book (publisher's sections)
  const sections = pages.map((page, index) => (page.bookmark && page.bookmark.label ? { index, label: page.bookmark.label, color: page.bookmark.color, textColor: page.bookmark.textColor } : null)).filter(Boolean)
  const tabRail = make('div', 'fs-tabs', { 'data-effect': readerSettings.tabEffect || 'slide' })
  const tabButtons = sections.map((section) => {
    const tab = make('button', 'fs-tab', { type: 'button', title: section.label + ' — page ' + (section.index + 1), 'data-page': String(section.index) })
    const text = make('span')
    text.textContent = section.label
    tab.append(text)
    if (section.color) tab.style.setProperty('--fs-tab-bg', section.color)
    if (section.textColor) tab.style.setProperty('--fs-tab-text', section.textColor)
    tab.addEventListener('click', (event) => {
      event.stopPropagation()
      if (zoom !== 1) setZoom(1)
      openPage(section.index)
    })
    tab.addEventListener('pointerdown', (event) => event.stopPropagation())
    tab.addEventListener('mousedown', (event) => event.stopPropagation())
    tabRail.append(tab)
    return tab
  })
  const currentSection = () => {
    let found = -1
    const shown = visiblePages()
    const last = shown[shown.length - 1]
    sections.forEach((section, i) => { if (section.index <= last) found = i })
    return found
  }
  const markTabs = () => {
    const active = currentSection()
    tabButtons.forEach((tab, i) => tab.classList.toggle('is-current', i === active))
  }
  /** Places the tab rail along the right edge of the visible page(s), in book coordinates. */
  const layoutTabs = () => {
    if (!sections.length || readerSettings.tabs === false || !book || root.classList.contains('fs-compact')) { tabRail.hidden = true; return }
    let rect = null
    try { rect = book.getBoundsRect() } catch (error) { void error }
    if (!rect || !rect.pageWidth || rect.pageWidth < 220) { tabRail.hidden = true; return }
    tabRail.hidden = false
    const shown = visiblePages()
    const loneLast = !bookPortrait && shown.length === 1 && shown[0] === pages.length - 1 && shown[0] !== 0
    const right = loneLast ? rect.left + rect.pageWidth : rect.left + rect.width
    tabRail.style.left = Math.round(right) + 'px'
    tabRail.style.top = Math.round(rect.top) + 'px'
    tabRail.style.height = Math.round(rect.height) + 'px'
    const size = Math.max(18, Math.min(34, rect.pageWidth * 0.045))
    tabRail.style.setProperty('--fs-tab-size', Math.round(size) + 'px')
    tabRail.style.setProperty('--fs-tab-count', String(Math.max(sections.length, 6)))
  }

  const goPage = (direction) => {
    if (book) {
      if (flipState === 'flipping' || flipState === 'user_fold') return
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
    setIcon(zoomButton, zoom > 1 ? 'zoomReset' : 'zoom', zoom > 1 ? 'Reset zoom' : 'Zoom in')
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
  // The button switches between "zoomed in" and the normal view; double-click and Ctrl+wheel zoom at the pointer.
  listen(zoomButton, 'click', () => setZoom(zoom === 1 ? 2 : 1))
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
    closeDrawer()
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
  // Results drop down under the search box in the top bar.
  const closeSearch = () => {
    if (!searchPanel) return
    searchPanel.remove()
    searchPanel = null
    clearHits()
    root.classList.remove('fs-searching')
  }
  let searchTimer = 0
  let searchReportTimer = 0
  cleanups.push(() => win.clearTimeout(searchReportTimer))
  const runSearch = () => {
    const query = searchInput.value.trim()
    if (!query) { closeSearch(); return }
    if (!searchPanel) {
      searchPanel = make('div', 'fs-search', { role: 'region', 'aria-label': 'Search results' })
      const head = make('div', 'fs-search-head')
      const status = make('div', 'fs-search-status', { 'aria-live': 'polite' })
      const close = make('button', 'fs-search-close', { type: 'button', 'aria-label': 'Close search' })
      close.textContent = '×'
      close.addEventListener('click', () => { searchInput.value = ''; closeSearch() })
      head.append(status, close)
      searchPanel.append(head, make('ol', 'fs-search-results'))
      root.append(searchPanel)
      root.classList.add('fs-searching')
    }
    const status = searchPanel.querySelector('.fs-search-status')
    const list = searchPanel.querySelector('.fs-search-results')
    list.replaceChildren()
    if (query.length < 2) { status.textContent = 'Type at least 2 letters.'; clearHits(); return }
    const matches = findMatches(query)
    win.clearTimeout(searchReportTimer)
    searchReportTimer = win.setTimeout(() => track('search', { search_term: query, results: matches.length }), 1500)
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
        if (zoom !== 1) setZoom(1)
        openPage(match.page)
        // Highlight once the page is on screen (after the flip starts).
        win.requestAnimationFrame(() => highlight(match))
        win.setTimeout(() => highlight(match), 900)
      })
      item.append(button)
      list.append(item)
    })
    if (matches[0]) highlight(matches[0])
  }
  const openSearch = () => {
    searchInput.focus()
    searchInput.select()
  }
  listen(searchInput, 'input', () => { win.clearTimeout(searchTimer); searchTimer = win.setTimeout(runSearch, 180) })
  listen(searchForm, 'submit', (event) => {
    event.preventDefault()
    win.clearTimeout(searchTimer)
    runSearch()
    const first = searchPanel && searchPanel.querySelector('.fs-search-hit')
    if (first) first.click()
  })
  listen(searchInput, 'keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); searchInput.value = ''; closeSearch(); searchInput.blur() }
  })

  listen(prevButton, 'click', () => goPage(-1))
  listen(nextButton, 'click', () => goPage(1))
  listen(sidePrev, 'click', () => goPage(-1))
  listen(sideNext, 'click', () => goPage(1))
  listen(firstButton, 'click', () => { if (zoom !== 1) setZoom(1); openPage(0) })
  listen(lastButton, 'click', () => { if (zoom !== 1) setZoom(1); openPage(pages.length - 1) })

  // Page number: click to type a page and press Enter.
  listen(pageCount, 'click', () => {
    if (pageCount.querySelector('input')) return
    const input = make('input', 'fs-page-input', { type: 'number', min: '1', max: String(pages.length), 'aria-label': 'Go to page number', value: String(currentPage + 1) })
    pageCount.replaceChildren(input)
    input.focus()
    input.select()
    let finished = false
    const done = (go) => {
      if (finished) return
      finished = true
      const number = Math.floor(Number(input.value))
      pageCount.replaceChildren()
      updateCount()
      if (go && number >= 1 && number <= pages.length) openPage(number - 1)
    }
    input.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Enter') { event.preventDefault(); done(true) }
      if (event.key === 'Escape') { event.preventDefault(); done(false) }
    })
    input.addEventListener('blur', () => { if (input.isConnected) done(false) })
  })

  // Sound needs a user gesture before browsers allow audio: prepare it on the first touch/click/key.
  const unlockSound = () => { if (sound.unlock) sound.unlock() }
  listen(root, 'pointerdown', unlockSound, true)
  listen(root, 'keydown', unlockSound, true)
  // Releasing a dragged page turns it: sound it right away.
  listen(stage, 'pointerup', () => { if (flipState === 'user_fold') sound.play() })

  // ---------- drawers: contents and my bookmarks ----------
  let drawer = null
  let drawerKind = ''
  let drawerItems = []
  const marksKey = 'fs-bookmarks:' + (data.id || data.title || 'publication')
  const readMarks = () => {
    try { const raw = storage && storage.getItem(marksKey); const list = raw ? JSON.parse(raw) : []; return Array.isArray(list) ? list.filter((n) => typeof n === 'number' && n >= 0 && n < pages.length) : [] } catch (error) { void error; return [] }
  }
  const writeMarks = (list) => { try { if (storage) storage.setItem(marksKey, JSON.stringify(list)) } catch (error) { void error } }
  const closeDrawer = () => {
    if (!drawer) return
    drawer.remove()
    drawer = null
    drawerItems = []
    tocButton.setAttribute('aria-expanded', 'false')
    marksButton.setAttribute('aria-expanded', 'false')
    drawerKind = ''
  }
  const markDrawer = () => {
    const shown = visiblePages()
    drawerItems.forEach((item) => item.button.classList.toggle('is-current', drawerKind === 'contents' && sections.length ? item.section === currentSection() : shown.indexOf(item.page) >= 0))
  }
  const pageLabel = (index) => 'Page ' + (index + 1)
  const buildDrawer = (kind) => {
    const panel = make('div', 'fs-drawer', { role: 'dialog', 'aria-label': kind === 'contents' ? 'Contents' : 'My bookmarks' })
    const head = make('div', 'fs-drawer-head')
    const title = make('strong')
    title.innerHTML = svgIcon(kind === 'contents' ? 'toc' : 'bookmark')
    title.append(kind === 'contents' ? 'Contents' : 'My bookmarks')
    const close = make('button', 'fs-search-close', { type: 'button', 'aria-label': 'Close' })
    close.textContent = '×'
    close.addEventListener('click', closeDrawer)
    head.append(title, close)
    panel.append(head)
    const list = make('ol', 'fs-drawer-list')
    const go = (index) => { if (zoom !== 1) setZoom(1); openPage(index); if (stage.clientWidth < 700) closeDrawer() }
    if (kind === 'contents') {
      const filter = make('input', 'fs-drawer-filter', { type: 'search', placeholder: 'Filter…', 'aria-label': 'Filter contents' })
      panel.append(filter)
      const entries = sections.length ? sections.map((section, i) => ({ page: section.index, label: section.label, color: section.color, section: i })) : pages.map((page, index) => ({ page: index, label: page.name || pageLabel(index), section: -1 }))
      drawerItems = entries.map((entry) => {
        const li = make('li')
        const button = make('button', 'fs-drawer-item', { type: 'button' })
        const dot = make('span', 'fs-drawer-dot')
        if (entry.color) dot.style.background = entry.color
        const label = make('span', 'fs-drawer-label')
        label.textContent = entry.label
        const number = make('span', 'fs-drawer-page')
        number.textContent = String(entry.page + 1)
        button.append(dot, label, number)
        button.addEventListener('click', () => { track('select_content', { content_type: 'contents', item_id: entry.label, page_number: entry.page + 1 }); go(entry.page) })
        li.append(button)
        list.append(li)
        return { button, page: entry.page, section: entry.section, li, text: entry.label.toLowerCase() }
      })
      filter.addEventListener('input', () => {
        const term = filter.value.trim().toLowerCase()
        drawerItems.forEach((item) => { item.li.hidden = !!term && item.text.indexOf(term) < 0 && String(item.page + 1) !== term })
      })
      filter.addEventListener('keydown', (event) => event.stopPropagation())
    } else {
      const add = make('button', 'fs-reader-btn fs-drawer-add', { type: 'button' })
      const render = () => {
        list.replaceChildren()
        const marks = readMarks()
        const shown = visiblePages()
        const here = shown[0]
        const marked = marks.indexOf(here) >= 0
        add.textContent = marked ? 'Remove bookmark from page ' + (here + 1) : '+ Bookmark page ' + (here + 1)
        drawerItems = marks.sort((x, y) => x - y).map((index) => {
          const li = make('li')
          const button = make('button', 'fs-drawer-item', { type: 'button' })
          const thumb = make('span', 'fs-drawer-thumb')
          const src = pages[index].thumb
          if (src) thumb.append(make('img', '', { src, alt: '', loading: 'lazy' }))
          const label = make('span', 'fs-drawer-label')
          label.textContent = pageLabel(index)
          const remove = make('span', 'fs-drawer-remove', { role: 'button', 'aria-label': 'Remove bookmark ' + (index + 1), title: 'Remove' })
          remove.textContent = '×'
          remove.addEventListener('click', (event) => { event.stopPropagation(); writeMarks(readMarks().filter((n) => n !== index)); render() })
          button.append(thumb, label, remove)
          button.addEventListener('click', () => go(index))
          li.append(button)
          list.append(li)
          return { button, page: index, section: -1, li, text: '' }
        })
        if (!marks.length) {
          const empty = make('li', 'fs-drawer-empty')
          empty.textContent = 'No bookmarks yet. Bookmark pages you want to come back to; they are kept in this browser.'
          list.append(empty)
        }
        markDrawer()
      }
      add.addEventListener('click', () => {
        const here = visiblePages()[0]
        const marks = readMarks()
        if (marks.indexOf(here) < 0) track('bookmark_page', { page_number: here + 1 })
        writeMarks(marks.indexOf(here) >= 0 ? marks.filter((n) => n !== here) : marks.concat([here]))
        render()
      })
      panel.append(add)
      panel.renderMarks = render
      render()
    }
    panel.append(list)
    return panel
  }
  const openDrawer = (kind) => {
    const same = drawerKind === kind
    closeDrawer()
    if (same) return
    closeThumbs()
    drawer = buildDrawer(kind)
    drawerKind = kind
    stage.append(drawer)
    ;(kind === 'contents' ? tocButton : marksButton).setAttribute('aria-expanded', 'true')
    markDrawer()
    const current = drawer.querySelector('.is-current')
    if (current && current.scrollIntoView) current.scrollIntoView({ block: 'nearest' })
  }
  listen(tocButton, 'click', () => openDrawer('contents'))
  listen(marksButton, 'click', () => openDrawer('bookmarks'))

  // ---------- share and email ----------
  let popover = null
  const closePopover = () => {
    if (!popover) return
    popover.remove()
    popover = null
    shareButton.setAttribute('aria-expanded', 'false')
    autoButton.removeAttribute('data-menu')
  }
  const openPopover = (anchor, build) => {
    closePopover()
    popover = make('div', 'fs-popover', { role: 'dialog' })
    build(popover)
    root.append(popover)
    const a = anchor.getBoundingClientRect()
    const r = root.getBoundingClientRect()
    const width = popover.offsetWidth || 240
    const left = Math.max(8, Math.min(r.width - width - 8, a.left - r.left + a.width / 2 - width / 2))
    popover.style.left = Math.round(left) + 'px'
    popover.style.bottom = Math.round(r.bottom - a.top + 8) + 'px'
  }
  const shareText = () => (data.title || 'Catalogue')
  const shareLinks = (url) => [
    ['WhatsApp', 'https://wa.me/?text=' + encodeURIComponent(shareText() + '\n' + url)],
    ['Facebook', 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url)],
    ['LinkedIn', 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url)],
    ['X', 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText()) + '&url=' + encodeURIComponent(url)],
    ['Email', 'mailto:?subject=' + encodeURIComponent(shareText()) + '&body=' + encodeURIComponent(url)],
  ]
  listen(shareButton, 'click', () => {
    if (popover && shareButton.getAttribute('aria-expanded') === 'true') { closePopover(); return }
    const url = shareUrl()
    openPopover(shareButton, (box) => {
      const title = make('strong')
      title.textContent = 'Share this catalogue'
      box.append(title)
      if (!url) {
        const note = make('p')
        note.textContent = 'Sharing works once the catalogue is online.'
        box.append(note)
        return
      }
      const here = visiblePages()[0] + 1
      let link = url
      const row = make('div', 'fs-share-copy')
      const field = make('input', '', { type: 'text', readonly: '', value: url, 'aria-label': 'Link' })
      const grid = make('div', 'fs-share-grid')
      const fillGrid = () => {
        grid.replaceChildren()
        shareLinks(link).forEach(([name, href]) => {
          const anchor = make('a', 'fs-share-link', { href, target: '_blank', rel: 'noopener noreferrer' })
          anchor.textContent = name
          anchor.addEventListener('click', () => track('share', { method: name.toLowerCase(), content_type: 'catalogue', page_number: link === url ? 1 : here }))
          grid.append(anchor)
        })
      }
      if (here > 1 && readerSettings.pageLinks !== false) {
        const option = make('label', 'fs-share-page')
        const box2 = make('input', '', { type: 'checkbox' })
        option.append(box2, 'Open at page ' + here)
        box2.addEventListener('change', () => {
          link = box2.checked ? (data.pageShare ? url.replace(/\/?$/, '/') + 'p/' + here + '/' : url + '#page=' + here) : url
          field.value = link
          copy.textContent = 'Copy link'
          fillGrid()
        })
        box.append(option)
      }
      const copy = make('button', 'fs-reader-btn', { type: 'button' })
      copy.textContent = 'Copy link'
      copy.addEventListener('click', () => {
        const done = () => { copy.textContent = 'Copied ✓'; track('share', { method: 'copy_link', content_type: 'catalogue' }) }
        try {
          const fallback = () => {
            field.select()
            if (doc.execCommand) doc.execCommand('copy')
            done()
          }
          if (win.navigator.clipboard) win.navigator.clipboard.writeText(link).then(done, fallback)
          else fallback()
        } catch (error) { void error }
      })
      row.append(field, copy)
      box.append(row)
      fillGrid()
      box.append(grid)
    })
    shareButton.setAttribute('aria-expanded', 'true')
  })
  listen(emailButton, 'click', () => {
    const url = shareUrl()
    const href = 'mailto:?subject=' + encodeURIComponent(shareText()) + '&body=' + encodeURIComponent((url ? url + '\n\n' : '') + 'Page ' + (visiblePages()[0] + 1))
    track('share', { method: 'email', content_type: 'catalogue' })
    const link = make('a', '', { href })
    root.append(link)
    link.click()
    link.remove()
  })

  listen(openFullButton, 'click', () => {
    let href = shareUrl()
    try { if (!href) href = String(win.location.href).replace(/[?&]embed=1/, '') } catch (error) { void error }
    const page = visiblePages()[0] + 1
    if (href) win.open(href.split('#')[0] + (page > 1 ? '#page=' + page : ''), '_blank', 'noopener')
    track('select_content', { content_type: 'open_full', page_number: page })
  })
  listen(downloadLink, 'click', () => track('file_download', { file_name: downloadLink.getAttribute('download') || '', file_extension: 'pdf', link_url: /^https?:/i.test(downloadLink.href) ? downloadLink.href : '' }))

  // ---------- auto flip ----------
  const autoSettings = readerSettings.autoFlip || {}
  let autoInterval = Math.max(1.5, Math.min(30, Number(autoSettings.interval) || 4))
  let autoTimer = 0
  const autoFlipping = () => !!autoTimer
  const stopAuto = () => {
    if (autoTimer) win.clearInterval(autoTimer)
    autoTimer = 0
    autoButton.setAttribute('aria-pressed', 'false')
    setIcon(autoButton, 'auto', 'Auto flip')
  }
  const startAuto = () => {
    stopAuto()
    autoTimer = win.setInterval(() => {
      if (destroyed || zoom !== 1 || selectMode || popupEl) return
      const shown = visiblePages()
      if (shown[shown.length - 1] >= pages.length - 1) {
        if (autoSettings.loop === false) { stopAuto(); return }
        openPage(0)
        return
      }
      goPage(1)
    }, autoInterval * 1000)
    autoButton.setAttribute('aria-pressed', 'true')
    setIcon(autoButton, 'autoStop', 'Stop auto flip')
    track('auto_flip', { interval: autoInterval })
  }
  listen(autoButton, 'click', () => { if (autoFlipping()) stopAuto(); else startAuto() })
  listen(autoButton, 'contextmenu', (event) => {
    event.preventDefault()
    openPopover(autoButton, (box) => {
      const title = make('strong')
      title.textContent = 'Auto flip every'
      box.append(title)
      const grid = make('div', 'fs-share-grid')
      ;[2, 3, 4, 6, 8, 12].forEach((seconds) => {
        const option = make('button', 'fs-share-link' + (seconds === autoInterval ? ' is-current' : ''), { type: 'button' })
        option.textContent = seconds + ' s'
        option.addEventListener('click', () => { autoInterval = seconds; closePopover(); startAuto() })
        grid.append(option)
      })
      box.append(grid)
    })
  })
  if (autoSettings.startOnOpen && pages.length > 1) {
    const delay = Math.max(0, Number(autoSettings.startDelay) || 0)
    const timer = win.setTimeout(() => { if (!destroyed) startAuto() }, delay * 1000)
    cleanups.push(() => win.clearTimeout(timer))
  }
  // Clicking outside a popover closes it.
  listen(doc, 'pointerdown', (event) => {
    if (popover && !popover.contains(event.target) && !shareButton.contains(event.target)) closePopover()
  }, true)
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
    if (event.key === 'Escape' && (sheet || searchPanel || selectMode || thumbsPanel || drawer || popover || zoom !== 1)) {
      event.preventDefault()
      event.stopPropagation()
      if (sheet) closeSheet()
      else if (popover) closePopover()
      else if (thumbsPanel) closeThumbs()
      else if (drawer) closeDrawer()
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

  // ---------- phones: one compact bar + "More" sheet, pinch to zoom ----------
  const updateCompact = () => {
    const compact = (root.clientWidth || win.innerWidth || 1024) < 640
    if (compact !== root.classList.contains('fs-compact')) {
      root.classList.toggle('fs-compact', compact)
      if (!compact) closeSheet()
    }
  }
  let sheet = null
  const closeSheet = () => {
    if (!sheet) return
    sheet.remove()
    sheet = null
    moreButton.setAttribute('aria-expanded', 'false')
  }
  const openSheet = () => {
    closePopover()
    closeSheet()
    sheet = make('div', 'fs-sheet', { role: 'dialog', 'aria-label': 'More tools' })
    const backdrop = make('div', 'fs-sheet-backdrop')
    backdrop.addEventListener('click', closeSheet)
    const panel = make('div', 'fs-sheet-panel')
    const grab = make('div', 'fs-sheet-grab', { 'aria-hidden': 'true' })
    const grid = make('div', 'fs-sheet-grid')
    const tools = [].slice.call(leftGroup.children).concat([firstButton, lastButton], [].slice.call(rightGroup.children)).filter((item) => item !== moreButton && !item.hidden)
    tools.forEach((tool) => {
      const item = make('button', 'fs-sheet-item', { type: 'button' })
      const icon = tool.querySelector('svg')
      if (icon) item.append(icon.cloneNode(true))
      const label = make('span')
      label.textContent = tool.getAttribute('aria-label') || ''
      item.append(label)
      if (tool.disabled) item.disabled = true
      if (tool.getAttribute('aria-pressed') === 'true' && tool !== soundButton) item.classList.add('is-on')
      item.addEventListener('click', () => {
        closeSheet()
        // Let the sheet close first so drawers and popovers position against the bar.
        win.setTimeout(() => tool.click(), 0)
      })
      grid.append(item)
    })
    panel.append(grab, grid)
    sheet.append(backdrop, panel)
    root.append(sheet)
    moreButton.setAttribute('aria-expanded', 'true')
  }
  listen(moreButton, 'click', () => { if (sheet) closeSheet(); else openSheet() })
  cleanups.push(closeSheet)
  // Two fingers zoom the page (one finger still turns pages).
  let pinch = null
  const touchDistance = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
  listen(stage, 'touchstart', (event) => {
    if (event.touches.length !== 2) return
    event.stopPropagation()
    pinch = { distance: touchDistance(event.touches) || 1, zoom }
  }, { capture: true, passive: true })
  listen(stage, 'touchmove', (event) => {
    if (!pinch || event.touches.length !== 2) return
    event.stopPropagation()
    if (event.cancelable) event.preventDefault()
    const ratio = touchDistance(event.touches) / pinch.distance
    const midX = (event.touches[0].clientX + event.touches[1].clientX) / 2
    const midY = (event.touches[0].clientY + event.touches[1].clientY) / 2
    const target = Math.max(1, Math.min(ZOOMS[ZOOMS.length - 1], pinch.zoom * ratio))
    if (Math.abs(target - zoom) > 0.04) setZoom(target < 1.08 ? 1 : target, midX, midY)
  }, { capture: true, passive: false })
  listen(stage, 'touchend', (event) => { if (pinch && event.touches.length < 2) pinch = null }, { capture: true, passive: true })

  // ---------- visitor consent for analytics (optional cookie notice) ----------
  if (opts.standalone && (analyticsId || readerSettings.metaPixelId || readerSettings.linkedinPartnerId) && readerSettings.analyticsConsent) {
    let choice = ''
    try { choice = (storage && storage.getItem('fs-consent')) || '' } catch (error) { void error }
    if (!choice) {
      const notice = make('div', 'fs-consent', { role: 'region', 'aria-label': 'Cookie notice' })
      const text = make('p')
      text.textContent = 'We use cookies to count visits and see which pages are read, so we can improve this catalogue.'
      const actions = make('div', 'fs-consent-actions')
      const decline = make('button', 'fs-reader-btn', { type: 'button' })
      decline.textContent = 'Decline'
      const accept = make('button', 'fs-reader-btn fs-consent-accept', { type: 'button' })
      accept.textContent = 'Accept'
      const decide = (value) => {
        try { if (storage) storage.setItem('fs-consent', value) } catch (error) { void error }
        if (value === 'granted') {
          try { if (typeof win.gtag === 'function') win.gtag('consent', 'update', { analytics_storage: 'granted', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' }) } catch (error) { void error }
          try { if (typeof win.fsLoadAds === 'function') win.fsLoadAds() } catch (error) { void error }
        }
        notice.remove()
      }
      decline.addEventListener('click', () => decide('denied'))
      accept.addEventListener('click', () => decide('granted'))
      actions.append(decline, accept)
      notice.append(text, actions)
      root.append(notice)
    }
  }

  let resizeFrame = 0
  const onResize = () => {
    updateCompact()
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

  updateCompact()
  buildBook()
  updateCount()
  syncMedia()
  if (animations.length && opts.autoplay !== false) clock.play()
  if (pageLinks) {
    listen(win, 'hashchange', () => {
      const linked = pageFromAddress()
      if (linked >= 0 && visiblePages().indexOf(linked) < 0) openPage(linked)
    })
  }
  if (statsCfg) {
    const pubKey = statsCfg.pub || 'site'
    try {
      if (!win.sessionStorage.getItem('fs-visit:' + pubKey)) { stat('visit', ''); win.sessionStorage.setItem('fs-visit:' + pubKey, '1') }
    } catch (error) { void error; stat('visit', '') }
    try {
      const today = new Date().toISOString().slice(0, 10)
      if (storage && storage.getItem('fs-day:' + pubKey) !== today) { stat('visitor', ''); storage.setItem('fs-day:' + pubKey, today) }
    } catch (error) { void error }
    listen(doc, 'visibilitychange', () => { if (doc.visibilityState === 'hidden') flushStats(true) })
    listen(win, 'pagehide', () => flushStats(true))
    cleanups.push(() => { win.clearTimeout(statTimer); flushStats(true) })
  }
  reportPageView()
  cleanups.push(() => win.clearTimeout(viewTimer))

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
      closeDrawer()
      closePopover()
      stopAuto()
      media.forEach((item) => { try { item.deactivate() } catch (error) { void error } })
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
      root.classList.remove('fs-reader', 'fs-selecting', 'fs-zoomed', 'fs-no-book-shadow', 'fs-compact', 'fs-embedded')
      Object.keys(themeVars).forEach((key) => root.style.removeProperty(key))
    },
  }
}
