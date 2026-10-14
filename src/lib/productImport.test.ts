import { describe, expect, it } from 'vitest'
import { createProject, PROJECT_VERSION } from './project'
import { applyProducts, findCode, rowsToProducts } from './productImport'
import { parseCsv, readSheet, writeXlsx } from './sheets'

const page = (id: string, text: Array<{ s: string; x: number; y: number }>) => ({ id, name: id, width: 600, height: 800, overlays: [], text: text.map((t) => ({ ...t, w: t.s.length * 6, h: 10 })) })
const project = () => createProject({ version: PROJECT_VERSION, title: 'T', pages: [page('p1', [{ s: 'Cover', x: 10, y: 10 }]), page('p2', [{ s: 'Item KG-1001 · Bamboo tumbler', x: 100, y: 200 }, { s: 'KG-1002', x: 100, y: 300 }])] })
const settings = { look: 'icon' as const, color: '#c8a46b', defaultWhatsapp: '971500000000', removeMissing: false }

describe('spreadsheets', () => {
  it('reads CSV with quotes, semicolons and BOM-less text', () => {
    expect(parseCsv('SKU,Name\n"KG-1","Mug, white ""large"""\n')).toEqual([['SKU', 'Name'], ['KG-1', 'Mug, white "large"']])
    expect(parseCsv('SKU;Price\nA1;12,50')).toEqual([['SKU', 'Price'], ['A1', '12,50']])
  })
  it('writes an .xlsx that reads back', async () => {
    const blob = await writeXlsx([['SKU', 'Page'], ['KG-1001', '2'], ['', 'x']])
    const rows = await readSheet(Object.assign(blob, { name: 'p.xlsx' }))
    expect(rows).toEqual([['SKU', 'Page'], ['KG-1001', '2'], ['', 'x']])
  })
})

describe('product hotspots', () => {
  it('maps headers and finds codes in the page text', () => {
    const { products } = rowsToProducts([['Item Code', 'Page No', 'Product Name', 'Price', 'URL'], ['KG-1001', '2', 'Tumbler', 'AED 18', 'https://x.com/p']])
    expect(products[0]).toMatchObject({ sku: 'KG-1001', page: 2, name: 'Tumbler', price: 'AED 18', link: 'https://x.com/p' })
    const box = findCode(project().pages[1], 'kg-1001')
    expect(box && box.x).toBeGreaterThan(100)
    expect(box && box.y).toBe(200)
  })
  it('creates hotspots with pop-ups, updates them on re-import and reports misses', () => {
    const rows = [['SKU', 'Page', 'Name', 'Price', 'Link'], ['KG-1001', '', 'Tumbler', 'AED 18', 'https://x.com/a'], ['KG-1002', '2', 'Bottle', 'AED 24', ''], ['ZZ-9', '1', 'Pen', '', ''], ['QQ-1', '', 'Ghost', '', '']]
    const first = applyProducts(project(), rowsToProducts(rows).products, settings)
    expect(first.report).toMatchObject({ added: 3, updated: 0 })
    expect(first.report.placedByPage).toEqual(['ZZ-9 (page 1)'])
    expect(first.report.skipped[0]).toContain('QQ-1')
    const spots = first.project.pages[1].overlays
    expect(spots.map((o) => o.sku)).toEqual(['KG-1001', 'KG-1002'])
    expect(spots[0].popup).toMatchObject({ title: 'Tumbler', price: 'AED 18', link: { type: 'url', value: 'https://x.com/a' } })
    expect(spots[1].popup?.link).toMatchObject({ type: 'whatsapp', value: '971500000000' })
    expect(spots[0].link).toEqual({ type: 'popup' })
    // Re-import with a new price: updated in place, not duplicated; a removed row is deleted when asked.
    const moved = { ...first.project, pages: first.project.pages.map((p) => ({ ...p, overlays: p.overlays.map((o) => (o.sku === 'KG-1001' ? { ...o, x: 5 } : o)) })) }
    const again = applyProducts(moved, rowsToProducts([['SKU', 'Price'], ['KG-1001', 'AED 16']]).products, { ...settings, removeMissing: true })
    expect(again.report).toMatchObject({ added: 0, updated: 1, removed: 2 })
    const kept = again.project.pages[1].overlays[0]
    expect(kept.x).toBe(5)
    expect(kept.popup).toMatchObject({ price: 'AED 16', title: 'Tumbler', link: { type: 'url', value: 'https://x.com/a' } })
  })
})
