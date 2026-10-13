import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { JSDOM } from 'jsdom'
import JSZip from 'jszip'
import {
  buildExportHtml,
  buildExportZip,
  buildPublicationData,
  buildSelfContainedExportHtml,
  createAsset,
  createProject,
  findMissingAssets,
  getAnimationValue,
  getSlideshowStateForIndex,
  mergeAssets,
  PROJECT_VERSION,
  serializeProject,
  validateProject,
  type ProjectAnimation,
  type ProjectState,
} from './project'

const PNG_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
const PNG_B = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const PNG_C = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

function slideshowProject(): ProjectState {
  const a = createAsset({ name: 'a.png', dataUrl: PNG_A })
  const b = createAsset({ name: 'b.png', dataUrl: PNG_B })
  const c = createAsset({ name: 'c.png', dataUrl: PNG_C })
  return createProject({
    version: PROJECT_VERSION,
    title: 'Slideshow </script><script>alert(1)</script>',
    assets: { [a.id]: a, [b.id]: b, [c.id]: c },
    pages: [
      {
        id: 'page-1',
        name: 'Cover',
        width: 800,
        height: 1000,
        previewUrl: PNG_A,
        overlays: [
          {
            id: 'gallery',
            type: 'slideshow',
            label: 'Gallery',
            x: 100,
            y: 100,
            width: 400,
            height: 300,
            rotation: 0,
            opacity: 1,
            visible: true,
            autoplay: true,
            looping: true,
            duration: 1,
            transition: 'slide',
            transitionDuration: 0.3,
            fit: 'contain',
            slides: [
              { id: 's1', assetId: a.id, alt: 'one' },
              { id: 's2', assetId: b.id, alt: 'two' },
              { id: 's3', assetId: c.id, alt: 'three' },
            ],
          },
          { id: 'photo', type: 'image', label: 'Photo', x: 400, y: 600, width: 200, height: 200, rotation: 0, opacity: 1, visible: true, assetId: a.id },
        ],
      },
      { id: 'page-2', name: 'Inside', width: 800, height: 1000, overlays: [] },
    ],
    animations: [
      { id: 'slide-in', targetId: 'photo', type: 'move-x', start: 0, delay: 0, duration: 2, easing: 'linear', from: -400, to: 0, loop: false, alternate: false },
      { id: 'fade', targetId: 'photo', type: 'fade-in', start: 0, delay: 0, duration: 2, easing: 'linear', from: 0, to: 1, loop: false, alternate: false },
    ],
  })
}

/** Runs exported HTML in an isolated DOM with scripts enabled, as a browser would. */
function runPublication(html: string) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true })
  const { window } = dom
  return { dom, window, document: window.document }
}

describe('project model', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('serializes and reopens projects with overlay data intact', () => {
    const project = createProject({
      title: 'Sample catalogue',
      pages: [{ id: 'page-1', name: 'Cover', width: 1000, height: 1400, overlays: [{ id: 'overlay-1', type: 'text', label: 'Spring collection', x: 120, y: 200, width: 260, height: 60, rotation: 0, opacity: 1, visible: true }] }],
    })
    const parsed = JSON.parse(serializeProject(project))
    expect(parsed.version).toBe(PROJECT_VERSION)
    expect(parsed.pages[0].overlays[0].label).toBe('Spring collection')
    expect(validateProject(parsed).valid).toBe(true)
  })

  it('creates a blank page instead of remote sample content', () => {
    const project = createProject()
    expect(project.pages).toHaveLength(1)
    expect(project.pages[0].overlays).toEqual([])
  })

  it('stores identical images once and keeps stable content-based asset IDs', () => {
    const first = createAsset({ name: 'a.png', dataUrl: PNG_A })
    const again = createAsset({ name: 'copy-of-a.png', dataUrl: PNG_A })
    const other = createAsset({ name: 'b.png', dataUrl: PNG_B })
    expect(first.id).toBe(again.id)
    const merged = mergeAssets({}, [first, again, other])
    expect(Object.keys(merged.assets)).toHaveLength(2)
    expect(merged.ids).toEqual([first.id, first.id, other.id])
  })

  it('migrates inline data URLs into managed assets and prunes unused assets on save', () => {
    const project = createProject({
      pages: [{
        id: 'p',
        overlays: [
          { id: 'img', type: 'image', label: 'Image', src: PNG_A },
          { id: 'show', type: 'slideshow', label: 'Show', slides: [{ id: 's1', src: PNG_A }, { id: 's2', src: PNG_B }] },
        ],
      }],
    })
    const image = project.pages[0].overlays[0]
    const show = project.pages[0].overlays[1]
    expect(image.src).toBeUndefined()
    expect(image.assetId).toBe(show.slides![0].assetId)
    expect(Object.keys(project.assets)).toHaveLength(2)

    const withOrphan = { ...project, assets: { ...project.assets, orphan: createAsset({ name: 'x', dataUrl: PNG_C }) } }
    const saved = JSON.parse(serializeProject(withOrphan)) as ProjectState
    expect(Object.keys(saved.assets)).toHaveLength(2)
    expect(serializeProject(project).match(/iVBORw0KGgo/g)).toHaveLength(2)
  })

  it('round-trips slideshow images in order with every setting', () => {
    const project = slideshowProject()
    const reopened = createProject(JSON.parse(serializeProject(project)))
    const gallery = reopened.pages[0].overlays[0]
    expect(gallery.slides!.map((slide) => slide.alt)).toEqual(['one', 'two', 'three'])
    expect(gallery.slides!.every((slide) => reopened.assets[slide.assetId!]?.dataUrl.startsWith('data:image/png'))).toBe(true)
    expect(gallery).toMatchObject({ autoplay: true, looping: true, duration: 1, transition: 'slide', transitionDuration: 0.3, fit: 'contain' })
    expect(reopened.animations).toEqual(project.animations)
    expect(findMissingAssets(reopened)).toEqual([])
  })

  it('reports missing assets instead of failing to open', () => {
    const project = slideshowProject()
    const broken = JSON.parse(serializeProject(project))
    delete broken.assets[project.pages[0].overlays[0].slides![1].assetId!]
    expect(validateProject(broken).valid).toBe(true)
    expect(findMissingAssets(createProject(broken))).toHaveLength(1)
  })

  it('rejects projects from a newer format and malformed data', () => {
    expect(validateProject({ version: PROJECT_VERSION + 1, pages: [] }).valid).toBe(false)
    expect(validateProject({ pages: [{ overlays: 'nope' }] }).valid).toBe(false)
    expect(validateProject(null).valid).toBe(false)
  })

  it('cycles slideshow state helpers without damaging configuration', () => {
    const state = getSlideshowStateForIndex({ slides: [{ id: 's1', src: 'a.png' }, { id: 's2', src: 'b.png' }] }, 3)
    expect(state).toEqual({ currentIndex: 1, totalSlides: 2, activeImage: 'b.png' })
  })

  it('migrates legacy v1 overlay animations into relative v3 animations', () => {
    const legacy = {
      version: 1,
      pages: [{
        id: 'legacy-page',
        name: 'Legacy',
        width: 600,
        height: 800,
        overlays: [{
          id: 'legacy-text', type: 'text' as const, label: 'Legacy text', x: 20, y: 30, width: 200, height: 60, rotation: 0, opacity: 1, visible: true,
          animation: { start: 2, duration: 3, easing: 'linear', entrance: 'move', exit: 'fade' },
        }],
      }],
    }
    const migrated = createProject(legacy)
    const reopened = createProject(JSON.parse(serializeProject(migrated)))
    expect(migrated.version).toBe(PROJECT_VERSION)
    expect(migrated.animations).toEqual([expect.objectContaining({ id: 'migrated-legacy-text', targetId: 'legacy-text', type: 'move-y', start: 2, duration: 3, from: 40, to: 0 })])
    expect(reopened.animations).toEqual(migrated.animations)
    expect(reopened.pages[0].overlays[0].animation).toBeUndefined()
  })

  it('converts v2 absolute animation values into offsets from the object', () => {
    const v2 = {
      version: 2,
      pages: [{ id: 'p', width: 1000, height: 1000, overlays: [{ id: 'o', type: 'image' as const, x: 300, y: 50, rotation: 10, opacity: 0.5 }] }],
      animations: [
        { id: 'mx', targetId: 'o', type: 'move-x' as const, start: 0, duration: 1, easing: 'linear' as const, from: 100, to: 300, loop: false },
        { id: 'r', targetId: 'o', type: 'rotation' as const, start: 0, duration: 1, easing: 'linear' as const, from: 10, to: 370, loop: false },
        { id: 'f', targetId: 'o', type: 'fade-in' as const, start: 0, duration: 1, easing: 'linear' as const, from: 0, to: 0.5, loop: false },
      ],
    }
    const project = createProject(v2)
    expect(project.animations.map((animation) => [animation.from, animation.to])).toEqual([[-200, 0], [0, 360], [0, 1]])
    expect(createProject(JSON.parse(serializeProject(project))).animations).toEqual(project.animations)
  })

  it('evaluates animation values through the shared engine', () => {
    const animation: ProjectAnimation = { id: 'move', targetId: 't', type: 'move-x', start: 2, delay: 0, duration: 2, easing: 'linear', from: 10, to: 30, loop: false, alternate: false }
    expect(getAnimationValue(animation, 1.5)).toBe(10)
    expect(getAnimationValue(animation, 3)).toBe(20)
    expect(getAnimationValue(animation, 5)).toBe(30)
    expect(getAnimationValue({ ...animation, loop: true }, 6)).toBe(10)
  })
})

describe('publication export', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('builds reader data with the same object IDs, geometry and animations as the project', () => {
    const project = slideshowProject()
    const data = buildPublicationData(project)
    expect(data.pages.map((page) => page.overlays.map((overlay) => overlay.id))).toEqual([['gallery', 'photo'], []])
    expect(data.pages[0].overlays[0].slides!.map((slide) => slide.src)).toEqual([PNG_A, PNG_B, PNG_C])
    expect(data.animations).toEqual(project.animations)
  })

  it('escapes titles and labels so content cannot break out of the page', () => {
    const html = buildExportHtml(slideshowProject())
    expect(html).toContain('<title>Slideshow &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>')
    expect(html).not.toContain('</script><script>alert(1)')
    const { document } = runPublication(html)
    expect(document.querySelectorAll('script').length).toBe(3)
  })

  it('runs the exported HTML: pages, objects, slideshow transitions and animation scrubbing', async () => {
    const { window, document } = runPublication(buildExportHtml(slideshowProject()))
    const root = document.getElementById('publication')!
    expect(root.classList.contains('fs-reader')).toBe(true)
    expect(document.querySelectorAll('.fs-book-page')).toHaveLength(2)

    const gallery = document.querySelector<HTMLElement>('[data-object-id="gallery"]')!
    const slides = gallery.querySelectorAll('.fs-slide')
    expect(slides).toHaveLength(3)
    expect(gallery.querySelector('.fs-slides')!.getAttribute('data-transition')).toBe('slide')
    expect(slides[0].className).toContain('is-active')
    await new Promise((resolve) => window.setTimeout(resolve, 1150))
    expect(gallery.getAttribute('data-slide')).toBe('1')
    expect(slides[1].className).toContain('is-active dir-forward')
    expect(slides[0].className).toContain('is-leaving')
    gallery.querySelector<HTMLButtonElement>('.fs-ss-prev')!.click()
    expect(gallery.getAttribute('data-slide')).toBe('0')

    const photo = document.querySelector<HTMLElement>('[data-object-id="photo"]')!
    const scrub = document.querySelector<HTMLInputElement>('[data-action="scrub"]')!
    document.querySelector<HTMLButtonElement>('[data-action="stop"]')!.click()
    expect(photo.style.left).toBe('0%')
    expect(photo.style.opacity).toBe('0')
    scrub.value = '1'
    scrub.dispatchEvent(new window.Event('input'))
    expect(photo.style.left).toBe('25%')
    expect(photo.style.opacity).toBe('0.5')
    scrub.value = '2'
    scrub.dispatchEvent(new window.Event('input'))
    expect(photo.style.left).toBe('50%')
    expect(photo.style.opacity).toBe('1')
    window.close()
  })

  it('packages a ZIP whose publication works from a clean directory with relative asset paths', async () => {
    const generated = await buildExportZip(slideshowProject())
    const extracted = await JSZip.loadAsync(generated)
    const names = Object.keys(extracted.files).filter((name) => !extracted.files[name].dir).sort()
    expect(names).toContain('publication/index.html')
    expect(names).toContain('publication/project.flipstudio.json')
    expect(names).toContain('README.txt')
    expect(names.filter((name) => name.startsWith('publication/assets/'))).toHaveLength(3)
    expect(names.filter((name) => name.startsWith('publication/pages/'))).toHaveLength(1)

    const cleanDirectory = await mkdtemp(join(tmpdir(), 'flipstudio-publication-'))
    try {
      await Promise.all(names.map(async (name) => {
        const destination = join(cleanDirectory, name)
        await mkdir(dirname(destination), { recursive: true })
        await writeFile(destination, await extracted.file(name)!.async('nodebuffer'))
      }))
      const html = await readFile(join(cleanDirectory, 'publication', 'index.html'), 'utf8')
      expect(html).not.toContain('data:image/png;base64,iVBOR')
      expect(html).not.toContain('C:\\\\Users')
      const { document, window } = runPublication(html)
      const slideSources = [...document.querySelectorAll<HTMLImageElement>('[data-object-id="gallery"] .fs-slide')].map((img) => img.getAttribute('src')!)
      expect(slideSources).toHaveLength(3)
      for (const source of slideSources) {
        expect(source).toMatch(/^assets\//)
        const bytes = await readFile(join(cleanDirectory, 'publication', source))
        expect(bytes.subarray(1, 4).toString()).toBe('PNG')
      }
      expect(document.querySelector('.fs-page-bg')!.getAttribute('src')).toMatch(/^pages\/page-001\.png$/)
      window.close()

      const reopened = createProject(JSON.parse(await readFile(join(cleanDirectory, 'publication', 'project.flipstudio.json'), 'utf8')))
      expect(reopened.pages[0].overlays[0].slides).toHaveLength(3)
      expect(findMissingAssets(reopened)).toEqual([])
    } finally {
      await rm(cleanDirectory, { recursive: true, force: true })
    }
  })

  it('embeds remote project media into the standalone publication', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(['remote image bytes'], { type: 'image/png' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const project = createProject({
      title: 'Remote asset export',
      pages: [{ id: 'page-1', name: 'Cover', width: 800, height: 1000, overlays: [{ id: 'remote-image', type: 'image', label: 'Remote image', src: 'https://assets.example.invalid/cover.png', x: 0, y: 0, width: 200, height: 200 }] }],
    })

    const html = await buildSelfContainedExportHtml(project)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(html).toContain('data:image/png;base64,')
    expect(html).not.toContain('https://assets.example.invalid')
  })

  it('reports an actionable error when remote media cannot be embedded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    const project = createProject({ pages: [{ id: 'p', overlays: [{ id: 'r', type: 'image', label: 'R', src: 'https://example.invalid/x.png' }] }] })
    await expect(buildSelfContainedExportHtml(project)).rejects.toThrow(/HTTP 404/)
  })
})
