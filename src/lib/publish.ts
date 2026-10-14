// Publishing to the web: every publication becomes its own folder in a GitHub
// repository (one commit per publish). A static host connected to that
// repository — Vercel, Cloudflare Pages or GitHub Pages — deploys each commit,
// so every publication gets its own shareable link: <site>/<slug>/
//
// Only the GitHub REST API is used (git data endpoints), straight from the app;
// no server of our own is involved.

import { buildPublicationFiles, bytesToBase64, type ExportOptions, type ProjectState, type PublicationFile } from './project'

export interface PublishSettings {
  /** GitHub user or organisation that owns the repository. */
  owner: string
  repo: string
  branch: string
  /** Fine-grained personal access token with "Contents: Read and write" on this repository only. */
  token: string
  /** Public address of the website, e.g. https://krossover-books.vercel.app */
  siteUrl: string
  /** Title of the online bookshelf (the site home page). */
  siteTitle: string
  /** Identifies this website among several (set when saved). */
  id?: string
  /** Name shown in the website list, e.g. "Catalogue 2027 site". */
  label?: string
  /**
   * 'shelf': many publications, each at <site>/<link-name>/, plus a bookshelf home page.
   * 'single': one publication IS the website (opens at <site>/) — for a brand-free catalogue address.
   */
  layout?: 'shelf' | 'single'
}

export interface CatalogEntry {
  slug: string
  title: string
  description: string
  category: string
  keywords: string
  pageCount: number
  updatedAt: string
}

export interface Catalog {
  version: 1
  title: string
  books: CatalogEntry[]
}

export type PublishProgress = (message: string, done?: number, total?: number) => void

const SETTINGS_KEY = 'flipstudio.publish.v1'
/** Top-level names that cannot be used as publication slugs. */
const RESERVED = new Set(['index.html', 'catalog.json', '404.html', '.nojekyll', 'assets', 'api', 'readme.md', 'vercel.json', '.github'])

export const EMPTY_SETTINGS: PublishSettings = { owner: '', repo: '', branch: 'main', token: '', siteUrl: '', siteTitle: 'Our publications' }

// ---------------------------------------------------------------------------
// Settings (kept on this computer only, never in projects or exports)
// ---------------------------------------------------------------------------

const SITES_KEY = 'flipstudio.publish.sites.v1'

function siteId(): string {
  return `site-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/** Every website this computer can publish to (oldest first). Migrates the single-site setting of v1.2. */
export function loadSites(): PublishSettings[] {
  try {
    const raw = window.localStorage.getItem(SITES_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PublishSettings>[]
      if (Array.isArray(parsed)) return parsed.map((site) => ({ ...EMPTY_SETTINGS, layout: 'shelf' as const, ...site, id: site.id || siteId() }))
    }
    const legacy = window.localStorage.getItem(SETTINGS_KEY)
    if (legacy) {
      const site: PublishSettings = { ...EMPTY_SETTINGS, ...(JSON.parse(legacy) as Partial<PublishSettings>), layout: 'shelf', id: 'site-main' }
      window.localStorage.setItem(SITES_KEY, JSON.stringify([site]))
      return [site]
    }
  } catch {
    // Unreadable storage: start without websites.
  }
  return []
}

export function saveSites(sites: PublishSettings[]): void {
  try {
    window.localStorage.setItem(SITES_KEY, JSON.stringify(sites))
  } catch {
    // Storage can be unavailable (private mode); settings then last for this session only.
  }
}

/** Adds or replaces a website (matched by id); returns it with its id. */
export function upsertSite(site: PublishSettings): PublishSettings {
  const saved = { ...site, id: site.id || siteId() }
  const sites = loadSites()
  const index = sites.findIndex((candidate) => candidate.id === saved.id)
  if (index >= 0) sites[index] = saved
  else sites.push(saved)
  saveSites(sites)
  return saved
}

export function removeSite(id: string): void {
  saveSites(loadSites().filter((site) => site.id !== id))
}

export function siteLabel(site: PublishSettings): string {
  return site.label?.trim() || normalizeSiteUrl(site.siteUrl).replace(/^https?:\/\//, '') || `${site.owner}/${site.repo}`
}

/** First website (kept for callers of v1.2). */
export function loadPublishSettings(): PublishSettings | null {
  return loadSites()[0] ?? null
}

export function savePublishSettings(settings: PublishSettings | null): void {
  if (settings) upsertSite(settings)
}

export function settingsComplete(settings: PublishSettings | null): settings is PublishSettings {
  return Boolean(settings && settings.owner.trim() && settings.repo.trim() && settings.branch.trim() && settings.token.trim() && normalizeSiteUrl(settings.siteUrl))
}

/** "my-site.vercel.app" → "https://my-site.vercel.app" (no trailing slash). Empty when invalid. */
export function normalizeSiteUrl(value: string): string {
  let url = String(value || '').trim()
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  try {
    const parsed = new URL(url)
    if (!parsed.hostname.includes('.')) return ''
    return (parsed.origin + parsed.pathname).replace(/\/+$/, '')
  } catch {
    return ''
  }
}

/** Short, link-friendly name: "Spring Gifts 2027!" → "spring-gifts-2027". */
export function slugify(title: string): string {
  const slug = String(title || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return slug || 'publication'
}

export function validateSlug(slug: string): string {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(slug)) return 'Use 1–60 lowercase letters, numbers and dashes (no dash at the start or end).'
  if (RESERVED.has(slug)) return `“${slug}” is reserved by the website. Choose another link name.`
  return ''
}

export function bookUrl(settings: Pick<PublishSettings, 'siteUrl' | 'layout'>, slug: string): string {
  if (settings.layout === 'single') return `${normalizeSiteUrl(settings.siteUrl)}/`
  return `${normalizeSiteUrl(settings.siteUrl)}/${slug}/`
}

/** Files that belong to the repository itself, never to a publication. */
const REPO_FILES = /^(README\.md|LICENSE(\..*)?|\.github\/.*|\.gitignore|CNAME|_headers|_redirects)$/i

// ---------------------------------------------------------------------------
// GitHub API
// ---------------------------------------------------------------------------

export class PublishError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'PublishError'
    this.status = status
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

interface TreeEntry {
  path: string
  mode: string
  type: 'blob' | 'tree' | 'commit'
  sha: string | null
  size?: number
}

export class GitHubRepo {
  private readonly settings: PublishSettings
  private readonly fetchImpl: FetchLike
  readonly api: string

  constructor(settings: PublishSettings, fetchImpl?: FetchLike, api = 'https://api.github.com') {
    this.settings = settings
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init))
    this.api = api
  }

  private get base() {
    return `${this.api}/repos/${encodeURIComponent(this.settings.owner.trim())}/${encodeURIComponent(this.settings.repo.trim())}`
  }

  async request<T>(method: string, path: string, body?: unknown, allow: number[] = []): Promise<{ status: number; data: T }> {
    let response: Response
    try {
      response = await this.fetchImpl(path.startsWith('http') ? path : this.base + path, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.settings.token.trim()}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (error) {
      throw new PublishError(`Could not reach GitHub. Check the internet connection. (${error instanceof Error ? error.message : String(error)})`)
    }
    const text = await response.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }
    if (!response.ok && !allow.includes(response.status)) {
      throw new PublishError(describeGitHubError(response.status, data, this.settings), response.status)
    }
    return { status: response.status, data: data as T }
  }

  /** Confirms the token can write to the repository. */
  async checkAccess(): Promise<{ private: boolean; defaultBranch: string; htmlUrl: string }> {
    const { data } = await this.request<{ private: boolean; default_branch: string; html_url: string; permissions?: { push?: boolean } }>('GET', '')
    if (data.permissions && data.permissions.push === false) {
      throw new PublishError('The token can read this repository but not write to it. Give it “Contents: Read and write” permission.')
    }
    // Reading works for any key on a public repository, so also try a harmless write (an unreferenced blob).
    try {
      await this.createBlob(new TextEncoder().encode('FlipStudio Pro connection check\n'))
    } catch (error) {
      if (!(error instanceof PublishError) || error.status !== 409) {
        throw new PublishError(`The key can see ${this.settings.owner}/${this.settings.repo} but is not allowed to change it. On GitHub, edit the key: Repository access must include this repository and Permissions → Contents must be “Read and write”.`, error instanceof PublishError ? error.status : undefined)
      }
    }
    return { private: Boolean(data.private), defaultBranch: data.default_branch || 'main', htmlUrl: data.html_url }
  }

  /** Latest commit and root tree of the branch, or null when the repository/branch has no commits yet. */
  async currentHead(): Promise<{ commit: string; tree: string } | null> {
    const branch = encodeURIComponent(this.settings.branch.trim())
    const ref = await this.request<{ object: { sha: string } }>('GET', `/git/ref/heads/${branch}`, undefined, [404, 409])
    if (ref.status === 404 || ref.status === 409) return null
    const commit = await this.request<{ tree: { sha: string } }>('GET', `/git/commits/${ref.data.object.sha}`)
    return { commit: ref.data.object.sha, tree: commit.data.tree.sha }
  }

  /** Latest commit and root tree of the branch; creates the first commit in an empty repository. */
  async head(): Promise<{ commit: string; tree: string }> {
    const branch = encodeURIComponent(this.settings.branch.trim())
    let ref = await this.request<{ object: { sha: string } }>('GET', `/git/ref/heads/${branch}`, undefined, [404, 409])
    if (ref.status === 404 || ref.status === 409) {
      // Empty repository (409) or missing branch: the contents API can create the first commit.
      await this.request('PUT', '/contents/README.md', {
        message: 'Start FlipStudio publications site',
        content: textToBase64(`# ${this.settings.siteTitle || 'Publications'}\n\nPublished with FlipStudio Pro. Each folder is one online flipbook.\n`),
        branch: this.settings.branch.trim(),
      }).catch((error: unknown) => {
        if (error instanceof PublishError && error.status === 404 && ref.status === 404) {
          throw new PublishError(`The branch “${this.settings.branch}” does not exist in ${this.settings.owner}/${this.settings.repo}. Use the repository's main branch name (usually “main”).`, 404)
        }
        throw error
      })
      ref = await this.request<{ object: { sha: string } }>('GET', `/git/ref/heads/${branch}`)
    }
    const commit = await this.request<{ tree: { sha: string } }>('GET', `/git/commits/${ref.data.object.sha}`)
    return { commit: ref.data.object.sha, tree: commit.data.tree.sha }
  }

  async tree(sha: string, recursive = false): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const { data } = await this.request<{ tree: TreeEntry[]; truncated: boolean }>('GET', `/git/trees/${sha}${recursive ? '?recursive=1' : ''}`)
    return { entries: data.tree, truncated: Boolean(data.truncated) }
  }

  async readBlobText(sha: string): Promise<string> {
    const { data } = await this.request<{ content: string; encoding: string }>('GET', `/git/blobs/${sha}`)
    return data.encoding === 'base64' ? base64ToText(data.content) : data.content
  }

  async createBlob(bytes: Uint8Array): Promise<string> {
    const { data } = await this.request<{ sha: string }>('POST', '/git/blobs', { content: bytesToBase64(bytes), encoding: 'base64' })
    return data.sha
  }

  async commitTree(base: { commit: string; tree: string }, entries: TreeEntry[], message: string): Promise<string> {
    const tree = await this.request<{ sha: string }>('POST', '/git/trees', { base_tree: base.tree, tree: entries })
    const commit = await this.request<{ sha: string }>('POST', '/git/commits', { message, tree: tree.data.sha, parents: [base.commit] })
    await this.request('PATCH', `/git/refs/heads/${encodeURIComponent(this.settings.branch.trim())}`, { sha: commit.data.sha, force: false })
    return commit.data.sha
  }
}

function describeGitHubError(status: number, data: unknown, settings: PublishSettings): string {
  const message = data && typeof data === 'object' && 'message' in data ? String((data as { message: unknown }).message) : ''
  const where = `${settings.owner}/${settings.repo}`
  if (status === 401) return 'GitHub rejected the access token (it may be mistyped, expired or revoked). Create a new token and paste it in Publishing settings.'
  if (status === 403 && /rate limit/i.test(message)) return 'GitHub’s hourly request limit was reached. Wait a few minutes and publish again.'
  if (status === 403) return `The token is not allowed to write to ${where}. Give it “Contents: Read and write” access to this repository. (${message})`
  if (status === 404) return `Repository ${where} was not found, or the token has no access to it. Check the owner and repository names and the token’s repository access.`
  if (status === 422 && /fast forward/i.test(message)) return 'The website changed while publishing (another publish at the same time?). Publish again.'
  return `GitHub error ${status}${message ? `: ${message}` : ''}`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder()
function toBytes(data: Uint8Array | string): Uint8Array {
  return typeof data === 'string' ? encoder.encode(data) : data
}
function textToBase64(text: string): string {
  return bytesToBase64(encoder.encode(text))
}
function base64ToText(value: string): string {
  const binary = atob(value.replace(/\s+/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new TextDecoder().decode(bytes)
}

/** The SHA-1 git gives a file's content, so unchanged files are not uploaded again. */
export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const header = encoder.encode(`blob ${bytes.length}\0`)
  const joined = new Uint8Array(header.length + bytes.length)
  joined.set(header, 0)
  joined.set(bytes, header.length)
  const digest = await crypto.subtle.digest('SHA-1', joined)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await fn(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

const escapeHtml = (value: string): string =>
  String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string)

/** 1200×630 JPEG of the cover page for link previews (WhatsApp, Facebook, LinkedIn, X). */
export async function makeShareImage(project: ProjectState): Promise<Uint8Array | null> {
  const source = project.pages[0]?.previewUrl
  if (!source || typeof document === 'undefined') return null
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      const timer = window.setTimeout(() => reject(new Error('timeout')), 5000)
      img.onload = () => { window.clearTimeout(timer); resolve(img) }
      img.onerror = () => { window.clearTimeout(timer); reject(new Error('decode')) }
      img.src = source
    })
    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 630
    const context = canvas.getContext('2d')
    if (!context || !image.naturalWidth) return null
    const background = project.reader?.background && /^#[0-9a-f]{6}$/i.test(project.reader.background) ? project.reader.background : '#0b1220'
    context.fillStyle = background
    context.fillRect(0, 0, canvas.width, canvas.height)
    const height = 570
    const width = Math.min(1100, (image.naturalWidth / image.naturalHeight) * height)
    const drawHeight = (width / image.naturalWidth) * image.naturalHeight
    const x = (canvas.width - width) / 2
    const y = (canvas.height - drawHeight) / 2
    context.shadowColor = 'rgba(0,0,0,0.45)'
    context.shadowBlur = 28
    context.shadowOffsetY = 10
    context.drawImage(image, x, y, width, drawHeight)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    if (!dataUrl.startsWith('data:image/jpeg')) return null
    const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Site pages
// ---------------------------------------------------------------------------

/** The online bookshelf: the site's home page listing every published publication. */
export function buildSiteIndexHtml(catalog: Catalog, siteUrl: string): string {
  const books = [...catalog.books].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const categories = [...new Set(books.map((book) => book.category).filter(Boolean))].sort()
  const title = catalog.title || 'Publications'
  const base = normalizeSiteUrl(siteUrl)
  const firstCover = books[0] ? `${base}/${books[0].slug}/cover.jpg` : ''
  const cards = books
    .map(
      (book) => `      <li class="card" data-category="${escapeHtml(book.category)}" data-search="${escapeHtml(`${book.title} ${book.description} ${book.keywords} ${book.category}`.toLowerCase())}">
        <a href="./${book.slug}/">
          <span class="cover"><img src="./${book.slug}/cover.jpg" alt="" loading="lazy" /></span>
          <strong>${escapeHtml(book.title)}</strong>
          <span class="meta">${escapeHtml(book.category)}${book.category ? ' · ' : ''}${book.pageCount} page${book.pageCount === 1 ? '' : 's'}</span>
          ${book.description ? `<span class="desc">${escapeHtml(book.description)}</span>` : ''}
        </a>
      </li>`,
    )
    .join('\n')
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="generator" content="FlipStudio Pro" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(`${title}: ${books.length} online publication${books.length === 1 ? '' : 's'}`)}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(title)}" />
${base ? `    <meta property="og:url" content="${escapeHtml(base)}/" />\n` : ''}${firstCover ? `    <meta property="og:image" content="${escapeHtml(firstCover)}" />\n` : ''}    <style>
      *, *::before, *::after { box-sizing: border-box; }
      body { margin: 0; font: 15px/1.45 'Segoe UI', system-ui, -apple-system, sans-serif; color: #0f172a; background: #f1f5f9; }
      header { padding: 40px 16px 24px; text-align: center; color: #fff; background: linear-gradient(135deg, #0f172a, #1e3a8a); }
      header h1 { margin: 0 0 6px; font-size: clamp(24px, 4vw, 36px); }
      header p { margin: 0; opacity: 0.8; }
      .tools { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; max-width: 1100px; margin: 0 auto; padding: 18px 16px 0; }
      .tools input { flex: 1 1 260px; max-width: 420px; padding: 10px 14px; font: inherit; border: 1px solid #cbd5e1; border-radius: 999px; background: #fff; }
      .chip { padding: 8px 14px; font: inherit; font-size: 13px; color: #334155; background: #fff; border: 1px solid #cbd5e1; border-radius: 999px; cursor: pointer; }
      .chip[aria-pressed="true"] { color: #fff; background: #1d4ed8; border-color: #1d4ed8; }
      main { max-width: 1100px; margin: 0 auto; padding: 22px 16px 48px; }
      ul { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 22px; margin: 0; padding: 0; list-style: none; }
      .card a { display: flex; flex-direction: column; gap: 4px; height: 100%; color: inherit; text-decoration: none; }
      .cover { display: grid; place-items: center; aspect-ratio: 1200 / 630; overflow: hidden; border-radius: 10px; background: #e2e8f0; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.15); transition: transform 0.2s, box-shadow 0.2s; }
      .cover img { width: 100%; height: 100%; object-fit: cover; }
      .card a:hover .cover, .card a:focus-visible .cover { transform: translateY(-3px); box-shadow: 0 14px 32px rgba(15, 23, 42, 0.25); }
      .card strong { margin-top: 8px; font-size: 15px; }
      .meta { font-size: 12px; color: #64748b; }
      .desc { font-size: 13px; color: #475569; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .empty { padding: 48px 0; text-align: center; color: #64748b; }
      footer { padding: 0 16px 32px; text-align: center; font-size: 12px; color: #94a3b8; }
    </style>
  </head>
  <body>
    <header>
      <h1>${escapeHtml(title)}</h1>
      <p>${books.length} publication${books.length === 1 ? '' : 's'}</p>
    </header>
    <div class="tools">
      <input type="search" id="q" placeholder="Search publications…" aria-label="Search publications" />
${categories.length > 1 ? `      <button type="button" class="chip" data-cat="" aria-pressed="true">All</button>\n${categories.map((category) => `      <button type="button" class="chip" data-cat="${escapeHtml(category)}" aria-pressed="false">${escapeHtml(category)}</button>`).join('\n')}\n` : ''}    </div>
    <main>
      <ul id="books">
${cards}
      </ul>
      <p class="empty" id="empty"${books.length ? ' hidden' : ''}>${books.length ? 'No publications match your search.' : 'Nothing published yet.'}</p>
    </main>
    <footer>Interactive flipbooks</footer>
    <script>
(function () {
  var q = document.getElementById('q'), cat = '', cards = [].slice.call(document.querySelectorAll('.card')), empty = document.getElementById('empty');
  function apply() {
    var term = q.value.trim().toLowerCase(), shown = 0;
    cards.forEach(function (card) {
      var ok = (!cat || card.getAttribute('data-category') === cat) && (!term || card.getAttribute('data-search').indexOf(term) >= 0);
      card.hidden = !ok; if (ok) shown++;
    });
    if (cards.length) empty.hidden = shown > 0;
  }
  q.addEventListener('input', apply);
  [].forEach.call(document.querySelectorAll('.chip'), function (chip) {
    chip.addEventListener('click', function () {
      cat = chip.getAttribute('data-cat');
      [].forEach.call(document.querySelectorAll('.chip'), function (c) { c.setAttribute('aria-pressed', String(c === chip)); });
      apply();
    });
  });
})();
    </script>
  </body>
</html>
`
}

const NOT_FOUND_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Publication not found</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 'Segoe UI',system-ui,sans-serif;color:#e2e8f0;background:#0b1220;text-align:center}a{color:#93c5fd}</style></head>
<body><div><h1>Publication not found</h1><p>This flipbook may have been moved or unpublished.</p><p><a href="__HOME__">See all publications</a></p></div></body></html>
`

// ---------------------------------------------------------------------------
// Publish / unpublish
// ---------------------------------------------------------------------------

export interface PublishOptions extends ExportOptions {
  slug: string
  onProgress?: PublishProgress
  fetchImpl?: FetchLike
  /** Builds the link-preview image; defaults to a canvas render of page 1. */
  shareImage?: (project: ProjectState) => Promise<Uint8Array | null>
  /** GitHub API base URL (tests point this at a fake server). */
  apiBase?: string
}

export interface PublishResult {
  url: string
  slug: string
  commit: string
  uploaded: number
  unchanged: number
  removed: number
}

async function readCatalog(repo: GitHubRepo, rootEntries: TreeEntry[], title: string): Promise<Catalog> {
  const entry = rootEntries.find((candidate) => candidate.path === 'catalog.json' && candidate.type === 'blob')
  if (entry?.sha) {
    try {
      const parsed = JSON.parse(await repo.readBlobText(entry.sha)) as Partial<Catalog>
      if (parsed && Array.isArray(parsed.books)) return { version: 1, title, books: parsed.books.filter((book) => book && typeof book.slug === 'string') }
    } catch {
      // A damaged catalogue is rebuilt from this publish onward.
    }
  }
  return { version: 1, title, books: [] }
}

async function existingFolder(repo: GitHubRepo, rootEntries: TreeEntry[], slug: string, rootTree?: string): Promise<Map<string, string>> {
  if (!slug) {
    // Single-publication site: the publication is everything except the repository's own files.
    const files = new Map<string, string>()
    if (!rootTree) return files
    const { entries, truncated } = await repo.tree(rootTree, true)
    if (truncated) throw new PublishError('The website repository has too many files to update safely. Use an empty repository for this catalogue.')
    for (const entry of entries) if (entry.type === 'blob' && entry.sha && !REPO_FILES.test(entry.path)) files.set(entry.path, entry.sha)
    return files
  }
  const folder = rootEntries.find((entry) => entry.path === slug && entry.type === 'tree')
  const files = new Map<string, string>()
  if (!folder?.sha) return files
  const { entries, truncated } = await repo.tree(folder.sha, true)
  if (truncated) throw new PublishError(`The online folder “${slug}” has too many files to update safely. Unpublish it and publish again.`)
  for (const entry of entries) if (entry.type === 'blob' && entry.sha) files.set(`${slug}/${entry.path}`, entry.sha)
  return files
}

function siteFiles(catalog: Catalog, settings: PublishSettings): TreeEntry[] {
  const text = (path: string, content: string) => ({ path, mode: '100644', type: 'blob' as const, content }) as unknown as TreeEntry
  if (settings.layout === 'single') {
    return [text('404.html', NOT_FOUND_HTML.replace('__HOME__', escapeHtml(`${normalizeSiteUrl(settings.siteUrl)}/`)).replace('See all publications', 'Open the catalogue')), text('.nojekyll', '')]
  }
  return [
    text('catalog.json', JSON.stringify(catalog, null, 2) + '\n'),
    text('index.html', buildSiteIndexHtml(catalog, settings.siteUrl)),
    text('404.html', NOT_FOUND_HTML.replace('__HOME__', escapeHtml(`${normalizeSiteUrl(settings.siteUrl)}/`))),
    // GitHub Pages: serve files as-is (no Jekyll processing).
    text('.nojekyll', ''),
  ]
}

/**
 * Publishes (or republishes) one publication into <slug>/ of the repository and
 * refreshes the site home page. Unchanged files are not uploaded again.
 */
export async function publishBook(settings: PublishSettings, project: ProjectState, options: PublishOptions): Promise<PublishResult> {
  const single = settings.layout === 'single'
  const slugError = single ? '' : validateSlug(options.slug)
  if (slugError) throw new PublishError(slugError)
  if (!settingsComplete(settings)) throw new PublishError('Publishing is not set up yet. Fill in the GitHub and website details first.')
  const progress = options.onProgress ?? (() => undefined)
  const repo = new GitHubRepo(settings, options.fetchImpl, options.apiBase)
  const slug = single ? '' : options.slug
  const url = bookUrl(settings, slug)

  progress('Preparing pages and images…')
  const { files } = await buildPublicationFiles(project, {
    loadFont: options.loadFont,
    onWarning: options.onWarning,
    meta: {
      description: project.description || `${project.title} — interactive flipbook`,
      keywords: project.keywords,
      url,
      image: `${url}cover.jpg`,
      siteName: settings.siteTitle,
    },
  })
  const share = await (options.shareImage ?? makeShareImage)(project)
  const coverFile: PublicationFile | undefined = share
    ? { path: 'cover.jpg', data: share }
    : files.find((file) => file.path.startsWith('pages/page-001.'))
  if (coverFile) files.push({ path: 'cover.jpg', data: coverFile.data })

  const bytes = files.map((file) => ({ path: slug ? `${slug}/${file.path}` : file.path, bytes: toBytes(file.data) }))
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await commitPublication(repo, settings, project, slug, url, bytes, progress)
    } catch (error) {
      // Someone else updated the site at the same moment: start again from the new version once.
      if (attempt < 2 && error instanceof PublishError && error.status === 422) continue
      throw error
    }
  }
}

async function commitPublication(
  repo: GitHubRepo,
  settings: PublishSettings,
  project: ProjectState,
  slug: string,
  url: string,
  wanted: Array<{ path: string; bytes: Uint8Array }>,
  progress: PublishProgress,
): Promise<PublishResult> {
  progress('Connecting to GitHub…')
  const head = await repo.head()
  const root = await repo.tree(head.tree)
  const previous = await existingFolder(repo, root.entries, slug, head.tree)
  const catalog = await readCatalog(repo, root.entries, settings.siteTitle)

  let done = 0
  let uploaded = 0
  let unchanged = 0
  const entries: TreeEntry[] = await mapLimit(wanted, 4, async (file) => {
    const sha = await gitBlobSha(file.bytes)
    if (previous.get(file.path) === sha) {
      unchanged += 1
    } else {
      const created = await repo.createBlob(file.bytes)
      if (created !== sha) throw new PublishError(`GitHub stored ${file.path} differently than expected. Publish again.`)
      uploaded += 1
    }
    done += 1
    progress(`Uploading files… ${done} of ${wanted.length}`, done, wanted.length)
    return { path: file.path, mode: '100644', type: 'blob', sha }
  })
  const site = siteFiles(catalog, settings)
  const keep = new Set([...wanted.map((file) => file.path), ...site.map((file) => file.path)])
  const removed = [...previous.keys()].filter((path) => !keep.has(path))
  for (const path of removed) entries.push({ path, mode: '100644', type: 'blob', sha: null })

  const entry: CatalogEntry = {
    slug,
    title: project.title,
    description: project.description ?? '',
    category: project.category ?? '',
    keywords: project.keywords ?? '',
    pageCount: project.pages.length,
    updatedAt: new Date().toISOString(),
  }
  catalog.books = [entry, ...catalog.books.filter((book) => book.slug !== slug)]
  entries.push(...(settings.layout === 'single' ? site : siteFiles(catalog, settings)))

  progress('Saving the new version online…')
  const commit = await repo.commitTree(head, entries, `${previous.size ? 'Update' : 'Publish'} “${project.title}”`)
  progress('Published')
  return { url, slug, commit, uploaded, unchanged, removed: removed.length }
}

/** Removes a publication's folder from the website and from the site home page. */
export async function unpublishBook(settings: PublishSettings, slug: string, options: { fetchImpl?: FetchLike; apiBase?: string; onProgress?: PublishProgress } = {}): Promise<{ commit: string; removed: number }> {
  if (!settingsComplete(settings)) throw new PublishError('Publishing is not set up yet.')
  const repo = new GitHubRepo(settings, options.fetchImpl, options.apiBase)
  options.onProgress?.('Connecting to GitHub…')
  const head = await repo.head()
  const root = await repo.tree(head.tree)
  const single = settings.layout === 'single'
  const previous = await existingFolder(repo, root.entries, single ? '' : slug, head.tree)
  const catalog = await readCatalog(repo, root.entries, settings.siteTitle)
  catalog.books = catalog.books.filter((book) => book.slug !== slug)
  const site = single ? [] : siteFiles(catalog, settings)
  const keep = new Set(site.map((file) => file.path))
  const entries: TreeEntry[] = [...previous.keys()].filter((path) => !keep.has(path)).map((path) => ({ path, mode: '100644', type: 'blob', sha: null }))
  entries.push(...site)
  options.onProgress?.('Removing it from the website…')
  const commit = await repo.commitTree(head, entries, `Unpublish ${slug || 'catalogue'}`)
  return { commit, removed: previous.size }
}

/** Slugs that are already online (from the site catalogue), for "this link is taken" checks. */
export async function onlineSlugs(settings: PublishSettings, fetchImpl?: FetchLike, apiBase?: string): Promise<string[]> {
  const repo = new GitHubRepo(settings, fetchImpl, apiBase)
  const head = await repo.currentHead()
  if (!head) return []
  const root = await repo.tree(head.tree)
  return root.entries.filter((entry) => entry.type === 'tree' && !RESERVED.has(entry.path)).map((entry) => entry.path)
}

/** WhatsApp share link for a publication. */
export function whatsappShareUrl(title: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${title}\n${url}`)}`
}

// ---------------------------------------------------------------------------
// Easy setup: GitHub Pages (free) with one access key
// ---------------------------------------------------------------------------

export const DEFAULT_SITE_REPO = 'flipbooks'

/** github.com/new pre-filled for the website repository. */
export function newRepoUrl(repo = DEFAULT_SITE_REPO, visibility: 'public' | 'private' = 'public'): string {
  return `https://github.com/new?name=${encodeURIComponent(repo)}&visibility=${visibility}&description=${encodeURIComponent('Online flipbooks published with FlipStudio Pro')}`
}

/** A Cloudflare Pages project name (it becomes <name>.pages.dev): lowercase letters, digits and dashes, max 58. */
export function pagesProjectName(value: string): string {
  return slugify(value).slice(0, 58).replace(/-+$/g, '')
}

/** Fine-grained token page pre-filled with exactly the permissions publishing needs. */
export function newTokenUrl(owner = ''): string {
  const params = new URLSearchParams({ name: 'FlipStudio Pro publishing', description: 'Publishes flipbooks to the website repository', expires_in: '366', contents: 'write', pages: 'write' })
  if (owner.trim()) params.set('target_name', owner.trim())
  return `https://github.com/settings/personal-access-tokens/new?${params.toString()}`
}

/**
 * One-step setup: with only an access key, finds the account and the website
 * repository, creates its first commit if it is empty, switches on GitHub Pages
 * and returns complete publishing settings (website address included).
 */
export async function connectGitHubPages(
  token: string,
  options: { repo?: string; owner?: string; siteTitle?: string; fetchImpl?: FetchLike; apiBase?: string; onProgress?: PublishProgress } = {},
): Promise<PublishSettings> {
  const api = options.apiBase ?? 'https://api.github.com'
  const repoName = (options.repo || DEFAULT_SITE_REPO).trim()
  const probe = new GitHubRepo({ ...EMPTY_SETTINGS, token, owner: options.owner || 'x', repo: repoName }, options.fetchImpl, api)
  options.onProgress?.('Checking the access key…')
  let owner = (options.owner ?? '').trim()
  if (!owner) {
    const { data } = await probe.request<{ login: string }>('GET', `${api}/user`)
    owner = data.login
  }
  let settings: PublishSettings = { ...EMPTY_SETTINGS, token: token.trim(), owner, repo: repoName, siteTitle: options.siteTitle?.trim() || EMPTY_SETTINGS.siteTitle, siteUrl: `https://${owner.toLowerCase()}.github.io/${repoName}` }
  const repo = new GitHubRepo(settings, options.fetchImpl, api)
  options.onProgress?.(`Opening ${owner}/${repoName}…`)
  let info: { private: boolean; defaultBranch: string }
  try {
    info = await repo.checkAccess()
  } catch (error) {
    if (error instanceof PublishError && error.status === 404) {
      throw new PublishError(`The repository ${owner}/${repoName} was not found, or the access key can't see it. Create it first (button 1), and when creating the key choose “Only select repositories” → ${repoName}.`, 404)
    }
    throw error
  }
  settings = { ...settings, branch: info.defaultBranch || 'main' }
  const ready = new GitHubRepo(settings, options.fetchImpl, api)
  options.onProgress?.('Preparing the website…')
  await ready.head()
  options.onProgress?.('Switching on GitHub Pages…')
  let pages = await ready.request<{ html_url?: string }>('GET', '/pages', undefined, [404])
  if (pages.status === 404) {
    try {
      pages = await ready.request<{ html_url?: string }>('POST', '/pages', { source: { branch: settings.branch, path: '/' } }, [409])
      if (pages.status === 409) pages = await ready.request<{ html_url?: string }>('GET', '/pages')
    } catch (error) {
      if (error instanceof PublishError && info.private) {
        throw new PublishError(`GitHub Pages needs ${owner}/${repoName} to be public on a free account. On GitHub open the repository → Settings → Change visibility → Public, then click Connect again.`, error.status)
      }
      if (error instanceof PublishError && (error.status === 403 || error.status === 404)) {
        throw new PublishError('The access key can’t switch on GitHub Pages. Create the key again with the button above (it asks for “Pages: Read and write”).', error.status)
      }
      throw error
    }
  }
  const siteUrl = normalizeSiteUrl(pages.data?.html_url || settings.siteUrl)
  return { ...settings, siteUrl }
}
