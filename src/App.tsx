import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { open as openFileDialog, save as saveFileDialog } from '@tauri-apps/plugin-dialog'
import { readTextFile, stat, writeTextFile } from '@tauri-apps/plugin-fs'
import './runtime/publication.css'
import './runtime/reader.css'
import './App.css'
import {
  createClock,
  sampleFrames,
  timelineDuration as computeTimelineDuration,
  timelineLoops,
  type ClockState,
  type PlaybackClock,
  type SlideshowController,
} from './runtime/engine.js'
import {
  ANIMATION_PRESETS,
  TYPE_DEFAULTS,
  createAsset,
  projectFonts,
  createProject,
  findMissingAssets,
  mergeAssets,
  referencedAssetIds,
  serializeProject,
  validateProject,
  PROJECT_VERSION,
  type AnimationEasing,
  type AnimationType,
  type OverlayObject,
  type PageDefinition,
  type ProjectAnimation,
  type ProjectAsset,
  type ProjectState,
  type SlideImage,
} from './lib/project'
import { IMAGE_ACCEPT, formatBytes, readImageAssets } from './lib/assets'
import type { AnimationPreset } from './lib/project'
import { OverlayView, type ResizeHandle } from './components/OverlayView'
import { SlideshowInspector } from './components/SlideshowInspector'
import { VideoInspector } from './components/VideoInspector'
import { Icon } from './components/Icon'
import { ThemeSwitch } from './components/ThemeSwitch'
import { PreviewPane } from './components/PreviewPane'
import { Timeline } from './components/Timeline'
import { NumberField } from './components/NumberField'
import { StyleInspector } from './components/StyleInspector'
import { ColorField } from './components/ColorField'
import { FONT_FILE_ACCEPT, fontFaceCss, fontMimeType } from './lib/fonts'
import { fileToDataUrl } from './lib/assets'
import { importPdfPages, type PdfImportOptions } from './lib/pdfImport'
import { PdfImportDialog, type PdfBookInfo } from './components/PdfImportDialog'
import { ThemeDialog } from './components/ThemeDialog'
import { downloadBlob, exportPublication } from './lib/exporters'
import { errorMessage } from './lib/errors'

type ProjectHistory = { snapshots: ProjectState[]; index: number; mergeKey: string | null }
type Guide = { axis: 'x' | 'y'; position: number }
type CanvasGesture = {
  mode: 'move' | 'resize' | 'rotate' | 'crop'
  pageId: string
  overlayId: string
  startProject: ProjectState
  currentProject: ProjectState
  bounds: DOMRect
  pointerX: number
  pointerY: number
  offsetX: number
  offsetY: number
  handle?: ResizeHandle
  start: Pick<OverlayObject, 'x' | 'y' | 'width' | 'height' | 'rotation'>
  startCrop?: { zoom: number; x: number; y: number }
}
type PickerTarget = { mode: 'new-slideshow' } | { mode: 'add-slides'; overlayId: string } | { mode: 'replace-slide'; overlayId: string; slideId: string }
type SidebarTab = 'pages' | 'layers' | 'assets'

const HISTORY_LIMIT = 150
const MIN_SIZE = 20
const SNAP_PX = 6
const LEGACY_STORAGE_KEY = 'flipstudio-pro-project'
const WORKSPACE_KEY = 'flipstudio-pro-workspace'

function createEmptyProject(): ProjectState {
  return createProject({
    version: PROJECT_VERSION,
    title: 'Untitled project',
    pages: [{ id: 'page-1', name: 'Page 1', width: 1000, height: 1400, overlays: [] }],
  })
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function readWorkspace(): { timelineHeight?: number; pixelsPerSecond?: number; showLeft?: boolean; showRight?: boolean } {
  try {
    return JSON.parse(localStorage.getItem(WORKSPACE_KEY) ?? '{}') as ReturnType<typeof readWorkspace>
  } catch {
    return {}
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable
}

function mapOverlay(project: ProjectState, overlayId: string, update: (overlay: OverlayObject) => OverlayObject): ProjectState {
  return {
    ...project,
    pages: project.pages.map((page) =>
      page.overlays.some((overlay) => overlay.id === overlayId)
        ? { ...page, overlays: page.overlays.map((overlay) => (overlay.id === overlayId ? update(overlay) : overlay)) }
        : page,
    ),
  }
}

/** Fits an asset of the given size into a box at most `fraction` of the page, centred. */
function placeOnPage(page: PageDefinition, asset: ProjectAsset | undefined, fraction = 0.6) {
  const ratio = asset?.width && asset?.height ? asset.width / asset.height : 4 / 3
  let width = page.width * fraction
  let height = width / ratio
  if (height > page.height * fraction) {
    height = page.height * fraction
    width = height * ratio
  }
  return {
    x: Math.round((page.width - width) / 2),
    y: Math.round((page.height - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  }
}

export interface EditorProps {
  /** Project to edit. Defaults to a blank page. */
  initialProject?: ProjectState
  initialMode?: 'edit' | 'preview'
  /** Library mode: Save and autosave write through this instead of to a file. */
  onPersist?: (project: ProjectState) => Promise<void>
  /** Library mode: return to the publication library. */
  onExit?: () => void
  /** Library mode: publish the (saved) project online. */
  onPublish?: (project: ProjectState) => void
}

const AUTOSAVE_DELAY = 1200

export function Editor({ initialProject, initialMode = 'edit', onPersist, onExit, onPublish }: EditorProps = {}) {
  const libraryMode = Boolean(onPersist)
  const [workspace] = useState(readWorkspace)
  const [history, setHistory] = useState<ProjectHistory>(() => ({ snapshots: [initialProject ?? createEmptyProject()], index: 0, mergeKey: null }))
  const [previewProject, setPreviewProject] = useState<ProjectState | null>(null)
  const [selectedPageId, setSelectedPageId] = useState<string>(() => initialProject?.pages[0]?.id ?? 'page-1')
  const [rawSelectedOverlayId, setSelectedOverlayId] = useState<string>('')
  const [rawSelectedAnimationId, setSelectedAnimationId] = useState<string>('')
  const [timelineTime, setTimelineTime] = useState(0)
  const [playbackState, setPlaybackState] = useState<ClockState>('stopped')
  const [status, setStatus] = useState('Ready')
  const [error, setError] = useState('')
  const [pageMode, setPageMode] = useState<'single' | 'double'>('single')
  const [mode, setMode] = useState<'edit' | 'preview'>(initialMode)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [zoomLevel, setZoomLevel] = useState(0.4)
  /** While true the canvas re-fits whenever the window or panels resize; manual zoom turns it off. */
  const [autoFit, setAutoFit] = useState(true)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('pages')
  const [showLeft, setShowLeft] = useState(workspace.showLeft ?? true)
  const [showRight, setShowRight] = useState(workspace.showRight ?? true)
  const [timelineHeight, setTimelineHeight] = useState(Math.min(420, Math.max(120, workspace.timelineHeight ?? 160)))
  const [pixelsPerSecond, setPixelsPerSecond] = useState(workspace.pixelsPerSecond ?? 80)
  const [guides, setGuides] = useState<Guide[]>([])
  /** Object whose picture is being cropped on the canvas (double-click an image or slideshow). */
  const [croppingId, setCroppingId] = useState('')
  const [dropActive, setDropActive] = useState(false)
  const [animationPreset, setAnimationPreset] = useState('fade-in')
  const [animationStartMode, setAnimationStartMode] = useState<'after' | 'with' | 'playhead'>('after')
  const [slideshowPlaying, setSlideshowPlaying] = useState<Record<string, boolean>>({})
  const [slideshowIndex, setSlideshowIndex] = useState<Record<string, number>>({})
  const [savedProjectPath, setSavedProjectPath] = useState<string | null>(null)
  const [savedProjectHandle, setSavedProjectHandle] = useState<FileSystemFileHandle | null>(null)
  const [savedSnapshot, setSavedSnapshot] = useState<ProjectState>(() => history.snapshots[0])
  const committedProject = history.snapshots[history.index]
  const project = previewProject ?? committedProject
  const pdfInputRef = useRef<HTMLInputElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const fontInputRef = useRef<HTMLInputElement | null>(null)
  /** What the single-image picker is for: a new image object, or a pop-up's picture. */
  const imagePickerTargetRef = useRef<{ mode: 'object' } | { mode: 'popup'; overlayId: string }>({ mode: 'object' })
  const slideshowInputRef = useRef<HTMLInputElement | null>(null)
  const videoInputRef = useRef<HTMLInputElement | null>(null)
  const videoTargetRef = useRef<{ mode: 'object' | 'slide'; overlayId: string } | null>(null)
  const projectInputRef = useRef<HTMLInputElement | null>(null)
  const workspaceSurfaceRef = useRef<HTMLDivElement | null>(null)
  const gestureRef = useRef<CanvasGesture | null>(null)
  const pickerTargetRef = useRef<PickerTarget | null>(null)
  const controllersRef = useRef(new Map<string, SlideshowController>())
  const clockRef = useRef<PlaybackClock | null>(null)

  const report = useCallback((message: string, problem = '') => {
    setStatus(message)
    setError(problem)
  }, [])

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  /** Commits an edit. Consecutive edits sharing a mergeKey (typing, slider drags) become one undo step. */
  const commitProject = useCallback((nextProject: ProjectState, mergeKey?: string) => {
    setHistory((current) => {
      if (mergeKey && current.mergeKey === mergeKey && current.index === current.snapshots.length - 1) {
        const snapshots = [...current.snapshots]
        snapshots[current.index] = nextProject
        return { snapshots, index: current.index, mergeKey }
      }
      const snapshots = [...current.snapshots.slice(0, current.index + 1), nextProject].slice(-HISTORY_LIMIT)
      return { snapshots, index: snapshots.length - 1, mergeKey: mergeKey ?? null }
    })
    setPreviewProject(null)
  }, [])

  const replaceProject = useCallback((nextProject: ProjectState) => {
    setHistory({ snapshots: [nextProject], index: 0, mergeKey: null })
    setPreviewProject(null)
    setSlideshowPlaying({})
    setSlideshowIndex({})
    clockRef.current?.stop()
  }, [])

  const undo = useCallback(() => {
    setHistory((current) => ({ ...current, index: Math.max(0, current.index - 1), mergeKey: null }))
  }, [])

  const redo = useCallback(() => {
    setHistory((current) => ({ ...current, index: Math.min(current.snapshots.length - 1, current.index + 1), mergeKey: null }))
  }, [])

  const dirty = savedSnapshot !== committedProject

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  const selectedPage = useMemo(
    () => project.pages.find((page) => page.id === selectedPageId) ?? project.pages[0],
    [project.pages, selectedPageId],
  )
  // Selection is derived during render: an ID that no longer exists (deleted, undone,
  // another project opened) simply selects nothing, with no stale state to re-sync.
  const selectedOverlay = useMemo(
    () => selectedPage?.overlays.find((overlay) => overlay.id === rawSelectedOverlayId),
    [rawSelectedOverlayId, selectedPage],
  )
  const selectedOverlayId = selectedOverlay?.id ?? ''
  const selectedAnimation = project.animations.find((animation) => animation.id === rawSelectedAnimationId)
  const selectedAnimationId = selectedAnimation?.id ?? ''
  const timelineDuration = computeTimelineDuration(project.animations)
  const fonts = useMemo(() => projectFonts(project), [project])
  const fontCss = useMemo(() => fontFaceCss(fonts), [fonts])
  const hasLoopingAnimations = timelineLoops(project.animations)


  // Leave crop mode when another object is selected.
  if (croppingId && croppingId !== selectedOverlayId) setCroppingId('')

  const updateOverlayRef = useRef<(id: string, changes: Partial<OverlayObject>, mergeKey?: string) => void>(() => undefined)
  // Wheel zoom while cropping (a non-passive listener so the workspace does not scroll).
  useEffect(() => {
    const surface = workspaceSurfaceRef.current
    if (!croppingId || !surface) return
    const onWheel = (event: WheelEvent) => {
      const target = (event.target as HTMLElement | null)?.closest(`[data-object-id="${CSS.escape(croppingId)}"]`)
      if (!target) return
      event.preventDefault()
      const overlay = project.pages.flatMap((page) => page.overlays).find((candidate) => candidate.id === croppingId)
      if (!overlay) return
      const crop = { zoom: 1, x: 50, y: 50, ...overlay.crop }
      const zoom = Math.round(Math.min(5, Math.max(1, crop.zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08))) * 100) / 100
      updateOverlayRef.current(croppingId, { crop: { ...crop, zoom } }, 'crop-zoom')
    }
    surface.addEventListener('wheel', onWheel, { passive: false })
    return () => surface.removeEventListener('wheel', onWheel)
  }, [croppingId, project.pages])

  // ---------------------------------------------------------------------------
  // Shared playback clock (one requestAnimationFrame loop for the editor)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const clock = createClock({
      duration: 0,
      onTick: (time, state) => {
        setTimelineTime(time)
        setPlaybackState(state)
      },
    })
    clockRef.current = clock
    return () => {
      clock.destroy()
      clockRef.current = null
    }
  }, [])

  useEffect(() => {
    clockRef.current?.configure({ duration: timelineDuration, loops: hasLoopingAnimations })
    if (!project.animations.length) clockRef.current?.stop()
  }, [hasLoopingAnimations, project.animations.length, timelineDuration])

  const playTimeline = useCallback(() => {
    if (!project.animations.length) return
    clockRef.current?.play()
  }, [project.animations.length])
  const pauseTimeline = useCallback(() => clockRef.current?.pause(), [])
  const stopTimeline = useCallback(() => clockRef.current?.stop(), [])
  const scrubTimeline = useCallback((time: number) => clockRef.current?.seek(time), [])

  const frames = useMemo(
    () => (playbackState === 'stopped' ? {} : sampleFrames(project.animations, timelineTime)),
    [playbackState, project.animations, timelineTime],
  )

  // ---------------------------------------------------------------------------
  // Workspace persistence
  // ---------------------------------------------------------------------------

  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ timelineHeight, pixelsPerSecond, showLeft, showRight }))
    } catch {
      // Workspace layout is a convenience; storage may be unavailable.
    }
  }, [pixelsPerSecond, showLeft, showRight, timelineHeight])

  useEffect(() => {
    document.title = `${project.title}${dirty ? ' •' : ''} — FlipStudio Pro`
  }, [dirty, project.title])

  // ---------------------------------------------------------------------------
  // Object editing
  // ---------------------------------------------------------------------------

  const updateOverlay = useCallback(
    (overlayId: string, changes: Partial<OverlayObject>, mergeKey?: string) => {
      if (!overlayId) return
      commitProject(mapOverlay(committedProject, overlayId, (overlay) => ({ ...overlay, ...changes })), mergeKey ? `${mergeKey}-${overlayId}` : undefined)
    },
    [commitProject, committedProject],
  )

  useEffect(() => {
    updateOverlayRef.current = updateOverlay
  }, [updateOverlay])

  const updateSelectedOverlay = useCallback(
    (changes: Partial<OverlayObject>, mergeKey?: string) => updateOverlay(selectedOverlayId, changes, mergeKey),
    [selectedOverlayId, updateOverlay],
  )

  const addOverlay = useCallback(
    (type: OverlayObject['type'], values: Partial<OverlayObject> = {}, base: ProjectState = committedProject, pageId = selectedPage?.id) => {
      const page = base.pages.find((candidate) => candidate.id === pageId) ?? base.pages[0]
      if (!page) return ''
      const id = newId(type)
      const defaults: Record<OverlayObject['type'], string> = {
        text: 'New text block',
        slideshow: 'Slideshow',
        button: 'Button',
        hotspot: 'Hotspot',
        image: 'Image',
        video: 'Video',
        audio: 'Audio',
      }
      const width = type === 'text' ? Math.round(page.width * 0.5) : type === 'button' ? 260 : 300
      const height = type === 'text' ? 120 : type === 'button' ? 80 : 200
      const overlay: OverlayObject = {
        id,
        type,
        label: defaults[type],
        // Cascade new objects so they never land exactly on top of each other.
        x: Math.round((page.width - width) / 2 + (page.overlays.length % 6) * page.width * 0.03),
        y: Math.round(page.height * 0.12 + (page.overlays.length % 6) * page.height * 0.07),
        width,
        height,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        fontSize: type === 'button' ? 28 : type === 'text' ? 40 : 24,
        fit: 'cover',
        ...(type === 'slideshow'
          ? { slides: [], autoplay: true, looping: true, duration: 3, transition: 'fade' as const, transitionDuration: 0.6, showControls: true, showIndicators: 'dots' as const, pauseOnHover: false, startIndex: 0 }
          : {}),
        ...values,
      }
      commitProject({
        ...base,
        pages: base.pages.map((candidate) => (candidate.id === page.id ? { ...candidate, overlays: [...candidate.overlays, overlay] } : candidate)),
      })
      setSelectedPageId(page.id)
      setSelectedOverlayId(id)
      setSelectedAnimationId('')
      return id
    },
    [commitProject, committedProject, selectedPage],
  )

  const deleteSelectedOverlay = useCallback(() => {
    if (!selectedOverlayId) return
    const label = selectedOverlay?.label ?? 'Object'
    commitProject({
      ...committedProject,
      pages: committedProject.pages.map((page) => ({ ...page, overlays: page.overlays.filter((overlay) => overlay.id !== selectedOverlayId) })),
      animations: committedProject.animations.filter((animation) => animation.targetId !== selectedOverlayId),
    })
    setSelectedOverlayId('')
    report(`Deleted ${label}. Use Undo to restore it.`)
  }, [commitProject, committedProject, report, selectedOverlay, selectedOverlayId])

  const duplicateSelectedOverlay = useCallback(() => {
    if (!selectedPage || !selectedOverlay) return
    const duplicateId = newId(selectedOverlay.type)
    const duplicate: OverlayObject = {
      ...selectedOverlay,
      id: duplicateId,
      x: Math.min(selectedOverlay.x + 30, selectedPage.width - selectedOverlay.width),
      y: Math.min(selectedOverlay.y + 30, selectedPage.height - selectedOverlay.height),
      label: `${selectedOverlay.label} copy`,
      slides: selectedOverlay.slides?.map((slide) => ({ ...slide, id: newId('slide') })),
    }
    const copiedAnimations = committedProject.animations
      .filter((animation) => animation.targetId === selectedOverlay.id)
      .map((animation) => ({ ...animation, id: newId('animation'), targetId: duplicateId }))
    commitProject({
      ...committedProject,
      pages: committedProject.pages.map((page) => (page.id === selectedPage.id ? { ...page, overlays: [...page.overlays, duplicate] } : page)),
      animations: [...committedProject.animations, ...copiedAnimations],
    })
    setSelectedOverlayId(duplicateId)
    report('Object duplicated (assets are shared, not copied)')
  }, [commitProject, committedProject, report, selectedOverlay, selectedPage])

  const moveLayer = useCallback(
    (direction: 'up' | 'down' | 'top' | 'bottom') => {
      if (!selectedPage || !selectedOverlayId) return
      const overlays = [...selectedPage.overlays]
      const index = overlays.findIndex((overlay) => overlay.id === selectedOverlayId)
      if (index < 0) return
      const [item] = overlays.splice(index, 1)
      const target = direction === 'up' ? index + 1 : direction === 'down' ? index - 1 : direction === 'top' ? overlays.length : 0
      overlays.splice(Math.max(0, Math.min(overlays.length, target)), 0, item)
      commitProject({
        ...committedProject,
        pages: committedProject.pages.map((page) => (page.id === selectedPage.id ? { ...page, overlays } : page)),
      })
    },
    [commitProject, committedProject, selectedOverlayId, selectedPage],
  )

  // ---------------------------------------------------------------------------
  // Images and slideshows
  // ---------------------------------------------------------------------------

  const importImages = useCallback(
    async (files: File[]): Promise<{ assets: ProjectAsset[]; problems: string[] }> => {
      if (!files.length) return { assets: [], problems: [] }
      report(`Reading ${files.length} image${files.length === 1 ? '' : 's'}…`)
      const { assets, errors } = await readImageAssets(files)
      return { assets, problems: errors }
    },
    [report],
  )

  /** Applies imported assets according to what the picker was opened for. */
  const applyImportedImages = useCallback(
    (assets: ProjectAsset[], problems: string[], target: PickerTarget | { mode: 'image' }, pageId?: string) => {
      const problemText = problems.join(' ')
      if (!assets.length) {
        report('No images were imported', problemText || 'No supported image files were selected.')
        return
      }
      const merged = mergeAssets(committedProject.assets, assets)
      const base: ProjectState = { ...committedProject, assets: merged.assets }
      const page = base.pages.find((candidate) => candidate.id === (pageId ?? selectedPage?.id)) ?? base.pages[0]
      const slidesFor = (): SlideImage[] =>
        merged.ids.map((assetId, index) => ({ id: newId('slide'), assetId, alt: assets[index].name.replace(/\.[^.]+$/, '') }))

      if (target.mode === 'image') {
        let next = base
        let lastId = ''
        merged.ids.forEach((assetId, index) => {
          const placement = placeOnPage(page, merged.assets[assetId], 0.5)
          const id = newId('image')
          lastId = id
          const overlay: OverlayObject = {
            id,
            type: 'image',
            label: assets[index].name,
            ...placement,
            x: placement.x + index * 24,
            y: placement.y + index * 24,
            rotation: 0,
            opacity: 1,
            visible: true,
            locked: false,
            fit: 'cover',
            assetId,
          }
          next = { ...next, pages: next.pages.map((candidate) => (candidate.id === page.id ? { ...candidate, overlays: [...candidate.overlays, overlay] } : candidate)) }
        })
        commitProject(next)
        setSelectedPageId(page.id)
        setSelectedOverlayId(lastId)
        report(`Added image ${assets.map((asset) => asset.name).join(', ')}`, problemText)
        return
      }

      if (target.mode === 'new-slideshow') {
        const placement = placeOnPage(page, merged.assets[merged.ids[0]], 0.6)
        addOverlay('slideshow', { ...placement, slides: slidesFor(), label: 'Slideshow' }, base, page.id)
        report(
          assets.length > 1
            ? `Slideshow created with ${assets.length} images`
            : 'Slideshow created with 1 image — add at least one more image for it to play',
          problemText,
        )
        return
      }

      const overlay = base.pages.flatMap((candidate) => candidate.overlays).find((candidate) => candidate.id === target.overlayId)
      if (!overlay || overlay.type !== 'slideshow') {
        report('Slideshow not found', 'The slideshow was removed before the images finished loading.')
        return
      }
      if (target.mode === 'add-slides') {
        const slides = [...(overlay.slides ?? []), ...slidesFor()]
        commitProject(mapOverlay(base, overlay.id, (current) => ({ ...current, slides })))
        report(`${assets.length} image${assets.length === 1 ? '' : 's'} added — slideshow now has ${slides.length}`, problemText)
      } else {
        const slides = (overlay.slides ?? []).map((slide) =>
          slide.id === target.slideId ? { ...slide, assetId: merged.ids[0], src: undefined, kind: undefined, videoUrl: undefined, alt: assets[0].name.replace(/\.[^.]+$/, '') } : slide,
        )
        commitProject(mapOverlay(base, overlay.id, (current) => ({ ...current, slides })))
        report(`Replaced slide with ${assets[0].name}`, problemText)
      }
    },
    [addOverlay, commitProject, committedProject, report, selectedPage],
  )

  const handleImageInput = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const input = event.target
      const files = Array.from(input.files ?? [])
      input.value = ''
      if (!files.length) return
      const target = imagePickerTargetRef.current
      imagePickerTargetRef.current = { mode: 'object' }
      try {
        const { assets, problems } = await importImages(target.mode === 'popup' ? files.slice(0, 1) : files)
        if (target.mode === 'popup') {
          if (!assets.length) {
            report('No image was added', problems.join(' ') || 'Choose a supported image file.')
            return
          }
          const merged = mergeAssets(committedProject.assets, assets)
          commitProject(
            mapOverlay({ ...committedProject, assets: merged.assets }, target.overlayId, (overlay) => ({
              ...overlay,
              popup: { ...(overlay.popup ?? { title: overlay.label, description: '' }), assetId: merged.ids[0] },
            })),
          )
          report(`Pop-up image set to ${assets[0].name}`)
          return
        }
        applyImportedImages(assets, problems, { mode: 'image' })
      } catch (err) {
        report('Image import failed', errorMessage(err, 'Unable to import image.'))
      }
    },
    [applyImportedImages, commitProject, committedProject, importImages, report],
  )

  const handleFontInput = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const input = event.target
      const file = input.files?.[0]
      input.value = ''
      if (!file) return
      try {
        if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) throw new Error(`${file.name} is not a font file (.ttf, .otf, .woff or .woff2).`)
        if (file.size > 15 * 1024 * 1024) throw new Error(`${file.name} is larger than 15 MB.`)
        const raw = await fileToDataUrl(file, file.name)
        const dataUrl = raw.replace(/^data:[^;,]*/, `data:${fontMimeType(file.name)}`)
        const family = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+(regular|bold|italic|medium|light|semibold|black)$/i, '').replace(/[-_]+/g, ' ').trim() || 'Custom font'
        const weight = /bold|black|heavy/i.test(file.name) ? 700 : 400
        if (typeof FontFace !== 'undefined' && typeof document !== 'undefined' && document.fonts) {
          try {
            await new FontFace(`${family}-check`, `url(${dataUrl})`).load()
          } catch {
            throw new Error(`${file.name} could not be read as a font. Try a .ttf or .woff2 version.`)
          }
        }
        const asset = createAsset({ name: file.name, dataUrl })
        const merged = mergeAssets(committedProject.assets, [asset])
        const fonts = [...(committedProject.fonts ?? []).filter((font) => !(font.family === family && font.weight === weight)), { id: newId('font'), family, assetId: merged.ids[0], weight }]
        let next: ProjectState = { ...committedProject, assets: merged.assets, fonts }
        if (selectedOverlay && (selectedOverlay.type === 'text' || selectedOverlay.type === 'button' || selectedOverlay.type === 'hotspot')) {
          next = mapOverlay(next, selectedOverlay.id, (overlay) => ({ ...overlay, style: { ...overlay.style, fontFamily: `custom:${family}`, fontWeight: weight } }))
        }
        commitProject(next)
        report(`Font "${family}" imported and embedded in this project`)
      } catch (err) {
        report('Font import failed', errorMessage(err, 'The font could not be imported.'))
      }
    },
    [commitProject, committedProject, report, selectedOverlay],
  )

  const openVideoPicker = useCallback((mode: 'object' | 'slide', overlayId: string) => {
    videoTargetRef.current = { mode, overlayId }
    videoInputRef.current?.click()
  }, [])

  const handleVideoInput = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const input = event.target
      const file = input.files?.[0]
      input.value = ''
      const target = videoTargetRef.current
      videoTargetRef.current = null
      if (!file || !target) return
      try {
        if (!/^video\//.test(file.type) && !/\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name)) throw new Error(`${file.name} is not a video file. Use MP4 (H.264) or WebM.`)
        if (file.size > 150 * 1024 * 1024) throw new Error(`${file.name} is ${formatBytes(file.size)}. Use a video under 150 MB, or upload it to YouTube and paste the link.`)
        report(`Reading ${file.name}…`)
        let dataUrl = await fileToDataUrl(file, file.name)
        if (!/^data:video\//.test(dataUrl)) dataUrl = dataUrl.replace(/^data:[^;,]*/, `data:${/\.webm$/i.test(file.name) ? 'video/webm' : /\.mov$/i.test(file.name) ? 'video/quicktime' : 'video/mp4'}`)
        const asset = createAsset({ name: file.name, dataUrl })
        const merged = mergeAssets(committedProject.assets, [asset])
        const base = { ...committedProject, assets: merged.assets }
        if (target.mode === 'object') {
          commitProject(mapOverlay(base, target.overlayId, (overlay) => ({ ...overlay, assetId: merged.ids[0], src: undefined, videoUrl: undefined, label: overlay.label === 'Video' ? file.name.replace(/\.[^.]+$/, '') : overlay.label })))
        } else {
          commitProject(mapOverlay(base, target.overlayId, (overlay) => ({ ...overlay, slides: [...(overlay.slides ?? []), { id: newId('slide'), kind: 'video' as const, assetId: merged.ids[0], alt: file.name.replace(/\.[^.]+$/, '') }] })))
        }
        report(`Added video ${file.name}`, file.size > 25 * 1024 * 1024 ? `${formatBytes(file.size)} — for online catalogues on Cloudflare keep videos under 25 MB or use a YouTube link.` : undefined)
      } catch (err) {
        report('Video not added', errorMessage(err, 'The video could not be read.'))
      }
    },
    [commitProject, committedProject, report],
  )

  const openSlideshowPicker = useCallback((target: PickerTarget) => {
    pickerTargetRef.current = target
    const input = slideshowInputRef.current
    if (!input) return
    input.multiple = target.mode !== 'replace-slide'
    input.click()
  }, [])

  const handleSlideshowInput = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const input = event.target
      const files = Array.from(input.files ?? [])
      input.value = ''
      const target = pickerTargetRef.current
      pickerTargetRef.current = null
      if (!files.length || !target) return
      try {
        const { assets, problems } = await importImages(target.mode === 'replace-slide' ? files.slice(0, 1) : files)
        applyImportedImages(assets, problems, target)
      } catch (err) {
        report('Slideshow import failed', errorMessage(err, 'Unable to load slideshow images.'))
      }
    },
    [applyImportedImages, importImages, report],
  )

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setDropActive(false)
      const files = Array.from(event.dataTransfer.files ?? []).filter((file) => file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg|avif|bmp)$/i.test(file.name))
      if (!files.length) {
        if (event.dataTransfer.files?.length) report('Nothing imported', 'Only image files can be dropped onto the page.')
        return
      }
      const { assets, problems } = await importImages(files)
      if (selectedOverlay?.type === 'slideshow') applyImportedImages(assets, problems, { mode: 'add-slides', overlayId: selectedOverlay.id })
      else if (files.length > 1) applyImportedImages(assets, problems, { mode: 'new-slideshow' })
      else applyImportedImages(assets, problems, { mode: 'image' })
    },
    [applyImportedImages, importImages, report, selectedOverlay],
  )

  const registerController = useCallback((id: string, controller: SlideshowController | null) => {
    if (controller) controllersRef.current.set(id, controller)
    else controllersRef.current.delete(id)
  }, [])

  const handleSlideIndex = useCallback((id: string, index: number, playing: boolean) => {
    setSlideshowIndex((current) => (current[id] === index ? current : { ...current, [id]: index }))
    setSlideshowPlaying((current) => (Boolean(current[id]) === playing ? current : { ...current, [id]: playing }))
  }, [])

  // ---------------------------------------------------------------------------
  // Animations
  // ---------------------------------------------------------------------------

  const commitAnimations = useCallback(
    (animations: ProjectAnimation[], mergeKey?: string) => commitProject({ ...committedProject, animations }, mergeKey),
    [commitProject, committedProject],
  )

  const addAnimation = useCallback(() => {
    if (!selectedOverlay || !selectedPage) return
    const preset: AnimationPreset = ANIMATION_PRESETS[animationPreset] ?? ANIMATION_PRESETS['fade-in']
    const pageAnimations = committedProject.animations.filter((animation) => selectedPage.overlays.some((overlay) => overlay.id === animation.targetId))
    const lastEnd = pageAnimations.reduce((end, animation) => Math.max(end, animation.start + animation.delay + animation.duration), 0)
    const lastStart = pageAnimations.reduce((start, animation) => Math.max(start, animation.start), 0)
    const start = animationStartMode === 'after' ? lastEnd : animationStartMode === 'with' ? lastStart : timelineTime
    const added: ProjectAnimation[] = preset.tracks.map((track) => ({
      id: newId('animation'),
      targetId: selectedOverlay.id,
      type: track.type,
      start: Math.round(start * 100) / 100,
      delay: 0,
      duration: Math.round(preset.duration * (track.span ?? 1) * 100) / 100,
      easing: track.easing,
      from: track.from,
      to: track.to,
      loop: Boolean(track.loop),
      alternate: Boolean(track.alternate),
    }))
    commitAnimations([...committedProject.animations, ...added])
    setSelectedAnimationId(added[added.length - 1].id)
    report(`${preset.label} added at ${added[0].start.toFixed(2)}s${added.length > 1 ? ` (${added.length} synchronised tracks)` : ''}`)
  }, [animationPreset, animationStartMode, commitAnimations, committedProject.animations, report, selectedOverlay, selectedPage, timelineTime])

  const updateAnimation = useCallback(
    (id: string, changes: Partial<ProjectAnimation>, mergeKey?: string) => {
      commitAnimations(
        committedProject.animations.map((animation) => (animation.id === id ? { ...animation, ...changes } : animation)),
        mergeKey ? `${mergeKey}-${id}` : undefined,
      )
    },
    [commitAnimations, committedProject.animations],
  )

  const deleteAnimation = useCallback(
    (id: string) => {
      commitAnimations(committedProject.animations.filter((animation) => animation.id !== id))
      setSelectedAnimationId('')
      report('Animation removed')
    },
    [commitAnimations, committedProject.animations, report],
  )

  const duplicateAnimation = useCallback(
    (id: string) => {
      const source = committedProject.animations.find((animation) => animation.id === id)
      if (!source) return
      const copy = { ...source, id: newId('animation'), start: Math.round((source.start + source.delay + source.duration) * 100) / 100 }
      commitAnimations([...committedProject.animations, copy])
      setSelectedAnimationId(copy.id)
    },
    [commitAnimations, committedProject.animations],
  )

  const selectAnimation = useCallback(
    (animation: ProjectAnimation) => {
      const page = project.pages.find((candidate) => candidate.overlays.some((overlay) => overlay.id === animation.targetId))
      if (page) setSelectedPageId(page.id)
      setSelectedOverlayId(animation.targetId)
      setSelectedAnimationId(animation.id)
    },
    [project.pages],
  )

  // ---------------------------------------------------------------------------
  // Canvas gestures
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const gesture = gestureRef.current
      const page = gesture?.startProject.pages.find((item) => item.id === gesture.pageId)
      if (!gesture || !page) return
      const bounds = gesture.bounds
      const scaleX = bounds.width / page.width
      const scaleY = bounds.height / page.height
      if (!scaleX || !scaleY) return
      const pointerX = (event.clientX - bounds.left) / scaleX
      const pointerY = (event.clientY - bounds.top) / scaleY
      const threshold = SNAP_PX / scaleX
      const nextGuides: Guide[] = []
      const others = page.overlays.filter((overlay) => overlay.id !== gesture.overlayId && overlay.visible)
      const xTargets = [0, page.width / 2, page.width, ...others.flatMap((o) => [o.x, o.x + o.width / 2, o.x + o.width])]
      const yTargets = [0, page.height / 2, page.height, ...others.flatMap((o) => [o.y, o.y + o.height / 2, o.y + o.height])]
      const snapAxis = (edges: number[], targets: number[], axis: Guide['axis']): number => {
        if (event.altKey) return 0
        let best: { delta: number; position: number } | null = null
        for (const edge of edges) {
          for (const target of targets) {
            const delta = target - edge
            if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, position: target }
          }
        }
        if (best) nextGuides.push({ axis, position: best.position })
        return best?.delta ?? 0
      }

      const start = gesture.start
      let changes: Partial<OverlayObject>
      if (gesture.mode === 'move') {
        let x = pointerX - gesture.offsetX
        let y = pointerY - gesture.offsetY
        x += snapAxis([x, x + start.width / 2, x + start.width], xTargets, 'x')
        y += snapAxis([y, y + start.height / 2, y + start.height], yTargets, 'y')
        changes = {
          x: Math.round(Math.max(-start.width + 10, Math.min(x, page.width - 10))),
          y: Math.round(Math.max(-start.height + 10, Math.min(y, page.height - 10))),
        }
      } else if (gesture.mode === 'resize') {
        const handle = gesture.handle ?? 'se'
        const dx = pointerX - gesture.pointerX
        const dy = pointerY - gesture.pointerY
        let { x, y, width, height } = start
        if (handle.includes('e')) width = Math.min(page.width - x, start.width + dx)
        if (handle.includes('s')) height = Math.min(page.height - y, start.height + dy)
        if (handle.includes('w')) {
          width = start.width - dx
          x = start.x + dx
        }
        if (handle.includes('n')) {
          height = start.height - dy
          y = start.y + dy
        }
        if (event.shiftKey && handle.length === 2) {
          const ratio = start.width / start.height
          if (width / height > ratio) height = width / ratio
          else width = height * ratio
          if (handle.includes('w')) x = start.x + start.width - width
          if (handle.includes('n')) y = start.y + start.height - height
        }
        if (width < MIN_SIZE) {
          if (handle.includes('w')) x = start.x + start.width - MIN_SIZE
          width = MIN_SIZE
        }
        if (height < MIN_SIZE) {
          if (handle.includes('n')) y = start.y + start.height - MIN_SIZE
          height = MIN_SIZE
        }
        changes = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
      } else if (gesture.mode === 'crop') {
        // Dragging right moves the picture right, i.e. the focal point moves left.
        const crop = gesture.startCrop ?? { zoom: 1, x: 50, y: 50 }
        const travelX = Math.max(0.35, crop.zoom - 1) * start.width
        const travelY = Math.max(0.35, crop.zoom - 1) * start.height
        changes = {
          crop: {
            zoom: crop.zoom,
            x: Math.round(Math.min(100, Math.max(0, crop.x - ((pointerX - gesture.pointerX) / travelX) * 100)) * 10) / 10,
            y: Math.round(Math.min(100, Math.max(0, crop.y - ((pointerY - gesture.pointerY) / travelY) * 100)) * 10) / 10,
          },
        }
      } else {
        const centerX = start.x + start.width / 2
        const centerY = start.y + start.height / 2
        let angle = (Math.atan2(pointerY - centerY, pointerX - centerX) * 180) / Math.PI + 90
        if (event.shiftKey) angle = Math.round(angle / 15) * 15
        if (angle > 180) angle -= 360
        changes = { rotation: Math.round(angle) }
      }
      const nextProject = mapOverlay(gesture.startProject, gesture.overlayId, (overlay) => ({ ...overlay, ...changes }))
      gesture.currentProject = nextProject
      setGuides(nextGuides)
      setPreviewProject(nextProject)
    }

    const handlePointerUp = () => {
      const gesture = gestureRef.current
      gestureRef.current = null
      setGuides([])
      if (gesture && gesture.currentProject !== gesture.startProject) {
        commitProject(gesture.currentProject)
      } else {
        setPreviewProject(null)
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [commitProject])

  const beginGesture = (
    event: React.PointerEvent<HTMLDivElement>,
    page: PageDefinition,
    overlay: OverlayObject,
    gestureMode: CanvasGesture['mode'],
    handle?: ResizeHandle,
  ) => {
    if (event.button !== 0) return
    const canvas = event.currentTarget.closest('.page-canvas')
    if (!canvas) return
    event.stopPropagation()
    event.preventDefault()
    setSelectedPageId(page.id)
    setSelectedOverlayId(overlay.id)
    if (selectedAnimation && selectedAnimation.targetId !== overlay.id) setSelectedAnimationId('')
    if (overlay.locked) return
    const bounds = canvas.getBoundingClientRect()
    const scaleX = bounds.width / page.width
    const scaleY = bounds.height / page.height
    const pointerX = (event.clientX - bounds.left) / scaleX
    const pointerY = (event.clientY - bounds.top) / scaleY
    gestureRef.current = {
      mode: gestureMode,
      pageId: page.id,
      overlayId: overlay.id,
      startProject: committedProject,
      currentProject: committedProject,
      bounds,
      pointerX,
      pointerY,
      offsetX: pointerX - overlay.x,
      offsetY: pointerY - overlay.y,
      handle,
      start: { x: overlay.x, y: overlay.y, width: overlay.width, height: overlay.height, rotation: overlay.rotation },
      startCrop: { zoom: overlay.crop?.zoom ?? 1, x: overlay.crop?.x ?? 50, y: overlay.crop?.y ?? 50 },
    }
  }

  // ---------------------------------------------------------------------------
  // PDF import (unchanged pipeline)
  // ---------------------------------------------------------------------------

  const fitToPage = useCallback(
    (page: PageDefinition | undefined = selectedPage, pages = pageMode === 'double' ? 2 : 1) => {
      const surface = workspaceSurfaceRef.current
      if (!page || !surface) return
      const bounds = surface.getBoundingClientRect()
      if (!bounds.width || !bounds.height) return
      const availableWidth = Math.max(120, bounds.width - 48)
      const availableHeight = Math.max(160, bounds.height - 48)
      const scale = Math.min(availableWidth / (page.width * pages), availableHeight / page.height, 2)
      setZoomLevel(Math.max(0.1, Math.floor(scale * 100) / 100))
    },
    [pageMode, selectedPage],
  )

  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [designOpen, setDesignOpen] = useState<false | 'theme' | 'bookmarks'>(false)
  const handleImportPdf = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      setPdfFile(file)
    },
    [],
  )

  const runPdfImport = useCallback(
    async (file: File, options: PdfImportOptions, info: PdfBookInfo) => {
      try {
        report(`Importing ${file.name}…`)
        const { pages: imported, textPages } = await importPdfPages(file, options, (page, total) => setStatus(`Importing ${file.name}: page ${page} of ${total}`))

        const keep = Boolean(info.keepObjects)
        const oldPages = committedProject.pages
        // New version of the PDF: pages are matched by number, so objects stay on "their" page.
        const pages = keep
          ? imported.map((page, index) => {
              const old = oldPages[index]
              if (!old) return page
              const sx = page.width / old.width
              const sy = page.height / old.height
              const scaled = Math.abs(sx - 1) > 0.01 || Math.abs(sy - 1) > 0.01
              return {
                ...page,
                id: old.id,
                name: old.name && !/^page \d+$/i.test(old.name) ? old.name : page.name,
                overlays: scaled
                  ? old.overlays.map((overlay) => ({ ...overlay, x: overlay.x * sx, y: overlay.y * sy, width: overlay.width * sx, height: overlay.height * sy, fontSize: overlay.fontSize ? overlay.fontSize * sx : overlay.fontSize }))
                  : old.overlays,
              }
            })
          : imported
        const dropped = keep ? oldPages.slice(imported.length).reduce((total, page) => total + page.overlays.length, 0) : 0
        const keptIds = new Set(pages.flatMap((page) => page.overlays.map((overlay) => overlay.id)))
        let assets = committedProject.assets
        let reader = info.reader
        if (info.allowDownload) {
          const merged = mergeAssets(assets, [createAsset({ name: file.name, dataUrl: await fileToDataUrl(file, file.name) })])
          assets = merged.assets
          reader = { ...reader, downloadAssetId: merged.ids[0], downloadName: file.name }
        }
        const nextProject = createProject({
          version: PROJECT_VERSION,
          id: libraryMode ? committedProject.id : undefined,
          title: info.title,
          description: info.description,
          category: info.category,
          keywords: info.keywords,
          reader,
          fonts: committedProject.fonts,
          assets,
          animations: keep ? committedProject.animations.filter((animation) => keptIds.has(animation.targetId)) : [],
          pages,
        })

        commitProject(nextProject)
        setSelectedPageId(nextProject.pages[0].id)
        setSelectedOverlayId('')
        setSelectedAnimationId('')
        setMode('edit')
        window.requestAnimationFrame(() => fitToPage(nextProject.pages[0], 1))
        report(
          `${keep ? 'Replaced the PDF' : 'Imported'} — ${imported.length} pages from ${file.name}${textPages ? ` (selectable text on ${textPages})` : ''}${keep ? '; objects and animations kept' : ''}`,
          dropped ? `The new PDF has fewer pages: ${dropped} object${dropped === 1 ? ' was' : 's were'} on removed pages (Undo brings them back).` : '',
        )
      } catch (err) {
        report('PDF import failed', errorMessage(err, 'Unable to import PDF file.'))
      }
    },
    [commitProject, committedProject, fitToPage, libraryMode, report],
  )

  useEffect(() => {
    const surface = workspaceSurfaceRef.current
    if (!autoFit || !surface) return
    fitToPage()
    if (typeof ResizeObserver === 'undefined') {
      const onResize = () => fitToPage()
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }
    let frame = 0
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => fitToPage())
    })
    observer.observe(surface)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [autoFit, fitToPage, mode, showLeft, showRight])

  // ---------------------------------------------------------------------------
  // Save / open
  // ---------------------------------------------------------------------------

  const markSaved = useCallback((saved: ProjectState) => setSavedSnapshot(saved), [])

  const persistRef = useRef(onPersist)
  useEffect(() => {
    persistRef.current = onPersist
  }, [onPersist])
  const savingRef = useRef<Promise<void>>(Promise.resolve())

  /** Library mode: write the current project to the library (queued so saves never overlap). */
  const persistNow = useCallback(
    (project: ProjectState): Promise<void> => {
      const persist = persistRef.current
      if (!persist) return Promise.resolve()
      setSaveState('saving')
      const run = savingRef.current.then(() => persist(project))
      savingRef.current = run.then(
        () => {
          setSavedSnapshot((current) => (current === project ? current : project))
          setSaveState('saved')
        },
        (err: unknown) => {
          setSaveState('error')
          report('Save failed', `Could not save to the library: ${errorMessage(err)}`)
        },
      )
      return savingRef.current
    },
    [report],
  )

  // Autosave in library mode, shortly after the last change.
  useEffect(() => {
    if (!libraryMode || savedSnapshot === committedProject) return
    const timer = window.setTimeout(() => void persistNow(committedProject), AUTOSAVE_DELAY)
    return () => window.clearTimeout(timer)
  }, [committedProject, libraryMode, persistNow, savedSnapshot])

  const exitToLibrary = useCallback(async () => {
    if (savedSnapshot !== committedProject) await persistNow(committedProject)
    onExit?.()
  }, [committedProject, onExit, persistNow, savedSnapshot])

  const saveProject = useCallback(async () => {
    if (libraryMode) {
      await persistNow(committedProject)
      report('Saved to the library')
      return
    }
    try {
      const data = serializeProject(committedProject)
      if (isTauri() && savedProjectPath) {
        await writeTextFile(savedProjectPath, data)
        const result = await stat(savedProjectPath)
        if (result.size !== new TextEncoder().encode(data).byteLength) {
          throw new Error('The saved project size does not match the serialized project.')
        }
        report(`Project saved to ${savedProjectPath}`)
      } else if (savedProjectHandle) {
        const writable = await savedProjectHandle.createWritable()
        await writable.write(data)
        await writable.close()
        const savedFile = await savedProjectHandle.getFile()
        if (savedFile.size !== new TextEncoder().encode(data).byteLength) {
          throw new Error('The saved project size does not match the serialized project.')
        }
        report(`Project saved to ${savedFile.name}`)
      } else {
        try {
          localStorage.setItem(LEGACY_STORAGE_KEY, data)
        } catch {
          throw new Error('The project is too large for browser storage. Use Save As to choose a file.')
        }
        report('Project saved locally')
      }
      markSaved(committedProject)
    } catch (err) {
      report('Save failed', errorMessage(err, 'Unable to save this project.'))
    }
  }, [committedProject, libraryMode, markSaved, persistNow, report, savedProjectHandle, savedProjectPath])

  const saveProjectAs = useCallback(async () => {
    const data = serializeProject(committedProject)
    const fileName = `${committedProject.title.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') || 'flipstudio-project'}.flipstudio.json`
    setError('')

    try {
      if (isTauri()) {
        const path = await saveFileDialog({
          title: 'Save FlipStudio project',
          defaultPath: fileName,
          filters: [{ name: 'FlipStudio project', extensions: ['flipstudio.json', 'json'] }],
        })
        if (!path) {
          report('Save As cancelled')
          return
        }
        await writeTextFile(path, data)
        const result = await stat(path)
        if (result.size !== new TextEncoder().encode(data).byteLength) {
          throw new Error('The saved project size does not match the serialized project.')
        }
        report(`Project saved to ${path}`)
        setSavedProjectPath(path)
        setSavedProjectHandle(null)
        markSaved(committedProject)
        return
      }

      const pickerWindow = window as Window & {
        showSaveFilePicker?: (options?: {
          suggestedName?: string
          types?: Array<{ description: string; accept: Record<string, string[]> }>
        }) => Promise<FileSystemFileHandle>
      }
      if (pickerWindow.showSaveFilePicker) {
        const handle = await pickerWindow.showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: 'FlipStudio project', accept: { 'application/json': ['.flipstudio.json', '.json'] } }],
        })
        const writable = await handle.createWritable()
        await writable.write(data)
        await writable.close()
        const savedFile = await handle.getFile()
        if (savedFile.size !== new TextEncoder().encode(data).byteLength) {
          throw new Error('The saved project size does not match the serialized project.')
        }
        report(`Project saved to ${savedFile.name}`)
        setSavedProjectHandle(handle)
        setSavedProjectPath(null)
        markSaved(committedProject)
        return
      }

      downloadBlob(new Blob([data], { type: 'application/json;charset=utf-8' }), fileName)
      report('Project download requested; browser does not confirm the destination')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        report('Save As cancelled')
        return
      }
      report('Save As failed', `Save As failed: ${errorMessage(err)}`)
    }
  }, [committedProject, markSaved, report])

  const applyOpenedProject = useCallback(
    (parsed: unknown, source: string) => {
      const result = validateProject(parsed)
      if (!result.valid) throw new Error(result.errors.join(' '))
      const nextProject = createProject(parsed as Partial<ProjectState>)
      replaceProject(nextProject)
      markSaved(nextProject)
      setSelectedPageId(nextProject.pages[0].id)
      setSelectedOverlayId(nextProject.pages[0].overlays[0]?.id ?? '')
      setSelectedAnimationId('')
      setMode('edit')
      const missing = findMissingAssets(nextProject)
      report(
        `Opened ${source}`,
        missing.length ? `${missing.length} image${missing.length === 1 ? ' is' : 's are'} missing from this project file and will show as placeholders.` : '',
      )
      window.requestAnimationFrame(() => fitToPage(nextProject.pages[0], 1))
    },
    [fitToPage, markSaved, replaceProject, report],
  )

  const loadProject = useCallback(async () => {
    if (isTauri()) {
      try {
        const path = await openFileDialog({
          multiple: false,
          title: 'Open FlipStudio project',
          filters: [{ name: 'FlipStudio project', extensions: ['json'] }],
        })
        if (typeof path !== 'string') {
          report('Open cancelled')
          return
        }
        applyOpenedProject(JSON.parse(await readTextFile(path)), path)
        setSavedProjectPath(path)
        setSavedProjectHandle(null)
      } catch (err) {
        report('Open failed', `Open failed: ${errorMessage(err)}`)
      }
      return
    }

    if (!localStorage.getItem(LEGACY_STORAGE_KEY)) {
      projectInputRef.current?.click()
      return
    }

    try {
      applyOpenedProject(JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? 'null'), 'the locally saved project')
      report('Saved project reopened')
    } catch (err) {
      report('Open failed', errorMessage(err, 'Project could not be opened.'))
    }
  }, [applyOpenedProject, report])

  const openProjectFile = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return
      try {
        applyOpenedProject(JSON.parse(await file.text()), file.name)
        setSavedProjectHandle(null)
        setSavedProjectPath(null)
      } catch (err) {
        report('Open failed', err instanceof Error ? (err instanceof SyntaxError ? 'The file is not valid project JSON.' : err.message) : 'Project file could not be opened.')
      } finally {
        event.target.value = ''
      }
    },
    [applyOpenedProject, report],
  )

  const newProject = useCallback(() => {
    if (dirty && !window.confirm('Discard unsaved changes and start a new project?')) return
    const fresh = createEmptyProject()
    replaceProject(fresh)
    markSaved(fresh)
    setSavedProjectHandle(null)
    setSavedProjectPath(null)
    setSelectedPageId(fresh.pages[0].id)
    setSelectedOverlayId('')
    setMode('edit')
    report('New project')
  }, [dirty, markSaved, replaceProject, report])

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  const runExport = useCallback(
    async (kind: 'html' | 'zip') => {
      const label = kind === 'html' ? 'HTML' : 'ZIP'
      try {
        report(`Building ${label} publication…`)
        const result = await exportPublication(committedProject, kind)
        if (!result) {
          report(`${label} publication export cancelled`)
          return
        }
        report(result.message, result.warnings.join(' '))
      } catch (err) {
        report(`${label} export failed`, `${label} export failed: ${errorMessage(err)}`)
      }
    },
    [committedProject, report],
  )
  const exportHtml = useCallback(() => runExport('html'), [runExport])
  const exportZip = useCallback(() => runExport('zip'), [runExport])

  // ---------------------------------------------------------------------------
  // Preview mode
  // ---------------------------------------------------------------------------

  const enterPreview = useCallback(() => {
    clockRef.current?.stop()
    setSlideshowPlaying({})
    gestureRef.current = null
    setPreviewProject(null)
    setMode('preview')
    report('Preview — this is the same reader used by exported publications. Press Esc to return to editing.')
  }, [report])

  const exitPreview = useCallback(() => {
    setMode('edit')
    report('Back to editing')
  }, [report])

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const ctrl = event.ctrlKey || event.metaKey
      if (mode === 'preview') {
        if (event.key === 'Escape' && !event.defaultPrevented) exitPreview()
        return
      }
      if (ctrl && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (event.shiftKey) void saveProjectAs()
        else void saveProject()
        return
      }
      if (ctrl && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        if (!libraryMode) void loadProject()
        return
      }
      if (isEditableTarget(event.target)) return
      if (ctrl && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      } else if (ctrl && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
      } else if (ctrl && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        duplicateSelectedOverlay()
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedOverlayId) {
        event.preventDefault()
        deleteSelectedOverlay()
      } else if (event.key === 'Escape' && croppingId) {
        setCroppingId('')
      } else if (event.key === 'Escape') {
        setSelectedOverlayId('')
        setSelectedAnimationId('')
      } else if (event.key === ' ' && project.animations.length) {
        event.preventDefault()
        if (clockRef.current?.state === 'playing') pauseTimeline()
        else playTimeline()
      } else if (selectedOverlay && !selectedOverlay.locked && event.key.startsWith('Arrow')) {
        event.preventDefault()
        const step = event.shiftKey ? 10 : 1
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
        updateSelectedOverlay({ x: selectedOverlay.x + dx, y: selectedOverlay.y + dy }, 'nudge')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [croppingId, deleteSelectedOverlay, duplicateSelectedOverlay, exitPreview, libraryMode, loadProject, mode, pauseTimeline, playTimeline, project.animations.length, redo, saveProject, saveProjectAs, selectedOverlay, selectedOverlayId, undo, updateSelectedOverlay])

  // ---------------------------------------------------------------------------
  // Timeline panel resize
  // ---------------------------------------------------------------------------

  const startTimelineResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = timelineHeight
    const move = (moveEvent: PointerEvent) => {
      const max = Math.max(140, window.innerHeight * 0.5)
      setTimelineHeight(Math.round(Math.min(max, Math.max(110, startHeight + startY - moveEvent.clientY))))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const canvasScale = Math.max(0.1, Math.min(2, zoomLevel))
  const selectedPageIndex = selectedPage ? project.pages.findIndex((page) => page.id === selectedPage.id) : 0
  const canvasPages = project.pages.slice(selectedPageIndex, selectedPageIndex + (pageMode === 'double' ? 2 : 1))
  const usedAssets = useMemo(() => referencedAssetIds(project), [project])
  const missingAssets = useMemo(() => findMissingAssets(project), [project])
  const selectedSlideIndex = selectedOverlay ? slideshowIndex[selectedOverlay.id] ?? 0 : 0
  const isPreview = mode === 'preview'

  const shellStyle = {
    '--timeline-height': `${timelineHeight}px`,
  } as React.CSSProperties

  const animationUnits = (type: AnimationType): string =>
    type === 'move-x' || type === 'move-y' ? 'offset (page units)' : type === 'rotation' ? 'degrees added' : type === 'scale' ? 'scale ×' : 'opacity 0–1'

  return (
    <div className={`app-shell ${isPreview ? 'is-preview' : ''} ${showLeft ? '' : 'no-left'} ${showRight ? '' : 'no-right'}`} style={shellStyle}>
      <input ref={pdfInputRef} type="file" accept="application/pdf" onChange={handleImportPdf} hidden />
      {designOpen && (
        <ThemeDialog
          project={committedProject}
          onCancel={() => setDesignOpen(false)}
          initialTab={designOpen === 'bookmarks' ? 'bookmarks' : 'theme'}
          onApply={(reader, assets, bookmarks, info) => {
            setDesignOpen(false)
            const merged = mergeAssets(committedProject.assets, assets)
            const pages = committedProject.pages.map((page) => (page.id in bookmarks ? { ...page, bookmark: bookmarks[page.id] } : page))
            commitProject({ ...committedProject, reader, assets: merged.assets, pages, description: info.description, keywords: info.keywords })
            report('Flipbook design updated')
          }}
        />
      )}
      {pdfFile && (
        <PdfImportDialog
          file={pdfFile}
          initial={libraryMode ? { title: /^untitled/i.test(committedProject.title) ? undefined : committedProject.title, description: committedProject.description ?? '', category: committedProject.category ?? '', keywords: committedProject.keywords ?? '', reader: committedProject.reader } : { reader: committedProject.reader }}
          replace={committedProject.pages.reduce((total, page) => total + page.overlays.length, 0) > 0 ? { pageCount: committedProject.pages.length, objectCount: committedProject.pages.reduce((total, page) => total + page.overlays.length, 0) } : undefined}
          onCancel={() => { setPdfFile(null); report('PDF import cancelled') }}
          onImport={(options, info) => { const file = pdfFile; setPdfFile(null); void runPdfImport(file, options, info) }}
        />
      )}
      <input ref={imageInputRef} type="file" accept={IMAGE_ACCEPT} onChange={handleImageInput} hidden data-testid="image-input" />
      <input ref={fontInputRef} type="file" accept={FONT_FILE_ACCEPT} onChange={handleFontInput} hidden data-testid="font-input" />
      <style data-testid="font-faces">{fontCss}</style>
      <input ref={projectInputRef} type="file" accept="application/json,.json" onChange={openProjectFile} hidden />
      <input ref={slideshowInputRef} type="file" accept={IMAGE_ACCEPT} multiple onChange={handleSlideshowInput} hidden data-testid="slideshow-input" />
      <input ref={videoInputRef} type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v" onChange={handleVideoInput} hidden data-testid="video-input" />

      <header className="top-toolbar" role="toolbar" aria-label="Main toolbar">
        <div className="brand" title="FlipStudio Pro">FS</div>
        {libraryMode ? (
          <div className="toolbar-group" aria-label="File">
            <button type="button" className="library-back" onClick={() => void exitToLibrary()} title="Back to all publications (saves first)"><Icon name="back" /> Library</button>
            <span className="doc-title" title={project.title}>{project.title}</span>
            <span className={`save-pill ${saveState}`} role="status">{saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved' : dirty ? 'Unsaved' : 'Saved'}</span>
            <button type="button" onClick={() => void saveProject()} title="Save now (Ctrl+S). Changes also save automatically.">Save</button>
            <button type="button" onClick={() => void saveProjectAs()} title="Save a copy of the project file anywhere (Ctrl+Shift+S)">Save copy</button>
          </div>
        ) : (
          <div className="toolbar-group" aria-label="File">
            <button type="button" onClick={newProject} title="New project">New</button>
            <button type="button" onClick={() => void loadProject()} title="Open project (Ctrl+O)">Open</button>
            <button type="button" onClick={() => void saveProject()} title="Save (Ctrl+S)">Save</button>
            <button type="button" onClick={() => void saveProjectAs()} title="Save As (Ctrl+Shift+S)">Save As</button>
          </div>
        )}
        <div className="toolbar-group" aria-label="Edit">
          <button type="button" className="icon-button" aria-label="Undo" onClick={undo} disabled={history.index === 0} title="Undo (Ctrl+Z)"><Icon name="undo" /></button>
          <button type="button" className="icon-button" aria-label="Redo" onClick={redo} disabled={history.index >= history.snapshots.length - 1} title="Redo (Ctrl+Y)"><Icon name="redo" /></button>
        </div>
        <div className="toolbar-group" aria-label="Insert">
          <button type="button" onClick={() => pdfInputRef.current?.click()} disabled={isPreview} aria-label="Import PDF" title="Import a PDF as the publication's pages"><Icon name="pdf" /><span className="btn-label">Import PDF</span></button>
          <span className="toolbar-divider" aria-hidden="true" />
          <button type="button" aria-label="Add image" title="Add image" onClick={() => { imagePickerTargetRef.current = { mode: 'object' }; imageInputRef.current?.click() }} disabled={isPreview}><Icon name="image" /><span className="btn-label">Image</span></button>
          <button type="button" aria-label="Add text" title="Add text" onClick={() => addOverlay('text')} disabled={isPreview}><Icon name="text" /><span className="btn-label">Text</span></button>
          <button type="button" aria-label="Add button" title="Add button" onClick={() => addOverlay('button')} disabled={isPreview}><Icon name="button" /><span className="btn-label">Button</span></button>
          <button type="button" aria-label="Add hotspot" title="Add clickable hotspot" onClick={() => addOverlay('hotspot')} disabled={isPreview}><Icon name="hotspot" /><span className="btn-label">Hotspot</span></button>
          <button type="button" aria-label="Add slideshow" title="Add slideshow — choose two or more images" onClick={() => openSlideshowPicker({ mode: 'new-slideshow' })} disabled={isPreview}><Icon name="slides" /><span className="btn-label">Slideshow</span></button>
          <button
            type="button"
            aria-label="Add video"
            title="Add a video — upload an MP4 or paste a YouTube / Vimeo link"
            onClick={() => {
              const page = selectedPage ?? committedProject.pages[0]
              if (!page) return
              const width = Math.round(page.width * 0.6)
              addOverlay('video', { width, height: Math.round((width * 9) / 16), autoplay: false, looping: false, muted: false, showControls: true })
            }}
            disabled={isPreview}
          >
            <Icon name="video" /><span className="btn-label">Video</span>
          </button>
        </div>
        <div className="toolbar-spacer" />
        <div className="toolbar-group toolbar-publish" aria-label="Publish">
          <button type="button" aria-label="Flipbook design" title="Flipbook design: theme, background, page turn, sound" onClick={() => setDesignOpen('theme')}><Icon name="design" /><span className="toolbar-btn-label"> Design</span></button>
          <button type="button" aria-label="Export HTML" title="Export one self-contained HTML file" onClick={() => void exportHtml()}><Icon name="download" /><span className="btn-label">HTML</span></button>
          <button type="button" aria-label="Export ZIP" title="Export a ZIP folder for web hosting" onClick={() => void exportZip()}><Icon name="download" /><span className="btn-label">ZIP</span></button>
          {onPublish && (
            <button
              type="button"
              className="publish-button"
              aria-label="Publish online"
              title="Publish this publication as a shareable online flipbook link"
              onClick={() => void (async () => {
                if (savedSnapshot !== committedProject) await persistNow(committedProject)
                onPublish(committedProject)
              })()}
            >
              <Icon name="globe" /> Publish
            </button>
          )}
          <ThemeSwitch compact />
          <button type="button" className="primary" onClick={isPreview ? exitPreview : enterPreview}>
            <Icon name={isPreview ? 'edit' : 'eye'} />
            {isPreview ? 'Edit' : 'Preview'}
          </button>
        </div>
      </header>

      <main className="main-layout">
        {!isPreview && showLeft && (
          <aside className="left-panel" aria-label="Project structure">
            <div className="tab-bar" role="tablist">
              {(['pages', 'layers', 'assets'] as SidebarTab[]).map((tab) => (
                <button key={tab} type="button" role="tab" aria-selected={sidebarTab === tab} className={sidebarTab === tab ? 'active' : ''} onClick={() => setSidebarTab(tab)}>
                  {tab === 'pages' ? 'Pages' : tab === 'layers' ? 'Layers' : 'Assets'}
                </button>
              ))}
            </div>
            <div className="panel-scroll">
              {sidebarTab === 'pages' && (
                <div className="page-list">
                  {project.pages.map((page, index) => (
                    <button
                      key={page.id}
                      type="button"
                      className={`page-thumb ${selectedPage?.id === page.id ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedPageId(page.id)
                        setSelectedOverlayId('')
                      }}
                    >
                      <div className="thumb-preview" style={{ aspectRatio: `${page.width} / ${page.height}` }}>
                        {page.thumbUrl || page.previewUrl ? <img src={page.thumbUrl ?? page.previewUrl} alt={page.name} loading="lazy" decoding="async" /> : <div className="thumb-placeholder" />}
                      </div>
                      <span className="thumb-label">
                        <strong>{page.name}</strong>
                        <span className="muted">{index + 1} · {page.overlays.length} object{page.overlays.length === 1 ? '' : 's'}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {sidebarTab === 'layers' && selectedPage && (
                <ul className="layer-list" aria-label={`Layers on ${selectedPage.name}`}>
                  {[...selectedPage.overlays].reverse().map((overlay) => (
                    <li key={overlay.id} className={overlay.id === selectedOverlayId ? 'active' : ''}>
                      <button type="button" className="layer-name" onClick={() => setSelectedOverlayId(overlay.id)}>
                        <span className="layer-type">{overlay.type}</span>
                        {overlay.label}
                      </button>
                      <button type="button" className="icon" aria-label={overlay.visible ? `Hide ${overlay.label}` : `Show ${overlay.label}`} onClick={() => updateOverlay(overlay.id, { visible: !overlay.visible })}>
                        {overlay.visible ? '👁' : '—'}
                      </button>
                      <button type="button" className="icon" aria-label={overlay.locked ? `Unlock ${overlay.label}` : `Lock ${overlay.label}`} onClick={() => updateOverlay(overlay.id, { locked: !overlay.locked })}>
                        {overlay.locked ? '🔒' : '🔓'}
                      </button>
                    </li>
                  ))}
                  {!selectedPage.overlays.length && <li className="empty-hint">No objects on this page.</li>}
                </ul>
              )}
              {sidebarTab === 'assets' && (
                <ul className="asset-list" aria-label="Project assets">
                  {Object.values(project.assets).map((asset) => (
                    <li key={asset.id} className={usedAssets.has(asset.id) ? '' : 'unused'}>
                      <img src={asset.dataUrl} alt="" />
                      <span>
                        <strong title={asset.name}>{asset.name}</strong>
                        <span className="muted">
                          {asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ''}
                          {formatBytes(asset.byteSize)}
                          {usedAssets.has(asset.id) ? '' : ' · unused (not saved)'}
                        </span>
                      </span>
                    </li>
                  ))}
                  {!Object.keys(project.assets).length && <li className="empty-hint">Images you add are stored here once and shared by every object that uses them.</li>}
                  {missingAssets.length > 0 && <li className="error-text">{missingAssets.length} referenced asset(s) missing.</li>}
                </ul>
              )}
            </div>
          </aside>
        )}

        <section className="workspace-panel" aria-label={isPreview ? 'Preview' : 'Page canvas'}>
          {isPreview ? (
            <PreviewPane project={committedProject} startPage={Math.max(0, selectedPageIndex)} />
          ) : (
            <>
              <div className="workspace-toolbar">
                <button type="button" className={showLeft ? 'toggle on' : 'toggle'} onClick={() => setShowLeft((value) => !value)} aria-pressed={showLeft}>Sidebar</button>
                <div className="segmented" role="group" aria-label="Page layout">
                  <button type="button" className={pageMode === 'single' ? 'active' : ''} onClick={() => setPageMode('single')}>Single</button>
                  <button type="button" className={pageMode === 'double' ? 'active' : ''} onClick={() => setPageMode('double')}>Double</button>
                </div>
                <div className="segmented" role="group" aria-label="Zoom">
                  <button type="button" aria-label="Zoom out" onClick={() => { setAutoFit(false); setZoomLevel((value) => Math.max(0.1, Math.round((value - 0.1) * 100) / 100)) }}>−</button>
                  <span className="zoom-value">{Math.round(canvasScale * 100)}%</span>
                  <button type="button" aria-label="Zoom in" onClick={() => { setAutoFit(false); setZoomLevel((value) => Math.min(2, Math.round((value + 0.1) * 100) / 100)) }}>+</button>
                </div>
                <button type="button" className={autoFit ? 'toggle on' : 'toggle'} aria-pressed={autoFit} title="Fit the page to the window and keep it fitted while resizing" onClick={() => { setAutoFit(true); fitToPage() }}>Fit</button>
                <span className="workspace-hint muted">{selectedPage?.name} · {Math.round(selectedPage?.width ?? 0)}×{Math.round(selectedPage?.height ?? 0)}</span>
                <button type="button" className={showRight ? 'toggle on' : 'toggle'} onClick={() => setShowRight((value) => !value)} aria-pressed={showRight}>Inspector</button>
              </div>

              <div
                ref={workspaceSurfaceRef}
                className={`workspace-surface ${dropActive ? 'drop-active' : ''}`}
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget) setSelectedOverlayId('')
                }}
                onDragOver={(event) => {
                  if (!Array.from(event.dataTransfer.types).includes('Files')) return
                  event.preventDefault()
                  setDropActive(true)
                }}
                onDragLeave={(event) => {
                  if (event.currentTarget === event.target) setDropActive(false)
                }}
                onDrop={(event) => void handleDrop(event)}
              >
                <div className={`page-canvas-group ${pageMode}`} data-visible-page-count={canvasPages.length}>
                  {canvasPages.map((canvasPage) => (
                    <div
                      key={canvasPage.id}
                      className="page-canvas fs-page"
                      data-page-id={canvasPage.id}
                      style={{ width: Math.round(canvasPage.width * canvasScale), height: Math.round(canvasPage.height * canvasScale) }}
                      onPointerDown={(event) => {
                        if (event.target === event.currentTarget || (event.target as HTMLElement).classList.contains('fs-page-bg')) {
                          setSelectedPageId(canvasPage.id)
                          setSelectedOverlayId('')
                        }
                      }}
                    >
                      {canvasPage.previewUrl ? (
                        <img src={canvasPage.previewUrl} alt={canvasPage.name} className="fs-page-bg page-background" draggable={false} />
                      ) : (
                        <div className="fs-page-bg page-background placeholder" />
                      )}
                      {canvasPage.overlays.filter((overlay) => overlay.visible).map((overlay) => (
                        <OverlayView
                          key={overlay.id}
                          overlay={overlay}
                          page={canvasPage}
                          assets={project.assets}
                          frame={frames[overlay.id] ?? null}
                          fonts={fonts}
                          selected={canvasPage.id === selectedPage?.id && overlay.id === selectedOverlayId}
                          slideshowPlaying={Boolean(slideshowPlaying[overlay.id])}
                          onPointerDown={(event) => beginGesture(event, canvasPage, overlay, croppingId === overlay.id ? 'crop' : 'move')}
                          cropping={croppingId === overlay.id}
                          onDoubleClick={() => {
                            if (overlay.type !== 'image' && overlay.type !== 'slideshow') return
                            setCroppingId((current) => (current === overlay.id ? '' : overlay.id))
                          }}
                          onResizePointerDown={(event, handle) => beginGesture(event, canvasPage, overlay, 'resize', handle)}
                          onRotatePointerDown={(event) => beginGesture(event, canvasPage, overlay, 'rotate')}
                          onSlideshowController={registerController}
                          onSlideshowIndex={handleSlideIndex}
                        />
                      ))}
                      {canvasPage.id === selectedPage?.id && guides.map((guide, index) => (
                        <div
                          key={`${guide.axis}-${index}`}
                          className={`snap-guide ${guide.axis}`}
                          style={guide.axis === 'x' ? { left: `${(guide.position / canvasPage.width) * 100}%` } : { top: `${(guide.position / canvasPage.height) * 100}%` }}
                        />
                      ))}
                    </div>
                  ))}
                </div>
                {dropActive && <div className="drop-hint">Drop images to {selectedOverlay?.type === 'slideshow' ? 'add them to the selected slideshow' : 'place them on the page'}</div>}
              </div>
            </>
          )}
        </section>

        {!isPreview && showRight && (
          <aside className="right-panel" aria-label="Inspector">
            <div className="panel-title">Inspector</div>
            <div className="panel-scroll inspector-scroll">
              {selectedOverlay ? (
                <div className="inspector-form">
                  <section className="inspector-section">
                    <div className="section-heading">
                      <h3>{selectedOverlay.type.charAt(0).toUpperCase() + selectedOverlay.type.slice(1)}</h3>
                      <span className="muted">{selectedPage?.name}</span>
                    </div>
                    <label>
                      Label
                      <input value={selectedOverlay.label} onChange={(event) => updateSelectedOverlay({ label: event.target.value }, 'label')} />
                    </label>
                    <div className="field-grid four">
                      <NumberField label="X" value={selectedOverlay.x} onCommit={(value) => updateSelectedOverlay({ x: value }, 'x')} />
                      <NumberField label="Y" value={selectedOverlay.y} onCommit={(value) => updateSelectedOverlay({ y: value }, 'y')} />
                      <NumberField label="W" min={MIN_SIZE} value={selectedOverlay.width} onCommit={(value) => updateSelectedOverlay({ width: Math.max(MIN_SIZE, value) }, 'w')} />
                      <NumberField label="H" min={MIN_SIZE} value={selectedOverlay.height} onCommit={(value) => updateSelectedOverlay({ height: Math.max(MIN_SIZE, value) }, 'h')} />
                    </div>
                    <div className="field-grid">
                      <label>
                        Rotation ({selectedOverlay.rotation}°)
                        <input type="range" min={-180} max={180} value={selectedOverlay.rotation} onChange={(event) => updateSelectedOverlay({ rotation: Number(event.target.value) }, 'rotation')} />
                      </label>
                      <label>
                        Opacity ({Math.round(selectedOverlay.opacity * 100)}%)
                        <input type="range" min={0} max={1} step={0.05} value={selectedOverlay.opacity} onChange={(event) => updateSelectedOverlay({ opacity: Number(event.target.value) }, 'opacity')} />
                      </label>
                    </div>
                    {selectedOverlay.type === 'image' && (
                      <div className="field-grid">
                        <label>
                          Image fit
                          <select value={selectedOverlay.fit ?? 'cover'} onChange={(event) => updateSelectedOverlay({ fit: event.target.value as OverlayObject['fit'] })}>
                            <option value="cover">Fill (crop)</option>
                            <option value="contain">Fit (letterbox)</option>
                            <option value="fill">Stretch</option>
                          </select>
                        </label>
                        <label>
                          Source
                          <span className="muted small">{selectedOverlay.assetId ? project.assets[selectedOverlay.assetId]?.name ?? 'Missing asset' : selectedOverlay.src ? 'Linked URL' : 'None'}</span>
                        </label>
                      </div>
                    )}
                    <div className="check-grid">
                      <label className="check">
                        <input type="checkbox" checked={selectedOverlay.visible} onChange={(event) => updateSelectedOverlay({ visible: event.target.checked })} />
                        Visible
                      </label>
                      <label className="check">
                        <input type="checkbox" checked={Boolean(selectedOverlay.locked)} onChange={(event) => updateSelectedOverlay({ locked: event.target.checked })} />
                        Locked
                      </label>
                    </div>
                  </section>

                  <StyleInspector
                    overlay={selectedOverlay}
                    fonts={fonts}
                    assets={project.assets}
                    pageCount={project.pages.length}
                    onChange={(changes, mergeKey) => updateSelectedOverlay(changes, mergeKey)}
                    onImportFont={() => fontInputRef.current?.click()}
                    cropping={croppingId === selectedOverlay.id}
                    onToggleCrop={() => setCroppingId((current) => (current === selectedOverlay.id ? '' : selectedOverlay.id))}
                    onPickPopupImage={() => {
                      imagePickerTargetRef.current = { mode: 'popup', overlayId: selectedOverlay.id }
                      imageInputRef.current?.click()
                    }}
                  />

                  {selectedOverlay.type === 'video' && (
                    <VideoInspector
                      key={selectedOverlay.id}
                      overlay={selectedOverlay}
                      assets={project.assets}
                      onChange={(changes, mergeKey) => updateSelectedOverlay(changes, mergeKey)}
                      onChooseFile={() => openVideoPicker('object', selectedOverlay.id)}
                    />
                  )}

                  {selectedOverlay.type === 'slideshow' && (
                    <SlideshowInspector
                      overlay={selectedOverlay}
                      assets={project.assets}
                      currentIndex={selectedSlideIndex}
                      playing={Boolean(slideshowPlaying[selectedOverlay.id])}
                      onChange={(changes, mergeKey) => updateSelectedOverlay(changes, mergeKey)}
                      onAddImages={() => openSlideshowPicker({ mode: 'add-slides', overlayId: selectedOverlay.id })}
                      onAddVideo={() => openVideoPicker('slide', selectedOverlay.id)}
                      onAddVideoLink={(videoUrl) => updateSelectedOverlay({ slides: [...(selectedOverlay.slides ?? []), { id: newId('slide'), kind: 'video', videoUrl, alt: 'Video' }] })}
                      onReplaceImage={(slideId) => openSlideshowPicker({ mode: 'replace-slide', overlayId: selectedOverlay.id, slideId })}
                      onTogglePlay={() => controllersRef.current.get(selectedOverlay.id)?.toggle()}
                      onStep={(direction) => {
                        const controller = controllersRef.current.get(selectedOverlay.id)
                        if (direction > 0) controller?.next()
                        else controller?.previous()
                      }}
                      onGoTo={(index) => controllersRef.current.get(selectedOverlay.id)?.goTo(index)}
                    />
                  )}

                  <section className="inspector-section animation-inspector" aria-label="Animations">
                    <div className="section-heading">
                      <h3>Animations</h3>
                    </div>
                    <div className="field-grid">
                      <label>
                        Effect
                        <select value={animationPreset} onChange={(event) => setAnimationPreset(event.target.value)}>
                          {(['Entrance', 'Emphasis', 'Exit'] as const).map((group) => (
                            <optgroup key={group} label={group}>
                              {Object.entries(ANIMATION_PRESETS).filter(([, preset]) => preset.group === group).map(([key, preset]) => <option key={key} value={key}>{preset.label}</option>)}
                            </optgroup>
                          ))}
                        </select>
                      </label>
                      <label>
                        Starts
                        <select value={animationStartMode} onChange={(event) => setAnimationStartMode(event.target.value as typeof animationStartMode)}>
                          <option value="after">After previous</option>
                          <option value="with">With previous</option>
                          <option value="playhead">At playhead</option>
                        </select>
                      </label>
                    </div>
                    <button type="button" className="block" onClick={addAnimation}>Add animation</button>
                    <div className="animation-list">
                      {project.animations
                        .filter((animation) => animation.targetId === selectedOverlay.id)
                        .map((animation) => (
                          <button
                            key={animation.id}
                            type="button"
                            className={`animation-select ${selectedAnimationId === animation.id ? 'active' : ''}`}
                            onClick={() => selectAnimation(animation)}
                          >
                            <span>{animation.type}</span>
                            <span className="muted">{(animation.start + animation.delay).toFixed(2)}s → {(animation.start + animation.delay + animation.duration).toFixed(2)}s{animation.loop ? ' · loop' : ''}</span>
                          </button>
                        ))}
                    </div>
                    {selectedAnimation && selectedAnimation.targetId === selectedOverlay.id && (
                      <div className="animation-fields">
                        <label>
                          Type
                          <select
                            value={selectedAnimation.type}
                            onChange={(event) => {
                              const type = event.target.value as AnimationType
                              updateAnimation(selectedAnimation.id, { type, ...TYPE_DEFAULTS[type] })
                            }}
                          >
                            <option value="fade-in">Fade in</option>
                            <option value="fade-out">Fade out</option>
                            <option value="move-x">Move X</option>
                            <option value="move-y">Move Y</option>
                            <option value="scale">Scale</option>
                            <option value="rotation">Rotation</option>
                          </select>
                        </label>
                        <div className="field-grid">
                          <NumberField label="Start (s)" ariaLabel="Animation start" min={0} step={0.1} value={selectedAnimation.start} onCommit={(value) => updateAnimation(selectedAnimation.id, { start: Math.max(0, value) }, 'start')} />
                          <NumberField label="Delay (s)" ariaLabel="Animation delay" min={0} step={0.1} value={selectedAnimation.delay} onCommit={(value) => updateAnimation(selectedAnimation.id, { delay: Math.max(0, value) }, 'delay')} />
                          <NumberField label="Duration (s)" ariaLabel="Animation duration" min={0.05} step={0.1} value={selectedAnimation.duration} onCommit={(value) => updateAnimation(selectedAnimation.id, { duration: Math.max(0.05, value) }, 'duration')} />
                          <label>
                            Easing
                            <select value={selectedAnimation.easing} onChange={(event) => updateAnimation(selectedAnimation.id, { easing: event.target.value as AnimationEasing })}>
                              <option value="linear">Linear</option>
                              <option value="ease-in">Ease in</option>
                              <option value="ease-out">Ease out</option>
                              <option value="ease-in-out">Ease in/out</option>
                              <option value="ease-out-back">Overshoot</option>
                            </select>
                          </label>
                          <NumberField label={`From · ${animationUnits(selectedAnimation.type)}`} ariaLabel="Animation from" step={0.1} value={selectedAnimation.from} onCommit={(value) => updateAnimation(selectedAnimation.id, { from: value }, 'from')} />
                          <NumberField label={`To · ${animationUnits(selectedAnimation.type)}`} ariaLabel="Animation to" step={0.1} value={selectedAnimation.to} onCommit={(value) => updateAnimation(selectedAnimation.id, { to: value }, 'to')} />
                        </div>
                        <div className="check-grid">
                          <label className="check">
                            <input type="checkbox" checked={selectedAnimation.loop} onChange={(event) => updateAnimation(selectedAnimation.id, { loop: event.target.checked })} />
                            Loop
                          </label>
                          <label className="check">
                            <input type="checkbox" checked={selectedAnimation.alternate} onChange={(event) => updateAnimation(selectedAnimation.id, { alternate: event.target.checked })} />
                            Ping-pong
                          </label>
                        </div>
                        <div className="action-row">
                          <button type="button" onClick={() => duplicateAnimation(selectedAnimation.id)}>Duplicate</button>
                          <button type="button" className="danger" onClick={() => deleteAnimation(selectedAnimation.id)}>Delete animation</button>
                        </div>
                      </div>
                    )}
                  </section>

                  <section className="inspector-section">
                    <div className="section-heading"><h3>Arrange</h3></div>
                    <div className="action-row">
                      <button type="button" onClick={() => moveLayer('up')}>Bring forward</button>
                      <button type="button" onClick={() => moveLayer('down')}>Send back</button>
                      <button type="button" onClick={() => moveLayer('top')}>To front</button>
                      <button type="button" onClick={() => moveLayer('bottom')}>To back</button>
                      <button type="button" onClick={duplicateSelectedOverlay}>Duplicate</button>
                      <button type="button" className="danger" onClick={deleteSelectedOverlay}>Delete</button>
                    </div>
                  </section>
                </div>
              ) : (
                <div className="inspector-empty">
                  <h3>{selectedPage?.name ?? 'Page'}</h3>
                  <p className="muted">
                    {Math.round(selectedPage?.width ?? 0)} × {Math.round(selectedPage?.height ?? 0)} · {selectedPage?.overlays.length ?? 0} objects
                  </p>
                  {selectedPage && (
                    <section className="inspector-section page-bookmark">
                      <h3>Bookmark tab</h3>
                      <p className="muted small">A coloured tab on the book edge and a Contents entry that jumps to this page.</p>
                      <label>
                        Tab text
                        <input
                          value={selectedPage.bookmark?.label ?? ''}
                          placeholder="e.g. Drinkware"
                          onChange={(event) => {
                            const label = event.target.value
                            const page = selectedPage
                            commitProject(
                              { ...committedProject, pages: committedProject.pages.map((candidate) => (candidate.id === page.id ? { ...candidate, bookmark: label ? { color: '#475569', textColor: '#ffffff', ...candidate.bookmark, label } : undefined } : candidate)) },
                              `bookmark-${page.id}`,
                            )
                          }}
                        />
                      </label>
                      {selectedPage.bookmark && (
                        <div className="field-grid">
                          <ColorField label="Tab colour" value={selectedPage.bookmark.color ?? '#475569'} allowAlpha={false} onChange={(color, key) => { const page = selectedPage; commitProject({ ...committedProject, pages: committedProject.pages.map((candidate) => (candidate.id === page.id && candidate.bookmark ? { ...candidate, bookmark: { ...candidate.bookmark, color } } : candidate)) }, key) }} />
                          <ColorField label="Text colour" value={selectedPage.bookmark.textColor ?? '#ffffff'} allowAlpha={false} onChange={(textColor, key) => { const page = selectedPage; commitProject({ ...committedProject, pages: committedProject.pages.map((candidate) => (candidate.id === page.id && candidate.bookmark ? { ...candidate, bookmark: { ...candidate.bookmark, textColor } } : candidate)) }, key) }} />
                        </div>
                      )}
                      <button type="button" className="link-button" onClick={() => setDesignOpen('bookmarks')}>Manage all bookmarks and tab style…</button>
                    </section>
                  )}
                  <p>No object selected. Click an object on the page, or add one from the toolbar.</p>
                  <p className="muted small">Shortcuts: Delete removes, Ctrl+D duplicates, arrow keys nudge (Shift ×10), Space plays the timeline, Esc deselects. Hold Alt while dragging to turn off snapping.</p>
                </div>
              )}
            </div>
          </aside>
        )}
      </main>

      {!isPreview && (
        <footer className="bottom-panel" aria-label="Timeline">
          <div className="timeline-resize" role="separator" aria-orientation="horizontal" aria-label="Resize timeline" onPointerDown={startTimelineResize} />
          <Timeline
            project={project}
            time={timelineTime}
            duration={timelineDuration}
            playbackState={playbackState}
            selectedAnimationId={selectedAnimationId}
            pixelsPerSecond={pixelsPerSecond}
            onZoom={setPixelsPerSecond}
            onPlay={playTimeline}
            onPause={pauseTimeline}
            onStop={stopTimeline}
            onSeek={scrubTimeline}
            onSelect={selectAnimation}
            onChange={(id, changes, mergeKey) => updateAnimation(id, changes, mergeKey)}
          />
        </footer>
      )}

      <div className="status-row" role="status">
        <span className="status-text">{status}</span>
        {error ? <span className="error-text">{error}</span> : null}
        <span className="status-meta">
          {project.pages.length} page{project.pages.length === 1 ? '' : 's'} · {Object.keys(project.assets).length} asset{Object.keys(project.assets).length === 1 ? '' : 's'}
          {dirty ? ' · unsaved changes' : ''}
        </span>
      </div>
    </div>
  )
}

export default Editor
