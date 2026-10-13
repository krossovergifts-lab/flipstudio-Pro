import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import PageFlipLib from 'page-flip'
import { mountPublication, type PublicationHandle } from '../runtime/reader.js'
import { buildPublicationData, type ProjectState } from '../lib/project'

interface PreviewPaneProps {
  project: ProjectState
  startPage: number
  onPageChange?: (page: number) => void
}

/**
 * Preview mode. Mounts the exact reader runtime that exported publications use,
 * fed with the live project. Unmounting destroys the reader, which cancels its
 * animation frame, slideshow timers, observers, listeners and PageFlip.
 */
export function PreviewPane({ project, startPage, onPageChange }: PreviewPaneProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<PublicationHandle | null>(null)
  const pageChange = useRef(onPageChange)
  useLayoutEffect(() => {
    pageChange.current = onPageChange
  }, [onPageChange])
  const data = useMemo(() => buildPublicationData(project), [project])
  const lastPage = useRef(startPage)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const handle = mountPublication(root, data, {
      PageFlip: PageFlipLib.PageFlip,
      startPage: lastPage.current,
      onPageChange: (page) => {
        lastPage.current = page
        pageChange.current?.(page)
      },
    })
    handleRef.current = handle
    return () => {
      handle.destroy()
      if (handleRef.current === handle) handleRef.current = null
    }
  }, [data])

  return <div ref={rootRef} className="preview-pane" data-testid="preview-pane" />
}
