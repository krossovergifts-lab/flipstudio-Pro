import { useEffect, useMemo, useRef, useState } from 'react'
import type { FlipPreset, FlipSoundKind, ProjectAsset, ProjectState, ReaderSettings } from '../lib/project'
import { createAsset } from '../lib/project'
import { fileToDataUrl, formatBytes } from '../lib/assets'
import { createFlipSound, FLIP_PRESETS, SOUND_PRESETS } from '../runtime/theme.js'
import { ColorField } from './ColorField'
import { PreviewPane } from './PreviewPane'
import './ThemeDialog.css'

export interface ThemeDialogProps {
  project: ProjectState
  onCancel: () => void
  onApply: (reader: ReaderSettings, newAssets: ProjectAsset[]) => void
}

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
}

interface ThemePreset { id: string; label: string; reader: ReaderSettings }

const THEMES: ThemePreset[] = [
  { id: 'midnight', label: 'Midnight', reader: { backgroundMode: 'solid', background: '#0b1220', toolbar: '#0f172a', toolbarText: '#e2e8f0', button: '#1e293b', accent: '#2563eb' } },
  { id: 'beige', label: 'Luxury beige', reader: { backgroundMode: 'gradient', background: '#efe7dc', backgroundTo: '#d6c7b2', backgroundAngle: 160, toolbar: '#2b2520', toolbarText: '#f3ece2', button: '#3d352e', accent: '#a07a4f' } },
  { id: 'studio', label: 'Studio white', reader: { backgroundMode: 'solid', background: '#f4f4f5', toolbar: '#ffffff', toolbarText: '#18181b', button: '#f4f4f5', accent: '#18181b' } },
  { id: 'graphite', label: 'Graphite', reader: { backgroundMode: 'gradient', background: '#374151', backgroundTo: '#111827', backgroundAngle: 180, toolbar: '#111827', toolbarText: '#f9fafb', button: '#1f2937', accent: '#f59e0b' } },
  { id: 'ocean', label: 'Ocean', reader: { backgroundMode: 'gradient', background: '#0e7490', backgroundTo: '#082f49', backgroundAngle: 150, toolbar: '#082f49', toolbarText: '#e0f2fe', button: '#0c4a6e', accent: '#22d3ee' } },
  { id: 'forest', label: 'Forest', reader: { backgroundMode: 'gradient', background: '#166534', backgroundTo: '#052e16', backgroundAngle: 160, toolbar: '#052e16', toolbarText: '#dcfce7', button: '#14532d', accent: '#4ade80' } },
  { id: 'rose', label: 'Rose gold', reader: { backgroundMode: 'gradient', background: '#f5e1da', backgroundTo: '#c99a8a', backgroundAngle: 145, toolbar: '#3f2a26', toolbarText: '#fdf2ee', button: '#573b35', accent: '#b76e5a' } },
]

const PREVIEW_PAGES = 6

function swatchCss(reader: ReaderSettings): string {
  if (reader.backgroundMode === 'gradient') return `linear-gradient(${reader.backgroundAngle ?? 160}deg, ${reader.background}, ${reader.backgroundTo})`
  return reader.background ?? '#0b1220'
}

/** Reader design: theme, background, toolbar colours, page-turn feel, sound, tools and logo — with a live preview. */
export function ThemeDialog({ project, onCancel, onApply }: ThemeDialogProps) {
  const [draft, setDraft] = useState<ReaderSettings>(() => ({ ...DEFAULT_READER, ...(project.reader ?? {}) }))
  const [newAssets, setNewAssets] = useState<Record<string, ProjectAsset>>({})
  const [problem, setProblem] = useState('')
  const [previewDraft, setPreviewDraft] = useState(draft)
  const sampleRef = useRef<ReturnType<typeof createFlipSound> | null>(null)
  const set = (patch: Partial<ReaderSettings>) => setDraft((current) => ({ ...current, ...patch }))

  // Rebuilding the preview on every colour-picker tick would be wasteful: wait for a pause.
  useEffect(() => {
    const timer = window.setTimeout(() => setPreviewDraft(draft), 220)
    return () => window.clearTimeout(timer)
  }, [draft])

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
    () => ({ ...project, assets, reader: previewDraft, animations: [], pages: project.pages.slice(0, PREVIEW_PAGES) }),
    [assets, previewDraft, project],
  )

  const upload = async (file: File | undefined, kind: 'background' | 'logo' | 'sound') => {
    if (!file) return
    setProblem('')
    const limit = kind === 'sound' ? 1.5 * 1024 * 1024 : 4 * 1024 * 1024
    if (file.size > limit) {
      setProblem(`${file.name} is ${formatBytes(file.size)}. Please use a file under ${formatBytes(limit)} so the flipbook stays fast.`)
      return
    }
    try {
      const asset = createAsset({ name: file.name, dataUrl: await fileToDataUrl(file, file.name) })
      setNewAssets((current) => ({ ...current, [asset.id]: asset }))
      if (kind === 'background') set({ backgroundImageAssetId: asset.id, backgroundMode: 'image' })
      if (kind === 'logo') set({ logoAssetId: asset.id })
      if (kind === 'sound') set({ soundAssetId: asset.id, sound: 'custom' })
    } catch {
      setProblem(`${file.name} could not be read.`)
    }
  }

  const playSample = () => {
    sampleRef.current?.destroy()
    const custom = draft.soundAssetId ? assets[draft.soundAssetId]?.dataUrl : undefined
    sampleRef.current = createFlipSound(window, draft.sound ?? 'paper', custom)
    sampleRef.current.play()
  }

  const apply = () => {
    const used = new Set([draft.backgroundImageAssetId, draft.logoAssetId, draft.soundAssetId].filter(Boolean) as string[])
    onApply(draft, Object.values(newAssets).filter((asset) => used.has(asset.id)))
  }

  const flipSeconds = ((draft.flipSpeed ?? FLIP_PRESETS[draft.flip ?? 'smooth'].time) / 1000).toFixed(2)

  return (
    <div className="theme-backdrop">
      <div className="theme-dialog" role="dialog" aria-modal="true" aria-label="Flipbook design">
        <header className="theme-head">
          <div>
            <h2>Flipbook design</h2>
            <span>How readers see this publication — in Preview, exports and online.</span>
          </div>
        </header>
        <div className="theme-body">
          <div className="theme-controls">
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
                  <small>Tip: a soft, blurred photo works best. The colour above shows while it loads.</small>
                </div>
              )}
            </section>

            <section>
              <h3>Toolbar</h3>
              <ColorField label="Toolbar" value={draft.toolbar} onChange={(toolbar) => set({ toolbar })} />
              <ColorField label="Icons and text" value={draft.toolbarText} allowAlpha={false} onChange={(toolbarText) => set({ toolbarText })} />
              <ColorField label="Buttons" value={draft.button} onChange={(button) => set({ button })} />
              <ColorField label="Accent (highlights)" value={draft.accent} allowAlpha={false} onChange={(accent) => set({ accent })} />
            </section>

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
              <label className="theme-check">
                <input type="checkbox" checked={(draft.cover ?? 'soft') === 'soft'} onChange={(event) => set({ cover: event.target.checked ? 'soft' : 'hard' })} />
                Soft cover (the first page bends like paper)
              </label>
              <label className="theme-check">
                <input type="checkbox" checked={draft.pageShadow !== false} onChange={(event) => set({ pageShadow: event.target.checked })} />
                Shadow while turning
              </label>
              <label className="theme-check">
                <input type="checkbox" checked={draft.bookShadow !== false} onChange={(event) => set({ bookShadow: event.target.checked })} />
                Book shadow on the background
              </label>
            </section>

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
              <small>Readers can mute it with the speaker button. Browsers only play sound after the reader's first click or swipe.</small>
            </section>

            <section>
              <h3>Reader tools</h3>
              <label className="theme-check">
                <input type="checkbox" checked={draft.thumbnails !== false} onChange={(event) => set({ thumbnails: event.target.checked })} />
                “All pages” button (thumbnails and go to page)
              </label>
              <label className="theme-check">
                <input type="checkbox" checked={draft.textTools !== false} onChange={(event) => set({ textTools: event.target.checked })} />
                Search and Select text (when the PDF has text)
              </label>
            </section>

            <section>
              <h3>Logo (optional)</h3>
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
              <small>Leave empty for an unbranded catalogue.</small>
            </section>
            {problem && <p className="theme-error" role="alert">{problem}</p>}
          </div>
          <div className="theme-preview">
            <div className="theme-preview-label">Live preview{project.pages.length > PREVIEW_PAGES ? ` (first ${PREVIEW_PAGES} pages)` : ''} — try turning pages</div>
            <PreviewPane project={previewProject} startPage={0} />
          </div>
        </div>
        <footer className="theme-foot">
          <button type="button" className="link-button" onClick={() => setDraft({ ...DEFAULT_READER })}>Reset to default</button>
          <span className="spacer" />
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" onClick={apply}>Apply design</button>
        </footer>
      </div>
    </div>
  )
}
