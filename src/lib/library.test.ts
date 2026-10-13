import { describe, expect, it } from 'vitest'
import { createMemoryStore, Library } from './library'
import { createProject, PROJECT_VERSION, serializeProject } from './project'

const sample = (title = 'Spring Catalogue') =>
  createProject({
    version: PROJECT_VERSION,
    title,
    pages: [
      { id: 'p1', name: 'Cover', width: 595, height: 842, overlays: [{ id: 't1', type: 'text', label: 'Hello' }] },
      { id: 'p2', name: 'Inside', width: 595, height: 842, overlays: [] },
    ],
  })

describe('publication library', () => {
  it('creates, lists, opens and saves publications', async () => {
    const library = new Library(createMemoryStore())
    await library.load()
    const book = await library.createBook(sample())
    expect(library.index.books).toHaveLength(1)
    expect(book).toMatchObject({ title: 'Spring Catalogue', pageCount: 2, objectCount: 1, folderId: null })

    const project = await library.openBook(book.id)
    expect(project.id).toBe(book.id)
    expect(project.pages[0].overlays[0].label).toBe('Hello')

    const edited = { ...project, pages: [...project.pages, { id: 'p3', name: 'Back', width: 595, height: 842, overlays: [] }] }
    const saved = await library.saveBook(book.id, edited)
    expect(saved.pageCount).toBe(3)
    expect((await library.openBook(book.id)).pages).toHaveLength(3)
  })

  it('persists the index so a new session sees the same library', async () => {
    const store = createMemoryStore()
    const first = new Library(store)
    await first.load()
    const folder = await first.createFolder('Ramadan 2027')
    await first.createBook(sample('Ramadan Gifts'), folder.id)

    const second = new Library(store)
    const index = await second.load()
    expect(index.folders.map((item) => item.name)).toEqual(['Ramadan 2027'])
    expect(index.books[0]).toMatchObject({ title: 'Ramadan Gifts', folderId: folder.id })
    expect(second.recovered).toBe(false)
  })

  it('renames inside the project file, duplicates and deletes', async () => {
    const library = new Library(createMemoryStore())
    await library.load()
    const book = await library.createBook(sample())
    await library.updateDetails(book.id, { title: 'Autumn Catalogue', description: 'Leather goods', category: 'Lookbook' })
    expect(library.index.books[0]).toMatchObject({ title: 'Autumn Catalogue', description: 'Leather goods', category: 'Lookbook' })
    expect((await library.openBook(book.id)).title).toBe('Autumn Catalogue')

    const copy = await library.duplicateBook(book.id)
    expect(copy.title).toBe('Autumn Catalogue (copy)')
    expect(copy.id).not.toBe(book.id)
    expect((await library.openBook(copy.id)).pages).toHaveLength(2)

    await library.deleteBook(book.id)
    expect(library.index.books.map((item) => item.id)).toEqual([copy.id])
    await expect(library.openBook(book.id)).rejects.toThrow(/missing/)
  })

  it('keeps publications when their folder is deleted', async () => {
    const library = new Library(createMemoryStore())
    await library.load()
    const folder = await library.createFolder('Clients')
    const book = await library.createBook(sample(), folder.id)
    await library.renameFolder(folder.id, 'Key clients')
    expect(library.index.folders[0].name).toBe('Key clients')
    await library.deleteFolder(folder.id)
    expect(library.index.folders).toEqual([])
    expect(library.index.books[0]).toMatchObject({ id: book.id, folderId: null })
  })

  it('rebuilds a damaged or missing index from the publication files', async () => {
    const store = createMemoryStore()
    await store.writeProject('pub-a', serializeProject(sample('Recovered A')))
    await store.writeProject('pub-b', serializeProject(sample('Recovered B')))
    await store.writeProject('pub-bad', '{ not json')
    await store.writeIndex('{ damaged')
    const library = new Library(store)
    const index = await library.load()
    expect(library.recovered).toBe(true)
    expect(index.books.map((book) => book.title).sort()).toEqual(['Recovered A', 'Recovered B'])
    expect(JSON.parse((await store.readIndex())!).books).toHaveLength(2)
  })

  it('serialises concurrent saves so the last edit wins and the index stays valid', async () => {
    const library = new Library(createMemoryStore())
    await library.load()
    const book = await library.createBook(sample())
    const project = await library.openBook(book.id)
    await Promise.all([1, 2, 3, 4, 5].map((n) => library.saveBook(book.id, { ...project, title: `Version ${n}` })))
    expect(library.index.books[0].title).toBe('Version 5')
    expect((await library.openBook(book.id)).title).toBe('Version 5')
  })
})
