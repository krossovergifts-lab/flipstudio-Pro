import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountPublication, type PublicationData } from './reader.js'

const data: PublicationData = {
  title: 'Reader test',
  pages: [
    {
      id: 'p1',
      name: 'One',
      width: 1000,
      height: 1000,
      background: null,
      overlays: [
        { id: 'show', type: 'slideshow', label: 'Show', x: 0, y: 0, width: 500, height: 500, rotation: 0, opacity: 1, visible: true, autoplay: true, looping: true, duration: 1, slides: [{ id: 'a', src: 'a.png' }, { id: 'b', src: 'b.png' }] },
        { id: 'link', type: 'button', label: 'Shop', x: 0, y: 600, width: 200, height: 80, rotation: 0, opacity: 1, visible: true, url: 'https://example.com/shop' },
        { id: 'unsafe', type: 'button', label: 'Bad', x: 0, y: 700, width: 200, height: 80, rotation: 0, opacity: 1, visible: true, url: 'javascript:alert(1)' },
        { id: 'hidden', type: 'text', label: 'Hidden', x: 0, y: 0, width: 10, height: 10, rotation: 0, opacity: 1, visible: false },
      ],
    },
    { id: 'p2', name: 'Two', width: 1000, height: 1000, background: null, overlays: [] },
  ],
  animations: [{ id: 'm', targetId: 'link', type: 'move-y', start: 0, delay: 0, duration: 1, easing: 'linear', from: 100, to: 0, loop: false }],
}

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('publication reader', () => {
  it('renders only safe links and visible objects', () => {
    const root = document.createElement('div')
    document.body.append(root)
    const handle = mountPublication(root, data, { autoplay: false })
    expect(root.querySelector('a[data-object-id="link"]')!.getAttribute('href')).toBe('https://example.com/shop')
    expect(root.querySelector('[data-object-id="unsafe"]')!.tagName).toBe('DIV')
    expect(root.querySelector('[data-object-id="hidden"]')).toBeNull()
    handle.destroy()
  })

  it('navigates pages without a page-turn engine and restarts animations on page open', () => {
    const root = document.createElement('div')
    document.body.append(root)
    const handle = mountPublication(root, data, { autoplay: false })
    expect(root.querySelector('[data-role="page-count"]')!.textContent).toBe('1 / 2')
    root.querySelector<HTMLButtonElement>('[data-action="next-page"]')!.click()
    expect(handle.currentPage).toBe(1)
    expect(root.querySelector('[data-role="page-count"]')!.textContent).toBe('2 / 2')
    expect(handle.clock.state).toBe('playing')
    handle.destroy()
  })

  it('cancels every timer, frame and listener on destroy', () => {
    vi.useFakeTimers()
    const root = document.createElement('div')
    document.body.append(root)
    const removeListener = vi.spyOn(document, 'removeEventListener')
    const handle = mountPublication(root, data)
    expect(handle.clock.state).toBe('playing')
    expect(handle.controllers[0].playing).toBe(true)
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    handle.destroy()
    expect(handle.clock.state).toBe('stopped')
    expect(handle.controllers[0].playing).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    expect(removeListener).toHaveBeenCalledWith('keydown', expect.any(Function), undefined)
    expect(root.childElementCount).toBe(0)
    vi.advanceTimersByTime(5000)
    expect(root.childElementCount).toBe(0)
  })

  it('keeps a single-page (phone) book inside the screen', () => {
    // Like StPageFlip: its UI is created by loadFromHTML and sets min-width to minWidth × 2.
    class FakePageFlip {
      mount: HTMLElement
      settings: { minWidth: number; usePortrait: boolean }
      updates = 0
      constructor(mount: HTMLElement, settings: { minWidth: number; usePortrait: boolean }) { this.mount = mount; this.settings = settings }
      loadFromHTML(items: Element[]) { this.mount.append(...items); this.mount.style.minWidth = this.settings.minWidth * (this.settings.usePortrait ? 1 : 2) + 'px' }
      update() { this.updates += 1 }
      on() { return this }
      destroy() {}
    }
    const root = document.createElement('div')
    document.body.append(root)
    // jsdom has no layout: an empty stage measures 0×0, which is portrait.
    const handle = mountPublication(root, data, { autoplay: false, PageFlip: FakePageFlip, forceSinglePage: true })
    const book = handle.book as FakePageFlip
    expect(book.settings.usePortrait).toBe(true)
    expect(book.mount.style.minWidth).toBe('0px')
    expect(book.updates).toBeGreaterThan(0)
    handle.destroy()
  })

  it('lays PDF text over the page and finds it with search', () => {
    const root = document.createElement('div')
    document.body.append(root)
    const withText: PublicationData = {
      ...data,
      animations: [],
      pages: [
        { ...data.pages[0], overlays: [], text: [{ s: 'Leather wallets', x: 100, y: 50, w: 300, h: 40, eol: true }, { s: 'Gift boxes', x: 100, y: 100, w: 200, h: 20, a: -90 }] },
        { ...data.pages[1], text: [{ s: 'More wallets', x: 0, y: 0, w: 10, h: 10 }] },
      ],
    }
    const handle = mountPublication(root, withText, { autoplay: false })
    const spans = root.querySelectorAll<HTMLElement>('.fs-textlayer > span')
    expect(spans).toHaveLength(3)
    expect(spans[0].style.left).toBe('10%')
    expect(spans[0].style.top).toBe('5%')
    expect(spans[0].style.fontSize).toBe('4cqw')
    expect(spans[1].style.getPropertyValue('--fs-angle')).toBe('-90deg')
    expect(handle.search('wallets')).toEqual([{ page: 0, start: 8, end: 15 }, { page: 1, start: 5, end: 12 }])
    expect(handle.search('wallets gift')).toEqual([{ page: 0, start: 8, end: 20 }])
    handle.setSelectMode(true)
    expect(root.classList.contains('fs-selecting')).toBe(true)
    expect(root.querySelector('[data-action="select-text"]')!.getAttribute('aria-pressed')).toBe('true')
    handle.destroy()
  })
})
