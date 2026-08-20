# NexEstate Final Correction V2 — pre-change matrix

Дата preflight: 2026-08-20 (Europe/Moscow)

База: `origin/main` @ `0d33132c2a00f6e8009077ee83e844526bcb0013`

Рабочая ветка: `codex/nexestate-final-correction-v2-20260820`

Production entry points: `/index.html`, `/apps/presentation/index.html`, `/apps/media/index.html`

PWA: `/manifest.webmanifest`, `/service-worker.js`, `/pwa-shell.js`
Хранилища: IndexedDB для проектов/Blob; localStorage только для компактных настроек; Cache Storage для app shell.

> D4 = только фоновые цветовые поля первой обложки by NexEstate; 05 = только точная геометрия логотипа

## Baseline evidence before production edits

| Метрика | До правки | Целевое значение |
|---|---:|---:|
| «Мои презентации»: основная строка подписи | `25px` | `37.5px` (150%) |
| «Мои презентации»: строка `by Эдик Великий` | `16px` | `24px` (150%) |
| Editor: центральное название Studio | `7.5px` | `11.25px` (150%) |
| Hub: верхняя подпись | `27px` + `12px` | удалить из верхней части |
| Hub: текущий footer | `11px`, нет автора | точная строка из промпта |

Baseline browser run: `qa/results/critical-regression-20260819-pre.json` — 112 PASS / 5 FAIL. Все 5 FAIL находятся в одном persistent-profile сценарии и каскадно вызваны оставшимся открытым тестовым modal после keyboard шага; clean Chrome desktop, Chrome narrow, Edge InPrivate и Pixel 7 touch прошли обязательные клики без production exception.

## Requirement → production surface → verification

| ID | Требование | Production surface / root cause target | Обязательная проверка |
|---|---|---|---|
| A1 | Кнопки Hub работают в Chromium/Firefox, normal/private, mouse/touch/keyboard | `apps/presentation/index.html`: home launchers, dialog lifecycle, hit-testing | Физические click/tap/Enter/Space; chooser/download events; no forced clicks |
| A2 | «Новая презентация» без повторной PDF-кнопки | New-project dialog | DOM/role audit + реальный create/cancel |
| A3 | PDF/TXT/MD/photo/project import | Home launchers + shared semantic import | Реальные filechooser; одинаковый semantic result paste/TXT; compatible project round-trip |
| A4 | Tooltip закрывается и не блокирует | Tooltip lifecycle | mouseleave/focusout/Escape/click + `elementFromPoint` |
| A5 | Все editor controls сохранены | Header/tabs/sidebar/bottom toolbar | Полная physical-click inventory one-to-one |
| B1 | Hub exact true footer, top duplicate removed | `/index.html` header/footer | Full-page desktop/mobile screenshot; footer after content; exact text count=1 |
| B2 | Presentations exact true footer at 150% | `#studioHome`, `#ne80HomeSignature` | Computed `37.5px`/`24px`; content grows and footer remains after grid; exact text count=1 |
| B3 | Editor title only inside bottom bar at 150% | `.ne52-topbar`, `.ps-bottom-bar` | Top text absent; bottom title computed `11.25px`; no overlap desktop/mobile |
| B4 | D4 composition only on first by cover | by-NexEstate first-cover canvas renderer | First-page screenshot/reference comparison; later/single pages pixel geometry unchanged outside intended region |
| C1 | Exact logo from 05 only | `apps/presentation/assets/nexestate-logo-reference-clean.png`; brand renderer | Asset alpha/crop/aspect audit; first-page bbox; no D4-derived logo |
| C2 | Full first-page logo; later compact NEX | canonical canvas builders | Canvas semantic tokens/bboxes on first/later pages; PDF/PNG path parity |
| C3 | No-logo removes app branding, reversible | `hideAppBranding` canonical setting | Preview/compare/fullscreen/PDF/PNG; user PDF text preserved; toggle round-trip |
| D1 | Title fit ≤4 lines and ≤30% left column | cover title fit renderer | short/long/extreme Cyrillic; recorded bbox; canonical full text retained; export parity |
| D2 | No phantom title/address/scenario | canonical data + renderers | blank/space/custom/save/reload/template/export |
| D3 | Description terminal normalization | semantic import provenance | generated terminal label removed; intentional user final word preserved |
| D4 | Purpose is visible and live | cover render mapping | Data edit → preview/PDF/PNG exact value; empty hides |
| E1 | Multiple metros + walking time | semantic parser + canonical station array + render rows | 8 parsing fixtures and real TXT/PDF; first/all stations retained |
| E2 | Deterministic metro colors | embedded station mapping | Красносельская red; Комсомольская red+brown or neutral; unknown neutral |
| E3 | Walking vs car semantics | metro renderer | walker for pedestrian; car only explicit source |
| F1 | Single focus connector lifecycle | focus state/overlay | One source/target/line while focused; zero after blur/outside/Escape/tab/mode/project/details/contact |
| G1 | Floor plan does not reset presentation | floor-plan import/settings | Mode/theme/page/selection snapshot before/after; save/reopen/export |
| G2 | Floor plan placement can move without duplicate | page-destination control | Cover/available page selection; asset id count stable; native quality retained |
| G3 | By/single state isolation | mode-scoped settings | Limits/selections/layout preserved across rapid mode switches/reload |
| H1 | Filter rejects blank artifacts, preserves useful media | PDF candidate classifier/extraction | 7 required deterministic fixtures + real photo-rich PDF |
| H2 | Native resolution and bounded memory | PDF extraction pipeline | Original dimensions/aspect; no upscale; repeat import/no freeze |
| I1 | Bottom toolbar matches reference 08 | `.ps-bottom-bar` groups/layout | Desktop screenshot; height/spacing/active states; no jitter/overlap |
| I2 | Every production function remains accessible | bottom toolbar controls | All buttons/selects/switches physically actionable desktop/narrow/Pixel 7 |
| J1 | Visible font settings, ≥6 distinct Cyrillic options | Data sidebar/font renderer | Open/select each; preview changes; save/reload/PDF/PNG/offline |
| K1 | Blob data stays in IndexedDB | persistence layer | No giant base64 in localStorage; multi-project/save/reload; existing DB not cleared |
| K2 | Quota/private failures are bounded | persistence error handling | Injected quota error in isolated context; previous record intact; buttons remain usable |
| K3 | SW/cache upgrade and offline | `service-worker.js` / app shell | Online warm, controller, offline reload Hub/Projects/Editor; subpath scope |
| L1 | Preview/PDF/PNG canonical parity | canonical slide builders/export | Same layout/text/logo tokens and successful file signatures |
| L2 | Contacts/broker state preserved | contacts page/editor | Show/hide, round avatar, editable fields, connector, PDF/PNG |
| L3 | Undo/redo/compare/fullscreen/zoom retained | top toolbar | Real click/keyboard and state transitions |
| M1 | No duplicate IDs/handlers/dead refs | changed HTML/JS | inline-script compile, duplicate-id/handler audit, diff check |
| M2 | No runtime errors/hangs | all browser environments | console/pageerror/unhandled rejection collectors; bounded waits |
| V1 | Mandatory final screenshots | `qa/results/final-correction-20260820/after/` | Hub, Projects, Editor PDF/Data/Media, by first/later, single, contacts, toolbar desktop/mobile |
| V2 | Explicit reference discrepancy report | final QA report | Compare refs 01–09; list all intentional and remaining differences |

## Existing interaction inventory to preserve

- Routes: Hub `/`; Presentation home/editor/catalog `/apps/presentation/`; Media `/apps/media/`; browser history home↔editor; PWA/offline/subpath.
- Home: new project, PDF upload, text paste/TXT/MD, photo upload, project import, project open/select/menu/export, catalog open/download/back.
- Editor header: applications, presentations, undo, redo, compare, fullscreen, zoom, tabs PDF/Data/Media, Studio theme/menu.
- PDF: choose/replace/delete, OCR/re-run/clear, source pages, extracted assets, transfer all/individual, download/delete.
- Data: title/address/metro/purpose/description, mode-scoped feature values/labels/order/selection, contacts/broker photo, fonts.
- Media: photos add/delete/reorder/focus, floor-plan upload/delete/placement, page order and focus.
- Bottom bar: template save/select/delete, backups/create/restore, validate, autosave status, by/single mode, theme, no-logo, photo/floor popovers, convert, PDF/PNG/other formats, settings.

This file is intentionally created before production edits and will be updated only with final PASS/FAIL evidence, never rewritten to hide a failed or unavailable check.

## Final evidence — 2026-08-20

- Production branch: `codex/nexestate-final-correction-v2-20260820`, base `origin/main` @ `0d33132c2a00f6e8009077ee83e844526bcb0013`.
- Browser matrix: `qa/results/final-correction-v2-20260820-browser-matrix.json` — **176 PASS / 0 FAIL / 0 NOT VERIFIED**.
- Visual/layout matrix: `qa/results/final-correction-v2-20260820/visual-and-layout-report.json` — **6 PASS / 0 FAIL**.
- Static verification: 66/66 inline JavaScript blocks compile; `service-worker.js` and both QA scripts pass syntax checks; duplicate HTML IDs: 0; `git diff --check`: PASS.
- Runtime audit: no `console.error`, `pageerror`, unhandled rejection or failed request in the final required scenarios.
- Exact sizing evidence: Presentations footer `25px → 37.5px` and `16px → 24px`; editor title `7.5px → 11.25px`.
- Required reference separation remained strict: **D4 = only the background color fields of the first by NexEstate cover; 05 = only the exact logo geometry**.
- Final screenshots: `qa/results/final-correction-v2-20260820/screenshots/01-hub-full.png` through `12-d4-reference-vs-by-cover.png`.

| IDs | Final status | Concrete evidence |
|---|---|---|
| A1–A5 | PASS | Physical mouse/touch/keyboard actions in Chrome, Edge and Firefox normal/private; chooser, dialog, tooltip and editor action checks all passed without forced clicks. |
| B1–B4 | PASS | Exact Hub/Presentations/editor text, semantic footers, computed 150% sizes, 64px editor bar, and D4 first-cover-only metadata/screenshots verified. |
| C1–C3 | PASS | Clean transparent logo asset, first/later page tokens, reversible no-logo state and export/reload parity verified. |
| D1–D4 | PASS | Measured title fit, blank-field behavior, provenance-aware description normalization and live purpose rendering verified. |
| E1–E3 | PASS | Multi-station parsing, deterministic colors and pedestrian/car semantics verified with fixtures and live import. |
| F1 | PASS | Exactly one connector while focused and zero source/target/line after every required exit path. |
| G1–G3 | PASS | Floor-plan placement preserves project state, avoids duplicates, supports undo/redo and keeps mode settings isolated. |
| H1–H2 | PASS | Classifier fixtures and physical PDF import retained useful images/plans/maps, rejected artifacts and preserved native dimensions within bounded processing. |
| I1–I2 | PASS | Bottom bar is 64px and every control is physically hit-testable at 1440×900, 1024×720 and Pixel 7 412×839. |
| J1 | PASS | Visible Cyrillic font selector, independent per-mode choices, persistence and export paths verified. |
| K1–K3 | PASS | Binary records remained in IndexedDB, localStorage stayed metadata-scale, quota handling remained bounded, SW upgrade and offline reload passed. |
| L1–L3 | PASS | Canonical preview/PDF/PNG parity, broker contacts and all top-toolbar actions passed physical interaction checks. |
| M1–M2 | PASS | Syntax, duplicate ID, handler/runtime and error collectors passed. |
| V1–V2 | PASS | All 12 mandatory screenshots were regenerated and explicit reference-role/discrepancy evidence is in the final report. |
