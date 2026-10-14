import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import JSZip from 'jszip'
import { cropStyle, frameStyle, normalizeWebUrl, resolveAction, skinClassName, skinStyle, styleFor, videoSource } from './styles.js'
import { buildExportZip, buildSelfContainedExportHtml, createProject, PROJECT_VERSION, serializeProject, usedFonts } from '../lib/project'

describe('click actions', () => {
  it('builds safe links for every action type', () => {
    expect(resolveAction({ type: 'button', link: { type: 'url', value: 'www.kross-over.net' } })).toEqual({ kind: 'href', href: 'https://www.kross-over.net', newTab: true })
    expect(resolveAction({ type: 'button', link: { type: 'url', value: 'https://a.com', newTab: false } })).toEqual({ kind: 'href', href: 'https://a.com', newTab: false })
    expect(resolveAction({ type: 'button', link: { type: 'url', value: 'javascript:alert(1)' } })).toBeNull()
    expect(resolveAction({ type: 'button', link: { type: 'whatsapp', value: '+971 52 677 6884', message: 'Hi there' } })).toEqual({ kind: 'href', href: 'https://wa.me/971526776884?text=Hi%20there', newTab: true })
    expect(resolveAction({ type: 'button', link: { type: 'email', value: 'sales@example.com', subject: 'Quote' } })).toEqual({ kind: 'href', href: 'mailto:sales@example.com?subject=Quote', newTab: false })
    expect(resolveAction({ type: 'button', link: { type: 'email', value: 'not-an-email' } })).toBeNull()
    expect(resolveAction({ type: 'button', link: { type: 'phone', value: '+971 4 123 4567' } })).toEqual({ kind: 'href', href: 'tel:+97141234567', newTab: false })
    expect(resolveAction({ type: 'button', link: { type: 'page', value: '3' } })).toEqual({ kind: 'page', page: 2 })
    expect(resolveAction({ type: 'hotspot', link: { type: 'popup' } })).toBeNull()
    expect(resolveAction({ type: 'hotspot', link: { type: 'popup' }, popup: { title: 'x' } })).toEqual({ kind: 'popup' })
    expect(resolveAction({ type: 'text', url: 'https://legacy.example' })).toEqual({ kind: 'href', href: 'https://legacy.example', newTab: true })
    expect(normalizeWebUrl('ftp://x')).toBe('')
  })

  it('migrates the old URL field into a link action', () => {
    const project = createProject({ pages: [{ id: 'p', overlays: [{ id: 'b', type: 'button', label: 'Go', url: 'https://old.example' }] }] })
    expect(project.pages[0].overlays[0].link).toEqual({ type: 'url', value: 'https://old.example', newTab: true })
    expect(JSON.parse(serializeProject(project)).pages[0].overlays[0].url).toBeUndefined()
  })
})

describe('object styling', () => {
  it('merges type defaults with the object style and scales sizes with the page', () => {
    const button = { type: 'button', fontSize: 30, style: { background: '#25d366', radius: 50, borderWidth: 10, borderColor: '#000' } }
    expect(styleFor(button)).toMatchObject({ background: '#25d366', color: '#ffffff', textAlign: 'center' })
    const css = skinStyle(button, { width: 1000, height: 1000 }, "'Inter', sans-serif")
    expect(css).toMatchObject({ fontSize: '3cqw', borderRadius: '5cqw', borderWidth: '1cqw', background: '#25d366', fontFamily: "'Inter', sans-serif" })
    const gradient = skinStyle({ type: 'text', style: { textGradient: { from: '#000', to: '#fff', angle: 90 } } }, { width: 500, height: 500 })
    expect(gradient['--fs-text-gradient']).toBe('linear-gradient(90deg, #000, #fff)')
  })

  it('adds effect, hover and hotspot visibility classes', () => {
    expect(skinClassName({ type: 'button', effect: 'pulse', hoverEffect: 'lift' })).toBe('fs-skin fs-fx-pulse fs-hover-lift')
    expect(skinClassName({ type: 'hotspot', style: { reveal: 'hover' } })).toContain('fs-reveal-hover')
    expect(skinClassName({ type: 'hotspot', style: { reveal: 'never' } })).toContain('fs-reveal-never')
  })
})

function styledProject() {
  return createProject({
    version: PROJECT_VERSION,
    title: 'Styled',
    pages: [
      {
        id: 'p1',
        width: 600,
        height: 800,
        overlays: [
          { id: 'cta', type: 'button', label: 'Chat on WhatsApp', x: 10, y: 10, width: 200, height: 60, style: { fontFamily: 'playfair-display', background: '#25d366' }, effect: 'pulse', hoverEffect: 'lift', link: { type: 'whatsapp', value: '+971500000000', message: 'Hello' } },
          { id: 'spot', type: 'hotspot', label: 'Wallet', x: 300, y: 300, width: 100, height: 100, style: { marker: 'plus', reveal: 'always' }, effect: 'beacon', tooltip: 'Tap for details', link: { type: 'popup' }, popup: { title: 'Leather Wallet', description: 'Genuine leather', price: 'AED 89', buttonLabel: 'See page 2', link: { type: 'page', value: '2' } } },
          { id: 'goto', type: 'text', label: 'Next chapter →', x: 10, y: 700, width: 300, height: 50, link: { type: 'page', value: '2' } },
        ],
      },
      { id: 'p2', width: 600, height: 800, overlays: [] },
    ],
  })
}

const fakeFont = async () => new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4])

describe('styled objects in exported publications', () => {
  it('embeds only the fonts in use and reports fonts that cannot be embedded', async () => {
    const project = styledProject()
    expect(usedFonts(project).map((font) => font.id).sort()).toEqual(['inter', 'playfair-display'])
    const html = await buildSelfContainedExportHtml(project, { loadFont: fakeFont })
    expect(html).toContain("font-family:'Playfair Display'")
    expect(html).toMatch(/src:url\("data:font\/woff2;base64,d09GMgECAwQ="\)/)
    expect(html).not.toContain("font-family:'Bebas Neue'")

    const warnings: string[] = []
    await buildSelfContainedExportHtml(project, { loadFont: async () => { throw new Error('offline') }, onWarning: (message) => warnings.push(message) })
    expect(warnings.some((message) => message.includes('Playfair Display') && message.includes('offline'))).toBe(true)
  })

  it('writes font files into the ZIP and references them relatively', async () => {
    const zip = await JSZip.loadAsync(await buildExportZip(styledProject(), { loadFont: fakeFont }))
    const fonts = Object.keys(zip.files).filter((name) => name.startsWith('publication/fonts/'))
    expect(fonts.length).toBeGreaterThanOrEqual(2)
    const html = await zip.file('publication/index.html')!.async('string')
    expect(html).toMatch(/src:url\("fonts\/playfair-display-700\.woff2"\)/)
  })

  it('runs links, pop-ups, go-to-page actions, tooltips and effects in the exported HTML', async () => {
    const dom = new JSDOM(await buildSelfContainedExportHtml(styledProject(), { loadFont: fakeFont }), { runScripts: 'dangerously', pretendToBeVisual: true })
    const { document } = dom.window
    const cta = document.querySelector<HTMLAnchorElement>('[data-object-id="cta"]')!
    expect(cta.tagName).toBe('A')
    expect(cta.getAttribute('href')).toBe('https://wa.me/971500000000?text=Hello')
    expect(cta.getAttribute('target')).toBe('_blank')
    const skin = cta.querySelector<HTMLElement>('.fs-skin')!
    expect(skin.className).toBe('fs-skin fs-fx-pulse fs-hover-lift')
    expect(skin.style.fontFamily).toContain('Playfair Display')

    const spot = document.querySelector<HTMLElement>('[data-object-id="spot"]')!
    expect(spot.getAttribute('role')).toBe('button')
    expect(spot.querySelector('.fs-marker')!.textContent).toBe('+')
    expect(spot.querySelector('.fs-tooltip')!.textContent).toBe('Tap for details')
    spot.click()
    expect(document.querySelector('.fs-popup-title')!.textContent).toBe('Leather Wallet')
    expect(document.querySelector('.fs-popup-price')!.textContent).toBe('AED 89')
    document.querySelector<HTMLButtonElement>('.fs-popup-close')!.click()
    expect(document.querySelector('.fs-popup')).toBeNull()

    expect(document.querySelector('[data-object-id="goto"]')!.getAttribute('data-action')).toBe('page')
    dom.window.close()
  })

  it('opens the linked page from a go-to-page action and from a pop-up button', async () => {
    const { mountPublication } = await import('./reader.js')
    const { buildPublicationData } = await import('../lib/project')
    const root = document.createElement('div')
    document.body.append(root)
    const handle = mountPublication(root, buildPublicationData(styledProject()), { autoplay: false })
    root.querySelector<HTMLElement>('[data-object-id="goto"]')!.click()
    expect(handle.currentPage).toBe(1)
    handle.goToPage(0)
    root.querySelector<HTMLElement>('[data-object-id="spot"]')!.click()
    root.querySelector<HTMLButtonElement>('.fs-popup-cta')!.click()
    expect(handle.currentPage).toBe(1)
    expect(root.querySelector('.fs-popup')).toBeNull()
    handle.destroy()
    root.remove()
  })
})

describe('image frames and crop', () => {
  const page = { width: 1000, height: 1400 }
  it('turns frame settings into page-relative corners, border and shadow', () => {
    expect(frameStyle({ type: 'image', style: { radius: 28 } }, page)).toEqual({ borderRadius: '2.8cqw', border: 'none', boxShadow: 'none' })
    expect(frameStyle({ type: 'image', style: { shape: 'circle', borderWidth: 4, borderColor: '#ff0000' } }, page).borderRadius).toBe('50%')
    expect(frameStyle({ type: 'slideshow', style: { shape: 'rounded', radius: 12, borderWidth: 4, borderColor: '#ff0000' } }, page).border).toBe('0.4cqw solid #ff0000')
    expect(frameStyle({ type: 'image' }, page).borderRadius).toBe('0')
  })
  it('positions a zoomed image around the focal point and clamps values', () => {
    expect(cropStyle({})).toMatchObject({ width: '100%', height: '100%', left: '0%', top: '0%' })
    expect(cropStyle({ crop: { zoom: 2, x: 100, y: 0 } })).toMatchObject({ width: '200%', left: '-100%', top: '0%', objectPosition: '100% 0%' })
    expect(cropStyle({ crop: { zoom: 9, x: -20, y: 50 } })).toMatchObject({ width: '500%', left: '0%', top: '-200%' })
  })
})

describe('videoSource', () => {
  it('turns YouTube links into privacy-friendly embeds', () => {
    for (const url of ['https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30', 'youtube.com/shorts/dQw4w9WgXcQ', 'https://m.youtube.com/embed/dQw4w9WgXcQ']) {
      const source = videoSource(url)
      expect(source?.kind).toBe('youtube')
      expect(source?.src.startsWith('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?')).toBe(true)
    }
    expect(videoSource('https://youtu.be/dQw4w9WgXcQ', { autoplay: true, loop: true })?.src).toContain('autoplay=1&mute=1&loop=1&playlist=dQw4w9WgXcQ')
  })
  it('handles Vimeo, direct files and rejects other links', () => {
    expect(videoSource('https://vimeo.com/76979871')?.src).toBe('https://player.vimeo.com/video/76979871?dnt=1&playsinline=1&title=0&byline=0&portrait=0')
    expect(videoSource('https://cdn.example.com/promo.mp4')?.kind).toBe('file')
    expect(videoSource('data:video/mp4;base64,AAAA')?.kind).toBe('file')
    expect(videoSource('https://example.com/page')).toBeNull()
    expect(videoSource('javascript:alert(1)')).toBeNull()
    expect(videoSource('')).toBeNull()
  })
})
