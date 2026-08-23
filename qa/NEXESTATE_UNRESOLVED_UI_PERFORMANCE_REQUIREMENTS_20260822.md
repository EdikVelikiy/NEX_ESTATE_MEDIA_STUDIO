# NexEstate unresolved UI/performance repair — requirements matrix

Branch: `codex/nexestate-unresolved-ui-performance-fix-20260822`
Base: `origin/main` at `fc433e50deded55f74e26dc113834bdead84a433`
Reference set: `01_CURRENT_HUB.png` … `06_BOTTOM_TOOLBAR_TARGET.png`
Status legend: `PENDING`, `PASS`, `FAIL`, `BLOCKED`.

The first four PNG files document regressions. `05_EXACT_NEX_LOGO_REFERENCE.png`
is the only source for the cover mark geometry. `06_BOTTOM_TOOLBAR_TARGET.png`
is the mandatory toolbar composition reference.

| # | Requirement | Production target | Required verification | Evidence | Status |
|---:|---|---|---|---|---|
| 1 | Hub has exactly `NexEstate · Единая рабочая среда · by Эдик Великий` in a real flow footer pinned by flex layout only when content is short. | `index.html` hub shell/footer styles and markup | Desktop + narrow viewport DOM/geometry check; exact-text count = 1; footer bottom at viewport or after content. | Final Hub screenshots + geometry JSON | PENDING |
| 2 | “Мои презентации” has a two-line Studio signature only in the physical bottom footer. | `apps/presentation/index.html` home shell/footer | Exact text count, last meaningful page block, short/long project-list geometry. | Presentations screenshots (short and long list) | PENDING |
| 3 | Editor signature is one clean text node below the lower toolbar, never in slide/header/toolbar controls. | `apps/presentation/index.html` editor shell and footer runtime | DOM uniqueness, whitespace/text validation, geometry below all toolbar groups at desktop and narrow widths. | Editor screenshots + DOM assertions | PENDING |
| 4 | Exact full NEX / ESTATE / line / gold dot / skyline appears once at top-left of green cover column with 3–6% safe margins; no-logo hides all app branding. | `apps/presentation/assets/nexestate-logo-reference-clean.png`; by-NexEstate cover renderer in `apps/presentation/index.html` | Pixel/reference inspection; `logoRect` bounds and intersection assertions; preview/PDF/PNG; reversible no-logo check. | Cover screenshots and exported render evidence | PENDING |
| 5 | Cover title uses measured fit-to-box, max four lines, no transform scaling, visual-only ellipsis, and zero overlap with logo/address/metro/description/photo for short through extreme Cyrillic titles. | by-NexEstate cover renderer in `apps/presentation/index.html` | Four title cases; recorded geometry intersections = 0; saved source text unchanged; preview/PDF/PNG parity. | Four geometry records + long-title screenshot | PENDING |
| 6 | Lower toolbar is one continuous bar with three intact labeled groups; every control retained; compact Delete button has stable dimensions/states; narrow layout preserves whole groups via wrapping/scroll. | lower-toolbar DOM/CSS/runtime in `apps/presentation/index.html` | Desktop 1920/1440 and narrow 390 click/geometry matrix; hover/focus/active size invariant; all controls visible/reachable. | Toolbar desktop/mobile screenshots + control inventory | PENDING |
| 7 | Metro markers are correct/neutral: Krasnoselskaya red; Komsomolskaya red+brown or neutral; no white/fake color; walking icon/time below 10 minutes; car only with explicit car time. | metro parsing and cover renderer in `apps/presentation/index.html` | One- and two-station fixtures; marker color inspection; walking/car glyph rules in preview and exports. | Metro screenshot + renderer assertions | PENDING |
| 8 | All source PDF pages remain; blank/near-blank/text-only candidates are filtered only from extracted media/transfer/download while real bright interiors/maps/plans survive; originals remain full resolution. | extraction analysis/filter and media-transfer runtime in `apps/presentation/index.html` | Mixed PDF/candidate fixture; source count invariant; accepted/rejected bitmap reason matrix; original-vs-thumbnail dimensions/blob check. | Extracted-media screenshot + analysis JSON | PENDING |
| 9 | Real 18-photo project has responsive batched transfer and fast mode switches, without redundant import/decode/render/storage or long main-thread blocking. | media cache, transfer pipeline, preview pipeline and persistence runtime in `apps/presentation/index.html` | Same project/browser/hardware BEFORE and AFTER: active state, work start, stable preview, transfer duration, mode durations, render/decode/FileReader/base64/storage counts, >50 ms long tasks. | Before/after performance JSON and report table | PENDING |
| 10 | Restored mode/theme is correct on the first visible frame; otherwise a neutral loading state is shown, never the default-cover flash. | editor bootstrap/restore gate in `apps/presentation/index.html` | Reload saved by-NexEstate project under CPU slowdown/video/screenshot sampling; wrong-theme frame count = 0. | First-frame trace/screenshots | PENDING |
| 11 | Newly loaded photo cards have reserved, stable geometry on first render for portrait, landscape, square, narrow, tall and 18 sequential uploads. | media-card CSS and thumbnail lifecycle in `apps/presentation/index.html` | Bounding-box sampling before/after decode and tab changes; no height jump/overflow. | Geometry JSON + media screenshot | PENDING |
| 12 | Focus link exists only while a real field is focused and is fully removed on blur, outside click, tab/mode change, collapse and Escape; dynamic contact fields work immediately. | focus-overlay lifecycle/delegation in `apps/presentation/index.html` | Real focus/blur/Escape/mode/collapse/contact clicks; no orphan overlay/line nodes. | Focus lifecycle assertions/screenshots | PENDING |
| 13 | Floor plan upload never changes brand/theme, remains separate media, supports placement without duplicates, and persists through reload/export. | media state, floor-plan placement controls and persistence in `apps/presentation/index.html` | Upload, each supported placement, reload, preview/PDF/PNG; mode/theme snapshots before/after; unique asset IDs. | Floor-plan QA JSON/screenshots | PENDING |
| 14 | Purpose is rendered/saved/exported (empty means hidden); visible font settings work independently in both modes; storage failures are classified without data loss. | data panel, font controls, renderers and persistence error handling in `apps/presentation/index.html` | Purpose set/empty/reload/export; two distinct font choices per mode; quota/security/transaction/serialization messages where inducible. | Data/font screenshots and state assertions | PENDING |
| 15 | Required navigation/buttons work through real clicks in Chromium and Firefox, normal and private/isolated contexts, including imports, tabs, modes, media, plan, contacts, fonts, templates, backups, delete and export. | event handlers and overlay/pointer/focus CSS in `apps/presentation/index.html` | Browser/click matrix; no console/page errors; downloads and dialogs observed, not inferred. | Per-browser report JSON/screenshots | PENDING |
| 16 | Preview, PDF and PNG are visually consistent for cover/logo/title/metro/purpose/plan/no-logo and current mode/theme. | presentation renderer/export paths in `apps/presentation/index.html` | Preview canvas vs PNG pixel comparison and rendered PDF page comparison with tolerance; state metadata equality. | Export comparison report/screenshots | PENDING |

## Performance instrumentation contract

The baseline and final run use the same isolated browser profile, the same generated
18-photo project, the same viewport, and the same machine. Measurements include:

- click to active-state paint;
- click to first useful work marker;
- click to stable final preview;
- “Перенести всё в Медиа” duration;
- mode-switch durations in both directions;
- complete render passes;
- decode / `createImageBitmap` / `FileReader` / base64 conversions;
- IndexedDB and localStorage writes;
- `PerformanceObserver` long tasks above 50 ms.

## Browser click matrix scope

Required real actions: new presentation, PDF/text/photo upload, project import,
applications/presentations navigation, PDF/DATA/MEDIA tabs, both presentation modes,
transfer all, floor plan and placement, contacts, font settings, templates, backups,
delete, PDF export and PNG export.

This file is updated with measured evidence and `PASS`/`FAIL` only after the final
interface has been exercised.
