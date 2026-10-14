/** HTML snippets for putting a published flipbook on another website. */

const attr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

export interface EmbedOptions {
  /** 'window': fills most of the visitor's screen height; otherwise a fixed height in px. */
  height: 'window' | number
  startPage: number
}

const pageUrl = (url: string, startPage: number, embed: boolean) => {
  const base = url.split('#')[0]
  const query = embed ? (base.includes('?') ? '&embed=1' : '?embed=1') : ''
  return `${base}${query}${startPage > 1 ? `#page=${Math.floor(startPage)}` : ''}`
}

/** Inline flipbook (responsive iframe). */
export function iframeSnippet(url: string, title: string, options: EmbedOptions): string {
  const height = options.height === 'window' ? 'min(82vh, 820px)' : `${Math.max(320, Math.round(options.height))}px`
  return `<iframe src="${attr(pageUrl(url, options.startPage, true))}" title="${attr(title)}" style="display:block;width:100%;height:${height};border:0;border-radius:12px;" allow="fullscreen; autoplay; clipboard-write" allowfullscreen loading="lazy"></iframe>`
}

/** Cover picture that opens the flipbook in a new tab. */
export function coverSnippet(url: string, title: string): string {
  const base = url.split('#')[0].replace(/\/?$/, '/')
  return `<a href="${attr(base)}" target="_blank" rel="noopener" title="${attr(title)}"><img src="${attr(base)}cover.jpg" alt="${attr(title)}" width="600" style="max-width:100%;height:auto;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.18);"></a>`
}

/** A button that opens the flipbook in a full-screen pop-up on the same page. */
export function popupSnippet(url: string, title: string, label = 'View catalogue'): string {
  const src = attr(pageUrl(url, 1, true))
  return `<button type="button" onclick="(function(){var o=document.createElement('div');o.style.cssText='position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:2vmin';o.innerHTML='<iframe src=&quot;${src}&quot; title=&quot;${attr(title)}&quot; allow=&quot;fullscreen; autoplay&quot; allowfullscreen style=&quot;width:100%;height:100%;max-width:1400px;border:0;border-radius:12px;background:#111&quot;></iframe><button type=&quot;button&quot; aria-label=&quot;Close&quot; style=&quot;position:absolute;top:10px;right:14px;width:40px;height:40px;border:0;border-radius:50%;background:#fff;font-size:22px;cursor:pointer&quot;>&times;</button>';o.addEventListener('click',function(e){if(e.target===o||e.target.tagName==='BUTTON'){o.remove();}});document.body.appendChild(o);})()" style="padding:12px 22px;border:0;border-radius:999px;background:#111;color:#fff;font:600 15px system-ui,sans-serif;cursor:pointer;">${label.replace(/</g, '&lt;')}</button>`
}
