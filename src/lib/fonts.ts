// Font collection: bundled open-licence fonts (work offline and are embedded in
// exports), common system fonts, and fonts the user imports into a project.

export type FontCategory = 'Sans serif' | 'Serif' | 'Display' | 'Script' | 'Arabic' | 'System' | 'Imported'

export interface FontFaceSource {
  weight: number
  url: string
  unicodeRange?: string
  format?: string
}

export interface FontDefinition {
  id: string
  name: string
  category: FontCategory
  /** CSS font-family list used when rendering. */
  stack: string
  weights: number[]
  /** Files to load (bundled or imported fonts). System fonts have none. */
  faces: FontFaceSource[]
  licence?: string
}

/** Imported font stored in the project (file bytes live in project.assets). */
export interface ProjectFont {
  id: string
  family: string
  assetId: string
  weight: number
  italic?: boolean
}

const LATIN_RANGE = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
const ARABIC_RANGE = 'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC'

// Vite turns every matching woff2 file into a hashed asset URL.
const bundledFiles = import.meta.glob('/node_modules/@fontsource/*/files/*-{latin,arabic}-{400,700}-normal.woff2', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

function bundled(id: string, name: string, category: FontCategory, fallback: string, weights: number[], arabic = false): FontDefinition {
  const faces: FontFaceSource[] = []
  for (const weight of weights) {
    for (const subset of arabic ? ['arabic', 'latin'] : ['latin']) {
      const key = `/node_modules/@fontsource/${id}/files/${id}-${subset}-${weight}-normal.woff2`
      const url = bundledFiles[key]
      if (url) faces.push({ weight, url, unicodeRange: subset === 'arabic' ? ARABIC_RANGE : LATIN_RANGE, format: 'woff2' })
    }
  }
  return { id, name, category, stack: `'${name}', ${fallback}`, weights, faces, licence: 'SIL Open Font License 1.1' }
}

function system(id: string, name: string, stack: string): FontDefinition {
  return { id, name, category: 'System', stack, weights: [400, 700], faces: [] }
}

const SANS = "system-ui, 'Segoe UI', Arial, sans-serif"
const SERIF = "Georgia, 'Times New Roman', serif"

export const BUNDLED_FONTS: FontDefinition[] = [
  bundled('inter', 'Inter', 'Sans serif', SANS, [400, 700]),
  bundled('poppins', 'Poppins', 'Sans serif', SANS, [400, 700]),
  bundled('montserrat', 'Montserrat', 'Sans serif', SANS, [400, 700]),
  bundled('raleway', 'Raleway', 'Sans serif', SANS, [400, 700]),
  bundled('dm-sans', 'DM Sans', 'Sans serif', SANS, [400, 700]),
  bundled('playfair-display', 'Playfair Display', 'Serif', SERIF, [400, 700]),
  bundled('cormorant-garamond', 'Cormorant Garamond', 'Serif', SERIF, [400, 700]),
  bundled('lora', 'Lora', 'Serif', SERIF, [400, 700]),
  bundled('libre-baskerville', 'Libre Baskerville', 'Serif', SERIF, [400, 700]),
  bundled('oswald', 'Oswald', 'Display', SANS, [400, 700]),
  bundled('bebas-neue', 'Bebas Neue', 'Display', SANS, [400]),
  bundled('anton', 'Anton', 'Display', SANS, [400]),
  bundled('dancing-script', 'Dancing Script', 'Script', 'cursive', [400, 700]),
  bundled('great-vibes', 'Great Vibes', 'Script', 'cursive', [400]),
  bundled('cairo', 'Cairo', 'Arabic', "Tahoma, 'Segoe UI', sans-serif", [400, 700], true),
  bundled('tajawal', 'Tajawal', 'Arabic', "Tahoma, 'Segoe UI', sans-serif", [400, 700], true),
]

export const SYSTEM_FONTS: FontDefinition[] = [
  system('segoe', 'Segoe UI', "'Segoe UI', system-ui, sans-serif"),
  system('arial', 'Arial', 'Arial, Helvetica, sans-serif'),
  system('helvetica', 'Helvetica', 'Helvetica, Arial, sans-serif'),
  system('verdana', 'Verdana', 'Verdana, Geneva, sans-serif'),
  system('tahoma', 'Tahoma', 'Tahoma, Geneva, sans-serif'),
  system('trebuchet', 'Trebuchet MS', "'Trebuchet MS', sans-serif"),
  system('georgia', 'Georgia', 'Georgia, serif'),
  system('times', 'Times New Roman', "'Times New Roman', Times, serif"),
  system('courier', 'Courier New', "'Courier New', Courier, monospace"),
  system('impact', 'Impact', "Impact, 'Arial Black', sans-serif"),
]

export function importedFontDefinitions(fonts: ProjectFont[], assetUrl: (assetId: string) => string): FontDefinition[] {
  const byFamily = new Map<string, FontDefinition>()
  for (const font of fonts) {
    const id = `custom:${font.family}`
    const existing = byFamily.get(id) ?? { id, name: font.family, category: 'Imported' as const, stack: `'${font.family.replace(/'/g, '')}', ${SANS}`, weights: [], faces: [] }
    existing.weights.push(font.weight)
    const url = assetUrl(font.assetId)
    if (url) existing.faces.push({ weight: font.weight, url })
    byFamily.set(id, existing)
  }
  return [...byFamily.values()]
}

export function allFonts(projectFonts: ProjectFont[] = [], assetUrl: (assetId: string) => string = () => ''): FontDefinition[] {
  return [...importedFontDefinitions(projectFonts, assetUrl), ...BUNDLED_FONTS, ...SYSTEM_FONTS]
}

export function findFont(id: string | undefined, fonts: FontDefinition[]): FontDefinition {
  return fonts.find((font) => font.id === id) ?? BUNDLED_FONTS[0]
}

function familyName(font: FontDefinition): string {
  return font.stack.split(',')[0].trim().replace(/^'|'$/g, '')
}

/** @font-face rules. `urlFor` lets exports swap bundled URLs for embedded data or relative files. */
export function fontFaceCss(fonts: FontDefinition[], urlFor: (face: FontFaceSource, font: FontDefinition) => string = (face) => face.url): string {
  return fonts
    .flatMap((font) =>
      font.faces.map((face) => {
        const url = urlFor(face, font)
        if (!url) return ''
        const format = face.format ?? (url.startsWith('data:font/woff2') || url.endsWith('.woff2') ? 'woff2' : '')
        return `@font-face{font-family:'${familyName(font)}';font-style:normal;font-weight:${face.weight};font-display:swap;src:url("${url}")${format ? ` format('${format}')` : ''};${face.unicodeRange ? `unicode-range:${face.unicodeRange};` : ''}}`
      }),
    )
    .filter(Boolean)
    .join('\n')
}

export const FONT_FILE_ACCEPT = '.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2'

export function fontMimeType(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase()
  if (extension === 'woff2') return 'font/woff2'
  if (extension === 'woff') return 'font/woff'
  if (extension === 'otf') return 'font/otf'
  return 'font/ttf'
}
