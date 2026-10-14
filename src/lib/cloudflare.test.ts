import { describe, expect, it } from 'vitest'
import { blake3 } from 'hash-wasm'
import { CloudflareApi, connectCloudflare, loadCloudflare, pagesName, saveCloudflare } from './cloudflare'
import { createFakeCloudflare, FAKE_CLOUDFLARE_TOKEN } from './fakeCloudflare'
import { createProject, PROJECT_VERSION } from './project'
import { publishBook, settingsComplete, unpublishBook, EMPTY_SETTINGS, type PublishSettings } from './publish'

const PAGE = 'data:image/jpeg;base64,' + btoa('page-one-jpeg')
const book = (title = 'Gifts 2027') => createProject({ version: PROJECT_VERSION, title, pages: [PAGE, PAGE].map((previewUrl, i) => ({ id: `p${i}`, name: `Page ${i + 1}`, width: 600, height: 800, previewUrl, overlays: [] })) })
const share = async () => new TextEncoder().encode('share')
const noFonts = async () => new Uint8Array()
const decode = (bytes?: Uint8Array) => new TextDecoder().decode(bytes)

describe('Cloudflare direct publishing', () => {
  it('uses real BLAKE3 (the hash Cloudflare files are stored under)', async () => {
    expect(await blake3('')).toBe('af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262')
    expect(await blake3('abc')).toBe('6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85')
  })

  it('connects once, creates websites by name and publishes straight to Cloudflare', async () => {
    const cf = createFakeCloudflare({ taken: ['gifts-2027'] })
    await expect(connectCloudflare('nope-nope-nope-nope-nope', cf.fetch)).rejects.toThrow(/did not accept the API token/)
    const connection = await connectCloudflare(FAKE_CLOUDFLARE_TOKEN, cf.fetch)
    expect(connection.accountId).toBe('acc-1')
    saveCloudflare(connection)
    expect(loadCloudflare()?.token).toBe(FAKE_CLOUDFLARE_TOKEN)

    const api = new CloudflareApi(connection, cf.fetch)
    const created = await api.createProject(pagesName('Gifts 2027!'))
    expect(created.subdomain).toBe('gifts-2027-4xk.pages.dev')
    // Creating it again (same account) reuses it.
    expect((await api.createProject('gifts-2027')).name).toBe('gifts-2027')

    const site: PublishSettings = { ...EMPTY_SETTINGS, layout: 'single', host: 'cloudflare', cfProject: 'gifts-2027', siteUrl: 'https://gifts-2027-4xk.pages.dev', siteTitle: 'Gifts' }
    expect(settingsComplete(site)).toBe(true)
    const first = await publishBook(site, book(), { slug: '', cloudflareFetch: cf.fetch, shareImage: share, loadFont: noFonts })
    expect(first.url).toBe('https://gifts-2027-4xk.pages.dev/')
    expect(cf.badHashes).toEqual([])
    const files = cf.site('gifts-2027')
    expect([...files.keys()].sort()).toEqual(['404.html', 'cover.jpg', 'index.html', 'p/2/index.html', 'pages/page-001.jpg', 'pages/page-002.jpg', 'robots.txt', 'sitemap.xml'])
    expect(decode(files.get('index.html'))).toContain('<title>Gifts 2027</title>')
    expect(cf.worker('gifts-2027')).toBeUndefined()

    // Same content again: nothing is uploaded, only a new deployment.
    const uploads = cf.uploads
    const again = await publishBook(site, book(), { slug: '', cloudflareFetch: cf.fetch, shareImage: share, loadFont: noFonts })
    expect(again.uploaded).toBe(0)
    expect(cf.uploads).toBe(uploads)

    // Statistics: database created and bound, worker deployed with the site.
    await api.ensureStatsDatabase('gifts-2027')
    expect(cf.projects.get('gifts-2027')!.config).toMatchObject({ production: { d1_databases: { DB: { id: 'db-1' } } } })
    await publishBook({ ...site, stats: { key: 'k', keyHash: 'hash123' } }, book('Gifts 2028'), { slug: '', cloudflareFetch: cf.fetch, shareImage: share, loadFont: noFonts })
    expect(cf.worker('gifts-2027')).toContain('const KEY_HASH = "hash123"')
    expect(cf.worker('gifts-2027')).toContain('env.ASSETS.fetch(request)')
    expect(decode(cf.site('gifts-2027').get('index.html'))).toContain('"stats":{"url":"/api/fs-collect"')

    await unpublishBook(site, '', { cloudflareFetch: cf.fetch })
    expect(decode(cf.site('gifts-2027').get('index.html'))).toContain('Catalogue not available')
    saveCloudflare(null)
  })

  it('the generated worker routes statistics and serves the site files', async () => {
    const { statsWorker, sha256Hex } = await import('./stats')
    const code = statsWorker(await sha256Hex('key'))
    const mod = new Function(code.replace('export default', 'return'))() as { fetch: (r: Request, env: unknown) => Promise<Response> }
    const env = { ASSETS: { fetch: async () => new Response('site file') } }
    expect(await (await mod.fetch(new Request('https://x.dev/pages/page-001.jpg'), env)).text()).toBe('site file')
    expect((await mod.fetch(new Request('https://x.dev/api/fs-stats', { headers: { 'x-fs-key': 'wrong' } }), env)).status).toBe(403)
    expect(await (await mod.fetch(new Request('https://x.dev/api/fs-stats', { headers: { 'x-fs-key': 'key' } }), env)).json()).toEqual({ setup: false, rows: [] })
    expect((await mod.fetch(new Request('https://x.dev/api/fs-collect', { method: 'POST', body: '{}' }), env)).status).toBe(204)
  })
})
