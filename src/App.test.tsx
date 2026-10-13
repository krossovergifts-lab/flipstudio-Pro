import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as pdfjsLib from 'pdfjs-dist'
import App from './App'

const pageFlipInstances: Array<{ pages: Element[]; destroyed: boolean }> = []

vi.mock('page-flip', () => {
  class PageFlip {
    pages: Element[] = []
    destroyed = false
    mount: HTMLElement
    constructor(mount: HTMLElement) {
      this.mount = mount
      pageFlipInstances.push(this)
    }
    loadFromHTML(items: Element[]) {
      this.pages = [...items]
      this.mount.append(...items)
    }
    destroy() { this.destroyed = true }
    on() { return this }
    update() {}
    getCurrentPageIndex() { return 0 }
    turnToPage() {}
    flipPrev() {}
    flipNext() {}
  }
  return { PageFlip, default: { PageFlip } }
})

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(),
}))

/** jsdom never decodes images; this stand-in reports a 640×400 image so imports finish immediately. */
class DecodingImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 640
  naturalHeight = 400
  set src(value: string) {
    window.setTimeout(() => (value.includes('not-an-image') ? this.onerror?.() : this.onload?.()), 0)
  }
}

function pngFile(name: string, content = name): File {
  return new File([content], name, { type: 'image/png' })
}

function slideshowInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('[data-testid="slideshow-input"]')!
}

async function createSlideshow(names = ['one.png', 'two.png', 'three.png']) {
  fireEvent.click(screen.getByRole('button', { name: 'Add slideshow' }))
  fireEvent.change(slideshowInput(), { target: { files: names.map((name) => pngFile(name)) } })
  await waitFor(() => expect(screen.getByText(`Slideshow created with ${names.length} images`)).toBeTruthy())
}

function slideNames(): string[] {
  return within(screen.getByRole('list', { name: 'Slideshow images' }))
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.slide-name')!.textContent!.replace(/^\d+\.\s*/, ''))
}

function projectInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('input[accept="application/json,.json"]')!
}

async function reopenFromJson(json: string) {
  const file = new File([json], 'reopened.flipstudio.json', { type: 'application/json' })
  Object.defineProperty(file, 'text', { value: async () => json })
  fireEvent.change(projectInput(), { target: { files: [file] } })
  await waitFor(() => expect(screen.getByText('Opened reopened.flipstudio.json')).toBeTruthy())
}

beforeEach(() => {
  localStorage.clear()
  pageFlipInstances.length = 0
  vi.stubGlobal('Image', DecodingImage)
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('editor workflows', () => {
  it('imports an image, edits text, and restores saved project data', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Spring edit' } })
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Temporary change' } })
    fireEvent.click(screen.getByRole('button', { name: /^Open$/ }))
    expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('Spring edit')

    fireEvent.click(screen.getByRole('button', { name: 'Add image' }))
    const imageInput = document.querySelector<HTMLInputElement>('[data-testid="image-input"]')!
    fireEvent.change(imageInput, { target: { files: [pngFile('cover.png', 'image bytes')] } })

    await waitFor(() => expect(screen.getByAltText('cover.png')).toBeTruthy())
    expect(screen.getByAltText('cover.png').getAttribute('src')).toMatch(/^data:image\/png;base64,/)
    expect(screen.getByText(/1 asset\b/)).toBeTruthy()
  })

  it('creates a slideshow from three images chosen in one picker and plays it', async () => {
    render(<App />)
    await createSlideshow()

    const overlay = document.querySelector<HTMLElement>('.page-canvas [data-type="slideshow"]')!
    expect(overlay.querySelectorAll('.fs-slide')).toHaveLength(3)
    expect(new Set([...overlay.querySelectorAll('img')].map((img) => img.getAttribute('src'))).size).toBe(3)
    expect(slideNames()).toEqual(['one', 'two', 'three'])
    expect(screen.getByTestId('slide-position').textContent).toBe('1 / 3')

    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }))
    expect(screen.getByTestId('slide-position').textContent).toBe('2 / 3')
    expect(overlay.querySelectorAll('.fs-slide')[1].className).toContain('is-active dir-forward')

    fireEvent.change(screen.getByLabelText('Seconds per image'), { target: { value: '0.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Play preview' }))
    await waitFor(() => expect(screen.getByTestId('slide-position').textContent).toBe('3 / 3'), { timeout: 1500 })
    await waitFor(() => expect(screen.getByTestId('slide-position').textContent).toBe('1 / 3'), { timeout: 1500 })
    fireEvent.click(screen.getByRole('button', { name: 'Pause preview' }))
  })

  it('reorders, removes, adds and replaces slideshow images, then persists them', async () => {
    render(<App />)
    await createSlideshow()

    fireEvent.click(screen.getByRole('button', { name: 'Move slide 1 down' }))
    expect(slideNames()).toEqual(['two', 'one', 'three'])
    fireEvent.click(screen.getByRole('button', { name: 'Remove slide 3' }))
    expect(slideNames()).toEqual(['two', 'one'])

    fireEvent.click(screen.getByRole('button', { name: 'Add more images' }))
    fireEvent.change(slideshowInput(), { target: { files: [pngFile('four.png'), pngFile('five.png')] } })
    await waitFor(() => expect(slideNames()).toEqual(['two', 'one', 'four', 'five']))

    fireEvent.click(screen.getByRole('button', { name: 'Replace slide 2' }))
    expect(slideshowInput().multiple).toBe(false)
    fireEvent.change(slideshowInput(), { target: { files: [pngFile('six.png')] } })
    await waitFor(() => expect(slideNames()).toEqual(['two', 'six', 'four', 'five']))

    fireEvent.change(screen.getByLabelText('Transition'), { target: { value: 'slide' } })
    fireEvent.click(screen.getByLabelText('Loop'))
    fireEvent.change(screen.getByLabelText('Image fit'), { target: { value: 'contain' } })

    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    const saved = localStorage.getItem('flipstudio-pro-project')!
    const parsed = JSON.parse(saved)
    const show = parsed.pages[0].overlays[0]
    expect(show.slides.map((slide: { alt: string }) => slide.alt)).toEqual(['two', 'six', 'four', 'five'])
    expect(show).toMatchObject({ transition: 'slide', looping: false, fit: 'contain' })
    expect(Object.keys(parsed.assets)).toHaveLength(4)
    expect(show.slides.every((slide: { assetId: string; src?: string }) => parsed.assets[slide.assetId] && !slide.src)).toBe(true)

    cleanup()
    render(<App />)
    await reopenFromJson(saved)
    expect(slideNames()).toEqual(['two', 'six', 'four', 'five'])
    expect((screen.getByLabelText('Transition') as HTMLSelectElement).value).toBe('slide')
    expect((screen.getByLabelText('Loop') as HTMLInputElement).checked).toBe(false)
    expect(document.querySelectorAll('.page-canvas [data-type="slideshow"] .fs-slide')).toHaveLength(4)
  })

  it('reports invalid image files without losing the valid ones', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Add slideshow' }))
    fireEvent.change(slideshowInput(), {
      target: { files: [pngFile('good.png'), new File(['x'], 'notes.txt', { type: 'text/plain' }), pngFile('also-good.png')] },
    })
    await waitFor(() => expect(screen.getByText('Slideshow created with 2 images')).toBeTruthy())
    expect(screen.getByText(/notes\.txt is not a supported image/)).toBeTruthy()
  })

  it('imports rendered PDF pages, builds matching thumbnails, and navigates pages', async () => {
    const renderedPage = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 200 * scale, height: 300 * scale }),
      render: () => ({ promise: Promise.resolve() }),
    }
    vi.mocked(pdfjsLib.getDocument).mockReturnValue({
      promise: Promise.resolve({ numPages: 2, getPage: vi.fn().mockResolvedValue(renderedPage) }),
    } as unknown as ReturnType<typeof pdfjsLib.getDocument>)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,page')

    render(<App />)
    const pdfInput = document.querySelector<HTMLInputElement>('input[type="file"][accept="application/pdf"]')
    const file = new File(['pdf bytes'], 'catalogue.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(8) })
    fireEvent.change(pdfInput!, { target: { files: [file] } })
    // Scanned/outlined PDFs (no text content) can only be imported as images.
    const wizard = await screen.findByRole('dialog', { name: 'Import PDF' })
    await waitFor(() => expect(within(wizard).getByTestId('pdf-wizard-summary').textContent).toContain('no text layer'))
    expect((within(wizard).getByRole('radio', { name: /Keep text/ }) as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(within(wizard).getByRole('button', { name: 'Import PDF' }))

    await waitFor(() => expect(screen.getByRole('button', { name: /Page 2/ })).toBeTruthy())
    expect(screen.getAllByAltText('Page 1').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /Page 2/ }))
    expect(screen.getAllByAltText('Page 2').length).toBeGreaterThan(0)
    expect(vi.mocked(pdfjsLib.getDocument)).toHaveBeenCalledWith(
      expect.objectContaining({ wasmUrl: expect.stringContaining('/pdfjs/wasm/') }),
    )
    fireEvent.click(screen.getByRole('button', { name: /Page 1/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Double' }))
    expect(document.querySelectorAll('.page-canvas')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: /^Preview$/ }))
    expect(document.querySelector('.page-canvas')).toBeNull()
    expect(document.querySelectorAll('[data-testid="preview-pane"] .fs-book-page')).toHaveLength(2)
    expect(pageFlipInstances.at(-1)!.pages).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(document.querySelectorAll('.page-canvas')).toHaveLength(2)
    expect(pageFlipInstances.every((instance) => instance.destroyed)).toBe(true)
  })

  it('moves and resizes in page coordinates with one history step per gesture', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    const canvas = document.querySelector<HTMLElement>('.page-canvas')!
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 100, y: 50, left: 100, top: 50, right: 500, bottom: 610, width: 400, height: 560, toJSON: () => ({}),
    } as DOMRect)
    const x0 = Number((screen.getByLabelText('X') as HTMLInputElement).value)
    const y0 = Number((screen.getByLabelText('Y') as HTMLInputElement).value)

    const overlay = document.querySelector<HTMLElement>('.overlay-box')!
    fireEvent.pointerDown(overlay, { clientX: 140, clientY: 100, button: 0 })
    fireEvent.pointerMove(window, { clientX: 180, clientY: 140, altKey: true })
    fireEvent.pointerUp(window)
    expect((screen.getByLabelText('X') as HTMLInputElement).value).toBe(String(x0 + 100))
    expect((screen.getByLabelText('Y') as HTMLInputElement).value).toBe(String(y0 + 100))

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect((screen.getByLabelText('X') as HTMLInputElement).value).toBe(String(x0))
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect((screen.getByLabelText('X') as HTMLInputElement).value).toBe(String(x0 + 100))

    const w0 = Number((screen.getByLabelText('W') as HTMLInputElement).value)
    const h0 = Number((screen.getByLabelText('H') as HTMLInputElement).value)
    const resizeHandle = document.querySelector<HTMLElement>('.resize-handle.se')!
    fireEvent.pointerDown(resizeHandle, { clientX: 240, clientY: 180, button: 0 })
    fireEvent.pointerMove(window, { clientX: 260, clientY: 200 })
    fireEvent.pointerUp(window)
    expect((screen.getByLabelText('W') as HTMLInputElement).value).toBe(String(w0 + 50))
    expect((screen.getByLabelText('H') as HTMLInputElement).value).toBe(String(h0 + 50))

    const nw = document.querySelector<HTMLElement>('.resize-handle.nw')!
    fireEvent.pointerDown(nw, { clientX: 200, clientY: 200, button: 0 })
    fireEvent.pointerMove(window, { clientX: 180, clientY: 180 })
    fireEvent.pointerUp(window)
    expect((screen.getByLabelText('X') as HTMLInputElement).value).toBe(String(x0 + 50))
    expect((screen.getByLabelText('W') as HTMLInputElement).value).toBe(String(w0 + 100))
  })

  it('keeps inputs stable while typing and edits only the selected object', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add button' }))
    const x = screen.getByLabelText('X') as HTMLInputElement
    fireEvent.focus(x)
    fireEvent.change(x, { target: { value: '' } })
    expect(x.value).toBe('')
    fireEvent.change(x, { target: { value: '-' } })
    fireEvent.change(x, { target: { value: '-25' } })
    fireEvent.blur(x)
    expect(x.value).toBe('-25')
    const boxes = document.querySelectorAll<HTMLElement>('.page-canvas .overlay-box')
    expect(boxes[1].style.left).toBe('-2.5%')
    expect(boxes[0].style.left).not.toBe('-2.5%')

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText(/No object selected/)).toBeTruthy()
    fireEvent.pointerDown(boxes[0], { clientX: 0, clientY: 0, button: 0 })
    fireEvent.pointerUp(window)
    expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('New text block')
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Still editable' } })
    expect(document.querySelector('.page-canvas .overlay-box')!.textContent).toContain('Still editable')
  })

  it('opens a serialized project from a JSON file', async () => {
    render(<App />)
    const project = {
      id: 'opened-project',
      title: 'Opened from disk',
      version: 1,
      pages: [{ id: 'opened-page', name: 'Cover', width: 800, height: 1000, overlays: [{ id: 'opened-title', type: 'text', label: 'Disk project headline', x: 10, y: 20, width: 300, height: 80, rotation: 0, opacity: 1, visible: true }] }],
    }
    await reopenFromJson(JSON.stringify(project))
    expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('Disk project headline')
  })

  it('scrubs an animation on the real canvas, returns to design state on stop, and persists it', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    const box = () => document.querySelector<HTMLElement>('.page-canvas .overlay-box')!
    const designLeft = box().style.left
    fireEvent.change(screen.getByLabelText('Effect'), { target: { value: 'slide-left' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add animation' }))
    fireEvent.change(screen.getByLabelText('Animation from'), { target: { value: '-200' } })
    fireEvent.change(screen.getByLabelText('Animation to'), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText('Animation start'), { target: { value: '0.5' } })
    fireEvent.change(screen.getByLabelText('Animation duration'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Easing'), { target: { value: 'linear' } })
    expect(box().style.left).toBe(designLeft)

    fireEvent.change(screen.getByLabelText('Timeline scrub'), { target: { value: '0.25' } })
    expect(box().style.left).toBe('5%')
    fireEvent.change(screen.getByLabelText('Timeline scrub'), { target: { value: '1.5' } })
    expect(box().style.left).toBe('15%')
    fireEvent.change(screen.getByLabelText('Timeline scrub'), { target: { value: '2.5' } })
    expect(box().style.left).toBe(designLeft)

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(screen.getByTestId('timeline-time').textContent).toMatch(/^0\.00s/)
    expect(box().style.left).toBe(designLeft)

    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    const saved = localStorage.getItem('flipstudio-pro-project')!
    fireEvent.change(screen.getByLabelText('Animation duration'), { target: { value: '0.25' } })
    cleanup()
    render(<App />)
    await reopenFromJson(saved)
    fireEvent.click([...document.querySelectorAll<HTMLButtonElement>('.animation-select')].find((button) => button.textContent?.includes('move-x'))!)
    expect((screen.getByLabelText('Animation duration') as HTMLInputElement).value).toBe('2')
    expect((screen.getByLabelText('Animation from') as HTMLInputElement).value).toBe('-200')
  })

  it('plays, pauses, resumes, and stops the shared animation clock without duplicate loops', async () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add animation' }))
    const timeText = () => screen.getByTestId('timeline-time').textContent

    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    await waitFor(() => expect(Number(timeText()?.match(/([\d.]+)s/)?.[1])).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    const pausedText = timeText()
    await new Promise((resolve) => window.setTimeout(resolve, 60))
    expect(timeText()).toBe(pausedText)

    raf.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
    })
    await new Promise((resolve) => window.setTimeout(resolve, 50))
    const callsPerFrame = raf.mock.calls.length
    expect(callsPerFrame).toBeLessThan(8)
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(timeText()).toMatch(/^0\.00s/)
  })

  it('previews with the publication reader using the same objects and animations, then cleans up', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Add image' }))
    fireEvent.change(document.querySelector('[data-testid="image-input"]')!, { target: { files: [pngFile('hero.png')] } })
    await waitFor(() => expect(screen.getByAltText('hero.png')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Effect'), { target: { value: 'fade-in' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add animation' }))
    await createSlideshow(['a.png', 'b.png', 'c.png'])

    const editorIds = [...document.querySelectorAll('.page-canvas [data-object-id]')].map((node) => node.getAttribute('data-object-id'))
    const imageId = editorIds[0]!
    fireEvent.change(screen.getByLabelText('Timeline scrub'), { target: { value: '0.5' } })
    const editorOpacity = document.querySelector<HTMLElement>(`.page-canvas [data-object-id="${imageId}"]`)!.style.opacity

    fireEvent.click(screen.getByRole('button', { name: /^Preview$/ }))
    const pane = screen.getByTestId('preview-pane')
    const previewIds = [...pane.querySelectorAll('[data-object-id]')].map((node) => node.getAttribute('data-object-id'))
    expect(previewIds).toEqual(editorIds)
    expect(pane.querySelectorAll('.fs-slide')).toHaveLength(3)

    const scrub = pane.querySelector<HTMLInputElement>('[data-action="scrub"]')!
    fireEvent.input(scrub, { target: { value: '0.5' } })
    expect(pane.querySelector<HTMLElement>(`[data-object-id="${imageId}"]`)!.style.opacity).toBe(editorOpacity)
    fireEvent.click(pane.querySelector('[data-action="stop"]')!)
    expect(pane.querySelector<HTMLElement>(`[data-object-id="${imageId}"]`)!.style.opacity).toBe('0')

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(screen.queryByTestId('preview-pane')).toBeNull()
    expect(pageFlipInstances.every((instance) => instance.destroyed)).toBe(true)
    expect(document.querySelector<HTMLElement>(`.page-canvas [data-object-id="${imageId}"]`)!.style.opacity).toBe('1')
    expect(screen.getByText('Design view')).toBeTruthy()
  })

  it('writes, verifies, and reopens a Save As file handle', async () => {
    const writes: string[] = []
    const writable = {
      write: vi.fn(async (data: string) => { writes.push(data) }),
      close: vi.fn(async () => undefined),
    }
    const handle = {
      name: 'selected.flipstudio.json',
      createWritable: vi.fn(async () => writable),
      getFile: vi.fn(async () => new File([writes.at(-1) ?? ''], 'selected.flipstudio.json', { type: 'application/json' })),
    } as unknown as FileSystemFileHandle
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'showSaveFilePicker')
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: vi.fn(async () => handle) })

    try {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
      fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Before Save As' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save As' }))
      await waitFor(() => expect(screen.getByText('Project saved to selected.flipstudio.json')).toBeTruthy())
      expect(JSON.parse(writes.at(-1)!).pages[0].overlays[0].label).toBe('Before Save As')

      fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'After Save As' } })
      fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
      await waitFor(() => expect(JSON.parse(writes.at(-1)!).pages[0].overlays[0].label).toBe('After Save As'))

      cleanup()
      render(<App />)
      await reopenFromJson(writes.at(-1)!)
      expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('After Save As')
      expect(writable.close).toHaveBeenCalledTimes(2)
    } finally {
      if (originalDescriptor) Object.defineProperty(window, 'showSaveFilePicker', originalDescriptor)
      else Reflect.deleteProperty(window, 'showSaveFilePicker')
    }
  })

  it('styles a button with a preset and a WhatsApp link that works in Preview', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Add button' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply WhatsApp preset' }))
    const skin = document.querySelector<HTMLElement>('.page-canvas [data-type="button"] .fs-skin')!
    expect(skin.style.background).toContain('rgb(37, 211, 102)')
    expect(skin.className).toContain('fs-fx-pulse')
    fireEvent.change(screen.getByLabelText('When clicked'), { target: { value: 'whatsapp' } })
    fireEvent.change(screen.getByLabelText('WhatsApp number (with country code)'), { target: { value: '+971 52 677 6884' } })
    fireEvent.change(screen.getByLabelText('Text colour hex'), { target: { value: '#111111' } })
    expect(skin.style.color).toBe('rgb(17, 17, 17)')

    fireEvent.click(screen.getByRole('button', { name: /^Preview$/ }))
    const link = screen.getByTestId('preview-pane').querySelector<HTMLAnchorElement>('a[data-type="button"]')!
    expect(link.getAttribute('href')).toBe('https://wa.me/971526776884')
    expect(link.querySelector<HTMLElement>('.fs-skin')!.className).toContain('fs-fx-pulse')
  })

  it('imports a font file into the project and applies it to the selected text', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    const font = new File(['font-bytes'], 'Krossover-Bold.ttf', { type: '' })
    fireEvent.change(screen.getByTestId('font-input'), { target: { files: [font] } })
    await waitFor(() => expect(screen.getByText('Font "Krossover" imported and embedded in this project')).toBeTruthy())
    const select = screen.getByLabelText('Font') as HTMLSelectElement
    expect(select.value).toBe('custom:Krossover')
    expect(screen.getByTestId('font-faces').textContent).toContain("font-family:'Krossover'")
    expect(document.querySelector<HTMLElement>('.page-canvas .fs-skin')!.style.fontFamily).toContain('Krossover')

    fireEvent.change(screen.getByTestId('font-input'), { target: { files: [new File(['x'], 'notes.txt')] } })
    await waitFor(() => expect(screen.getByText(/notes\.txt is not a font file/)).toBeTruthy())
  })
})
