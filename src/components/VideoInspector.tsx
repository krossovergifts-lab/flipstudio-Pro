import { useState } from 'react'
import { formatBytes } from '../lib/assets'
import type { OverlayObject, ProjectState } from '../lib/project'
import { videoSource } from '../runtime/styles.js'

interface VideoInspectorProps {
  overlay: OverlayObject
  assets: ProjectState['assets']
  onChange: (changes: Partial<OverlayObject>, mergeKey?: string) => void
  onChooseFile: () => void
}

/** Video object settings: an uploaded file or a YouTube / Vimeo / .mp4 link, and how it plays. */
export function VideoInspector({ overlay, assets, onChange, onChooseFile }: VideoInspectorProps) {
  const asset = overlay.assetId ? assets[overlay.assetId] : undefined
  const [link, setLink] = useState(overlay.videoUrl ?? '')
  const parsed = link.trim() ? videoSource(link) : null
  const commitLink = () => {
    const value = link.trim()
    if (value === (overlay.videoUrl ?? '')) return
    onChange(value ? { videoUrl: value, assetId: undefined, src: undefined } : { videoUrl: undefined })
  }

  return (
    <section className="inspector-section" aria-label="Video settings">
      <div className="section-heading">
        <h3>Video</h3>
        <span className="muted">{asset ? 'Uploaded file' : parsed ? (parsed.kind === 'youtube' ? 'YouTube' : parsed.kind === 'vimeo' ? 'Vimeo' : 'Video link') : 'No video yet'}</span>
      </div>

      <div className="video-source">
        {asset ? (
          <div className="video-file">
            <span className="video-file-name" title={asset.name}>{asset.name}</span>
            <span className="muted">{formatBytes(asset.byteSize)}</span>
            <div className="video-file-actions">
              <button type="button" onClick={onChooseFile}>Replace…</button>
              <button type="button" className="danger" onClick={() => onChange({ assetId: undefined, src: undefined })}>Remove</button>
            </div>
          </div>
        ) : (
          <button type="button" className="block" onClick={onChooseFile}>Upload video file (MP4, WebM)…</button>
        )}
        {asset && asset.byteSize > 25 * 1024 * 1024 && (
          <p className="inspector-warning">This video is {formatBytes(asset.byteSize)}. Cloudflare Pages allows files up to 25 MB — for online catalogues, upload it to YouTube and paste the link instead.</p>
        )}
        {!asset && (
          <label>
            Or paste a YouTube / Vimeo link
            <input
              value={link}
              onChange={(event) => setLink(event.target.value)}
              onBlur={commitLink}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitLink() } }}
              placeholder="https://youtu.be/…"
              spellCheck={false}
              aria-label="Video link"
            />
          </label>
        )}
        {!asset && link.trim() && !parsed && <p className="inspector-warning">This link is not a YouTube, Vimeo or .mp4 video address.</p>}
      </div>

      <div className="check-grid">
        <label className="check">
          <input type="checkbox" checked={Boolean(overlay.autoplay)} onChange={(event) => onChange({ autoplay: event.target.checked })} />
          Play when the page opens
        </label>
        <label className="check">
          <input type="checkbox" checked={Boolean(overlay.looping)} onChange={(event) => onChange({ looping: event.target.checked })} />
          Loop
        </label>
        <label className="check">
          <input type="checkbox" checked={Boolean(overlay.muted)} onChange={(event) => onChange({ muted: event.target.checked })} />
          Sound off
        </label>
        <label className="check">
          <input type="checkbox" checked={overlay.showControls !== false} onChange={(event) => onChange({ showControls: event.target.checked })} />
          Player controls
        </label>
      </div>
      <label>
        Video fit
        <select value={overlay.fit === 'contain' ? 'contain' : 'cover'} onChange={(event) => onChange({ fit: event.target.value as OverlayObject['fit'] })}>
          <option value="cover">Fill the frame (crop)</option>
          <option value="contain">Show whole video</option>
        </select>
      </label>
      <p className="muted small">Videos play in Preview and published catalogues, and stop when the page is turned. Browsers start videos that play on their own with the sound off.</p>
    </section>
  )
}
