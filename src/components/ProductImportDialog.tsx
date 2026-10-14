import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectState } from '../lib/project'
import { applyProducts, mapHeaders, rowsToProducts, TEMPLATE_ROWS, type ImportReport, type ImportSettings, type ProductField } from '../lib/productImport'
import { readSheet, writeXlsx } from '../lib/sheets'
import { saveExport } from '../lib/exporters'
import { Icon } from './Icon'
import './ProductImportDialog.css'

interface ProductImportDialogProps {
  project: ProjectState
  onCancel: () => void
  onApply: (project: ProjectState, report: ImportReport) => void
}

const FIELD_LABELS: Record<ProductField, string> = { sku: 'SKU / code', page: 'Page', name: 'Name', price: 'Price', description: 'Description', link: 'Link', whatsapp: 'WhatsApp', button: 'Button text', image: 'Image URL' }
const SETTINGS_KEY = 'fs-product-import'

function loadSettings(): ImportSettings {
  const fallback: ImportSettings = { look: 'icon', color: '#c8a46b', defaultWhatsapp: '', removeMissing: false }
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<ImportSettings> | null
    return { ...fallback, ...(saved ?? {}), removeMissing: false }
  } catch {
    return fallback
  }
}

/** Product hotspots from a spreadsheet: each row becomes a clickable marker with a product pop-up. */
export function ProductImportDialog({ project, onCancel, onApply }: ProductImportDialogProps) {
  const [rows, setRows] = useState<string[][] | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [settings, setSettings] = useState<ImportSettings>(loadSettings)
  const [report, setReport] = useState<ImportReport | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const hasText = project.pages.some((page) => page.text?.length)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel() } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  const parsed = useMemo(() => (rows ? rowsToProducts(rows) : null), [rows])
  const columns = useMemo(() => {
    if (!rows) return []
    const header = rows.find((row) => { const m = mapHeaders(row); return m.sku !== undefined || m.name !== undefined }) ?? []
    const map = mapHeaders(header)
    return (Object.keys(FIELD_LABELS) as ProductField[]).map((field) => ({ field, found: map[field] !== undefined, header: map[field] !== undefined ? header[map[field]!] : '' }))
  }, [rows])
  const existingCount = project.pages.reduce((total, page) => total + page.overlays.filter((overlay) => overlay.sku).length, 0)

  const choose = async (file: File | undefined) => {
    if (!file) return
    setError('')
    setReport(null)
    try {
      const data = await readSheet(file)
      if (!data.length) throw new Error('The sheet is empty.')
      setRows(data)
      setFileName(file.name)
    } catch (err) {
      setRows(null)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const apply = () => {
    if (!parsed?.products.length) return
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, removeMissing: false })) } catch { /* optional */ }
    const result = applyProducts(project, parsed.products, settings)
    setReport(result.report)
    onApply(result.project, result.report)
  }

  const template = async () => {
    try {
      const blob = await writeXlsx(TEMPLATE_ROWS)
      await saveExport(new Uint8Array(await blob.arrayBuffer()), 'flipstudio-products-template.xlsx', 'Excel workbook', blob.type)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="products-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <div className="products-dialog" role="dialog" aria-modal="true" aria-label="Product hotspots from a spreadsheet">
        <header className="products-head">
          <div>
            <h2>Product hotspots from a spreadsheet</h2>
            <span>Each row becomes a clickable marker on its product, with a pop-up showing the name, price, description and a link or WhatsApp button.</span>
          </div>
        </header>

        <div className="products-body">
          {!report && (
            <>
              <section className="products-file">
                <button type="button" className="primary" onClick={() => inputRef.current?.click()}><Icon name="table" />{rows ? 'Choose another file…' : 'Choose Excel or CSV file…'}</button>
                <input ref={inputRef} type="file" accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden data-testid="products-input" onChange={(event) => { void choose(event.target.files?.[0]); event.target.value = '' }} />
                <button type="button" onClick={() => void template()}><Icon name="download" />Download template</button>
                {fileName && <span className="products-filename">{fileName}</span>}
              </section>
              {!rows && !error && (
                <p className="products-hint">
                  Columns: <b>SKU</b> (the product code as printed in the catalogue), <b>Page</b>, <b>Name</b>, <b>Price</b>, <b>Description</b>, <b>Link</b>, <b>WhatsApp</b>, <b>Button</b>. Only SKU (or Name) is required.
                  {hasText ? ' The app finds each code in the page text and puts the marker right next to it.' : ' This PDF has no text layer, so markers are placed by page number for you to drag into position.'}
                </p>
              )}
              {error && <p className="products-error" role="alert">{error}</p>}

              {parsed && (
                <>
                  <section>
                    <h3>Columns found</h3>
                    <ul className="products-columns">
                      {columns.map((column) => (
                        <li key={column.field} className={column.found ? 'is-found' : ''}>
                          <span>{FIELD_LABELS[column.field]}</span>
                          <small>{column.found ? `“${column.header}”` : 'not in the sheet'}</small>
                        </li>
                      ))}
                    </ul>
                    <p className="products-summary"><strong>{parsed.products.length}</strong> product{parsed.products.length === 1 ? '' : 's'} in the sheet{existingCount ? ` · ${existingCount} imported hotspot${existingCount === 1 ? '' : 's'} already in this publication (matching SKUs are updated, not duplicated)` : ''}.</p>
                    {parsed.problems.map((problem) => <p key={problem} className="products-warn">{problem}</p>)}
                    {parsed.products.length > 0 && (
                      <div className="products-table-wrap">
                        <table className="products-table">
                          <thead><tr><th>SKU</th><th>Page</th><th>Name</th><th>Price</th><th>Click goes to</th></tr></thead>
                          <tbody>
                            {parsed.products.slice(0, 6).map((product) => (
                              <tr key={product.row}>
                                <td>{product.sku}</td>
                                <td>{product.page ?? 'find'}</td>
                                <td>{product.name}</td>
                                <td>{product.price}</td>
                                <td>{product.link ? product.link.replace(/^https?:\/\//, '') : product.whatsapp || settings.defaultWhatsapp ? 'WhatsApp' : 'Pop-up only'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {parsed.products.length > 6 && <small>…and {parsed.products.length - 6} more</small>}
                      </div>
                    )}
                  </section>

                  <section>
                    <h3>How they look</h3>
                    <div className="products-looks" role="radiogroup" aria-label="Hotspot look">
                      <button type="button" role="radio" aria-checked={settings.look === 'icon'} onClick={() => setSettings({ ...settings, look: 'icon' })}>
                        <span className="products-look-demo"><span>KG-1001</span><i style={{ background: settings.color }}>+</i></span>
                        <strong>Marker next to the code</strong>
                        <small>A small pulsing + readers can tap</small>
                      </button>
                      <button type="button" role="radio" aria-checked={settings.look === 'area'} onClick={() => setSettings({ ...settings, look: 'area' })}>
                        <span className="products-look-demo is-area"><span>KG-1001</span></span>
                        <strong>Invisible area over the code</strong>
                        <small>The code itself becomes clickable</small>
                      </button>
                    </div>
                    <div className="products-row">
                      <label>
                        Marker colour
                        <input type="color" value={settings.color} onChange={(event) => setSettings({ ...settings, color: event.target.value })} aria-label="Marker colour" />
                      </label>
                      <label className="products-grow">
                        WhatsApp for rows without a link
                        <input value={settings.defaultWhatsapp} onChange={(event) => setSettings({ ...settings, defaultWhatsapp: event.target.value })} placeholder="e.g. 971 52 677 6884" inputMode="tel" aria-label="Default WhatsApp number" />
                      </label>
                    </div>
                    {existingCount > 0 && (
                      <label className="products-check">
                        <input type="checkbox" checked={settings.removeMissing} onChange={(event) => setSettings({ ...settings, removeMissing: event.target.checked })} />
                        <span>Remove imported hotspots whose SKU is no longer in this sheet</span>
                      </label>
                    )}
                  </section>
                </>
              )}
            </>
          )}

          {report && (
            <section className="products-report" role="status">
              <h3>Done</h3>
              <p><strong>{report.added}</strong> added · <strong>{report.updated}</strong> updated{report.removed ? <> · <strong>{report.removed}</strong> removed</> : null}</p>
              {report.placedByPage.length > 0 && (
                <div className="products-warn">
                  <strong>{report.placedByPage.length} placed by page number</strong> (code not found in the text) — they are on the right edge of their page; drag them onto the product:
                  <ul>{report.placedByPage.slice(0, 12).map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
              )}
              {report.skipped.length > 0 && (
                <div className="products-error">
                  <strong>{report.skipped.length} not added</strong>
                  <ul>{report.skipped.slice(0, 12).map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
              )}
              <p className="products-hint">Use Undo to take the import back. Edit any hotspot's pop-up in the inspector; re-importing the sheet later updates prices and links.</p>
            </section>
          )}
        </div>

        <footer className="products-foot">
          {report ? (
            <button type="button" className="primary" onClick={onCancel}>Close</button>
          ) : (
            <>
              <button type="button" onClick={onCancel}>Cancel</button>
              <button type="button" className="primary" disabled={!parsed?.products.length} onClick={apply}>
                {parsed?.products.length ? `Create ${parsed.products.length} hotspot${parsed.products.length === 1 ? '' : 's'}` : 'Create hotspots'}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}
