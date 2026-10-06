# Slide Builder 3 — developer & user guide

Slide Builder turns tables in an Excel workbook into presentation slides (16:9, 1600 × 900 CSS px =
13.333 × 7.5 in) and exports them as PDF / PNG. It was built for a weekly banking report
(“IBD – Total Banks Loans & Deposits”) and runs on locked-down corporate Windows PCs: no admin rights,
no installs beyond Python, Edge with DevTools disabled by policy, SSL-inspecting proxy, network drives.

Two visual designs: **Excel** (faithful copy of the workbook formatting) and **Liquid Glass** (an
iOS 26-style light design that keeps the workbook's meaning: headers, totals, green/red formatting).

**Version 3** keeps the deployment model (one folder on a shared drive, each user starts their own
local helper) but is rebuilt so that **several people can work at the same time, on the same or on
different workbooks, without overwriting each other**. Why and how: [`docs/REVIEW.md`](docs/REVIEW.md)
(review of v2.3, including why this is not a Next.js app), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
(storage, locking, sync, HTTP API), [`docs/RENDERING.md`](docs/RENDERING.md) (reading and rendering).

---

## 1. Quick start

| Who | What to do |
|---|---|
| User, first time on a PC | Double-click **`Install Slide Builder.bat`** (next to `Start Slide Builder.bat`). It checks Python, installs the optional packages and the export engine, checks that you can write in the shared folder, puts a **Slide Builder** shortcut on your desktop and starts the helper once as a test. No administrator rights needed; safe to run again. |
| User | Double-click the **Slide Builder** desktop shortcut or `Start Slide Builder.bat`. A console window opens (keep it open) and the app opens in the browser at `http://127.0.0.1:8765/`. |
| User, export engine only | Click the status pill at the top right (“Export: …”) → **Install export engine**, or run `backend\Install export engine.bat`. |
| Developer | See §6. Users never need Node.js: the built app (`backend/slide_builder.html`) is committed. |

Requirements: Python ≥ 3.8 – any newer version too (3.9+ for the optional `playwright` package), Windows 10/11
(macOS/Linux work for development). The helper uses only the Python standard library.

### First-time set-up (`Install Slide Builder.bat`)

The installer looks for Python with `py -3`, then `python`. If neither is found it explains where to
get it: the company software portal, or python.org's Windows installer with the **per-user install**
(“Install Now” without admin privileges, tick “Add python.exe to PATH”) – no administrator rights are
needed. It then runs `python backend\slide_builder.py --install`, which prints numbered steps with
`OK` / `WARN` / `FAIL` and a summary:

| Step | What it does | If it fails |
|---|---|---|
| 1 Python | version (printed exactly as detected), 32/64-bit, virtual environment | FAIL below 3.8; WARN on 3.8 (Playwright skipped) |
| 2 pip | `python -m pip --version`, else `python -m ensurepip --user` | WARN – packages skipped |
| 3 Packages | `pip install --user -r backend\requirements.txt` (only `playwright` today). Behind an SSL-inspecting proxy a certificate error is retried with `--use-feature=truststore` (Windows certificate store) when pip 22.2–24.1 and Python 3.10+; pip 24.2+ already uses it. Verification is never switched off. | WARN – exports work without it |
| 4 Export engine | the same installer as `Install export engine.bat` (Chrome for Testing, downloaded by Python; on a network share it goes to `%LOCALAPPDATA%`) | WARN – exports are rendered in the app window |
| 5 Shared folder | creates/deletes a lock file in `backend\data\locks`, writes a file in `export\`, measures the file-server round trip (median of 20 create+stat+replace+delete cycles; > 30 ms makes saving noticeably slower) | FAIL – ask IT for *Modify* rights |
| 6 Shortcut | “Slide Builder” on the desktop: a `.lnk` via PowerShell/WScript.Shell, or – when PowerShell or COM is blocked (Constrained Language Mode) – a small `Slide Builder.bat` that opens the app folder and starts it | WARN |
| 7 Self-test | starts the helper on a free port, calls `/api/ping`, stops it | FAIL |

Exit code 0 when steps 1, 5 and 7 passed (warnings allowed), 1 otherwise. Both `.bat` files use
`pushd`, so they also work when the folder is opened as `\\server\share\…`.

### Working together

* Everybody opens the app from the same shared folder. Presets, cell edits and the deck's style are
  stored **per workbook** in `backend\data\workbooks\` and are shared.
* Changes are saved as small operations and merged by the helper under a lock on the share: two
  people editing different cells, slides or settings never lose each other's work. If both change the
  **same** cell property, the later change wins.
* Other people's changes appear within ~3 seconds; the status bar says who made them, and the top bar
  shows who else has the workbook open.
* **Undo only undoes your own changes**, even if others changed the workbook since.
* If someone changes the slides while you are in the wizard, saving the wizard asks before replacing
  their changes.
* Design, glass strength, colour, page numbers and logo belong to the deck (the workbook). *Options ›
  Use as default for new decks* makes the current style the default for workbooks without one.
* Personal things stay personal: the workbook reopened at start-up, the default PDF mode, the zoom.
* If saving fails (share unreachable, file locked), changes stay queued, the status bar says
  “Not saved yet – retrying”, and nothing is ever replaced by an empty or older copy.

### Table tools

* **Column widths / row heights:** drag a border on the slide (double-click = Excel size), or type
  **W / H** in the second toolbar row for the selected columns/rows.
* **⇔ Same size** makes the tables of the current slide exactly the same size; **Sizes…** does it for
  tables on different slides, copies column widths between tables, aligns and resets.
* **Align** the tables of a slide left, centre or right.
* **Text boxes** above, below, left or right of a table (the + on the table, or the arrows in the
  toolbar): as wide as the table above/below, as high on the sides; double-click to write.
* **Colour scale** on selected cells: deeper green/red with the size of the number, per row, per
  column or over the whole selection, for the cell colour and/or the number colour.
* **Options › Look:** corner roundness, background contrast, glass bubble around the logo.
* **Cell colour** (paint-bucket menu, upper half) replaces the colour the cell has in Excel – e.g. a
  merged navy header can be made red; in Liquid Glass the whole block takes the new colour. *No colour*
  removes it, *Colour from Excel* goes back. The lower half (**Highlight**) puts a coloured capsule
  around the value instead.
* **Merge / Unmerge** the selected cells, including cells merged in the Excel file. The workbook is
  never changed; the merge is stored with the table in the preset.
* **Format** (painter, like Excel): select cells, click *Format*, then click or drag over other cells –
  on any table or slide. A block of cells is repeated as a pattern. Double-click *Format* to paint
  several times; Esc stops. Text is never copied.
* **Options › Footer:** a footer on every slide (optionally the cover), with `{date}`, `{workbook}`,
  `{title}`, in any corner or centred, plain or as a glass capsule; it moves aside for the page number
  and logo when they share a corner.
* **Text boxes:** align the text left/centre/right and top/middle/bottom; **◯ Bubble** puts the box on a
  card like the tables (glass in Liquid Glass, a framed box in Excel).
* **Tables:** align them top/middle/bottom as well as left/centre/right (also in *Sizes…* for several
  slides); drag a table's **border** to make it wider/narrower (left/right) or taller/shorter (top/bottom),
  the round corner handle keeps the proportions.
* **Gridlines:** per table, horizontal and vertical separately: as in Excel, all, or none.
* **Format** also copies conditional formatting (the rules are applied to the painted cells' own values,
  like Excel), colour scales, the cell colour and the text colour.
* **Contents page:** *Subtitles* in the toolbar (or *with subtitles* in the wizard) shows or hides the
  slide subtitles in the list.
* **Options › Colour theme:** Aurora, Ocean, Forest, Sunset, Graphite, **Intesa Sanpaolo** (green and
  orange) or **Custom** (four background colours, two accents). The theme colours the Liquid Glass
  background and the accents (cover, index numbers, titles in Excel, heading rules). The Intesa
  Sanpaolo colours follow the public brand colours; use Custom if your brand guide gives other values.
* **Options › Logo:** untick *Bubble around the logo* to show the logo on its own.
* Typing is safe: while you type in a settings box or edit a cell, title or text box on the slide,
  autosave and other people's changes never put the old text back; the slide redraws once you finish.

### How fast is the shared folder?

Run `Install Slide Builder.bat` (step 5 prints the file-server round trip) or
`python tools\loadtest.py --real-folder "T:\Slide Builder" --scenario same`. Results and options
(including when a central server is worth it): [`docs/LOADTEST.md`](docs/LOADTEST.md).

### Upgrading from v2

Replace the program files (keep the workbooks, `logo.png` and `slide_builder_settings.txt`) and start
the app once. The first helper to start imports the v2 settings (presets, cell edits, design, page
numbers → shared defaults; your last file and PDF mode → your preferences) and renames the old file to
`slide_builder_settings.v2-backup.txt`. The import runs once, under a lock, and never overwrites
documents that already exist.

---

## 2. Folder layout

```
Slide Builder\                      ROOT – what the user sees
├─ Install Slide Builder.bat        first-time set-up (Python packages, export engine, shortcut, checks)
├─ Start Slide Builder.bat
├─ README.md, docs\
├─ tools\loadtest.py               simulates 10 users on the shared folder (docs/LOADTEST.md)
├─ *.xlsx / *.xlsm / *.xlsb / *.xls workbooks placed here appear in the app's Open menu
├─ export\                          every exported PDF / PNG is written here
├─ engine\                          Chrome for Testing (optional; mirrored to %LOCALAPPDATA% on shares)
├─ backend\
│  ├─ slide_builder.py              entry point (the helper)
│  ├─ slide_builder.html            the app (BUILT from frontend\ – do not edit)
│  ├─ slidebuilder\                 helper package (one module per concern, see README-backend.md)
│  ├─ tests\                        helper tests (unittest)
│  ├─ Install export engine.bat
│  ├─ logo.png                      logo shown on slides (file name configurable per deck)
│  └─ data\                         ALL shared state – see docs/ARCHITECTURE.md §3
│     ├─ config.json                defaults for new decks
│     ├─ workbooks\<name>-<hash>.json   one document per workbook (preset, style, cell edits, revision log)
│     ├─ users\<user>.json          personal preferences
│     ├─ presence\, locks\          who is working where; short-lived lock files
│     └─ backups\<workbook>\<rev>.json  rolling copies (last 30, at most one per 5 min)
├─ frontend\                        sources of the app (TypeScript + Preact), tests – developers only
└─ shared\ops-vectors.json          operation semantics, tested by both the helper and the app
```

To recover an older version of a deck, copy a file from `backend\data\backups\…` over the workbook's
document in `backend\data\workbooks\` (with nobody editing that workbook).

---

## 3. Architecture

```
┌──────────────────────── browser tab (slide_builder.html, one self-contained file) ─────────────────┐
│ xlsx/     workbook index + fast sheet parser, styles, number formats, CF, drawings, table layout    │
│ render/   Excel design · scene model + Liquid Glass · slide layout · cover/index · page numbers      │
│ model/    types · operations (+ inverses for undo) · presets → runtime slides · deck style            │
│ sync/     API client (token) · DocSync: pending ops, polling, authors · offline store (file://)      │
│ editor/   stage (hit testing, selection, inline edit, table move/resize) · thumbnails · export       │
│ ui/, wizard/   Preact components: top bar, ribbon, dialogs, 3-step wizard                            │
└──────────────▲───────────────────────────────────────────────▲──────────────────────────────────────┘
               │ HTTP 127.0.0.1 + per-start token                │ static HTML of slides (export)
┌──────────────┴──────────── backend/slidebuilder (Python stdlib) ┴──────────────────────────────────┐
│ server: Host/Origin/token checks · store: per-workbook docs, ops merged under O_EXCL lock files       │
│ (file-server clock, stale-lock recovery, atomic replace, backups) · presence · migration            │
│ exports: Playwright → DevTools → headless command line; PDF writer · converters (Excel COM, GDI+)    │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
          every helper (one per PC) ⇄ the same shared folder (SMB) – the only coordination channel
```

* **All parsing and rendering happens in the browser.** The helper never parses Excel; it moves bytes,
  stores documents, merges operations, and drives a headless browser for exports.
* **Exports render the exact DOM the user sees**, at 3× (4800 × 2700): screen and PDF cannot drift.
* **No dependencies at run time** on users' PCs (no Node.js): the app is one HTML file, the helper is
  standard-library Python.
* A central server could replace the helpers later by implementing the API in `docs/ARCHITECTURE.md`
  §5 – the front end would not change.

---

## 4. Export

Unchanged from v2 in behaviour (engines are self-tested in the background; failing ones are disabled
for the session; in-window rendering as the last resort). New in v3: files are written to a unique
temporary name and renamed into place, so two people exporting the same workbook never produce a
garbled PDF; a target that is open in a viewer gets a ` (2)` suffix. Names: `<workbook> - slides.pdf`,
`… (vector).pdf`, `<workbook> - <slide>.pdf` (current slide), `<workbook> - <slide>.png`.

Programs cannot run reliably from network shares, so on a share the engine is installed in / copied to
`%LOCALAPPDATA%\SlideBuilder\engine` (under a per-PC lock).

---

## 5. Security

The helper listens on 127.0.0.1 only. v3 adds: `Host` header check (blocks DNS rebinding), a random
token per helper start injected into the served page and required on every API call (blocks other web
pages from calling the helper), `Origin` check, request size limits, and file serving restricted to
workbook/image extensions inside the app folder.

---

## 6. Development

```
cd frontend
npm install                 # once; Node 20+ (developer machine only)
npm run build               # type-check + build → ../backend/slide_builder.html (commit it)
npm test                    # unit tests (Vitest): operations, number formats, sync, “built file is up to date”
npm run test:e2e            # Playwright: two helpers (two users) on one shared folder, wizard, merge, undo, export
node e2e/parity.mjs <v2 html> ../backend/slide_builder.html tests/fixtures/*.xlsx   # v2 ↔ v3 renderer comparison

cd backend
python -m unittest discover -s tests -v                 # helper tests (locks, store, migration, HTTP, …)
python slide_builder.py [--port 8765] [--no-browser] [--setup]
```

* Test workbooks are generated by `frontend/tests/fixtures/make_fixtures.py` (needs `openpyxl`).
* E2E/Playwright on a machine without a downloaded browser: `CHROME=/path/to/chrome npm run test:e2e`.
* Changing an operation's meaning: update `docs/ARCHITECTURE.md` §3.2, `shared/ops-vectors.json`,
  `frontend/src/model/ops.ts` and `backend/slidebuilder/ops.py` together – both test suites check the vectors.
* Environment switches for the helper (testing): see `backend/README-backend.md`.
* `npm audit` reports advisories in build-time-only packages (e.g. `braces` via the single-file
  plugin). They are not part of the shipped HTML and process only the project's own files.

---

## 7. Gotchas

1. **Never edit `backend/slide_builder.html`** – edit `frontend/src` and `npm run build`. The unit
   tests fail if the committed file is stale.
2. **Slide CSS is exported**: exports send `#slidecss` (`frontend/src/styles/slide.css`) + `#wallcss`
   only. Anything a slide needs must live there or in inline styles; images must be data URLs.
3. **Glass surfaces need `placeGlass()`** after any geometry change (`applyLayout()` does it). A new
   glass element must have class `wb` and inline `left/top/width/height`.
4. **Keep the hot paths cheap**: no per-cell listeners or elements; reuse the per-table caches.
5. **Hidden sheets stay hidden** – the reader skips them on purpose (user requirement).
6. **Never write a whole shared document from a client.** Changes are operations, applied by the
   helper to the latest version under the lock. Never treat an unreadable file as empty.
7. **Times on shared files come from the file server's clock** (`fsclock.py`), not the PC's.
8. Corporate Windows: Edge DevTools may be disabled, headless Edge may hang, `T:\` shares cannot run
   executables, TLS is intercepted (use Python `urllib`, not Node, for downloads), the console may be
   cp1252, PowerShell may be in Constrained Language Mode.
9. The placeholder `__SB_TOKEN__` is replaced everywhere in the served page – never write it in code.

---

## 8. Known limitations / ideas

* Charts are not redrawn (paste them as pictures); data bars, colour scales and icon sets are not
  reproduced (reported in the side panel).
* Formulas are not recalculated – cached values from the last Excel save are shown.
* Cell edits are keyed by address; inserting rows above a table moves *format* edits to other cells
  (text edits pause and are listed in the side panel).
* Merging is per field: two people changing the same cell's text at the same moment → the later wins.
* The in-window export fallback (no engine available) cannot render web fonts and `backdrop-filter`
  exactly; the cover's automatic date is in English (“6 October 2026”); a workbook reopened at start-up
  with x-marker tables and no preset gets one slide per "slide" sheet without asking.
* Next steps: Web Worker for parsing, PPTX export, a central server (same API) for real-time sync.
