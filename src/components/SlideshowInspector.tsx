import { useState } from 'react'
import { videoSource } from '../runtime/styles.js'
import { formatBytes } from '../lib/assets'
import { resolveSource, type OverlayObject, type ProjectState, type SlideImage } from '../lib/project'
import { NumberField } from './NumberField'

interface SlideshowInspectorProps {
  overlay: OverlayObject
  assets: ProjectState['assets']
  currentIndex: number
  playing: boolean
  onChange: (changes: Partial<OverlayObject>, mergeKey?: string) => void
  onAddImages: () => void
  onAddVideo?: () => void
  onAddVideoLink?: (url: string) => void
  onReplaceImage: (slideId: string) => void
  onTogglePlay: () => void
  onStep: (direction: 1 | -1) => void
  onGoTo: (index: number) => void
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export function SlideshowInspector(props: SlideshowInspectorProps) {
  const { overlay, assets } = props
  const slides = overlay.slides ?? []
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [videoLink, setVideoLink] = useState('')
  const linkOk = Boolean(videoSource(videoLink))

  const setSlides = (next: SlideImage[]) => {
    const startIndex = Math.min(overlay.startIndex ?? 0, Math.max(0, next.length - 1))
    props.onChange({ slides: next, startIndex })
  }

  return (
    <section className="inspector-section" aria-label="Slideshow settings">
      <div className="section-heading">
        <h3>Slideshow</h3>
        <span className="muted">{slides.length} slide{slides.length === 1 ? '' : 's'}</span>
      </div>

      <div className="slide-playback" role="group" aria-label="Slideshow preview controls">
        <button type="button" onClick={() => props.onStep(-1)} disabled={slides.length < 2} aria-label="Previous slide">‹</button>
        <button type="button" onClick={props.onTogglePlay} disabled={slides.length < 2}>
          {props.playing ? 'Pause preview' : 'Play preview'}
        </button>
        <button type="button" onClick={() => props.onStep(1)} disabled={slides.length < 2} aria-label="Next slide">›</button>
        <span className="muted" data-testid="slide-position">{slides.length ? `${props.currentIndex + 1} / ${slides.length}` : '0 / 0'}</span>
      </div>

      <ol className="slide-list" aria-label="Slideshow images">
        {slides.map((slide, index) => {
          const asset = slide.assetId ? assets[slide.assetId] : undefined
          const isVideo = slide.kind === 'video'
          const linked = isVideo && !slide.assetId ? videoSource(slide.videoUrl) : null
          const source = isVideo ? linked?.thumb ?? '' : resolveSource({ assets }, slide)
          const name = slide.alt ?? asset?.name ?? `Slide ${index + 1}`
          return (
            <li
              key={slide.id}
              className={`slide-row ${index === props.currentIndex ? 'current' : ''} ${dragIndex === index ? 'dragging' : ''}`}
              draggable
              onDragStart={(event) => {
                setDragIndex(index)
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', String(index))
              }}
              onDragOver={(event) => {
                if (dragIndex === null) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (dragIndex !== null && dragIndex !== index) setSlides(moveItem(slides, dragIndex, index))
                setDragIndex(null)
              }}
              onDragEnd={() => setDragIndex(null)}
            >
              <button type="button" className="slide-thumb" onClick={() => props.onGoTo(index)} aria-label={`Show slide ${index + 1}: ${name}`}>
                {isVideo && slide.assetId && asset ? <video src={asset.dataUrl} muted preload="metadata" /> : source ? <img src={source} alt="" draggable={false} /> : <span className="missing">{isVideo ? '▶' : 'Missing'}</span>}
                {isVideo && <span className="slide-video-badge" aria-hidden="true">▶</span>}
              </button>
              <div className="slide-info">
                <span className="slide-name" title={name}>{index + 1}. {name}</span>
                <span className="muted">
                  {isVideo ? (asset ? `Video · ${formatBytes(asset.byteSize)}` : linked ? `${linked.kind === 'youtube' ? 'YouTube' : linked.kind === 'vimeo' ? 'Vimeo' : 'Video'} link` : 'Video link not supported') : asset ? `${asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ''}${formatBytes(asset.byteSize)}` : slide.src ? 'Linked image' : 'Missing asset'}
                </span>
              </div>
              <div className="slide-actions">
                <button type="button" aria-label={`Move slide ${index + 1} up`} disabled={index === 0} onClick={() => setSlides(moveItem(slides, index, index - 1))}>↑</button>
                <button type="button" aria-label={`Move slide ${index + 1} down`} disabled={index === slides.length - 1} onClick={() => setSlides(moveItem(slides, index, index + 1))}>↓</button>
                <button type="button" aria-label={`Replace slide ${index + 1}`} onClick={() => props.onReplaceImage(slide.id)}>⇄</button>
                <button type="button" aria-label={`Remove slide ${index + 1}`} className="danger" onClick={() => setSlides(slides.filter((item) => item.id !== slide.id))}>✕</button>
              </div>
            </li>
          )
        })}
      </ol>
      {!slides.length && <p className="empty-hint">No slides yet. Add two or more images or videos to create a slideshow.</p>}
      <div className="slide-add-row">
        <button type="button" className="primary" onClick={props.onAddImages} aria-label={slides.length ? 'Add more images' : 'Add images'}>
          {slides.length ? '+ Images' : 'Add images'}
        </button>
        {props.onAddVideo && <button type="button" onClick={props.onAddVideo}>+ Video file</button>}
      </div>
      {props.onAddVideoLink && (
        <form
          className="slide-link-row"
          onSubmit={(event) => {
            event.preventDefault()
            if (!linkOk) return
            props.onAddVideoLink?.(videoLink.trim())
            setVideoLink('')
          }}
        >
          <input value={videoLink} onChange={(event) => setVideoLink(event.target.value)} placeholder="YouTube / Vimeo link" aria-label="Video slide link" spellCheck={false} />
          <button type="submit" disabled={!linkOk}>Add</button>
        </form>
      )}
      {slides.some((slide) => slide.kind === 'video') && <p className="muted small">Video slides play with the sound off and the slideshow moves on when an uploaded video ends. YouTube / Vimeo slides start when the reader taps play.</p>}

      <div className="field-grid">
        <label>
          Transition
          <select value={overlay.transition ?? 'fade'} onChange={(event) => props.onChange({ transition: event.target.value as OverlayObject['transition'] })}>
            <option value="fade">Fade</option>
            <option value="slide">Slide</option>
            <option value="instant">Instant</option>
          </select>
        </label>
        <label>
          Image fit
          <select value={overlay.fit ?? 'cover'} onChange={(event) => props.onChange({ fit: event.target.value as OverlayObject['fit'] })}>
            <option value="cover">Fill (crop)</option>
            <option value="contain">Fit (letterbox)</option>
            <option value="fill">Stretch</option>
          </select>
        </label>
        <NumberField
          label="Seconds per image"
          min={0.5}
          step={0.5}
          value={overlay.duration ?? 3}
          onCommit={(value) => props.onChange({ duration: Math.max(0.5, value) }, 'slide-duration')}
        />
        <NumberField
          label="Transition (s)"
          min={0}
          max={5}
          step={0.1}
          value={overlay.transitionDuration ?? 0.6}
          disabled={overlay.transition === 'instant'}
          onCommit={(value) => props.onChange({ transitionDuration: Math.min(5, Math.max(0, value)) }, 'slide-transition')}
        />
        <label>
          Indicators
          <select value={overlay.showIndicators ?? 'dots'} onChange={(event) => props.onChange({ showIndicators: event.target.value as OverlayObject['showIndicators'] })}>
            <option value="dots">Dots</option>
            <option value="thumbnails">Thumbnails</option>
            <option value="none">None</option>
          </select>
        </label>
        <label>
          Start at
          <select value={overlay.startIndex ?? 0} onChange={(event) => props.onChange({ startIndex: Number(event.target.value) })} disabled={!slides.length}>
            {slides.map((slide, index) => <option key={slide.id} value={index}>Slide {index + 1}</option>)}
            {!slides.length && <option value={0}>Slide 1</option>}
          </select>
        </label>
      </div>
      <div className="check-grid">
        <label className="check">
          <input type="checkbox" checked={overlay.autoplay ?? true} onChange={(event) => props.onChange({ autoplay: event.target.checked })} />
          Autoplay
        </label>
        <label className="check">
          <input type="checkbox" checked={overlay.looping ?? true} onChange={(event) => props.onChange({ looping: event.target.checked })} />
          Loop
        </label>
        <label className="check">
          <input type="checkbox" checked={overlay.showControls ?? true} onChange={(event) => props.onChange({ showControls: event.target.checked })} />
          Arrows
        </label>
        <label className="check">
          <input type="checkbox" checked={overlay.pauseOnHover ?? false} onChange={(event) => props.onChange({ pauseOnHover: event.target.checked })} />
          Pause on hover
        </label>
      </div>
      <p className="muted small">Autoplay, arrows and indicators take effect in Preview and exported publications. Use Play preview to check timing here.</p>
    </section>
  )
}
