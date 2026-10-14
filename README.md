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
- **Reader**: page turns, zoom (double-click / Ctrl+wheel, drag to pan), All pages + go to page, Select text, Search (Ctrl+F), page-flip sound with mute, product pop-ups, works on phones; pages load lazily so 250-page catalogues open instantly.
- **Flipbook design** (🎨 in the editor): themes, background colour / gradient / image, toolbar colours, page-turn presets (smooth, magazine, hardcover, quick) with speed and soft cover, page sound (built-in or your own), optional logo — with a live preview.
- **Replace PDF**: import a new version of the catalogue PDF and keep all objects, animations and the design.
- **Publish online**: several websites — a brand-free website for one catalogue (e.g. `promotionalgifts-catalogue-2027.pages.dev`, Cloudflare Pages) or a bookshelf of publications (GitHub Pages) — with WhatsApp/social previews. See [HOSTING.md](HOSTING.md).
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
