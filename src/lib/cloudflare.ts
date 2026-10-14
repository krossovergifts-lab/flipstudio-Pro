import { isTauri } from '@tauri-apps/api/core'
import { blake3 } from 'hash-wasm'
import { bytesToBase64 } from './project'

/**
 * Cloudflare Pages "direct upload": the app creates the website and uploads the
 * catalogue straight to Cloudflare with one API token — no GitHub repository,
 * no Git connection, no build. Same steps as Cloudflare's own `wrangler pages deploy`.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface CloudflareConnection {
  token: string
  accountId: string
  accountName: string
}

export const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4'
const KEY = 'flipstudio.cloudflare.v1'
const COMPATIBILITY_DATE = '2024-09-23'

export class CloudflareError extends Error {
  status?: number
  code?: number
  constructor(message: string, status?: number, code?: number) {
    super(message)
    this.name = 'CloudflareError'
    this.status = status
    this.code = code
  }
}

export function loadCloudflare(): CloudflareConnection | null {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<CloudflareConnection>) : null
    return parsed?.token && parsed.accountId ? { token: parsed.token, accountId: parsed.accountId, accountName: parsed.accountName ?? '' } : null
  } catch {
    return null
  }
}

export function saveCloudflare(connection: CloudflareConnection | null): void {
  try {
    if (connection) localStorage.setItem(KEY, JSON.stringify(connection))
    else localStorage.removeItem(KEY)
  } catch {
    // Storage unavailable: the connection lasts for this session.
  }
}

/** Desktop: requests go through the app (Cloudflare's API does not allow browser pages to call it). */
async function defaultFetch(input: string, init?: RequestInit): Promise<Response> {
  if (isTauri()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
    return tauriFetch(input, init)
  }
  return fetch(input, init)
}

/** Where to create the API token, and which permissions it needs. */
export const TOKEN_URL = 'https://dash.cloudflare.com/profile/api-tokens'
export const TOKEN_PERMISSIONS = ['Account · Cloudflare Pages · Edit', 'Account · D1 · Edit (for statistics)']

export class CloudflareApi {
  private readonly fetchImpl: FetchLike
  private readonly base: string
  private readonly connection: Pick<CloudflareConnection, 'token' | 'accountId'>
  constructor(connection: Pick<CloudflareConnection, 'token' | 'accountId'>, fetchImpl?: FetchLike, base = CLOUDFLARE_API) {
    this.connection = connection
    this.fetchImpl = fetchImpl ?? defaultFetch
    this.base = base
  }

  async call<T>(path: string, init: RequestInit & { bearer?: string } = {}): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${init.bearer ?? this.connection.token}`)
    if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    let response: Response
    try {
      response = await this.fetchImpl(`${this.base}${path}`, { ...init, headers })
    } catch (err) {
      throw new CloudflareError(`Could not reach Cloudflare (${err instanceof Error ? err.message : String(err)}). Check your internet connection.`)
    }
    let body: { success?: boolean; errors?: Array<{ code: number; message: string }>; result?: T } = {}
    try {
      body = await response.json()
    } catch {
      // Non-JSON answer: handled below.
    }
    if (!response.ok || body.success === false) {
      const first = body.errors?.[0]
      const message = first?.message ?? `Cloudflare answered ${response.status}`
      if (response.status === 401 || first?.code === 10000 || first?.code === 9109) throw new CloudflareError('Cloudflare did not accept the API token. Create a new token (Cloudflare Pages: Edit) and connect again.', response.status, first?.code)
      if (response.status === 403) throw new CloudflareError(`The API token is missing a permission (${message}). Edit the token: Account · Cloudflare Pages · Edit and Account · D1 · Edit.`, response.status, first?.code)
      throw new CloudflareError(message, response.status, first?.code)
    }
    return body.result as T
  }

  private account(path: string) {
    return `/accounts/${encodeURIComponent(this.connection.accountId)}${path}`
  }

  getProject(name: string) {
    return this.call<{ name: string; subdomain: string; domains?: string[] }>(this.account(`/pages/projects/${encodeURIComponent(name)}`))
  }

  /** Creates the website, or returns it when this account already has one with that name. */
  async createProject(name: string): Promise<{ name: string; subdomain: string }> {
    try {
      return await this.call<{ name: string; subdomain: string }>(this.account('/pages/projects'), {
        method: 'POST',
        body: JSON.stringify({ name, production_branch: 'main', deployment_configs: { production: { compatibility_date: COMPATIBILITY_DATE }, preview: { compatibility_date: COMPATIBILITY_DATE } } }),
      })
    } catch (err) {
      if (err instanceof CloudflareError && (err.code === 8000002 || /already exists|taken/i.test(err.message))) {
        const existing = await this.getProject(name).catch(() => null)
        if (existing) return existing
        throw new CloudflareError(`The name “${name}” is already used by another Cloudflare user. Choose a different website name.`, err.status, err.code)
      }
      throw err
    }
  }

  /** The free D1 database for statistics, connected to the website as DB. */
  async ensureStatsDatabase(project: string): Promise<string> {
    const name = `${project}-stats`.slice(0, 60)
    const list = await this.call<Array<{ uuid: string; name: string }>>(this.account(`/d1/database?name=${encodeURIComponent(name)}`))
    let id = list?.find((db) => db.name === name)?.uuid
    if (!id) id = (await this.call<{ uuid: string }>(this.account('/d1/database'), { method: 'POST', body: JSON.stringify({ name }) })).uuid
    const binding = { compatibility_date: COMPATIBILITY_DATE, d1_databases: { DB: { id } } }
    await this.call(this.account(`/pages/projects/${encodeURIComponent(project)}`), { method: 'PATCH', body: JSON.stringify({ deployment_configs: { production: binding, preview: binding } }) })
    return id
  }

  /**
   * Uploads a complete version of the website and makes it live. Files Cloudflare
   * already has (same content) are not uploaded again.
   */
  async deploy(
    project: string,
    files: Array<{ path: string; bytes: Uint8Array }>,
    options: { worker?: string; message?: string; onProgress?: (message: string, done?: number, total?: number) => void } = {},
  ): Promise<{ url: string; uploaded: number; unchanged: number }> {
    const progress = options.onProgress ?? (() => undefined)
    progress('Preparing the upload…')
    const { jwt } = await this.call<{ jwt: string }>(this.account(`/pages/projects/${encodeURIComponent(project)}/upload-token`))
    const entries = await Promise.all(
      files.map(async (file) => {
        const base64 = bytesToBase64(file.bytes)
        const ext = /\.([^./]+)$/.exec(file.path)?.[1] ?? ''
        const hash = (await blake3(base64 + ext)).slice(0, 32)
        return { path: file.path.startsWith('/') ? file.path : `/${file.path}`, hash, base64, size: file.bytes.byteLength, type: contentType(file.path) }
      }),
    )
    const unique = [...new Map(entries.map((entry) => [entry.hash, entry])).values()]
    const missing = new Set<string>()
    for (let i = 0; i < unique.length; i += 1000) {
      const result = await this.call<string[]>('/pages/assets/check-missing', { method: 'POST', bearer: jwt, body: JSON.stringify({ hashes: unique.slice(i, i + 1000).map((entry) => entry.hash) }) })
      for (const hash of result ?? []) missing.add(hash)
    }
    const toUpload = unique.filter((entry) => missing.has(entry.hash))
    let done = 0
    let batch: typeof toUpload = []
    let batchBytes = 0
    const flush = async () => {
      if (!batch.length) return
      await this.call('/pages/assets/upload', { method: 'POST', bearer: jwt, body: JSON.stringify(batch.map((entry) => ({ key: entry.hash, value: entry.base64, metadata: { contentType: entry.type }, base64: true }))) })
      done += batch.length
      progress(`Uploading files… ${done} of ${toUpload.length}`, done, toUpload.length)
      batch = []
      batchBytes = 0
    }
    for (const entry of toUpload) {
      if (entry.size > 25 * 1024 * 1024) throw new CloudflareError(`${entry.path.slice(1)} is larger than 25 MB, the Cloudflare Pages limit for one file. Use a smaller PDF or video.`)
      if (batchBytes + entry.base64.length > 40 * 1024 * 1024 || batch.length >= 500) await flush()
      batch.push(entry)
      batchBytes += entry.base64.length
    }
    await flush()
    await this.call('/pages/assets/upsert-hashes', { method: 'POST', bearer: jwt, body: JSON.stringify({ hashes: unique.map((entry) => entry.hash) }) })
    progress('Making the new version live…')
    const form = new FormData()
    form.append('manifest', JSON.stringify(Object.fromEntries(entries.map((entry) => [entry.path, entry.hash]))))
    form.append('branch', 'main')
    if (options.message) form.append('commit_message', options.message.slice(0, 380))
    if (options.worker) form.append('_worker.js', new Blob([options.worker], { type: 'application/javascript' }), '_worker.js')
    const deployment = await this.call<{ url?: string }>(this.account(`/pages/projects/${encodeURIComponent(project)}/deployments`), { method: 'POST', body: form })
    return { url: deployment?.url ?? '', uploaded: toUpload.length, unchanged: unique.length - toUpload.length }
  }
}

const TYPES: Record<string, string> = {
  html: 'text/html', css: 'text/css', js: 'application/javascript', json: 'application/json', xml: 'application/xml', txt: 'text/plain',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif',
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf', pdf: 'application/pdf',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
}

export function contentType(path: string): string {
  return TYPES[(/\.([^./]+)$/.exec(path)?.[1] ?? '').toLowerCase()] ?? 'application/octet-stream'
}

/** Checks the token and finds the account it belongs to. */
export async function connectCloudflare(token: string, fetchImpl?: FetchLike, base?: string): Promise<CloudflareConnection> {
  const clean = token.trim()
  if (clean.length < 20) throw new CloudflareError('Paste the whole API token (about 40 characters).')
  const probe = new CloudflareApi({ token: clean, accountId: '' }, fetchImpl, base)
  const accounts = await probe.call<Array<{ id: string; name: string }>>('/accounts?per_page=50')
  if (!accounts?.length) throw new CloudflareError('This token cannot see any Cloudflare account. When creating it, set Account Resources to “Include · All accounts” (or your account).')
  const account = accounts[0]
  const api = new CloudflareApi({ token: clean, accountId: account.id }, fetchImpl, base)
  await api.call(`/accounts/${account.id}/pages/projects?per_page=1`)
  return { token: clean, accountId: account.id, accountName: account.name }
}

/** Valid Cloudflare Pages project name (also the address: <name>.pages.dev). */
export function pagesName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-').slice(0, 58).replace(/-+$/g, '')
}
