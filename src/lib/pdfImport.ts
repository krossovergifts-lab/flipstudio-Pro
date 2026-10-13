import type { PageDefinition, PageTextItem } from './project'

// PDF.js is loaded on first import (code-split) with the same worker configuration as before.
let pdfjsModule: Promise<typeof import('pdfjs-dist')> | null = null
function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  pdfjsModule ??= import('pdfjs-dist').then((pdfjsLib) => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString()
    return pdfjsLib
  })
  return pdfjsModule
}

export type PdfQuality = 'web' | 'high' | 'max'

export interface PdfImportOptions {
  /** Keep the PDF's text as a selectable, copyable, searchable layer. */
  text: boolean
  quality: PdfQuality
}

export const DEFAULT_PDF_OPTIONS: PdfImportOptions = { text: true, quality: 'web' }

/** Target rendered page width in pixels and JPEG quality for each preset. */
export const QUALITY_PRESETS: Record<PdfQuality, { label: string; description: string; width: number; jpeg: number }> = {
  web: { label: 'Web optimised', description: 'Sharp on laptops and phones, small files (about 150–300 KB per page).', width: 1400, jpeg: 0.82 },
  high: { label: 'High quality', description: 'Crisp when readers zoom in (about 300–600 KB per page).', width: 2000, jpeg: 0.9 },
  max: { label: 'Maximum', description: 'For print-like detail; large files (about 0.6–1.5 MB per page).', width: 2600, jpeg: 0.95 },
}

function getDocument(pdfjsLib: typeof import('pdfjs-dist'), data: ArrayBuffer) {
  return pdfjsLib.getDocument({
    data,
    wasmUrl: `${window.location.origin}/pdfjs/wasm/`,
    cMapUrl: `${window.location.origin}/pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${window.location.origin}/pdfjs/standard_fonts/`,
    useWorkerFetch: true,
  }).promise
}

type Matrix = [number, number, number, number, number, number]
function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
}

interface RawTextItem {
  str?: string
  transform?: number[]
  width?: number
  hasEOL?: boolean
  fontName?: string
}

/**
 * Converts PDF.js text items into page-unit boxes (top-left origin), the same
 * units as object x/y, so the reader can lay text over the page image.
 */
export function toPageText(items: RawTextItem[], styles: Record<string, { ascent?: number; fontFamily?: string }>, viewportTransform: Matrix): PageTextItem[] {
  const out: PageTextItem[] = []
  for (const item of items) {
    if (typeof item.str !== 'string' || !item.transform) continue
    if (!item.str) {
      if (item.hasEOL && out.length) out[out.length - 1].eol = true
      continue
    }
    const tx = multiply(viewportTransform, item.transform as Matrix)
    const height = Math.hypot(tx[2], tx[3])
    if (!height) continue
    const angle = Math.atan2(tx[1], tx[0])
    const style = (item.fontName && styles[item.fontName]) || {}
    const ascent = typeof style.ascent === 'number' && style.ascent > 0 ? style.ascent : 0.8
    const left = tx[4] + height * ascent * Math.sin(angle)
    const top = tx[5] - height * ascent * Math.cos(angle)
    const round = (value: number) => Math.round(value * 10) / 10
    const entry: PageTextItem = { s: item.str, x: round(left), y: round(top), w: round(item.width ?? 0), h: round(height) }
    if (Math.abs(angle) > 0.001) entry.a = Math.round((angle * 180) / Math.PI * 10) / 10
    const family = (style.fontFamily ?? '').toLowerCase()
    if (family.includes('serif') && !family.includes('sans')) entry.f = 'serif'
    else if (family.includes('mono')) entry.f = 'monospace'
    if (item.hasEOL) entry.eol = true
    out.push(entry)
  }
  return out
}

export interface PdfInspection {
  pageCount: number
  hasText: boolean
  title?: string
}

/** Quick look at a PDF before importing: page count, whether it has real text, its title. */
export async function inspectPdf(file: File): Promise<PdfInspection> {
  const [data, pdfjsLib] = await Promise.all([file.arrayBuffer(), loadPdfjs()])
  const pdf = await getDocument(pdfjsLib, data)
  let hasText = false
  for (let index = 1; index <= Math.min(pdf.numPages, 3) && !hasText; index += 1) {
    const page = await pdf.getPage(index)
    const content = page.getTextContent ? await page.getTextContent() : { items: [] }
    hasText = (content.items as RawTextItem[]).some((item) => typeof item.str === 'string' && item.str.trim().length > 0)
  }
  let title: string | undefined
  try {
    const metadata = pdf.getMetadata ? await pdf.getMetadata() : null
    const info = metadata?.info as { Title?: string } | undefined
    title = info?.Title?.trim() || undefined
  } catch {
    title = undefined
  }
  return { pageCount: pdf.numPages, hasText, title }
}

/**
 * Renders every page of a PDF into a page image (JPEG at the chosen quality) and,
 * when requested, keeps its text as positioned items for selection and search.
 */
export async function importPdfPages(
  file: File,
  options: PdfImportOptions = DEFAULT_PDF_OPTIONS,
  onProgress?: (page: number, total: number) => void,
): Promise<{ title: string; pages: PageDefinition[]; textPages: number }> {
  const [data, pdfjsLib] = await Promise.all([file.arrayBuffer(), loadPdfjs()])
  const pdf = await getDocument(pdfjsLib, data)
  const preset = QUALITY_PRESETS[options.quality] ?? QUALITY_PRESETS.web
  const imported: PageDefinition[] = []
  let textPages = 0

  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const pdfPage = await pdf.getPage(pageIndex)
    const pageSize = pdfPage.getViewport({ scale: 1 })
    const renderScale = Math.min(4, Math.max(0.5, preset.width / pageSize.width))
    const viewport = pdfPage.getViewport({ scale: renderScale })
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')

    if (!context) {
      throw new Error(`Canvas rendering is unavailable for PDF page ${pageIndex}.`)
    }

    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    // JPEG has no transparency: paint white first so transparent PDF areas stay white.
    if (typeof context.fillRect === 'function') {
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
    }
    await pdfPage.render({ canvas, canvasContext: context, viewport }).promise

    const page: PageDefinition = {
      id: `pdf-page-${pageIndex}`,
      name: `Page ${pageIndex}`,
      width: pageSize.width,
      height: pageSize.height,
      pdfPageNumber: pageIndex,
      previewUrl: canvas.toDataURL('image/jpeg', preset.jpeg),
      overlays: [],
    }
    if (options.text && pdfPage.getTextContent) {
      const content = await pdfPage.getTextContent()
      const transform = (pageSize.transform as Matrix | undefined) ?? [1, 0, 0, -1, 0, pageSize.height]
      const text = toPageText(content.items as RawTextItem[], (content.styles ?? {}) as Record<string, { ascent?: number; fontFamily?: string }>, transform)
      if (text.length) {
        page.text = text
        textPages += 1
      }
    }
    // Release the canvas memory right away; large catalogues have many pages.
    canvas.width = 0
    canvas.height = 0
    imported.push(page)
    onProgress?.(pageIndex, pdf.numPages)
  }

  if (!imported.length) {
    throw new Error('No PDF pages were successfully rendered.')
  }
  return { title: file.name.replace(/\.[^/.]+$/, '') || 'Imported publication', pages: imported, textPages }
}
