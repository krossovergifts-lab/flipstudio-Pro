# FlipStudio Pro Functionality Audit

Audit date: 2026-10-13 (critical bug-fix and UI stabilisation pass)
Previous audit: 2026-10-12 (summarised at the end of this file)

## How this pass was verified

| Environment | What it covers |
|---|---|
| Linux cloud workspace, Node 22, `npm ci` from the project's `package-lock.json` | Unit/integration tests (Vitest + jsdom), type-check, lint, production build |
| Chromium 141 (Playwright) against `vite preview` of the **production build** | End-to-end workflows A–G below, at 1024×700, 1280×720, 1366×768, 1600×900 and 1920×1080 |
| Exported HTML and ZIP opened from `file://` and from a separate HTTP server in a clean temp directory | Standalone publication playback |

**Not verified in this pass, stated plainly:**

- The Windows desktop app was **not** run (Linux workspace). The `src-tauri` folder was missing from the archive and has since been created and compiled here; see "Windows desktop packaging". Native WebView2 window resizing/maximising was not exercised. The Tauri file-dialog code paths are covered only by tests with the Tauri APIs mocked (`src/App.tauri.test.tsx`).
- Window resizing was verified by resizing the browser viewport, which exercises the same CSS. It was not verified by resizing a real WebView2 window.

## Reproduced defects and root causes

Each item was reproduced in Chromium at 1366×768 against the unmodified code before it was fixed. Measurements are from that run.

| # | Reported problem | What was reproduced | Root cause |
|---|---|---|---|
| 1 | Slideshow cannot reliably upload multiple images | **Add slideshow** created an empty box. The only way to add images was an **Add images** button in the inspector, rendered at **y = 852 px in a 768 px window** and covered by the timeline. The user could not reach it. | (a) **Layout:** the inspector had no scroll container. The 977 px panel overflowed its 453 px grid row and sat underneath the timeline, so every control below Opacity was unreachable. (b) Two-step flow: Add slideshow never opened a file picker. (c) Inspector edits went to `selectedOverlayId`, but the inspector displayed `overlays[0]` as a fallback while `selectedOverlayId` was `''`. Edits to the displayed object were silently dropped. |
| 1b | Slideshow transitions don't work | The `transition` setting (fade/slide/instant) was saved but **never rendered** in the editor or the export. Slides swapped instantly everywhere. | No transition implementation existed. |
| 1c | Autoplay instability | The autoplay effect depended on `previewSlideIndices`, so every slide change tore down and recreated every slideshow's interval. Each timer restarted from its own captured index. | Effect dependency on state it writes. |
| 1d | Image data handling | Every slide stored its full base64 data URL inline. Duplicating an object or each undo snapshot repeated it, and the same image was stored once per use. | No asset model. |
| 2 | Images animate in the editor but not in Preview | Preview showed **0 overlays**. It rendered StPageFlip with flat page bitmaps only and never drew objects, so no image, slideshow or animation could appear in Preview. The book was also positioned below the visible area at 1366×768. | Preview was a separate page-image viewer, not a renderer of the project. Export had a **second, copy-pasted** animation evaluator inside a string, so the editor, Preview and export were three different implementations. |
| 2b | Animation inconsistencies | `move-x/move-y/rotation` stored **absolute** values, so moving an object after animating it made it jump back to the old position on playback. At rest the editor showed the t = 0 animated state, so a "fade in" object was invisible while being edited. | Schema stored absolute positions. The editor always applied frames. |
| 3 | Broken layout | Toolbar wrapped to **127 px** (two rows) and Preview sat on the second row. Document scrolled to **1103 px** in a 768 px window. The page canvas ran under the timeline. A zoomed page was centred with `justify-content: center` in an `overflow: auto` box, which makes the top/left unreachable. The canvas group had its own `overflow: auto` inside another (nested scrollbars). | Grid rows and children lacked `min-height: 0` and per-panel scroll containers. Centred overflow pattern. No fixed toolbar height. A `max-width: 1100px` media query collapsed the editor to one column. |
| 3b | Controls behaving wrongly | **Zoom −** at 25 % set the zoom to 40 % (`Math.max(0.4, …)` vs a 0.2 floor elsewhere). Clearing a number field committed `0` (`Number('')`), so typing a new X value made the object jump to 0. | Inconsistent clamps. Unvalidated `Number()` on every keystroke. |
| 4 | Found during reproduction: PDF import fails on older Chromium/WebView2 | `this[#methodPromises].getOrInsertComputed is not a function` | pdf.js 6 uses `Map.prototype.getOrInsertComputed`, which only recent Chromium builds ship. Windows machines with an older WebView2 runtime would fail every import. |

## Fixes

### Phase 2: Multi-image slideshows

- **Add slideshow opens a multi-select file picker immediately** (`<input type=file multiple>`, which works in WebView2) and creates the slideshow with every chosen image, sized to the first image's aspect ratio. Cancelling creates nothing. A one-image slideshow is created with a status warning; no fake placeholder slides are ever generated.
- **Managed asset store** (`project.assets`). Each file is fully read into a data URL before the picker's `File` goes away, decoded once to validate it and read its size, then stored once under a **content-derived stable ID** (`asset-<fnv1a>-<length>`). Slides and image objects reference assets by ID, so identical images are stored once and duplicate/undo snapshots share them. Unused assets are pruned at save time. No `blob:` URLs are created for assets; the only object URLs are download links, which are revoked after use.
- Slideshow inspector: thumbnails with name, pixel size and file size; reorder (↑/↓ and drag-and-drop); remove; **replace** one image; **add more images**; transition (fade/slide/instant); transition duration; seconds per image; loop; autoplay; arrows; indicators (dots/thumbnails/none); pause on hover; start slide; image fit (cover/contain/stretch). Position and size are edited through X/Y/W/H and canvas handles.
- **One playback model.** `createSlideshowController` in `src/runtime/engine.js` drives the editor's "Play preview", Preview mode and exports. It owns at most one timer, so repeated Play can't stack timers, and `destroy()` clears it on unmount or delete.
- Transitions are real: CSS keyframe animations in `src/runtime/publication.css`, direction-aware for slide, shared by editor, Preview and export.
- Bad files in a multi-select (e.g. a `.txt`) are reported by name while the valid images still import.
- Drag-and-drop images onto the page: one image makes an image object, several make a slideshow, and dropping onto a selected slideshow appends. (In the desktop app this needs Tauri's native drop handling turned off; see below.)

### Phase 3: Animation and Preview consistency

- `src/runtime/engine.js` is the single evaluator: easing, start/delay/duration, from/to, opacity, X/Y, scale, rotation, sequencing on the same property, loop, ping-pong, overlay geometry, and one cancellable requestAnimationFrame clock with play/pause/stop/seek.
- **Preview mounts the same reader runtime that the export inlines** (`src/runtime/reader.js`). It is built from the same project data, object IDs and asset references, with real StPageFlip page turns, live objects, slideshows and animations. Leaving Preview calls `destroy()`, which cancels the frame loop, slideshow timers, ResizeObserver, keyboard listener and the PageFlip instance.
- Export embeds the same `engine.js` and `reader.js` source (export keywords stripped at build time) plus the StPageFlip browser bundle. The earlier export simulated page turns with a CSS tilt; it now uses the same page-turn engine as Preview.
- Animation values are now **relative to the object** (move = offset in page units, rotation = degrees added, opacity/scale = multipliers). Projects from v1/v2 are migrated automatically; tested.
- The editor shows the **design state when stopped** and the animated state while playing, paused or scrubbing. Stop restores the design state, so returning from Preview leaves no stale transforms (verified: every object back to `rotate(0deg) scale(1)`, opacity 1).
- Timeline: tracks per object with page labels, separate lanes for overlapping animations, drag a block to change its start, drag its right edge to change duration, click or drag the ruler to scrub, zoom ±, resizable panel height. Inspector: effect presets (fade, slide from each side, zoom, spin, pulse), start "after previous / with previous / at playhead", delay, easing (including overshoot), loop, ping-pong, duplicate, delete.

### Phase 4: Interface

- One grid owns the window: fixed 52 px toolbar / main area / resizable timeline / 28 px status bar, each with `min-height: 0`. Sidebar and inspector have their own vertical scroll areas, so there are no nested canvas scrollbars and no page-level scroll.
- The canvas uses the `margin: auto` centring pattern inside one scroll container. It is centred when it fits and fully reachable when zoomed in. **Fit** keeps the page fitted while the window or panels resize; manual zoom turns that off.
- Toolbar fits on one row from 1280 px. Below that, the middle group scrolls horizontally while **Export HTML / Export ZIP / Preview stay pinned** on the right (verified at 900, 1024 and 1180 px).
- Number fields keep in-progress text ("", "-", "1.") and commit only finite numbers. Typing and slider drags merge into one undo step.
- Selection is derived during render, so a deleted or undone object can't leave the inspector pointing at the wrong object.
- Also added: eight resize handles (Shift keeps aspect), rotate handle (Shift snaps 15°), snapping to page edges/centre and other objects with guides (Alt disables), Layers panel (select/hide/lock), Assets panel (size, usage, missing assets), keyboard shortcuts (Delete, Ctrl+D, Ctrl+Z/Y, Ctrl+S, Ctrl+O, arrows to nudge, Space to play, Esc), and a "New" project with an unsaved-changes prompt.

### Other

- Guarded polyfill (`src/polyfills.ts`) for `Map/WeakMap.getOrInsertComputed`. It does nothing where the browser already provides the method.
- PDF.js is code-split and loaded on first PDF import with the same worker/wasm/CMap configuration. The import pipeline itself is unchanged apart from per-page progress in the status bar. Main bundle: 959 KB → 530 KB.
- Desktop export: Export HTML/ZIP open a native Save dialog in Tauri, write the file, and verify the written byte size. If the capability is missing, the message names the permission to add.
- Project format is now **version 3** (assets map, relative animations, slideshow settings). Older files open and migrate. Files from a newer version are rejected with a clear message. Missing assets show as placeholders with a warning instead of failing to open.

## Files changed

| File | Change |
|---|---|
| `src/runtime/engine.js` + `.d.ts` | **New.** Shared animation evaluator, clock, geometry, slideshow controller |
| `src/runtime/reader.js` + `.d.ts` | **New.** Publication reader used by Preview and export |
| `src/runtime/publication.css`, `reader.css` | **New.** Shared object, slideshow and reader styles |
| `src/lib/project.ts` | Asset model, v3 schema and migrations, publication data, HTML/ZIP builders |
| `src/lib/assets.ts` | **New.** Image validation, decoding and asset creation |
| `src/App.tsx`, `src/App.css` | Editor rebuilt on the shared engine; layout repaired |
| `src/components/*.tsx` | **New.** OverlayView, SlideshowView, SlideshowInspector, PreviewPane, Timeline, NumberField |
| `src/polyfills.ts`, `src/main.tsx` | WebView2 compatibility polyfill |
| `src/runtime/engine.test.ts`, `reader.test.ts`, `src/lib/project.test.ts`, `src/App.test.tsx`, `src/App.tauri.test.tsx` | Regression tests |
| `src/jsdom.d.ts` | Test typing only |

No dependencies were added or upgraded. `package.json` and `package-lock.json` are unchanged.

## Test results (actual)

- `npm test`: **53 passed, 0 failed** (5 files)
  - `engine.test.ts` (17): easing curves; initial state before start and delay; mid-animation; completion; loop and ping-pong; deterministic initial state; sequencing on one property; multiple objects; geometry composition; clock play/pause/resume/seek/stop with exactly one pending frame; scrub while stopped; end-of-timeline; looping timeline; destroy cancels; slideshow stepping; no stacked timers; hover pause; non-looping end; transition classes.
  - `reader.test.ts` (3): safe links only; hidden objects omitted; page navigation restarts animations; destroy clears all timers, frames and listeners.
  - `project.test.ts` (17): serialise/reopen; blank default; asset dedupe and stable IDs; inline-image migration; prune on save; slideshow round-trip (order and every setting); missing-asset reporting; newer-version rejection; v1→v3 and v2→v3 migration; **exported HTML executed in an isolated DOM** (pages, objects, slideshow autoplay and slide transition, manual prev, scrub values); **ZIP extracted to a clean temp directory** and run (relative asset paths, PNG bytes, reopenable project file); remote media embedding; HTTP failure message; HTML/script escaping.
  - `App.test.tsx` (12): text and image import, save/open; three-image slideshow from one picker plus playback; reorder/remove/add/replace then save and reopen; invalid file mixed with valid ones; PDF import, thumbnails, double page, Preview and back; move/resize with undo/redo and the NW handle; number inputs and selection; open JSON; animation scrub on the real canvas, Stop returns to design state, persistence; clock pause/resume without duplicate loops; Preview uses the same object IDs and values as the editor and cleans up.
  - `App.tauri.test.tsx` (4, Tauri APIs mocked): ZIP export to the chosen path with size verification; missing `fs:allow-write-file` message; cancelled dialog; Save As then native Open.
- `npx oxlint`: 0 warnings, 0 errors.
- `npm run build` (`tsc -b && vite build`): passed. Remaining warning: the PDF.js chunk (430 KB) and main chunk (530 KB) exceed Vite's 500 KB advisory.
- End-to-end, production build, Chromium: **46 / 46 checks passed**:
  - **A.** Real 3-page PDF imported; aspect ratio kept (0.7063 vs 0.7067); thumbnail navigation.
  - **B.** Image added, dragged and resized with the mouse; two animations; scrubbing moves the real object.
  - **C.** Three distinct images from one picker; reorder; editor slideshow playback.
  - **E.** Preview shows the same objects; Preview values at 0.5 s are identical to the editor (`left 32.2689 %`, `opacity 0.75`); play/pause; Stop resets; manual next; slide transition animation running; autoplay loops; page turn to the 2–3 spread; back to editor with no stale transforms; editing still works.
  - **D.** Save, reload the app, Open: pages, image, three slides in order, transition and two animations intact.
  - **F.** Export HTML and Export ZIP through the UI. ZIP extracted to a clean directory. Each publication tested from `file://` (HTML and ZIP) and from a separate HTTP server: all images load, slideshow autoplays, animation at 0.5 s matches the editor, page turn works, StPageFlip active, no script errors.
  - **G.** No page scroll, canvas and inspector never under the timeline, inspector scrolls, timeline visible, toolbar fits on one row at ≥ 1280 px, at all five sizes.

## Windows desktop packaging (added 2026-10-13, second pass)

The received archive had no `src-tauri`, so a complete one was created:

| File | Purpose |
|---|---|
| `src-tauri/Cargo.toml`, `build.rs`, `src/main.rs`, `src/lib.rs` | Tauri 2.12 shell registering the dialog and fs plugins. Crate versions match the npm packages (dialog 2.8.2, fs 2.7.0). Release profile uses LTO and strips symbols. No console window in release. |
| `src-tauri/tauri.conf.json` | Product name, version 1.0.0, identifier `com.adesignaerium.flipstudio`, 1440×900 window with a 1024×640 minimum, `dragDropEnabled: false` (so image drag-and-drop reaches the editor), and **NSIS setup.exe + MSI** targets. Per-user install with no admin prompt. WebView2 is downloaded if missing. |
| `src-tauri/capabilities/default.json` | Least-privilege permissions: native dialogs, read/write text files, **write binary files (ZIP export)**, stat, scoped to the user's home, Desktop, Documents, Downloads and Pictures. Paths picked in the native dialogs are also allowed by the dialog plugin. |
| `src-tauri/icons/*`, `app-icon.png` | App and installer icons generated from one 1024 px source (`npx tauri icon`) |
| `.github/workflows/windows-installer.yml` | Builds, tests and uploads the Windows installers on a GitHub Windows runner |
| `package.json` | `tauri` / `tauri:build` scripts. Version set to 1.0.0. No dependency changes. |

Verified in this (Linux) workspace:

- `cargo check`: passed. This also validates every permission identifier in the capabilities file.
- `npx tauri build --bundles deb`: full release build, including `npm run build`, compiled and bundled successfully (4.05 MB). This exercises the same config, frontend embedding and plugin set as the Windows build.
- The compiled release binary launched on a virtual display and rendered the full editor from its embedded assets (WebKitGTK engine).

**Not verified:** the Windows installer itself was not built here. Cross-compiling needs the Windows Rust standard library from static.rust-lang.org, which this workspace's network blocks. The GitHub workflow has not been run yet either. Build with `npm run tauri:build` on Windows or run the workflow, then install on a clean PC and work through the release checklist in `README.md`.

## Third pass (2026-10-13): advanced styling and publication library

### Text, button and hotspot styling
- **Shared style runtime** (`src/runtime/styles.js`): one file renders object appearance in the editor canvas, Preview and exports, like `engine.js` does for animation. All sizes are in page units converted to page-relative `cqw`, so styling scales exactly at any zoom and in exports.
- **Fonts** (`src/lib/fonts.ts`):
  - 16 bundled open-licence families (OFL 1.1), regular and bold, including Arabic-capable Cairo and Tajawal.
  - 10 Windows system fonts.
  - **Import font file** (.ttf/.otf/.woff/.woff2): stored in the project and validated by actually loading it.
  - Exports embed **only the fonts in use** (data URLs in HTML, `fonts/` in ZIP). A font that can't be embedded produces a warning, not a silent fallback.
- **Text:**
  - Font, size, weight, italic, underline, all caps, horizontal and vertical alignment, colour, line height, letter spacing.
  - Text effects: shadow, hard shadow, glow, outline, emboss; gradient text.
  - Background, border, radius, padding, box shadow; right-to-left text handled with `dir="auto"`.
  - 14 presets (editorial headline, luxury gold serif, script, price tag, sale badge, neon, Arabic heading…).
- **Buttons:**
  - Solid or gradient fill, text colour, border, corner radius, shadow, all typography.
  - Hover effects: lift, grow, glow, darken, highlight, shine, underline.
  - Attention effects: pulse, glow, shine, bounce, float, wiggle, blink, ripple, heartbeat.
  - 10 presets (primary, outline, gradient pill, gold luxury, WhatsApp, shop now, ghost, minimal beige, text link…).
- **Hotspots:**
  - Shape (square/rounded/pill/circle), fill, border.
  - Visibility: always, on hover, or invisible click area.
  - Marker icons (dot, +, i, cart, eye, play, star) with colours, beacon/ripple/pulse effects, optional label.
  - 10 presets.
- **Click actions** for text, buttons, hotspots and images:
  - Open web page (auto-adds `https://`; unsafe schemes refused), go to page N, WhatsApp chat with pre-filled message (`wa.me`), email with subject, phone call.
  - **Product pop-up** card: title, price, description, image, call-to-action with its own link.
  - Optional hover tooltip.
  - Older projects' `url` field migrates automatically.
- **Animation presets** are now multi-track: pop in, rise in, drop in, swing in, spin in, slide/zoom variants, exits, and looping emphasis (pulse, breathe, float, rock, flash, spin), grouped as Entrance / Emphasis / Exit.

### Publication library (home screen)
- The app opens on a library of all publications (`src/components/LibraryHome.tsx`, `src/lib/library.ts`):
  - Cover thumbnails from page 1, page count, category, folder, last-edited date.
  - Per card: **Edit, Preview, Export (HTML/ZIP), Copy, Settings (title, description, category, folder), Delete** (with confirmation).
  - Folders (create, rename, delete; deleting a folder keeps its publications), search, sort.
  - New publication from PDF, blank A4, or **import a project file** saved earlier.
- Storage: desktop uses `Documents\FlipStudio Pro\Library` (one `.flipstudio.json` per publication plus `library.json`). If Windows has no usable Documents folder, it falls back to the app's data folder. The sidebar shows the actual path.
  - Every write goes to a temp file and is then renamed, so a crash can't leave a half-written file.
  - All library operations are queued, so autosave and renames can't interleave.
  - A missing or damaged index is rebuilt from the publication files.
- Editor in library mode: **‹ Library** button, document title, save status (Saved / Unsaved / Saving…), **autosave 1.2 s after the last change**, Save, and "Save copy" (a project file anywhere). The standalone editor behaviour (Save/Save As/Open) is unchanged.

### Bugs found and fixed during this pass
- Preview: Esc closed a product pop-up *and* left Preview. The reader now consumes that Esc.
- Desktop: Tauri errors are plain strings, so error messages showed generic text. They now show the real message everywhere (`src/lib/errors.ts`).
- Desktop: with no registered Documents folder the library failed with "unknown path" (found by running the compiled app). It now uses the fallback location.
- Preset tiles had `role="listitem"`, which hid them from assistive technology as buttons.
- Card action labels and paired colour pickers overflowed at narrow widths.

### Verification (actual results)
- `npm test`: **72 passed** (8 files): engine 17, reader 3, project/export 17, styles/actions/fonts in export 8, library 6, editor 14, desktop code paths (mocked Tauri) 4, library home 3.
- `npx oxlint` 0 warnings · `npm run build` passed · `cargo check` passed with the extended capabilities.
- Chromium against the production build: original editor suite **46/46**. New library/styling suite **19/19**:
  - Library empty state; new publication from PDF; preset fonts; autosave.
  - Product pop-up; Esc handling; go-to-page with real StPageFlip; cover thumbnails; folders and rename; duplicate; persistence across restart.
  - ZIP export from a card, opened via `file://`: fonts load from `fonts/`, pop-up works, go-to-page works, no script errors; delete with confirmation.
- **Compiled desktop app** (Linux build of the same Tauri project, WebKitGTK, driven with a simulated mouse on a virtual screen): opened on the library, created a publication, the editor showed "Saved", files were written (index plus project, no leftover temp files), and after a restart the library listed the publication. Tested with and without a Documents folder.
- Not verified: the Windows build and WebView2 specifically. Build with `npm run tauri:build` or the GitHub workflow and run the README checklist.

### Third-party licences
`THIRD_PARTY_NOTICES.md` contains the MIT licence of StPageFlip and the OFL licence text of every bundled font. Exported ZIP READMEs list the fonts they embed.

## Sixth pass (2026-10-14): reader v1.4 — centred book, bookmarks, auto flip, share

- Centred layout: a lone cover or last page is shifted to the middle; the book glides to the
  spread centre while turning. Verified in Preview and export (e2e6 C1–C3).
- Fixed: turning back to the cover showed the old page 2 under the turning page (StPageFlip
  keeps drawing the lifted page when the turn ends on a single page) — the lifted page is
  hidden for the duration of the turn (G1, G2).
- Fixed: page-turn sound did not play for drag turns (StPageFlip never reports "flipping" for
  a released drag) and could be blocked by the browser's autoplay rule — sound now unlocks on
  the first click/key and plays on every turn kind (SND1, SND2).
- Fixed: Zoom in → Reset left the book larger than the window (StPageFlip reset the width
  to 100% on rebuild).
- New: first/last page buttons, side arrows, click the page counter to type a page; zoom
  button toggles zoom ↔ reset; bookmark tabs (text, hex colours, hover effect), Contents,
  My bookmarks (saved in the reader's browser), auto flip (interval, start delay, loop,
  right-click for speed), share popover + email, Download PDF, top search bar, logo top-left.
- Design window redesigned: section list on the left, settings in the middle, live preview
  on the right. Publish "where" step redesigned as two clear cards.
- Tests: Vitest 98/98, oxlint clean, Playwright e2e 46 + 19 + 24 + 24 + 16 + 28 checks pass.

## Fifth pass (2026-10-14): 250-page catalogue, brand-free website, flipbook design

### Added
- **Large catalogues**: page images (and other large files) are stored as separate files beside the project (`<id>.files/` on desktop, IndexedDB entries in the browser), content-addressed, so saving after an edit writes only the small project JSON. Old projects convert on their next save. Pages get 240 px thumbnails at import for page lists and the reader. The reader loads only nearby page images (3 behind, 6 ahead, unloads beyond 14).
- **Reader**: zoom (button, double-click, Ctrl+wheel; drag to pan; Esc resets), All pages panel with go-to-page, Home/End keys, icon toolbar, optional logo, page-flip sound (synthesised paper sounds or an uploaded file; mute remembered per reader).
- **Page-turn presets**: smooth, magazine, hardcover, quick; speed; soft cover (StPageFlip forces the cover to a stiff board — the reader sets it back to soft after loading); page and book shadows.
- **Flipbook design dialog** (🎨 Design) with themes, background colour/gradient/image, toolbar/button/accent colours, page turn, sound, reader tools, logo, live preview of the first 6 pages.
- **Websites**: several publishing targets. *Single* layout publishes one publication at the root of its own site (brand-free `*.pages.dev` on Cloudflare Pages); *bookshelf* layout as before. Moving a publication between websites removes the old copy. Test connection now also tries a harmless write, so a key without write access is caught before publishing.
- **Replace PDF, keep my work**: new PDF versions keep objects, animations and design by page number (objects scale if the page size changed).

### Verification (actual results)
- `npm test`: **98 passed** (12 files), new: blob storage (memory and desktop file layout with mocked Tauri fs), single-site publishing and site list migration, phrase search, phone layout, replace-PDF.
- Chromium against the production build: editor 46/46, library 19/19, text/frames 24/24, publishing 24/24 (bookshelf + brand-free site served over HTTP), design/reader 16/16 (theme in preview and export, lazy pages, thumbnails, go to page, zoom/pan, mute, soft cover).
- **250-page test** (generated PDF, High quality, browser build): import + save 28 s, edit autosave writes only the 390 KB JSON, Preview opens in 0.2 s with 7 page images loaded, reopening the book 1.4 s. A real catalogue with photos renders more slowly per page at import.
- `cargo check` passed with the added `fs:allow-read-file` permission.
- Not verified: real Cloudflare Pages deploy, Windows desktop run of the blob storage (unit-tested with a mocked file system), how the synthesised page sound sounds on real speakers.

## Fourth pass (2026-10-13): frames & crop, PDF text layer, online publishing

### Added
- **Image/slideshow frames**: corner presets (Square, Soft, Rounded, Extra round, Circle), radius slider, border, shadow/glow. Same look in editor, Preview and exports (`frameStyle` in `runtime/styles.js`).
- **Crop**: double-click an image or slideshow (or "Crop on canvas"), drag to pan, mouse wheel to zoom, Esc to finish; Zoom/Horizontal/Vertical sliders and Reset. Applies to every slide (`cropStyle`).
- **PDF import wizard** (library "From a PDF…" and editor "Import PDF"): reads page count, text and PDF title first; Book info (title, description, category, keywords); **Keep text — selectable & searchable** (default) or **Images only**; scanned PDFs without text are detected and explained; page quality Web optimised (1400 px JPEG 82%), High (2000 px, 90%), Maximum (2600 px, 95%) — previously 0.7× PNG; reader theme (background and toolbar colours).
- **Reader text layer**: invisible text positioned exactly over each page (page units → %, font size in `cqw`, stretched to the PDF's run width). **Select text** turns off drag-to-flip so text can be selected and copied; **Search** (button or Ctrl+F) lists results with snippets, opens the page and highlights the match; phrases across lines are found.
- **Publish online** (`lib/publish.ts`, `components/PublishDialog.tsx`): GitHub repository + free static host. One commit per publish using the git data API; unchanged files are detected by git blob SHA and not re-uploaded; pages removed from a book are deleted online; one automatic retry if the site changed during publishing. Each book: `<slug>/index.html` with description, keywords, Open Graph/Twitter tags and canonical URL, `cover.jpg` (1200×630). Site: bookshelf `index.html` with search and category filter, `catalog.json`, `404.html`, `.nojekyll`. Library cards show ● Live, the link and Copy link; dialog offers Copy link, Open in browser, Share on WhatsApp, Email, Update, Unpublish and link renaming. The token is stored in this computer's app storage only and never in projects, exports or the site. Guide: `HOSTING.md`.

### Bugs found and fixed
- **Phones/narrow windows**: in single-page mode the book rendered 2000 px wide (StPageFlip re-applies its huge `min-width` when the pages load, after the reader's reset). Every exported/online flipbook on a phone was affected. The reader now resets it after loading and lays out again; regression test added.
- Dialog Esc no longer also triggers the editor's Esc (capture-phase handling).

### Verification (actual results)
- `npm test`: **90 passed** (10 files), including new tests for frames/crop, PDF text conversion, text layer + search, phone layout, publishing against an in-memory GitHub (first publish, unchanged republish uploads nothing, deleted pages removed, two books + unpublish, race retry, bad token, offline) and the library publish/update/unpublish UI.
- `npx oxlint` 0 warnings · `npm run build` passed · `cargo check` passed with the opener plugin and capability.
- Chromium against the production build: editor suite 46/46, library suite 19/19, **frames/crop/text suite 24/24** (real text PDF: wizard, JPEG pages, rounded frame, wheel zoom and drag pan, text alignment within 1% of the PDF, drag-select and clipboard copy, search, exported HTML keeps text/search/frame/crop), **publishing suite 16/16** (publish from the editor through a simulated GitHub API, files served over HTTP like a host: bookshelf, flipbook at its own link, Open Graph tags, JPEG preview image, text search online, no project file online, phone layout).
- Not verified: real GitHub/Vercel/Cloudflare accounts (no access from this environment — run the steps in HOSTING.md), the Windows build, and WhatsApp's actual preview rendering.

## Remaining limitations

- Not done yet (Milestone C/D items in the specification): multi-object selection, copy/paste, page insert/delete/reorder, show/hide and trigger-based interactions (links, page jumps and pop-ups are done), inserting video/audio objects, keyframe editing beyond from/to, publication-level reader settings (logo, background, colours), lazy rendering of very large PDFs (every page is rendered at import), PDF download button and "Allow download", table of contents, thumbnails panel, zoom in the reader, background sound.
- External links in the desktop app are routed to the default browser through the Tauri opener plugin (added in the fourth pass; compiles with `cargo check`, not run on Windows).
- Images are embedded in the project file (portable but larger). There is a 40 MB per-image limit. Very large catalogues with many photos will produce large project files; moving assets to a project folder is a later step.
- In the browser (development) build, **Save** without a chosen file uses browser storage, which fails above about 5 MB with a message to use Save As. The desktop app always writes to the chosen file.

## Previous audit (2026-10-12), condensed

PDF import (worker/wasm/CMap assets), page-coordinate move/resize with single-step undo, image import, Save/Save As/Open with size verification, v2 animation schema, HTML/ZIP export and the `dev:tauri` port fix were completed in the previous pass. The Tauri process-lifetime issue recorded then could not be re-checked here because `src-tauri` was not included.
