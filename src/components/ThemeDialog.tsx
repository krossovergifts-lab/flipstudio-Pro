import { useEffect, useMemo, useRef, useState } from 'react'
import type { FlipPreset, FlipSoundKind, PageBookmark, ProjectAsset, ProjectState, ReaderSettings } from '../lib/project'
import { createAsset } from '../lib/project'
import { fileToDataUrl, formatBytes } from '../lib/assets'
import { createFlipSound, FLIP_PRESETS, SOUND_PRESETS } from '../runtime/theme.js'
import { ColorField } from './ColorField'
import { PreviewPane } from './PreviewPane'
import { Icon, type IconName } from './Icon'
import './ThemeDialog.css'

export interface ThemeDialogProps {
  project: ProjectState
  /** Section to open first (e.g. "bookmarks" from the page inspector). */
  initialTab?: TabId
  onCancel: () => void
  /** `bookmarks` maps page id → bookmark (undefined removes it). */
  onApply: (reader: ReaderSettings, newAssets: ProjectAsset[], bookmarks: Record<string, PageBookmark | undefined>, info: { description: string; keywords: string }) => void
}

const LANGUAGES: Array<[string, string]> = [['en', 'English'], ['ar', 'Arabic'], ['fr', 'French'], ['de', 'German'], ['es', 'Spanish'], ['it', 'Italian'], ['ru', 'Russian'], ['zh', 'Chinese'], ['hi', 'Hindi'], ['ml', 'Malayalam'], ['ur', 'Urdu'], ['tr', 'Turkish'], ['pt', 'Portuguese'], ['nl', 'Dutch']]
/** Settings that describe the publication rather than its look: kept by "Reset to default". */
const KEEP_ON_RESET: Array<keyof ReaderSettings> = ['analyticsId', 'analyticsConsent', 'metaPixelId', 'linkedinPartnerId', 'linkedinConversionId', 'seoTitle', 'language', 'noIndex', 'pageLinks', 'logoAssetId', 'logoLink', 'downloadAssetId', 'downloadName']

const DEFAULT_READER: ReaderSettings = {
  backgroundMode: 'solid',
  background: '#0b1220',
  backgroundTo: '#1e293b',
  backgroundAngle: 160,
  toolbar: '#0f172a',
  toolbarText: '#e2e8f0',
  button: '#1e293b',
  accent: '#2563eb',
  flip: 'smooth',
  cover: 'soft',
  pageShadow: true,
  bookShadow: true,
  sound: 'paper',
  thumbnails: true,
  textTools: true,
  tabs: true,
  tabEffect: 'slide',
  contents: true,
  readerBookmarks: true,
  share: true,
  sideArrows: true,
  showTitle: true,
  autoFlipButton: true,
  autoFlip: { startOnOpen: false, interval: 4, startDelay: 2, loop: true },
  centerSinglePages: true,
}

interface ThemePreset { id: string; label: string; reader: ReaderSettings }

const THEMES: ThemePreset[] = [
  { id: 'midnight', label: 'Midnight', reader: { backgroundMode: 'solid', background: '#0b1220', toolbar: '#0f172a', toolbarText: '#e2e8f0', button: '#1e293b', accent: '#2563eb' } },
  { id: 'beige', label: 'Luxury beige', reader: { backgroundMode: 'gradient', background: '#efe7dc', backgroundTo: '#d6c7b2', backgroundAngle: 160, toolbar: '#2b2520', toolbarText: '#f3ece2', button: '#3d352e', accent: '#a07a4f' } },
  { id: 'studio', label: 'Studio white', reader: { backgroundMode: 'solid', background: '#f4f4f5', toolbar: '#ffffff', toolbarText: '#18181b', button: '#f4f4f5', accent: '#18181b' } },
  { id: 'walnut', label: 'Walnut', reader: { backgroundMode: 'gradient', background: '#6b4f3a', backgroundTo: '#2e2118', backgroundAngle: 170, toolbar: '#111111', toolbarText: '#f5efe6', button: '#2a2a2a', accent: '#c8a165' } },
  { id: 'graphite', label: 'Graphite', reader: { backgroundMode: 'gradient', background: '#374151', backgroundTo: '#111827', backgroundAngle: 180, toolbar: '#111827', toolbarText: '#f9fafb', button: '#1f2937', accent: '#f59e0b' } },
  { id: 'ocean', label: 'Ocean', reader: { backgroundMode: 'gradient', background: '#0e7490', backgroundTo: '#082f49', backgroundAngle: 150, toolbar: '#082f49', toolbarText: '#e0f2fe', button: '#0c4a6e', accent: '#22d3ee' } },
  { id: 'forest', label: 'Forest', reader: { backgroundMode: 'gradient', background: '#166534', backgroundTo: '#052e16', backgroundAngle: 160, toolbar: '#052e16', toolbarText: '#dcfce7', button: '#14532d', accent: '#4ade80' } },
  { id: 'rose', label: 'Rose gold', reader: { backgroundMode: 'gradient', background: '#f5e1da', backgroundTo: '#c99a8a', backgroundAngle: 145, toolbar: '#3f2a26', toolbarText: '#fdf2ee', button: '#573b35', accent: '#b76e5a' } },
]

const TAB_COLORS = ['#c2410c', '#0f766e', '#7c3aed', '#be123c', '#1d4ed8', '#a16207', '#15803d', '#475569']

type TabId = 'theme' | 'toolbar' | 'turn' | 'sound' | 'bookmarks' | 'auto' | 'share' | 'brand' | 'seo'
const TABS: Array<{ id: TabId; label: string; icon: IconName }> = [
  { id: 'theme', label: 'Theme & background', icon: 'palette' },
  { id: 'toolbar', label: 'Toolbar & buttons', icon: 'toolbar' },
  { id: 'turn', label: 'Page turn', icon: 'book' },
  { id: 'sound', label: 'Page sound', icon: 'sound' },
  { id: 'bookmarks', label: 'Bookmarks & contents', icon: 'bookmark' },
  { id: 'auto', label: 'Auto flip', icon: 'play' },
  { id: 'share', label: 'Share & download', icon: 'share' },
  { id: 'brand', label: 'Logo & title', icon: 'tag' },
  { id: 'seo', label: 'SEO & analytics', icon: 'chart' },
]

function swatchCss(reader: ReaderSettings): string {
  if (reader.backgroundMode === 'gradient') return `linear-gradient(${reader.backgroundAngle ?? 160}deg, ${reader.background}, ${reader.backgroundTo})`
  return reader.background ?? '#0b1220'
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (value: boolean) => void; hint?: string }) {
  return (
    <label className="theme-check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}{hint && <small>{hint}</small>}</span>
    </label>
  )
}

/** Flipbook design: theme, toolbar, page turn, sound, bookmarks, auto flip, sharing and logo — with a live preview. */
export function ThemeDialog({ project, initialTab = 'theme', onCancel, onApply }: ThemeDialogProps) {
  const [tab, setTab] = useState<TabId>(initialTab)
  const [draft, setDraft] = useState<ReaderSettings>(() => ({ ...DEFAULT_READER, ...(project.reader ?? {}), autoFlip: { ...DEFAULT_READER.autoFlip, ...(project.reader?.autoFlip ?? {}) } }))
  const [marks, setMarks] = useState<Record<string, PageBookmark | undefined>>(() => Object.fromEntries(project.pages.filter((page) => page.bookmark).map((page) => [page.id, { ...page.bookmark! }])))
  const [newAssets, setNewAssets] = useState<Record<string, ProjectAsset>>({})
  const [problem, setProblem] = useState('')
  const [addPage, setAddPage] = useState(1)
  const [info, setInfo] = useState({ description: project.description ?? '', keywords: project.keywords ?? '' })
  const [preview, setPreview] = useState({ draft, marks })
  const sampleRef = useRef<ReturnType<typeof createFlipSound> | null>(null)
  const set = (patch: Partial<ReaderSettings>) => setDraft((current) => ({ ...current, ...patch }))
  const setAuto = (patch: Partial<NonNullable<ReaderSettings['autoFlip']>>) => setDraft((current) => ({ ...current, autoFlip: { ...current.autoFlip, ...patch } }))

  // Rebuilding the preview on every colour-picker tick would be wasteful: wait for a pause.
  useEffect(() => {
    const timer = window.setTimeout(() => setPreview({ draft, marks }), 250)
    return () => window.clearTimeout(timer)
  }, [draft, marks])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !(event.target instanceof HTMLElement && event.target.closest('.preview-pane'))) {
        event.preventDefault()
        event.stopPropagation()
        onCancel()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  useEffect(() => () => sampleRef.current?.destroy(), [])

  const assets = useMemo(() => ({ ...project.assets, ...newAssets }), [project.assets, newAssets])
  const previewProject = useMemo<ProjectState>(
    () => ({
      ...project,
      assets,
      reader: { ...preview.draft, autoFlip: { ...preview.draft.autoFlip, startOnOpen: false } },
      animations: [],
      pages: project.pages.map((page) => ({ ...page, bookmark: preview.marks[page.id] })),
    }),
    [assets, preview, project],
  )

  const upload = async (file: File | undefined, kind: 'background' | 'logo' | 'sound' | 'pdf') => {
    if (!file) return
    setProblem('')
    const limit = kind === 'sound' ? 1.5 * 1024 * 1024 : kind === 'pdf' ? 200 * 1024 * 1024 : 4 * 1024 * 1024
    if (file.size > limit) {
      setProblem(`${file.name} is ${formatBytes(file.size)}. Please use a file under ${formatBytes(limit)}.`)
      return
    }
    if (kind === 'pdf' && file.size > 25 * 1024 * 1024) {
      setProblem(`${file.name} is ${formatBytes(file.size)}. Cloudflare Pages accepts files up to 25 MB, so for online publishing save a smaller PDF (Acrobat: File → Reduce file size). It still works in exports.`)
    }
    try {
      const asset = createAsset({ name: file.name, dataUrl: await fileToDataUrl(file, file.name) })
      setNewAssets((current) => ({ ...current, [asset.id]: asset }))
      if (kind === 'background') set({ backgroundImageAssetId: asset.id, backgroundMode: 'image' })
      if (kind === 'logo') set({ logoAssetId: asset.id })
      if (kind === 'sound') set({ soundAssetId: asset.id, sound: 'custom' })
      if (kind === 'pdf') set({ downloadAssetId: asset.id, downloadName: file.name })
    } catch {
      setProblem(`${file.name} could not be read.`)
    }
  }

  const playSample = () => {
    sampleRef.current?.destroy()
    const custom = draft.soundAssetId ? assets[draft.soundAssetId]?.dataUrl : undefined
    sampleRef.current = createFlipSound(window, draft.sound ?? 'paper', custom)
    sampleRef.current.unlock()
    sampleRef.current.play()
  }

  const apply = () => {
    const used = new Set([draft.backgroundImageAssetId, draft.logoAssetId, draft.soundAssetId, draft.downloadAssetId].filter(Boolean) as string[])
    const changes: Record<string, PageBookmark | undefined> = {}
    for (const page of project.pages) {
      const next = marks[page.id]
      const cleaned = next && next.label.trim() ? { ...next, label: next.label.trim() } : undefined
      if (JSON.stringify(cleaned ?? null) !== JSON.stringify(page.bookmark ?? null)) changes[page.id] = cleaned
    }
    const analyticsId = (draft.analyticsId ?? '').trim().toUpperCase()
    const reader: ReaderSettings = { ...draft, analyticsId: analyticsId || undefined, seoTitle: draft.seoTitle?.trim() || undefined }
    onApply(reader, Object.values(newAssets).filter((asset) => used.has(asset.id)), changes, { description: info.description.trim(), keywords: info.keywords.trim() })
  }

  const bookmarkRows = project.pages.map((page, index) => ({ page, index })).filter(({ page }) => marks[page.id])
  const addBookmark = () => {
    const index = Math.min(project.pages.length, Math.max(1, Math.floor(addPage))) - 1
    const page = project.pages[index]
    if (!page) return
    setMarks((current) => ({ ...current, [page.id]: current[page.id] ?? { label: `Section ${bookmarkRows.length + 1}`, color: TAB_COLORS[bookmarkRows.length % TAB_COLORS.length], textColor: '#ffffff' } }))
    setAddPage(Math.min(project.pages.length, index + 2))
  }
  const editMark = (pageId: string, patch: Partial<PageBookmark>) => setMarks((current) => ({ ...current, [pageId]: { ...(current[pageId] ?? { label: '' }), ...patch } }))

  const flipSeconds = ((draft.flipSpeed ?? FLIP_PRESETS[draft.flip ?? 'smooth'].time) / 1000).toFixed(2)
  const auto = draft.autoFlip ?? {}

  return (
    <div className="theme-backdrop">
      <div className="theme-dialog" role="dialog" aria-modal="true" aria-label="Flipbook design">
        <header className="theme-head">
          <div>
            <h2>Flipbook design</h2>
            <span>How readers see this publication — in Preview, exports and online.</span>
          </div>
          <div className="theme-head-actions">
            <button type="button" className="link-button" onClick={() => setDraft((current) => ({ ...DEFAULT_READER, ...Object.fromEntries(KEEP_ON_RESET.filter((key) => current[key] !== undefined).map((key) => [key, current[key]])) }))}>Reset to default</button>
            <button type="button" onClick={onCancel}>Cancel</button>
            <button type="button" className="primary" onClick={apply}>Apply design</button>
          </div>
        </header>
        <div className="theme-body">
          <nav className="theme-nav" aria-label="Design sections">
            {TABS.map((item) => (
              <button key={item.id} type="button" className={tab === item.id ? 'active' : ''} aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}>
                <Icon name={item.icon} />{item.label}
              </button>
            ))}
          </nav>
          <div className="theme-controls">
            {tab === 'theme' && (
              <>
                <section>
                  <h3>Theme</h3>
                  <div className="theme-presets">
                    {THEMES.map((theme) => (
                      <button key={theme.id} type="button" className="theme-preset" onClick={() => set({ ...theme.reader, backgroundImageAssetId: draft.backgroundImageAssetId })} title={theme.label}>
                        <span className="theme-preset-swatch" style={{ background: swatchCss({ ...DEFAULT_READER, ...theme.reader }) }}>
                          <span style={{ background: theme.reader.toolbar }} />
                        </span>
                        {theme.label}
                      </button>
                    ))}
                  </div>
                </section>
                <section>
                  <h3>Background</h3>
                  <div className="theme-segment" role="radiogroup" aria-label="Background type">
                    {(['solid', 'gradient', 'image'] as const).map((mode) => (
                      <button key={mode} type="button" role="radio" aria-checked={draft.backgroundMode === mode} onClick={() => set({ backgroundMode: mode })}>
                        {mode === 'solid' ? 'Colour' : mode === 'gradient' ? 'Gradient' : 'Image'}
                      </button>
                    ))}
                  </div>
                  <ColorField label={draft.backgroundMode === 'gradient' ? 'From' : 'Background colour'} value={draft.background} allowAlpha={false} onChange={(background) => set({ background })} />
                  {draft.backgroundMode === 'gradient' && (
                    <>
                      <ColorField label="To" value={draft.backgroundTo} allowAlpha={false} onChange={(backgroundTo) => set({ backgroundTo })} />
                      <label className="theme-range">
                        Angle ({draft.backgroundAngle ?? 160}°)
                        <input type="range" min={0} max={360} value={draft.backgroundAngle ?? 160} onChange={(event) => set({ backgroundAngle: Number(event.target.value) })} />
                      </label>
                    </>
                  )}
                  {draft.backgroundMode === 'image' && (
                    <div className="theme-file">
                      <label className="theme-file-btn">
                        {draft.backgroundImageAssetId ? 'Replace image…' : 'Choose image…'}
                        <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { void upload(event.target.files?.[0], 'background'); event.target.value = '' }} />
                      </label>
                      {draft.backgroundImageAssetId && <span>{assets[draft.backgroundImageAssetId]?.name ?? 'Image'}</span>}
                      <small>A wood, paper or softly blurred photo works best. The colour above shows while it loads.</small>
                    </div>
                  )}
                  <Toggle label="Book shadow on the background" checked={draft.bookShadow !== false} onChange={(bookShadow) => set({ bookShadow })} />
                </section>
              </>
            )}

            {tab === 'toolbar' && (
              <>
                <section>
                  <h3>Colours</h3>
                  <ColorField label="Toolbar" value={draft.toolbar} onChange={(toolbar) => set({ toolbar })} />
                  <ColorField label="Icons and text" value={draft.toolbarText} allowAlpha={false} onChange={(toolbarText) => set({ toolbarText })} />
                  <ColorField label="Buttons" value={draft.button} onChange={(button) => set({ button })} />
                  <ColorField label="Accent (highlights)" value={draft.accent} allowAlpha={false} onChange={(accent) => set({ accent })} />
                </section>
                <section>
                  <h3>Buttons readers see</h3>
                  <Toggle label="All pages (thumbnails)" checked={draft.thumbnails !== false} onChange={(thumbnails) => set({ thumbnails })} />
                  <Toggle label="Contents" checked={draft.contents !== false} onChange={(contents) => set({ contents })} />
                  <Toggle label="My bookmarks" hint="Readers save pages to come back to" checked={draft.readerBookmarks !== false} onChange={(readerBookmarks) => set({ readerBookmarks })} />
                  <Toggle label="Search and Select text" hint="When the PDF has text" checked={draft.textTools !== false} onChange={(textTools) => set({ textTools })} />
                  <Toggle label="Large arrows at the sides" checked={draft.sideArrows !== false} onChange={(sideArrows) => set({ sideArrows })} />
                  <Toggle label="Auto flip button" checked={draft.autoFlipButton !== false} onChange={(autoFlipButton) => set({ autoFlipButton })} />
                </section>
              </>
            )}

            {tab === 'turn' && (
              <section>
                <h3>Page turn</h3>
                <div className="theme-cards" role="radiogroup" aria-label="Page turn style">
                  {(Object.keys(FLIP_PRESETS) as FlipPreset[]).map((id) => (
                    <button key={id} type="button" role="radio" aria-checked={(draft.flip ?? 'smooth') === id} className="theme-card" onClick={() => set({ flip: id, flipSpeed: undefined, cover: FLIP_PRESETS[id].cover })}>
                      <strong>{FLIP_PRESETS[id].label}</strong>
                      <span>{id === 'smooth' ? 'Soft, natural paper. Recommended.' : id === 'magazine' ? 'Light, quick, thin pages.' : id === 'hardcover' ? 'Stiff cover board, heavy pages.' : 'Fast turns for browsing.'}</span>
                    </button>
                  ))}
                </div>
                <label className="theme-range">
                  Speed ({flipSeconds} s per page)
                  <input type="range" min={300} max={1600} step={50} value={draft.flipSpeed ?? FLIP_PRESETS[draft.flip ?? 'smooth'].time} onChange={(event) => set({ flipSpeed: Number(event.target.value) })} />
                </label>
                <Toggle label="Soft cover" hint="The first page bends like paper" checked={(draft.cover ?? 'soft') === 'soft'} onChange={(soft) => set({ cover: soft ? 'soft' : 'hard' })} />
                <Toggle label="Centre the cover and the last page" hint="A single page sits in the middle; spreads stay centred" checked={draft.centerSinglePages !== false} onChange={(centerSinglePages) => set({ centerSinglePages })} />
                <Toggle label="Shadow while turning" checked={draft.pageShadow !== false} onChange={(pageShadow) => set({ pageShadow })} />
              </section>
            )}

            {tab === 'sound' && (
              <section>
                <h3>Page sound</h3>
                <div className="theme-sound">
                  <select aria-label="Page sound" value={draft.sound ?? 'paper'} onChange={(event) => set({ sound: event.target.value as FlipSoundKind })}>
                    {(Object.keys(SOUND_PRESETS) as FlipSoundKind[]).filter((id) => id !== 'custom' || draft.soundAssetId).map((id) => <option key={id} value={id}>{SOUND_PRESETS[id]}</option>)}
                  </select>
                  <button type="button" onClick={playSample} disabled={(draft.sound ?? 'paper') === 'none'}>▶ Play</button>
                </div>
                <label className="theme-file-btn">
                  Use my own sound… (MP3/WAV, under 1.5 MB)
                  <input type="file" accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,.mp3,.wav,.ogg,.m4a" hidden onChange={(event) => { void upload(event.target.files?.[0], 'sound'); event.target.value = '' }} />
                </label>
                <small>Plays on every page turn. Readers can mute it with the speaker button. Browsers start sound only after the reader's first click, tap or key.</small>
              </section>
            )}

            {tab === 'bookmarks' && (
              <>
                <section>
                  <h3>Bookmark tabs</h3>
                  <small>Each bookmark becomes a coloured tab on the edge of the book and a line in Contents, so readers jump straight to that page.</small>
                  <div className="theme-add-mark">
                    <label>Page
                      <input type="number" min={1} max={project.pages.length} value={addPage} onChange={(event) => setAddPage(Number(event.target.value))} />
                    </label>
                    <button type="button" className="primary" onClick={addBookmark}>+ Add bookmark</button>
                  </div>
                  {bookmarkRows.length === 0 && <p className="theme-empty">No bookmarks yet. Add one for each category, e.g. “Drinkware” on its first page.</p>}
                  <ol className="theme-marks">
                    {bookmarkRows.map(({ page, index }) => {
                      const mark = marks[page.id]!
                      return (
                        <li key={page.id}>
                          <span className="theme-mark-page">p. {index + 1}</span>
                          <input className="theme-mark-label" aria-label={`Bookmark text, page ${index + 1}`} value={mark.label} onChange={(event) => editMark(page.id, { label: event.target.value })} placeholder="Tab text" />
                          <input type="color" aria-label={`Tab colour, page ${index + 1}`} value={mark.color ?? '#475569'} onChange={(event) => editMark(page.id, { color: event.target.value })} />
                          <input className="theme-mark-hex" aria-label={`Tab colour hex, page ${index + 1}`} value={mark.color ?? ''} maxLength={7} onChange={(event) => editMark(page.id, { color: event.target.value })} placeholder="#hex" />
                          <input type="color" aria-label={`Tab text colour, page ${index + 1}`} title="Text colour" value={mark.textColor ?? '#ffffff'} onChange={(event) => editMark(page.id, { textColor: event.target.value })} />
                          <button type="button" className="theme-mark-remove" aria-label={`Remove bookmark, page ${index + 1}`} onClick={() => setMarks((current) => ({ ...current, [page.id]: undefined }))}>×</button>
                        </li>
                      )
                    })}
                  </ol>
                </section>
                <section>
                  <h3>Tab style</h3>
                  <Toggle label="Show tabs on the book edge" checked={draft.tabs !== false} onChange={(tabs) => set({ tabs })} />
                  <label className="theme-range">
                    Hover effect
                    <select value={draft.tabEffect ?? 'slide'} onChange={(event) => set({ tabEffect: event.target.value as ReaderSettings['tabEffect'] })}>
                      <option value="slide">Slide out to the right</option>
                      <option value="grow">Grow wider</option>
                      <option value="glow">Glow</option>
                      <option value="none">None</option>
                    </select>
                  </label>
                </section>
              </>
            )}

            {tab === 'auto' && (
              <section>
                <h3>Auto flip</h3>
                <Toggle label="Start turning pages automatically when the book opens" checked={Boolean(auto.startOnOpen)} onChange={(startOnOpen) => setAuto({ startOnOpen })} />
                <label className="theme-range">
                  Time on each page ({auto.interval ?? 4} s)
                  <input type="range" min={2} max={15} step={0.5} value={auto.interval ?? 4} onChange={(event) => setAuto({ interval: Number(event.target.value) })} />
                </label>
                <label className="theme-range">
                  Delay before starting ({auto.startDelay ?? 2} s)
                  <input type="range" min={0} max={20} step={1} value={auto.startDelay ?? 2} onChange={(event) => setAuto({ startDelay: Number(event.target.value) })} />
                </label>
                <Toggle label="Start again from the cover at the end" checked={auto.loop !== false} onChange={(loop) => setAuto({ loop })} />
                <small>Readers can start or stop it with the ⏯ button; right-click the button to choose the speed.</small>
              </section>
            )}

            {tab === 'share' && (
              <>
                <section>
                  <h3>Share</h3>
                  <Toggle label="Share and Email buttons" hint="Copy link, WhatsApp, Facebook, LinkedIn, X, email" checked={draft.share !== false} onChange={(share) => set({ share })} />
                </section>
                <section>
                  <h3>Download PDF</h3>
                  <div className="theme-file">
                    <label className="theme-file-btn">
                      {draft.downloadAssetId ? 'Replace PDF…' : 'Choose PDF…'}
                      <input type="file" accept="application/pdf" hidden onChange={(event) => { void upload(event.target.files?.[0], 'pdf'); event.target.value = '' }} />
                    </label>
                    {draft.downloadAssetId && (
                      <>
                        <span>{assets[draft.downloadAssetId]?.name ?? 'PDF'}</span>
                        <button type="button" className="link-button" onClick={() => set({ downloadAssetId: undefined })}>Remove</button>
                      </>
                    )}
                  </div>
                  <small>Shows a download button for this PDF. Online, keep it under 25 MB (Cloudflare limit) — a “smallest size” PDF export is ideal.</small>
                </section>
              </>
            )}

            {tab === 'seo' && (
              <>
                <section>
                  <h3>Google search</h3>
                  <label className="theme-text">
                    Title in Google
                    <input value={draft.seoTitle ?? ''} maxLength={70} onChange={(event) => set({ seoTitle: event.target.value })} placeholder={project.title} />
                  </label>
                  <small className="theme-count">{(draft.seoTitle || project.title).length} / 60 characters recommended</small>
                  <label className="theme-text">
                    Description
                    <textarea rows={3} maxLength={300} value={info.description} onChange={(event) => setInfo((current) => ({ ...current, description: event.target.value }))} placeholder="e.g. 250 premium corporate gifts with logo printing — drinkware, bags, tech and more." />
                  </label>
                  <small className="theme-count">{info.description.length} / 155 characters recommended</small>
                  <label className="theme-text">
                    Keywords
                    <input value={info.keywords} onChange={(event) => setInfo((current) => ({ ...current, keywords: event.target.value }))} placeholder="corporate gifts, promotional gifts, Dubai" />
                  </label>
                  <label className="theme-text">
                    Language
                    <select value={draft.language ?? 'en'} onChange={(event) => set({ language: event.target.value })}>
                      {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                    </select>
                  </label>
                  <div className="theme-serp" aria-label="Google result preview">
                    <span className="theme-serp-url">{'yourcatalogue.pages.dev'}</span>
                    <span className="theme-serp-title">{draft.seoTitle || project.title}</span>
                    <span className="theme-serp-desc">{info.description || 'Add a description so people know what is inside before they click.'}</span>
                  </div>
                  <Toggle label="Hide from Google and other search engines" hint="For private or draft catalogues shared only by link" checked={Boolean(draft.noIndex)} onChange={(noIndex) => set({ noIndex })} />
                  <Toggle label="Links can open on a page" hint="The address follows the page (…/#page=12) and Share can link to the current page" checked={draft.pageLinks !== false} onChange={(pageLinks) => set({ pageLinks })} />
                  <small>Every page's text, bookmarks and product links are included for search engines, with a sitemap.xml and robots.txt on your website.</small>
                </section>
                <section>
                  <h3>Google Analytics</h3>
                  <label className="theme-text">
                    Measurement ID
                    <input value={draft.analyticsId ?? ''} onChange={(event) => set({ analyticsId: event.target.value.replace(/\s+/g, '') })} placeholder="G-XXXXXXXXXX" spellCheck={false} />
                  </label>
                  {draft.analyticsId && !/^G-[A-Z0-9]{4,16}$/i.test(draft.analyticsId) && <p className="theme-error">That does not look like a GA4 Measurement ID. It starts with “G-”.</p>}
                  <small>In Google Analytics: Admin → Data streams → Web → your site → Measurement ID.</small>
                  <Toggle label="Ask visitors first (cookie notice)" hint="Counts are anonymous until a visitor accepts" checked={Boolean(draft.analyticsConsent)} onChange={(analyticsConsent) => set({ analyticsConsent })} />
                  <div className="theme-tracked">
                    <strong>Reported to Google Analytics</strong>
                    <ul>
                      <li>Page views — each page or spread, so you see the most-read products</li>
                      <li>Searches and the words people search for</li>
                      <li>Link, WhatsApp and product pop-up clicks</li>
                      <li>Shares, PDF downloads, bookmarks, auto flip</li>
                      <li>Video plays and completions</li>
                    </ul>
                  </div>
                  <small>Works on the published website. Preview and the editor never send data.</small>
                </section>
                <section>
                  <h3>Ad tracking (retargeting)</h3>
                  <label className="theme-text">
                    Meta Pixel ID (Facebook &amp; Instagram)
                    <input value={draft.metaPixelId ?? ''} onChange={(event) => set({ metaPixelId: event.target.value.replace(/[^\d]/g, '') })} placeholder="e.g. 1234567890123456" inputMode="numeric" spellCheck={false} />
                  </label>
                  <small>Meta Events Manager → Data sources → your Pixel → Settings → Pixel ID. Sends PageView, FlipPage, Search, ViewContent (product pop-ups), Contact (WhatsApp, email, phone) and more.</small>
                  <label className="theme-text">
                    LinkedIn Insight Tag partner ID
                    <input value={draft.linkedinPartnerId ?? ''} onChange={(event) => set({ linkedinPartnerId: event.target.value.replace(/[^\d]/g, '') })} placeholder="e.g. 1234567" inputMode="numeric" spellCheck={false} />
                  </label>
                  <label className="theme-text">
                    LinkedIn conversion ID for enquiries (optional)
                    <input value={draft.linkedinConversionId ?? ''} onChange={(event) => set({ linkedinConversionId: event.target.value.replace(/[^\d]/g, '') })} placeholder="e.g. 12345678" inputMode="numeric" spellCheck={false} disabled={!draft.linkedinPartnerId} />
                  </label>
                  <small>LinkedIn Campaign Manager → Analyze → Insight Tag (partner ID) and Conversion tracking (conversion ID). The conversion counts link and WhatsApp clicks. With “Ask visitors first”, ad tags load only after a visitor accepts.</small>
                </section>
              </>
            )}

            {tab === 'brand' && (
              <section>
                <h3>Logo and title</h3>
                <div className="theme-file">
                  <label className="theme-file-btn">
                    {draft.logoAssetId ? 'Replace logo…' : 'Add logo…'}
                    <input type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" hidden onChange={(event) => { void upload(event.target.files?.[0], 'logo'); event.target.value = '' }} />
                  </label>
                  {draft.logoAssetId && <button type="button" className="link-button" onClick={() => set({ logoAssetId: undefined })}>Remove logo</button>}
                </div>
                {draft.logoAssetId && (
                  <label className="theme-text">
                    Logo link (optional)
                    <input value={draft.logoLink ?? ''} onChange={(event) => set({ logoLink: event.target.value })} placeholder="www.example.com" />
                  </label>
                )}
                <Toggle label="Show the publication title next to the logo" checked={draft.showTitle !== false} onChange={(showTitle) => set({ showTitle })} />
                <small>The logo sits in the top-left corner. Leave it empty for an unbranded catalogue.</small>
              </section>
            )}
            {problem && <p className="theme-error" role="alert">{problem}</p>}
          </div>
          <div className="theme-preview">
            <div className="theme-preview-label">Live preview — try the buttons and turn pages</div>
            <PreviewPane project={previewProject} startPage={0} />
          </div>
        </div>
      </div>
    </div>
  )
}
