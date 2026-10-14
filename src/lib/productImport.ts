import type { LinkAction } from '../runtime/styles.js'
import type { OverlayObject, PageDefinition, ProjectState } from './project'

/** One product row from the spreadsheet. */
export interface ProductRow {
  row: number
  sku: string
  page?: number
  name: string
  price: string
  description: string
  link: string
  whatsapp: string
  button: string
  image: string
}

export type ProductField = Exclude<keyof ProductRow, 'row'>

const HEADERS: Record<ProductField, RegExp> = {
  sku: /^(sku|code|item ?code|product ?code|item ?no\.?|item|ref(erence)?|article|model)$/,
  page: /^(page|page ?no\.?|page ?number|pg)$/,
  name: /^(name|title|product|product ?name|item ?name)$/,
  price: /^(price|rate|cost|unit ?price|price ?\(.*\))$/,
  description: /^(description|desc|details|info|features)$/,
  link: /^(link|url|website|product ?link|product ?url|web ?link)$/,
  whatsapp: /^(whatsapp|whatsapp ?(no\.?|number)|phone|mobile)$/,
  button: /^(button|button ?(text|label)|cta)$/,
  image: /^(image|image ?url|photo|picture|img)$/,
}

export const TEMPLATE_ROWS: string[][] = [
  ['SKU', 'Page', 'Name', 'Price', 'Description', 'Link', 'WhatsApp', 'Button'],
  ['KG-1001', '4', 'Bamboo Tumbler 450 ml', 'AED 18', 'Double wall, leak-proof lid, laser logo', 'https://www.example.com/products/kg-1001', '', 'View product'],
  ['KG-1002', '4', 'Steel Bottle 750 ml', 'AED 24', 'Keeps drinks cold for 24 hours', '', '971500000000', 'Ask for a quote'],
]

/** Maps header cells to fields; unknown columns are ignored. */
export function mapHeaders(header: string[]): Partial<Record<ProductField, number>> {
  const map: Partial<Record<ProductField, number>> = {}
  header.forEach((cell, index) => {
    const key = cell.toLowerCase().replace(/[_*:]/g, ' ').replace(/\s+/g, ' ').trim()
    for (const field of Object.keys(HEADERS) as ProductField[]) {
      if (map[field] === undefined && HEADERS[field].test(key)) { map[field] = index; break }
    }
  })
  return map
}

export function rowsToProducts(rows: string[][]): { products: ProductRow[]; problems: string[] } {
  const problems: string[] = []
  const headerIndex = rows.findIndex((row) => { const m = mapHeaders(row); return m.sku !== undefined || m.name !== undefined })
  if (headerIndex < 0) return { products: [], problems: ['No header row found. The first row needs column names such as SKU, Page, Name, Price, Link.'] }
  const map = mapHeaders(rows[headerIndex])
  const get = (row: string[], field: ProductField) => (map[field] !== undefined ? (row[map[field]!] ?? '').trim() : '')
  const products: ProductRow[] = []
  rows.slice(headerIndex + 1).forEach((row, i) => {
    const sku = get(row, 'sku')
    const name = get(row, 'name')
    if (!sku && !name) return
    const pageText = get(row, 'page')
    const page = pageText ? Math.floor(Number(pageText.replace(/[^\d.]/g, ''))) : undefined
    if (pageText && !(page && page > 0)) problems.push(`Row ${headerIndex + i + 2}: “${pageText}” is not a page number.`)
    products.push({ row: headerIndex + i + 2, sku, page: page && page > 0 ? page : undefined, name, price: get(row, 'price'), description: get(row, 'description'), link: get(row, 'link'), whatsapp: get(row, 'whatsapp'), button: get(row, 'button'), image: get(row, 'image') })
  })
  return { products, problems }
}

export interface ImportSettings {
  /** "icon": a small marker on the product code; "area": an invisible clickable area over it. */
  look: 'icon' | 'area'
  /** Marker colour. */
  color: string
  /** WhatsApp number used when a row has no link and no WhatsApp number of its own. */
  defaultWhatsapp: string
  /** Delete earlier imported hotspots whose SKU is no longer in the sheet. */
  removeMissing: boolean
}

export interface ImportReport {
  added: number
  updated: number
  removed: number
  /** Rows placed by page number because the code was not found in the page text. */
  placedByPage: string[]
  /** Rows that could not be placed (no page and code not found). */
  skipped: string[]
}

const squash = (value: string) => value.toLowerCase().replace(/[\s\-_./]+/g, '')

/** Where a product code appears in the PDF text of a page (page units), if anywhere. */
export function findCode(page: PageDefinition, code: string): { x: number; y: number; w: number; h: number } | null {
  const wanted = code.trim().toLowerCase()
  if (wanted.length < 2 || !page.text?.length) return null
  const whole = new RegExp(`(^|[^a-z0-9])${wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`)
  let best: { item: NonNullable<PageDefinition['text']>[number]; at: number; length: number; score: number } | null = null
  for (const item of page.text) {
    const text = item.s.toLowerCase()
    let at = text.indexOf(wanted)
    let length = wanted.length
    let score = at >= 0 ? (whole.test(text) ? 3 : 2) : 0
    if (at < 0 && squash(text).includes(squash(wanted))) { at = 0; length = text.length; score = 1 }
    if (score > (best?.score ?? 0)) best = { item, at, length, score }
    if (score === 3) break
  }
  if (!best) return null
  const { item } = best
  const chars = Math.max(1, item.s.length)
  return { x: item.x + (item.w * best.at) / chars, y: item.y, w: Math.max((item.w * best.length) / chars, item.h * 1.5), h: item.h }
}

const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`

function productLink(product: ProductRow, settings: ImportSettings): LinkAction | undefined {
  if (product.link) return { type: 'url', value: product.link, newTab: true }
  const number = (product.whatsapp || settings.defaultWhatsapp).replace(/\D/g, '')
  if (number.length >= 7) {
    const what = [product.sku, product.name].filter(Boolean).join(' — ')
    return { type: 'whatsapp', value: number, message: `Hi, I'm interested in ${what}. Please send me a quote.` }
  }
  return undefined
}

/**
 * Adds or updates one product hotspot (with a pop-up) per spreadsheet row. Rows are
 * matched to earlier imports by SKU, so re-importing an updated sheet updates prices
 * and links without duplicating hotspots or moving ones you placed by hand.
 */
export function applyProducts(project: ProjectState, products: ProductRow[], settings: ImportSettings): { project: ProjectState; report: ImportReport } {
  const report: ImportReport = { added: 0, updated: 0, removed: 0, placedByPage: [], skipped: [] }
  const pages = project.pages.map((page) => ({ ...page, overlays: [...page.overlays] }))
  const existing = new Map<string, { pageIndex: number; index: number }>()
  pages.forEach((page, pageIndex) => page.overlays.forEach((overlay, index) => { if (overlay.sku) existing.set(squash(overlay.sku), { pageIndex, index }) }))
  const seen = new Set<string>()
  const fallbackCount = new Map<number, number>()
  for (const product of products) {
    const key = squash(product.sku || product.name)
    if (seen.has(key)) continue
    seen.add(key)
    const link = productLink(product, settings)
    const popup = {
      title: product.name || product.sku,
      description: [product.sku && product.name ? product.sku : '', product.description].filter(Boolean).join(' · '),
      price: product.price || undefined,
      imageUrl: /^https?:\/\//i.test(product.image) ? product.image : undefined,
      buttonLabel: product.button || (link?.type === 'whatsapp' ? 'Ask on WhatsApp' : link ? 'View product' : undefined),
      link,
    }
    const tooltip = [product.name || product.sku, product.price].filter(Boolean).join(' · ')
    const found = existing.get(key)
    if (found) {
      const current = pages[found.pageIndex].overlays[found.index]
      // Only what the sheet fills in changes; empty cells keep what is there (e.g. edited by hand).
      const prev = current.popup ?? { title: '', description: '' }
      const ownLink = Boolean(product.link || product.whatsapp)
      const merged = {
        ...prev,
        title: product.name || prev.title || popup.title,
        description: product.description ? popup.description : prev.description,
        price: product.price || prev.price,
        imageUrl: popup.imageUrl ?? prev.imageUrl,
        link: ownLink || !prev.link ? popup.link ?? prev.link : prev.link,
        buttonLabel: product.button || (ownLink ? popup.buttonLabel : prev.buttonLabel ?? popup.buttonLabel),
      }
      const tip = [merged.title, merged.price].filter(Boolean).join(' · ')
      pages[found.pageIndex].overlays[found.index] = { ...current, label: product.sku || current.label, tooltip: tip, popup: merged, link: { type: 'popup' } }
      report.updated += 1
      continue
    }
    // Where: the page from the sheet (or every page when none is given), at the product code.
    const candidates = product.page ? [product.page - 1] : pages.map((_, index) => index)
    let pageIndex = -1
    let box: ReturnType<typeof findCode> = null
    for (const index of candidates) {
      const page = pages[index]
      if (!page) continue
      box = product.sku ? findCode(page, product.sku) : null
      if (box) { pageIndex = index; break }
    }
    const label = product.sku || product.name
    if (pageIndex < 0) {
      if (!product.page || !pages[product.page - 1]) {
        report.skipped.push(`Row ${product.row}: ${label} — ${product.page ? `page ${product.page} does not exist` : 'code not found on any page; add a Page number'}`)
        continue
      }
      pageIndex = product.page - 1
      report.placedByPage.push(`${label} (page ${product.page})`)
    }
    const page = pages[pageIndex]
    const size = Math.round(page.width * 0.036)
    let geometry: Pick<OverlayObject, 'x' | 'y' | 'width' | 'height'>
    if (box && settings.look === 'area') {
      const padX = box.h * 0.6
      const padY = box.h * 0.45
      geometry = { x: Math.max(0, box.x - padX), y: Math.max(0, box.y - padY), width: Math.min(page.width, box.w + padX * 2), height: box.h + padY * 2 }
    } else if (box) {
      geometry = { x: Math.min(page.width - size, box.x + box.w + box.h * 0.4), y: Math.max(0, box.y + box.h / 2 - size / 2), width: size, height: size }
    } else {
      // Not found in the text: stack along the right edge of the page for the user to drag into place.
      const n = fallbackCount.get(pageIndex) ?? 0
      fallbackCount.set(pageIndex, n + 1)
      geometry = { x: page.width - size * 2.2, y: page.height * 0.08 + n * size * 1.5, width: size, height: size }
    }
    const icon = settings.look === 'icon' || !box
    const overlay: OverlayObject = {
      id: newId('hotspot'),
      type: 'hotspot',
      label,
      sku: product.sku || product.name,
      ...geometry,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      fit: 'cover',
      tooltip,
      popup,
      link: { type: 'popup' },
      effect: icon ? 'beacon' : undefined,
      hoverEffect: icon ? undefined : 'highlight',
      style: icon
        ? { background: 'transparent', borderWidth: 0, borderStyle: 'solid', shape: 'circle', radius: 999, marker: 'plus', markerColor: '#ffffff', markerBackground: settings.color, showLabel: false }
        : { background: 'transparent', borderWidth: 0, borderStyle: 'solid', radius: 4, showLabel: false },
    }
    page.overlays.push(overlay)
    report.added += 1
  }
  if (settings.removeMissing) {
    for (const page of pages) {
      const before = page.overlays.length
      page.overlays = page.overlays.filter((overlay) => !overlay.sku || seen.has(squash(overlay.sku)))
      report.removed += before - page.overlays.length
    }
  }
  const keptIds = new Set(pages.flatMap((page) => page.overlays.map((overlay) => overlay.id)))
  return { project: { ...project, pages, animations: project.animations.filter((animation) => keptIds.has(animation.targetId)) }, report }
}
