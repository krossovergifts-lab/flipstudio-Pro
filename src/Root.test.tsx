import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as pdfjsLib from 'pdfjs-dist'
import Root from './Root'
import { createMemoryStore, Library } from './lib/library'
import { createProject, PROJECT_VERSION } from './lib/project'
import { createFakeGitHub } from './lib/fakeGitHub'

vi.mock('page-flip', () => {
  class PageFlip {
    mount: HTMLElement
    constructor(mount: HTMLElement) { this.mount = mount }
    loadFromHTML(items: Element[]) { this.mount.append(...items) }
    destroy() {}
    on() { return this }
    update() {}
  }
  return { PageFlip, default: { PageFlip } }
})
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: vi.fn() }))

class DecodingImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 595
  naturalHeight = 842
  set src(_value: string) {
    window.setTimeout(() => this.onload?.(), 0)
  }
}

beforeEach(() => {
  vi.stubGlobal('Image', DecodingImage)
  vi.mocked(pdfjsLib.getDocument).mockReturnValue({
    promise: Promise.resolve({
      numPages: 2,
      getPage: vi.fn().mockResolvedValue({
        getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale, transform: [scale, 0, 0, -scale, 0, 842 * scale] }),
        render: () => ({ promise: Promise.resolve() }),
        getTextContent: async () => ({
          items: [
            { str: 'Leather gift sets', transform: [24, 0, 0, 24, 40, 780], width: 200, hasEOL: true, fontName: 'f1' },
            { str: 'Order before 20 December', transform: [12, 0, 0, 12, 40, 740], width: 160, hasEOL: false, fontName: 'f1' },
          ],
          styles: { f1: { ascent: 0.9, fontFamily: 'sans-serif' } },
        }),
      }),
      getMetadata: async () => ({ info: { Title: 'Gifts 2027' } }),
    }),
  } as unknown as ReturnType<typeof pdfjsLib.getDocument>)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,cGFnZQ==')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const card = (title: string) => screen.getByRole('listitem', { name: title })

describe('publication library home', () => {
  it('creates, edits with autosave, organises, duplicates, searches, deletes and reopens publications', async () => {
    render(<Root store={createMemoryStore()} />)
    await waitFor(() => expect(screen.getByText('Create your first publication')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Blank publication' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '‹ Library' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Leather wallets' } })
    expect(screen.getByText('Unsaved')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy(), { timeout: 20000 })

    fireEvent.click(screen.getByRole('button', { name: '‹ Library' }))
    await waitFor(() => expect(card('Untitled publication')).toBeTruthy())
    expect(within(card('Untitled publication')).getByText('1 page')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Settings for Untitled publication' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Leather Collection' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Corporate leather gifts' } })
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Lookbook' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(card('Leather Collection')).toBeTruthy())
    expect(within(card('Leather Collection')).getByText('Lookbook')).toBeTruthy()
    expect(within(card('Leather Collection')).getByText('Corporate leather gifts')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'New folder' }))
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Clients' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create folder' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Clients' })).toBeTruthy())
    expect(screen.getByText(/No publications match/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /All publications/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Settings for Leather Collection' }))
    fireEvent.change(screen.getByLabelText('Folder'), { target: { value: screen.getByRole('option', { name: 'Clients' }).getAttribute('value') } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(within(card('Leather Collection')).getByText('📁 Clients')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Leather Collection' }))
    await waitFor(() => expect(card('Leather Collection (copy)')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Search publications'), { target: { value: 'copy' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('Search publications'), { target: { value: '' } })

    fireEvent.click(screen.getByRole('button', { name: 'Delete Leather Collection (copy)' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Leather Collection (copy)' })).toBeNull())

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit Leather Collection' })[0])
    await waitFor(() => expect(screen.getByRole('button', { name: '‹ Library' })).toBeTruthy())
    expect(document.querySelector('.page-canvas .fs-text')!.textContent).toBe('Leather wallets')
    expect(screen.getByText('Leather Collection', { selector: '.doc-title' })).toBeTruthy()
  })

  it('creates a publication from a PDF and opens Preview from the library', async () => {
    render(<Root store={createMemoryStore()} />)
    await waitFor(() => expect(screen.getByText('Create your first publication')).toBeTruthy())
    const file = new File(['pdf'], 'Gifts 2027.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(8) })
    fireEvent.change(screen.getByTestId('library-pdf-input'), { target: { files: [file] } })
    const wizard = await screen.findByRole('dialog', { name: 'Import PDF' })
    await waitFor(() => expect(within(wizard).getByTestId('pdf-wizard-summary').textContent).toContain('2 pages · contains text'))
    expect((within(wizard).getByLabelText('Title') as HTMLInputElement).value).toBe('Gifts 2027')
    fireEvent.change(within(wizard).getByLabelText('Description'), { target: { value: 'Corporate gifts for 2027' } })
    expect((within(wizard).getByRole('radio', { name: /Keep text/ }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(within(wizard).getByRole('radio', { name: /High quality/ }))
    fireEvent.click(within(wizard).getByRole('button', { name: 'Import PDF' }))
    await waitFor(() => expect(screen.getByText('Gifts 2027', { selector: '.doc-title' })).toBeTruthy(), { timeout: 20000 })
    expect(document.querySelectorAll('.page-thumb')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: '‹ Library' }))
    await waitFor(() => expect(card('Gifts 2027')).toBeTruthy())
    expect(within(card('Gifts 2027')).getByText('2 pages')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Preview Gifts 2027' }))
    await waitFor(() => expect(screen.getByTestId('preview-pane')).toBeTruthy())
    const pane = screen.getByTestId('preview-pane')
    expect(pane.querySelectorAll('.fs-book-page')).toHaveLength(2)
    // The PDF text is kept as a selectable layer, positioned in page units.
    const runs = pane.querySelectorAll('.fs-book-page')[0].querySelectorAll('.fs-textlayer > span')
    expect([...runs].map((span) => span.textContent)).toEqual(['Leather gift sets', 'Order before 20 December'])
    expect((runs[0] as HTMLElement).style.left).toBe('6.7227%')
    // Search finds text on both pages and highlights the match.
    fireEvent.input(within(pane).getByLabelText('Search text'), { target: { value: 'december' } })
    await waitFor(() => expect(within(pane).getByText('2 results')).toBeTruthy())
    expect(pane.querySelector('.fs-hit')!.textContent).toBe('Order before 20 December')
    fireEvent.click(within(pane).getByRole('button', { name: 'Select text' }))
    expect(within(pane).getByRole('button', { name: 'Done selecting' }).getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('.fs-reader.fs-selecting')).toBeTruthy()
  })

  it('imports a project file saved earlier into the library', async () => {
    render(<Root store={createMemoryStore()} />)
    await waitFor(() => expect(screen.getByText('Create your first publication')).toBeTruthy())
    const json = JSON.stringify({ version: 3, title: 'Old project', pages: [{ id: 'a', width: 600, height: 800, overlays: [] }] })
    const file = new File([json], 'old.flipstudio.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: async () => json })
    fireEvent.change(screen.getByTestId('library-project-input'), { target: { files: [file] } })
    await waitFor(() => expect(card('Old project')).toBeTruthy())
    expect(screen.getByText('Imported “Old project” into the library')).toBeTruthy()

    const broken = new File(['nope'], 'broken.json', { type: 'application/json' })
    Object.defineProperty(broken, 'text', { value: async () => 'nope' })
    fireEvent.change(screen.getByTestId('library-project-input'), { target: { files: [broken] } })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('not valid FlipStudio project JSON'))
  })

  it('publishes a publication as a shareable link, updates it and unpublishes it', async () => {
    window.localStorage.clear()
    const github = await createFakeGitHub({ empty: true, private: false })
    vi.stubGlobal('fetch', github.fetch)
    const store = createMemoryStore()
    const seed = new Library(store)
    await seed.load()
    await seed.createBook(createProject({
      version: PROJECT_VERSION,
      title: 'Leather Gifts 2027',
      description: 'Corporate gifts',
      pages: [{ id: 'p1', width: 595, height: 842, previewUrl: 'data:image/jpeg;base64,cGFnZQ==', overlays: [] }],
    }))
    render(<Root store={store} />)
    await waitFor(() => expect(card('Leather Gifts 2027')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Publish Leather Gifts 2027 online' }))
    let dialog = screen.getByRole('dialog', { name: 'Publish online' })
    expect(within(dialog).getByText('Its own brand-free website', { exact: false })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: /Bookshelf on GitHub Pages/ }))
    expect(within(dialog).getByText('Set up online publishing')).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: 'Create access key ↗' }).getAttribute('href')).toContain('pages=write')
    fireEvent.change(within(dialog).getByLabelText('Access key'), { target: { value: 'good-token' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(within(dialog).getByLabelText('Link name')).toBeTruthy(), { timeout: 20000 })
    expect(JSON.parse(window.localStorage.getItem('flipstudio.publish.sites.v1')!)[0].token).toBe('good-token')

    expect((within(dialog).getByLabelText('Link name') as HTMLInputElement).value).toBe('leather-gifts-2027')
    expect(within(dialog).getByText('https://krossovergifts-lab.github.io/flipbooks/leather-gifts-2027/')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(within(dialog).getByTestId('published-url').textContent).toBe('https://krossovergifts-lab.github.io/flipbooks/leather-gifts-2027/'), { timeout: 20000 })
    expect(github.files()['leather-gifts-2027/index.html']).toContain('og:title')
    expect(github.files()['leather-gifts-2027/cover.jpg']).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }))

    expect(within(card('Leather Gifts 2027')).getByText('● Live')).toBeTruthy()
    expect(within(card('Leather Gifts 2027')).getByRole('link', { name: 'krossovergifts-lab.github.io/flipbooks/leather-gifts-2027/' })).toBeTruthy()

    // Republish with nothing changed, then unpublish.
    fireEvent.click(screen.getByRole('button', { name: 'Publish Leather Gifts 2027 online' }))
    dialog = screen.getByRole('dialog', { name: 'Publish online' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update online version' }))
    await waitFor(() => expect(within(dialog).getByText(/Nothing had changed/)).toBeTruthy(), { timeout: 20000 })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
    fireEvent.click(screen.getByRole('button', { name: 'Publish Leather Gifts 2027 online' }))
    dialog = screen.getByRole('dialog', { name: 'Publish online' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unpublish' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unpublish' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Publish online' })).toBeNull(), { timeout: 20000 })
    expect(within(card('Leather Gifts 2027')).queryByText('● Live')).toBeNull()
    expect(Object.keys(github.files()).some((path) => path.startsWith('leather-gifts-2027/'))).toBe(false)
  })
})
