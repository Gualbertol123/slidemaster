# Slide Builder

Slide Builder turns tables in Excel workbooks into presentation slides (16:9, 1600 × 900 CSS px =
13.333 × 7.5 in) and exports them as PDF or PNG. It was built for a weekly banking report and runs on
locked-down corporate Windows PCs: no admin rights, nothing to install beyond Python, Edge DevTools
possibly disabled by policy, an SSL-inspecting proxy, and the app living in a **shared network folder**
that several people use **at the same time, on the same or on different workbooks**.

Two visual designs: **Excel** (a faithful copy of the workbook's formatting) and **Liquid Glass** (a
light, iOS-26-style design that keeps the workbook's meaning: headers, totals, green/red signals).

This README is the map. Deeper documents:

| Document | Read it for |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | **the contract**: data files, document shape, every operation, locking protocol, HTTP API, saved-format versions |
| [`docs/RENDERING.md`](docs/RENDERING.md) | how a workbook is read and turned into each design; every table/edit feature's implementation |
| [`docs/REVIEW.md`](docs/REVIEW.md) | the review of v2 that led to this rebuild (and why it is not a Next.js app) |
| [`docs/LOADTEST.md`](docs/LOADTEST.md) | 10 simulated users on a shared folder: what is slow and why, options |
| [`backend/README-backend.md`](backend/README-backend.md) | the helper's module map and command line |

**Contents** — [1 What it does](#1-what-it-does) · [2 Using it](#2-using-it) · [3 How it works](#3-how-it-works) ·
[4 Repository map](#4-repository-map) · [5 Saved data and format upgrades](#5-saved-data-and-format-upgrades) ·
[6 Concurrency](#6-concurrency-model) · [7 HTTP API](#7-http-api) · [8 Rendering](#8-rendering-pipeline) ·
[9 Development](#9-development) · [10 Where to change what](#10-where-to-change-what) ·
[11 Security](#11-security) · [12 Gotchas](#12-gotchas) · [13 Limitations](#13-known-limitations)

---

## 1. What it does

### Workbooks
* Opens `.xlsx/.xlsm` from the shared folder (or any file via *Browse*); `.xlsb/.xls` are converted to
  `.xlsx` with the installed Excel (Windows). Hidden sheets are skipped on purpose.
* Reads values, number formats (Italian separators by default, locale tags), fonts, fills, borders,
  merges, hidden rows/columns, conditional formatting (cell-value and simple expression rules),
  pictures, shapes and text boxes. Formulas are **not** recalculated (cached values are shown).
* Tables are found by **"x" markers** in the corners of a region, or picked as ranges in the wizard
  (with optional "grows" to follow new rows).

### Wizard (3 steps: sheets → tables → slides)
* Choose sheets; detect/pick tables (drag on a sheet preview, type a range, Shift+arrows, Enter adds);
  arrange slides; optional **cover** (title, subtitle, date, note) and **contents/index** slide (with or
  without subtitles); per-slide logo on/off. Cover and index are ordinary slides that can be moved.

### Text: one toolbar, one place for the whole deck
* The first toolbar row formats **whatever text is selected** – table cells, a text box, the title, the
  subtitle, the cover note or date (click to select, double-click to edit). It always has the same controls:
  font, size (pt), bold, italic, colour, alignment, vertical position (text boxes), clear format. The chip at
  its left names what it acts on. Cell-only tools (cell colour, format painter) are greyed out for other text.
* **Text styles…** sets every text of a kind at once for the deck: slide titles, subtitles, tables, text boxes,
  contents list, page numbers & footer (font, size, bold, italic, colour, alignment). Single-text formatting
  sits on top. *Use as default for new decks* includes them.
* **Fonts**: the fonts of every Windows PC, any **Google Font** (picked from the menu or typed by name) and
  your **own font files** (.ttf/.otf/.woff/.woff2, family/weight/style read from the file). Added fonts are
  saved in the shared folder (`backend/data/fonts`) for everybody and embedded in exports.
* The second row is layout only: cells (W/H, role, merge, colour scale), tables (same size, position,
  gridlines, sizes, reset), text boxes (add, bubble, delete), slide (logo, contents subtitles).

### Automated comments
* **✎ Comment…** (second toolbar row) writes an analyst-style commentary next to a table: a title, then one
  section per comparison found in the headers (“Δ vs. Budget” → *Budget Performance*, “Δ vs. Prev. Week” →
  *Weekly Momentum*, EoM/Q/BoY/YoY…). Each section has a headline for the total row (“… as of week 25/09/26 are
  above Budget by +476 (+3,5%)”), the main positive and negative contributors with their Abs./% values,
  concentration (“largely driven by VUB, ~86%”), breadth, and rows without data. Numbers are green/red.
* The table is read automatically: label column, total row (“TOTAL …”), rows, latest period (week + date),
  comparison groups with Abs. and % columns (merged headers understood).
* Options: sections, full/short, contributors per side, materiality threshold, rows to leave out, what rows
  are called (countries, banks…), placement (right/left/above/below, width), bubble. Live preview.
* **Also on N similar tables** puts the same kind of comment on every table of the deck with the same
  comparison headers – each with its own title and numbers.
* Comments are **live**: they are stored as settings and rewritten from the numbers whenever the workbook
  (or a cell on the slide) changes. Editing a comment's text by hand turns it into fixed text.
* Any text box understands the same markup: `# title`, `## heading`, `**bold**`, `[[+12,3]]` (coloured by sign).

### Editing on the slide (Excel-like)
* Click/drag/Shift+click/Shift+arrows to select; type or F2 to edit; Enter/Tab move; Del clears;
  Ctrl+B/I; Ctrl+Z/Y (undo **only your own** changes); PgUp/PgDn change slide; Ctrl+S saves now.
* Text size, bold, italic, text colour, alignment, role (header/total/body/note), **cell colour** (replaces
  the Excel colour; recolours the block in Liquid Glass), **highlight** (a capsule around the value),
  clear format, restore the Excel text. Titles/subtitles: double-click on the slide.
* **Merge / unmerge** cells (also cells merged in Excel – the workbook is never changed).
* **Format painter** (click = once, double-click = sticky, Esc stops): copies size, bold/italic, text
  colour, cell colour, highlight, alignment, role, **conditional formatting** (the source's rules applied
  to the target's own values, like Excel) and **colour scales**; a block is tiled as a pattern.

### Tables
* Column widths / row heights: drag a border (double-click = Excel size) or type W/H.
* Drag a **table border** to stretch columns (left/right) or rows (top/bottom); the corner handle
  scales proportionally; the grip moves a table next to/above/below another.
* **Same size** (on a slide, or across slides via *Sizes…*), copy sizes between tables, reset.
* Align the tables of a slide **left/centre/right and top/middle/bottom**.
* **Gridlines** per table: horizontal and vertical separately – as in Excel, all, or none.
* **Colour scales** ("variable conditional formatting"): deeper green/red with the size of the number,
  per row, per column or whole range, on the cell colour and/or the number colour.
* **Text boxes** above/below/left/right of a table, fitted to it; size, bold, italic, horizontal and
  vertical alignment, optional **bubble** (glass card / framed box).

### Deck (shared by everyone working on the workbook)
* Design (Excel / Liquid Glass), glass strength, background colour strength, **colour theme** (Aurora,
  Ocean, Forest, Sunset, Graphite, Intesa Sanpaolo, Custom: 4 background + 2 accent colours), corner
  roundness, contrast, logo (file, bubble on/off, hidden per slide), **page numbers** (position, font,
  size, format, style, start, cover), **footer** (`{date}`, `{workbook}`, `{title}`). *Use as default for
  new decks* stores the style in `config.json`.

### Export
* PDF (exact = images at 3×, or vector), current slide as PDF/PNG, all slides as PNG, copy to clipboard.
  Rendered by a headless browser from the **same DOM the user sees**; when no engine works the page
  renders the slides itself and the helper only assembles the PDF. Files go to `export\`.

### Working together, updating, keeping data safe
* Several people on the same workbook: changes are merged field by field; others' changes appear within
  ~3 s with their name; presence shows who else is in the workbook; typing is never overwritten by
  autosave or by others' changes.
* `Update Slide Builder.bat` connects the folder to GitHub in place and updates it without touching
  saved setups; saved setups in an older format are **converted automatically** with the old file kept
  (§5).

---

## 2. Using it

| Who | What to do |
|---|---|
| User, first time on a PC | **`Install Slide Builder.bat`**: checks Python (≥ 3.8), installs the optional `playwright` package and the export engine, checks write access and speed of the shared folder, creates a desktop shortcut, self-tests. No admin rights; safe to repeat. |
| User | **`Start Slide Builder.bat`** (or the shortcut): a console window (keep it open) starts the local helper and opens `http://127.0.0.1:8765/`. |
| One person, to update everyone | **`Update Slide Builder.bat`** (§5.4). Then everybody restarts Slide Builder and reloads the page. |
| Export engine only | status pill "Export: …" → *Install export engine*, or `backend\Install export engine.bat`. |
| Developer | §9. Users never need Node.js: the built app `backend/slide_builder.html` is committed. |

Installer steps (`backend/slidebuilder/firstrun.py`): 1 Python · 2 pip/ensurepip · 3 packages
(`--user`; behind SSL inspection retried with `--use-feature=truststore`, verification never disabled)
· 4 export engine (Chrome for Testing via Python `urllib`; on a share it lives in
`%LOCALAPPDATA%\SlideBuilder\engine`) · 5 shared folder (lock file, `export\` write, round-trip time) ·
6 shortcut (`.lnk`, or a `.bat` when PowerShell is restricted) · 7 self-test. Exit 0 when 1, 5, 7 pass.

**From v2:** keep `backend\slide_builder_settings.txt`; the first helper to start imports it (presets,
cell edits, style → shared defaults, last file → preferences), once, under a lock, never overwriting
existing documents, and renames it `slide_builder_settings.v2-backup.txt` (`slidebuilder/migrate.py`).

---

## 3. How it works

```
┌─────────────────── browser tab: backend/slide_builder.html (ONE self-contained file) ──────────────────┐
│ xlsx/    read the workbook (index first, sheets on demand), styles, number formats, CF, drawings,       │
│          table regions and per-cell geometry                                                            │
│ model/   types · operations (+ inverses for undo) · presets → runtime slides · deck style & themes      │
│ render/  edits on top of the workbook · Excel design · scene model + Liquid Glass · slide layout ·       │
│          cover/index · page numbers/footer · wallpaper                                                   │
│ sync/    API client · DocSync (pending ops, polling, authors) · offline store when opened as file://    │
│ editor/  stage (hit testing, selection, inline edit, drag handles) · tables · painter · export · keys   │
│ ui/, wizard/   Preact chrome: top bar, ribbons, dialogs, 3-step wizard                                  │
└───────────────▲───────────────────────────────────────────────────▲─────────────────────────────────────┘
                │ HTTP on 127.0.0.1 + per-start token                │ slide HTML + CSS (exports)
┌───────────────┴────────── helper: backend/slidebuilder (Python standard library) ┴──────────────────────┐
│ server (Host/Origin/token/format checks) · store (docs, upgrades, backups) · ops · locks · fsclock ·    │
│ presence · workbooks (stable reads) · exports + engines (Playwright → DevTools → headless) · pdf ·      │
│ convert (Excel COM, GDI+) · migrate (v2) · firstrun/installer                                           │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
      one helper per PC  ⇄  the same shared folder (SMB): workbooks, backend/data/, export/ — the only channel
```

Principles:
* **All parsing and rendering is in the browser.** The helper moves bytes, stores documents, merges
  operations under file locks, and drives a headless browser for exports.
* **Documents change only through operations** (`preset.set`, `slide.patch`, `table.patch`,
  `cell.patch`, `style.patch`), implemented identically in TypeScript and Python and tested against
  `shared/ops-vectors.json`. Clients never write whole documents.
* **The workbook is never modified.** Everything the user changes lives in `backend/data/`.
* **No runtime dependencies on users' PCs**: one HTML file + standard-library Python.

### Life of an edit (e.g. Ctrl+B on a cell)
1. `editor/keys.ts` → `editor/edit.ts applySel()` diffs each selected cell's `CellEdit` and builds
   `cell.patch` operations → `state/app.ts change(label, ops)`.
2. `sync/docsync.ts apply()` applies them locally (`model/ops.ts`), stores the inverse for undo, shows
   the result immediately, and sends them ~300 ms later: `POST /api/workbooks/<name>/ops`
   (`sync/api.ts`, headers `X-SB-Token`, `X-SB-Formats`).
3. `server.py` checks Host/Origin/token/formats → `store.update_workbook()`: lock
   `data/locks/wb-<key>.lock` → read latest (converting an older format, §5.3) → `ops.apply_ops()` →
   atomic write → rolling backup → unlock → returns the new document.
4. Every other open page polls `GET …/doc?since=<rev>` every 3 s and re-renders only changed tables
   (`state/app.ts onDocChange` → `editor/stage.ts refreshStage`).

### Life of a workbook open
`GET /files/<name>` (stable read) → `xlsx/workbook.ts` index + sheet parsing → document
`GET …/doc` → `model/preset.ts runtimeSlides()` builds `RuntimeSlide`s with `TableLayout`s
(`xlsx/layout.ts buildLayout`, applying user sizes/merges) → `render/slide.ts buildSlide()` per slide.

### Export
`editor/export.ts` collects the slide HTML + `#slidecss`/`#wallcss` → `POST /api/export` →
`exports.py`/`engines.py` render in a headless browser (Playwright, else DevTools websocket, else command
line), `pdf.py` writes the PDF → unique temp file renamed into `export\` (` (2)` if the target is open).

---

## 4. Repository map

```
/                                    ROOT = the folder users see (on the shared drive)
├─ Install Slide Builder.bat         first-time set-up         → backend\slide_builder.py --install
├─ Start Slide Builder.bat           start the helper + app     → backend\slide_builder.py
├─ Update Slide Builder.bat          update from GitHub         → tools\update.py
├─ *.xlsx …                          users' workbooks (not in git)
├─ export\  engine\                  exports / Chrome for Testing (not in git)
├─ README.md  docs\                  documentation (table above)
├─ shared\ops-vectors.json           operation test vectors, run by BOTH test suites
├─ tools\
│  ├─ update.py                      connect folder to GitHub in place / update; ZIP fallback; keeps saved setups
│  └─ loadtest.py                    N simulated users on a (simulated or real) shared folder
├─ backend\
│  ├─ slide_builder.py               entry point (calls slidebuilder.main)
│  ├─ slide_builder.html             THE APP – built from frontend\, committed, never edit by hand
│  ├─ Install export engine.bat · requirements.txt (optional playwright) · README-backend.md
│  ├─ data\                          ALL saved state (not in git) – §5
│  ├─ slidebuilder\                  the helper package
│  │  ├─ main.py          command line; start-up: v2 import, format upgrades, port probe, browser
│  │  ├─ server.py        HTTP API (§7), security checks, error → status mapping
│  │  ├─ store.py         documents: retried reads, atomic writes, ops under locks, backups, format upgrades
│  │  ├─ upgrade.py       saved-format versions (SCHEMA) and upgrade steps (§5.3)
│  │  ├─ ops.py           operation semantics (mirror of frontend/src/model/ops.ts)
│  │  ├─ locks.py         O_EXCL lock files across PCs (wait, stale recovery, owner token, keepalive)
│  │  ├─ fsclock.py       the file server's clock (ages of shared files)
│  │  ├─ presence.py      who has which workbook open (heartbeat files)
│  │  ├─ workbooks.py     listing + stable reads of workbooks
│  │  ├─ exports.py       export orchestration, atomic placement in export\
│  │  ├─ engines.py       browser discovery, engine self-tests, rendering; engine mirror to %LOCALAPPDATA%
│  │  ├─ cdp.py           minimal websocket + DevTools protocol client
│  │  ├─ pdf.py           PDF writer (JPEG/PNG pages)
│  │  ├─ convert.py       .xlsb/.xls → .xlsx (Excel COM), EMF/WMF/TIFF → PNG (GDI+) – Windows only
│  │  ├─ migrate.py       one-time import of the v2 settings file
│  │  ├─ firstrun.py      --install (first-time set-up);  installer.py: --setup (export engine)
│  │  ├─ paths.py         folder layout + env overrides;  util.py: logging, identity, names, atomic writes
│  │  └─ simfs.py         SIMULATION ONLY: added latency for load tests
│  └─ tests\                         unittest, one file per module (+ fixtures\saved\: §5.3)
└─ frontend\                         sources of the app (developers only; Node 20+)
   ├─ package.json · vite.config.ts (single-file build → ../backend/slide_builder.html) · playwright.config.ts
   ├─ src\
   │  ├─ main.tsx                    mounts the app, injects ui/app/slide CSS
   │  ├─ xlsx\   workbook.ts (zip, index, fast sheet parser) · layout.ts (table regions, cell boxes, borders,
   │  │          merges incl. user merges, CF evaluation) · numfmt.ts · color.ts · drawing.ts · types.ts · util.ts
   │  ├─ model\  types.ts (ALL persistent types + FORMATS) · ops.ts (operations, inverses) ·
   │  │          preset.ts (preset → RuntimeSlide, layout cache) · style.ts (style layers, themes)
   │  ├─ render\ context.ts (RenderCtx, cache keys) · edits.ts (effItems: edits, gridlines, painted CF, scales) ·
   │  │          excel.ts · glass.ts (scene model + Liquid Glass) · slide.ts (layout of tables/notes, buildSlide) ·
   │  │          scales.ts · cover.ts (cover, index) · pagenumbers.ts (page numbers, footer) · wallpaper.ts (themes)
   │  ├─ sync\   api.ts (helper client; localStorage backend for file://) · docsync.ts (pending ops, polling)
   │  ├─ state\  store.ts (app state, subscriptions) · app.ts (open, change, undo, doc changes, presence) · dialogs.ts
   │  ├─ editor\ stage.ts (slide editing, hit testing, drags, inline editors) · edit.ts (selection, applySel) ·
   │  │          tables.ts (sizes, same size, align, merge) · painter.ts · keys.ts · export.ts · thumbs.ts · issues.ts
   │  ├─ ui\     App.tsx · Topbar.tsx (open, design, Options: theme/page numbers/footer/logo/look) · Ribbon.tsx
   │  │          (cell formatting) · TableTools.tsx (second row: sizes, scales, tables, gridlines, text boxes) ·
   │  │          TablesDialog.tsx · Dialogs.tsx · Dropdown.tsx · Field.tsx (draft-keeping input)
   │  ├─ wizard\ Wizard.tsx · detect.ts (table suggestions)
   │  └─ styles\ slide.css (EXPORTED with slides) · ui.css · app.css (chrome only)
   ├─ tests\     Vitest: ops (vectors), numfmt, docsync, tables/rendering, build freshness; fixtures\ (generated .xlsx)
   └─ e2e\       app.spec.ts (Playwright: two helpers = two users on one folder) · parity.mjs (v2 ↔ v3 renderer diff)
```

---

## 5. Saved data and format upgrades

### 5.1 What is saved where (`backend/data/`, never in git)
```
data/
├─ config.json                     shared defaults for new decks                   {schema, rev, defaults:{style}}
├─ workbooks/<key>.json            one document per workbook                       {schema, workbook, rev, preset, style, edits, log, …}
├─ users/<user>.json               personal preferences                            {schema, lastFile, pdfMode, zoom}
├─ presence/  locks/               heartbeats, lock files (short-lived)
├─ migrated.json                   marker: v2 settings were imported
├─ app-version.json                installed version (ZIP updates only)
└─ backups/
   ├─ <key>/<rev>.json             rolling copies of each workbook document (last 30, ≤ 1 per 5 min)
   ├─ upgrades/<kind>/<file>.v<n>.<time>.json   the file as it was before a format upgrade (kept)
   └─ before-update-<time>/        saved setups (+ replaced program files) before each update (last 5)
```
`<key>` = workbook file name made Windows-safe + `-` + 10 hex chars of `sha1(name.lower())`. The full
shape of each document and every field is in `docs/ARCHITECTURE.md` §3; the types are
`frontend/src/model/types.ts`. Restoring a deck: copy a backup over `workbooks/<key>.json` while nobody
edits it (an older-format backup is converted automatically).

### 5.2 What a document holds
* `preset` – sheets, **tables** (`markers` or `range`, plus `name`, `cols`/`rows` size overrides,
  `scales`, `merges`, `gridH`/`gridV`) and **slides** (`cover`/`index`/`content`: title, subtitle, date,
  note, tables, layout bands & weights, logo, align/valign, fixed scale, `notes` = text boxes, `subs`).
* `style` – the deck's style layer (design, glass, colour, theme, radius, contrast, logo, logoBubble,
  `pn` page numbers, `footer`). Effective style = built-in ← `config.defaults.style` ← `doc.style`.
* `edits[sheet][A1]` – per-cell `CellEdit`: text (+ `orig` = Excel text it replaced), sz, b, i, color,
  fill (highlight), bg (cell colour), cf (painted conditional format), align, role.
* `rev`, `updated` (file-server time), `updatedBy`, `log` (last 20 authors), `backupAt`.

### 5.3 Format versions: saved setups keep working after every update
Every saved file carries `"schema"` (workbook 3, config 3, prefs 1 today; files written before the
numbers existed count as those versions). `backend/slidebuilder/upgrade.py` holds the current numbers
(`SCHEMA`) and one **step function per version change**. Whenever the store reads a file
(`store._load`):
* **older format** → under the file's lock it is re-read, the original is copied to
  `backups/upgrades/<kind>/<file>.v<old>.<time>.json`, the steps are applied in order (3→4→5…), the
  result is written atomically. Exactly once, even with several PCs reading at the same time. At
  start-up `store.upgrade_all()` converts every file, so decks nobody opens are converted too;
* **newer format** (written by an already-updated PC) → never changed; HTTP 409 "restart Slide
  Builder";
* the page sends `X-SB-Formats` with every change; a helper with different formats answers 409 and the
  page shows "Slide Builder was updated – reload the page" instead of writing old-format data.
  `FORMATS` in `frontend/src/model/types.ts` must equal `SCHEMA` (a test checks it).

`backend/tests/fixtures/saved/` contains real examples of every released format; `tests/test_upgrade.py`
reads all of them on every test run, simulates future upgrades (conversion, chaining, one backup,
concurrency, too-new files) and checks the page/helper agreement. **How to change the stored format:**
see §10.

### 5.4 Updating the program (`Update Slide Builder.bat` → `tools/update.py`)
* With git: the existing folder becomes the working copy **in place** (`git init` + fetch + forced
  checkout of tracked files only; later `fetch` + `reset --hard` to the followed branch). Never
  `git clean`; never `git clone` into the folder (that creates a nested copy – the script offers to
  delete one that holds no saved work).
* Without git: downloads the branch ZIP and writes only program files (atomic replace).
* Never written: `backend/data/`, `backend/logo*`, `slide_builder_settings*.txt`, workbooks, `export/`,
  `engine/` (also excluded by `.gitignore`). Before each update the saved setups (and any hand-edited
  program file) go to `backups/before-update-<time>/`; afterwards every deck is opened with the new code.
  One update at a time (lock). Options: `--check`, `--branch <name>`, `--zip`.
* After an update, everyone restarts Slide Builder and reloads the page; saved setups are converted to a
  newer format automatically on the first start (§5.3).

---

## 6. Concurrency model
* **Operations merged under file locks.** Lock = `data/locks/<name>.lock` created with `O_CREAT|O_EXCL`
  (atomic on SMB), body `{user, host, pid, at, token}`; wait ≤ 10 s; stale after 15 s by the
  **file server's clock** (`fsclock.py`), owner token checked on release. Locks: `wb-<key>`, `config`,
  `user-<name>`, `migrate`, `export-<name>`, `update`, installer locks.
* **Field-level merge**: each operation touches only its fields; maps (`notes`, `cols`, `rows`, `scales`,
  `merges`, `pn`, `footer`, `theme`) merge entry by entry. Same field at the same time → later wins.
* **Never lose data**: unreadable file → 503 and retry, never replaced by an empty one; writes are
  temp-file + fsync + `os.replace`; clients keep unsent operations and retry with back-off.
* **Undo** applies the stored inverse operations of *your* change only.
* Clients: `DocSync` keeps `server` + in-flight + pending ops, polls `?since=rev` every 3 s, names
  remote authors from `doc.log`. The stage never redraws while an inline editor is open; settings inputs
  (`ui/Field.tsx`) keep the typed draft while focused.
* Load test and the measured cost of each step: `docs/LOADTEST.md` (`tools/loadtest.py`).

---

## 7. HTTP API
Helper on `127.0.0.1:8765` (next free port if busy). Every `/api/*`, `/files/*`, `/assets/*` request needs
`X-SB-Token` (injected into the served page); Host and Origin are checked; POST/PUT with an
`X-SB-Formats` header must match the helper's formats. Full request/response shapes: ARCHITECTURE §5.

| Endpoint | Purpose |
|---|---|
| `GET /` | the app with the token injected |
| `GET /api/ping` · `GET /api/health` | liveness (no token) · version, user, folders, export engine state |
| `GET /api/files` · `GET /files/<name>` | workbooks in the folder · workbook bytes (stable read) |
| `GET /api/workbooks/<name>/doc?since=rev` | document (204 if unchanged) |
| `POST /api/workbooks/<name>/ops` | apply operations → `{doc, applied, skipped}` |
| `GET /api/workbooks/<name>/history` | rolling backups |
| `GET /api/config` · `POST /api/config/ops` | shared defaults |
| `GET /api/me` · `PUT /api/me` | user, host, personal preferences |
| `POST /api/presence` · `POST /api/presence/leave` | heartbeat → others in the workbook |
| `POST /api/export` · `POST /api/assemble` | render + write exports · PDF from page-rendered images |
| `POST /api/convert-workbook` · `POST /api/convert` | .xlsb/.xls → .xlsx · EMF/WMF/TIFF → PNG (Windows) |
| `POST /api/upload` · `GET /api/upload/<id>` | temporary in-memory uploads (local files) |
| `POST /api/open` · `POST /api/engine/restart` · `GET/POST /api/engine/install` | open file/folder · engines |
| `GET /assets/<name>` | images (logo) from `backend/` or the root |

Status codes: 400 · 403 (Host/token/Origin/file type) · 404 · 409 (format mismatch: newer file or
outdated page) · 413 · 501 (converter unavailable) · 503 (unreadable, lock busy, workbook being saved,
no engine – clients retry).

---

## 8. Rendering pipeline
1. `xlsx/layout.ts buildLayout(sheet, region, sizes)` → `TableLayout`: visible rows/cols, x/y/w/h maps
   (user widths/heights applied), one `Item` per cell box (merges = workbook merges − user splits + user
   merges), fonts, fills, borders, conditional format (`evalCF`), number-format text.
2. `render/edits.ts effItems(L, ctx)` → effective items: gridlines, painted conditional formats, cell
   edits, cell colour vs highlight, colour scales (`render/scales.ts`). Cached per `tableKey`.
3. Design: `render/excel.ts` (absolutely positioned divs) or `render/glass.ts` (scene model: containers,
   surfaces, frames, grids, rules, signals, media → glass materials, capsules, hairlines, ink colours by
   role; columns widened for the font via `glassGeom`).
4. `render/slide.ts`: `computeLayout` places tables in bands with their text boxes (scale k = largest that
   fits, or the slide's fixed scale; align/valign); `buildSlide` adds title, cover/index, page number,
   footer, logo, theme variables; `placeGlass` positions the blurred wallpaper copy behind each glass
   element. `render/wallpaper.ts` paints the theme wallpaper (canvas → data URL in `#wallcss`).
5. The editor (`editor/stage.ts`) adds overlays (`.hits`, `.hbox` handles) only in interactive mode;
   thumbnails/exports use the same `buildSlide`.

Caches: per-table string keys (`tableKey`: sheet edits + table def + radius) for effective items, HTML and
glass geometry; layout cache in `model/preset.ts`. Details of every design rule: `docs/RENDERING.md`.

---

## 9. Development

```
cd frontend
npm install                  # once (Node 20+, developer machine only)
npm run build                # type-check + single-file build → ../backend/slide_builder.html  (commit it)
npm test                     # Vitest unit tests (incl. "built file is up to date")
npm run test:e2e             # Playwright: two helpers (users anna/bob) on one temp shared folder
node e2e/parity.mjs <old html> ../backend/slide_builder.html tests/fixtures/*.xlsx   # renderer diff

cd backend
python -m unittest discover -s tests -v                  # helper tests (Python 3.8+)
python slide_builder.py [--port 8765] [--no-browser] [--setup] [--install]
```

| Test suite | Covers |
|---|---|
| `frontend/tests/ops.test.ts` + `backend/tests/test_ops.py` | every vector in `shared/ops-vectors.json`, inverses (undo) |
| `frontend/tests/tables.test.ts` | layout, sizes, same size, scales, merges, cell colour, footer, themes, gridlines, painted CF, valign |
| `frontend/tests/numfmt.test.ts`, `docsync.test.ts`, `build.test.ts` | number formats · sync queue/retry/undo · committed HTML is fresh |
| `frontend/e2e/app.spec.ts` | wizard, two users merging edits, export, table tools, painter, gridlines, themes, typing under concurrent changes |
| `backend/tests/test_store.py`, `test_locks.py`, `test_fsclock.py` | multi-process saves, stale locks, clock skew |
| `backend/tests/test_upgrade.py` | saved-format examples, automatic upgrades, too-new files, page/helper formats |
| `backend/tests/test_update.py` | connect-in-place, update, ZIP mode, protected paths, update lock |
| `test_http.py`, `test_migrate.py`, `test_exports.py`, `test_firstrun.py`, `test_installer.py`, … | API & security, v2 import, exports, installer |

Notes: test workbooks are generated by `frontend/tests/fixtures/make_fixtures.py` (openpyxl). Without a
downloaded browser use `CHROME=/path/to/chrome`. Helper environment switches (`SLIDEBUILDER_ROOT`,
`SLIDEBUILDER_DATA`, `SLIDEBUILDER_USER`, …): `backend/slidebuilder/paths.py`, `backend/README-backend.md`.

---

## 10. Where to change what

| Task | Touch |
|---|---|
| **New saved field** (on a slide/table/cell/style) | `model/types.ts` (type + `Op` patch type) → key lists in `model/ops.ts` **and** `backend/slidebuilder/ops.py` → a vector in `shared/ops-vectors.json` → `docs/ARCHITECTURE.md` §3 table → UI (`ui/*.tsx`) → rendering (`render/*`) → if it changes a table's HTML, add it to `tableKey` (`render/context.ts`) → tests. An optional new field needs **no** format change. |
| **Change the meaning/shape of saved data** (rename, restructure, new default that must apply to old decks) | raise `SCHEMA[kind]` in `backend/slidebuilder/upgrade.py` and add `@step(kind, old)` converting n → n+1; raise `FORMATS` in `frontend/src/model/types.ts`; add a test in `test_upgrade.py`; **add** a new example `fixtures/saved/<kind>.v<n+1>.json` (never edit the old ones); document in ARCHITECTURE §3.3. |
| New cell formatting button | `ui/Ribbon.tsx` → `editor/edit.ts applySel` (new `CellEdit` key → also `KEYS` there) → `render/edits.ts` → painter (`editor/painter.ts Fmt`) |
| Table geometry / alignment / drag handles | `editor/tables.ts`, `editor/stage.ts` (`wireTableHandles`, `startEdgeDrag`), `render/slide.ts computeLayout` |
| Liquid Glass look | `render/glass.ts`, `styles/slide.css` (exported), `render/wallpaper.ts`, themes in `model/style.ts` |
| Excel look | `render/excel.ts`, `xlsx/layout.ts` (borders, fills, merges), `xlsx/numfmt.ts` |
| Reading something new from .xlsx | `xlsx/workbook.ts` (sheet XML), `xlsx/drawing.ts`, `xlsx/types.ts` |
| Deck options (Options menu) | `ui/Topbar.tsx` + `model/style.ts` (defaults, resolve) + `style.patch` keys/maps in both `ops` files |
| Wizard | `wizard/Wizard.tsx`, `wizard/detect.ts`, `model/preset.ts` |
| Saving, polling, conflicts | `sync/docsync.ts`, `state/app.ts onDocChange`, `backend/slidebuilder/store.py` |
| HTTP endpoint | `backend/slidebuilder/server.py` + `sync/api.ts` + ARCHITECTURE §5 + `test_http.py` |
| Export | `editor/export.ts`, `backend/slidebuilder/exports.py`, `engines.py`, `pdf.py` |
| Install / start / update | `*.bat`, `backend/slidebuilder/firstrun.py`, `installer.py`, `main.py`, `tools/update.py` |

---

## 11. Security
The helper listens on 127.0.0.1 only; `Host` check (DNS rebinding), random token per start required on
every API call (other web pages cannot call it), `Origin` check, body size limits, file serving limited
to workbook/image extensions inside the app folder.

## 12. Gotchas
1. **Never edit `backend/slide_builder.html`** – edit `frontend/src`, `npm run build`, commit both (a
   unit test fails on a stale build).
2. **Exports only carry `#slidecss` (`styles/slide.css`) + `#wallcss`** – anything a slide needs must
   be there or inline; images must be data URLs.
3. New glass elements need class `wb` and inline `left/top/width/height`; `applyLayout()`/`placeGlass()`
   must run after geometry changes.
4. Keep hot paths cheap: no per-cell listeners/elements; reuse the per-table caches.
5. Hidden sheets stay hidden (user requirement).
6. Never write a whole shared document from a client; never treat an unreadable file as empty.
7. Times on shared files come from the file server's clock (`fsclock.py`).
8. Corporate Windows: DevTools may be disabled, headless Edge may hang, executables cannot run from
   `T:\`, TLS is intercepted (download with Python `urllib`), consoles may be cp1252, PowerShell may be
   in Constrained Language Mode, git on a share needs `safe.directory` (the update script passes it).
9. The placeholder `__SB_TOKEN__` is replaced everywhere in the served page – never write it in code.
10. Preact controlled inputs reset to the prop on every re-render: inputs for shared settings must use
    `ui/Field.tsx`, and the stage defers redraws while an inline editor is open.

## 13. Known limitations
* Charts are not redrawn (paste as pictures); Excel data bars/colour scales/icon sets are not reproduced
  (Slide Builder's own colour scales are).
* Formulas are not recalculated. Cell edits are keyed by address: inserting rows above a table moves
  format edits (text edits pause and are listed in the side panel).
* Two people changing the same field at the same moment: the later wins.
* The offline mode (page opened as `file://`, data in the browser's localStorage) is for emergencies:
  no sharing, no exports, no format upgrades.
* The in-window export fallback cannot render web fonts and `backdrop-filter` exactly; the cover's
  automatic date is in English.
* Ideas: Web Worker parsing, PPTX export, a central server implementing the same API.
