import { skinClassName, skinStyle, styleFor, type ObjectStyle, type LinkAction, type LinkType } from '../runtime/styles.js'
import { findFont, type FontDefinition, type FontCategory } from '../lib/fonts'
import { BUTTON_PRESETS, EFFECT_LABELS, HOTSPOT_PRESETS, HOVER_LABELS, TEXT_PRESETS, type StylePreset } from '../lib/stylePresets'
import { resolveSource, type OverlayObject, type PopupContent, type ProjectState } from '../lib/project'
import { ColorField } from './ColorField'
import { NumberField } from './NumberField'

type Change = (changes: Partial<OverlayObject>, mergeKey?: string) => void

interface StyleInspectorProps {
  overlay: OverlayObject
  fonts: FontDefinition[]
  assets: ProjectState['assets']
  pageCount: number
  onChange: Change
  onImportFont: () => void
  onPickPopupImage: () => void
  cropping?: boolean
  onToggleCrop?: () => void
}

const FRAME_PRESETS: Array<{ label: string; style: Partial<ObjectStyle> }> = [
  { label: 'Square', style: { shape: 'rect', radius: 0 } },
  { label: 'Soft', style: { shape: 'rounded', radius: 12 } },
  { label: 'Rounded', style: { shape: 'rounded', radius: 28 } },
  { label: 'Extra round', style: { shape: 'rounded', radius: 60 } },
  { label: 'Circle', style: { shape: 'circle' } },
]

const CATEGORY_ORDER: FontCategory[] = ['Imported', 'Sans serif', 'Serif', 'Display', 'Script', 'Arabic', 'System']

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string; title?: string }>; onChange: (value: T) => void }) {
  return (
    <div className="seg-field">
      <span className="seg-label">{label}</span>
      <div className="seg-buttons" role="group" aria-label={label}>
        {options.map((option) => (
          <button key={option.value} type="button" className={value === option.value ? 'active' : ''} aria-pressed={value === option.value} title={option.title ?? option.label} onClick={() => onChange(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function PresetGallery({ presets, overlay, fonts, onApply }: { presets: StylePreset[]; overlay: OverlayObject; fonts: FontDefinition[]; onApply: (preset: StylePreset) => void }) {
  const page = { width: 300, height: 120 }
  return (
    <div className="preset-grid" role="group" aria-label="Style presets">
      {presets.map((preset) => {
        const sample: OverlayObject = { ...overlay, style: { ...preset.style }, effect: undefined, hoverEffect: undefined, fontSize: overlay.type === 'hotspot' ? 26 : Math.min(40, Math.max(18, (preset.fontSize ?? 28) * 0.6)) }
        const look = styleFor(sample)
        return (
          <button key={preset.id} type="button" className="preset-tile" title={preset.label} aria-label={`Apply ${preset.label} preset`} onClick={() => onApply(preset)}>
            <span className={`preset-canvas ${overlay.type}`}>
              <span className={skinClassName(sample)} style={skinStyle(sample, page, findFont(look.fontFamily, fonts).stack) as React.CSSProperties}>
                {overlay.type === 'hotspot'
                  ? look.marker && look.marker !== 'none' ? <span className="fs-marker" data-marker={look.marker} /> : null
                  : <span className="fs-text">{overlay.type === 'button' ? 'Shop now' : 'Aa Text'}</span>}
              </span>
            </span>
            <span className="preset-name">{preset.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function LinkEditor({ link, onChange, pageCount, allowPopup }: { link: LinkAction | undefined; onChange: (link: LinkAction | undefined, mergeKey?: string) => void; pageCount: number; allowPopup: boolean }) {
  const type: LinkType = link?.type ?? 'none'
  const set = (patch: Partial<LinkAction>, mergeKey?: string) => onChange({ type, ...link, ...patch } as LinkAction, mergeKey)
  const value = link?.value ?? ''
  return (
    <div className="link-editor">
      <label>
        When clicked
        <select
          value={type}
          onChange={(event) => {
            const next = event.target.value as LinkType
            onChange(next === 'none' ? undefined : { type: next, value: next === link?.type ? link?.value : next === 'page' ? '1' : '', newTab: true })
          }}
        >
          <option value="none">Do nothing</option>
          <option value="url">Open web page</option>
          <option value="page">Go to page</option>
          <option value="whatsapp">Open WhatsApp chat</option>
          <option value="email">Send email</option>
          <option value="phone">Call phone number</option>
          {allowPopup && <option value="popup">Show product pop-up</option>}
        </select>
      </label>
      {type === 'url' && (
        <>
          <label>
            Web address
            <input type="url" placeholder="www.example.com" value={value} onChange={(event) => set({ value: event.target.value }, 'link-value')} aria-invalid={Boolean(value) && /^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:/i.test(value)} />
          </label>
          <label className="check">
            <input type="checkbox" checked={link?.newTab !== false} onChange={(event) => set({ newTab: event.target.checked })} />
            Open in a new tab
          </label>
        </>
      )}
      {type === 'page' && (
        <NumberField label={`Page number (1–${pageCount})`} min={1} max={pageCount} step={1} value={Number(value) || 1} onCommit={(page) => set({ value: String(Math.min(pageCount, Math.max(1, Math.round(page)))) }, 'link-page')} />
      )}
      {type === 'whatsapp' && (
        <>
          <label>
            WhatsApp number (with country code)
            <input type="tel" placeholder="+971 50 123 4567" value={value} onChange={(event) => set({ value: event.target.value }, 'link-value')} />
          </label>
          <label>
            Pre-filled message (optional)
            <textarea rows={2} value={link?.message ?? ''} onChange={(event) => set({ message: event.target.value }, 'link-message')} />
          </label>
        </>
      )}
      {type === 'email' && (
        <>
          <label>
            Email address
            <input type="email" placeholder="sales@example.com" value={value} onChange={(event) => set({ value: event.target.value }, 'link-value')} />
          </label>
          <label>
            Subject (optional)
            <input value={link?.subject ?? ''} onChange={(event) => set({ subject: event.target.value }, 'link-subject')} />
          </label>
        </>
      )}
      {type === 'phone' && (
        <label>
          Phone number
          <input type="tel" placeholder="+971 4 123 4567" value={value} onChange={(event) => set({ value: event.target.value }, 'link-value')} />
        </label>
      )}
    </div>
  )
}

function PopupEditor({ popup, assets, pageCount, onChange, onPickImage }: { popup: PopupContent; assets: ProjectState['assets']; pageCount: number; onChange: (popup: PopupContent, mergeKey?: string) => void; onPickImage: () => void }) {
  const set = (patch: Partial<PopupContent>, mergeKey?: string) => onChange({ ...popup, ...patch }, mergeKey)
  const image = popup.assetId ? resolveSource({ assets }, { assetId: popup.assetId }) : ''
  return (
    <div className="popup-editor">
      <label>
        Pop-up title
        <input value={popup.title} onChange={(event) => set({ title: event.target.value }, 'popup-title')} />
      </label>
      <label>
        Price (optional)
        <input value={popup.price ?? ''} placeholder="AED 149" onChange={(event) => set({ price: event.target.value }, 'popup-price')} />
      </label>
      <label>
        Description
        <textarea rows={3} value={popup.description} onChange={(event) => set({ description: event.target.value }, 'popup-description')} />
      </label>
      <div className="popup-image-row">
        {image ? <img src={image} alt="" /> : <span className="muted small">No image</span>}
        <button type="button" onClick={onPickImage}>{image ? 'Change image' : 'Add image'}</button>
        {image && <button type="button" onClick={() => set({ assetId: undefined })}>Remove</button>}
      </div>
      <label>
        Button label
        <input value={popup.buttonLabel ?? ''} placeholder="Enquire now" onChange={(event) => set({ buttonLabel: event.target.value }, 'popup-button')} />
      </label>
      <LinkEditor link={popup.link} pageCount={pageCount} allowPopup={false} onChange={(link, mergeKey) => set({ link }, mergeKey)} />
    </div>
  )
}

export function StyleInspector({ overlay, fonts, assets, pageCount, onChange, onImportFont, onPickPopupImage, cropping, onToggleCrop }: StyleInspectorProps) {
  const styled = overlay.type === 'text' || overlay.type === 'button' || overlay.type === 'hotspot'
  const look = styleFor(overlay)
  const setStyle = (patch: Partial<ObjectStyle>, mergeKey?: string) => onChange({ style: { ...overlay.style, ...patch } }, mergeKey ? `style-${mergeKey}` : undefined)
  const presets = overlay.type === 'button' ? BUTTON_PRESETS : overlay.type === 'hotspot' ? HOTSPOT_PRESETS : TEXT_PRESETS
  const showTypography = overlay.type !== 'hotspot' || look.showLabel
  const fillMode = look.gradient ? 'gradient' : look.background === 'transparent' ? 'none' : 'solid'
  const font = findFont(look.fontFamily, fonts)

  const applyPreset = (preset: StylePreset) =>
    onChange({
      style: { ...overlay.style, ...preset.style, gradient: preset.style.gradient ?? null, textGradient: preset.style.textGradient ?? null },
      fontSize: preset.fontSize ?? overlay.fontSize,
      effect: preset.effect ?? 'none',
      hoverEffect: preset.hoverEffect ?? 'none',
    })

  const framed = overlay.type === 'image' || overlay.type === 'slideshow'
  const frame = overlay.style ?? {}
  const frameShape = frame.shape ?? (Number(frame.radius) > 0 ? 'rounded' : 'rect')
  const crop = { zoom: 1, x: 50, y: 50, ...overlay.crop }

  return (
    <>
      {framed && (
        <details className="inspector-section collapsible" open>
          <summary><h3>Frame</h3></summary>
          <div className="frame-presets" role="group" aria-label="Corner presets">
            {FRAME_PRESETS.map((preset) => {
              const active = preset.style.shape === 'circle' ? frameShape === 'circle' : frameShape !== 'circle' && (preset.style.radius ?? 0) === (frameShape === 'rect' ? 0 : Number(frame.radius) || 0)
              return (
                <button key={preset.label} type="button" className={active ? 'active' : ''} aria-pressed={active} onClick={() => setStyle(preset.style)} title={preset.label}>
                  <span className="frame-swatch" style={{ borderRadius: preset.style.shape === 'circle' ? '50%' : `${Math.min(14, (preset.style.radius ?? 0) / 4)}px` }} />
                  <span>{preset.label}</span>
                </button>
              )
            })}
          </div>
          {frameShape !== 'circle' && (
            <label>
              Corner radius ({Math.round(Number(frame.radius) || 0)})
              <input type="range" min={0} max={Math.round(Math.min(overlay.width, overlay.height) / 2)} value={frameShape === 'rect' ? 0 : Number(frame.radius) || 0} onChange={(event) => setStyle({ shape: Number(event.target.value) > 0 ? 'rounded' : 'rect', radius: Number(event.target.value) }, 'frame-radius')} />
            </label>
          )}
          <div className="field-grid">
            <NumberField label="Border width" min={0} value={Number(frame.borderWidth) || 0} onCommit={(borderWidth) => setStyle({ borderWidth: Math.max(0, borderWidth) }, 'frame-border')} />
            <label>
              Shadow
              <select value={frame.shadow ?? 'none'} onChange={(event) => setStyle({ shadow: event.target.value as ObjectStyle['shadow'] })}>
                <option value="none">None</option>
                <option value="soft">Soft</option>
                <option value="medium">Medium</option>
                <option value="strong">Strong</option>
                <option value="glow">Coloured glow</option>
              </select>
            </label>
          </div>
          {Number(frame.borderWidth) > 0 && <ColorField label="Border colour" value={frame.borderColor ?? '#ffffff'} onChange={(borderColor, key) => setStyle({ borderColor }, key)} />}
          {frame.shadow === 'glow' && <ColorField label="Glow colour" value={frame.effectColor ?? '#3b82f6'} allowAlpha={false} onChange={(effectColor, key) => setStyle({ effectColor }, key)} />}
        </details>
      )}

      {framed && (
        <details className="inspector-section collapsible" open>
          <summary><h3>Crop</h3></summary>
          <button type="button" className={cropping ? 'primary block' : 'block'} onClick={onToggleCrop} aria-pressed={Boolean(cropping)}>
            {cropping ? 'Done cropping' : 'Crop on canvas'}
          </button>
          <p className="muted small">Or double-click the picture. Drag to reposition, scroll to zoom.</p>
          <label>
            Zoom ({Math.round(crop.zoom * 100)}%)
            <input type="range" min={1} max={5} step={0.01} value={crop.zoom} onChange={(event) => onChange({ crop: { ...crop, zoom: Number(event.target.value) } }, 'crop-zoom')} />
          </label>
          <label>
            Horizontal position ({Math.round(crop.x)}%)
            <input type="range" min={0} max={100} step={0.5} value={crop.x} onChange={(event) => onChange({ crop: { ...crop, x: Number(event.target.value) } }, 'crop-x')} />
          </label>
          <label>
            Vertical position ({Math.round(crop.y)}%)
            <input type="range" min={0} max={100} step={0.5} value={crop.y} onChange={(event) => onChange({ crop: { ...crop, y: Number(event.target.value) } }, 'crop-y')} />
          </label>
          <button type="button" className="link-button" onClick={() => onChange({ crop: undefined })} disabled={!overlay.crop}>Reset crop</button>
        </details>
      )}

      {styled && (
        <details className="inspector-section collapsible" open>
          <summary><h3>Presets</h3></summary>
          <PresetGallery presets={presets} overlay={overlay} fonts={fonts} onApply={applyPreset} />
        </details>
      )}

      {styled && showTypography && (
        <details className="inspector-section collapsible" open>
          <summary><h3>Text &amp; font</h3></summary>
          {overlay.type === 'text' && (
            <label>
              Text
              <textarea rows={3} dir="auto" value={overlay.label} onChange={(event) => onChange({ label: event.target.value }, 'label')} />
            </label>
          )}
          <label>
            Font
            <select value={font.id} onChange={(event) => setStyle({ fontFamily: event.target.value, fontWeight: findFont(event.target.value, fonts).weights.includes(look.fontWeight) ? look.fontWeight : findFont(event.target.value, fonts).weights[0] })} style={{ fontFamily: font.stack }}>
              {CATEGORY_ORDER.map((category) => {
                const group = fonts.filter((candidate) => candidate.category === category)
                if (!group.length) return null
                return (
                  <optgroup key={category} label={category}>
                    {group.map((candidate) => <option key={candidate.id} value={candidate.id} style={{ fontFamily: candidate.stack }}>{candidate.name}</option>)}
                  </optgroup>
                )
              })}
            </select>
          </label>
          <div className="font-preview" style={{ fontFamily: font.stack, fontWeight: look.fontWeight }} dir="auto">
            {font.category === 'Arabic' ? 'هدايا الشركات · Gifts' : 'The quick brown fox · 0123'}
          </div>
          <button type="button" className="link-button" onClick={onImportFont}>+ Import font file (.ttf, .otf, .woff, .woff2)</button>
          <div className="field-grid">
            <NumberField label="Size" min={6} value={overlay.fontSize ?? 32} onCommit={(value) => onChange({ fontSize: Math.max(6, value) }, 'font-size')} />
            <label>
              Weight
              <select value={look.fontWeight} onChange={(event) => setStyle({ fontWeight: Number(event.target.value) })}>
                {(font.category === 'System' ? [400, 700] : font.weights).map((weight) => <option key={weight} value={weight}>{weight >= 700 ? 'Bold' : 'Regular'}</option>)}
              </select>
            </label>
          </div>
          <div className="toggle-row" role="group" aria-label="Text format">
            <button type="button" className={look.fontWeight >= 700 ? 'active' : ''} aria-pressed={look.fontWeight >= 700} title="Bold" onClick={() => setStyle({ fontWeight: look.fontWeight >= 700 ? 400 : 700 })}><b>B</b></button>
            <button type="button" className={look.italic ? 'active' : ''} aria-pressed={look.italic} title="Italic" onClick={() => setStyle({ italic: !look.italic })}><i>I</i></button>
            <button type="button" className={look.underline ? 'active' : ''} aria-pressed={look.underline} title="Underline" onClick={() => setStyle({ underline: !look.underline })}><u>U</u></button>
            <button type="button" className={look.uppercase ? 'active' : ''} aria-pressed={look.uppercase} title="All caps" onClick={() => setStyle({ uppercase: !look.uppercase })}>AA</button>
          </div>
          <Segmented
            label="Align"
            value={look.textAlign}
            onChange={(textAlign) => setStyle({ textAlign })}
            options={[{ value: 'left', label: '⇤', title: 'Align left' }, { value: 'center', label: '↔', title: 'Centre' }, { value: 'right', label: '⇥', title: 'Align right' }, { value: 'justify', label: '☰', title: 'Justify' }]}
          />
          <Segmented
            label="Vertical"
            value={look.verticalAlign}
            onChange={(verticalAlign) => setStyle({ verticalAlign })}
            options={[{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }]}
          />
          <ColorField label="Text colour" value={look.color} allowAlpha={false} onChange={(color, key) => setStyle({ color }, key)} />
          <div className="field-grid">
            <NumberField label="Line height" min={0.6} max={3} step={0.05} value={look.lineHeight} onCommit={(lineHeight) => setStyle({ lineHeight }, 'line-height')} />
            <NumberField label="Letter spacing (em)" min={-0.1} max={1} step={0.01} value={look.letterSpacing} onCommit={(letterSpacing) => setStyle({ letterSpacing }, 'letter-spacing')} />
          </div>
          <label>
            Text effect
            <select value={look.textEffect} onChange={(event) => setStyle({ textEffect: event.target.value as ObjectStyle['textEffect'] })}>
              <option value="none">None</option>
              <option value="shadow">Soft shadow</option>
              <option value="hard">Hard shadow</option>
              <option value="glow">Glow</option>
              <option value="outline">Outline</option>
              <option value="emboss">Emboss</option>
            </select>
          </label>
          {look.textEffect !== 'none' && look.textEffect !== 'shadow' && look.textEffect !== 'emboss' && (
            <ColorField label="Effect colour" value={look.effectColor} allowAlpha={false} onChange={(effectColor, key) => setStyle({ effectColor }, key)} />
          )}
          <label className="check">
            <input type="checkbox" checked={Boolean(look.textGradient)} onChange={(event) => setStyle({ textGradient: event.target.checked ? { from: '#b8860b', to: '#f5d77a', angle: 120 } : null })} />
            Gradient text
          </label>
          {look.textGradient && (
            <div className="field-grid">
              <ColorField label="From" value={look.textGradient.from} allowAlpha={false} onChange={(from, key) => setStyle({ textGradient: { ...look.textGradient!, from } }, key)} />
              <ColorField label="To" value={look.textGradient.to} allowAlpha={false} onChange={(to, key) => setStyle({ textGradient: { ...look.textGradient!, to } }, key)} />
            </div>
          )}
        </details>
      )}

      {styled && (
        <details className="inspector-section collapsible" open={overlay.type !== 'text'}>
          <summary><h3>{overlay.type === 'button' ? 'Button style' : overlay.type === 'hotspot' ? 'Hotspot style' : 'Background & border'}</h3></summary>
          <Segmented
            label="Fill"
            value={fillMode}
            onChange={(mode) => setStyle(mode === 'none' ? { background: 'transparent', gradient: null } : mode === 'solid' ? { background: look.background === 'transparent' ? '#2563eb' : look.background, gradient: null } : { gradient: look.gradient ?? { from: '#6366f1', to: '#ec4899', angle: 120 } })}
            options={[{ value: 'none', label: 'None' }, { value: 'solid', label: 'Solid' }, { value: 'gradient', label: 'Gradient' }]}
          />
          {fillMode === 'solid' && <ColorField label="Fill colour" value={look.background} onChange={(background, key) => setStyle({ background }, key)} />}
          {fillMode === 'gradient' && look.gradient && (
            <>
              <div className="field-grid">
                <ColorField label="Gradient from" value={look.gradient.from} onChange={(from, key) => setStyle({ gradient: { ...look.gradient!, from } }, key)} />
                <ColorField label="Gradient to" value={look.gradient.to} onChange={(to, key) => setStyle({ gradient: { ...look.gradient!, to } }, key)} />
              </div>
              <NumberField label="Gradient angle (°)" min={0} max={360} step={15} value={look.gradient.angle} onCommit={(angle) => setStyle({ gradient: { ...look.gradient!, angle } }, 'gradient-angle')} />
            </>
          )}
          {overlay.type === 'hotspot' ? (
            <Segmented
              label="Shape"
              value={look.shape ?? 'rounded'}
              onChange={(shape) => setStyle({ shape })}
              options={[{ value: 'rect', label: 'Square' }, { value: 'rounded', label: 'Rounded' }, { value: 'pill', label: 'Pill' }, { value: 'circle', label: 'Circle' }]}
            />
          ) : (
            <NumberField label="Corner radius" min={0} value={look.radius} onCommit={(radius) => setStyle({ radius: Math.max(0, radius) }, 'radius')} />
          )}
          {overlay.type === 'hotspot' && look.shape === 'rounded' && (
            <NumberField label="Corner radius" min={0} value={look.radius} onCommit={(radius) => setStyle({ radius: Math.max(0, radius) }, 'radius')} />
          )}
          <div className="field-grid">
            <NumberField label="Border width" min={0} value={look.borderWidth} onCommit={(borderWidth) => setStyle({ borderWidth: Math.max(0, borderWidth) }, 'border-width')} />
            <label>
              Border style
              <select value={look.borderStyle} onChange={(event) => setStyle({ borderStyle: event.target.value as ObjectStyle['borderStyle'] })}>
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </select>
            </label>
          </div>
          {look.borderWidth > 0 && <ColorField label="Border colour" value={look.borderColor} onChange={(borderColor, key) => setStyle({ borderColor }, key)} />}
          <div className="field-grid">
            <NumberField label="Padding" min={0} value={look.padding} onCommit={(padding) => setStyle({ padding: Math.max(0, padding) }, 'padding')} />
            <label>
              Shadow
              <select value={look.shadow} onChange={(event) => setStyle({ shadow: event.target.value as ObjectStyle['shadow'] })}>
                <option value="none">None</option>
                <option value="soft">Soft</option>
                <option value="medium">Medium</option>
                <option value="strong">Strong</option>
                <option value="glow">Coloured glow</option>
              </select>
            </label>
          </div>
        </details>
      )}

      {overlay.type === 'hotspot' && (
        <details className="inspector-section collapsible" open>
          <summary><h3>Hotspot</h3></summary>
          <label>
            In the publication
            <select value={look.reveal ?? 'always'} onChange={(event) => setStyle({ reveal: event.target.value as ObjectStyle['reveal'] })}>
              <option value="always">Always visible</option>
              <option value="hover">Appears on hover</option>
              <option value="never">Invisible (click area only)</option>
            </select>
          </label>
          <label>
            Marker icon
            <select value={look.marker ?? 'none'} onChange={(event) => setStyle({ marker: event.target.value as ObjectStyle['marker'] })}>
              <option value="none">None</option>
              <option value="dot">Dot</option>
              <option value="plus">Plus +</option>
              <option value="info">Info i</option>
              <option value="cart">Shopping cart</option>
              <option value="eye">Eye</option>
              <option value="play">Play ▶</option>
              <option value="star">Star ★</option>
            </select>
          </label>
          {look.marker && look.marker !== 'none' && (
            <div className="field-grid">
              <ColorField label="Marker" value={look.markerBackground} allowAlpha={false} onChange={(markerBackground, key) => setStyle({ markerBackground }, key)} />
              <ColorField label="Icon" value={look.markerColor} allowAlpha={false} onChange={(markerColor, key) => setStyle({ markerColor }, key)} />
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={Boolean(look.showLabel)} onChange={(event) => setStyle({ showLabel: event.target.checked })} />
            Show label text inside the hotspot
          </label>
        </details>
      )}

      {overlay.type !== 'slideshow' && (
        <details className="inspector-section collapsible" open={styled}>
          <summary><h3>Effects</h3></summary>
          <div className="field-grid">
            <label>
              Attention effect
              <select value={overlay.effect ?? 'none'} onChange={(event) => onChange({ effect: event.target.value as OverlayObject['effect'] })}>
                {Object.entries(EFFECT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              On hover
              <select value={overlay.hoverEffect ?? 'none'} onChange={(event) => onChange({ hoverEffect: event.target.value as OverlayObject['hoverEffect'] })}>
                {Object.entries(HOVER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
          {styled && (overlay.effect === 'glow' || overlay.effect === 'ripple' || overlay.hoverEffect === 'glow' || look.shadow === 'glow') && (
            <ColorField label="Glow colour" value={look.effectColor} allowAlpha={false} onChange={(effectColor, key) => setStyle({ effectColor }, key)} />
          )}
          <p className="muted small">Effects loop in Preview and exports. Use timeline animations for entrances and exits.</p>
        </details>
      )}

      {overlay.type !== 'slideshow' && (
        <details className="inspector-section collapsible" open={overlay.type === 'button' || overlay.type === 'hotspot'}>
          <summary><h3>Click action</h3></summary>
          <LinkEditor
            link={overlay.link}
            pageCount={pageCount}
            allowPopup
            onChange={(link, mergeKey) => onChange({ link, url: undefined, popup: link?.type === 'popup' ? overlay.popup ?? { title: overlay.label, description: '' } : overlay.popup }, mergeKey)}
          />
          {overlay.link?.type === 'popup' && overlay.popup && (
            <PopupEditor popup={overlay.popup} assets={assets} pageCount={pageCount} onPickImage={onPickPopupImage} onChange={(popup, mergeKey) => onChange({ popup }, mergeKey)} />
          )}
          <label>
            Tooltip on hover (optional)
            <input value={overlay.tooltip ?? ''} placeholder="e.g. Tap to see colours" onChange={(event) => onChange({ tooltip: event.target.value || undefined }, 'tooltip')} />
          </label>
        </details>
      )}
    </>
  )
}
