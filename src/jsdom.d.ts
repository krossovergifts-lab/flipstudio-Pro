// Minimal typing for the jsdom API used by the export tests (avoids adding @types/jsdom).
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: { runScripts?: 'dangerously' | 'outside-only'; pretendToBeVisual?: boolean; url?: string })
    readonly window: Window & typeof globalThis
  }
}
