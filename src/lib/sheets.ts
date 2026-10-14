import JSZip from 'jszip'

/**
 * Small spreadsheet reader/writer (no extra library): the first sheet of an .xlsx,
 * or a .csv / .tsv file, as rows of text. Dates and formulas come back as the
 * values Excel last saved.
 */
export async function readSheet(file: Blob & { name?: string }): Promise<string[][]> {
  const name = (file.name ?? '').toLowerCase()
  const bytes = new Uint8Array(await file.arrayBuffer())
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b
  if (isZip) return readXlsx(bytes)
  if (/\.xls$/.test(name)) throw new Error('Old .xls files are not supported. In Excel choose File → Save As → Excel Workbook (.xlsx) or CSV.')
  let text = new TextDecoder('utf-8').decode(bytes)
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return parseCsv(text)
}

/** CSV / TSV / semicolon-separated text with quoted fields. */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const counts = [',', ';', '\t'].map((sep) => [sep, firstLine.split(sep).length] as const)
  const sep = counts.sort((a, b) => b[1] - a[1])[0][0]
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1 }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === sep) { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.map((cells) => cells.map((cell) => cell.trim())).filter((cells) => cells.some((cell) => cell !== ''))
}

const colIndex = (ref: string): number => {
  const letters = ref.replace(/\d+/g, '').toUpperCase()
  let n = 0
  for (const letter of letters) n = n * 26 + (letter.charCodeAt(0) - 64)
  return n - 1
}

async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw new Error('This file could not be opened as an Excel workbook.')
  }
  const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml')
  const text = async (path: string) => (zip.file(path) ? zip.file(path)!.async('string') : null)
  const workbook = await text('xl/workbook.xml')
  if (!workbook) throw new Error('This is not an Excel workbook (.xlsx).')
  // First sheet in workbook order → its file through the relationships.
  const firstSheet = parse(workbook).getElementsByTagName('sheet')[0]
  const relId = firstSheet?.getAttribute('r:id') ?? firstSheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? ''
  let sheetPath = 'xl/worksheets/sheet1.xml'
  const rels = await text('xl/_rels/workbook.xml.rels')
  if (rels && relId) {
    for (const rel of Array.from(parse(rels).getElementsByTagName('Relationship'))) {
      if (rel.getAttribute('Id') === relId) {
        const target = rel.getAttribute('Target') ?? ''
        sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
      }
    }
  }
  const shared: string[] = []
  const sst = await text('xl/sharedStrings.xml')
  if (sst) {
    for (const si of Array.from(parse(sst).getElementsByTagName('si'))) {
      shared.push(Array.from(si.getElementsByTagName('t')).map((t) => t.textContent ?? '').join(''))
    }
  }
  const sheetXml = await text(sheetPath)
  if (!sheetXml) throw new Error('The first sheet of this workbook is empty.')
  const rows: string[][] = []
  for (const rowEl of Array.from(parse(sheetXml).getElementsByTagName('row'))) {
    const cells: string[] = []
    let next = 0
    for (const c of Array.from(rowEl.getElementsByTagName('c'))) {
      const ref = c.getAttribute('r')
      const index = ref ? colIndex(ref) : next
      next = index + 1
      const type = c.getAttribute('t')
      const v = c.getElementsByTagName('v')[0]?.textContent ?? ''
      let value = v
      if (type === 's') value = shared[Number(v)] ?? ''
      else if (type === 'inlineStr') value = Array.from(c.getElementsByTagName('t')).map((t) => t.textContent ?? '').join('')
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE'
      else if (/^-?\d+\.\d{6,}$/.test(v)) value = String(Number(Number(v).toFixed(6)))
      while (cells.length < index) cells.push('')
      cells[index] = value.trim()
    }
    if (cells.some((cell) => cell !== '')) rows.push(cells)
  }
  return rows
}

const xmlEscape = (value: string) => value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

/** A simple one-sheet .xlsx (text cells, bold header, wider columns). */
export async function writeXlsx(rows: string[][], sheetName = 'Products'): Promise<Blob> {
  const zip = new JSZip()
  const col = (i: number) => { let s = ''; let n = i + 1; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }
  const sheetRows = rows.map((row, r) => `<row r="${r + 1}">${row.map((cell, c) => `<c r="${col(c)}${r + 1}" t="inlineStr"${r === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xmlEscape(cell)}</t></is></c>`).join('')}</row>`).join('')
  const widths = (rows[0] ?? []).map((_, c) => `<col min="${c + 1}" max="${c + 1}" width="${Math.min(60, Math.max(12, ...rows.map((row) => (row[c] ?? '').length + 2)))}" customWidth="1"/>`).join('')
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
  zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>')
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${sheetRows}</sheetData></worksheet>`)
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
