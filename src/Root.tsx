import { useCallback, useEffect, useState } from 'react'
import Editor from './App'
import { LibraryHome } from './components/LibraryHome'
import { PublishDialog } from './components/PublishDialog'
import { defaultStore, Library, type LibraryIndex, type LibraryStore } from './lib/library'
import type { ProjectState } from './lib/project'
import { errorMessage } from './lib/errors'

interface OpenBook {
  bookId: string
  project: ProjectState
  mode: 'edit' | 'preview'
}

/** App shell: the publication library is the home screen; opening a publication shows the editor. */
export default function Root({ store }: { store?: LibraryStore }) {
  const [library] = useState(() => new Library(store ?? defaultStore()))
  const [index, setIndex] = useState<LibraryIndex | null>(null)
  const [loadError, setLoadError] = useState('')
  const [location, setLocation] = useState('')
  const [open, setOpen] = useState<OpenBook | null>(null)
  const [publishing, setPublishing] = useState<ProjectState | null>(null)

  useEffect(() => {
    let cancelled = false
    library
      .load()
      .then((loaded) => { if (!cancelled) setIndex({ ...loaded }) })
      .catch((err: unknown) => { if (!cancelled) setLoadError(errorMessage(err, 'The library could not be opened.')) })
    library.store.location().then((value) => { if (!cancelled) setLocation(value) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [library])

  useEffect(() => {
    if (!open) document.title = 'Library — FlipStudio Pro'
  }, [open])

  const openBook = useCallback(
    async (bookId: string, mode: 'edit' | 'preview') => {
      const project = await library.openBook(bookId)
      setOpen({ bookId, project, mode })
    },
    [library],
  )

  const persist = useCallback(
    async (project: ProjectState) => {
      if (!open) return
      await library.saveBook(open.bookId, project)
    },
    [library, open],
  )

  if (loadError) {
    return (
      <div className="lib-fatal" role="alert">
        <h1>The publication library could not be opened</h1>
        <p>{loadError}</p>
        <button type="button" onClick={() => window.location.reload()}>Try again</button>
      </div>
    )
  }
  if (!index) return <div className="lib-loading" role="status">Opening library…</div>

  if (open) {
    return (
      <>
        <Editor
          key={open.bookId}
          initialProject={open.project}
          initialMode={open.mode}
          onPersist={persist}
          onPublish={setPublishing}
          onExit={() => {
            setOpen(null)
            setPublishing(null)
            setIndex({ ...library.index })
          }}
        />
        {publishing && (
          <PublishDialog library={library} bookId={open.bookId} project={publishing} onClose={() => setPublishing(null)} onChange={() => setIndex({ ...library.index })} />
        )}
      </>
    )
  }

  return <LibraryHome library={library} index={index} location={location} onIndexChange={setIndex} onOpen={openBook} />
}
