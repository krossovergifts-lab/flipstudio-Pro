import { isTauri } from '@tauri-apps/api/core'
import { createProject, PROJECT_VERSION, serializeProject, validateProject, hashString, type ProjectState } from './project'

// Publication library: every publication is one project file plus an entry in
// an index (title, folder, cover thumbnail, dates). Desktop stores files in
// Documents\FlipStudio Pro\Library; the browser build uses IndexedDB; tests use memory.

export interface LibraryBook {
  id: string
  title: string
  description: string
  category: string
  folderId: string | null
  createdAt: string
  updatedAt: string
  pageCount: number
  objectCount: number
  /** Small JPEG of page 1 for the card. */
  cover?: string
  /** Hash of the page-1 image the cover was made from, so it is only rebuilt when page 1 changes. */
  coverSource?: string
  /** Set while the publication is live on the website. */
  published?: PublishedInfo
}

export interface PublishedInfo {
  slug: string
  url: string
  publishedAt: string
}

export interface LibraryFolder {
  id: string
  name: string
  createdAt: string
}

export interface LibraryIndex {
  version: 1
  folders: LibraryFolder[]
  books: LibraryBook[]
}

export interface LibraryStore {
  kind: 'desktop' | 'browser' | 'memory'
  location(): Promise<string>
  readIndex(): Promise<string | null>
  writeIndex(json: string): Promise<void>
  readProject(id: string): Promise<string | null>
  writeProject(id: string, json: string): Promise<void>
  deleteProject(id: string): Promise<void>
  listProjectIds(): Promise<string[]>
}

export const CATEGORIES = ['Catalogue', 'Brochure', 'Price list', 'Lookbook', 'Magazine', 'Menu', 'Sales & Marketing', 'Report', 'Other']

export function emptyIndex(): LibraryIndex {
  return { version: 1, folders: [], books: [] }
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

export function createMemoryStore(): LibraryStore {
  const files = new Map<string, string>()
  return {
    kind: 'memory',
    location: async () => 'Temporary memory (not saved)',
    readIndex: async () => files.get('index') ?? null,
    writeIndex: async (json) => { files.set('index', json) },
    readProject: async (id) => files.get(`project:${id}`) ?? null,
    writeProject: async (id, json) => { files.set(`project:${id}`, json) },
    deleteProject: async (id) => { files.delete(`project:${id}`) },
    listProjectIds: async () => [...files.keys()].filter((key) => key.startsWith('project:')).map((key) => key.slice(8)),
  }
}

/** Browser build: IndexedDB (localStorage is far too small for projects with images). */
export function createBrowserStore(): LibraryStore {
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open('flipstudio-library', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('files')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('The browser library could not be opened.'))
    })
  let db: Promise<IDBDatabase> | null = null
  const run = async <T,>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    db ??= open()
    const database = await db
    return new Promise((resolve, reject) => {
      const request = action(database.transaction('files', mode).objectStore('files'))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Library storage failed.'))
    })
  }
  return {
    kind: 'browser',
    location: async () => 'This browser (IndexedDB)',
    readIndex: async () => ((await run('readonly', (store) => store.get('index'))) as string | undefined) ?? null,
    writeIndex: async (json) => { await run('readwrite', (store) => store.put(json, 'index')) },
    readProject: async (id) => ((await run('readonly', (store) => store.get(`project:${id}`))) as string | undefined) ?? null,
    writeProject: async (id, json) => { await run('readwrite', (store) => store.put(json, `project:${id}`)) },
    deleteProject: async (id) => { await run('readwrite', (store) => store.delete(`project:${id}`)) },
    listProjectIds: async () => ((await run('readonly', (store) => store.getAllKeys())) as IDBValidKey[]).map(String).filter((key) => key.startsWith('project:')).map((key) => key.slice(8)),
  }
}

/**
 * Desktop: files under Documents\FlipStudio Pro\Library, written atomically
 * (temp file, then rename). If the system has no usable Documents folder, the
 * library lives in the app's own data folder instead.
 */
export function createDesktopStore(): LibraryStore {
  const fsModule = import('@tauri-apps/plugin-fs')
  type Fs = typeof import('@tauri-apps/plugin-fs')
  type Base = { fs: Fs; baseDir: number; root: string }
  let resolved: Promise<Base> | null = null
  const resolveBase = (): Promise<Base> => {
    resolved ??= (async () => {
      const fs = await fsModule
      const { documentDir } = await import('@tauri-apps/api/path')
      try {
        await documentDir()
        await fs.mkdir('FlipStudio Pro/Library', { baseDir: fs.BaseDirectory.Document, recursive: true })
        return { fs, baseDir: fs.BaseDirectory.Document, root: 'FlipStudio Pro/Library' }
      } catch {
        await fs.mkdir('Library', { baseDir: fs.BaseDirectory.AppLocalData, recursive: true })
        return { fs, baseDir: fs.BaseDirectory.AppLocalData, root: 'Library' }
      }
    })()
    return resolved
  }
  const readText = async (name: string): Promise<string | null> => {
    const { fs, baseDir, root } = await resolveBase()
    if (!(await fs.exists(`${root}/${name}`, { baseDir }))) return null
    return fs.readTextFile(`${root}/${name}`, { baseDir })
  }
  const writeText = async (name: string, json: string) => {
    const { fs, baseDir, root } = await resolveBase()
    const temp = `${root}/${name}.tmp`
    await fs.writeTextFile(temp, json, { baseDir })
    await fs.rename(temp, `${root}/${name}`, { oldPathBaseDir: baseDir, newPathBaseDir: baseDir })
  }
  const safeName = (id: string) => `${id.replace(/[^a-z0-9-]/gi, '')}.flipstudio.json`
  return {
    kind: 'desktop',
    location: async () => {
      const { fs, baseDir, root } = await resolveBase()
      const path = await import('@tauri-apps/api/path')
      const base = baseDir === fs.BaseDirectory.Document ? await path.documentDir() : await path.appLocalDataDir()
      return path.join(base, ...root.split('/'))
    },
    readIndex: () => readText('library.json'),
    writeIndex: (json) => writeText('library.json', json),
    readProject: (id) => readText(safeName(id)),
    writeProject: (id, json) => writeText(safeName(id), json),
    deleteProject: async (id) => {
      const { fs, baseDir, root } = await resolveBase()
      const path = `${root}/${safeName(id)}`
      if (await fs.exists(path, { baseDir })) await fs.remove(path, { baseDir })
    },
    listProjectIds: async () => {
      const { fs, baseDir, root } = await resolveBase()
      const entries = await fs.readDir(root, { baseDir })
      return entries.filter((entry) => entry.isFile && entry.name.endsWith('.flipstudio.json')).map((entry) => entry.name.replace(/\.flipstudio\.json$/, ''))
    },
  }
}

export function defaultStore(): LibraryStore {
  if (isTauri()) return createDesktopStore()
  if (typeof indexedDB !== 'undefined') return createBrowserStore()
  return createMemoryStore()
}

// ---------------------------------------------------------------------------
// Covers
// ---------------------------------------------------------------------------

/** Makes a small JPEG thumbnail of page 1. Returns undefined where canvas is unavailable. */
export async function makeCover(source: string | undefined, width = 260): Promise<string | undefined> {
  if (!source || typeof document === 'undefined' || typeof Image === 'undefined') return undefined
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('timeout')), 3000)
      image.onload = () => { window.clearTimeout(timer); resolve() }
      image.onerror = () => { window.clearTimeout(timer); reject(new Error('decode')) }
      image.src = source
    })
    if (!image.naturalWidth || !image.naturalHeight) return undefined
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = Math.round((image.naturalHeight / image.naturalWidth) * width)
    const context = canvas.getContext('2d')
    if (!context) return undefined
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const cover = canvas.toDataURL('image/jpeg', 0.82)
    return cover.startsWith('data:image/') ? cover : undefined
  } catch {
    return undefined
  }
}

function coverSourceKey(project: ProjectState): string | undefined {
  const source = project.pages[0]?.previewUrl
  return source ? `${hashString(source)}-${source.length}` : undefined
}

// ---------------------------------------------------------------------------
// Library operations
// ---------------------------------------------------------------------------

function parseIndex(json: string | null): LibraryIndex | null {
  if (!json) return null
  const data = JSON.parse(json) as Partial<LibraryIndex>
  if (!data || !Array.isArray(data.books) || !Array.isArray(data.folders)) throw new Error('The library index is damaged.')
  return { version: 1, folders: data.folders, books: data.books }
}

function describe(project: ProjectState, existing?: Partial<LibraryBook>): Omit<LibraryBook, 'id' | 'createdAt' | 'folderId'> {
  return {
    title: project.title,
    description: project.description ?? existing?.description ?? '',
    category: project.category ?? existing?.category ?? 'Catalogue',
    updatedAt: new Date().toISOString(),
    pageCount: project.pages.length,
    objectCount: project.pages.reduce((total, page) => total + page.overlays.length, 0),
    cover: existing?.cover,
    coverSource: existing?.coverSource,
  }
}

export function parseProjectFile(json: string): ProjectState {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('The file is not valid FlipStudio project JSON.')
  }
  const result = validateProject(parsed)
  if (!result.valid) throw new Error(result.errors.join(' '))
  return createProject(parsed as Partial<ProjectState>)
}

/**
 * The library. All mutations are queued so autosave, renames and deletes can
 * never interleave and corrupt the index.
 */
export class Library {
  readonly store: LibraryStore
  index: LibraryIndex = emptyIndex()
  /** Set when the index was rebuilt from project files because it was missing or damaged. */
  recovered = false
  private queue: Promise<unknown> = Promise.resolve()

  constructor(store: LibraryStore) {
    this.store = store
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => undefined)
    return run
  }

  private async saveIndex() {
    await this.store.writeIndex(JSON.stringify(this.index, null, 2))
  }

  load(): Promise<LibraryIndex> {
    return this.enqueue(async () => {
      let index: LibraryIndex | null = null
      let damaged = false
      try {
        index = parseIndex(await this.store.readIndex())
      } catch {
        damaged = true
      }
      const ids = await this.store.listProjectIds().catch(() => [] as string[])
      if (!index || damaged) {
        index = emptyIndex()
        this.recovered = damaged || ids.length > 0
      }
      // Re-attach project files that are missing from the index (e.g. after a crash).
      const known = new Set(index.books.map((book) => book.id))
      for (const id of ids) {
        if (known.has(id)) continue
        const json = await this.store.readProject(id)
        if (!json) continue
        try {
          const project = parseProjectFile(json)
          const now = new Date().toISOString()
          index.books.push({ id, folderId: null, createdAt: project.lastSavedAt ?? now, ...describe(project) })
          this.recovered = true
        } catch {
          // A damaged project file is left on disk untouched and not listed.
        }
      }
      this.index = index
      if (this.recovered) await this.saveIndex()
      return this.index
    })
  }

  private async refreshCover(book: LibraryBook, project: ProjectState) {
    const key = coverSourceKey(project)
    if (key && key === book.coverSource && book.cover) return
    book.cover = await makeCover(project.pages[0]?.previewUrl)
    book.coverSource = book.cover ? key : undefined
  }

  createBook(project: ProjectState, folderId: string | null = null): Promise<LibraryBook> {
    return this.enqueue(async () => {
      const id = newId('pub')
      const stored = createProject({ ...project, id, version: PROJECT_VERSION })
      await this.store.writeProject(id, serializeProject(stored))
      const now = new Date().toISOString()
      const book: LibraryBook = { id, folderId, createdAt: now, ...describe(stored) }
      await this.refreshCover(book, stored)
      this.index = { ...this.index, books: [book, ...this.index.books] }
      await this.saveIndex()
      return book
    })
  }

  openBook(id: string): Promise<ProjectState> {
    return this.enqueue(async () => {
      const json = await this.store.readProject(id)
      if (!json) throw new Error('This publication’s file is missing from the library folder.')
      const project = parseProjectFile(json)
      return { ...project, id }
    })
  }

  saveBook(id: string, project: ProjectState): Promise<LibraryBook> {
    return this.enqueue(async () => {
      const existing = this.index.books.find((book) => book.id === id)
      if (!existing) throw new Error('This publication is no longer in the library.')
      await this.store.writeProject(id, serializeProject({ ...project, id }))
      const book: LibraryBook = { ...existing, ...describe(project, existing) }
      await this.refreshCover(book, project)
      this.index = { ...this.index, books: this.index.books.map((candidate) => (candidate.id === id ? book : candidate)) }
      await this.saveIndex()
      return book
    })
  }

  updateDetails(id: string, details: Partial<Pick<LibraryBook, 'title' | 'description' | 'category' | 'folderId'>>): Promise<void> {
    return this.enqueue(async () => {
      const existing = this.index.books.find((book) => book.id === id)
      if (!existing) return
      if (details.title !== undefined || details.description !== undefined || details.category !== undefined) {
        const json = await this.store.readProject(id)
        if (json) {
          const project = parseProjectFile(json)
          await this.store.writeProject(
            id,
            serializeProject({
              ...project,
              id,
              title: details.title ?? project.title,
              description: details.description ?? project.description,
              category: details.category ?? project.category,
            }),
          )
        }
      }
      this.index = {
        ...this.index,
        books: this.index.books.map((book) => (book.id === id ? { ...book, ...details, updatedAt: details.folderId !== undefined && Object.keys(details).length === 1 ? book.updatedAt : new Date().toISOString() } : book)),
      }
      await this.saveIndex()
    })
  }

  duplicateBook(id: string): Promise<LibraryBook> {
    return this.enqueue(async () => {
      const source = this.index.books.find((book) => book.id === id)
      const json = await this.store.readProject(id)
      if (!source || !json) throw new Error('The publication to duplicate was not found.')
      const project = parseProjectFile(json)
      const copyId = newId('pub')
      const title = `${source.title} (copy)`
      await this.store.writeProject(copyId, serializeProject({ ...project, id: copyId, title }))
      const now = new Date().toISOString()
      const book: LibraryBook = { ...source, id: copyId, title, createdAt: now, updatedAt: now, published: undefined }
      const position = this.index.books.findIndex((candidate) => candidate.id === id)
      const books = [...this.index.books]
      books.splice(position + 1, 0, book)
      this.index = { ...this.index, books }
      await this.saveIndex()
      return book
    })
  }

  /** Records (or clears, with null) where a publication is live online. */
  setPublished(id: string, published: PublishedInfo | null): Promise<void> {
    return this.enqueue(async () => {
      this.index = {
        ...this.index,
        books: this.index.books.map((book) => (book.id === id ? { ...book, published: published ?? undefined } : book)),
      }
      await this.saveIndex()
    })
  }

  deleteBook(id: string): Promise<void> {
    return this.enqueue(async () => {
      await this.store.deleteProject(id)
      this.index = { ...this.index, books: this.index.books.filter((book) => book.id !== id) }
      await this.saveIndex()
    })
  }

  createFolder(name: string): Promise<LibraryFolder> {
    return this.enqueue(async () => {
      const folder: LibraryFolder = { id: newId('folder'), name: name.trim() || 'New folder', createdAt: new Date().toISOString() }
      this.index = { ...this.index, folders: [...this.index.folders, folder] }
      await this.saveIndex()
      return folder
    })
  }

  renameFolder(id: string, name: string): Promise<void> {
    return this.enqueue(async () => {
      this.index = { ...this.index, folders: this.index.folders.map((folder) => (folder.id === id ? { ...folder, name: name.trim() || folder.name } : folder)) }
      await this.saveIndex()
    })
  }

  /** Deletes a folder; its publications are kept and become unfiled. */
  deleteFolder(id: string): Promise<void> {
    return this.enqueue(async () => {
      this.index = {
        folders: this.index.folders.filter((folder) => folder.id !== id),
        books: this.index.books.map((book) => (book.folderId === id ? { ...book, folderId: null } : book)),
        version: 1,
      }
      await this.saveIndex()
    })
  }
}
