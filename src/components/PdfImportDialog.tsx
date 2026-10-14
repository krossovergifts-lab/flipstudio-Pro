import { useEffect, useRef, useState } from 'react'
import { CATEGORIES } from '../lib/library'
import { DEFAULT_PDF_OPTIONS, inspectPdf, QUALITY_PRESETS, type PdfImportOptions, type PdfInspection, type PdfQuality } from '../lib/pdfImport'
import type { ReaderSettings } from '../lib/project'
import { formatBytes } from '../lib/assets'
import './PdfImportDialog.css'

export interface PdfBookInfo {
  title: string
  description: string
  category: string
  keywords: string
  reader: ReaderSettings
  /** Replacing the PDF of an existing publication: keep its objects, animations and design. */
  keepObjects?: boolean
  /** Readers may download this PDF from the flipbook. */
  allowDownload?: boolean
}

export interface PdfImportDialogProps {
  file: File
  /** Pre-filled details (e.g. the open publication's when re-importing in the editor). */
  initial?: Partial<PdfBookInfo>
  confirmLabel?: string
  /** Set when the publication already has pages with objects: offers "Replace PDF, keep my objects". */
  replace?: { pageCount: number; objectCount: number }
  /** Making a new edition (e.g. 2028) of this publication: it keeps the design and can take over its link. */
  edition?: { sourceTitle: string; objectCount: number; live: boolean }
  onCancel: () => void
  onImport: (options: PdfImportOptions, info: PdfBookInfo) => void
}

const READER_THEMES: Array<{ id: string; label: string; background: string; toolbar: string }> = [
  { id: 'midnight', label: 'Midnight', background: '#0b1220', toolbar: '#0f172a' },
  { id: 'graphite', label: 'Graphite', background: '#1f2937', toolbar: '#111827' },
  { id: 'paper', label: 'Paper', background: '#e7e5e4', toolbar: '#44403c' },
  { id: 'ocean', label: 'Ocean', background: '#0c4a6e', toolbar: '#082f49' },
  { id: 'forest', label: 'Forest', background: '#14532d', toolbar: '#052e16' },
]

const fileTitle = (file: File) => file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Imported publication'

/** "Add new book" wizard shown before a PDF is imported: book info, text layer, image quality and reader look. */
export function PdfImportDialog({ file, initial, confirmLabel = 'Import PDF', replace, edition, onCancel, onImport }: PdfImportDialogProps) {
  const [keepObjects, setKeepObjects] = useState(Boolean(replace) && !edition)
  const [allowDownload, setAllowDownload] = useState(false)
  const [inspection, setInspection] = useState<PdfInspection | null>(null)
  const [inspectError, setInspectError] = useState('')
  const [title, setTitle] = useState(initial?.title ?? fileTitle(file))
  const [titleTouched, setTitleTouched] = useState(Boolean(initial?.title))
  const [description, setDescription] = useState(initial?.description ?? '')
  const [category, setCategory] = useState(initial?.category || 'Catalogue')
  const [keywords, setKeywords] = useState(initial?.keywords ?? '')
  const [text, setText] = useState(DEFAULT_PDF_OPTIONS.text)
  const [quality, setQuality] = useState<PdfQuality>(DEFAULT_PDF_OPTIONS.quality)
  const [background, setBackground] = useState(initial?.reader?.background ?? READER_THEMES[0].background)
  const [toolbar, setToolbar] = useState(initial?.reader?.toolbar ?? READER_THEMES[0].toolbar)
  const dialogRef = useRef<HTMLFormElement | null>(null)

  useEffect(() => {
    let cancelled = false
    inspectPdf(file)
      .then((result) => {
        if (cancelled) return
        setInspection(result)
        if (!result.hasText) setText(false)
        if (result.title && !titleTouched && !initial?.title && result.title.length < 120 && !/^untitled|^microsoft|\.(indd|docx?|pdf)$/i.test(result.title)) setTitle(result.title)
      })
      .catch((err: unknown) => {
        if (!cancelled) setInspectError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
    // Inspect once per file; later typing must not re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('input')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCancel() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    onImport(
      { text: text && inspection?.hasText !== false, quality },
      { title: title.trim() || fileTitle(file), description: description.trim(), category, keywords: keywords.trim(), reader: (keepObjects || edition) && initial?.reader ? initial.reader : { ...(initial?.reader ?? {}), background, toolbar, textTools: true }, keepObjects, allowDownload },
    )
  }

  const categories = CATEGORIES.includes(category) ? CATEGORIES : [category, ...CATEGORIES]
  const noText = inspection && !inspection.hasText

  return (
    <div className="pdf-wizard-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <form className="pdf-wizard" role="dialog" aria-modal="true" aria-label="Import PDF" ref={dialogRef} onSubmit={submit}>
        <header className="pdf-wizard-head">
          <h2>{edition ? 'New edition' : 'Add new book'}</h2>
          <div className="pdf-wizard-file">
            <span className="pdf-wizard-icon" aria-hidden="true">PDF</span>
            <div>
              <strong>{file.name}</strong>
              <span data-testid="pdf-wizard-summary">
                {formatBytes(file.size)}
                {inspection ? ` · ${inspection.pageCount} page${inspection.pageCount === 1 ? '' : 's'} · ${inspection.hasText ? 'contains text' : 'no text layer (scanned or outlined)'}` : inspectError ? ' · could not read details' : ' · reading…'}
              </span>
            </div>
          </div>
        </header>

        <div className="pdf-wizard-body">
          {edition && (
            <section>
              <h3>New edition of “{edition.sourceTitle}”</h3>
              <div className="pdf-wizard-choices" role="radiogroup" aria-label="What to keep">
                <label className={`pdf-choice${!keepObjects ? ' is-selected' : ''}`}>
                  <input type="radio" name="pdf-keep" checked={!keepObjects} onChange={() => setKeepObjects(false)} />
                  <strong>Keep the design <em>Recommended</em></strong>
                  <span>New pages with the same theme, logo, page turn, sound, SEO and analytics. Add new hotspots for the new products.</span>
                </label>
                <label className={`pdf-choice${keepObjects ? ' is-selected' : ''}`}>
                  <input type="radio" name="pdf-keep" checked={keepObjects} onChange={() => setKeepObjects(true)} />
                  <strong>Keep the design and objects</strong>
                  <span>Also keeps the {edition.objectCount} object{edition.objectCount === 1 ? '' : 's'}, bookmarks and animations on the same page numbers.</span>
                </label>
              </div>
              <p className="pdf-wizard-note pdf-wizard-info">{edition.live ? `“${edition.sourceTitle}” stays in your library. When you publish the new edition, it takes over the same link, so everyone who has the old link sees the new catalogue.` : `“${edition.sourceTitle}” stays in your library unchanged.`}</p>
            </section>
          )}

          {replace && (
            <section>
              <h3>New version of this publication</h3>
              <div className="pdf-wizard-choices" role="radiogroup" aria-label="Objects">
                <label className={`pdf-choice${keepObjects ? ' is-selected' : ''}`}>
                  <input type="radio" name="pdf-keep" checked={keepObjects} onChange={() => setKeepObjects(true)} />
                  <strong>Replace PDF, keep my work <em>Recommended</em></strong>
                  <span>The {replace.objectCount} object{replace.objectCount === 1 ? '' : 's'}, animations, links and design stay on the same page numbers. Use this when the catalogue PDF was updated.</span>
                </label>
                <label className={`pdf-choice${!keepObjects ? ' is-selected' : ''}`}>
                  <input type="radio" name="pdf-keep" checked={!keepObjects} onChange={() => setKeepObjects(false)} />
                  <strong>Start again</strong>
                  <span>Removes all objects and animations (you can Undo).</span>
                </label>
              </div>
            </section>
          )}

          <section>
            <h3>Book info</h3>
            <label>
              Title
              <input value={title} onChange={(event) => { setTitle(event.target.value); setTitleTouched(true) }} maxLength={160} required />
            </label>
            <label>
              Description
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={600} placeholder="Shown on the shared link preview and the online bookshelf" />
            </label>
            <div className="pdf-wizard-row">
              <label>
                Category
                <select value={category} onChange={(event) => setCategory(event.target.value)}>
                  {categories.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              <label>
                Keywords
                <input value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="e.g. spring, catalogue, offers" />
              </label>
            </div>
            <label className="pdf-wizard-check">
              <input type="checkbox" checked={allowDownload} onChange={(event) => setAllowDownload(event.target.checked)} />
              <span>Allow readers to download this PDF <small>{formatBytes(file.size)}{file.size > 25 * 1024 * 1024 ? ' — over 25 MB: online, use a smaller PDF (Design → Share & download)' : ''}</small></span>
            </label>
          </section>

          <section>
            <h3>PDF text</h3>
            <div className="pdf-wizard-choices" role="radiogroup" aria-label="PDF text">
              <label className={`pdf-choice${text ? ' is-selected' : ''}${noText ? ' is-disabled' : ''}`}>
                <input type="radio" name="pdf-text" checked={text} disabled={Boolean(noText)} onChange={() => setText(true)} />
                <strong>Keep text — selectable &amp; searchable <em>Recommended</em></strong>
                <span>Readers can select, copy and search the text. Search engines can read it too. The page still looks exactly like the PDF.</span>
              </label>
              <label className={`pdf-choice${!text ? ' is-selected' : ''}`}>
                <input type="radio" name="pdf-text" checked={!text} onChange={() => setText(false)} />
                <strong>Images only</strong>
                <span>Pages are pictures; text can’t be copied. Slightly smaller files.</span>
              </label>
            </div>
            {noText && <p className="pdf-wizard-note">This PDF has no text layer (for example a scan, or text converted to outlines), so pages will be images only. To make it selectable, run OCR on the PDF first (Acrobat: “Scan &amp; OCR”).</p>}
          </section>

          <section>
            <h3>Page image quality</h3>
            <div className="pdf-wizard-choices three" role="radiogroup" aria-label="Page image quality">
              {(Object.keys(QUALITY_PRESETS) as PdfQuality[]).map((id) => (
                <label key={id} className={`pdf-choice${quality === id ? ' is-selected' : ''}`}>
                  <input type="radio" name="pdf-quality" checked={quality === id} onChange={() => setQuality(id)} />
                  <strong>{QUALITY_PRESETS[id].label}{id === 'web' && <em>Recommended</em>}</strong>
                  <span>{QUALITY_PRESETS[id].description}</span>
                </label>
              ))}
            </div>
          </section>

          {!keepObjects && !edition && <section>
            <h3>Reader look</h3>
            <div className="pdf-wizard-themes" role="radiogroup" aria-label="Reader theme">
              {READER_THEMES.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  role="radio"
                  aria-checked={background === theme.background && toolbar === theme.toolbar}
                  className="pdf-theme"
                  onClick={() => { setBackground(theme.background); setToolbar(theme.toolbar) }}
                >
                  <span className="pdf-theme-swatch" style={{ background: theme.background }}><span style={{ background: theme.toolbar }} /></span>
                  {theme.label}
                </button>
              ))}
            </div>
            <div className="pdf-wizard-row">
              <label>
                Background colour
                <input type="color" value={background} onChange={(event) => setBackground(event.target.value)} />
              </label>
              <label>
                Toolbar colour
                <input type="color" value={toolbar} onChange={(event) => setToolbar(event.target.value)} />
              </label>
            </div>
          </section>}
        </div>

        <footer className="pdf-wizard-foot">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary" disabled={!inspection && !inspectError}>{inspection || inspectError ? confirmLabel : 'Reading PDF…'}</button>
        </footer>
      </form>
    </div>
  )
}
