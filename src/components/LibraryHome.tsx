import { useEffect, useMemo, useRef, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { open as openFileDialog } from '@tauri-apps/plugin-dialog'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { CATEGORIES, parseProjectFile, type Library, type LibraryBook, type LibraryIndex } from '../lib/library'
import { createAsset, createProject, PROJECT_VERSION, type ProjectAsset } from '../lib/project'
import { fileToDataUrl } from '../lib/assets'
import { importPdfPages, type PdfImportOptions } from '../lib/pdfImport'
import { PdfImportDialog, type PdfBookInfo } from './PdfImportDialog'
import { PublishDialog } from './PublishDialog'
import { StatsDialog } from './StatsDialog'
import { exportPublication } from '../lib/exporters'
import { applyNewPdf, nextEditionTitle } from '../lib/edition'
import type { ProjectState } from '../lib/project'
import { Icon } from './Icon'
import { ThemeSwitch } from './ThemeSwitch'
import { errorMessage } from '../lib/errors'
import '../Library.css'

type FolderView = 'all' | 'recent' | 'unfiled' | string
type SortKey = 'updated' | 'created' | 'title'

interface LibraryHomeProps {
  library: Library
  index: LibraryIndex
  location: string
  onIndexChange: (index: LibraryIndex) => void
  onOpen: (bookId: string, mode: 'edit' | 'preview') => Promise<void>
}

type Dialog =
  | { kind: 'settings'; book: LibraryBook }
  | { kind: 'delete'; book: LibraryBook }
  | { kind: 'folder'; folderId: string | null; name: string }
  | { kind: 'delete-folder'; folderId: string; name: string }
  | null

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    dialogRef.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="lib-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="lib-modal" role="dialog" aria-modal="true" aria-label={title} ref={dialogRef}>
        <h2>{title}</h2>
        <div className="lib-modal-body">{children}</div>
        <div className="lib-modal-footer">{footer}</div>
      </div>
    </div>
  )
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function LibraryHome({ library, index, location, onIndexChange, onOpen }: LibraryHomeProps) {
  const [view, setView] = useState<FolderView>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('updated')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(library.recovered ? { message: 'The library index was rebuilt from the publication files in your library folder.' } : null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [exportMenu, setExportMenu] = useState<string | null>(null)
  const pdfInputRef = useRef<HTMLInputElement | null>(null)
  const projectInputRef = useRef<HTMLInputElement | null>(null)

  const refresh = () => onIndexChange({ ...library.index })
  const currentFolderId = view !== 'all' && view !== 'recent' && view !== 'unfiled' ? view : null

  const run = async (label: string, task: () => Promise<string | void>) => {
    setBusy(label)
    setNotice(null)
    try {
      const message = await task()
      if (message) setNotice({ message })
    } catch (err) {
      setNotice({ message: errorMessage(err), error: true })
    } finally {
      setBusy(null)
      refresh()
    }
  }

  const books = useMemo(() => {
    const query = search.trim().toLowerCase()
    let list = index.books
    if (view === 'unfiled') list = list.filter((book) => !book.folderId)
    else if (view !== 'all' && view !== 'recent') list = list.filter((book) => book.folderId === view)
    if (query) list = list.filter((book) => `${book.title} ${book.description} ${book.category}`.toLowerCase().includes(query))
    const sorted = [...list].sort((a, b) =>
      sort === 'title' ? a.title.localeCompare(b.title) : sort === 'created' ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt),
    )
    return view === 'recent' ? sorted.slice(0, 12) : sorted
  }, [index.books, search, sort, view])

  const folderName = (id: string | null) => index.folders.find((folder) => folder.id === id)?.name
  const heading = view === 'all' ? 'All publications' : view === 'recent' ? 'Recently edited' : view === 'unfiled' ? 'Not in a folder' : folderName(view) ?? 'Folder'

  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [edition, setEdition] = useState<{ book: LibraryBook; project: ProjectState; file: File } | null>(null)
  const editionInputRef = useRef<HTMLInputElement | null>(null)
  const editionSourceRef = useRef<LibraryBook | null>(null)
  const startEdition = (book: LibraryBook) => {
    editionSourceRef.current = book
    editionInputRef.current?.click()
  }
  const chooseEditionPdf = (file: File) => {
    const book = editionSourceRef.current
    editionSourceRef.current = null
    if (!book) return
    void run('Opening…', async () => {
      const project = await library.openBook(book.id)
      setEdition({ book, project, file })
    })
  }
  const createEdition = (source: { book: LibraryBook; project: ProjectState; file: File }, options: PdfImportOptions, info: PdfBookInfo) =>
    run(`Importing ${source.file.name}…`, async () => {
      const { pages } = await importPdfPages(source.file, options, (page, total) => setBusy(`Importing ${source.file.name} — page ${page} of ${total}`))
      setBusy('Saving the new edition…')
      const { project } = applyNewPdf(source.project, pages, info, { download: info.allowDownload ? { name: source.file.name, dataUrl: await fileToDataUrl(source.file, source.file.name) } : undefined })
      const book = await library.createBook(project, source.book.folderId, { editionOf: source.book.id })
      refresh()
      await onOpen(book.id, 'edit')
    })
  const [publishing, setPublishing] = useState<string | null>(null)
  const [statsFor, setStatsFor] = useState<LibraryBook | null>(null)
  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setNotice({ message: `Link copied: ${url}`, error: false })
    } catch {
      window.prompt('Copy this link:', url)
    }
  }
  const createFromPdf = (file: File, options: PdfImportOptions, info: PdfBookInfo) =>
    run(`Importing ${file.name}…`, async () => {
      const { pages } = await importPdfPages(file, options, (page, total) => setBusy(`Importing ${file.name} — page ${page} of ${total}`))
      setBusy('Saving to the library…')
      let reader = info.reader
      let assets: Record<string, ProjectAsset> = {}
      if (info.allowDownload) {
        const asset = createAsset({ name: file.name, dataUrl: await fileToDataUrl(file, file.name) })
        assets = { [asset.id]: asset }
        reader = { ...reader, downloadAssetId: asset.id, downloadName: file.name }
      }
      const book = await library.createBook(
        createProject({ version: PROJECT_VERSION, title: info.title, description: info.description, category: info.category, keywords: info.keywords, reader, assets, pages }),
        currentFolderId,
      )
      refresh()
      await onOpen(book.id, 'edit')
    })

  const createBlank = () =>
    run('Creating publication…', async () => {
      const book = await library.createBook(
        createProject({ version: PROJECT_VERSION, title: 'Untitled publication', category: 'Catalogue', pages: [{ id: 'page-1', name: 'Page 1', width: 595, height: 842, overlays: [] }] }),
        currentFolderId,
      )
      refresh()
      await onOpen(book.id, 'edit')
    })

  const importProjectJson = (json: string, name: string) =>
    run(`Importing ${name}…`, async () => {
      const project = parseProjectFile(json)
      await library.createBook(project, currentFolderId)
      return `Imported “${project.title}” into the library`
    })

  const importProject = async () => {
    setMenuOpen(false)
    if (!isTauri()) {
      projectInputRef.current?.click()
      return
    }
    try {
      const path = await openFileDialog({ multiple: false, title: 'Import FlipStudio project', filters: [{ name: 'FlipStudio project', extensions: ['json'] }] })
      if (typeof path !== 'string') return
      await importProjectJson(await readTextFile(path), path.split(/[\\/]/).pop() ?? 'project')
    } catch (err) {
      setNotice({ message: `Import failed: ${errorMessage(err)}`, error: true })
    }
  }

  const openBook = (book: LibraryBook, mode: 'edit' | 'preview') => void run(`Opening “${book.title}”…`, () => onOpen(book.id, mode))

  const exportBook = (book: LibraryBook, kind: 'html' | 'zip') => {
    setExportMenu(null)
    void run(`Building ${kind.toUpperCase()} publication for “${book.title}”…`, async () => {
      const result = await exportPublication(await library.openBook(book.id), kind)
      if (!result) return `${kind.toUpperCase()} export cancelled`
      return [result.message, ...result.warnings].join(' ')
    })
  }

  return (
    <div className="library-shell">
      <input ref={editionInputRef} type="file" accept="application/pdf" hidden data-testid="edition-pdf-input" onChange={(event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file) chooseEditionPdf(file)
      }} />
      <input ref={pdfInputRef} type="file" accept="application/pdf" hidden data-testid="library-pdf-input" onChange={(event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file) setPdfFile(file)
      }} />
      <input ref={projectInputRef} type="file" accept="application/json,.json" hidden data-testid="library-project-input" onChange={async (event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file) await importProjectJson(await file.text(), file.name)
      }} />

      <aside className="lib-sidebar" aria-label="Library folders">
        <div className="lib-brand">
          <span className="brand">FS</span>
          <div>
            <strong>FlipStudio Pro</strong>
            <span className="muted small">Publication library</span>
          </div>
        </div>
        <nav className="lib-nav">
          <button type="button" className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>
            <span>All publications</span><span className="count">{index.books.length}</span>
          </button>
          <button type="button" className={view === 'recent' ? 'active' : ''} onClick={() => setView('recent')}>
            <span>Recently edited</span>
          </button>
          <button type="button" className={view === 'unfiled' ? 'active' : ''} onClick={() => setView('unfiled')}>
            <span>Not in a folder</span><span className="count">{index.books.filter((book) => !book.folderId).length}</span>
          </button>
        </nav>
        <div className="lib-section-title">
          <span>Folders</span>
          <button type="button" className="icon-button" aria-label="New folder" title="New folder" onClick={() => setDialog({ kind: 'folder', folderId: null, name: '' })}><Icon name="plus" size={15} /></button>
        </div>
        <nav className="lib-nav folders">
          {index.folders.map((folder) => (
            <div key={folder.id} className={`folder-row ${view === folder.id ? 'active' : ''}`}>
              <button type="button" className="folder-name" onClick={() => setView(folder.id)}>
                <span className="with-icon"><Icon name="folder" size={15} />{folder.name}</span><span className="count">{index.books.filter((book) => book.folderId === folder.id).length}</span>
              </button>
              <button type="button" className="icon-button" aria-label={`Rename ${folder.name}`} title="Rename" onClick={() => setDialog({ kind: 'folder', folderId: folder.id, name: folder.name })}><Icon name="edit" size={14} /></button>
              <button type="button" className="icon-button" aria-label={`Delete folder ${folder.name}`} title="Delete folder" onClick={() => setDialog({ kind: 'delete-folder', folderId: folder.id, name: folder.name })}><Icon name="trash" size={14} /></button>
            </div>
          ))}
          {!index.folders.length && <p className="muted small lib-empty-folders">Group publications by season, client or brand. Click + to add a folder.</p>}
        </nav>
        <div className="lib-appearance">
          <span className="muted small">Appearance</span>
          <ThemeSwitch />
        </div>
        <div className="lib-location" title={location}>
          <span className="muted small">Saved in</span>
          <span className="small">{location}</span>
        </div>
      </aside>

      <main className="lib-main">
        <header className="lib-toolbar">
          <div className="lib-heading">
            <h1>{heading}</h1>
            <span className="muted">{books.length} publication{books.length === 1 ? '' : 's'}</span>
          </div>
          <input type="search" className="lib-search" placeholder="Search publications…" aria-label="Search publications" value={search} onChange={(event) => setSearch(event.target.value)} />
          <select aria-label="Sort publications" value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
            <option value="updated">Last edited</option>
            <option value="created">Date created</option>
            <option value="title">Title A–Z</option>
          </select>
          <div className="lib-new">
            <button type="button" className="primary" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><Icon name="plus" /> New publication</button>
            {menuOpen && (
              <div className="lib-menu" role="menu" onMouseLeave={() => setMenuOpen(false)}>
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); pdfInputRef.current?.click() }}>
                  <strong>From a PDF…</strong><span>Import catalogue pages from a PDF</span>
                </button>
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void createBlank() }}>
                  <strong>Blank publication</strong><span>Start from an empty A4 page</span>
                </button>
                <button type="button" role="menuitem" onClick={() => void importProject()}>
                  <strong>Import project file…</strong><span>Add a .flipstudio.json saved earlier</span>
                </button>
              </div>
            )}
          </div>
        </header>

        {notice && (
          <div className={`lib-notice ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>
            <span>{notice.message}</span>
            <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setNotice(null)}>×</button>
          </div>
        )}

        <div className="lib-content">
          {!index.books.length ? (
            <div className="lib-empty">
              <div className="lib-empty-art" aria-hidden="true"><Icon name="book" size={40} /></div>
              <h2>Create your first publication</h2>
              <p className="muted">Turn a PDF catalogue into an interactive flipbook with slideshows, animations, buttons and links.</p>
              <div className="lib-empty-actions">
                <button type="button" className="primary" onClick={() => pdfInputRef.current?.click()}>Import a PDF</button>
                <button type="button" onClick={() => void createBlank()}>Blank publication</button>
                <button type="button" onClick={() => void importProject()}>Import project file</button>
              </div>
            </div>
          ) : !books.length ? (
            <p className="muted lib-no-results">No publications match{search ? ` “${search}”` : ' this view'}.</p>
          ) : (
            <div className="lib-grid" role="list" aria-label={heading}>
              {books.map((book) => (
                <article key={book.id} className="lib-card" role="listitem" aria-label={book.title}>
                  <button type="button" className="lib-cover" onClick={() => openBook(book, 'edit')} aria-label={`Edit ${book.title}`}>
                    {book.cover ? <img src={book.cover} alt="" /> : <span className="lib-cover-placeholder">{book.title.slice(0, 1).toUpperCase()}</span>}
                    <span className="lib-pages">{book.pageCount} page{book.pageCount === 1 ? '' : 's'}</span>
                    {book.published && <span className="lib-live" title={book.published.url}><span className="lib-live-dot" />Live</span>}
                  </button>
                  <div className="lib-card-body">
                    <h3 title={book.title}>{book.title}</h3>
                    <div className="lib-chips">
                      <span className="chip">{book.category}</span>
                      {book.folderId && folderName(book.folderId) && <span className="chip folder"><Icon name="folder" size={12} />{folderName(book.folderId)}</span>}
                    </div>
                    {book.description && <p className="lib-description">{book.description}</p>}
                    <span className="muted small">Edited {formatDate(book.updatedAt)}</span>
                    {book.published && (
                      <div className="lib-online">
                        <a href={book.published.url} target="_blank" rel="noopener noreferrer" title={book.published.url}>{book.published.url.replace(/^https?:\/\//, '')}</a>
                        <button type="button" onClick={() => void copyLink(book.published!.url)} aria-label={`Copy link to ${book.title}`}>Copy link</button>
                      </div>
                    )}
                  </div>
                  <div className="lib-actions">
                    <button type="button" onClick={() => openBook(book, 'edit')} aria-label={`Edit ${book.title}`} title="Edit"><Icon name="edit" /><span>Edit</span></button>
                    <button type="button" onClick={() => openBook(book, 'preview')} aria-label={`Preview ${book.title}`} title="Preview"><Icon name="eye" /><span>Preview</span></button>
                    <div className="lib-export">
                      <button type="button" aria-label={`Export ${book.title}`} aria-haspopup="menu" aria-expanded={exportMenu === book.id} title="Export" onClick={() => setExportMenu((current) => (current === book.id ? null : book.id))}><Icon name="download" /><span>Export</span></button>
                      {exportMenu === book.id && (
                        <div className="lib-menu small-menu" role="menu" onMouseLeave={() => setExportMenu(null)}>
                          <button type="button" role="menuitem" onClick={() => exportBook(book, 'html')}><strong>HTML file</strong><span>One self-contained file</span></button>
                          <button type="button" role="menuitem" onClick={() => exportBook(book, 'zip')}><strong>ZIP folder</strong><span>For web hosting</span></button>
                        </div>
                      )}
                    </div>
                    <button type="button" className={book.published ? 'live' : ''} onClick={() => setPublishing(book.id)} aria-label={`Publish ${book.title} online`} title={book.published ? 'Online — update or unpublish' : 'Publish online'}><Icon name="globe" /><span>{book.published ? 'Online' : 'Publish'}</span></button>
                    <button type="button" onClick={() => setStatsFor(book)} aria-label={`Statistics for ${book.title}`} title={book.published ? 'Statistics: visits, pages read, searches, clicks' : 'Statistics (publish first)'} disabled={!book.published}><Icon name="stats" /><span>Stats</span></button>
                    <button type="button" onClick={() => startEdition(book)} aria-label={`New edition of ${book.title}`} title="New edition — import next year's PDF with the same design (and link)"><Icon name="layers" /><span>Edition</span></button>
                    <button type="button" onClick={() => void run('Duplicating…', async () => { const copy = await library.duplicateBook(book.id); return `Created “${copy.title}”` })} aria-label={`Duplicate ${book.title}`} title="Duplicate"><Icon name="copy" /><span>Copy</span></button>
                    <button type="button" onClick={() => setDialog({ kind: 'settings', book })} aria-label={`Settings for ${book.title}`} title="Settings"><Icon name="settings" /><span>Settings</span></button>
                    <button type="button" className="danger" onClick={() => setDialog({ kind: 'delete', book })} aria-label={`Delete ${book.title}`} title="Delete"><Icon name="trash" /><span>Delete</span></button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </main>

      {busy && (
        <div className="lib-busy" role="status" aria-live="polite">
          <div className="lib-busy-card"><span className="spinner" aria-hidden="true" />{busy}</div>
        </div>
      )}

      {statsFor && <StatsDialog library={library} book={statsFor} onClose={() => setStatsFor(null)} />}

      {publishing && (
        <PublishDialog library={library} bookId={publishing} onClose={() => setPublishing(null)} onChange={refresh} />
      )}

      {edition && (
        <PdfImportDialog
          file={edition.file}
          initial={{ title: nextEditionTitle(edition.project.title), description: edition.project.description ?? '', category: edition.project.category ?? '', keywords: edition.project.keywords ?? '', reader: edition.project.reader }}
          edition={{ sourceTitle: edition.book.title, objectCount: edition.book.objectCount, live: Boolean(edition.book.published) }}
          confirmLabel="Create new edition"
          onCancel={() => setEdition(null)}
          onImport={(options, info) => { const source = edition; setEdition(null); void createEdition(source, options, info) }}
        />
      )}

      {pdfFile && (
        <PdfImportDialog
          file={pdfFile}
          onCancel={() => setPdfFile(null)}
          onImport={(options, info) => { const file = pdfFile; setPdfFile(null); void createFromPdf(file, options, info) }}
        />
      )}

      {dialog?.kind === 'settings' && <SettingsDialog book={dialog.book} index={index} onClose={() => setDialog(null)} onSave={(details) => { setDialog(null); void run('Saving…', async () => { await library.updateDetails(dialog.book.id, details); return 'Publication details saved' }) }} />}

      {dialog?.kind === 'delete' && (
        <Modal
          title="Delete publication?"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" onClick={() => setDialog(null)}>Cancel</button>
              <button type="button" className="danger-solid" onClick={() => { const book = dialog.book; setDialog(null); void run('Deleting…', async () => { await library.deleteBook(book.id); return `Deleted “${book.title}”` }) }}>Delete</button>
            </>
          }
        >
          <p>“{dialog.book.title}” and its pages, images and animations will be permanently removed from the library. Exported publications are not affected.</p>
        </Modal>
      )}

      {dialog?.kind === 'folder' && (
        <FolderDialog
          initial={dialog.name}
          creating={!dialog.folderId}
          onClose={() => setDialog(null)}
          onSave={(name) => {
            const folderId = dialog.folderId
            setDialog(null)
            void run('Saving folder…', async () => {
              if (folderId) await library.renameFolder(folderId, name)
              else setView((await library.createFolder(name)).id)
            })
          }}
        />
      )}

      {dialog?.kind === 'delete-folder' && (
        <Modal
          title="Delete folder?"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" onClick={() => setDialog(null)}>Cancel</button>
              <button type="button" className="danger-solid" onClick={() => { const { folderId } = dialog; setDialog(null); if (view === folderId) setView('all'); void run('Deleting folder…', async () => { await library.deleteFolder(folderId) }) }}>Delete folder</button>
            </>
          }
        >
          <p>The folder “{dialog.name}” will be removed. Its publications are kept and move to “Not in a folder”.</p>
        </Modal>
      )}
    </div>
  )
}

function FolderDialog({ initial, creating, onClose, onSave }: { initial: string; creating: boolean; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(initial)
  return (
    <Modal
      title={creating ? 'New folder' : 'Rename folder'}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" disabled={!name.trim()} onClick={() => onSave(name)}>{creating ? 'Create folder' : 'Rename'}</button>
        </>
      }
    >
      <label>
        Folder name
        <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && name.trim()) onSave(name) }} />
      </label>
    </Modal>
  )
}

function SettingsDialog({ book, index, onClose, onSave }: { book: LibraryBook; index: LibraryIndex; onClose: () => void; onSave: (details: Pick<LibraryBook, 'title' | 'description' | 'category' | 'folderId'>) => void }) {
  const [title, setTitle] = useState(book.title)
  const [description, setDescription] = useState(book.description)
  const [category, setCategory] = useState(CATEGORIES.includes(book.category) ? book.category : 'Other')
  const [folderId, setFolderId] = useState<string>(book.folderId ?? '')
  return (
    <Modal
      title="Publication settings"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" disabled={!title.trim()} onClick={() => onSave({ title: title.trim(), description: description.trim(), category, folderId: folderId || null })}>Save</button>
        </>
      }
    >
      <label>
        Title
        <input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        Description
        <textarea rows={3} value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <div className="lib-field-row">
        <label>
          Category
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>
          Folder
          <select value={folderId} onChange={(event) => setFolderId(event.target.value)}>
            <option value="">Not in a folder</option>
            {index.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
        </label>
      </div>
    </Modal>
  )
}
