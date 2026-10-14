import { describe, expect, it } from 'vitest'
import { applyNewPdf, nextEditionTitle } from './edition'
import { createProject, PROJECT_VERSION } from './project'
import { coverSnippet, iframeSnippet, popupSnippet } from './embed'

describe('new edition', () => {
  it('suggests next year in the title', () => {
    expect(nextEditionTitle('Promotional Gifts 2027')).toBe('Promotional Gifts 2028')
    expect(nextEditionTitle('2026 Catalogue – edition 2027')).toBe('2026 Catalogue – edition 2028')
    expect(nextEditionTitle('Gift Guide')).toBe('Gift Guide — new edition')
  })
  it('keeps design, SEO and tracking but not the old pages, objects or PDF download', () => {
    const old = createProject({
      version: PROJECT_VERSION,
      title: 'Gifts 2027',
      reader: { accent: '#c8a46b', analyticsId: 'G-ABC123', seoTitle: 'Gifts', downloadAssetId: 'asset-old', downloadName: 'old.pdf' },
      pages: [{ id: 'p1', name: 'Page 1', width: 595, height: 842, bookmark: { label: 'Bags' }, overlays: [{ id: 'o1', type: 'hotspot', label: 'x', x: 1, y: 1, width: 10, height: 10, rotation: 0, opacity: 1, visible: true }] }],
    })
    const imported = [{ id: 'n1', name: 'Page 1', width: 595, height: 842, overlays: [] }, { id: 'n2', name: 'Page 2', width: 595, height: 842, overlays: [] }]
    const fresh = applyNewPdf(old, imported, { title: 'Gifts 2028', description: '', category: 'Catalogue', keywords: '', reader: old.reader! }).project
    expect(fresh.pages).toHaveLength(2)
    expect(fresh.pages[0].overlays).toHaveLength(0)
    expect(fresh.pages[0].bookmark).toBeUndefined()
    expect(fresh.reader).toMatchObject({ accent: '#c8a46b', analyticsId: 'G-ABC123', seoTitle: 'Gifts' })
    expect(fresh.reader?.downloadAssetId).toBeUndefined()
    const kept = applyNewPdf(old, imported, { title: 'Gifts 2028', description: '', category: 'Catalogue', keywords: '', reader: old.reader!, keepObjects: true }).project
    expect(kept.pages[0].overlays.map((o) => o.id)).toEqual(['o1'])
    expect(kept.pages[0].bookmark?.label).toBe('Bags')
  })
})

describe('embed code', () => {
  it('builds iframe, cover and pop-up snippets', () => {
    const url = 'https://cat.pages.dev/'
    expect(iframeSnippet(url, 'Cat "2028"', { height: 'window', startPage: 5 })).toContain('src="https://cat.pages.dev/?embed=1#page=5" title="Cat &quot;2028&quot;"')
    expect(iframeSnippet(url, 'Cat', { height: 650, startPage: 1 })).toContain('height:650px')
    expect(coverSnippet(url, 'Cat')).toContain('src="https://cat.pages.dev/cover.jpg"')
    expect(popupSnippet(url, 'Cat', 'Open')).toContain('>Open</button>')
  })
})
