import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Library, LibraryBook } from '../lib/library'
import { loadSites, normalizeSiteUrl, publishBook, upsertSite, type PublishSettings } from '../lib/publish'
import { newStatsKey, sha256Hex, STATS_PATH, summarize, type StatRow, type StatsSummary } from '../lib/stats'
import { openExternal } from '../lib/external'
import { CloudflareApi, loadCloudflare } from '../lib/cloudflare'
import { errorMessage } from '../lib/errors'
import { saveExport } from '../lib/exporters'
import { Icon } from './Icon'
import './StatsDialog.css'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

interface StatsDialogProps {
  library: Library
  book: LibraryBook
  onClose: () => void
  /** GitHub API (publishing the collector). */
  fetchImpl?: FetchLike
  apiBase?: string
  /** The website's statistics endpoint (tests). */
  statsFetch?: FetchLike
  cloudflareFetch?: FetchLike
  cloudflareBase?: string
}

type Load =
  | { state: 'loading' }
  | { state: 'off' }
  | { state: 'not-online' }
  | { state: 'no-database' }
  | { state: 'error'; message: string }
  | { state: 'ready'; rows: StatRow[] }

const RANGES = [7, 30, 90, 365]
const region = (() => {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }) } catch { return null }
})()
const countryName = (code: string) => (code && code !== '??' && code !== 'XX' ? region?.of(code) ?? code : 'Unknown')
const number = (value: number) => value.toLocaleString('en-US')

function DailyChart({ days }: { days: StatsSummary['days'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const width = 640
  const height = 170
  const pad = { l: 34, r: 28, t: 12, b: 24 }
  const max = Math.max(4, ...days.map((d) => d.pages))
  const step = Math.pow(10, Math.floor(Math.log10(max)))
  const top = Math.ceil(max / step) * step
  const x = (i: number) => pad.l + (days.length < 2 ? 0 : (i / (days.length - 1)) * (width - pad.l - pad.r))
  const y = (v: number) => pad.t + (1 - v / top) * (height - pad.t - pad.b)
  const line = days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.pages).toFixed(1)}`).join('')
  const area = `${line}L${x(days.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`
  const ticks = [0, top / 2, top]
  const labelEvery = Math.ceil(days.length / 6)
  const fmt = (day: string) => new Date(day + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const h = hover !== null ? days[hover] : null
  return (
    <div className="stats-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Page views per day, ${days.length} days`}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          const px = ((event.clientX - box.left) / box.width) * width
          const i = Math.round(((px - pad.l) / (width - pad.l - pad.r)) * (days.length - 1))
          setHover(Math.max(0, Math.min(days.length - 1, i)))
        }}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className="stats-grid" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="stats-axis">{number(t)}</text>
          </g>
        ))}
        {days.map((d, i) => (i % labelEvery === 0 || i === days.length - 1 ? <text key={d.day} x={x(i)} y={height - 6} textAnchor="middle" className="stats-axis">{fmt(d.day)}</text> : null))}
        <path d={area} className="stats-area" />
        <path d={line} className="stats-line" />
        {h && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={y(0)} className="stats-cross" />
            <circle cx={x(hover)} cy={y(h.pages)} r={4} className="stats-dot" />
          </g>
        )}
      </svg>
      {h && hover !== null && (
        <div className="stats-tip" style={{ left: `${(x(hover) / width) * 100}%` }}>
          <strong>{fmt(h.day)}</strong>
          <span>{number(h.pages)} page views</span>
          <span>{number(h.visits)} visits</span>
        </div>
      )}
    </div>
  )
}

function Ranked({ title, items, label, empty, limit = 8 }: { title: string; items: Array<{ key: string; n: number }> | undefined; label?: (key: string) => React.ReactNode; empty: string; limit?: number }) {
  const list = (items ?? []).filter((item) => item.key !== '').slice(0, limit)
  const max = Math.max(1, ...list.map((item) => item.n))
  return (
    <section className="stats-card">
      <h3>{title}</h3>
      {list.length ? (
        <ol className="stats-ranked">
          {list.map((item) => (
            <li key={item.key} title={`${item.key}: ${number(item.n)}`}>
              <span className="stats-bar" style={{ width: `${(item.n / max) * 100}%` }} aria-hidden="true" />
              <span className="stats-key">{label ? label(item.key) : item.key}</span>
              <span className="stats-n">{number(item.n)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="stats-empty">{empty}</p>
      )}
    </section>
  )
}

/** Statistics for one published catalogue: visits, pages read, searches, clicks, countries, devices. */
export function StatsDialog({ library, book, onClose, fetchImpl, apiBase, statsFetch, cloudflareFetch, cloudflareBase }: StatsDialogProps) {
  const doFetch: FetchLike = statsFetch ?? ((input, init) => fetch(input, init))
  const [site, setSite] = useState<PublishSettings | null>(() => loadSites().find((candidate) => candidate.id === (book.published?.siteId ?? 'site-main')) ?? null)
  const [days, setDays] = useState(30)
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [busy, setBusy] = useState('')
  const [uploaded, setUploaded] = useState(false)
  const [thumbs, setThumbs] = useState<string[]>([])
  const pub = book.published?.slug ?? ''

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    library.openBook(book.id).then((project) => { if (!cancelled) setThumbs(project.pages.map((page) => page.thumbUrl ?? page.previewUrl ?? '')) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [book.id, library])

  const refresh = useCallback(async () => {
    if (!site?.stats) { setLoad({ state: 'off' }); return }
    setLoad({ state: 'loading' })
    try {
      const response = await doFetch(`${normalizeSiteUrl(site.siteUrl)}/${STATS_PATH}?pub=${encodeURIComponent(pub)}&days=${days}`, { headers: { 'X-FS-Key': site.stats.key }, cache: 'no-store' })
      if (response.status === 404 || response.status === 405) { setLoad({ state: 'not-online' }); return }
      if (response.status === 403) { setLoad({ state: 'error', message: 'The website has a different statistics key. Click “Update online version” to upload the current one.' }); return }
      const type = response.headers.get('content-type') ?? ''
      if (!response.ok || !type.includes('json')) { setLoad({ state: 'not-online' }); return }
      const body = (await response.json()) as { setup?: boolean; rows?: StatRow[] }
      if (!body.setup) { setLoad({ state: 'no-database' }); return }
      setLoad({ state: 'ready', rows: body.rows ?? [] })
    } catch (err) {
      setLoad({ state: 'error', message: `Could not reach the website (${errorMessage(err, 'network error')}). Check your internet connection.` })
    }
    // doFetch is stable for a given prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, pub, days])

  useEffect(() => { void refresh() }, [refresh])

  const turnOn = async () => {
    if (!site) return
    const key = newStatsKey()
    const next = upsertSite({ ...site, stats: { key, keyHash: await sha256Hex(key) } })
    if (next.host === 'cloudflare') {
      // Direct-upload websites: the app creates the database, connects it and updates the site itself.
      const connection = loadCloudflare()
      if (!connection) { setLoad({ state: 'error', message: 'Cloudflare is not connected on this computer. Open Publish → Website → Settings and connect it.' }); return }
      setBusy('Creating the statistics database…')
      try {
        await new CloudflareApi(connection, cloudflareFetch, cloudflareBase).ensureStatsDatabase(next.cfProject!)
      } catch (err) {
        setBusy('')
        setLoad({ state: 'error', message: errorMessage(err, 'Could not create the statistics database.') })
        return
      }
      setSite(next)
      await updateOnline(next)
      return
    }
    setSite(next)
  }

  const updateOnline = async (target: PublishSettings | null = site) => {
    if (!target) return
    setBusy('Updating the website…')
    try {
      const project = await library.openBook(book.id)
      await publishBook(target, project, { slug: pub, fetchImpl, apiBase, cloudflareFetch, cloudflareBase, onProgress: (message) => setBusy(message) })
      setBusy('')
      setUploaded(true)
      setLoad({ state: 'not-online' })
    } catch (err) {
      setBusy('')
      setLoad({ state: 'error', message: errorMessage(err, 'Updating failed.') })
    }
  }

  const summary = useMemo(() => (load.state === 'ready' ? summarize(load.rows, days) : null), [load, days])
  const t = summary?.totals ?? {}
  const visits = t.visit ?? 0
  const pageViews = t.page ?? 0

  const exportCsv = async () => {
    if (load.state !== 'ready') return
    const lines = [['Day', 'Metric', 'Item', 'Count'], ...load.rows.map((row) => row.map(String))]
    const csv = lines.map((line) => line.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(',')).join('\n')
    await saveExport('﻿' + csv, `${(pub || 'catalogue')}-statistics.csv`, 'CSV file', 'text/csv').catch(() => undefined)
  }

  const cloudflare = 'https://dash.cloudflare.com/?to=/:account/workers/d1'

  return (
    <div className="stats-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="stats-dialog" role="dialog" aria-modal="true" aria-label="Statistics">
        <header className="stats-head">
          <div>
            <h2>Statistics</h2>
            <span>{book.title}{book.published ? ` · ${book.published.url.replace(/^https?:\/\//, '')}` : ''}</span>
          </div>
          <div className="stats-head-actions">
            {load.state === 'ready' && (
              <div className="stats-range" role="radiogroup" aria-label="Period">
                {RANGES.map((range) => (
                  <button key={range} type="button" role="radio" aria-checked={days === range} onClick={() => setDays(range)}>{range === 365 ? '1 year' : `${range} days`}</button>
                ))}
              </div>
            )}
            {load.state === 'ready' && <button type="button" onClick={() => void exportCsv()}><Icon name="download" />CSV</button>}
            <button type="button" onClick={onClose}>Close</button>
          </div>
        </header>

        <div className="stats-body">
          {!book.published && <p className="stats-note">Publish this catalogue online first — statistics are collected by the website.</p>}

          {book.published && load.state === 'off' && (
            <div className="stats-setup">
              <h3>See who reads this catalogue — without Google Analytics</h3>
              <p>Turn on statistics to count visits, the pages people read, what they search for, which products and links they click, and their country and device. No cookies, no personal data; the numbers are stored in your own free Cloudflare database.</p>
              {site && !/github\.io/i.test(site.siteUrl) ? null : <p className="stats-warn">Statistics need the website to be on Cloudflare Pages (the brand-free website). GitHub Pages cannot run the collector.</p>}
              <button type="button" className="primary" onClick={() => void turnOn()} disabled={!site || Boolean(busy)}>{busy || 'Turn on statistics for this website'}</button>
            </div>
          )}

          {book.published && site?.host === 'cloudflare' && (load.state === 'not-online' || load.state === 'no-database') && (
            <div className="stats-setup">
              <h3>{uploaded ? 'Statistics are on' : 'Almost ready'}</h3>
              <p>{uploaded ? 'Cloudflare is updating your website (about a minute). Then open the catalogue once and click Check again to see your own visit.' : 'The website does not have the statistics collector yet.'}</p>
              <div className="stats-actions">
                <button type="button" className="primary" onClick={() => void refresh()}>Check again</button>
                {!uploaded && <button type="button" onClick={() => void updateOnline(site)} disabled={Boolean(busy)}>{busy || 'Update online version'}</button>}
              </div>
            </div>
          )}

          {book.published && site?.host !== 'cloudflare' && (load.state === 'not-online' || load.state === 'no-database') && (
            <div className="stats-setup">
              <h3>{load.state === 'no-database' ? 'One step left: connect the database' : 'Finish setting up statistics'}</h3>
              <ol className="stats-steps">
                <li className={load.state === 'no-database' || uploaded ? 'is-done' : ''}>
                  <strong>Upload the collector to the website.</strong>
                  <span>{uploaded ? 'Uploaded — the website updates in about a minute.' : 'Adds two small files to the site. Takes about a minute to go live.'}</span>
                  <button type="button" onClick={() => void updateOnline(site)} disabled={Boolean(busy)}>{busy || 'Update online version'}</button>
                </li>
                <li>
                  <strong>Create a free database in Cloudflare.</strong>
                  <span>Cloudflare dashboard → <b>Storage &amp; Databases → D1 SQL Database → Create</b> → name it <code>catalogue-stats</code> → <b>Create</b>.</span>
                  <button type="button" onClick={() => void openExternal(cloudflare)}>Open Cloudflare ↗</button>
                </li>
                <li>
                  <strong>Connect it to the website.</strong>
                  <span><b>Workers &amp; Pages</b> → your catalogue project → <b>Settings → Bindings → Add → D1 database</b> → Variable name <code>DB</code> → database <code>catalogue-stats</code> → <b>Save</b>. Then click <b>Update online version</b> above once more so the site restarts with the database.</span>
                </li>
              </ol>
              <button type="button" className="primary" onClick={() => void refresh()}>Check again</button>
            </div>
          )}

          {load.state === 'loading' && book.published && <p className="stats-note">Loading…</p>}
          {load.state === 'error' && (
            <div className="stats-setup">
              <p className="stats-warn" role="alert">{load.message}</p>
              <div className="stats-actions">
                <button type="button" onClick={() => void refresh()}>Try again</button>
                <button type="button" onClick={() => void updateOnline(site)} disabled={Boolean(busy)}>{busy || 'Update online version'}</button>
              </div>
            </div>
          )}

          {summary && (
            <>
              <section className="stats-kpis" aria-label="Totals">
                <div><strong>{number(t.visitor ?? 0)}</strong><span>Readers</span></div>
                <div><strong>{number(visits)}</strong><span>Visits</span></div>
                <div><strong>{number(pageViews)}</strong><span>Page views</span></div>
                <div><strong>{visits ? (pageViews / visits).toFixed(1) : '0'}</strong><span>Pages per visit</span></div>
                <div><strong>{number(t.click ?? 0)}</strong><span>Link &amp; WhatsApp clicks</span></div>
                <div><strong>{number(t.search ?? 0)}</strong><span>Searches</span></div>
              </section>
              <section className="stats-card stats-wide">
                <h3>Page views per day</h3>
                {pageViews ? <DailyChart days={summary.days} /> : <p className="stats-empty">No visits in this period yet. Open the catalogue link to see your own visit appear (it can take a few seconds).</p>}
              </section>
              <div className="stats-grid-2">
                <Ranked
                  title="Most-read pages"
                  items={summary.top.page}
                  empty="No page views yet."
                  label={(key) => (
                    <span className="stats-page">
                      {thumbs[Number(key) - 1] ? <img src={thumbs[Number(key) - 1]} alt="" /> : null}
                      Page {key}
                    </span>
                  )}
                />
                <Ranked title="Searches" items={summary.top.search} empty="Nobody has searched yet." />
                <Ranked title="Clicked links" items={summary.top.click} empty="No link clicks yet." />
                <Ranked title="Products opened" items={summary.top.item} empty="No product pop-ups opened yet." />
                <Ranked title="Countries" items={summary.top.country} label={countryName} empty="No visits yet." />
                <Ranked title="Devices" items={summary.top.device} label={(key) => key.charAt(0).toUpperCase() + key.slice(1)} empty="No visits yet." />
                <Ranked title="Came from" items={summary.top.referrer} empty="Direct visits only (links in WhatsApp and email apps usually show as direct)." />
                <Ranked title="Shares and downloads" items={[...(summary.top.share ?? []).map((item) => ({ ...item, key: `Shared · ${item.key}` })), ...(t.download ? [{ key: 'PDF downloads', n: t.download }] : []), ...(t.video ? [{ key: 'Video plays', n: t.video }] : []), ...(t.bookmark ? [{ key: 'Pages bookmarked', n: t.bookmark }] : [])].sort((a, b) => b.n - a.n)} empty="No shares or downloads yet." />
              </div>
              <p className="stats-foot-note">Counted by your website (UTC days). Visits are browser sessions; readers are counted once per day per browser. No cookies and no IP addresses are stored.</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
