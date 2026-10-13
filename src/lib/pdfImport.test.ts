import { describe, expect, it } from 'vitest'
import { toPageText } from './pdfImport'
import { buildPublicationData, createProject, PROJECT_VERSION, serializeProject } from './project'

// PDF.js viewport transform for a 600x800pt page at scale 1 (flips y to a top-left origin).
const viewport: [number, number, number, number, number, number] = [1, 0, 0, -1, 0, 800]

describe('PDF text layer', () => {
  it('converts PDF text runs into top-left page-unit boxes', () => {
    const items = toPageText(
      [
        { str: 'Hello', transform: [20, 0, 0, 20, 50, 700], width: 48, hasEOL: false, fontName: 'a' },
        { str: '', transform: [0, 0, 0, 0, 0, 0], hasEOL: true },
        { str: 'Mono', transform: [10, 0, 0, 10, 50, 650], width: 24, fontName: 'b' },
        { str: 'Up', transform: [0, 12, -12, 0, 300, 400], width: 15, fontName: 'a' },
      ],
      { a: { ascent: 0.75, fontFamily: 'serif' }, b: { fontFamily: 'monospace' } },
      viewport,
    )
    expect(items[0]).toEqual({ s: 'Hello', x: 50, y: 85, w: 48, h: 20, f: 'serif', eol: true })
    expect(items[1]).toMatchObject({ s: 'Mono', y: 142, h: 10, f: 'monospace' })
    expect(items[2].a).toBe(-90)
    expect(items).toHaveLength(3)
  })

  it('keeps page text and reader settings through save, reopen and publication data', () => {
    const project = createProject({
      version: PROJECT_VERSION,
      title: 'Text book',
      keywords: 'gifts, leather',
      reader: { background: '#112233', toolbar: '#000000', textTools: true },
      pages: [{ id: 'p1', width: 600, height: 800, overlays: [], text: [{ s: 'Hi', x: 1, y: 2, w: 3, h: 4 }, { s: 'bad', x: Number.NaN, y: 0, w: 0, h: 0 }] }],
    })
    expect(project.pages[0].text).toEqual([{ s: 'Hi', x: 1, y: 2, w: 3, h: 4 }])
    const reopened = createProject(JSON.parse(serializeProject(project)))
    expect(reopened.pages[0].text).toEqual([{ s: 'Hi', x: 1, y: 2, w: 3, h: 4 }])
    expect(reopened.keywords).toBe('gifts, leather')
    const data = buildPublicationData(reopened)
    expect(data.pages[0].text).toHaveLength(1)
    expect(data.reader).toEqual({ background: '#112233', toolbar: '#000000', textTools: true })
  })
})
