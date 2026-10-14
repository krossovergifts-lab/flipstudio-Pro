import { describe, expect, it } from 'vitest'
import { createFakeGitHub } from './fakeGitHub'
import { createProject, PROJECT_VERSION, type ProjectState } from './project'
import {
  buildSiteIndexHtml,
  gitBlobSha,
  normalizeSiteUrl,
  onlineSlugs,
  publishBook,
  PublishError,
  slugify,
  unpublishBook,
  validateSlug,
  whatsappShareUrl,
  connectGitHubPages,
  newTokenUrl,
  loadSites,
  upsertSite,
  pagesProjectName,
  type PublishSettings,
} from './publish'

const API = 'https://api.github.test'
const settings: PublishSettings = {
  owner: 'krossover',
  repo: 'flipbooks',
  branch: 'main',
  token: 'good-token',
  siteUrl: 'books.example.com/',
  siteTitle: 'Krossover catalogues',
}
const PAGE = 'data:image/jpeg;base64,' + btoa('page-one-jpeg')
const PAGE2 = 'data:image/jpeg;base64,' + btoa('page-two-jpeg')

function book(overrides: Partial<ProjectState> = {}, pages = [PAGE, PAGE2]): ProjectState {
  return createProject({
    version: PROJECT_VERSION,
    title: 'Leather Gifts 2027',
    description: 'Hand-stitched corporate gifts',
    category: 'Catalogue',
    keywords: 'leather, gifts',
    pages: pages.map((previewUrl, index) => ({ id: `p${index + 1}`, width: 600, height: 800, previewUrl, overlays: [], text: [{ s: `Text ${index + 1}`, x: 10, y: 10, w: 50, h: 12 }] })),
    ...overrides,
  })
}
const share = async () => new TextEncoder().encode('share-image')
const noFonts = async () => new Uint8Array()

describe('publishing helpers', () => {
  it('makes link-friendly names and validates them', () => {
    expect(slugify('Spring Gifts 2027!')).toBe('spring-gifts-2027')
    expect(slugify('Café & Crème — Menu')).toBe('cafe-and-creme-menu')
    expect(slugify('***')).toBe('publication')
    expect(validateSlug('spring-gifts')).toBe('')
    expect(validateSlug('-bad')).not.toBe('')
    expect(validateSlug('Upper')).not.toBe('')
    expect(validateSlug('assets')).toContain('reserved')
  })

  it('normalises the website address', () => {
    expect(normalizeSiteUrl('books.example.com/')).toBe('https://books.example.com')
    expect(normalizeSiteUrl('https://krossover.github.io/flipbooks/')).toBe('https://krossover.github.io/flipbooks')
    expect(normalizeSiteUrl('localhost')).toBe('')
    expect(normalizeSiteUrl('')).toBe('')
  })

  it('computes the same blob SHA as git', async () => {
    // `printf 'hello\n' | git hash-object --stdin`
    expect(await gitBlobSha(new TextEncoder().encode('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
  })

  it('builds a WhatsApp share link', () => {
    expect(whatsappShareUrl('Gifts', 'https://x.com/gifts/')).toBe('https://wa.me/?text=Gifts%0Ahttps%3A%2F%2Fx.com%2Fgifts%2F')
  })

  it('escapes publication details on the site home page', () => {
    const html = buildSiteIndexHtml({ version: 1, title: 'Shelf', books: [{ slug: 'a', title: '<script>x</script>', description: '', category: 'Menu', keywords: '', pageCount: 1, updatedAt: '2026-01-01' }] }, 'https://s.com')
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(html).toContain('href="./a/"')
  })
})

describe('publishBook (against a fake GitHub)', () => {
  it('publishes a publication into its own folder with link previews and a site home page', async () => {
    const github = await createFakeGitHub({ empty: true })
    const result = await publishBook(settings, book(), { slug: 'leather-gifts-2027', fetchImpl: github.fetch, apiBase: API, shareImage: share, loadFont: noFonts })
    expect(result.url).toBe('https://books.example.com/leather-gifts-2027/')
    const files = github.files()
    expect(Object.keys(files).sort()).toEqual([
      '.nojekyll',
      '404.html',
      'README.md',
      'catalog.json',
      'index.html',
      'leather-gifts-2027/cover.jpg',
      'leather-gifts-2027/index.html',
      'leather-gifts-2027/pages/page-001.jpg',
      'leather-gifts-2027/pages/page-002.jpg',
    ])
    const page = files['leather-gifts-2027/index.html']
    expect(page).toContain('<meta property="og:title" content="Leather Gifts 2027" />')
    expect(page).toContain('<meta property="og:image" content="https://books.example.com/leather-gifts-2027/cover.jpg" />')
    expect(page).toContain('<meta property="og:description" content="Hand-stitched corporate gifts" />')
    expect(page).toContain('<link rel="canonical" href="https://books.example.com/leather-gifts-2027/" />')
    expect(page).toContain('"pages/page-001.jpg"')
    expect(page).toContain('"Text 1"')
    // The editable project is never put online.
    expect(page).not.toContain('flipstudio.json')
    expect(new TextDecoder().decode(github.fileBytes('leather-gifts-2027/cover.jpg'))).toBe('share-image')
    expect(JSON.parse(files['catalog.json']).books.map((b: { slug: string }) => b.slug)).toEqual(['leather-gifts-2027'])
    expect(files['index.html']).toContain('Krossover catalogues')
    expect(files['index.html']).toContain('href="./leather-gifts-2027/"')
    // The token never ends up in published files.
    expect(Object.values(files).join('\n')).not.toContain('good-token')
  })

  it('republishing uploads only changed files and removes deleted pages', async () => {
    const github = await createFakeGitHub()
    await publishBook(settings, book(), { slug: 'gifts', fetchImpl: github.fetch, apiBase: API, shareImage: share, loadFont: noFonts })
    const uploadsAfterFirst = github.blobUploads
    const again = await publishBook(settings, book(), { slug: 'gifts', fetchImpl: github.fetch, apiBase: API, shareImage: share, loadFont: noFonts })
    expect(again.uploaded).toBe(0)
    expect(github.blobUploads).toBe(uploadsAfterFirst)

    const shorter = await publishBook(settings, book({}, [PAGE]), { slug: 'gifts', fetchImpl: github.fetch, apiBase: API, shareImage: share, loadFont: noFonts })
    expect(shorter.removed).toBe(1)
    expect(shorter.uploaded).toBe(1) // only index.html changed
    expect(github.files()['gifts/pages/page-002.jpg']).toBeUndefined()
    expect(github.commits.at(-1)).toBe('Update “Leather Gifts 2027”')
  })

  it('keeps other publications and lists them on the home page; unpublish removes one', async () => {
    const github = await createFakeGitHub()
    await publishBook(settings, book(), { slug: 'gifts', fetchImpl: github.fetch, apiBase: API, shareImage: share, loadFont: noFonts })
    await publishBook(settings, book({ title: 'Office Menu', category: 'Menu' }), { slug: 'menu', fetchImpl: github.fetch, apiBase: API, shareImage: share, loadFont: noFonts })
    expect(JSON.parse(github.files()['catalog.json']).books.map((b: { slug: string }) => b.slug)).toEqual(['menu', 'gifts'])
    expect(await onlineSlugs(settings, github.fetch, API)).toEqual(['gifts', 'menu'])

    const removed = await unpublishBook(settings, 'gifts', { fetchImpl: github.fetch, apiBase: API })
    expect(removed.removed).toBe(4)
    const files = github.files()
    expect(Object.keys(files).some((path) => path.startsWith('gifts/'))).toBe(false)
    expect(files['menu/index.html']).toBeTruthy()
    expect(files['index.html']).not.toContain('./gifts/')
    expect(files['index.html']).toContain('Office Menu')
  })

  it('retries once when the site changed during publishing', async () => {
    const github = await createFakeGitHub()
    github.raceOnce = true
    const result = await publishBook(settings, book(), { slug: 'gifts', fetchImpl: github.fetch, apiBase: API, shareImage: share, loadFont: noFonts })
    expect(result.url).toContain('/gifts/')
    expect(github.files()['gifts/index.html']).toBeTruthy()
  })

  it('explains a rejected token and refuses incomplete settings or bad link names', async () => {
    const github = await createFakeGitHub()
    await expect(publishBook({ ...settings, token: 'wrong' }, book(), { slug: 'gifts', fetchImpl: github.fetch, apiBase: API, shareImage: share, loadFont: noFonts })).rejects.toThrow(/rejected the access token/)
    await expect(publishBook({ ...settings, siteUrl: '' }, book(), { slug: 'gifts', fetchImpl: github.fetch, apiBase: API })).rejects.toBeInstanceOf(PublishError)
    await expect(publishBook(settings, book(), { slug: 'Bad Slug', fetchImpl: github.fetch, apiBase: API })).rejects.toThrow(/lowercase/)
  })

  it('reports network failures in plain words', async () => {
    const offline = async () => { throw new TypeError('Failed to fetch') }
    await expect(publishBook(settings, book(), { slug: 'gifts', fetchImpl: offline, apiBase: API, shareImage: share, loadFont: noFonts })).rejects.toThrow(/Could not reach GitHub/)
  })
})

describe('one-step GitHub Pages setup', () => {
  it('finds the account, prepares an empty repository, switches on Pages and returns the website address', async () => {
    const github = await createFakeGitHub({ empty: true, private: false })
    const result = await connectGitHubPages('good-token', { siteTitle: 'Krossover', fetchImpl: github.fetch, apiBase: API })
    expect(result).toMatchObject({ owner: 'krossovergifts-lab', repo: 'flipbooks', branch: 'main', siteUrl: 'https://krossovergifts-lab.github.io/flipbooks', siteTitle: 'Krossover' })
    expect(github.calls).toContain('POST /pages')
    // Connecting again is harmless and publishing works straight away.
    expect((await connectGitHubPages('good-token', { fetchImpl: github.fetch, apiBase: API })).siteUrl).toBe('https://krossovergifts-lab.github.io/flipbooks')
    const published = await publishBook(result, book(), { slug: 'gifts', fetchImpl: github.fetch, apiBase: API, shareImage: share, loadFont: noFonts })
    expect(published.url).toBe('https://krossovergifts-lab.github.io/flipbooks/gifts/')
    expect(github.files()['404.html']).toContain('href="https://krossovergifts-lab.github.io/flipbooks/"')
  })

  it('explains a missing repository, a private repository and a bad key', async () => {
    await expect(connectGitHubPages('good-token', { fetchImpl: (await createFakeGitHub({ missingRepo: true })).fetch, apiBase: API })).rejects.toThrow(/Create it first/)
    await expect(connectGitHubPages('good-token', { fetchImpl: (await createFakeGitHub({ private: true })).fetch, apiBase: API })).rejects.toThrow(/to be public/)
    await expect(connectGitHubPages('nope', { fetchImpl: (await createFakeGitHub()).fetch, apiBase: API })).rejects.toThrow(/rejected the access token/)
  })

  it('pre-fills the access key page with only the permissions publishing needs', () => {
    const url = new URL(newTokenUrl('krossovergifts-lab'))
    expect(url.pathname).toBe('/settings/personal-access-tokens/new')
    expect(url.searchParams.get('contents')).toBe('write')
    expect(url.searchParams.get('pages')).toBe('write')
    expect(url.searchParams.get('target_name')).toBe('krossovergifts-lab')
  })
})

describe('brand-free single-catalogue website', () => {
  const single: PublishSettings = { ...settings, repo: 'catalogue-2027', siteUrl: 'https://promotionalgifts-catalogue-2027.pages.dev', layout: 'single' }

  it('puts the publication at the root of its own website', async () => {
    const github = await createFakeGitHub()
    const result = await publishBook(single, book(), { slug: 'ignored', fetchImpl: github.fetch, apiBase: API, shareImage: share, loadFont: noFonts })
    expect(result.url).toBe('https://promotionalgifts-catalogue-2027.pages.dev/')
    const files = github.files()
    expect(Object.keys(files).sort()).toEqual(['.nojekyll', '404.html', 'README.md', 'cover.jpg', 'index.html', 'pages/page-001.jpg', 'pages/page-002.jpg'])
    expect(files['index.html']).toContain('<meta property="og:image" content="https://promotionalgifts-catalogue-2027.pages.dev/cover.jpg" />')
    expect(files['index.html']).not.toContain('krossover')
    expect(files['404.html']).toContain('Open the catalogue')

    // A new version with fewer pages removes the old page; the repository README stays.
    const again = await publishBook(single, book({}, [PAGE]), { slug: '', fetchImpl: github.fetch, apiBase: API, shareImage: share, loadFont: noFonts })
    expect(again.removed).toBe(1)
    expect(github.files()['pages/page-002.jpg']).toBeUndefined()
    expect(github.files()['README.md']).toBeTruthy()

    const gone = await unpublishBook(single, '', { fetchImpl: github.fetch, apiBase: API })
    expect(gone.removed).toBeGreaterThan(0)
    expect(Object.keys(github.files())).toEqual(['README.md'])
  })

  it('keeps several websites and migrates the earlier single setting', () => {
    window.localStorage.clear()
    window.localStorage.setItem('flipstudio.publish.v1', JSON.stringify(settings))
    const [migrated] = loadSites()
    expect(migrated).toMatchObject({ repo: 'flipbooks', layout: 'shelf', id: 'site-main' })
    const added = upsertSite({ ...single, id: undefined, label: 'Catalogue 2027' })
    expect(loadSites().map((site) => site.label ?? site.repo)).toEqual(['flipbooks', 'Catalogue 2027'])
    upsertSite({ ...added, siteUrl: 'https://giftscatalogue2027.com' })
    expect(loadSites()[1].siteUrl).toBe('https://giftscatalogue2027.com')
    expect(pagesProjectName('Promotional Gifts Catalogue 2027!')).toBe('promotional-gifts-catalogue-2027')
    window.localStorage.clear()
  })
})

