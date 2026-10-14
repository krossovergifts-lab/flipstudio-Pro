import { createAsset, createProject, mergeAssets, PROJECT_VERSION, type PageDefinition, type ProjectAsset, type ProjectState, type ReaderSettings } from './project'

export interface NewPdfInfo {
  title: string
  description: string
  category: string
  keywords: string
  reader: ReaderSettings
  /** Keep objects, animations and bookmarks on the same page numbers. */
  keepObjects?: boolean
}

/**
 * Puts newly imported PDF pages into an existing publication: a new version of the
 * same catalogue (keepObjects) or a new edition that keeps only the design, SEO and
 * tracking settings. Returns the new project and how many objects were dropped.
 */
export function applyNewPdf(
  old: ProjectState,
  imported: PageDefinition[],
  info: NewPdfInfo,
  options: { id?: string; download?: { name: string; dataUrl: string } } = {},
): { project: ProjectState; dropped: number } {
  const keep = Boolean(info.keepObjects)
  const oldPages = old.pages
  const pages = keep
    ? imported.map((page, index) => {
        const previous = oldPages[index]
        if (!previous) return page
        const sx = page.width / previous.width
        const sy = page.height / previous.height
        const scaled = Math.abs(sx - 1) > 0.01 || Math.abs(sy - 1) > 0.01
        return {
          ...page,
          id: previous.id,
          name: previous.name && !/^page \d+$/i.test(previous.name) ? previous.name : page.name,
          bookmark: previous.bookmark,
          overlays: scaled
            ? previous.overlays.map((overlay) => ({ ...overlay, x: overlay.x * sx, y: overlay.y * sy, width: overlay.width * sx, height: overlay.height * sy, fontSize: overlay.fontSize ? overlay.fontSize * sx : overlay.fontSize }))
            : previous.overlays,
        }
      })
    : imported
  const dropped = keep ? oldPages.slice(imported.length).reduce((total, page) => total + page.overlays.length, 0) : 0
  const keptIds = new Set(pages.flatMap((page) => page.overlays.map((overlay) => overlay.id)))
  let assets: Record<string, ProjectAsset> = old.assets
  let reader: ReaderSettings = { ...info.reader }
  if (options.download) {
    const merged = mergeAssets(assets, [createAsset(options.download)])
    assets = merged.assets
    reader = { ...reader, downloadAssetId: merged.ids[0], downloadName: options.download.name }
  } else if (!keep && reader.downloadAssetId) {
    // A new edition must not offer the old edition's PDF.
    reader = { ...reader, downloadAssetId: undefined, downloadName: undefined }
  }
  const project = createProject({
    version: PROJECT_VERSION,
    id: options.id,
    title: info.title,
    description: info.description,
    category: info.category,
    keywords: info.keywords,
    reader,
    fonts: old.fonts,
    assets,
    animations: keep ? old.animations.filter((animation) => keptIds.has(animation.targetId)) : [],
    pages,
  })
  return { project, dropped }
}

/** "Gifts Catalogue 2027" → "Gifts Catalogue 2028"; otherwise adds "— new edition". */
export function nextEditionTitle(title: string): string {
  const match = title.match(/(19|20)\d{2}(?!.*(19|20)\d{2})/)
  if (match && match.index !== undefined) return title.slice(0, match.index) + String(Number(match[0]) + 1) + title.slice(match.index + 4)
  return `${title} — new edition`
}
