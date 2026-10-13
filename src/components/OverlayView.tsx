import { overlayStyle, type AnimationFrame, type SlideshowController } from '../runtime/engine.js'
import { HOTSPOT_MARKERS, cropStyle, frameStyle, skinClassName, skinStyle, styleFor } from '../runtime/styles.js'
import { findFont, type FontDefinition } from '../lib/fonts'
import { resolveSource, type OverlayObject, type PageDefinition, type ProjectState } from '../lib/project'
import { SlideshowView } from './SlideshowView'

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

interface OverlayViewProps {
  overlay: OverlayObject
  page: PageDefinition
  assets: ProjectState['assets']
  frame: AnimationFrame | null
  fonts: FontDefinition[]
  selected: boolean
  slideshowPlaying: boolean
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  onResizePointerDown: (event: React.PointerEvent<HTMLDivElement>, handle: ResizeHandle) => void
  onRotatePointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  onSlideshowController?: (id: string, controller: SlideshowController | null) => void
  onSlideshowIndex?: (id: string, index: number, playing: boolean) => void
  /** Crop mode: dragging pans the picture inside its frame and the wheel zooms. */
  cropping?: boolean
  onDoubleClick?: (event: React.MouseEvent<HTMLDivElement>) => void
  onCropWheel?: (event: React.WheelEvent<HTMLDivElement>) => void
}

/**
 * Editor-canvas object. Geometry comes from the shared engine's overlayStyle()
 * and markup uses the shared publication.css classes, so the canvas matches
 * Preview and export.
 */
export function OverlayView(props: OverlayViewProps) {
  const { overlay, page, assets, frame, selected } = props
  const style = overlayStyle(overlay, page, frame)
  const source = resolveSource({ assets }, overlay)
  const missingAsset = Boolean(overlay.assetId && !assets[overlay.assetId])
  let content: React.ReactNode
  if (overlay.type === 'slideshow') {
    content = (
      <SlideshowView
        overlay={overlay}
        assets={assets}
        playing={props.slideshowPlaying}
        onController={props.onSlideshowController}
        onIndexChange={props.onSlideshowIndex}
      />
    )
  } else if (overlay.type === 'image') {
    content = source
      ? <div className="fs-clip"><img className={`fs-image fs-fit-${overlay.fit ?? 'cover'}`} src={source} alt={overlay.label} draggable={false} style={cropStyle(overlay) as React.CSSProperties} /></div>
      : <div className="fs-placeholder">{missingAsset ? 'Missing image asset' : 'No image'}</div>
  } else if (overlay.type === 'text' || overlay.type === 'button' || overlay.type === 'hotspot') {
    const look = styleFor(overlay)
    const marker = overlay.type === 'hotspot' ? (look.marker && look.marker !== 'none' ? look.marker : overlay.effect === 'beacon' ? 'dot' : 'none') : 'none'
    content = (
      <div className={skinClassName(overlay)} style={skinStyle(overlay, page, findFont(look.fontFamily, props.fonts).stack) as React.CSSProperties}>
        {(overlay.type !== 'hotspot' || look.showLabel) && <span className="fs-text" dir="auto">{overlay.label}</span>}
        {marker !== 'none' && <span className="fs-marker" data-marker={marker} aria-hidden="true">{HOTSPOT_MARKERS[marker]}</span>}
        {overlay.type === 'hotspot' && !look.showLabel && <span className="hotspot-label">{overlay.label}</span>}
      </div>
    )
  } else {
    content = overlay.label
  }

  return (
    <div
      className={`fs-overlay overlay-box ${overlay.type} ${selected ? 'selected' : ''} ${overlay.locked ? 'locked' : ''}`}
      data-type={overlay.type}
      data-object-id={overlay.id}
      style={overlay.type === 'image' || overlay.type === 'slideshow' ? { ...style, ...frameStyle(overlay, page) } : style}
      onPointerDown={props.onPointerDown}
      onDoubleClick={props.onDoubleClick}
      onWheel={props.cropping ? props.onCropWheel : undefined}
      data-cropping={props.cropping ? 'true' : undefined}
      role="button"
      tabIndex={-1}
      aria-label={`${overlay.type} ${overlay.label}`}
      aria-pressed={selected}
    >
      {content}
      {props.cropping && <div className="crop-hint">Crop · drag to reposition · scroll to zoom · Esc or double-click to finish</div>}
      {selected && !overlay.locked && !props.cropping && (
        <>
          {HANDLES.map((handle) => (
            <div
              key={handle}
              className={`resize-handle ${handle}`}
              data-handle={handle}
              onPointerDown={(event) => props.onResizePointerDown(event, handle)}
            />
          ))}
          <div className="rotate-handle" title="Rotate (hold Shift to snap)" onPointerDown={props.onRotatePointerDown} />
        </>
      )}
    </div>
  )
}
