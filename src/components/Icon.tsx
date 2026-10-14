/** Line icons for the app chrome (24×24 grid, drawn with the current text colour). */
const PATHS = {
  back: 'M15 18l-6-6 6-6',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13',
  pdf: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5M9 13h6M9 17h4',
  image: 'M4 5h16v14H4zM4 16l4.5-4.5 3 3L15 11l5 5M9 9.5h.01',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  button: 'M3 8.5A2.5 2.5 0 015.5 6h13A2.5 2.5 0 0121 8.5v7a2.5 2.5 0 01-2.5 2.5h-13A2.5 2.5 0 013 15.5zM8 12h8',
  hotspot: 'M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 110 8 4 4 0 010-8z',
  slides: 'M7 5h10v14H7zM3 8v8M21 8v8',
  video: 'M3 6h12v12H3zM15 10l6-3.5v11L15 14',
  design: 'M12 3a9 9 0 100 18c1 0 1.6-.8 1.6-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H16a5 5 0 005-5C21 6.5 17 3 12 3zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 110 6 3 3 0 010-6z',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  sun: 'M12 8a4 4 0 110 8 4 4 0 010-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z',
  monitor: 'M3 5h18v12H3zM8 21h8M12 17v4',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  plus: 'M12 5v14M5 12h14',
  folder: 'M3 6.5A1.5 1.5 0 014.5 5H9l2 2h8.5A1.5 1.5 0 0121 8.5v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 17.5z',
  search: 'M11 4a7 7 0 110 14 7 7 0 010-14zM21 21l-4.3-4.3',
  palette: 'M12 3a9 9 0 100 18c1 0 1.6-.8 1.6-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H16a5 5 0 005-5C21 6.5 17 3 12 3z',
  toolbar: 'M3 6h18M3 12h18M3 18h10',
  book: 'M4 5.5A2.5 2.5 0 016.5 3H20v15H6.5A2.5 2.5 0 004 20.5zM4 20.5A2.5 2.5 0 006.5 23H20v-5',
  sound: 'M4 9v6h4l5 4V5L8 9H4zM16.5 8.5a5 5 0 010 7',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  play: 'M7 5.5v13l11-6.5z',
  share: 'M18 3a2.5 2.5 0 110 5 2.5 2.5 0 010-5zM6 9.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5zM18 16a2.5 2.5 0 110 5 2.5 2.5 0 010-5zM8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 8.5h.01',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
  table: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14',
  stats: 'M4 19V5M4 19h16M8 15l3-4 3 2 5-6',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  settings: 'M12 9a3 3 0 110 6 3 3 0 010-6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 16, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  )
}
