import { blake3 } from 'hash-wasm'

/**
 * In-memory stand-in for the parts of the Cloudflare API the app uses (accounts,
 * Pages projects, direct upload, D1), for tests. `site(project)` returns what the
 * live website would serve.
 */
export interface FakeCloudflare {
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  projects: Map<string, { name: string; subdomain: string; config: Record<string, unknown>; deployments: number }>
  /** Files of the latest deployment: path → bytes. */
  site(project: string): Map<string, Uint8Array>
  worker(project: string): string | undefined
  uploads: number
  databases: Map<string, string>
  badHashes: string[]
}

const TOKEN = 'cf-test-token-0123456789abcdef0123456789'

export function createFakeCloudflare(options: { taken?: string[] } = {}): FakeCloudflare {
  const assets = new Map<string, { base64: string }>()
  const deployments = new Map<string, { manifest: Record<string, string>; worker?: string }>()
  const projects: FakeCloudflare['projects'] = new Map()
  const databases = new Map<string, string>()
  const state = { uploads: 0, badHashes: [] as string[] }
  const ok = (result: unknown, status = 200) => new Response(JSON.stringify({ success: true, errors: [], messages: [], result }), { status, headers: { 'content-type': 'application/json' } })
  const fail = (status: number, code: number, message: string) => new Response(JSON.stringify({ success: false, errors: [{ code, message }], messages: [], result: null }), { status, headers: { 'content-type': 'application/json' } })

  const handle = async (url: URL, method: string, headers: Headers, body: BodyInit | null | undefined): Promise<Response> => {
    const auth = headers.get('authorization') ?? ''
    const path = url.pathname.replace(/^\/client\/v4/, '')
    const jwtAuth = auth.startsWith('Bearer jwt-')
    if (path.startsWith('/pages/assets/')) {
      if (!jwtAuth) return fail(401, 10000, 'Authentication error')
      const json = JSON.parse(String(body))
      if (path === '/pages/assets/check-missing') return ok((json.hashes as string[]).filter((hash) => !assets.has(hash)))
      if (path === '/pages/assets/upload') {
        for (const item of json as Array<{ key: string; value: string; base64: boolean }>) { assets.set(item.key, { base64: item.value }); state.uploads += 1 }
        return ok(null)
      }
      if (path === '/pages/assets/upsert-hashes') return ok(null)
    }
    if (auth !== `Bearer ${TOKEN}`) return fail(401, 10000, 'Authentication error')
    if (path === '/accounts') return ok([{ id: 'acc-1', name: 'Krossovergifts@gmail.com’s Account' }])
    const m = path.match(/^\/accounts\/acc-1(\/.*)$/)
    if (!m) return fail(404, 7003, 'Could not route')
    const rest = m[1]
    if (rest === '/pages/projects' && method === 'GET') return ok([...projects.values()])
    if (rest === '/pages/projects' && method === 'POST') {
      const { name, deployment_configs } = JSON.parse(String(body))
      if (projects.has(name)) return fail(409, 8000002, 'A project with this name already exists.')
      const subdomain = options.taken?.includes(name) ? `${name}-4xk.pages.dev` : `${name}.pages.dev`
      projects.set(name, { name, subdomain, config: deployment_configs, deployments: 0 })
      return ok(projects.get(name))
    }
    const p = rest.match(/^\/pages\/projects\/([^/]+)(\/.*)?$/)
    if (p) {
      const project = projects.get(decodeURIComponent(p[1]))
      if (!project) return fail(404, 8000007, 'Project not found')
      if (!p[2] && method === 'GET') return ok(project)
      if (!p[2] && method === 'PATCH') { project.config = { ...project.config, ...JSON.parse(String(body)).deployment_configs }; return ok(project) }
      if (p[2] === '/upload-token') return ok({ jwt: `jwt-${project.name}` })
      if (p[2] === '/deployments' && method === 'POST') {
        const form = body as FormData
        const manifest = JSON.parse(String(form.get('manifest'))) as Record<string, string>
        for (const [file, hash] of Object.entries(manifest)) {
          const asset = assets.get(hash)
          const ext = /\.([^./]+)$/.exec(file)?.[1] ?? ''
          if (!asset || (await blake3(asset.base64 + ext)).slice(0, 32) !== hash) state.badHashes.push(file)
        }
        const worker = form.get('_worker.js')
        deployments.set(project.name, { manifest, worker: worker instanceof Blob ? await worker.text() : undefined })
        project.deployments += 1
        return ok({ id: `dep-${project.deployments}`, url: `https://dep-${project.deployments}.${project.subdomain}` })
      }
    }
    if (rest.startsWith('/d1/database')) {
      if (method === 'GET') { const name = url.searchParams.get('name') ?? ''; return ok(databases.has(name) ? [{ uuid: databases.get(name), name }] : []) }
      const { name } = JSON.parse(String(body))
      databases.set(name, `db-${databases.size + 1}`)
      return ok({ uuid: databases.get(name), name })
    }
    return fail(404, 7003, `No route for ${method} ${path}`)
  }

  return {
    async fetch(input, init = {}) {
      return handle(new URL(input), (init.method ?? 'GET').toUpperCase(), new Headers(init.headers), init.body)
    },
    projects,
    databases,
    get uploads() { return state.uploads },
    get badHashes() { return state.badHashes },
    site(project) {
      const files = new Map<string, Uint8Array>()
      const deployment = deployments.get(project)
      for (const [file, hash] of Object.entries(deployment?.manifest ?? {})) {
        const binary = atob(assets.get(hash)?.base64 ?? '')
        files.set(file.replace(/^\//, ''), Uint8Array.from(binary, (c) => c.charCodeAt(0)))
      }
      return files
    },
    worker(project) { return deployments.get(project)?.worker },
  }
}

export const FAKE_CLOUDFLARE_TOKEN = TOKEN
