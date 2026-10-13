import { isTauri } from '@tauri-apps/api/core'

const EXTERNAL = /^(https?:|mailto:|tel:)/i

/** Opens a web/mail/phone link outside the app: the default browser on desktop, a new tab on the web. */
export async function openExternal(url: string): Promise<void> {
  if (!EXTERNAL.test(url)) return
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * In the desktop app, links that leave the app (object links in Preview, "Open online", WhatsApp…)
 * must open in the user's browser instead of replacing or popping up a webview.
 */
export function routeExternalLinks(doc: Document = document): () => void {
  if (!isTauri()) return () => undefined
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return
    const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!anchor) return
    const href = anchor.getAttribute('href') ?? ''
    if (!EXTERNAL.test(href)) return
    event.preventDefault()
    void openExternal(href).catch((error: unknown) => console.warn('Could not open link', error))
  }
  doc.addEventListener('click', onClick)
  return () => doc.removeEventListener('click', onClick)
}
