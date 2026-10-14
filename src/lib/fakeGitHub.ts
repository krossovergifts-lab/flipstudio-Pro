// In-memory stand-in for the parts of the GitHub REST API the publisher uses.
// Test-only: it computes real git blob SHAs so change detection is exercised.
// Self-contained (no app imports) so browser end-to-end tests can bundle it on its own.
async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`)
  const joined = new Uint8Array(header.length + bytes.length)
  joined.set(header, 0)
  joined.set(bytes, header.length)
  const digest = await crypto.subtle.digest('SHA-1', joined)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

type Files = Map<string, string>

export interface FakeGitHub {
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  /** Files on the branch head: path → text (binary files as "<n bytes>"). */
  files(): Record<string, string>
  fileBytes(path: string): Uint8Array | undefined
  commits: string[]
  calls: string[]
  blobUploads: number
  /** Simulates someone else committing between our read and our ref update. */
  raceOnce: boolean
}

export async function createFakeGitHub(options: { empty?: boolean; token?: string; login?: string; missingRepo?: boolean; private?: boolean } = {}): Promise<FakeGitHub> {
  let pagesOn = false
  const blobs = new Map<string, Uint8Array>()
  const trees = new Map<string, Files>()
  const commitTrees = new Map<string, string>()
  let head: string | null = null
  let counter = 0
  const id = (prefix: string) => `${prefix}${(++counter).toString(16).padStart(8, '0')}`
  const decoder = new TextDecoder()

  const json = (status: number, body: unknown) => new Response(body === null ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const b64 = (bytes: Uint8Array) => {
    let binary = ''
    bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
    return btoa(binary)
  }
  const unb64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0))

  const putBlob = async (bytes: Uint8Array) => {
    const sha = await gitBlobSha(bytes)
    blobs.set(sha, bytes)
    return sha
  }
  const commit = (files: Files, parent: string | null) => {
    const treeId = id('tree')
    trees.set(treeId, files)
    const sha = id('c0mm1t')
    commitTrees.set(sha, treeId)
    void parent
    return sha
  }

  const fake: FakeGitHub = {
    commits: [],
    calls: [],
    blobUploads: 0,
    raceOnce: false,
    files() {
      const out: Record<string, string> = {}
      if (!head) return out
      for (const [path, sha] of trees.get(commitTrees.get(head)!)!) {
        const bytes = blobs.get(sha)!
        out[path] = /\.(html|json|md|txt)$|^\.nojekyll$|\/\.nojekyll$/.test(path) ? decoder.decode(bytes) : `<${bytes.length} bytes>`
      }
      return out
    },
    fileBytes(path) {
      if (!head) return undefined
      const sha = trees.get(commitTrees.get(head)!)!.get(path)
      return sha ? blobs.get(sha) : undefined
    },
    async fetch(input, init = {}) {
      const method = (init.method ?? 'GET').toUpperCase()
      const url = new URL(input)
      const path = url.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '')
      fake.calls.push(`${method} ${path}${url.search}`)
      const auth = new Headers(init.headers).get('Authorization')
      if (auth !== `Bearer ${options.token ?? 'good-token'}`) return json(401, { message: 'Bad credentials' })
      const body = init.body ? JSON.parse(String(init.body)) : undefined

      if (method === 'GET' && url.pathname === '/user') return json(200, { login: options.login ?? 'krossovergifts-lab' })
      if (options.missingRepo) return json(404, { message: 'Not Found' })
      if (method === 'GET' && path === '') return json(200, { private: options.private ?? true, default_branch: 'main', html_url: 'https://github.com/o/r', permissions: { push: true } })
      if (path === '/pages') {
        const repoName = url.pathname.split('/')[3]
        const owner = url.pathname.split('/')[2]
        const html = { html_url: `https://${owner.toLowerCase()}.github.io/${repoName}/` }
        if (method === 'GET') return pagesOn ? json(200, html) : json(404, { message: 'Not Found' })
        if (method === 'POST') {
          if (options.private) return json(422, { message: 'Your current plan does not support GitHub Pages for this repository.' })
          if (!head) return json(422, { message: 'The main branch must exist before GitHub Pages can build.' })
          pagesOn = true
          return json(201, html)
        }
      }
      if (method === 'GET' && path === '/git/ref/heads/main') {
        if (!head) return json(409, { message: 'Git Repository is empty.' })
        return json(200, { object: { sha: head } })
      }
      if (method === 'PUT' && path.startsWith('/contents/')) {
        const files: Files = new Map(head ? trees.get(commitTrees.get(head)!)! : [])
        files.set(decodeURIComponent(path.slice('/contents/'.length)), await putBlob(unb64(body.content)))
        head = commit(files, head)
        fake.commits.push(body.message)
        return json(201, { commit: { sha: head } })
      }
      let match = /^\/git\/commits\/(.+)$/.exec(path)
      if (method === 'GET' && match) return json(200, { tree: { sha: commitTrees.get(match[1]) } })
      match = /^\/git\/trees\/(.+)$/.exec(path)
      if (method === 'GET' && match) {
        const [treeId, dir] = match[1].split(':')
        const files = trees.get(treeId)
        if (!files) return json(404, { message: 'Not Found' })
        const recursive = url.searchParams.get('recursive') === '1'
        const prefix = dir ? dir + '/' : ''
        const entries: Array<{ path: string; type: string; sha: string; mode: string }> = []
        const dirs = new Set<string>()
        for (const [file, sha] of files) {
          if (!file.startsWith(prefix)) continue
          const rest = file.slice(prefix.length)
          if (!recursive && rest.includes('/')) {
            const name = rest.split('/')[0]
            if (!dirs.has(name)) {
              dirs.add(name)
              entries.push({ path: name, type: 'tree', sha: `${treeId}:${prefix}${name}`, mode: '040000' })
            }
            continue
          }
          entries.push({ path: rest, type: 'blob', sha, mode: '100644' })
        }
        return json(200, { tree: entries, truncated: false })
      }
      match = /^\/git\/blobs\/(.+)$/.exec(path)
      if (method === 'GET' && match) {
        const bytes = blobs.get(match[1])
        return bytes ? json(200, { content: b64(bytes), encoding: 'base64' }) : json(404, { message: 'Not Found' })
      }
      if (method === 'POST' && path === '/git/blobs') {
        fake.blobUploads += 1
        return json(201, { sha: await putBlob(unb64(body.content)) })
      }
      if (method === 'POST' && path === '/git/trees') {
        const files: Files = new Map(trees.get(body.base_tree) ?? [])
        for (const entry of body.tree as Array<{ path: string; sha?: string | null; content?: string }>) {
          if (entry.sha === null) files.delete(entry.path)
          else if (typeof entry.content === 'string') files.set(entry.path, await putBlob(new TextEncoder().encode(entry.content)))
          else if (entry.sha && blobs.has(entry.sha)) files.set(entry.path, entry.sha)
          else return json(422, { message: `Invalid tree entry ${entry.path}` })
        }
        const treeId = id('tree')
        trees.set(treeId, files)
        return json(201, { sha: treeId })
      }
      if (method === 'POST' && path === '/git/commits') {
        const sha = id('c0mm1t')
        commitTrees.set(sha, body.tree)
        fake.commits.push(body.message)
        ;(fake as unknown as { parents: Record<string, string> }).parents ??= {}
        ;(fake as unknown as { parents: Record<string, string> }).parents[sha] = body.parents[0]
        return json(201, { sha })
      }
      if (method === 'PATCH' && path === '/git/refs/heads/main') {
        const parents = (fake as unknown as { parents: Record<string, string> }).parents
        if (fake.raceOnce) {
          fake.raceOnce = false
          head = commit(new Map(trees.get(commitTrees.get(head!)!)!), head)
        }
        if (parents[body.sha] !== head) return json(422, { message: 'Update is not a fast forward' })
        head = body.sha
        return json(200, { object: { sha: head } })
      }
      return json(404, { message: `Not Found: ${method} ${path}` })
    },
  }
  if (!options.empty) {
    const sha = await putBlob(new TextEncoder().encode('# Site\n'))
    head = commit(new Map([['README.md', sha]]), null)
  }
  return fake
}
