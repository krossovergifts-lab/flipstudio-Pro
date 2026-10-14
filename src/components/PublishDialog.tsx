import { useEffect, useMemo, useRef, useState } from 'react'
import type { Library } from '../lib/library'
import type { ProjectState } from '../lib/project'
import { errorMessage } from '../lib/errors'
import { openExternal } from '../lib/external'
import {
  bookUrl,
  connectGitHubPages,
  loadSites,
  pagesProjectName,
  siteLabel,
  upsertSite,
  DEFAULT_SITE_REPO,
  newRepoUrl,
  newTokenUrl,
  EMPTY_SETTINGS,
  GitHubRepo,
  normalizeSiteUrl,
  onlineSlugs,
  publishBook,
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

type View = 'choose' | 'setup-pages' | 'setup-single' | 'setup-advanced' | 'publish' | 'working' | 'done' | 'unpublish'

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

function AdvancedSetup({ initial, onSaved, onCancel, fetchImpl, apiBase }: { initial: PublishSettings; onSaved: (settings: PublishSettings) => void; onCancel: () => void; fetchImpl?: PublishDialogProps['fetchImpl']; apiBase?: string }) {
  const [draft, setDraft] = useState<PublishSettings>(initial)
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const set = (patch: Partial<PublishSettings>) => { setDraft((current) => ({ ...current, ...patch })); setCheck(null) }
  const cleaned = (): PublishSettings => ({
    ...draft,
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
      <p className="publish-note">For Vercel, Cloudflare Pages or your own domain. Connect a repository to the host, then fill in all fields.</p>
      <div className="publish-grid">
        <label>GitHub owner (user or organisation)<input value={draft.owner} onChange={(event) => set({ owner: event.target.value })} placeholder="krossover" autoComplete="off" spellCheck={false} /></label>
        <label>Repository<input value={draft.repo} onChange={(event) => set({ repo: event.target.value })} placeholder="flipbooks" autoComplete="off" spellCheck={false} /></label>
        <label>Branch<input value={draft.branch} onChange={(event) => set({ branch: event.target.value })} placeholder="main" autoComplete="off" spellCheck={false} /></label>
        <label>Access token<input type="password" value={draft.token} onChange={(event) => set({ token: event.target.value })} placeholder="github_pat_…" autoComplete="off" spellCheck={false} /></label>
        <label className="wide">Website address<input value={draft.siteUrl} onChange={(event) => set({ siteUrl: event.target.value })} placeholder="https://flipbooks.vercel.app or https://books.yourdomain.com" autoComplete="off" spellCheck={false} /></label>
        <label className="wide">Bookshelf title (site home page)<input value={draft.siteTitle} onChange={(event) => set({ siteTitle: event.target.value })} placeholder="Our publications" /></label>
        <label className="wide">Website type
          <select value={draft.layout ?? 'shelf'} onChange={(event) => set({ layout: event.target.value as PublishSettings['layout'] })}>
            <option value="shelf">Bookshelf — many publications, each at site/link-name/</option>
            <option value="single">One catalogue — the publication is the whole website</option>
          </select>
        </label>
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


function SetupForm({ initial, onSaved, onCancel, fetchImpl, apiBase }: { initial: PublishSettings; onSaved: (settings: PublishSettings) => void; onCancel: () => void; fetchImpl?: PublishDialogProps['fetchImpl']; apiBase?: string }) {
  const [advanced, setAdvanced] = useState(false)
  const [token, setToken] = useState(initial.token)
  const [owner, setOwner] = useState(initial.owner)
  const [repo, setRepo] = useState(initial.repo || DEFAULT_SITE_REPO)
  const [siteTitle, setSiteTitle] = useState(initial.siteTitle || 'Our publications')
  const [busy, setBusy] = useState('')
  const [problem, setProblem] = useState('')

  if (advanced) {
    return (
      <AdvancedSetup initial={initial} onSaved={onSaved} onCancel={() => setAdvanced(false)} fetchImpl={fetchImpl} apiBase={apiBase} />
    )
  }

  const connect = async (event: React.FormEvent) => {
    event.preventDefault()
    setProblem('')
    setBusy('Connecting…')
    try {
      const settings = await connectGitHubPages(token.trim(), { owner: owner.trim() || undefined, repo: repo.trim() || DEFAULT_SITE_REPO, siteTitle, fetchImpl, apiBase, onProgress: setBusy })
      onSaved(settings)
    } catch (err) {
      setProblem(errorMessage(err, 'Could not connect.'))
    } finally {
      setBusy('')
    }
  }

  return (
    <form className="publish-setup" onSubmit={(event) => void connect(event)}>
      <p className="publish-intro">One-time setup — your flipbooks are hosted free on GitHub Pages. About 2 minutes.</p>
      <div className="publish-step">
        <span className="publish-step-no">1</span>
        <div>
          <strong>Create the website repository</strong>
          <span>Opens GitHub with everything filled in (name <code>{repo || DEFAULT_SITE_REPO}</code>, Public). Just click <em>Create repository</em>.</span>
        </div>
        <a className="publish-step-btn" href={newRepoUrl(repo || DEFAULT_SITE_REPO)} target="_blank" rel="noopener noreferrer">Create repository ↗</a>
      </div>
      <div className="publish-step">
        <span className="publish-step-no">2</span>
        <div>
          <strong>Create an access key</strong>
          <span>Permissions are filled in. Under <em>Repository access</em> choose <em>Only select repositories</em> → <code>{repo || DEFAULT_SITE_REPO}</code>, click <em>Generate token</em> and copy it.</span>
        </div>
        <a className="publish-step-btn" href={newTokenUrl(owner)} target="_blank" rel="noopener noreferrer">Create access key ↗</a>
      </div>
      <div className="publish-step">
        <span className="publish-step-no">3</span>
        <div className="publish-step-fields">
          <strong>Paste the key and connect</strong>
          <input type="password" value={token} onChange={(event) => { setToken(event.target.value); setProblem('') }} placeholder="github_pat_…" aria-label="Access key" autoComplete="off" spellCheck={false} />
          <label>Bookshelf title (your site’s home page)<input value={siteTitle} onChange={(event) => setSiteTitle(event.target.value)} placeholder="Our publications" /></label>
        </div>
      </div>
      <details className="publish-more">
        <summary>Repository name or organisation</summary>
        <div className="publish-grid">
          <label>Repository<input value={repo} onChange={(event) => setRepo(event.target.value)} placeholder={DEFAULT_SITE_REPO} spellCheck={false} /></label>
          <label>Owner (leave empty for your account)<input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="your GitHub name" spellCheck={false} /></label>
        </div>
      </details>
      <p className="publish-note">The key is stored only on this computer and can only change the <code>{repo || DEFAULT_SITE_REPO}</code> repository.</p>
      {problem && <p className="publish-error" role="alert">{problem}</p>}
      {busy && <p className="publish-note" role="status">{busy}</p>}
      <div className="publish-foot">
        <button type="button" className="link-like" onClick={() => setAdvanced(true)}>Use Vercel, Cloudflare or my own domain</button>
        <span className="spacer" />
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={!token.trim() || Boolean(busy)}>{busy ? 'Connecting…' : 'Connect'}</button>
      </div>
    </form>
  )
}


function SingleSiteSetup({ initial, suggestedName, onSaved, onCancel, fetchImpl, apiBase }: { initial: Partial<PublishSettings>; suggestedName: string; onSaved: (settings: PublishSettings) => void; onCancel: () => void; fetchImpl?: PublishDialogProps['fetchImpl']; apiBase?: string }) {
  const [name, setName] = useState(() => {
    try {
      if (initial.siteUrl && /\.pages\.dev$/i.test(new URL(initial.siteUrl).hostname)) return new URL(initial.siteUrl).hostname.split('.')[0]
    } catch {
      // fall through to a name from the title
    }
    return pagesProjectName(suggestedName)
  })
  const [repo, setRepo] = useState(initial.repo || pagesProjectName(suggestedName).slice(0, 40) || 'catalogue')
  const [owner, setOwner] = useState(initial.owner ?? '')
  const [token, setToken] = useState(initial.token ?? '')
  const [siteUrl, setSiteUrl] = useState(initial.siteUrl ?? '')
  const [busy, setBusy] = useState('')
  const [problem, setProblem] = useState('')
  const [copied, setCopied] = useState(false)
  const address = siteUrl.trim() || (name ? `https://${name}.pages.dev` : '')

  const connect = async (event: React.FormEvent) => {
    event.preventDefault()
    setProblem('')
    setBusy('Checking the repository and key…')
    try {
      let login = owner.trim()
      if (!login) {
        const probe = new GitHubRepo({ ...EMPTY_SETTINGS, token: token.trim(), owner: 'x', repo: 'x' }, fetchImpl, apiBase)
        login = (await probe.request<{ login: string }>('GET', `${probe.api}/user`)).data.login
        setOwner(login)
      }
      const settings: PublishSettings = {
        ...EMPTY_SETTINGS,
        ...initial,
        owner: login,
        repo: repo.trim(),
        branch: initial.branch || 'main',
        token: token.trim(),
        siteUrl: normalizeSiteUrl(address),
        siteTitle: initial.siteTitle || suggestedName,
        label: initial.label || normalizeSiteUrl(address).replace(/^https?:\/\//, ''),
        layout: 'single',
      }
      const info = await new GitHubRepo(settings, fetchImpl, apiBase).checkAccess()
      settings.branch = info.defaultBranch || settings.branch
      if (!settingsComplete(settings)) throw new Error('Fill in the website address.')
      onSaved(settings)
    } catch (err) {
      setProblem(errorMessage(err, 'Could not connect.'))
    } finally {
      setBusy('')
    }
  }

  return (
    <form className="publish-setup" onSubmit={(event) => void connect(event)}>
      <p className="publish-intro">A website of its own for one catalogue — free on Cloudflare Pages, with a brand-free address like <code>{name || 'your-name'}.pages.dev</code>. Unlimited visitors, commercial use allowed.</p>
      <label className="publish-name">
        Website name (becomes the link)
        <div className="publish-slug-row">
          <span className="publish-prefix">https://</span>
          <input value={name} onChange={(event) => setName(pagesProjectName(event.target.value) || event.target.value.toLowerCase())} aria-label="Website name" spellCheck={false} />
          <span className="publish-prefix">.pages.dev</span>
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(name).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) }).catch(() => undefined) }}>{copied ? 'Copied ✓' : 'Copy'}</button>
        </div>
      </label>
      <div className="publish-step">
        <span className="publish-step-no">1</span>
        <div>
          <strong>Create a repository for this catalogue</strong>
          <span>Name <code>{repo}</code> — Private is fine. Click <em>Create repository</em>.</span>
        </div>
        <a className="publish-step-btn" href={newRepoUrl(repo, 'private')} target="_blank" rel="noopener noreferrer">Create repository ↗</a>
      </div>
      <div className="publish-step">
        <span className="publish-step-no">2</span>
        <div>
          <strong>Let your access key use it</strong>
          <span>Open your keys → <em>FlipStudio Pro publishing</em> → <em>Edit</em> → Repository access: add <code>{repo}</code> → <em>Update</em>. (Contents: Read and write is already set.)</span>
        </div>
        <a className="publish-step-btn" href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener noreferrer">Open my keys ↗</a>
      </div>
      <div className="publish-step">
        <span className="publish-step-no">3</span>
        <div>
          <strong>Create the website on Cloudflare (free account)</strong>
          <span><em>Workers &amp; Pages</em> → <em>Create application</em> → <em>Pages</em> tab (not Workers) → <em>Import an existing Git repository</em> → connect GitHub with <em>Only select repositories</em> → <code>{repo}</code> → <em>Begin setup</em> → Project name <code>{name}</code> (Copy above) → Framework preset <em>None</em>, Build command <code>exit 0</code>, Build output directory empty → <em>Save and Deploy</em>.</span>
        </div>
        <a className="publish-step-btn" href="https://dash.cloudflare.com/sign-up/pages" target="_blank" rel="noopener noreferrer">Open Cloudflare ↗</a>
      </div>
      <div className="publish-step">
        <span className="publish-step-no">4</span>
        <div className="publish-step-fields">
          <strong>Check the address and connect</strong>
          <label>Website address (as Cloudflare shows it)<input value={siteUrl} onChange={(event) => setSiteUrl(event.target.value)} placeholder={address || 'https://your-name.pages.dev'} spellCheck={false} /></label>
          <label>Repository<input value={repo} onChange={(event) => setRepo(event.target.value)} spellCheck={false} /></label>
          <label>Access key<input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="github_pat_…" aria-label="Access key" autoComplete="off" spellCheck={false} /></label>
        </div>
      </div>
      <p className="publish-note">Later you can add your own domain (e.g. giftscatalogue2027.com) in Cloudflare → your project → Custom domains, then change the website address here.</p>
      {problem && <p className="publish-error" role="alert">{problem}</p>}
      {busy && <p className="publish-note" role="status">{busy}</p>}
      <div className="publish-foot">
        <span className="spacer" />
        <button type="button" onClick={onCancel}>Back</button>
        <button type="submit" className="primary" disabled={!token.trim() || !repo.trim() || !address || Boolean(busy)}>{busy ? 'Connecting…' : 'Connect website'}</button>
      </div>
    </form>
  )
}

function ChooseSite({ onPick, onCancel, hasSites }: { onPick: (kind: 'setup-pages' | 'setup-single') => void; onCancel: () => void; hasSites: boolean }) {
  return (
    <div className="publish-body">
      <p className="publish-intro">Where should this publication go online?</p>
      <button type="button" className="publish-choice" onClick={() => onPick('setup-single')}>
        <span className="publish-choice-icon" aria-hidden="true">🌐</span>
        <span className="publish-choice-text">
          <strong>Its own brand-free website <em>Best for the main catalogue</em></strong>
          <span>One catalogue at its own address — safe for resellers to share. Free on Cloudflare Pages.</span>
          <code>promotionalgifts-catalogue-2027.pages.dev</code>
        </span>
        <span className="publish-choice-arrow" aria-hidden="true">›</span>
      </button>
      <button type="button" className="publish-choice" onClick={() => onPick('setup-pages')}>
        <span className="publish-choice-icon" aria-hidden="true">📚</span>
        <span className="publish-choice-text">
          <strong>Bookshelf on GitHub Pages</strong>
          <span>Many publications on one site. The address shows your GitHub name.</span>
          <code>yourname.github.io/flipbooks/link-name/</code>
        </span>
        <span className="publish-choice-arrow" aria-hidden="true">›</span>
      </button>
      <div className="publish-foot">
        <span className="spacer" />
        <button type="button" onClick={onCancel}>{hasSites ? 'Back' : 'Cancel'}</button>
      </div>
    </div>
  )
}

/** Publish a publication as its own online flipbook link; update or unpublish it later. */
export function PublishDialog({ library, bookId, project: givenProject, onClose, onChange, fetchImpl, apiBase }: PublishDialogProps) {
  const book = library.index.books.find((candidate) => candidate.id === bookId)
  const [sites, setSites] = useState<PublishSettings[]>(() => loadSites().filter(settingsComplete))
  const [siteId, setSiteId] = useState<string | undefined>(() => {
    const all = loadSites().filter(settingsComplete)
    const wanted = book?.published?.siteId
    return (wanted && all.some((site) => site.id === wanted) ? wanted : all[0]?.id) ?? undefined
  })
  const [editing, setEditing] = useState<PublishSettings | null>(null)
  const [view, setView] = useState<View>(() => (loadSites().some(settingsComplete) ? 'publish' : 'choose'))
  const [slug, setSlug] = useState(book?.published?.slug || slugify(book?.title ?? givenProject?.title ?? 'publication'))
  const [progress, setProgress] = useState({ message: '', done: 0, total: 0 })
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ url: string; summary: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [taken, setTaken] = useState<string[]>([])
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const published = book?.published
  const working = view === 'working'
  const settings = sites.find((site) => site.id === siteId) ?? null
  const single = settings?.layout === 'single'
  const publishedSite = published ? sites.find((site) => site.id === (published.siteId ?? 'site-main')) ?? null : null

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
    if (view !== 'publish' || !settingsComplete(settings) || settings.layout === 'single') return
    let cancelled = false
    onlineSlugs(settings, fetchImpl, apiBase)
      .then((slugs) => { if (!cancelled) setTaken(slugs) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [apiBase, fetchImpl, settings, view])

  const others = useMemo(
    () => library.index.books.filter((other) => other.id !== bookId && other.published && (other.published.siteId ?? 'site-main') === siteId),
    [bookId, library.index.books, siteId],
  )
  const librarySlugs = new Map(others.map((other) => [other.published!.slug, other.title]))
  const slugProblem = single ? '' : validateSlug(slug)
    || (librarySlugs.has(slug) ? `“${librarySlugs.get(slug)}” already uses this link. Choose another name.` : '')
  const takenOnline = !single && !slugProblem && slug !== published?.slug && taken.includes(slug)
  const replacing = single ? others[0] : undefined
  const movingSite = Boolean(published && publishedSite && settings && publishedSite.id !== settings.id)

  if (!book) return null

  const saveSite = (next: PublishSettings) => {
    const saved = upsertSite(next)
    setSites(loadSites().filter(settingsComplete))
    setSiteId(saved.id)
    setEditing(null)
    setView('publish')
  }

  const doPublish = async () => {
    if (!settingsComplete(settings) || slugProblem) return
    setView('working')
    setError('')
    try {
      const project = givenProject ?? (await library.openBook(bookId))
      const outcome = await publishBook(settings, project, {
        slug,
        fetchImpl,
        apiBase,
        onProgress: (message, done = 0, total = 0) => setProgress({ message, done, total }),
      })
      // Changing the link name (or website) moves the publication: remove the old copy afterwards.
      if (published && publishedSite && (publishedSite.id !== settings.id || (!single && published.slug !== slug))) {
        setProgress({ message: 'Removing the old link…', done: 0, total: 0 })
        await unpublishBook(publishedSite, published.slug, { fetchImpl, apiBase }).catch(() => undefined)
      }
      if (replacing) await library.setPublished(replacing.id, null)
      await library.setPublished(bookId, { slug: single ? '' : slug, url: outcome.url, publishedAt: new Date().toISOString(), siteId: settings.id })
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
    const site = publishedSite ?? settings
    if (!settingsComplete(site) || !published) return
    setView('working')
    setError('')
    try {
      await unpublishBook(site, published.slug, { fetchImpl, apiBase, onProgress: (message) => setProgress({ message, done: 0, total: 0 }) })
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
  const backFromSetup = () => (sites.length ? setView('publish') : setView('choose'))
  const title = view === 'choose' ? 'Publish online' : view.startsWith('setup') ? (editing ? 'Website settings' : 'Add a website') : 'Publish online'

  return (
    <div className="publish-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) onClose() }}>
      <div className="publish-dialog" role="dialog" aria-modal="true" aria-label="Publish online" ref={dialogRef}>
        <header>
          <h2>{view === 'setup-pages' && !sites.length ? 'Set up online publishing' : title}</h2>
          <span className="publish-book">{book.title}</span>
        </header>

        {view === 'choose' && <ChooseSite hasSites={sites.length > 0} onPick={(kind) => { setEditing(null); setView(kind) }} onCancel={() => (sites.length ? setView('publish') : onClose())} />}

        {view === 'setup-pages' && (
          <SetupForm
            initial={editing ?? { ...EMPTY_SETTINGS, token: sites[0]?.token ?? '', owner: sites[0]?.owner ?? '' }}
            fetchImpl={fetchImpl}
            apiBase={apiBase}
            onCancel={backFromSetup}
            onSaved={(next) => saveSite({ ...next, id: editing?.id, layout: next.layout ?? 'shelf' })}
          />
        )}
        {view === 'setup-single' && (
          <SingleSiteSetup
            initial={editing ?? { token: sites[0]?.token ?? '', owner: sites[0]?.owner ?? '' }}
            suggestedName={book.title}
            fetchImpl={fetchImpl}
            apiBase={apiBase}
            onCancel={() => (editing ? setView('publish') : setView('choose'))}
            onSaved={(next) => saveSite({ ...next, id: editing?.id })}
          />
        )}
        {view === 'setup-advanced' && editing && (
          <AdvancedSetup initial={editing} fetchImpl={fetchImpl} apiBase={apiBase} onCancel={() => setView('publish')} onSaved={(next) => saveSite({ ...next, id: editing.id })} />
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
            <label className="publish-site">
              Website
              <div className="publish-site-row">
                <select
                  value={siteId}
                  aria-label="Website"
                  disabled={working}
                  onChange={(event) => {
                    if (event.target.value === '__add') { setEditing(null); setView('choose'); return }
                    setSiteId(event.target.value)
                  }}
                >
                  {sites.map((site) => <option key={site.id} value={site.id}>{siteLabel(site)}{site.layout === 'single' ? ' — own website' : ' — bookshelf'}</option>)}
                  <option value="__add">+ Add a website…</option>
                </select>
                <button type="button" onClick={() => { setEditing(settings); setView(settings.layout === 'single' ? 'setup-single' : 'setup-advanced') }} disabled={working}>Settings</button>
              </div>
            </label>
            {single ? (
              <p className="publish-note">This publication becomes the whole website. Share link: <code>{link}</code></p>
            ) : (
              <>
                <label className="publish-slug">
                  Link name
                  <div className="publish-slug-row">
                    <span className="publish-prefix" title={normalizeSiteUrl(settings.siteUrl)}>{normalizeSiteUrl(settings.siteUrl).replace(/^https?:\/\//, '')}/</span>
                    <input value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} disabled={working} aria-label="Link name" spellCheck={false} />
                    <span className="publish-prefix">/</span>
                  </div>
                </label>
                {slugProblem ? <p className="publish-error">{slugProblem}</p> : takenOnline ? <p className="publish-warn">A publication with this link is already online (published from another computer?). Publishing will replace it.</p> : <p className="publish-note">Share link: <code>{link}</code></p>}
              </>
            )}
            {replacing && <p className="publish-warn">“{replacing.title}” is on this website now. Publishing replaces it with this publication.</p>}
            {movingSite && <p className="publish-warn">It moves from {published!.url} — that old link will stop working.</p>}
            {published && !movingSite && !single && published.slug && published.slug !== slug && !slugProblem && <p className="publish-warn">The old link {published.url} will stop working.</p>}
            <p className="publish-note">Publishes the pages, objects, animations, links, fonts and the flipbook design, plus a preview image for WhatsApp and social media. The editable project file is not put online. The website updates about a minute after publishing.</p>
            {error && <p className="publish-error" role="alert">{error}</p>}
            {working && (
              <div className="publish-progress" role="status" aria-live="polite">
                <span>{progress.message || 'Working…'}</span>
                <progress max={progress.total || 1} value={progress.total ? progress.done : undefined} />
              </div>
            )}
            <div className="publish-foot">
              <span className="spacer" />
              {published && <button type="button" className="danger" onClick={() => setView('unpublish')} disabled={working}>Unpublish</button>}
              <button type="button" onClick={onClose} disabled={working}>Close</button>
              <button type="button" className="primary" onClick={() => void doPublish()} disabled={working || Boolean(slugProblem)}>
                {working ? 'Publishing…' : published && !movingSite ? 'Update online version' : 'Publish'}
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
