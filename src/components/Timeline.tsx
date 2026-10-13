import { useMemo, useRef } from 'react'
import { animationBegin, animationEnd, type ClockState } from '../runtime/engine.js'
import type { OverlayObject, ProjectAnimation, ProjectState } from '../lib/project'

interface TimelineProps {
  project: ProjectState
  time: number
  duration: number
  playbackState: ClockState
  selectedAnimationId: string
  pixelsPerSecond: number
  onZoom: (pixelsPerSecond: number) => void
  onPlay: () => void
  onPause: () => void
  onStop: () => void
  onSeek: (time: number) => void
  onSelect: (animation: ProjectAnimation) => void
  onChange: (id: string, changes: Partial<ProjectAnimation>, mergeKey: string) => void
}

const LABEL_WIDTH = 168
const LANE_HEIGHT = 26
const SNAP = 0.05

type DragState = { id: string; mode: 'move' | 'resize'; originX: number; start: number; duration: number }

export function Timeline(props: TimelineProps) {
  const { project, time, duration, playbackState, pixelsPerSecond } = props
  const dragRef = useRef<DragState | null>(null)
  const laneRef = useRef<HTMLDivElement | null>(null)
  const visibleSeconds = Math.max(5, Math.ceil(duration + 1))
  const laneWidth = visibleSeconds * pixelsPerSecond
  const hasAnimations = project.animations.length > 0

  const rows = useMemo(() => {
    const objects = new Map<string, { overlay: OverlayObject; pageIndex: number }>()
    project.pages.forEach((page, pageIndex) => page.overlays.forEach((overlay) => objects.set(overlay.id, { overlay, pageIndex })))
    const byTarget = new Map<string, ProjectAnimation[]>()
    for (const animation of project.animations) {
      const list = byTarget.get(animation.targetId) ?? []
      list.push(animation)
      byTarget.set(animation.targetId, list)
    }
    return [...byTarget.entries()]
      .map(([targetId, animations]) => {
        // Overlapping animations on one object get separate lanes so none is hidden.
        const laneEnds: number[] = []
        const lanes = new Map<string, number>()
        for (const animation of [...animations].sort((a, b) => animationBegin(a) - animationBegin(b))) {
          let lane = laneEnds.findIndex((end) => end <= animationBegin(animation) + 1e-6)
          if (lane < 0) lane = laneEnds.length
          laneEnds[lane] = animation.loop ? Number.POSITIVE_INFINITY : animationEnd(animation)
          lanes.set(animation.id, lane)
        }
        return { targetId, animations, lanes, laneCount: Math.max(1, laneEnds.length), info: objects.get(targetId) }
      })
      .sort((a, b) => (a.info?.pageIndex ?? 1e9) - (b.info?.pageIndex ?? 1e9))
  }, [project.animations, project.pages])

  const timeFromClientX = (clientX: number): number => {
    const lane = laneRef.current
    if (!lane) return 0
    const rect = lane.getBoundingClientRect()
    return Math.max(0, (clientX - rect.left) / pixelsPerSecond)
  }

  const startScrub = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!hasAnimations) return
    event.preventDefault()
    props.onSeek(Math.min(duration, timeFromClientX(event.clientX)))
    const move = (moveEvent: PointerEvent) => props.onSeek(Math.min(duration, timeFromClientX(moveEvent.clientX)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const startDrag = (event: React.PointerEvent, animation: ProjectAnimation, mode: DragState['mode']) => {
    event.stopPropagation()
    event.preventDefault()
    props.onSelect(animation)
    dragRef.current = { id: animation.id, mode, originX: event.clientX, start: animation.start, duration: animation.duration }
    const move = (moveEvent: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const delta = (moveEvent.clientX - drag.originX) / pixelsPerSecond
      const snap = (value: number) => Math.round(value / SNAP) * SNAP
      if (drag.mode === 'move') {
        props.onChange(drag.id, { start: Math.max(0, snap(drag.start + delta)) }, `timeline-move-${drag.id}`)
      } else {
        props.onChange(drag.id, { duration: Math.max(0.05, snap(drag.duration + delta)) }, `timeline-resize-${drag.id}`)
      }
    }
    const up = () => {
      dragRef.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const ticks = []
  const step = pixelsPerSecond >= 80 ? 0.5 : 1
  for (let second = 0; second <= visibleSeconds + 1e-9; second += step) {
    ticks.push(
      <div key={second} className={`ruler-tick ${Number.isInteger(second) ? 'major' : ''}`} style={{ left: second * pixelsPerSecond }}>
        {Number.isInteger(second) ? `${second}s` : ''}
      </div>,
    )
  }

  const playheadLeft = Math.min(time, visibleSeconds) * pixelsPerSecond

  return (
    <div className="timeline">
      <div className="timeline-controls">
        <button
          type="button"
          className={playbackState === 'playing' ? '' : 'primary'}
          onClick={playbackState === 'playing' ? props.onPause : props.onPlay}
          disabled={!hasAnimations}
        >
          {playbackState === 'playing' ? 'Pause' : 'Play'}
        </button>
        <button type="button" onClick={props.onStop} disabled={!hasAnimations}>Stop</button>
        <input
          aria-label="Timeline scrub"
          type="range"
          min={0}
          max={Math.max(0.1, duration)}
          step={0.01}
          value={Math.min(time, Math.max(0.1, duration))}
          onChange={(event) => props.onSeek(Number(event.target.value))}
          disabled={!hasAnimations}
        />
        <span className="timeline-time" data-testid="timeline-time">{time.toFixed(2)}s / {duration.toFixed(2)}s</span>
        <span className={`mode-pill ${playbackState === 'stopped' ? '' : 'live'}`}>
          {playbackState === 'stopped' ? 'Design view' : playbackState === 'playing' ? 'Playing' : 'Paused at playhead'}
        </span>
        <div className="zoom-group" role="group" aria-label="Timeline zoom">
          <button type="button" aria-label="Zoom timeline out" onClick={() => props.onZoom(Math.max(30, pixelsPerSecond / 1.5))}>−</button>
          <button type="button" aria-label="Zoom timeline in" onClick={() => props.onZoom(Math.min(400, pixelsPerSecond * 1.5))}>+</button>
        </div>
      </div>
      <div className="timeline-body">
        {hasAnimations ? (
          <div className="timeline-grid" style={{ width: LABEL_WIDTH + laneWidth + 24 }}>
            <div className="timeline-row ruler-row">
              <div className="track-label">Time</div>
              <div className="ruler" ref={laneRef} style={{ width: laneWidth }} onPointerDown={startScrub}>
                {ticks}
              </div>
            </div>
            {rows.map((row) => (
              <div className="timeline-row" key={row.targetId} style={{ height: row.laneCount * LANE_HEIGHT + 4 }}>
                <div className="track-label" title={row.info?.overlay.label ?? row.targetId}>
                  <span className="track-page">P{(row.info?.pageIndex ?? -1) + 1}</span>
                  {row.info?.overlay.label ?? 'Missing object'}
                </div>
                <div className="track-lane" style={{ width: laneWidth }} onPointerDown={startScrub}>
                  {row.animations.map((animation) => (
                    <div
                      key={animation.id}
                      role="button"
                      tabIndex={0}
                      className={`animation-timeline-item ${props.selectedAnimationId === animation.id ? 'active' : ''} ${animation.loop ? 'looping' : ''}`}
                      style={{
                        left: animationBegin(animation) * pixelsPerSecond,
                        width: Math.max(10, animation.duration * pixelsPerSecond),
                        top: 2 + (row.lanes.get(animation.id) ?? 0) * LANE_HEIGHT,
                        height: LANE_HEIGHT - 4,
                      }}
                      title={`${animation.type} · starts ${animationBegin(animation).toFixed(2)}s · ${animation.duration.toFixed(2)}s`}
                      onPointerDown={(event) => startDrag(event, animation, 'move')}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') props.onSelect(animation)
                      }}
                    >
                      <span>{animation.type}</span>
                      <div className="item-resize" aria-hidden="true" onPointerDown={(event) => startDrag(event, animation, 'resize')} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="timeline-playhead" style={{ left: LABEL_WIDTH + playheadLeft }} />
          </div>
        ) : (
          <p className="empty-hint timeline-empty">No animations yet. Select an object and choose Add animation in the inspector.</p>
        )}
      </div>
    </div>
  )
}
