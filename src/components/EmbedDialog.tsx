import { useEffect, useState } from 'react'
import { coverSnippet, iframeSnippet, popupSnippet } from '../lib/embed'
import { Icon } from './Icon'
import './EmbedDialog.css'

type Kind = 'inline' | 'popup' | 'cover'

const KINDS: Array<{ id: Kind; title: string; hint: string }> = [
  { id: 'inline', title: 'Flipbook on the page', hint: 'Readers flip it right inside your page' },
  { id: 'popup', title: 'Button that opens it', hint: 'A button; the catalogue opens in a pop-up' },
  { id: 'cover', title: 'Cover picture link', hint: 'The cover image, opens it in a new tab' },
]

/** Embed code for company websites (WordPress, Shopify, Wix, plain HTML). */
export function EmbedDialog({ url, title, pageCount, onClose }: { url: string; title: string; pageCount: number; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('inline')
  const [height, setHeight] = useState<'window' | number>('window')
  const [startPage, setStartPage] = useState(1)
  const [label, setLabel] = useState('View our catalogue')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const code = kind === 'inline' ? iframeSnippet(url, title, { height, startPage }) : kind === 'popup' ? popupSnippet(url, title, label) : coverSnippet(url, title)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy the embed code:', code)
    }
  }

  return (
    <div className="embed-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="embed-dialog" role="dialog" aria-modal="true" aria-label="Embed on a website">
        <header className="embed-head">
          <h2>Embed on a website</h2>
          <span>Paste this code into any page of your company website.</span>
        </header>
        <div className="embed-body">
          <div className="embed-kinds" role="radiogroup" aria-label="Embed type">
            {KINDS.map((item) => (
              <button key={item.id} type="button" role="radio" aria-checked={kind === item.id} onClick={() => setKind(item.id)}>
                <strong>{item.title}</strong>
                <small>{item.hint}</small>
              </button>
            ))}
          </div>
          {kind === 'inline' && (
            <div className="embed-options">
              <label>
                Height
                <select value={height === 'window' ? 'window' : String(height)} onChange={(event) => setHeight(event.target.value === 'window' ? 'window' : Number(event.target.value))} aria-label="Height">
                  <option value="window">Fit the screen (recommended)</option>
                  <option value="500">500 px</option>
                  <option value="650">650 px</option>
                  <option value="800">800 px</option>
                </select>
              </label>
              <label>
                Open at page
                <input type="number" min={1} max={pageCount} value={startPage} onChange={(event) => setStartPage(Math.max(1, Math.min(pageCount, Math.floor(Number(event.target.value) || 1))))} aria-label="Open at page" />
              </label>
            </div>
          )}
          {kind === 'popup' && (
            <div className="embed-options">
              <label className="embed-grow">
                Button text
                <input value={label} onChange={(event) => setLabel(event.target.value)} aria-label="Button text" />
              </label>
            </div>
          )}
          <label className="embed-code">
            Embed code
            <textarea readOnly value={code} rows={kind === 'popup' ? 7 : 4} onFocus={(event) => event.currentTarget.select()} aria-label="Embed code" spellCheck={false} />
          </label>
          <details className="embed-help">
            <summary>Where to paste it</summary>
            <ul>
              <li><b>WordPress</b>: edit the page → <b>+</b> → <b>Custom HTML</b> block → paste → Update.</li>
              <li><b>Shopify</b>: Online Store → Pages → the page → <b>Show HTML</b> (&lt;&gt;) → paste → Save.</li>
              <li><b>Wix</b>: Add → <b>Embed code</b> → Embed HTML → Code → paste.</li>
              <li><b>Webflow / Squarespace</b>: add an <b>Embed</b> / <b>Code</b> block and paste.</li>
              <li><b>Your own site</b>: paste it into the HTML where the flipbook should appear.</li>
            </ul>
          </details>
        </div>
        <footer className="embed-foot">
          <button type="button" onClick={onClose}>Close</button>
          <button type="button" className="primary" onClick={() => void copy()}><Icon name="code" />{copied ? 'Copied ✓' : 'Copy code'}</button>
        </footer>
      </div>
    </div>
  )
}
