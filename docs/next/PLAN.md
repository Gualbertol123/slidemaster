# PLAN · Building Slide Builder 4, step by step

This is the **executable plan**. An engineer or a coding agent works through it from top to bottom, one step
at a time. Each step has the same parts:
* the files to read first;
* the work;
* the checks that prove it is done;
* what ships.

The *why* behind each step lives in `00`–`06` and `adr/`; this file is the *what* and the *in which order*.
It turns every finding of `01-current-system.md` into a concrete task.

**To run it with coding agents, use [`PROMPTS.md`](PROMPTS.md):** ten self-contained prompts, one per milestone
(plus a final audit), sent in order and resumable after human gates, each with built-in double checking.

**Objective, in the user's words: keep and keep developing every current feature, make sure everything
makes logical sense, and make it all smooth and fast.** Every step below serves one of those three. If a
step would break a feature listed in `05-test-and-parity.md` §4, it is wrong.

---

## Part A · How to work through this plan (rules for the agent)

1. **One prompt (milestone) = one branch = one pull request; one commit per step.**
   * Branch `v4/M<n>-<name>`, e.g. `v4/M2-core-workers`, matching the prompts in `PROMPTS.md`.
   * Commits are titled "S2.3 · <title>".
   * Do not start a step until every step it depends on is ticked (the graph is in Part D).
   * Every step passes the **double-check protocol** of `PROMPTS.md` before it is ticked: tests, the same
     tests from a clean clone, an independent review against the checklist, numbers measured twice.
2. **Keep `PROGRESS.md` at the repository root.**
   * Step S0.1 creates it with one checkbox line per step.
   * Tick the line in the same PR. Add the PR link and a one-line note of anything surprising.
   * Measured numbers go into the step's line, never only into the PR.
3. **Definition of done for every step:**
   * `npm run check` is green (typecheck, lint, unit tests, ops vectors; created in S0.1);
   * `python -m unittest discover -s helper/tests` (or `backend/tests` before M5) is green;
   * `npm run test:e2e` is green;
   * `npm run parity` (from S0.5) has no unexplained difference;
   * the step's own **Done when** checks pass.
4. **Never, in any step:**
   * edit files in `golden/` or `backend/tests/fixtures/saved/` (add new ones; old ones are evidence);
   * write to a real user's share;
   * add a runtime dependency to the helper (Python stdlib only), or ship a native executable (ADR-001);
   * remove an element `id` or `data-*` attribute that `e2e/app.spec.ts` uses, unless the same PR updates
     the test;
   * mark a test `skip` to get green;
   * implement operation semantics anywhere but `core/model/ops.ts` (ADR-002).
5. **Stop and ask a human** at the gates marked 🚦:
   * G0: real share, PCs, Acrobat;
   * G1: visual sign-off of the designs;
   * G2: pilot;
   * G3: cut-over date.

   Also stop whenever a step needs real decks, credentials or a decision between two user-visible
   behaviours. Write the question in `PROGRESS.md` under "Waiting for".
6. **Every user-visible change must be in the list B1–B14** (Part B §8). If you find you need one that is
   not there, stop and ask.
7. **Performance is a test, not a wish.**
   * Steps marked ⏱ add an automated benchmark to `npm run bench` with a threshold.
   * CI fails if the threshold is exceeded by more than 10 %.

---

## Part B · What it will look like

### 1. The app window (what users see)

The layout users know stays. What changes is underneath, plus the few marked items.

```
┌─ Slide Builder — IBD weekly.xlsx · 20 slides ───────────────────────────────── (Edge app window, no tabs/URL) ─┐
│ [Open ▾][↻] [✦ Wizard]  Version [Full deck ▾]   (AN)(BO) bob is also here                                       │
│                         [ Liquid Glass | Excel | Excel Refined ] [Design… ■] Glass ▮▮▯ Colour ▮▮▮▯ [⚙] [Export PDF ▾]│ ← no "Export: Chrome" pill (B1)
├────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ↶ ↷ │ Cell C7 │ Font from Excel ▾  A− [11] A+  B  I  A▾ │ ⯇ ⯀ ⯈ Auto │ ≡ 1.15 ▾ ¶ ▾ │ ⤒ ⬍ ⤓ │ Clear │ 🖌 │ Text styles…│ ribbon 1: one text toolbar
│ W[ 64 ] H[ 21 ] Excel size │ Cell colour ▾ Highlight ▾ Role ▾ Merge │ ⇔ Same size  Position ▾  Gridlines ▾       │ ribbon 2: cells, tables,
│ Colour scale ▾  Reset layout │ ↑ ↓ ← →  ◯  ✎ Comment…  ⤺  🗑 │ ✎ Notes │ Logo │ Subtitles                        │   text boxes, slide
│ [SLIDE_1!C7   ] fx [ Totale                                                    ] ↺ Excel value                   │ formula bar
├──────────────┬─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ SLIDES 20    │   ┌───────────────────────────── slide (SVG, 1600 × 900, crisp at any zoom) ──────────────────┐  │
│ ┌──────────┐ │   │  Total Banks Loans & Deposits                                                            │  │
│ │ 1  cover │ │   │  (mln Euro at last fixed exchange rate)                                                 │  │
│ ├──────────┤ │   │  ╭──────────────── glass card ────────────────╮   ╭── comment (auto) ───────────╮        │  │
│ │ 2  index │ │   │  │ ▒▒ Week37 Week38 … Δ vs Budget Abs. %  ▒▒ │   │ A good week: +476 mln, led  │        │  │
│ ├──────────┤ │   │  │ TOTAL BANKS LOANS   76.777 … (+192)(+2,5%) │   │ by VUB and PBZ…             │        │  │
│ │ 3 ▸ ◀────┼─┼── │  │ VUB  2.007 2.025 …   (−69)(−3,3%)          │   ╰─────────────────────────────╯        │  │
│ ├──────────┤ │   │  ╰────────────────────────────────────────────╯                                           │  │
│ │ 4        │ │   │  Source: ECB (notes section)                                              ( 3 )  [logo]   │  │
│ └──────────┘ │   └─────────────────────────────────────────────────────────────────────────────────────────┘  │
│ (virtualised │      selection box, handles, + buttons, inline editors = React overlays above the SVG          │
│  thumbnails) │                                                                         [ − ] 100 % [ + ] [Fit] │
│ ISSUES       │                                                                                                 │
│ • 2 hidden   │                                                                                                 │
│   rows       │                                                                                                 │
├──────────────┴─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Cell C7 · Arrows move · Shift extends · F2 edits · Ctrl+B/I · Ctrl+Z/Y      Updated by bob just now   ✓ Saved  │ ← "✓ Saved" when flushed (B6)
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
   dialogs unchanged: ✦ Wizard (4 steps) · Design… (Colours / Text styles / Fonts) · Comment… · Sizes… · Options
```

### 2. Processes, and who owns what

```
                    ┌───────────────────────────── Edge app window (one per user) ───────────────────────────┐
                    │                                                                                         │
   keyboard/mouse ─►│  UI THREAD — React 19 app                                                               │
                    │  ┌───────────────────────────────┐   ┌────────────────────────────────────────────┐    │
                    │  │ components (chrome, dialogs,  │◄──┤ UI store (Zustand): selection, current      │    │
                    │  │ wizard, stage, overlays)      │   │ slide, zoom, dialogs, toasts, prefs, busy,  │    │
                    │  └───────────────┬───────────────┘   │ + read-only mirror of the document view     │    │
                    │                  │ ops, requests       └──────────────────▲─────────────────────────┘    │
                    │                  ▼                                        │ view snapshots, DL patches  │
                    │  ┌──────────── CORE WORKER (owns the document and the workbook) ──────────────────┐     │
                    │  │ DocSync v4: snapshot + journals + pending ops → view · undo/redo (inverse ops) │     │
                    │  │ SheetStore (columnar) · presets → TableLayout → items → Scene → DisplayList     │     │
                    │  │ HarfBuzz text shaping · layout (computeLayout) · automated comments            │     │
                    │  └─────────────┬────────────────────────────────────────────┬──────────────────────┘     │
                    │                │ DLs                                         │ fetch (token)              │
                    │  ┌─────────────▼──────────── EXPORT WORKERS (on demand, ×1–3) ┐                          │
                    │  │ DisplayList → PDF writer (hb-subset fonts) · → PNG (OffscreenCanvas)                  │
                    │  └─────────────┬───────────────────────────────────────────┘                          │
                    └────────────────┼─────────────────────────────────────────────┼─────────────────────────┘
                                     │ PDF/PNG bytes                                 │ HTTP 127.0.0.1 + token
                    ┌────────────────▼───────────────────────────────────────────────▼─────────────────────────┐
                    │ HELPER — python helper\slide_builder.py (stdlib only): static page · decks (append, tail, │
                    │ snapshot CAS, compact, presence) · workbook bytes · fonts (+ system capture) · export save │
                    │ · Excel COM / GDI+ conversion · update / self-test                                        │
                    └────────────────┬───────────────────────────────────────────────────────────────────────────┘
                                     │ SMB — the only channel between PCs
                    ┌────────────────▼───────────────────────────────────────────────────────────────────────────┐
                    │ T:\Slide Builder\  workbooks · export\ · app\<ver>\ · app\current.json · backend\data\ (v3 + v4) │
                    └────────────────────────────────────────────────────────────────────────────────────────────┘
```

**One owner per kind of state.** This is the rule that makes the system "make logical sense". v3 broke it:
the global `S` held everything and was mutated from everywhere (`state/store.ts:15`).

| State | Owner | Everyone else gets | Changes only through |
|---|---|---|---|
| Deck document (server, pending, view), undo/redo stack | **core worker** (`DocSync`) | the UI gets a read-only `view` snapshot after each change | `ops` messages (`core/model/ops.ts`) |
| Workbook cells, styles, drawings | **core worker** (`SheetStore`) | windows of cells on request (wizard grid, formula bar) | re-open / reload |
| Display lists | **core worker** | DL patches `{slideId, tableId, dl}`; the UI caches them by id | being recomputed from document + workbook |
| Selection, current slide, zoom, open dialogs, toasts, busy, painter | **UI store** | components via selectors | store actions |
| Personal prefs | **UI store** | – | store action → `PUT /api/me` (debounced) |
| Files on the share | **helper** | bytes and records over HTTP | helper endpoints only |

### 3. One edit, end to end (Ctrl+B on a cell)

```
UI thread                         core worker                                helper                 share
───────────────────────────────── ────────────────────────────────────────── ───────────────────── ─────────
keydown Ctrl+B
 └ store: target = cells C7:C9
 └ worker.apply([cell.patch …]) ─►  inverse ops pushed on undo stack
                                    view = fold(snapshot, journals) + pending
                                    rebuild DL of ONE table (cached others)
   ◄──────────────── DL patch ───── post {table t1 → dl#4812, view summary}
 rAF: TableLayer(t1) swaps <g>
 ≈ 5–15 ms after the key ✔          (300 ms debounce)
                                    record {l,w,s,by,ops} ── POST append ──► open handle: write
                                                                             + FlushFileBuffers ─► j/anna….log
   ◄─────────── "flushed" ───────── ◄──────────── 200 {offset} ◄─────────── (≈ 30–90 ms)
 status bar "✓ Saved"
                                    every 1.5 s: GET tail ─────────────────► read new bytes of the
                                                                             others' journals ◄──── j/*.log
                                    fold in (lamport, writer, seq) order,
                                    rebase pending, rebuild touched tables
   ◄──── DL patches + "by bob" ─────
```

### 4. One export (Export ▾ › every version × all three designs)

```
UI: flush ─► core: DLs for (design × version), cached per table ─► 3 export workers in parallel
   each: DL → PDF (shared wallpaper images, shared gradients, subset fonts) ─► POST /api/export-file
   helper: temp file → lock export-<name> → rename (" (2)" if open in Acrobat) ─► export\
   toast "Saved 6 PDFs" with Open / Show folder      (≈ 1 s total for 2 versions × 3 designs × 20 slides)
```

### 5. The repository when finished

```
slidemaster/
├─ app/                          React 19 UI (TypeScript). Builds into ONE html file (workers + wasm inlined)
│  ├─ src/main.tsx  App.tsx
│  ├─ src/store/                 Zustand slices: selection, view, ui, prefs, sync-status (no global S)
│  ├─ src/rpc/                   typed worker client (core, export); one message schema in core/rpc/
│  ├─ src/stage/                 Stage, SlideSvg, TableLayer (memo by DL id), Overlays, hit testing, drags
│  ├─ src/chrome/                Topbar, Ribbon, TableTools, FormulaBar, StatusBar, Thumbnails, Issues
│  ├─ src/dialogs/               Wizard/, DesignDialog/, CommentDialog, TablesDialog, Options, Confirm
│  ├─ src/styles/                ui.css, app.css (chrome only: slides have no CSS any more)
│  └─ e2e/                       Playwright, two helpers (ported app.spec.ts + new scenarios)
├─ core/                         pure TypeScript, NO DOM (tsconfig lib: es2022 + webworker)
│  ├─ model/                     types, ops (the only implementation), fold, lamport, style, preset, comment, fonts
│  ├─ xlsx/                      zip (fflate), xml tokenizer, SheetStore (columnar) + Sheet facade, numfmt, layout, drawing, xlsb/
│  ├─ text/                      HarfBuzz wrapper, FontRegistry, line breaking, fitting
│  ├─ render/                    effItems, scales, scene (glass buildScene/inferRoles), excel.ts, glass.ts → DisplayList, slide/layout, cover, pagenumbers, wallpaper
│  ├─ dl/                        DisplayList types, validators, svg.ts, canvas.ts
│  ├─ pdf/                       writer, fonts (hb-subset), images, README.md (PDF notes)
│  ├─ sync/                      DocSync v4 (journals), helper API client
│  ├─ rpc/                       message types shared with app/
│  └─ workers/                   core.worker.ts, export.worker.ts
├─ helper/                       Python ≥ 3.8 stdlib (was backend/slidebuilder)
│  ├─ slide_builder.py  slidebuilder/{server,decks,locks,fsclock,paths,util,workbooks,fonts,convert,exports,migrate_v3,update_support}.py
│  └─ tests/                     unittest (+ fixtures/saved/ incl. snapshot.v4.json, journal.v4.log)
├─ shared/ops-vectors.json       op semantics regression cases (TS only now)
├─ tests/corpus/                 workbooks + saved documents (anonymised)        golden/  v3 captures (never edited)
├─ tools/                        update.py, capture-v3.mjs, parity.mjs, pdfcheck.py, sharetest.py, loadtest4.py, anonymise.py, bench.mjs
├─ spikes/                       (kept for reference)
├─ docs/                         README (v4), ARCHITECTURE (v4 contract), next/ (this design)
├─ .github/workflows/            ci.yml, release.yml
└─ Install / Start / Update Slide Builder.bat
```

### 6. The share when finished

```
T:\Slide Builder\
├─ Start Slide Builder.bat   Update Slide Builder.bat   Install Slide Builder.bat
├─ *.xlsx                                           (never written)
├─ export\                                          PDFs / PNGs
├─ app\current.json   app\4.0.3\   app\4.0.2\        program versions side by side (last 3)
└─ backend\data\
   ├─ config.json  users\  fonts\ (+ fonts\system\)  assets\        shared with v3, unchanged formats
   ├─ workbooks\*.json                                v3 docs (frozen with schema 4 once migrated)
   ├─ backups\                                        v3 backups + backups\v4\<key>\<gen>.json
   └─ v4\decks\<key>\{snapshot.json, j\*.log, presence\, lock}     v4\cache\ (optional, M6)
```

### 7. React: yes, as a proper React app (ADR-012)

**I considered it, and the answer is yes:** a React 19 single-page app, built the boring way. The current UI is
already JSX with hooks on Preact. The problem is not the library; it is the **architecture around it**:
* `state/store.ts` keeps one global mutable object `S`;
* `emit()` re-renders **every** component that called `useApp()`, which is 15 components, on every change:
  a keystroke, a poll, a toast (`App.tsx`, `store.ts:52-56`);
* the stage is a separate imperative world (`editor/stage.ts`, 36 KB) that the components poke through
  `STAGE`/`THUMBS` hooks.

That is why "smooth" is hard today.

What the React app changes, and why each part makes it faster or clearer:

| Change | Effect |
|---|---|
| React 19 + react-dom 19 (MIT) instead of Preact | the mainstream ecosystem: React DevTools Profiler, `@testing-library/react`, `useTransition`/`useDeferredValue` for heavy updates, the React Compiler for automatic memoisation. **≈ +45 KB gzipped**, irrelevant on localhost |
| **Zustand 5** (MIT, ≈ 1 KB) store split into slices, with selectors | a selection change re-renders the ribbon and status bar only, not the dialogs, thumbnails and top bar. Measured by a render-count test (S1.3) |
| The document lives in the core worker; the UI holds a read-only mirror | one owner, no accidental mutation, no UI-thread work for parsing, layout or text |
| The stage becomes React components: `SlideSvg` → `TableLayer` per table, memoised by DL id; overlays (selection, handles, + buttons, guides, inline editors) are components | an edit swaps one `<g>`; React never diffs 9 000 SVG nodes, because a `TableLayer` writes its pre-serialised SVG through a ref. Overlays get normal React state instead of hand-written DOM patching |
| Drags (column borders, table resize/move, text-box snapping) compute previews on the UI thread with the same pure `computeLayout` from `core/render/layout.ts`, at `requestAnimationFrame` rate, and commit one op on pointer-up | 60 fps drags without a worker round trip per mouse move. Same result as the committed layout, because it is the same function |
| Thumbnails become worker-rendered bitmaps (`OffscreenCanvas` → `ImageBitmap`) in a virtualised list | 20–100 slides scroll smoothly; no hidden DOM copies of slides |

**What a "whole React app" does *not* mean here.**
* **No Next.js or server rendering.** There is no server; REVIEW §6 still holds.
* **No component library or CSS framework.** The existing CSS and look stay.
* **No React for the slide pixels themselves.** The display list is the contract (ADR-004); React places it.

**The migration is mechanical and safe** (M1):
1. Write all components against the React API, while Vite aliases `react` → `preact/compat`. Behaviour is
   unchanged and every e2e test stays green.
2. Replace `S`/`emit` with the store.
3. Remove the alias.

Element ids and `data-*` attributes are kept, so the 15 e2e scenarios guard every step.

### 8. Every behaviour users will notice (nothing else may change)

| # | Change | Step |
|---|---|---|
| B1 | No export engine: the "Export: …" pill, Install engine dialog and in-window fallback are gone; exports also work offline (`file://`, as downloads) | S3.7, S4.5 |
| B2 | Liquid Glass text uses static Segoe UI on screen, as the PDF already does | S4.4 |
| B3 | Soft shadows drawn as 6 sharp layers on screen too, as in today's PDFs (setting: true blur on screen only) | S4.1 |
| B4 | Simultaneous edits of the **same field** ordered by Lamport clock, not save arrival (still last-writer-wins, still converges) | S5.2 |
| B5 | Others' edits appear within ≈ 1–2 s (was 1.5–3 s; up to 28 s on slow shares) | S5.2 |
| B6 | "✓ Saved" as soon as the edit is on the share (was up to one 3 s tick late) | S0.4 |
| B7 | Wrapping, overflow and fitting measured from font files: a few cells may wrap or shrink differently from v3 (each listed and accepted) | S4.4 |
| B8 | Opening large workbooks never freezes the window | S2.6 |
| B9 | "PDF as pictures" at 2× (was 4×): 125 MB → about 15 MB | S3.7 |
| B10 | `.xlsb` read natively, so it works under PowerShell Constrained Language Mode (`.xls` and protected files still need Excel) | S6.1 |
| B11 | Version export names are `<workbook> - <version> - <design>.pdf`, as documented | S3.7 |
| B12 | Starts in an Edge app window (falls back to a browser tab) | S0.3 |
| B13 | The Open menu reads the list when opened, not every 6 s | S0.4 |
| B14 | Thumbnails are pictures of the slide (sharper, same content); big tables no longer show "shapes only" in thumbnails | S4.3 |

---

## Part C · The steps

Legend: **⏱** adds a benchmark gate · **🚦** human gate · **⇢** ships to users.

### M0 · Foundations on v3 (ships v3.4) — 3 weeks

**S0.1 · CI, `PROGRESS.md`, one check command**
* **Read:** README §11, `frontend/package.json`, `frontend/playwright.config.ts`.
* **Do:**
  * Add `.github/workflows/ci.yml`. On Ubuntu with Python 3.8 and 3.12, Node 22 and Playwright's Chromium,
    it runs:
    * `npm ci && npm run check`;
    * `python -m unittest discover -s backend/tests`;
    * `npm run test:e2e`.
  * Add `npm run check` = `tsc --noEmit && vitest run`.
  * Create `PROGRESS.md` with every step id of this plan as a checkbox.
* **Done when:** CI is green on a PR; `PROGRESS.md` exists.

**S0.2 · Release pipeline**
* **Read:** `tools/update.py:286-340` (ZIP mode), ADR-009.
* **Do:** `.github/workflows/release.yml` on tag `v*`:
  1. build;
  2. run all tests;
  3. assemble `slidebuilder-<ver>.zip` (`page/slide_builder.html`, `helper/**` (= `backend/` until M5),
     `tools/update.py`, `*.bat`, `MANIFEST.json` with SHA-256 per file);
  4. publish a GitHub Release.

  `tools/make_release.py` does steps 2–3 locally too.
* **Done when:** a test tag produces a release whose manifest verifies with `python tools/make_release.py
  --verify <zip>`.

**S0.3 · Side-by-side installs, `current.json`, Edge app window** ⇢
* **Read:** `tools/update.py` (whole file), `Start Slide Builder.bat`, `backend/slidebuilder/main.py`,
  `backend/tests/test_update.py`.
* **Do:**
  * Extend `tools/update.py`:
    * `--release [latest|<ver>]` downloads the release ZIP with `urllib` and the default SSL context;
    * verifies it against the API's asset `digest` and `MANIFEST.json`;
    * extracts to `app\<ver>.part` → renames to `app\<ver>`;
    * runs `--selftest`;
    * writes `app\current.json` atomically;
    * `--use <ver>` flips the pointer;
    * `--zip <file>` stays.
  * Keep the git path working for shares not yet switched.
  * `Start Slide Builder.bat`: if `app\current.json` exists, start that version, else `backend\` as today.
  * `main.py`: open `msedge --app=<url>` when Edge is found (`webbrowser` otherwise), and add `--selftest`
    (read every deck read-only, check that the share accepts create, rename and delete).
* **Done when:**
  * new `test_update` cases pass: install, pointer flip, rollback, digest mismatch refused, interrupted
    install leaves no `app\<ver>`;
  * a rehearsal on a copy of a share folder works.

**S0.4 · v3 quick fixes found in the review** ⇢
* **Read:** `01-current-system.md` §5 (P5, P10), `frontend/src/sync/docsync.ts:32-40,82`,
  `frontend/src/state/app.ts:53-69`, `backend/slidebuilder/workbooks.py:21-45`,
  `backend/slidebuilder/presence.py`.
* **Do:**
  1. `DocSync.flush` notifies listeners when the save state changes, so "✓ Saved" shows at once (B6).
  2. `tick` stops calling `/api/files` every 6 s. A new `GET /api/files/<name>/stat` (one `stat`) drives
     the changed-on-disk banner, and the full list is fetched when the Open menu opens (B13).
  3. `presence.others` uses directory-listing mtimes and stops reading every heartbeat file.
* **Done when:**
  * a unit test asserts the listener fires on save;
  * `tools/loadtest.py` adds the Open-menu and changed-on-disk traffic, and the SMB ops per user per
    minute drop (number in `PROGRESS.md`);
  * e2e is green.

**S0.5 · Capture v3 as golden data**
* **Read:** `05-test-and-parity.md` §2, `spikes/baseline/measure.mjs`, `frontend/e2e/app.spec.ts`.
* **Do:**
  * Create `tests/corpus/` with:
    * the 4 fixtures;
    * `deck20` and `big30` (generator from `spikes/baseline/make_workbooks.py`);
    * edge-case workbooks (`tools/make_corpus.py`: formats, CF, merges, hidden rows/cols, pictures incl.
      cropped/rotated/SVG, shapes, text boxes, superscripts, locale tags);
    * one saved document per option combination of 05 §4.
  * `tools/capture-v3.mjs` stores goldens in `golden/<deck>/<design>/<version>/`:
    * stage geometry and texts per slide;
    * screenshots;
    * PDF text and positions;
    * comment texts;
    * the issues panel.
  * `tools/parity.mjs` compares any build with the goldens. In M0 it compares v3 against itself:
    0 differences.
  * `npm run parity`.
  * `tools/anonymise.py` scrambles numbers in real decks (for 🚦 below).
* **Done when:**
  * goldens are committed;
  * `npm run parity` on v3 reports 0 differences, twice in a row (determinism);
  * 🚦 the product owner provides 5 real decks, which are anonymised and added.

**S0.6 · Field tests on the real environment** 🚦 (G0)
* **Read:** `04-data-and-migration.md` §2, `spikes/storage/journal_sim.py`, `05-test-and-parity.md` §3.7.
* **Do:**
  * `tools/sharetest.py`: the journal protocol and the lean-lock protocol against a **temporary sub-folder
    of the real share**, run simultaneously from 3–5 PCs, including one over VPN. It also probes
    `ReadDirectoryChangesW` (does an append on PC A wake PC B?).
  * A checklist `docs/next/field-results.md` for rows W1–W14 of the policy matrix:
    * Edge `--app` mode;
    * Blob workers and WASM in the page;
    * the spike PDFs (`spikes/pdfwriter/out-native-*.pdf`) opened in Acrobat.
* **Done when:** a human has run them and the results are in `field-results.md`. **Decision G0:**
  * journals meet 05 §3.5 → continue as planned;
  * if not → set `STORAGE=lean-lock` in M5 (ADR-006 fallback);
  * if Acrobat shows soft-mask problems → use the flattened-gradient recipe in S3.5;
  * if Windows fonts may not be copied (R7) → use the per-PC fallback in S3.2.

**S0.7 · Ship v3.4** ⇢
* **Do:** tag, release, update the team's share with the new updater (`--release`). Note the date and
  version in `PROGRESS.md`.

### M1 · The React app (ships v3.5, behaviour identical) — 3 weeks

**S1.1 · React API on the Preact runtime**
* **Read:** `frontend/src/ui/*`, `wizard/*`, `main.tsx`, `vite.config.ts`, ADR-012.
* **Do:**
  * Replace `preact`/`preact/hooks` imports with `react`. Alias `react`/`react-dom` → `preact/compat` in
    Vite and Vitest.
  * Convert the React-incompatible idioms:
    * `class=` → `className=`;
    * string `style="…"` → objects;
    * `onInput` on text fields where React semantics differ;
    * `for=` → `htmlFor`.
  * Keep every `id` and `data-*`.
* **Done when:** parity GG/GP shows 0 differences; e2e is green; bundle size is in `PROGRESS.md`.

**S1.2 · Repository layout**
* **Do:**
  * Move `frontend/` → `app/`, keeping git history (`git mv`).
  * Create an empty `core/` package with its tsconfig (`lib: ["es2022","webworker"]`, no DOM types).
  * Use npm workspaces; update CI and `README.md` §11/§16.
* **Done when:** all checks are green with the new paths.

**S1.3 · Store with selectors replaces the global `S`** ⏱
* **Read:** `app/src/state/store.ts`, `state/app.ts`, every `useApp()` caller (15).
* **Do:**
  * Zustand 5 store slices: `doc` (sync state and view mirror for now), `deck` (slides, current, version),
    `selection` (cells, text box, slide text, painter), `ui` (dialogs, toast, busy, zoom, banners), `prefs`.
  * Each component reads only what it renders, through selectors (`useStore(s => s.selection.cells)`).
  * Actions from `state/app.ts` become store actions.
  * Delete `emit()` and `useApp()`.
* **Done when:**
  * a render-count test (Testing Library + React Profiler) shows that moving the selection re-renders
    only Ribbon, TableTools, FormulaBar, StatusBar and the stage overlay;
  * a poll with no change re-renders nothing;
  * e2e is green; parity shows 0 differences.

**S1.4 · Switch to real React 19** ⏱
* **Do:**
  * Remove the alias; add `react@19`, `react-dom@19`, `zustand@5` (pinned, MIT).
  * Make `ui/Field.tsx` controlled-input semantics match.
  * Enable the React Compiler (Babel plugin, dev dependency) if its checks pass; otherwise note it in
    `PROGRESS.md` and skip.
* **Done when:** e2e and parity are green; there is no React warning in the console during e2e
  (E15 "no page errors" extended to warnings).

**S1.5 · Ship v3.5** ⇢

### M2 · The core in workers (ships v3.6, behaviour identical) — 4 weeks

**S2.1 · Move pure code into `core/`**
* **Read:** `03-architecture.md` §2, `06-plan.md` §3 (reuse map).
* **Do:**
  * `git mv` `xlsx/`, `model/` and the pure parts of `render/` into `core/`.
  * Put every DOM use behind an interface:
    * `TextMeasurer` (today: canvas `measureText` at `workbook.ts:169-176`; DOM `fitNotes` at
      `slide.ts:311-332`);
    * `CanvasFactory` (wallpaper, `analyzeImages`);
    * `XmlParser` (DOMParser uses).

    The app supplies browser implementations, so nothing changes yet.
* **Done when:** `core/` type-checks without DOM types; parity shows 0 differences.

**S2.2 · XML tokenizer instead of DOMParser** (DOMParser does not exist in workers)
* **Do:** `core/xlsx/xml.ts`, a small pull tokenizer (elements, attributes, text, entities, namespaces).
  Port rels, workbook, styles, theme and drawing reading to it.
* **Done when:** for every corpus workbook, `JSON` of the parsed styles, theme, rels and drawings is
  identical to the DOMParser version (a test runs both in Vitest with jsdom); parity shows 0 differences.

**S2.3 · Columnar SheetStore and byte scanner** ⏱
* **Read:** `spikes/parser/parse_bench.mjs`, `xlsx/workbook.ts:248-323`, `xlsx/types.ts:15-63`.
* **Do:**
  * fflate replaces JSZip.
  * Write the byte scanner, covering **every** cell shape the regex parser handles: namespace prefixes,
    no `r`, inline strings with rich runs, `t=d|b|e|str|s`, `xml:space`, `_xHHHH_`.
  * Store typed-array columns behind a `Sheet` facade with the same methods (`cellAt`, `xfAt`, …).
* **Done when:**
  * for every cell of every corpus sheet, value, type, xf and runs are identical to v3's parser (test);
  * the bench gate: `big30` sheet parse is under 0.5 s and memory under 40 MB in Node.

**S2.4 · Core worker, typed RPC, the document moves into the worker**
* **Do:**
  * Message types in `core/rpc/messages.ts`.
  * A small promise-based client in `app/src/rpc/` (transferables for buffers).
  * `core/workers/core.worker.ts` owns the workbook, `DocSync` (still the v3 HTTP ops protocol), the undo
    stack and the renderers, and returns **HTML strings per table**, as today.
  * The UI store receives `view` snapshots and HTML patches.
  * Workers and WASM are inlined as Blob URLs in the single-file build, so the `file://` mode keeps working.
* **Done when:** e2e is green (including undo of own changes only, two users); parity shows 0
  differences; `file://` mode opens and edits a workbook (new e2e).

**S2.5 · Wizard and formula bar read cells through the worker**
* **Do:** add `getSheetWindow(sheet, r0, r1, c0, c1)` and `getCell(sheet, ref)` RPCs. The wizard grid
  (`wizard/Wizard.tsx`) and the formula bar use them.
* **Done when:** E5 and E14 (wizard picker, large sheet) pass.

**S2.6 · Smoothness gate for opening** ⏱
* **Do:** `tools/bench.mjs` (from `spikes/baseline/measure.mjs`) measures:
  * open deck20;
  * read one `big30` sheet;
  * long tasks.
* **Done when:** these benchmarks run in CI:
  * deck20 open in under 400 ms;
  * the sheet read in under 1 s;
  * **no long task over 50 ms** (B8).

**S2.7 · Ship v3.6** ⇢

### M3 · Display list and native export (ships v3.7) — 6 weeks

**S3.1 · Display list, PDF writer, test tools**
* **Read:** `03-architecture.md` §2.4, §4.3, §5; `spikes/pdfwriter/pdf.ts`, `ttf.ts`, `bench.ts`.
* **Do:**
  * `core/dl/types.ts`: the 8 node types, with validators.
  * `core/dl/svg.ts` (DL → SVG string) and `core/dl/canvas.ts` (DL → Canvas2D).
  * Port the spike writer into `core/pdf/`, with:
    * radial shadings;
    * paths;
    * dashed lines;
    * image alpha (SMask);
    * object streams off (simpler checking).
  * `tools/pdfcheck.py` (pypdf + PDFium + `qpdf --check` in CI).
* **Done when:** unit tests cover every node in all three backends; `qpdf --check` passes; a golden PDF
  per node type is rendered by PDFium and compared with the canvas render (SP).

**S3.2 · Fonts and text shaping**
* **Read:** `03-architecture.md` §2.5–2.6, `spikes/fonts/subset_check.mjs`, `app/src/state/fonts.ts`,
  `backend/slidebuilder/fonts.py`.
* **Do:**
  * Pin `harfbuzzjs@0.4.12` (MIT).
  * `core/text/`: `FontRegistry` (library and system fonts by content hash), `shape(text, font, size)` →
    glyph ids and advances, line breaking, fit-to-box.
  * Helper:
    * `GET /sysfonts/<name>` reads `C:\Windows\Fonts`;
    * `POST /api/fonts/capture` copies a system font into `fonts/system/` with an `fsType` check (or, under
      the R7 fallback, records a metrics fingerprint only).
  * Uploads of variable fonts are instanced per weight with `hb-subset`.
* **Done when:**
  * tests: shaping of a corpus string matches HarfBuzz reference widths;
  * a variable font upload produces static faces;
  * `fonts.json` stays readable by v3 (test with v3's `fonts.py`).

**S3.3 · Excel and Excel Refined → display list**
* **Do:**
  * `core/render/excel.ts` emits DL nodes instead of HTML:
    * fills;
    * border styles mapped to widths and dashes;
    * text with overflow clips;
    * rotation;
    * `<sup>`/`<sub>` runs;
    * pictures, shapes, text boxes.
  * Text **positions follow v3's rules** (use v3's canvas metrics through `TextMeasurer`) so that parity
    can be exact; HarfBuzz measurement comes in S4.4.
* **Done when:** GG and GP against the Excel and Excel Refined goldens are within tolerance, with 0
  unexplained differences.

**S3.4 · Liquid Glass → display list**
* **Read:** `app/src/render/glass.ts:376-515`, `styles/slide.css` (the `.gls`, `.cap`, `.hsep`, `.vsep`,
  `.rule`, `.icon`, `.gtb` rules), `render/wallpaper.ts`, `render/slide.ts:182-188` (`placeGlass`).
* **Do:**
  * Keep `buildScene`, `inferRoles` and the material decisions.
  * Implement each material as the recipe in `03-architecture.md` §4.3: clip + blurred wallpaper image,
    tint gradients, rim, 6-layer shadows, capsules, hairlines, accent rules, icons, keyed pictures, tinted
    blocks.
  * Generate the wallpaper in the worker (OffscreenCanvas): two JPEGs, shared.
* **Done when:** GG is within tolerance; the GP report is produced for every theme × glass level ×
  contrast in the corpus.

**S3.5 · Slide furniture → display list**
* **Do:**
  * title, subtitle, cover, contents (with page numbers), page numbers, footer (placeholders), logo
    (bubble);
  * text boxes (markup, bubble, line and paragraph spacing, vertical align);
  * the notes section;
  * automated comments.
* **Done when:** GG and GT pass for every corpus slide in every design.

**S3.6 · Pixel review** 🚦 (G1)
* **Do:** publish the GP reports (v3 vs DL) for the pilot users and the product owner.
* **Done when:** each design is signed off in `PROGRESS.md`, or the change requests are fixed and
  re-reviewed.

**S3.7 · Native export, in workers** ⇢
* **Read:** `app/src/editor/export.ts`, `backend/slidebuilder/exports.py:40-114`.
* **Do:**
  * `core/workers/export.worker.ts` handles: PDF vector; PDF as pictures (2× PNG pages, B9); PNG current
    and all; clipboard; every version × designs, with 3 workers in parallel and names per B11.
  * Helper `POST /api/export-file?name=` reuses `save_export`.
  * The Export menu gets "PDF · text & tables (old engine)" for one release; the default is native.
  * Export works in `file://` mode as downloads (B1).
* **Done when:**
  * GF budgets pass (Excel < 40 KB/slide, Glass < 80 KB/slide + 190 KB once, no Type 3, no variable
    fonts, text extract equal to v3);
  * ⏱ 20 Glass slides export in under 2 s and Excel in under 1 s, from click to file;
  * E3 and E13 pass, and the new e2e for PNG, clipboard and versions × 3 designs passes.

**S3.8 · Pilot of the export** 🚦
* **Do:** 2 weekly cycles in which pilot users export the real deck with both engines.
* **Done when:** no blocking difference is reported; Acrobat check W14 passes.

**S3.9 · Ship v3.7** ⇢

### M4 · The screen draws the display list (ships v3.8) — 4 weeks

**S4.1 · React stage on SVG** ⏱
* **Read:** `app/src/editor/stage.ts` (whole file), `editor/edit.ts`, `editor/tables.ts`.
* **Do:**
  * Components:
    * `Stage` (zoom, fit, scroll);
    * `SlideSvg`;
    * `TableLayer`, memoised by DL id, which writes the serialised SVG through a ref;
    * `Overlays`: selection box, active cell, handles, + buttons, snapping guides, column/row resize
      guide;
    * `InlineCellEditor`, `TextBoxEditor`, `SlideTextEditor`.
  * Hit testing uses DL `hit` nodes with v3's binary search over column/row edges (`cellFromPoint`).
  * The stage keeps v3's rule: never redraw under an open editor (E8).
  * Shadows use the 6-layer recipe, and the "true blur on screen" setting is in Options (B3).
* **Done when:** all e2e are green with no test changes except selectors documented in the PR; ⏱
  keypress → pixels p95 is under 50 ms (bench).

**S4.2 · Smooth drags**
* **Do:**
  * Column/row borders, table edge, corner, grip move and text-box move/stretch with snapping all compute
    previews on the UI thread with the shared pure `core/render/layout.ts` at `requestAnimationFrame` rate.
  * Commit one op on pointer-up (one undo step, as today).
* **Done when:** a Playwright trace of each drag shows no frame over 16 ms on the CI machine; E4, E7, E10
  and E11 pass.

**S4.3 · Thumbnails as bitmaps** (B14)
* **Do:** the worker renders DLs on `OffscreenCanvas` and returns `ImageBitmap`s. The thumbnail list is
  virtualised, keeps cover/index tags and badges, and redraws only changed slides.
* **Done when:** 100-slide synthetic deck scrolls at 60 fps (trace); SP-01 behaviours pass.

**S4.4 · Measurement from font files; screen = PDF** (B2, B7)
* **Do:**
  * Switch `TextMeasurer` to HarfBuzz for:
    * the Excel max digit width (from the workbook default font file);
    * Glass column widening (real widths instead of `glass.ts:44`'s estimate);
    * wrapping and `fitNotes`.
  * Screen text uses `textLength`-pinned runs, with the per-font outline fallback when the font check
    (05 §3.4) fails.
  * Liquid Glass uses static Segoe UI.
* **Done when:**
  * SP passes (screen vs PDF) on the corpus;
  * every GG difference against v3 is listed in `tests/parity/accepted.json` with the reason "measured",
    and 🚦 signed off;
  * W13 passes (two PCs with different fonts produce identical layouts).

**S4.5 · Delete the old renderer and the export engine** (B1)
* **Do:** delete:
  * HTML renderers;
  * slide rules in `slide.css`;
  * `printcss.ts`;
  * `placeGlass`;
  * `editor/export.ts` fallback;
  * `engines.py`, `cdp.py`, `pdf.py`;
  * the installer engine steps;
  * Playwright from `requirements.txt`;
  * the "old engine" menu item.

  Update `firstrun.py` (7 steps → 5: no pip, no Playwright, no engine) and its tests.
* **Done when:** the repository has no reference to `--headless`, `printToPDF`, `playwright` in product
  code; all tests are green; the helper is about 75 KB smaller.

**S4.6 · Ship v3.8** ⇢

### M5 · Storage v4 and cut-over (ships v4.0) — 5 weeks

**S5.1 · Helper: decks** (stdlib)
* **Read:** `04-data-and-migration.md` §2, `backend/slidebuilder/store.py`, `locks.py`, `fsclock.py`,
  `util.py`.
* **Do:**
  * Move `backend/` → `helper/` (`git mv`).
  * `helper/slidebuilder/decks.py` provides append (handle kept per writer session, `FlushFileBuffers` via
    `os.fsync`), tail (parallel reads, offsets), snapshot (read with retries), compact (CAS on `gen` under
    `Lock`), rotate and presence v2.
  * Endpoints per 04 §2.2.
* **Done when:** the storage tests 1–6 of `05-test-and-parity.md` §3.6 pass (multi-process, torn tails,
  duplicates, CRC corruption, compaction races, clock skew).

**S5.2 · Core: fold, Lamport, DocSync v4** (B4, B5)
* **Do:**
  * `core/model/fold.ts` folds snapshot plus records, sorted by `(l, w, s)` and de-duplicated by `(w, s)`.
  * `core/sync/docsync.ts` v4: append records, a 1.5 s tail, rebase pending ops, undo unchanged, a
    compaction policy (> 2 000 records, idle writers), rotation, and compaction on `pagehide` by the last
    one present.
  * Op vectors are extended with ordering cases.
* **Done when:** ops vectors pass; a property test (random op sequences from 2–5 writers, random delivery
  order) always converges to the same document; docsync tests are ported.

**S5.3 · Migration, freeze, rollback**
* **Do:**
  * `helper/slidebuilder/migrate_v3.py`: per-deck migration under `wb-<key>` with backup, snapshot and the
    schema-4 freeze; plus `--migrate-all`.
  * `tools/update.py --rollback`.
  * *Options › Administration › Prepare rollback* (compacts all decks).
  * v2 import kept (port `migrate.py`).
* **Done when:** tests 7–9 of 05 §3.6 pass. They include **the real v3 helper**, started from
  `git worktree add ../v3 v3.8` (or the last v3 tag), refusing a frozen deck and reading a rolled-back one.

**S5.4 · Load tests** ⏱
* **Do:** `tools/loadtest4.py` drives real v4 helpers (from `spikes/storage/journal_sim.py` and
  `tools/loadtest.py`).
* **Done when:** CI runs 20 users at 15 ms and 40 ms within the 05 §3.5 criteria; 🚦 a human runs
  `--real-folder` on the share and records the results.

**S5.5 · Delete the v3 storage path**
* **Do:** delete `ops.py`, the workbook part of `store.py`, v3 presence, and the `/api/workbooks/*/ops`
  route (v4 pages never call it). Keep config, prefs, fonts and locks as they are.
* **Done when:** grep shows no op semantics in Python; all tests are green.

**S5.6 · Pilot on a copy** 🚦 (G2)
* **Do:** `Start Slide Builder (v4 pilot).bat` with `SLIDEBUILDER_DATA=backend\data\v4-pilot` (a copy).
  Pilot users do 2 weekly cycles; rehearse a rollback on the copy.
* **Done when:** no blocking issue; the rollback rehearsal is recorded.

**S5.7 · Cut-over** 🚦 (G3) ⇢
* **Do:** on the agreed Monday, follow 04 §4.3. Release v4.0, keep `Start Slide Builder (v3).bat`, and
  monitor the deck-health line and the incident files for 4 weeks.
* **Done when:** 4 weekly cycles with no rollback; then S6.5.

### M6 · Hardening (ships v4.1) — 3 weeks

* **S6.1 · Native `.xlsb` reader** (BIFF12 records → SheetStore) (B10). **Done when:** corpus `.xlsb`
  files equal their `.xlsx` twins cell by cell; W6 passes.
* **S6.2 · Shared parsed-sheet cache**, only if S0.6 or S2.6 measurements show opening a large workbook on
  the real share over 3 s (ADR-008). **Done when:** the second opener's sheet read is under 300 ms.
* **S6.3 · `ReadDirectoryChangesW` wake-up hint**, only if S0.6 showed it works. **Done when:** the
  median visibility on the real share is under 0.5 s, and it auto-disables when no event arrives.
* **S6.4 · Documentation:** rewrite `README.md` for v4 and `docs/ARCHITECTURE.md` as the v4 contract
  (journal format, endpoints, DL, fonts); archive v3 docs under `docs/v3/`.
* **S6.5 · Remove the v3 start file** (D+28 after cut-over); `backend/` data stays.

---

## Part D · Order, dependencies and time

```
week   1   2   3 │ 4   5   6 │ 7   8   9  10 │11  12  13  14  15  16 │17  18  19  20 │21  22  23  24  25 │26  27  28
M0  ████████████ │           │               │                       │               │                   │
 S0.1─S0.2─S0.3─S0.7    S0.4 ║ S0.5 ║ S0.6🚦G0 (runs in parallel, results needed by M3/M5)
M1               │██████████ │               │                       │               │                   │
                   S1.1─S1.2─S1.3─S1.4─S1.5
M2                           │██████████████ │                       │               │                   │
                               S2.1─S2.2─S2.3─S2.4─S2.5─S2.6─S2.7
M3                                           │███████████████████████│               │                   │
                                               S3.1─S3.2─┬S3.3─┐
                                                         └S3.4─┴S3.5─S3.6🚦G1─S3.7─S3.8🚦─S3.9
M4                                                                   │███████████████│                   │
                                                                       S4.1─S4.2─S4.3─S4.4🚦─S4.5─S4.6
M5                                                                                   │███████████████████│
                                                                                       S5.1─┬S5.2─S5.3─S5.4🚦─S5.5─S5.6🚦G2─S5.7🚦G3
M6                                                                                                       │█████████
                                                                                                           S6.1 S6.2? S6.3? S6.4 S6.5
releases:      v3.4 (wk 3)   v3.5 (wk 6)   v3.6 (wk 10)            v3.7 (wk 16)    v3.8 (wk 20)        v4.0 (wk 25)   v4.1 (wk 28)
```

| Milestone | Weeks | Engineer-weeks | Ships | Biggest user-visible win |
|---|---|---|---|---|
| M0 Foundations | 3 | 6 | v3.4 | instant "✓ Saved", lighter polling, one-click side-by-side updates with rollback |
| M1 React app | 3 | 5 | v3.5 | (internal) smooth UI updates; no global re-render |
| M2 Core in workers | 4 | 8 | v3.6 | big workbooks never freeze the window |
| M3 Display list + export | 6 | 12 | v3.7 | exports 10 s → < 2 s, 25 MB → < 2 MB; no engine to install |
| M4 Screen from DL | 4 | 8 | v3.8 | screen = PDF; same layout on every PC; smooth drags |
| M5 Storage v4 | 5 | 10 | v4.0 | others' edits in 1–2 s even with 20 users on a slow share |
| M6 Hardening | 3 | 5 | v4.1 | `.xlsb` without Excel |
| **Total** | **28** | **54** (+20 % contingency) | | |

M2 and M3 have the most parallelism. Two engineers can split M3 after S3.2: one on S3.3 (Excel), one on S3.4
(Glass).

---

## Part E · Feature preservation map

Each feature area of `05-test-and-parity.md` §4 is touched by these steps and guarded by these checks.
**Nothing is "done" while a guard is red.**

| Feature area (05 §4) | Touched in | Guarded by |
|---|---|---|
| 4.1 Workbooks (formats, CF, pictures, markers, ranges, xlsb/xls) | S2.2, S2.3, S2.5, S6.1 | GT every cell, GG, E1/E5/E14, new open/drop/reload e2e |
| 4.2 Wizard (4 steps, versions) | S1.1, S1.3, S2.5 | E1, E5, E13, E14 + new wizard e2e (drag between slides, detected tables) |
| 4.3 Designs, looks, themes | S3.3, S3.4, S4.1, S4.4 | GG, GP (🚦 G1), SP, E7 |
| 4.4 Text toolbar, text styles, fonts | S1.3, S3.2, S4.1, S4.4 | E9, text unit tests, GF (fonts), W13 |
| 4.5 Cell editing, painter | S1.3, S4.1 | E2, E4, E6, E7, E8 + new shortcut table test |
| 4.6 Tables (sizes, same size, align, gridlines, scales, merges) | S3.3, S4.1, S4.2 | tables unit tests, GG, E4, E7 + new drag e2e |
| 4.7 Text boxes, notes section | S3.5, S4.1, S4.2, S4.4 | E10, E11, E12, GG |
| 4.8 Automated comments | S2.1 (moved unchanged), S3.5 | comment unit tests, **GT for every option**, E10 |
| 4.9 Versions, cover, contents, page numbers, footer, logo | S3.5 | GG, GT, E13 |
| 4.10 Export (all menu items) | S3.7, S4.5 | GF, SP, E3, E13 + new PNG/clipboard/versions × 3 e2e |
| 4.11 Collaboration, undo, keyboard, side panel, status | S0.4, S1.3, S2.4, S5.2 | docsync/ops tests, property test, E2, E8, loadtest4 |
| 4.12 Install, start, update, data | S0.3, S4.5, S5.3, S5.7 | test_update, test_firstrun, migration/rollback tests with the real v3 helper |

---

## Part F · Performance budget (enforced by `npm run bench` from the step that introduces it)

| Budget | From step | Limit |
|---|---|---|
| Open 20-slide deck → first slide | S2.6 | 400 ms |
| Read a 130k-row sheet | S2.3 / S2.6 | 1 s (Node: 0.5 s), memory < 150 MB in the page |
| Longest main-thread task while opening or editing | S2.6 | 50 ms |
| Keypress → pixels, cell edit | S4.1 | 50 ms p95 |
| Drag frame | S4.2 | 16 ms |
| Selection change re-renders | S1.3 | ≤ 5 components |
| Export 20 slides: Liquid Glass / Excel | S3.7 | 2 s / 1 s |
| PDF size per slide: Excel / Glass | S3.7 | 40 KB / 80 KB (+ 190 KB per document) |
| Save durable, p95, 20 users at 40 ms (sim) | S5.4 | 150 ms |
| Others see an edit, p50 / p95, 20 users at 40 ms (sim) | S5.4 | 2 s / 4 s |
| Helper start → page ready | S4.5 | 1 s |
