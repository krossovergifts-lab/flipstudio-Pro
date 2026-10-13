declare module 'page-flip' {
  export class PageFlip {
    constructor(element: HTMLElement, options?: Record<string, unknown>)
    loadFromHTML(items: ArrayLike<Element> | Element[]): void
    destroy(): void
    on(eventName: string, callback: (event: { data: unknown }) => void): PageFlip
    getCurrentPageIndex(): number
    flipPrev(): void
    flipNext(): void
  }

  const pageFlip: { PageFlip: typeof PageFlip }
  export default pageFlip
}
