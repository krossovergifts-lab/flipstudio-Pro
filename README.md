# FlipStudio Pro

Windows desktop app for turning PDF catalogues into interactive flipbooks with images,
slideshows, animations and links, and exporting self-contained HTML/ZIP publications.

Built with React + TypeScript + Vite (editor), Tauri 2 (Windows shell), PDF.js and StPageFlip.

## Features

- **Library home screen**: all publications as cards with covers, folders, search, sort; edit, preview, export, copy, settings and delete per publication. Stored in `Documents\FlipStudio Pro\Library` with autosave.
- **Editor**: PDF pages as the background, plus images, styled text, buttons, hotspots and multi-image slideshows.
- **Styling**: 16 bundled fonts (including Arabic), system fonts and your own imported fonts; presets for text, buttons and hotspots; gradients, borders, shadows, text effects; hover and attention effects.
- **Click actions**: web links, go to page, WhatsApp chat, email, phone, and product pop-ups with image, price and call-to-action.
- **Animation**: timeline with entrance, emphasis and exit presets; Preview is the exported reader with real page turns.
- **PDF import wizard**: title, description, category, keywords; keep the PDF's text selectable, copyable and searchable (or images only); web-optimised / high / maximum page quality; reader colour theme.
- **Frames and crop**: rounded corners, circle, border and shadow for images and slideshows; crop by double-clicking (drag to pan, scroll to zoom) or with sliders.
- **Reader**: centred book (the cover and last page sit in the middle), page turns with sound, first / previous / next / last buttons and side arrows, type a page number, zoom in ↔ reset, All pages, coloured **bookmark tabs** on the book edge, **Contents** list, readers' own **My bookmarks**, **Auto flip** (interval, delay, loop), **Share** (copy link, WhatsApp, Facebook, LinkedIn, X, email), **Download PDF**, Select text, Search bar, your logo top-left, product pop-ups; works on phones; pages load lazily so 250-page catalogues open instantly.
- **Flipbook design** (🎨 in the editor): themes, background colour / gradient / image, toolbar colours, page-turn presets (smooth, magazine, hardcover, quick) with speed and soft cover, page sound (built-in or your own), bookmarks (tab text, colour as hex, hover effect slide / grow / glow), auto flip, share & PDF download, logo and title — with a live preview.
- **Video**: video objects (upload MP4/WebM or paste a YouTube / Vimeo link) and video slides in slideshows; play on their page, stop on page turn.
- **SEO & Google Analytics**: title, description, keywords, language and "hide from Google"; crawlable page text, structured data, sitemap.xml, robots.txt; links that open on a page (`#page=12`); GA4 page views and events (searches, clicks, shares, downloads, videos) with optional cookie notice.
- **New edition**: next year's PDF with the same design, published on the same link (the old edition stays in the library).
- **Product hotspots from Excel/CSV**: SKU, page, name, price, link, WhatsApp — markers placed on the product codes automatically, re-import updates.
- **Own statistics** (Cloudflare Pages + D1): readers, visits, page views, top pages, searches, clicks, countries, devices — dashboard in the app.
- **Embed code**: iframe, pop-up button or cover link for WordPress, Shopify, Wix.
- **Meta Pixel & LinkedIn Insight Tag** with mapped events; **page link previews** (`/p/12/` shows page 12 in WhatsApp).
- **Phones**: one compact toolbar with a More sheet, pinch to zoom, swipe to turn.
- **App theme**: light, dark or match Windows (library sidebar or the sun/moon button in the editor).
- **Replace PDF**: import a new version of the catalogue PDF and keep all objects, animations and the design.
- **Publish online**: connect Cloudflare once, then each brand-free catalogue website is created and uploaded in one click (Cloudflare Pages direct upload, no GitHub repository); also several websites — a brand-free website for one catalogue (e.g. `promotionalgifts-catalogue-2027.pages.dev`, Cloudflare Pages) or a bookshelf of publications (GitHub Pages) — with WhatsApp/social previews. See [HOSTING.md](HOSTING.md).
- **Export**: a self-contained HTML file, or a ZIP folder for web hosting. Fonts are embedded and everything works offline.

## Develop

```
npm install
npm run tauri:dev     # desktop app with live reload (Vite on port 5183)
npm run dev           # editor in a browser only
npm test              # unit, integration and export tests
npm run lint
```

## Build the Windows installer

### On your Windows PC

Requirements (one-time): Node.js 22, Rust (https://rustup.rs) and the
"Desktop development with C++" workload from Visual Studio Build Tools. If
`npm run tauri:dev` already works, you have all of them.

```
npm install
npm run tauri:build
```

Output:

- `src-tauri\target\release\bundle\nsis\FlipStudio Pro_1.0.0_x64-setup.exe`: the installer to share
- `src-tauri\target\release\bundle\msi\FlipStudio Pro_1.0.0_x64_en-US.msi`: for IT/managed deployment

The setup .exe installs for the current user (no administrator prompt), adds Start-menu
and uninstall entries, and downloads Microsoft's WebView2 runtime if the PC does not
already have it (Windows 10/11 normally do).

### On GitHub (no local setup)

Push this project to a GitHub repository, open **Actions → Windows installer → Run
workflow**, and download the `FlipStudio-Pro-Windows` artifact when it finishes. Pushing
a tag such as `v1.0.1` also attaches the installers to a GitHub release.

### Release checklist

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
2. `npm test`, then build.
3. Install the setup .exe on a clean Windows PC and check: PDF import, slideshow,
   animation Preview, Save/Open, Export HTML/ZIP, window resize and maximise.

### Code signing

Unsigned installers show Windows SmartScreen's "Windows protected your PC" warning
(users click **More info → Run anyway**). To distribute to clients without the warning,
buy an OV/EV code-signing certificate and add it under `bundle.windows` in
`src-tauri/tauri.conf.json` (see https://v2.tauri.app/distribute/sign/windows/).

## Project layout

- `src/App.tsx`: editor
- `src/runtime/`: shared animation engine and publication reader (used by the editor, Preview and exports)
- `src/lib/project.ts`: project format (v3), migrations, HTML/ZIP export
- `src-tauri/`: Windows shell, installer settings (`tauri.conf.json`) and permissions (`capabilities/default.json`)
- `FUNCTIONALITY_AUDIT.md`: what was fixed and how it was verified
