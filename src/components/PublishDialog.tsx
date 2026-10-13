import { useEffect, useMemo, useRef, useState } from 'react'
import type { Library } from '../lib/library'
import type { ProjectState } from '../lib/project'
import { errorMessage } from '../lib/errors'
import { openExternal } from '../lib/external'
import {
  bookUrl,
  EMPTY_SETTINGS,
  GitHubRepo,
  loadPublishSettings,
  normalizeSiteUrl,
  onlineSlugs,
  publishBook,
  savePublishSettings,
  settingsComplete,
  slugify,
  unpublishBook,
  validateSlug,
  whatsappShareUrl,
  type PublishSettings,
} from '../lib/publish'
import './PublishDialog.css'

export interface PublishDialogProps {
  library: Library
  bookId: string
  /** The publication to publish; loaded from the library when omitted. */
  project?: ProjectState
  onClose: () => void
  /** Called after the library index changed (published / unpublished). */
  onChange: () => void
  /** Test hook: replaces window.fetch for GitHub requests. */
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
  apiBase?: string
}

type View = 'setup' | 'publish' | 'working' | 'done' | 'unpublish'

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    const ok = document.execCommand?.('copy') ?? false
    area.remove()
    return ok
  }
}

function SetupForm({ initial, onSaved, onCancel, fetchImpl, apiBase }: { initial: PublishSettings; onSaved: (settings: PublishSettings) => void; onCancel: () => void; fetchImpl?: PublishDialogProps['fetchImpl']; apiBase?: string }) {
  const [draft, setDraft] = useState<PublishSettings>(initial)
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const set = (patch: Partial<PublishSettings>) => { setDraft((current) => ({ ...current, ...patch })); setCheck(null) }
  const cleaned = (): PublishSettings => ({
    owner: draft.owner.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/.*$/, ''),
    repo: draft.repo.trim().replace(/\.git$/i, ''),
    branch: draft.branch.trim() || 'main',
    token: draft.token.trim(),
    siteUrl: normalizeSiteUrl(draft.siteUrl),
    siteTitle: draft.siteTitle.trim() || 'Our publications',
  })
  const ready = settingsComplete(cleaned())

  const test = async () => {
    setChecking(true)
    setCheck(null)
    try {
      const settings = cleaned()
      const info = await new GitHubRepo(settings, fetchImpl, apiBase).checkAccess()
      const pagesWarning = info.private && /\.github\.io/i.test(settings.siteUrl) ? ' Note: GitHub Pages on a free account only works with a public repository — use Vercel or Cloudflare Pages for a private one.' : ''
      setCheck({ ok: true, message: `Connected to ${settings.owner}/${settings.repo} (${info.private ? 'private' : 'public'} repository) — the token can publish.${pagesWarning}` })
    } catch (err) {
      setCheck({ ok: false, message: errorMessage(err) })
    } finally {
      setChecking(false)
    }
  }

  return (
    <form className="publish-setup" onSubmit={(event) => { event.preventDefault(); if (ready) onSaved(cleaned()) }}>
      <ol className="publish-steps">
        <li>
          <strong>Create a GitHub repository</strong> for your website, for example <code>flipbooks</code>. Private is fine with Vercel or Cloudflare Pages.{' '}
          <a href="https://github.com/new" target="_blank" rel="noopener noreferrer">Create repository ↗</a>
        </li>
        <li>
          <strong>Create a fine-grained access token</strong>: Repository access → <em>Only select repositories</em> → your repository; Permissions → <em>Contents: Read and write</em>.{' '}
          <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">Create token ↗</a>
        </li>
        <li>
          <strong>Connect the repository to a free host</strong> — Vercel (Add New → Project → import the repository → Framework preset <em>Other</em> → Deploy) or Cloudflare Pages — and copy the website address it gives you.
        </li>
      </ol>
      <div className="publish-grid">
        <label>GitHub owner (user or organisation)<input value={draft.owner} onChange={(event) => set({ owner: event.target.value })} placeholder="krossover" autoComplete="off" spellCheck={false} /></label>
        <label>Repository<input value={draft.repo} onChange={(event) => set({ repo: event.target.value })} placeholder="flipbooks" autoComplete="off" spellCheck={false} /></label>
        <label>Branch<input value={draft.branch} onChange={(event) => set({ branch: event.target.value })} placeholder="main" autoComplete="off" spellCheck={false} /></label>
        <label>Access token<input type="password" value={draft.token} onChange={(event) => set({ token: event.target.value })} placeholder="github_pat_…" autoComplete="off" spellCheck={false} /></label>
        <label className="wide">Website address<input value={draft.siteUrl} onChange={(event) => set({ siteUrl: event.target.value })} placeholder="https://flipbooks.vercel.app or https://books.yourdomain.com" autoComplete="off" spellCheck={false} /></label>
        <label className="wide">Bookshelf title (site home page)<input value={draft.siteTitle} onChange={(event) => set({ siteTitle: event.target.value })} placeholder="Our publications" /></label>
      </div>
      <p className="publish-note">The token is stored only on this computer (not in projects, exports or the website). Anyone with it can change the repository, so keep it private and limited to this one repository.</p>
      {check && <p className={check.ok ? 'publish-ok' : 'publish-error'} role="status">{check.message}</p>}
      <div className="publish-foot">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" onClick={() => void test()} disabled={!draft.owner.trim() || !draft.repo.trim() || !draft.token.trim() || checking}>{checking ? 'Checking…' : 'Test connection'}</button>
        <button type="submit" className="primary" disabled={!ready}>Save settings</button>
      </div>
    </form>
  )
}

/** Publish a publication as its own online flipbook link; update or unpublish it later. */
export function PublishDialog({ library, bookId, project: givenProject, onClose, onChange, fetchImpl, apiBase }: PublishDialogProps) {
  const book = library.index.books.find((candidate) => candidate.id === bookId)
  const [settings, setSettings] = useState<PublishSettings | null>(() => loadPublishSettings())
  const [view, setView] = useState<View>(() => (settingsComplete(loadPublishSettings()) ? 'publish' : 'setup'))
  const [slug, setSlug] = useState(book?.published?.slug ?? slugify(book?.title ?? givenProject?.title ?? 'publication'))
  const [progress, setProgress] = useState({ message: '', done: 0, total: 0 })
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ url: string; summary: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [taken, setTaken] = useState<string[]>([])
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const published = book?.published
  const working = view === 'working'

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !working) { event.preventDefault(); event.stopPropagation(); onClose() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose, working])

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('input, button.primary')?.focus()
  }, [view])

  // Links already used by other publications (this library, or published from another computer).
  useEffect(() => {
    if (view !== 'publish' || !settingsComplete(settings)) return
    let cancelled = false
    onlineSlugs(settings, fetchImpl, apiBase)
      .then((slugs) => { if (!cancelled) setTaken(slugs) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [apiBase, fetchImpl, settings, view])

  const librarySlugs = useMemo(
    () => new Map(library.index.books.filter((other) => other.id !== bookId && other.published).map((other) => [other.published!.slug, other.title])),
    [bookId, library.index.books],
  )
  const slugProblem = validateSlug(slug)
    || (librarySlugs.has(slug) ? `“${librarySlugs.get(slug)}” already uses this link. Choose another name.` : '')
  const takenOnline = !slugProblem && slug !== published?.slug && taken.includes(slug)

  if (!book) return null

  const doPublish = async () => {
    if (!settingsComplete(settings) || slugProblem) return
    setView('working')
    setError('')
    try {
      const project = givenProject ?? (await library.openBook(bookId))
      // Changing the link name moves the publication: remove the old folder afterwards.
      const outcome = await publishBook(settings, project, {
        slug,
        fetchImpl,
        apiBase,
        onProgress: (message, done = 0, total = 0) => setProgress({ message, done, total }),
      })
      if (published && published.slug !== slug) {
        setProgress({ message: 'Removing the old link…', done: 0, total: 0 })
        await unpublishBook(settings, published.slug, { fetchImpl, apiBase })
      }
      await library.setPublished(bookId, { slug, url: outcome.url, publishedAt: new Date().toISOString() })
      onChange()
      const summary = outcome.uploaded === 0 && published ? 'Nothing had changed since the last publish.' : `${outcome.uploaded} file${outcome.uploaded === 1 ? '' : 's'} uploaded${outcome.unchanged ? `, ${outcome.unchanged} unchanged` : ''}.`
      setResult({ url: outcome.url, summary })
      setView('done')
    } catch (err) {
      setError(errorMessage(err, 'Publishing failed.'))
      setView('publish')
    }
  }

  const doUnpublish = async () => {
    if (!settingsComplete(settings) || !published) return
    setView('working')
    setError('')
    try {
      await unpublishBook(settings, published.slug, { fetchImpl, apiBase, onProgress: (message) => setProgress({ message, done: 0, total: 0 }) })
      await library.setPublished(bookId, null)
      onChange()
      onClose()
    } catch (err) {
      setError(errorMessage(err, 'Unpublishing failed.'))
      setView('publish')
    }
  }

  const share = async (url: string) => {
    setCopied(await copyText(url))
    window.setTimeout(() => setCopied(false), 2000)
  }

  const link = settingsComplete(settings) ? bookUrl(settings, slug || 'publication') : ''

  return (
    <div className="publish-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) onClose() }}>
      <div className="publish-dialog" role="dialog" aria-modal="true" aria-label="Publish online" ref={dialogRef}>
        <header>
          <h2>{view === 'setup' ? 'Set up online publishing' : 'Publish online'}</h2>
          <span className="publish-book">{book.title}</span>
        </header>

        {view === 'setup' && (
          <SetupForm
            initial={settings ?? EMPTY_SETTINGS}
            fetchImpl={fetchImpl}
            apiBase={apiBase}
            onCancel={() => (settingsComplete(settings) ? setView('publish') : onClose())}
            onSaved={(next) => { savePublishSettings(next); setSettings(next); setView('publish') }}
          />
        )}

        {(view === 'publish' || view === 'working') && settingsComplete(settings) && (
          <div className="publish-body">
            {published && (
              <div className="publish-live">
                <span className="publish-dot" aria-hidden="true" />
                <div>
                  <strong>Live</strong> since {new Date(published.publishedAt).toLocaleString()}
                  <a href={published.url} target="_blank" rel="noopener noreferrer">{published.url}</a>
                </div>
              </div>
            )}
            <label className="publish-slug">
              Link name
              <div className="publish-slug-row">
                <span className="publish-prefix" title={normalizeSiteUrl(settings.siteUrl)}>{normalizeSiteUrl(settings.siteUrl).replace(/^https?:\/\//, '')}/</span>
                <input value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} disabled={working} aria-label="Link name" spellCheck={false} />
                <span className="publish-prefix">/</span>
              </div>
            </label>
            {slugProblem ? <p className="publish-error">{slugProblem}</p> : takenOnline ? <p className="publish-warn">A publication with this link is already online (published from another computer?). Publishing will replace it.</p> : <p className="publish-note">Share link: <code>{link}</code></p>}
            {published && published.slug !== slug && !slugProblem && <p className="publish-warn">The old link {published.url} will stop working.</p>}
            <p className="publish-note">Publishes the pages, objects, animations, links and fonts, plus a preview image for WhatsApp and social media. The editable project file is not put online. The website updates about a minute after publishing.</p>
            {error && <p className="publish-error" role="alert">{error}</p>}
            {working && (
              <div className="publish-progress" role="status" aria-live="polite">
                <span>{progress.message || 'Working…'}</span>
                <progress max={progress.total || 1} value={progress.total ? progress.done : undefined} />
              </div>
            )}
            <div className="publish-foot">
              <button type="button" className="link-like" onClick={() => setView('setup')} disabled={working}>Publishing settings</button>
              <span className="spacer" />
              {published && <button type="button" className="danger" onClick={() => setView('unpublish')} disabled={working}>Unpublish</button>}
              <button type="button" onClick={onClose} disabled={working}>Close</button>
              <button type="button" className="primary" onClick={() => void doPublish()} disabled={working || Boolean(slugProblem)}>
                {working ? 'Publishing…' : published ? 'Update online version' : 'Publish'}
              </button>
            </div>
          </div>
        )}

        {view === 'unpublish' && published && (
          <div className="publish-body">
            <p>Remove <strong>{book.title}</strong> from the website? The link <code>{published.url}</code> will stop working for everyone who has it. The publication stays in your library and can be published again.</p>
            {error && <p className="publish-error" role="alert">{error}</p>}
            <div className="publish-foot">
              <span className="spacer" />
              <button type="button" onClick={() => setView('publish')}>Keep it online</button>
              <button type="button" className="danger primary" onClick={() => void doUnpublish()}>Unpublish</button>
            </div>
          </div>
        )}

        {view === 'done' && result && (
          <div className="publish-body">
            <p className="publish-ok" role="status">Published. {result.summary} Your link is ready to share:</p>
            <div className="publish-link-box">
              <code data-testid="published-url">{result.url}</code>
              <button type="button" className="primary" onClick={() => void share(result.url)}>{copied ? 'Copied ✓' : 'Copy link'}</button>
            </div>
            <div className="publish-share">
              <button type="button" onClick={() => void openExternal(result.url)}>Open in browser ↗</button>
              <button type="button" onClick={() => void openExternal(whatsappShareUrl(book.title, result.url))}>Share on WhatsApp</button>
              <button type="button" onClick={() => void openExternal(`mailto:?subject=${encodeURIComponent(book.title)}&body=${encodeURIComponent(result.url)}`)}>Email link</button>
            </div>
            <p className="publish-note">If the link shows “not found”, wait a minute for the host to finish deploying, then refresh.</p>
            <div className="publish-foot">
              <span className="spacer" />
              <button type="button" className="primary" onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
