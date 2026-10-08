# 06 · Migration plan, effort, risks, non-goals, benchmarks

## 1. Principles of the plan

* **Every milestone ships to users** as a normal update, through the update mechanism of M0.
* **The riskiest unknowns are resolved first by measurement**, before code depends on them:
  * SMB behaviour on the bank's real share;
  * Acrobat's rendering of soft masks;
  * the corporate policy matrix.
* **Engines are swapped one at a time behind the existing contracts.** First the export, keeping v3
  storage. Then the screen. Then the storage. If one phase disappoints, the previous phase's product is
  still a complete, better v3.
* The v3 test suites stay green until the code they test is deleted.

## 2. Phases (milestones)

**The executable, step-by-step version of this plan is [`PLAN.md`](PLAN.md).** It covers:
* a drawing of the end state;
* every step, with the files to read, the work and the "done when" checks;
* the dependency graph and the timeline;
* the feature preservation map.

This section is the summary. Team: 2 engineers + 0.5 QA/pilot coordinator.

| Milestone | Weeks | ew | Ships | Content | Exit (🚦 = human gate) |
|---|---|---|---|---|---|
| **M0 · Foundations on v3** | 3 | 6 | v3.4 | CI, release ZIPs, side-by-side updater with rollback, v3 quick fixes (P5, P10), golden capture of v3, field tests on the real share/PCs/Acrobat | 🚦 G0: field results decide journal vs lean-lock, the Acrobat recipe and the font fallback |
| **M1 · React app** | 3 | 5 | v3.5 | React API on Preact (alias) → Zustand store with selectors replaces the global `S`/`emit` → real React 19 (ADR-012) | identical behaviour; ≤ 5 components re-render per selection change |
| **M2 · Core in workers** | 4 | 8 | v3.6 | `core/` package without DOM, XML tokenizer, columnar SheetStore, core worker owns the document and the workbook | identical behaviour; no main-thread task > 50 ms |
| **M3 · Display list and native export** | 6 | 12 | v3.7 | DL + SVG/canvas/PDF backends, HarfBuzz fonts, Excel and Glass to DL, export workers; old engine kept one release | 🚦 G1 visual sign-off; pilot export for 2 weeks |
| **M4 · Screen from the display list** | 4 | 8 | v3.8 | React SVG stage, overlays, rAF drags, bitmap thumbnails, measurement from font files; delete the HTML renderer and the Chrome engine | screen = PDF; accepted layout differences signed |
| **M5 · Storage v4 and cut-over** | 5 | 10 | **v4.0** | journals, fold, migration/freeze/rollback, load tests, pilot on a copy, cut-over | 🚦 G2 pilot, 🚦 G3 cut-over date |
| **M6 · Hardening** | 3 | 5 | v4.1 | `.xlsb` native, optional parsed-sheet cache, optional change-notification hint, v4 docs, remove the v3 start file | – |
| **Total** | **28** | **54** | | | |

**Contingency:** +20 % (about 6 weeks), concentrated in M3 and M4, where the Glass visual parity (R2, R3)
is decided.

## 3. What is reused, adapted, rewritten, deleted

| Area | v3 code | Size (KB) | v4 fate |
|---|---|---|---|
| Number formats, colours, A1 utilities | `xlsx/numfmt.ts`, `color.ts`, `util.ts` | 21 | **moved unchanged** |
| Layout of tables, regions, CF | `xlsx/layout.ts` | 15 | **moved unchanged** (runs on the Sheet facade) |
| Drawings | `xlsx/drawing.ts` | 13 | moved; `analyzeImages` uses OffscreenCanvas in the worker |
| Sheet parser | `xlsx/workbook.ts` | 22 | **rewritten**: byte scanner → columnar SheetStore; shared/styles/theme parsing kept (DOMParser is not available in workers → a small XML tokenizer, about 150 lines) |
| Model: types, ops, preset, style, comment, fonts | `model/*` | 69 | **moved unchanged**; `ops.ts` becomes the only implementation |
| Effective items, scales, context, text, cover, page numbers, comment glue | `render/edits.ts`, `scales.ts`, `context.ts`, `text.ts`, `cover.ts`, `pagenumbers.ts`, `comment.ts` | 35 | moved; their HTML output parts become DL builders |
| Slide composition | `render/slide.ts` | 27 | `computeLayout`, sizing, notes **unchanged**; `buildSlide`/`applyLayout`/`fitNotes` rewritten for DL |
| Liquid Glass | `render/glass.ts` | 40 | `buildScene`, `inferRoles`, material decisions **unchanged** (≈ 65 %); HTML emission → DL recipes (03 §4.3) |
| Excel renderer | `render/excel.ts` | 7 | rewritten as `excelToDisplayList` |
| Wallpaper | `render/wallpaper.ts` | 4 | moved to the worker (OffscreenCanvas); output = 2 images |
| PDF CSS work-arounds | `render/printcss.ts`, slide rules in `styles/slide.css` | 23 | **deleted** |
| UI: chrome, dialogs, wizard | `ui/*`, `wizard/*` | 170 | **ported to React 19** (M1, mechanical: same JSX and hooks, `className`, style objects); global `S`/`emit` replaced by a Zustand store with selectors; calls re-pointed to core messages |
| Editor | `editor/*` | 95 | `edit.ts`, `textfmt.ts`, `painter.ts`, `tables.ts`, `keys.ts`, `issues.ts` moved; `stage.ts` (36 KB of imperative DOM) **rewritten as React components** (Stage, SlideSvg, TableLayer, Overlays, editors; hit-testing logic kept); `export.ts` rewritten (workers) |
| Sync | `sync/docsync.ts`, `api.ts` | 17 | adapted: journal append and tail, Lamport, fold |
| Helper: server, util, locks, fsclock, paths, workbooks, fonts, convert, migrate | `backend/slidebuilder/*` | 100 | **kept**; server routes changed; `fonts.py` + system-font capture; `convert.py` Excel path unchanged |
| Helper: store (workbook part), ops, presence | | 26 | **replaced** by `decks.py` (journals, snapshot, presence v2); config/prefs part of `store.py` kept |
| Helper: engines, cdp, pdf, installer (engine), exports (engine part) | | 75 | **deleted**; `save_export` kept |
| Tools | `tools/update.py`, `loadtest.py` | 40 | `update.py` rewritten (releases); `loadtest4.py` from the spike |

In total about **70 % of v3's TypeScript by size moves unchanged or nearly so.** The rewrite is
concentrated where the problems are: parser, renderer output, export, storage.

## 4. Risk register

| # | Risk | Likelihood | Impact | Mitigation | When it is retired |
|---|---|---|---|---|---|
| R1 | The bank's share behaves differently from the simulation: append visibility, oplocks, antivirus delaying new files, DFS | M | H | `tools/sharetest.py` on the real share from several PCs in **M0**, before any storage code. The design keeps v3's lock protocol for everything except the edit path. **Fallback (`STORAGE=lean-lock`):** every writer appends to **one** shared journal under the deck lock (lock → append → flush → unlock, about 4 round trips). The helper still only moves bytes and the core still folds (ADR-002). It uses the same HTTP contract and the same fold, at lower scale | M0 |
| R2 | Users do not accept the Glass look when drawn from the DL (stepped shadows, rim) | M | H | GP heat-map reports; pilot sign-off per design; option B3 (true blur on screen only); the Chrome engine stays one release (M3) | M3–M4 |
| R3 | Text wraps/fits differently from v3 because measurement changed (B7) | H | M | GG lists every changed box; accepted per case; deck owners re-check the weekly deck in the pilot; HarfBuzz uses the same features as Chrome, so changes are expected only where v3's heuristics were wrong | M4 |
| R4 | HarfBuzz WASM issues (memory growth, a bug in a version) | L | M | version pinned; fallback G3 (own `cmap`/`hmtx`, proven in the spike) for measurement; my own TrueType subsetter for TrueType fonts | M3 |
| R5 | Edge policy blocks `--app`, Blob workers or WASM in the page | L | H | W-matrix in M0; degraded mode: core on the main thread with time slicing (v3's behaviour), wasm-free G3 measurement | M0 |
| R6 | Migration bug loses or corrupts a deck | L | **Critical** | byte backups before every write; pilot on a copy (04 §4.5); v3 freeze tested against the **real v3 helper**; rollback rehearsed; `--migrate-all` skips locked decks; journals give a full edit history | M5 |
| R7 | Licence owner objects to copying Windows fonts to the share | M | M | ask in M0. Fallback: don't copy; each PC uses its own file. The deck stores a metrics fingerprint of the font; a mismatch shows a side-panel warning and the PDF uses the exporting PC's fonts, as v3 does | M0 |
| R8 | PowerShell CLM blocks `.xls` conversion | H (where CLM is on) | L | `.xlsb` native (M6); `.xls` documented as "save as .xlsx"; v3 has the same limit | M6 |
| R9 | Acrobat renders soft-mask gradients or the blurred-image clip differently from PDFium | L | M | M/W14 with the spike PDFs in M0; fallback recipe: flatten alpha gradients to two solid bands, keeping vector | M0 |
| R10 | SVG stage too slow with 9k+ nodes on old PCs | L | M | measure in M4 on the slowest corporate PC; fallback: canvas tiles for big tables (the thumbnail path) | M4 |
| R11 | GitHub Releases blocked by the proxy (api.github.com, objects.githubusercontent.com) | M | M | W7 in M0; `--zip` manual path (exists today); an internal mirror on the share | M0 |
| R12 | Compaction or rotation bug grows journals or skips records | L | H | invariants 04 §2.3, each tested (05 §3.6); a "deck health" line in the side panel (journal size, records past snapshot); compaction is never needed for correctness | M5 |
| R13 | Long period with v3 and v4 code paths in parallel | M | M | milestones ship on v3 storage, so only one code path exists for each concern at any time; v3 code is deleted as each milestone lands | each milestone |
| R14 | The team is new to PDF internals and HarfBuzz | M | M | small, test-driven writer (spike = 400 lines); `qpdf --check` in CI; PDF knowledge captured in `core/pdf/README.md` | M3 |
| R15 | Effort overrun | M | M | 20 % contingency; each phase independently valuable; M6 items are optional | – |

## 5. Explicit non-goals

* **No central server, database server or cloud service.** The share stays the only channel. If IT ever
  offers a server, the helper API (journal append and tail) maps directly onto a server process. That
  would be a later project.
* **No new UI design.** The toolbar, wizard and dialogs stay; only behaviour changes B1–B12 reach users.
* **No character-level real-time co-editing** of the same cell or text box. The merge stays field-level,
  last writer wins.
* **No charts, formula recalculation, Excel data bars or icon sets** (as v3, README §15).
* **No change to address-keyed cell edits** (README §15, REVIEW F1).
* **No PowerPoint export, no macOS/Linux user support.** Developers can still run everything on Linux.
* **No native binaries of our own,** and no admin-installed components.
* **No change to the saved document's meaning.** Optional fields only (04 §3).

## 6. Benchmarks: baseline measured and v4 targets

The baseline was measured in this environment (01 §3; 4 vCPU Linux, Chromium, local disk and simulated
SMB). Targets apply on a typical corporate PC (4 cores) and must be re-measured on one in M0
(`spikes/baseline/measure.mjs` runs unchanged on Windows with `CHROME=` pointing at Edge).

| # | Benchmark | v3 baseline (measured) | v4 target | Evidence for feasibility |
|---|---|---|---|---|
| B-1 | Open 20-slide deck → first slide | 316 + 268 ms | < 400 ms | parse in worker; same algorithms |
| B-2 | Read one 130k-row sheet (75.7 MB XML) | 6 093 ms, UI frozen 561 ms max, 336 MB heap | < 1 s, no task > 50 ms, < 150 MB | spike: 357 ms inflate + 303 ms parse, 26.5 MB |
| B-3 | Same sheet from the shared cache (M6, optional) | – | < 300 ms | spike: 205 ms load, 3.1 MB on the share |
| B-4 | Keypress → pixels (cell edit) | 100–300 ms (LOADTEST §3) | < 50 ms p95 | one table DL re-built. In the spike, the DLs of all 40 tables plus the whole PDF take 37–139 ms, i.e. < 3.5 ms per table including PDF writing; the real builders add the v3 layout work (already cached per table today) |
| B-5 | Edit → durable on the share (p95), 20 users, 40 ms | 9 128 ms | < 150 ms | sim: 96 ms |
| B-6 | Others see an edit (p50/p95), 20 users, 40 ms | 12.0 / 27.9 s | < 2 / < 4 s | sim: 1.8 / 3.1 s |
| B-7 | Others see an edit, 10 users, 15 ms | 1.4 / 2.8 s | < 1.5 / < 2.5 s | sim: 1.1 / 1.9 s |
| B-8 | Export 20 slides, Liquid Glass: time / size | 10.1 s / 24.7 MB | < 2 s / < 2 MB | spike: 0.1 s / 0.6 MB |
| B-9 | Export 20 slides, Excel: time / size | 2.3 s / 2.7 MB | < 1 s / < 0.8 MB | spike: 0.05 s / 0.14 MB |
| B-10 | PDF per slide: Excel / Glass | 134 KB / 1 204 KB | < 40 KB / < 80 KB (+ 190 KB once) | 6.9 / 29.2 KB |
| B-11 | Viewer render per Glass page (PDFium) | 766 ms | < 150 ms | 108 ms |
| B-12 | "PDF as pictures", 20 Glass slides | 90 s / 125 MB | < 6 s / < 20 MB | 2× PNG pages (estimate) |
| B-13 | Type 3 fonts / variable fonts in PDFs | 1 / possible | 0 / 0 | spike: 0; hb-subset instancing |
| B-14 | Helper start → page ready | ≈ 1 s + engine warm-up | < 1 s | no engine |
| B-15 | Files installed on a PC | Python (+ optional Playwright and ≈ 150 MB Chrome for Testing) | Python only | – |
