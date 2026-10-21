# Slide Builder

Slide Builder turns tables in Excel workbooks into 16:9 presentation slides and exports them as vector
PDFs (one page per slide) or PNGs. It was built for a weekly banking report deck and runs on
**locked-down corporate Windows PCs**: no admin rights, nothing installed beyond Python, an SSL-inspecting
proxy, possibly restricted PowerShell, and the application living in a **shared network folder (SMB)** that
several people use **at the same time, on the same or on different workbooks**.

This README describes **Slide Builder 4** (4.0 and the unreleased 4.1). It is written for a software engineer
who has to understand, run, change or replace the whole system: what the product does (§1), how it is deployed
and run (§2), the architecture (§3), the data model (§4), every front-end and helper module (§5, §7), the
important flows end to end (§6), the HTTP API (§8), concurrency and failure handling (§9), the export (§10),
development and tests (§11), where to change what (§12), security (§13), gotchas (§14) and known gaps (§15).

| Deeper document | Read it for |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | **the binding contract**: saved files, every field of the document, every operation and its merge semantics, the deck journals and snapshots, locking, full HTTP request/response shapes, format versions |
| [`docs/RENDERING.md`](docs/RENDERING.md) | the workbook reader and the three designs in algorithmic detail (layout, Liquid Glass scene model, table tools) |
| [`helper/README-helper.md`](helper/README-helper.md) | the helper's command line, modules and tests (partly out of date: see §15) |
| [`docs/next/`](docs/next/00-summary.md) | the design of the Slide Builder 4 rebuild: summary, options, architecture, data and migration, test and parity plan, [`PLAN.md`](docs/next/PLAN.md), [ADRs](docs/next/adr/), [`cutover.md`](docs/next/cutover.md), [`release-checklist.md`](docs/next/release-checklist.md) |
| [`PROGRESS.md`](PROGRESS.md) | what each step of the rebuild built, the decisions taken, and every measured number |
| [`docs/v3/LOADTEST.md`](docs/v3/LOADTEST.md) | the load test of the storage (v4 summary at the top, v3 below) |
| [`docs/v3/`](docs/v3/README.md) | kept for history: the README and the contract ([`ARCHITECTURE.md`](docs/v3/ARCHITECTURE.md)) of Slide Builder 3, the v2 review ([`REVIEW.md`](docs/v3/REVIEW.md)) and the rebuild brief ([`MIGRATION-PROMPT.md`](docs/v3/MIGRATION-PROMPT.md)) |

**History, in one paragraph.** Slide Builder 2 was a single settings file; Slide Builder 3 (3.0–3.3) was a
Preact page that parsed and drew everything on the browser's main thread, saved whole documents through the
helper (which applied operations to whole documents under a lock) and exported by driving a browser. Slide Builder 4 was built step by step on top of it (PLAN M0–M5,
shipped as 3.4–3.8 and 4.0 on 2026-10-15): a React 19 app with one store (3.5), the workbook and the document in
a worker (3.6), a display list with a native PDF writer (3.7), the screen drawn from the same display list (3.8)
and journal storage (4.0). 4.1 (unreleased at the time of writing) reads `.xlsb` natively. The changes users
notice are listed per release in [`CHANGELOG.md`](CHANGELOG.md).

**Contents** — [1 Product](#1-what-the-product-does) · [2 Deployment](#2-deployment-and-running-it) ·
[3 Architecture](#3-architecture) · [4 Data model](#4-data-model) · [5 Front end](#5-front-end-coresrc-and-appsrc) ·
[6 Flows](#6-key-flows-end-to-end) · [7 Helper](#7-the-helper-helperslidebuilder) ·
[8 HTTP API](#8-http-api) · [9 Concurrency](#9-concurrency-and-failure-model) ·
[10 Export](#10-export) · [11 Development](#11-development-and-tests) ·
[12 Recipes](#12-where-to-change-what) · [13 Security](#13-security) · [14 Gotchas](#14-gotchas) ·
[15 Limitations and tech debt](#15-known-limitations-and-technical-debt) · [16 Repository map](#16-repository-map)

---

## 1. What the product does

A user opens a workbook from the shared folder. A wizard picks sheets and tables and arranges them on
slides. The tables are then drawn in one of three **designs**, edited on the slide like in Excel, and
exported. Everything a user changes is stored **beside** the workbook (`backend\data\`); the workbook is
never modified. Several users can work on the same deck at the same time.

### 1.1 Feature reference

**Workbooks**
* `.xlsx`, `.xlsm` and (since 4.1) `.xlsb` are read by the page itself. Old `.xls` workbooks and protected
  compound files are converted to `.xlsx` by the PC's Excel (COM, through the helper); a workbook encrypted with
  a password or a sensitivity label ("EncryptedPackage") is refused with a message, because Excel would wait on
  its password prompt. Hidden and very hidden sheets are skipped on purpose (user requirement); chart sheets too.
* Reads values (cached formula results – formulas are **not** recalculated), number formats (Italian
  separators, locale tags, dates), fonts, fills, borders, merges, hidden rows/columns, conditional formatting
  (`cellIs` and simple `expression` rules), rich-text **superscripts/subscripts**, pictures (EMF/WMF/TIFF through
  the helper's conversion), shapes and text boxes. Charts are listed, not drawn.
* Tables are found by **"x" markers** in the top-left and bottom-right corners of a region (the marker row
  and column are outside the table), or picked as ranges in the wizard (optionally "grows" to follow new rows).

**Wizard** (✦ Wizard, 4 steps): 1 Sheets (in a large workbook – over 12 MB of sheet data or a 6 MB file – a sheet
is read only when selected; **Scan for "x" tables** reads the selected ones at once and shows their "x" tables
there, B43) → 2 Tables (drag or type ranges on a sheet preview, detected
suggestions) → 3 Slides (drag tables between slides; optional cover and contents slide; logo per slide) →
4 **Versions** (named variants of the deck in which chosen cells are removed, e.g. *Chief* = everything,
*All* = some cells blanked).

**Designs** (top bar: *Liquid Glass · Excel · Excel Refined*)
* **Excel** – the workbook's own formatting, no decoration of its own (no deck colours on tables, no glass). Title,
  logo, page number and footer stay; since 4.3 (B19) the user's objects – text boxes, automated comments, the notes
  section, charts and callouts – are drawn here too, as in every design.
* **Excel Refined** – the same tables drawn like Excel, **plus** text boxes, automated comments and the notes
  section.
* **Liquid Glass** – a light design: the table structure (header bands, boxes, rules, signals) is inferred from
  the workbook and redrawn as translucent glass cards, capsules and hairlines over a theme wallpaper; glass
  strength *Subtle / Medium / Strong*, background colour 0–100 %.
* **Per-design looks** (Design… › *Apply to: This design only / All designs*) and **per-design table sizing**
  (column widths, row heights, table size and position, alignment, *Same size*, *Reset layout*, fixed scales
  belong to the design they were made in).

**Text** – one toolbar (first ribbon row) formats whatever text is selected: cells, a text box, the title,
subtitle, cover note or date. *Text styles…* sets every text of a kind deck-wide (titles, subtitles, tables,
text boxes, contents, page numbers/footer). **Fonts**: Windows fonts, Google Fonts (downloaded once into the
shared folder) and uploaded font files (.ttf/.otf/.woff/.woff2).

**Cell editing (Excel-like)** – click/drag/Shift-select, type or F2 to edit, Enter/Tab, Del, Ctrl+B/I,
Ctrl+A, Ctrl+Z/Y (undoes **only your own** changes), Ctrl+S (save now), PgUp/PgDn (slides). Text
size/bold/italic/colour/alignment, role (how Liquid Glass draws the cell), **cell colour** (replaces the Excel
fill), **highlight** (a capsule in Liquid Glass), merge/unmerge, ↺ Excel value, *Excel size*, **format painter**
(also copies conditional formatting and colour scales).

**Tables** – drag column/row borders (double-click = Excel size) or type W/H; drag a table border to stretch,
the corner to scale, the grip to move next to/above/below another table; *⇔ Same size*; *Sizes…* across slides;
*Position ▾* (left/centre/right, top/middle/bottom); gridlines per direction; **colour scales** (deeper
green/red with the size of the number, per row/column/range).

**Text boxes** – above/below/left/right of a table, or beside all tables ("span"); movable anywhere with snapping
guides; stretchable; optional bubble; markup `# title`, `## heading`, `**bold**`, `[[+12,3]]` (green/red by
sign); line and paragraph spacing. The **notes section** (✎ Notes) is a text box of the slide itself.

**Automated comments** (✎ Comment…) – an analyst-style text written **live** from the table's numbers:
* *Summary* (default for new comments): one paragraph per block (sub-tables are detected), joining the
  comparisons found in the headers (week, Budget, month…), a judgement of the week ("Strong week" ≥ 1 %,
  "Solid week" ≥ 0.3 %…), the drivers and what offsets them.
* *Detailed* ("sections"): one section per comparison found in the headers.
* Amounts carry a unit ("+476 **mln**" by default). Editing a comment's text by hand turns it into fixed text.

**Versions** – top bar › *Version* shows the deck as any version; removed cells are drawn empty and comments
ignore them. Export ▾ › every version (this design, × Liquid Glass + Excel, or × all three designs) → one PDF
each, `<workbook> - <version> - <design>.pdf`.

**Deck options** (shared by everyone on the workbook) – design, glass strength, background colour, colour theme
(Aurora, Ocean, Forest, Sunset, Graphite, Intesa Sanpaolo, Custom), corners, contrast, logo, page numbers
(position, size, format, style, start), footer (`{date}`, `{workbook}`, `{title}`). *Use as default for new
decks*. *⚙ Options › Administration › Prepare rollback* (for giving decks back to Slide Builder 3, §2.4).

**Export** – PDF *text & tables* (vector, default), PDF *as pictures* (lossless PNG pages at 2×, "192 dpi",
file name "(images)"), current slide PDF, current/every slide PNG (4800 × 2700), *Copy current slide*, every
version. Written by the page itself (§10): nothing to install; from disk the files are downloads.
*Report a problem with this export…* writes a JSON report to `export\feedback\`.

**Working together** – changes are merged field by field; others' changes appear within about 1–2 s with
their name ("Updated by bob just now"); presence shows who else is in the workbook; typing is never
overwritten by others' changes; "✓ Saved" as soon as a change is on the share. The side panel shows the
deck's health ("Deck: snapshot N · M changes since in J journals").

---

## 2. Deployment and running it

### 2.1 The share
The drawing shows a share after the 4.0 cut-over (folder and version names are examples).
```
T:\Slide Builder\                          ROOT – the shared folder users see
├─ Start Slide Builder.bat                 starts the version in app\current.json (else helper\)
├─ Install Slide Builder.bat               first-time set-up on a PC (--install, §2.2)
├─ Update Slide Builder.bat                tools\update.py: updates, versions, migration, rollback (§2.3)
├─ Start Slide Builder (v3).bat            the newest 3.x in app\ on the same data, port 8785 (until PLAN S6.5)
├─ *.xlsx *.xlsm *.xlsb *.xls              users' workbooks (never written)
├─ export\                                 PDFs / PNGs; export\feedback\*.json problem reports
├─ app\current.json                        {"version", "previous", "at", "by"[, "held": true]}
├─ app\4.1.0\  app\4.0.0\  app\3.8.0\      program versions side by side, each with MANIFEST.json and
│                                          helper\ (4.x) or backend\ (3.x); the newest 3, the current and the
│                                          previous kept, and the newest 3.x while a 4.x is installed
├─ tools\update.py                         the updater (replaced by each release install)
├─ helper\                                 a program copy from a git/ZIP update (fallback when app\ has none)
└─ backend\                                the users' files, shared with Slide Builder 3 (never in git)
   ├─ logo*.*  slide_builder_settings*.txt logos, v2 settings (imported once)
   └─ data\                                ALL saved state – §4.1
      ├─ config.json  users\  fonts\ (+ fonts\system\)  assets\  locks\          unchanged since v3
      ├─ workbooks\*.json                  Slide Builder 3's documents (frozen once moved to v4)
      ├─ v4\decks\<key>\{snapshot.json, j\*.log, presence\, lock, moved-from-v3.json, incident-*.json}
      ├─ v4\pinned-v3.json  v4\storage.json   (optional) decks kept on 3.x · storage mode
      └─ backups\                          v3 copies, v4\<key>\<gen>.json, upgrades\, before-update-<time>\
```
There is no parsed-sheet cache on the share (PLAN S6.2 was not built). Every user runs **their own helper** on
their own PC. The helper listens on `http://127.0.0.1:8765/` (or the next free port up to 8784; if a Slide
Builder of the same major version already answers there, it just opens the app) and serves the app page with a
random per-start token injected. The helpers never talk to each other: **the shared folder is the only
channel**, coordinated with append-only journals and lock files (§9).

A version in `app\<ver>\helper\` uses the main folder's workbooks, `export\` and `backend\data\`
(`paths.INSTALL_HOME`, recognised by the `app\<ver>\MANIFEST.json` next to it).

### 2.2 Who does what
| Who | What |
|---|---|
| User, first time on a PC | `Install Slide Builder.bat` → `slide_builder.py --install`, 5 steps: **Python** ≥ 3.8; **shared folder** (lock file, write in `export\`, the median of 20 create/stat/replace/delete round trips – WARN above 30 ms); **journal** (a file in `data\locks` appended to twice with `fsync`, read back, removed; required); **desktop shortcut** (`.lnk` through PowerShell, or a `.bat` when PowerShell is blocked; optional); **self-test** (start a helper on a free port, ping it, stop it). Any FAIL exits 1. Nothing is downloaded; no admin rights; idempotent. Code: `helper/slidebuilder/firstrun.py`. |
| User, daily | `Start Slide Builder.bat` (or the shortcut). It finds Python (`py -3`, else `python`), starts `slide_builder.py` of `app\current.json`'s version (else `helper\`, else `backend\`). Keep the console window open. The app opens in an Edge app window (`msedge --app=<url>`); a normal browser tab when Edge is missing or `SLIDEBUILDER_APP_WINDOW=0`. |
| One person, to update everyone | `Update Slide Builder.bat` (§2.3, §7.5). Everybody then restarts Slide Builder and reloads the page. |
| Maintainer, rollback of a deck | §2.4 and `docs/next/cutover.md` §3. |
| Developer | §11. Users never need Node.js: the built `helper/slide_builder.html` is committed. |

### 2.3 Upgrading
* **A new release** (normal case): `Update Slide Builder.bat`. In a folder with `app\current.json` a plain run
  means `--release latest`: the release ZIP is downloaded from GitHub, checked (GitHub's asset digest when given,
  always its `MANIFEST.json`), extracted to `app\<ver>.part\`, renamed to `app\<ver>\`, its `--selftest` must pass,
  then `app\current.json` is replaced atomically. `--release X.Y.Z` picks a version, `--zip file.zip` installs a
  downloaded ZIP offline, `--use X.Y.Z` switches back (and marks the folder "held": a plain update then refuses to
  undo the rollback). A release install also replaces `Start Slide Builder.bat`, `Install Slide Builder.bat` and
  `tools\update.py`, and adds `Update Slide Builder.bat` and `Start Slide Builder (v3).bat` when missing.
* **From 3.8 to 4.x** (done on 2026-10-15): 3.8's updater refuses a 4.x ZIP; the switch is run once with 4.0's own
  updater, as `docs/next/cutover.md` describes. Decks then move to v4 one by one on their first open in 4.x (or
  all at once with `--migrate-all`); the 3.x file is backed up and frozen (§4.5).
* **Saved formats**: a file in an older format is upgraded on read, with a backup (§4.4). An updated PC never
  rewrites a file a newer version wrote.
* **From v2**: if `backend\slide_builder_settings.txt` exists, the first helper imports it once (presets, cell
  edits, style → shared defaults, last file → preferences) and renames it `slide_builder_settings.v2-backup.txt`
  (`migrate.py`).

### 2.4 Giving decks back to Slide Builder 3
Until the v3 start file is removed (PLAN S6.5), a deck can go back: someone runs *⚙ Options › Administration ›
Prepare rollback* (every deck saved and compacted), everybody closes the deck, the maintainer runs
`Update Slide Builder.bat --rollback "<workbook>"` (or without a name: every deck), and the people on that deck
use `Start Slide Builder (v3).bat`. A rollback is refused while the deck is open (presence) or has records past
its snapshot. A deck listed in `backend\data\v4\pinned-v3.json` stays with 3.x. `--use 3.8.0` gives every deck
back first. Details and who decides: `docs/next/cutover.md` §3.

---

## 3. Architecture

### 3.1 The app window
```
┌─ Slide Builder ─ (Edge app window: no tabs, no address bar) ──────────────────────────────────────────────────────┐
│ Slide Builder [Open ▾][↻][✦ Wizard] IBD weekly.xlsx · 20 slides  Version[Full deck ▾] (AN) anna is also here        │
│              [Liquid Glass|Excel|Excel Refined] [◐ Design…] [Subtle|Medium|Strong] Colour ▮▮▮▯ 35% [⚙ Options] [Export PDF|▾]│
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ↶ ↷ │ Font ▾  A− [11] A+  B  I  A▾ │ align │ Line spacing ▾ │ Clear format │ 🖌 Format │ Aa Text styles… │ ribbon 1: TEXT
│ Cells W[ 64 ] H[ 21 ] Excel size │ Role ▾ Unmerge Merge Colour scale ▾ │ ⇔ Same size Position ▾ Gridlines ▾  │ ribbon 2: LAYOUT
│   Sizes… Reset layout │ Text box ↑↓←→ ◯ ✎ Comment… ⤺ Attach 🗑 │ ✎ Notes │ Logo │ Subtitles                    │
│ [SLIDE_1!C7 ] fx [ Totale                                         ] Enter ↵ apply · Esc cancel  ↺ Excel value   │ formula bar
├──────────────┬──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ SLIDES 20    │   ┌───────────── the slide: SVG layers from the display list, 1600 × 900 slide px ───────────┐   │
│ ┌──────────┐ │   │  Total Banks Loans & Deposits                                                          │   │
│ │1 cover   │ │   │  ╭──────── table layer (div.tw > svg) ────────╮  ╭── text box layer (auto comment) ──╮ │   │
│ ├──────────┤ │   │  │ ▒▒ Week37 Week38 … Δ vs Budget Abs. %  ▒▒ │  │ **Loans**: +476 w/w · Solid week… │ │   │
│ │2 index   │ │   │  │ TOTAL BANKS LOANS   76.777 … (+192)        │  ╰───────────────────────────────────╯ │   │
│ ├──────────┤ │   │  ╰─────────────────────────────────────────────╯                                        │   │
│ │3 ▸       │ │   │  furniture layers: background, title, page number, footer, logo, notes section        │   │
│ └──────────┘ │   └──────────────────────────────────────────────────────────────────────────────────────────┘   │
│ thumbnails:  │     React overlays above the SVG: text layer, hit areas (.hits), handles (.hbox), selection,   │
│ one row per  │     guides, inline editors                                                [−] 100% [+] [Fit]  │
│ slide, a     │                                                                                                  │
│ picture only │                                                                                                  │
│ near the view│                                                                                                  │
│ Slide 3 · …  │ ← issues of the current slide (missing tables, hidden rows, stale text edits, font builds)      │
│ Deck: snapshot 12 · 40 changes since in 3 journals                                                             │
├──────────────┴──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Cell C7 · Arrows move · Shift extends · type or F2 to edit · Del clears · Ctrl+B/I · Ctrl+Z/Y · PgUp/PgDn slides  │
│                                                                      Updated by bob just now        ✓ Saved     │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
  dialogs: ✦ Wizard (4 steps) · Design… (colours / text styles / fonts) · ✎ Comment… · Sizes… · confirmations
  menus:   Open ▾ (workbooks in the folder, Browse…) · ⚙ Options (page numbers, footer, logo, look, Administration)
           · Export ▾ (PDF, pictures, PNG, copy, versions, Report a problem…)
  banners: "Opened directly from disk…" (file://) · "The workbook was saved again in Excel. [Reload now]"
  pill:    "Helper not running" / "Helper stopped" (only when there is a problem)
```
The glass segment and the Colour slider appear only in Liquid Glass. The top bar is `ui/Topbar.tsx`, the ribbons
`ui/Ribbon.tsx` and `ui/TableTools.tsx`, the panels and status bar `ui/Chrome.tsx`, the layout `ui/App.tsx`.

### 3.2 Processes and who owns what
```
                ┌─────────────────────────── Edge app window (one per user) ─────────────────────────────┐
 keyboard/mouse►│ PAGE (UI thread) — React 19 app                                                          │
                │  components (top bar, ribbons, slide list, dialogs, wizard, stage overlays)             │
                │    ▲ selectors                                                                          │
                │  ONE Zustand store: doc (read-only mirror of the view, save state) · deck (read-only    │
                │  workbook mirror of sheet slices, slides, history) · selection · ui · prefs             │
                │  drags: preview with core's computeLayout per animation frame, ONE op on pointer-up     │
                │  sync/api.ts: the helper's HTTP API with the token (or localStorage from file://)       │
                │    │ ops, undo, requests          ▲ doc snapshots, slices, stage layers (SVG pieces)    │
                │    ▼                              │      ▲ deck calls, font files, measuring, pictures   │
                │  CORE WORKER (Blob URL; owns the open workbook, the deck document and undo/redo)        │
                │   DocSync v4: snapshot + journals + pending ops → view · history (inverse ops)          │
                │   SheetStore (columnar; .xlsx XML scanner, .xlsb BIFF12 reader) · presets → TableLayout  │
                │   → effective items → display lists (Excel, Liquid Glass, slide furniture) · computeLayout│
                │   HarfBuzz measuring from font files · automated comments · stage layers as SVG          │
                │    │ display lists on a MessageChannel per export worker (never through the page)       │
                │    ▼                                                                                    │
                │  EXPORT WORKERS (same script, name "sb-export"; on demand, 0–3, stopped after 60 s idle) │
                │   display list → PDF writer (HarfBuzz shaping, hb-subset) · → PNG / pictures /           │
                │   thumbnails (OffscreenCanvas → PNG bytes or ImageBitmap) → back to the page            │
                └────┼──────────────────────────────────────────────────────────────────────────────────┘
                     │ HTTP on 127.0.0.1 only: X-SB-Token, X-SB-Formats (PDF/PNG bytes, records, reads)
                ┌────▼──────────────────────────────────────────────────────────────────────────────────┐
                │ HELPER — python slide_builder.py (Python ≥ 3.8, standard library only), one per PC      │
                │  page + token · decks (append + fsync, tail, snapshot CAS, compact, rotate, presence) · │
                │  workbook bytes (stable read) · config/prefs · fonts (+ this PC's fonts, capture) ·    │
                │  export save · Excel COM / GDI+ conversion · v2/v3 migration · --install · --selftest  │
                └────┬──────────────────────────────────────────────────────────────────────────────────┘
                     │ SMB — the only channel between PCs
                ┌────▼──────────────────────────────────────────────────────────────────────────────────┐
                │ T:\Slide Builder\  workbooks · export\ · app\<ver>\ · app\current.json · backend\data\  │
                └───────────────────────────────────────────────────────────────────────────────────────┘
```
The workers never call the helper themselves: the core worker asks the page for every deck call (`deckSnapshot`,
`deckTail`, `deckAppend`, `deckCompact`, `deckRotate`, `deckPrepare`) and font file, and the export workers hand
their bytes back to the page, which saves them (`POST /api/export-file`) or downloads them.

**One owner per kind of state.**

| State | Owner | Everyone else gets | Changes only through |
|---|---|---|---|
| Deck document (confirmed, in flight, pending → view), undo/redo stack | **core worker** (`DocSync`, `History`) | the page: a read-only `doc.view` mirror after each change (it shows its own ops at once, predicted with the core's `applyOps`) and a history summary | operations (`apply`, `undo`; `core/src/model/ops.ts`) |
| Workbook cells, styles, drawings | **core worker** (`SheetStore`) | the page: read-only **slices** of the sheets the deck uses (`deck.wb`, `xlsx/mirror.ts`); the wizard and formula bar: summaries and windows of cells on request | opening or reloading the workbook |
| Display lists | **core worker** | the stage: layers as SVG markup in pieces, keyed by content; export workers: whole lists on their own channel; thumbnails: `ImageBitmap`s keyed by content | being rebuilt from document + workbook |
| Selection, current slide, zoom, dialogs, toasts, busy, painter, presence | **page store** (`state/store.ts`) | components via selectors | `patch`/`patchAll` from the module functions in `state/app.ts` and `editor/` |
| Personal preferences | **page store** (`prefs`) | – | `setPrefs` → `PUT /api/me` (debounced 400 ms) |
| Files on the share | **helper** | bytes and records over HTTP | helper endpoints only |

### 3.3 Design principles
1. **All parsing, layout and rendering happen in the browser, off the UI thread.** The helper moves bytes,
   appends opaque records to journals, keeps snapshots and saves exports. The stage, the thumbnails and every
   export draw **the same display list** of a slide (ADR-004).
2. **Documents change only through operations** (`preset.set`, `slide.patch`, `table.patch`, `cell.patch`,
   `style.patch`) with field-level merge semantics, implemented once in TypeScript (`core/src/model/ops.ts`) and
   pinned by `shared/ops-vectors.json`. Clients never write whole documents; the helper never applies an
   operation.
3. **Optimistic local application, one journal per writer.** A page applies its ops at once and appends them in
   batches, one record each, to its own journal of the deck (no lock on the edit path); every page folds the
   snapshot and the records past it in Lamport order and rebases its pending ops on the result (ADR-006).
4. **The workbook is never modified**; user changes are keyed by sheet and cell address.
5. **No runtime dependencies on users' PCs**: one HTML file (React, the workers and HarfBuzz's WASM inlined) +
   standard-library Python; nothing downloaded at install.
6. **Never lose data**: fsync'd appends, atomic writes, unreadable files are never replaced by empty ones,
   unsent records are kept and sent again, every format change is a versioned upgrade with a backup.

**Why not a server app?** There is no server: no admin rights, no hosting, only a shared drive. A local helper
per PC plus files on the share is the only deployable topology (ADR-001, `docs/v3/REVIEW.md` §6).

---

## 4. Data model

### 4.1 What is saved where (`backend\data\`, never in git)
```
data/
├─ config.json                     shared defaults for new decks         {schema:3, rev, updated, updatedBy, defaults:{style}}
├─ v4/decks/<key>/                 ONE deck per workbook (storage v4)
│  ├─ snapshot.json                {format:4, gen, workbook, lamport, rev, frontier:{journal:offset}, seen:{writer:seq},
│  │                                by, at, updated?, updatedBy?, log?, doc (§4.2)}
│  ├─ j/<writer>.log, j/<writer>~<n>.log   one append-only journal per page session (writer = <user>@<host>#<8 base32>)
│  ├─ j/shared~<n>.log             the one shared journal in lean-lock mode (§9)
│  ├─ presence/<user>@<host>#<client>   empty files; their mtime is the heartbeat
│  ├─ lock                         compaction / migration lock
│  ├─ incident-<journal>-<offset>.json  a corrupt frame: the deck is read-only until the maintainer looks
│  ├─ incident-format-5.json       the deck holds Slide Builder 4.6 objects (ADR-019): read-only in 4.0–4.5 only
│  ├─ moved-from-v3.json · rolled-back.json   written by the migration / a rollback
├─ v4/deleted/<key>~<ms>/          a deleted setup (B44, deckbin.py): deck/ (the deck's folder as it was), backups/,
│                                  v3.json (its frozen v3 file), deleted.json {workbook, gen, slides, tables, by, at};
│                                  the workbook gets an empty deck (gen + 1, its own v4/decks/<key>/born file);
│                                  ⚙ Options › Administration › Saved setups restores it
├─ v4/pinned-v3.json · v4/storage.json   decks kept on 3.x · {"storage": "lean-lock"}  (both optional)
├─ workbooks/<key>.json            Slide Builder 3's documents: frozen (schema 4, movedTo "v4") once moved, read only
├─ users/<user>.json               personal preferences                  {schema:1, lastFile, pdfMode, zoom, versions…}
├─ fonts/fonts.json + font files   shared font library                   {schema:1, fonts:[…]}
├─ fonts/system/                   fingerprints.json (Windows font builds per PC), licence.json (copy mode)
├─ assets/                         logos uploaded via ⚙ Options › Logo
├─ locks/<name>.lock               lock files (short-lived)
├─ migrated.json                   marker: v2 settings were imported
├─ app-version.json                installed commit (git-less ZIP updates only)
└─ backups/
   ├─ v4/<key>/<gen>.json          each compaction's snapshot (last 30)
   ├─ <key>/<rev>.json             Slide Builder 3's rolling copies (kept, read only)
   ├─ upgrades/<kind>/<file>.v<n>.<time>.json   a file before a format upgrade or the v3 → v4 move
   └─ before-update-<time>/        saved setups (+ replaced program files) before each git/ZIP update (last 5)
```
`<key>` = workbook file name with `[^A-Za-z0-9._-]` → `_` (max 60 chars) + `-` + the first 10 hex chars of
`sha1(name.lower())` (`util.doc_key`). Lower-casing matches Windows' case-insensitive names.

**Journal frames**: `<decimal length>:<crc32, 8 hex>:<json>\n`. A record is `{l, w, s, by, at, ops}`: `l` the
Lamport time, `w` the writer, `s` its sequence number (1, 2, …), `by` the author shown to people, `at` the file
server's time stamped by the helper, `ops` the operations. The helper reads only the envelope (`w`, `s`, `l`); the
operations are opaque to it. The full contract (torn tails, rotation, who deletes journals, compaction) is in
`docs/ARCHITECTURE.md` §4–§6 and the header of `helper/slidebuilder/decks.py`.

### 4.2 The workbook document (`snapshot.doc`)
```jsonc
{
  "schema": 3, "workbook": "IBD weekly.xlsx",
  "rev": 42,                         // derived by the fold: the snapshot's rev + 1 per record folded
  "updated": 1791214363000,          // ms, file-server clock (the last record's `at`)
  "updatedBy": "rossim", "log": [{"rev": 42, "by": "rossim", "at": …}],   // last 20, derived by the fold
  "preset": {                        // null = no setup yet (the wizard creates one)
    "sheets": ["SLIDE_1", …],
    "tables": [ {"id": "k3j9x0a", "sheet": "SLIDE_1", "kind": "markers", "anchor": "C3", "index": 0,
                 "name"?, "cols"?, "rows"?, "sizes"?: {"glass"|"excel"|"clean": {cols?, rows?}},
                 "scales"?, "merges"?, "gridH"?, "gridV"?,
                 "cellGrid"?: {"C7": {h?, v?, o?, c?, w?}},            // 4.4: gridlines on selected cells
                 "borders"?: {"C7": {"bottom": {style, color} | "none", …}}},   // 4.4: cell borders set on the slide
                {"id": "p0q8z1b", "sheet": "Detail", "kind": "range", "range": "A2:K20", "grow": true} ],
    "slides": [ {"id": "c1", "type": "cover", "title": "IBD Weekly", "date": null, "note": "…", "tables": []},
                {"id": "i1", "type": "index", "subs"?: false, "tables": []},
                {"id": "s1", "type": "content", "tables": ["k3j9x0a"], "logo"?: false,
                 "layout"?, "scale"?, "align"?, "valign"?,            // shared sizing of older decks
                 "sizes"?: {"glass"|"excel"|"clean": {layout?, scale?, align?, valign?}},
                 "notes"?: {"k3j9x0a:right": Note, "slide:notes": Note},
                 "fmt"?: {"title"|"subtitle"|"note"|"date": TextFmt},
                 "items"?: {"c1": Item},                            // 4.3: charts and callouts (item.patch only)
                 "free"?: {"glass"|"excel"|…: FreeLayout}} ],         // 4.4: free layout per design
    "versions"?: [{"id": "v1", "name": "All", "hide": {"SLIDE_1": ["H10:I11"]}}],
    "links"?: ["Peers.xlsx"]        // 4.2: linked workbooks of the folder; their sheets are named "[Peers.xlsx]Peer" wherever a sheet name is stored
  },
  "style": { "design": "glass", "glass": "subtle", "color": 35, "logo": "logo.png", "radius": 100,
             "contrast": 50, "logoBubble"?: false, "pn": {…}, "footer": {…}, "theme": {…},
             "text": {"title": TextFmt, …}, "colors": {"accent": "#…", …},
             "designs": {"clean": {"theme"?, "colors"?, "text"?}} },     // partial: inherits config defaults
  "edits": { "SLIDE_1": { "C7": {"orig": "TOTAL", "text": "Totale", "font"?, "sz"?, "b"?, "i"?, "color"?,
                                 "fill"?, "bg"?, "cf"?, "align"?, "role"?} } }
}
```
* `Layout = {bands: number[][], w: number[]}` – rows ("bands") of table indices and a weight per table.
* `Note = {text, font?, size?, lh?, pgap?, b?, i?, align?, valign?, color?, w?, h?, bubble?, x?, y?, span?,
  auto?: CommentCfg}`. Keys are `"<tableId>:<top|bottom|left|right>"`; `"slide:notes"` is the notes section.
  `x/y` = moved freely (takes no room from the tables); `span` = a column beside all tables; `auto` = an
  automated comment whose text is computed at render time.
* `Item` (4.3, B16/B17, 07 §2.2) = a **chart** `{kind: "chart", type: "pie"|"donut"|"bar"|"column"|"line" (pie / donut drawn from 4.3, the others reserved), values: DataRef, labels?: DataRef,
  series?, title? ("" = none, unset = the series name), legend?: "right"|"bottom"|"none", show?: ["label"|"value"|
  "percent"], colors?: {"<slice index>": "#hex"}, startAngle?, fmt?: TextFmt, box, attach?: {table, side}}` or a
  **callout** `{kind: "shape", shape: "rect"|"round"|"circle"|"pill"|"arrow"|"bubble"|"icon", icon?, text? (may quote
  cells: "{Sheet!C7}", "{[Peers.xlsx]Peer!F7}"), fill? ("none" = no fill, unset = the design's material), border?:
  {color, w, dash?}, radius?, fmt?: TextFmt & {valign?, pad?}, tail?: {x, y}, box, attach?}`. `DataRef` = `{sheet, range}`
  (a sheet id and one A1 rectangle) or `{table, range}` (a table of the deck and a range in its sheet); `box` =
  `{x, y, w, h}` in slide px. A 4.0 / 4.1 page keeps `items` (it ignores the key) and skips `item.patch`.
* `FreeLayout` (4.4, B18, 07 §5.1, ADR-017) = `{on, items: {"t:<tableId>"|"n:<noteKey>"|"i:<itemId>": {x, y, w, h,
  scale?}}}` per design: with `on` the slide's tables, text boxes and items sit at these boxes (a table drawn at its
  saved `scale`, its box following from it; without one, `w` / its width), nothing re-flows; what has no box (added
  after the switch-on) sits where the automatic layout puts it beside its table. `on: false` keeps the boxes. The
  notes section (`"slide:notes"`) keeps its own `x/y`. A 4.0 / 4.1 page keeps `free` and draws the automatic layout.
* `CellEdit`: `text` + `orig` (the Excel text it replaced – a text edit applies only while the Excel value is still
  `orig`), `bg` = cell colour (`"none"` removes the Excel fill), `fill` = highlight, `cf = "Sheet!C6"` =
  conditional formatting painted from another cell (`"none"` removes the cell's own).
* **Effective style** = built-ins ← `config.defaults.style` ← `doc.style`, then each layer's
  `designs[<current design>]` on top (`model/style.ts resolveStyle`).
* **Effective sizing** of a slide/table in a design = its own `sizes[design]` entry if present, else the shared
  `layout/scale/align/valign` or `cols/rows` of older decks (`render/layout.ts sizingOf`, `model/preset.ts
  tableSizes`).
* The full field table is in `docs/ARCHITECTURE.md` §2.3; the TypeScript types are `core/src/model/types.ts`.

### 4.3 Operations
| op | fields | plain keys (`null` deletes, else set) | map keys (map merge) |
|---|---|---|---|
| `preset.set` | `preset` | replaces `doc.preset` (wizard; `null` allowed) | – |
| `slide.patch` | `id`, `patch` | title, subtitle, date, note, logo, layout, align, scale, valign, subs | notes, fmt, sizes, free (4.4: an entry per design, replaced whole) |
| `table.patch` | `id`, `patch` | name, gridH, gridV | cols, rows, scales, merges, sizes, cellGrid, borders (4.4: per cell) |
| `cell.patch` | `sheet`, `ref` (A1), `patch` | text, orig, font, sz, b, i, color, fill, bg, cf, align, role | – |
| `style.patch` | `patch` | design, glass, color, logo, radius, contrast, logoBubble | pn, footer, theme, text, colors, designs |
| `item.patch` (4.3) | `slide`, `id`, `patch` | on `slides[slide].items[id]`: kind, type, values, labels, series, title, legend, show, startAngle, box, attach, shape, icon, text, fill, border, radius, tail; `patch: null` deletes the item | colors, fmt |

**Map merge**: `null` deletes the whole map; an object sets each entry (replacing the entry whole, no deep
merge) or deletes it when `null`; an empty map is removed. So two people changing different columns, text
boxes, rules or designs never overwrite each other; the same field at the same time → the later record in
Lamport order wins. Unknown ops, invalid fields, unknown slide/table ids are **skipped**. `item.patch` creates the
item when the id is missing and the patch has a `kind` (`chart`/`shape`) and a `box`; an unknown `kind`, a box that is
not four finite numbers with `w`, `h` > 0, or `box: null` skip the op – so two people moving and recolouring one chart
both win, field by field. Removing a cell's
`text` also removes its `orig`. The page computes an **inverse** op for each op before applying it
(`ops.ts inverseOf`) – that is the undo.

For `config.json` the page applies `style.patch` to `defaults.style` with the core's operations and the helper
stores the result by compare-and-set on `rev` under lock `config` (`POST /api/config {baseRev, style}`; a
conflict → 409 with the current document, retried by the page).

### 4.4 Format versions (`schema`)
Current formats: `SCHEMA = {workbook: 3, config: 3, prefs: 1}` (`helper/slidebuilder/upgrade.py`) = `FORMATS`
(`core/src/model/types.ts`; a helper test checks they match). The deck files have their own `format`: 4, or 5 once
the deck holds objects 4.0 does not know (charts, callouts, free layout, looks, cell gridlines or borders and every
later addition). A 4.6 page raises a deck to 5 before it writes such an object (marker `incident-format-5.json`, a
23 s wait, then the snapshot again at format 5; ARCHITECTURE §6.5, ADR-019): 4.0–4.5 then show it read-only
("a journal of this deck is damaged" – it means "update Slide Builder"), and it never goes back to 4.
* **older file** → under its lock: re-read, copy to `backups/upgrades/…`, apply `@step(kind, n)` functions
  n → n+1 in order, write atomically (no step is defined yet). `store.upgrade_all()` runs at every start-up.
* **newer file** (written by an already-updated PC) → never changed; HTTP 409 "restart Slide Builder".
* Pages send `X-SB-Formats: workbook=3;config=3;prefs=1` with every request; a POST/PUT/DELETE whose formats
  differ from the helper's → 409 → the page shows "Slide Builder was updated – reload the page (F5)" and stops
  writing (its pending ops stay queued).
* Optional new fields need **no** format change (readers ignore unknown keys; missing = default).
  `helper/tests/fixtures/saved/` keeps a real example of every released format (`config.v3.json`,
  `workbook.v3.json`, `prefs.unnumbered.json`, `snapshot.v4.json`, `journal.v4.log`, `snapshot.v5.json`,
  `journal.v5.log`, `incident-format-5.json`); never edit them.

### 4.5 Slide Builder 3 documents and the move to v4
On a deck's first open in 4.x (`POST /api/decks/open`), `migrate_v3.py` – under v3's lock `wb-<key>` and then the
deck lock – backs the v3 file up byte for byte, **freezes** it (`schema 4`, `movedTo "v4"`, `movedGen`; Slide
Builder 3 then refuses that deck with "Slide Builder was updated"), writes the snapshot (gen 1; after a rollback the old gen + 1) and
`moved-from-v3.json`. A half-done step is finished by the next try. New decks get a frozen stub. A rollback
(§2.4) writes `rolled-back.json` first, waits 14 s, checks the frontier again, and gives the document back to v3.

---

## 5. Front end (`core/src` and `app/src`)

TypeScript. Runtime dependencies (exact versions): `react` and `react-dom` 19.2.8, `zustand` 5.0.15 (app) and
`fflate` 0.8.2 (core). HarfBuzz (`harfbuzzjs` 0.4.12) is vendored as WASM inside `core/src/text/wasm/`.
`core/` is pure TypeScript with no DOM (`lib: ES2022 + WebWorker`): it runs in the workers and, for the pure
functions, on the page too. What the core needs from its host goes through `core/src/platform.ts`
(`TextMeasurer`, `CanvasFactory`, the XML hook for one test); the page's implementations are
`app/src/platform/index.ts`. XML is read by the core's own tokenizer (`core/src/xlsx/xml.ts`).

Vite + `vite-plugin-singlefile` build `app/` into **one file**, `helper/slide_builder.html` (target es2022). A
small plugin in `app/vite.config.ts` bundles `core/src/workers/main.ts` with esbuild into a string that the
page starts from a Blob URL – as the core worker, or, under the name `sb-export`, as an export worker (one
script, so HarfBuzz is in the page once). `main.tsx` installs the platform, injects `ui.css` + `app.css` as
`<style id="uicss">`, mounts `<App/>` (StrictMode only in development), installs the keyboard and calls `boot()`.

### 5.1 `core/src/xlsx/` – reading workbooks
| File | Responsibility |
|---|---|
| `workbook.ts` | `indexWorkbook(buf)`: sniff (`D0CF11E0` → `ENCRYPTED` when it holds an EncryptedPackage stream, else `CFB` = old .xls or protected; not a zip → `NOTZIP`), the zip's directory (`zip.ts`), the workbook part from `_rels/.rels` (`workbook.xml` or, for .xlsb, `workbook.bin`), sheet list (hidden and chart sheets skipped), `big` when > 12 MB of sheet data or > 6 MB of file. `wb.ensure(names)` reads sheets on demand: shared parts once (theme, shared strings with rich runs, styles, number formats, `cellXfs`, `dxfs`; Excel's max digit width), then each sheet into a columnar store, then merges, conditional formats, columns, drawings, `findRegions`. A long read yields at most every 200 ms (`pacer`). `makeSheet` adds geometry over the columns (`colPx` = Excel's width formula, `rowPx` = pt × 96/72, cumulative offsets, `cellAt`). |
| `sheetstore.ts` | The **byte scanner** over `sheetData` into typed-array columns (column, kind, xf, number or string index: 13 bytes a cell); `cells`/`rowInfo` are read-only map views and a v3 `Cell` object is made on request, so the rest of the code is unchanged. Since 4.2 (S7.1) it also keeps each cell's **formula** as A1 text (`<f>`; a shared formula's children get the master's text shifted to their cell – `calc/refs.ts shiftFormula` –, an array formula its range), interned per sheet and read through `Sheet.formula(r, c)` / `arrayRef(r, c)`; slices sent to the page carry none. |
| `xlsb/` (4.1) | The **native .xlsb reader** (MS-XLSB BIFF12): `records.ts` (record type and size as 7-bit varints), `workbook.ts` (`workbook.bin`: sheets, hidden state, relationship ids), `styles.ts` (`styles.bin`: number formats, fonts, fills, borders, cell and differential formats mapped to what the .xlsx reader makes of `styles.xml`), `strings.ts` (`sharedStrings.bin` and rich cell strings with super/subscripts; a line feed becomes CR LF as in Excel's XML), `sheet.ts` (`sheetN.bin` into the same columns as the scanner, short cell records included, plus sheet format – default column width 8.43 unless the sheet sets one, as the .xlsx reader –, columns, merges, conditional formats; a record cut short is skipped, not the sheet; resumable in budgets of 20 000 records), `formula.ts` (conditional-format formulas decompiled back to A1 text; a formula it cannot decompile is kept as `#NAME?`, so the rule never matches; since 4.2 also **cell formulas**: `BrtFmla*` records, shared formulas – `BrtShrFmla`, found by the range that holds the cell – and array formulas, references to other sheets and to linked workbooks through the XTI table and the external link parts' sheet names, defined names, and the function table incl. the Excel 2007+ / Analysis ToolPak ids learnt from Excel's own files; a formula it cannot decompile leaves the cell with its cached value and is counted in `Sheet.unreadableFormulas`). Relationships, the theme and drawings stay XML and use the normal readers. `core/tests/xlsb.test.ts` reads every corpus workbook saved by Excel both ways and requires identical cells and identical slides in all designs; `core/tests/formulas.test.ts` requires every formula of `tests/corpus/workbooks/recalc/` (and of its `.xlsb` twins) to equal Excel's own `Range.Formula` text. |
| `zip.ts`, `xml.ts`, `strings.ts` | .xlsx container with fflate (parts inflated on demand, in one call) · the XML tokenizer and small tree with DOM semantics · text decoding (entities, `_xHHHH_`, rich runs). |
| `layout.ts` | `findRegions(S)`: pairs "x" markers. `buildLayout(S, g, sizes)` → **`TableLayout`**: visible rows/cols, geometry with user sizes, one `Item` per cell or merged block (workbook merges − user splits + user merges), borders, fonts, fills, number-format text and colour, alignment, overflow, conditional formatting (`evalCF`), pictures/shapes/text boxes. |
| `numfmt.ts` | Excel number formats → text (sections, colours, locale tags, %, fractions, exponents, thousands scaling, dates/times). "." thousands, "," decimals. |
| `drawing.ts` | Anchors, groups, crop, rotation/flip, SVG preferred, EMF/WMF/TIFF via the helper, shapes and text boxes, charts listed. `analyzeImages` (round badges, keyed transparency) for Liquid Glass – done by the page (a worker cannot decode SVG). |
| `color.ts`, `types.ts`, `util.ts` | Excel colours (theme, indexed, tint) and colour maths · reader types · A1 helpers, `pacer`, `hashStr`, `uid`. |
| `slice.ts`, `mirror.ts` | Sheet slices sent to the page (whole when small, else the rectangle the deck's tables, grown ranges and conditional-format operands need) · the page's read-only `MirrorWorkbook` built from them. |
| `sheetview.ts`, `detect.ts` | What the wizard and formula bar read, computed in the worker (sheet summary, a window of cells, one cell, table sizes) · table suggestions from the columns. |

### 5.2 `core/src/model/` – persistent data and pure logic
| File | Responsibility |
|---|---|
| `types.ts` | **All persistent types** (§4) + `FORMATS`, `Op`, and the runtime `RuntimeSlide`. |
| `ops.ts` | `applyOp/applyOps` (§4.3), `inverseOf`, `emptyDoc`. The only implementation of the semantics. |
| `fold.ts` | `fold(snapshot, records)`: records sorted by (Lamport, writer, seq), one copy per (writer, seq), records the snapshot already holds (`seen`) skipped; `rev`, `updated`, `updatedBy`, `log` (20) derived; `nextSnapshot`. |
| `preset.ts` | `resolveTable` (marker or range table → `TableLayout` in a design, cached in `LCACHE`), `tableSizes`, `runtimeSlides` (titles fall back to the sheet's A1, subtitles to A2), `defaultPreset` (one slide per sheet named "*slide*" with marker tables), growing ranges. |
| `style.ts` | Built-in style, `resolveStyle(...layers)`, themes (`THEMES`, `themeOf`), `palette`, `COLOR_KEYS` (what Design… offers per design). |
| `comment.ts` | Automated comments over a `Grid` of displayed cells: `analyse` (label column, data rows, headers, comparison groups week/target/month/quarter/year/yoy, totals, blocks), `writeSummary`, `writeComment`, `shapeComment` (unit, default "mln"). |
| `fonts.ts` | Font catalogue (Windows, popular Google fonts), `@font-face` generation, `readFontInfo` (family/weight/italic from `name`/`OS/2`), Google CSS parsing. |

### 5.3 `core/src/render/`, `dl/`, `text/`, `pdf/`, `pptx/` – from layouts to display lists and files
| File | Responsibility |
|---|---|
| `render/chart-dl.ts` (4.3) | **Charts** (B16, 07 §3, ADR-015): `chartData` (a `DataRef` read through `ctx.sheet()` like the tables – numbers only; blank, text, hidden and version-removed cells skipped; labels from the item's range or the headers beside the values; cached per sheet object, so a reload or a scenario's view reads again), `chartNodes` (slices as cubic-Bézier `path`s, inside labels or outside with a leader, legend, title, the design's palette or `colors[i]`, Liquid Glass's glass card, Excel Refined's plain card; `hit` nodes `item` and `slice`; a missing / empty source draws a placeholder on the stage and gives the Issues line), `chartKey`, `sliceAt` (the stage's slice picking). Items attached to a table side are laid out by `computeLayout` (`TBox.items`, `itemBoxOf`). |
| `render/shape-dl.ts`, `icons.ts` (4.3) | **Callouts** (B17, 07 §3): rect / round / pill / circle (`rect` with radii; a circle in a box that is not square is an ellipse `path`), arrow and bubble (`path`; the bubble's tail leaves the edge facing its tip), 17 built-in icons (M/L/C/Z outlines on a 24-unit grid, even-odd); the design's material when no fill is set (Liquid Glass's glass card, Excel's framed box, Excel Refined's card and shadow, the consulting card; a consulting circle is an accent outline); `calloutText` replaces `{Sheet!C7}`, `{'Sheet name'!C7}`, `{[Peers.xlsx]Peer!F7}` with the cell's text as the workbook shows it (number format, cell edit, a scenario's view) – `#REF` and the Issues line when it cannot be read. The text is laid out by the text-box renderer (`slide-dl.ts noteNodes`). |
| `render/context.ts` | `RenderCtx = {style, edits, slides, preset, workbook, logoSrc, sheet?, version?, forExport?}` and `tableKey` (the cache key of a table's drawing). |
| `render/edits.ts` | `effItems(L, ctx)`: the workbook items with the user's changes – version blanking, gridlines, colour scales, painted conditional formats, cell edits (text only while `orig` matches), cell colour vs highlight, roles; then `withBorders` (4.4, B28: the borders set on the slide over the workbook's, `Item.ub`) and `withCellGrid` (B20: the cells' own gridlines as `Item.cgrid` edges, each shared edge once, `Item.cgx` = the edges a border covers in Excel / Excel Refined), which `excel-dl.ts cellGridNodes` (Excel, Excel Refined, the consulting rules tables), Liquid Glass's plan and the consulting cards (`GLine` "cell") draw after the fills and borders; per-table caches. |
| `render/excel-dl.ts` | `excelToDisplayList`: a table (fills, borders as widths and dashes, texts with alignment, indent, overflow, wrapping, rotation, sup/sub runs, shapes, text boxes, pictures). **Excel and Excel Refined.** Adjacent opaque fills overlap by 1 px so no light seam shows. |
| `render/glass.ts`, `glass-dl.ts` | Liquid Glass: `glassGeom`, `buildScene`, `inferRoles`, **`glassPlan`** (every decision once) · `glassToDisplayList` (materials, 5-layer shadows, the blurred wallpaper behind each surface, tint, rim, sheen, hairlines, capsules, texts). Details: `docs/RENDERING.md` §2.3. |
| `render/layout.ts` | Where things go on a slide – pure, shared by the worker and the page (§6.6): `areaFor`, `defaultLayout`/`layoutOf`, per-design sizing (`sizingOf`, `sizingPatch`, `sizingChange`, `fixedScale`), `notesOf`, **`computeLayout`**; the free layout (4.4, B18): `freeOf`, `freeKey`, `freeBoxes` (every box as drawn: what switching on saves) and `computeLayout`'s free branch (the saved boxes, no bands, no fit). |
| `render/slide-dl.ts`, `slide.ts` | **`slideToDisplayList`**: background and wallpaper, title, subtitle, cover, contents, page number, footer, logo, the tables placed by `computeLayout`, text boxes (fitted on their own layout) and notes section, hit nodes · composition shared with the stage (`slideFrame`, `noteParts`, `memoPart`, `tableDrawKey`). |
| `render/text.ts`, `comment.ts`, `cover.ts`, `pagenumbers.ts`, `scales.ts`, `wallpaper.ts`, `roles.ts` | text styles and markup (`richText`) · comment text on slides · the cover's date · page number and footer placement · colour scales · the Liquid Glass wallpaper (drawn in the worker on an OffscreenCanvas) · row roles (only a test uses it). |
| `dl/` | The display list (`types.ts`: 8 node types in slide px 1600 × 900, ADR-004) and its backends: `svg.ts` (the stage, markup in pieces), `canvas.ts` (thumbnails, PNG, pictures, clipboard), `geom.ts` (geometry all backends share), `color.ts`, `key.ts` (content keys). |
| `text/` | Fonts and text (ADR-005): `fonts.ts` (registry by SHA-1), `hb.ts` + `wasm/` (HarfBuzz), `shape.ts` (shaping, breaking, fitting), `measure.ts` (**text measured from font files** – the library's faces and this PC's; a font may make the slide wait 1.5 s at most, then the page measures and the slide is drawn again), `lines.ts` (CSS line-breaking rules), `kern.ts`, `outline.ts` (glyph outlines for fonts the browser would draw differently), `family.ts`, `resolve.ts` (which file draws a run in the PDF), `pdf.ts`, `subset.ts`, `static.ts`, `fvar.ts`, `sha1.ts`. |
| `pdf/` | `writer.ts` (display list → PDF 1.7, pages `MediaBox [0 0 1200 675]`, Type0 fonts with ToUnicode, soft masks, transparency groups), `png.ts`, `ttf.ts`, `README.md`. |
| `pptx/` (4.5) | **PowerPoint** (B21, docs/next/07 §4, ADR-016 amended 2026-10-19): `scene.ts` (the display list + `SlideList.sem` → a native scene: real tables from the cells' hits, text boxes and placeholders whose first baseline is the display list's, Liquid Glass surfaces as the one blurred wallpaper cropped under gradient shapes, shadows, line shapes – never connectors –, callout presets holding their text, chart frames), `drawingml.ts` (the markup; 1 px = 7 620 EMU, sizes px × 0.6 pt), `chart.ts` (native pie / donut with cached data and an embedded workbook), `writer.ts` (the package: a master and one layout per kind of slide made from the deck – placeholders, the shared background and decoration once –, the theme, each picture once, the same bytes for the same slides), `README.md`. |
| `calc/` (4.2) | The **formula engine** (ADR-013, docs/next/07 §1.4): `wasm/` = IronCalc 0.9.0 (MIT or Apache-2.0, Rust → WASM, inlined by `tools/vendor-ironcalc.mjs` as zlib + base64 with the wasm-bindgen glue; instantiated on first use, never while opening), `engine.ts` (`CalcModel`: a workbook and its linked workbooks fed from the SheetStore – numbers by a tab-separated paste, texts quoted, formulas with Excel's `_xlfn.` prefixes dropped, `[n]Sheet` references renamed to the linked sheets' internal `«n»Sheet` names, whole columns / rows bounded to the used range except inside OFFSET / INDIRECT / ROW(S) / COLUMN(S); `set` an input cell, `evaluate`, `valueOf` read through a 15-significant-digit format, `selfCheck` = every formula cell against Excel's cached value: exact / volatile / locale / external / unreadable / different), `refs.ts` (formula tokenizer, shared-formula shift, sheet ids `[File.xlsx]Sheet`). `core/tests/engine.test.ts`: on the Excel-made recalc corpus every scenario value equals Excel's recalculated copy; `core/bench/engine.bench.test.ts` ⏱ first use < 200 ms, one value < 150 ms. |

### 5.4 The core worker – `core/src/worker/`, `workers/`, `rpc/`, `sync/`
The core worker (`workers/core.worker.ts`, state and answers in `worker/host.ts`) **owns the open workbook, its
deck and undo/redo**. It is a classic worker started from a Blob URL (`app/src/rpc/client.ts`), so it also runs
from `file://`; where no worker can start (the component tests) the same host runs in the page behind the same
messages. The messages are typed in `rpc/messages.ts` over `rpc/port.ts` (calls both ways, events, transferables):
* the page **calls** `init`, `index` (the bytes are transferred; the answer numbers the workbook, every later call
  names that number), `ensure`, `getSheetMeta`, `getSheetWindow`, `detectTables`, `getCell`, `defaultPreset`,
  `start` (the deck as the helper opened it), `inputs`, `apply(label, ops, coalesce)`, `undo(redo)`, `flush`,
  `poll`, `alone`, `compactAll` (Prepare rollback), `staticFont`, `slideLists`, `fontsSettling` (capture tools),
  `stage`, `linkExport`/`unlinkExport`, `calcCheck` (4.2: the formula engine's self-check of the open workbook, every
  sheet read, the folder's workbooks its formulas link to attached, the engine started on this first use), `link` (4.2,
  B22: a workbook of the folder joins the open one – the page gives its bytes through `linkedWorkbook` – and its sheets
  are listed and read under their ids `[File.xlsx]Sheet`), `scenarioPreview` (4.2, S7.4: an input cell set in the
  engine, the slides drawn from the recomputed values through a *view* of the workbook – `core/src/calc/overlay.ts`,
  the changed sheets copied with those cells' values replaced, `RenderCtx.scenario` in every table's cache key –
  until `null` clears it; the document, the deck and the workbook file are never touched);
* the worker **sends** `slices`, `doc` (view when it changed, save state, error, history, deck health, what
  changed, how many of the page's calls it includes), `stage`, `progress`, `error`, `retiredSaved`, `rest` (a
  snapshot for pagehide);
* the worker **asks** the page for `deckSnapshot`, `deckTail`, `deckAppend`, `deckCompact`, `deckRotate`,
  `deckPrepare` (the page's backend), `digitWidth`, `measureRuns`, `breakLines` (text with no readable font file),
  `convertPicture`, `analyzeImages`, `fontCatalog`, `fontFile`.

| File | Responsibility |
|---|---|
| `sync/docsync.ts` | **`DocSync`** (storage v4): `view = fold(snapshot, records) + in flight + pending`. `apply` (local, schedules a flush 300 ms later), `flush` (one record `{l, w, s, by, ops}` per batch, one append in flight, retried after 2, 4, … 32 s with the same record; 409 → `outdated`, 423 → `readonly`), tail every **1.5 s** (rebase, authors), compaction (> 2 000 records past the snapshot, a record older than 24 h, or the deck at rest for 5 s while this page is alone; only records older than 30 s are folded), rotation, `prepare` (the journal is opened during the debounce), `health`. |
| `sync/history.ts` | Undo/redo of my own changes: inverse ops per step, 1.5 s coalescing per key, 200 steps, entries per workbook. |
| `worker/host.ts` | Opens and switches workbooks (numbered, refuses stale calls), owns DocSync and History, builds stage layers (tables cached by content), sends slices → snapshot → stage after a change, queues display lists for export workers. |
| `worker/export-host.ts`, `workers/export.worker.ts`, `workers/main.ts` | An export worker's jobs (PDF, pictures, PNG, thumbnails) · its entry · the one script that becomes either worker by its name. |

### 5.5 `app/src/state/`, `sync/`, `rpc/` – the page's data flow
The page holds **read-only mirrors**: `deck.wb` (sheet slices; the pure code – `runtimeSlides`, layouts, hit
testing, drags, painter, issues – runs on it), `doc.view` and `deck.history`. `change()` sends ops to the worker
and shows them on the view mirror at once; the worker's snapshots are rebased on the calls it has not
acknowledged yet. The page draws no slide itself.

| File | Responsibility |
|---|---|
| `state/store.ts` | **One Zustand store** (`subscribeWithSelector`) in slices: `doc` (open, view, save, error, health, config, fonts), `deck` (file, wb, slides, cur, version, history, remote, opening), `selection` (sel, noteSel, textSel, painter), `ui` (zoom, busy, exporting, toast, dialogs, lookScope, fontBusy, changedOnDisk, logoMissing, fontBuilds, health, others), `prefs` (user, host, client, prefs). Components select what they render; other code uses `get()`, `patch()`, `patchAll()`; equal answers keep the old objects (`same`), so nothing re-renders. `STAGE`/`THUMBS` controller hooks. |
| `state/app.ts` | The actions and the page's end of the core worker: `boot`, `tick` (every 3 s: every 2nd tick health + one stat of the open workbook; every 10th fonts and shared config), `heartbeat` (presence, every 10 s), `openFromFolder`/`openLocalFile`/`openBuffer` (opens are numbered; a newer one supersedes an older), `onWorkerDoc` → `onDocChange`/`onStyleChanged`, **`change(label, ops, coalesce?)`**, `undo`, `styleChange`, `lookChange`, `showVersion`, `ctx()`, `prepareRollback`, `saveStyleAsDefault`. |
| `state/dialogs.ts` | Promise-based dialogs (`ask`, `confirmBox`, `alertBox`, `runWizard`) rendered by `ui/`. |
| `state/fonts.ts`, `fontfiles.ts` | The font library in the page (`@font-face` in `<style id="fontcss">`, Google fonts, uploads, removal) · the font files the workers measure and embed (library and `/sysfonts`, or the browser's local fonts from disk) and the capture of Windows fonts (§6.10). |
| `sync/api.ts` | The `Backend` interface; `helper` (HTTP with `X-SB-Token` from `<meta name="sb-token">` and `X-SB-Formats`; 60 s timeout, 300 s for workbooks, uploads and exports; a read is asked again once when the connection drops) and `offline` (localStorage, for a page opened as `file://`). |
| `rpc/client.ts`, `rpc/export.ts` | The core worker from a Blob URL (or in the page) · the export workers' pool: up to `MAX_EXPORT_WORKERS = 3`, started on demand, stopped after 60 s idle, each linked to the core worker by a `MessageChannel`. |

### 5.6 `app/src/stage/` – the slide on screen
| File | Responsibility |
|---|---|
| `data.ts` | What the stage shows: the worker's `stage` answer (the current slide in layers, each as SVG markup in pieces), one request at a time and the newest wins; slides sent unasked after a change; pictures as blob URLs; **never redraws under an open editor** (the newest slide waits). |
| `Stage.tsx` | Fit/zoom, the `.slide` frame, the layers in painting order, and the overlays as React components: text layer, text boxes, each table's hit area (`.hits`) and handles (`.hbox`), selection, guides, editors. |
| `SlideSvg.tsx`, `patch.ts` | One memoised `<svg>` per layer, its markup set through a ref; a table is `<div class="tw" data-i>` holding its `<svg>` (a resize scales the div, never the svg) · only the pieces that changed are replaced. |
| `model.ts`, `hit.ts` | The overlays' model (layers paired with the runtime slide) · hit testing (`cellFromPoint`: binary search over column/row edges; glass edges from `glassGeom`). |
| `drags.ts` | Column/row borders, table corner, borders and grip, text-box move/stretch with snapping. The preview is computed **on the UI thread** with the core's `computeLayout` at most once per animation frame; pointer-up sends **one** operation (one undo step); pointer-cancel changes nothing. |
| `actions.ts`, `editors.tsx` | What keyboard and toolbars do on the slide · the cell, slide-text and text-box editors. |

### 5.7 `app/src/editor/`, `ui/`, `wizard/`, `styles/`
| File | Responsibility |
|---|---|
| `editor/edit.ts` | Selection model, `applySel(label, fn)` (diffs `CellEdit`s → `cell.patch`), `commitText`. |
| `editor/tables.ts` | Column/row sizes, stretch, same size, copy/reset sizes, align, merge/unmerge – per design. |
| `editor/textfmt.ts` | The unified text toolbar: `textTarget()` → cells / text box / slide text with one interface. |
| `editor/painter.ts` | Format painter (incl. conditional formats and colour scales). |
| `editor/export.ts`, `feedback.ts` | `doExport(kind)`, `exportVersions(designs)` (§10) · *Report a problem with this export…*. |
| `editor/thumbs.ts` | Thumbnails: **pictures drawn by an export worker** (OffscreenCanvas → `ImageBitmap`) shown in a `bitmaprenderer` canvas, 222 CSS px wide × the pixel ratio. Every slide keeps a light row; frames within 300 px of the view are asked for (6 at a time, nearest first), pictures 1 500 px away are let go; a slide is drawn again only when its content key changed (350 ms after an edit). |
| `editor/keys.ts`, `issues.ts` | Global keyboard · side-panel notes. |
| `ui/ShapeTools.tsx` (4.3) | *Insert shape ▾* (six shapes, the icons) and, while one is selected, its fill, border and text on ribbon 2; the text is edited on the slide (double-click, Enter: `stage/editors.tsx ItemEditor`). |
| `editor/charts.ts`, `stage/items.tsx`, `ui/ChartPanel.tsx` (4.3) | **Charts** (B16): *Insert chart ▾* on ribbon 2 (from the selected cells – the last column's numbers named by the first, beside the table – or *Choose the cells…*: `ui/PickCells.tsx`, the wizard's sheet view (RangePicker) of any sheet the wizard lists, never a hidden one – the numbers, then their names; also the panel's *Change the cells…* and a callout's *Quote a cell…*; no cell names typed); the selected item (`selection.itemSel`, and a slice picked by `sliceAt` on the worker's geometry); moves and resizes (`stage/drags.ts itemMove` / `itemResize`, one `item.patch` each; a moved chart is placed freely); in a free layout (4.4, B18) the drags write the slide's free boxes instead (`freeOp`: one `slide.patch` carrying the design's whole entry) – tables by the grip, the corner and the edges (`freeTable`, proportions kept), text boxes and items by any edge, snapping to the other boxes and the slide's guides unless Alt is held; the side panel (type, labels, legend, title, a colour per slice, the source as text, delete); Del / Esc; the Issues lines "Chart n: source … not found" / "no numbers in …" from the stage's `StageSlide.items`. The worker sends each item as a stage layer of its own (`StageLayer.item`). |
| `ui/` | `App.tsx` (layout, drop to open, dialogs), `Chrome.tsx` (slide list, issues, deck health, stage frame, zoom, status bar, busy, toast), `Topbar.tsx`, `Ribbon.tsx` (text toolbar + formula bar), `TableTools.tsx` (layout toolbar), `TextStylesDialog.tsx` (Design…), `CommentDialog.tsx`, `TablesDialog.tsx` (Sizes…), `FontPicker.tsx`, `Dialogs.tsx`, `Dropdown.tsx`, `Field.tsx` (keeps its draft while focused), `Input.tsx` (uncontrolled), `hooks.ts`. |
| `wizard/Wizard.tsx` | The 4 steps; reads sheets only through the worker (summaries, suggestions, windows of cells); the preview is drawn in blocks of 40 rows, one per frame. |
| `styles/` | `ui.css`, `app.css` (the chrome; its end keeps the few slide rules the overlays and the comment preview need, inside `@scope (html) to (.ovl, svg)`). |

---

## 6. Key flows end to end

### 6.1 Boot
`main.tsx` → `boot()`: `GET /api/health`, `/api/me` (user, prefs), `/api/config`, the core worker's `init`,
font library, zoom. When served: the workbook list, reopen `prefs.lastFile`, `tick` every 3 s, presence every
10 s, `pagehide` → the rest snapshot (when alone) and `/api/presence/leave`; `beforeunload` asks when changes are
not saved yet.

### 6.2 Opening a workbook
1. Bytes: `GET /files/<name>` (stable read; `X-SB-Mtime/Size`), or a dropped/browsed file (uploaded to the
   helper's memory store when served; opened from the folder if a file of that name and size is there).
2. The worker's `index` (bytes transferred). `CFB` → `POST /api/convert-workbook` (Excel COM, up to 4 minutes) →
   index again; `ENCRYPTED` → a message. `.xlsb` is read like `.xlsx` (since 4.1). Small workbooks are read
   completely, big ones sheet by sheet.
3. `POST /api/decks/open` (the helper migrates a v3 deck first) → `{key, writer, snapshot}`; one tail; the fold.
4. Preset: continue with the saved one (or the wizard), or for a new deck the worker's `defaultPreset` (used
   directly at start-up or reload when it has slides and the workbook is not big, else the wizard). The worker's `ensure` reads only the
   sheets the slides use.
5. The worker's `start` (its `DocSync`; the stage's slide drawn first). `runtimeSlides` on the mirror →
   `deck.slides`; the person's last version restored; `STAGE.render()`, `THUMBS.render()`.

### 6.3 One edit, end to end (Ctrl+B on cells)
```
page (UI thread)                     core worker                              helper                 share
──────────────────────────────────── ──────────────────────────────────────── ────────────────────── ─────────────
keydown Ctrl+B (editor/keys.ts)
 └ applySel → cell.patch ops
 └ change(): view mirror predicted,
   save "Unsaved changes…"
 └ call apply(label, ops) ─────────► DocSync.apply: inverse ops → history
                                     (same coalesce key < 1.5 s = one step)
                                     view = confirmed + pending
                                     stage slide rebuilt: only the changed
                                     table, markup in pieces
   ◄──────── doc snapshot, stage ─── (prepare: journal opened ahead) ──────► open handle
 stage/patch.ts replaces the pieces
 keypress → pixels p95 ≈ 25–42 ms (bench, deck20; budget 50 ms)
 350 ms later: thumbnail of that slide
 (and the index slides) asked again    300 ms debounce
                                     record {l, w, s, by, ops} ─ POST …/append ► write frame, os.fsync ► j/<writer>.log
   ◄──── doc: save "✓ Saved" ─────── ◄──────────── {journal, offset, at} ◄─── (stamps `at`, server clock)
                                     every 1.5 s: GET …/tail?since= ────────► reads the new bytes of ◄── j/*.log
                                                                              every journal (≤ 8 at once)
                                     fold in (lamport, writer, seq) order,
                                     rebase pending, stage rebuilt
   ◄──── doc (change.by = "bob"), stage ── status bar "Updated by bob just now"
```
Failure: the same record is sent again after 2, 4, 8, 16, 32 s (the fold keeps one copy per writer and seq);
409 → `outdated` (the status bar asks to reload the page, F5); 423 → read-only (a damaged journal).

### 6.4 Seeing other people's changes
Every 1.5 s the worker's DocSync tails the deck from where it stopped (a newer snapshot is loaded when another
page compacted) → fold → rebase → `doc` event → `onDocChange`: preset changed → runtime slides rebuilt and full
redraw; titles/logo changed → slides rebuilt; style changed → `onStyleChanged` (slides re-resolved if the design
changed); otherwise `STAGE.refresh()` (the worker rebuilds only the tables whose content changed) and the
thumbnails. The stage never redraws while an inline editor is open; settings inputs use `ui/Field.tsx`.

### 6.5 Undo/redo
`undo()` asks the worker: it takes the user's own last entry (same workbook) and applies its stored inverse ops
as **new** ops (`sync/history.ts`). Inverses touch only the fields this user changed, so another user's later
change to other fields survives.

### 6.6 Rendering a slide and the layout algorithm
In the core worker, `slideToDisplayList` (`slide-dl.ts`) → for each table (cached by its draw key) `effItems` →
`excelToDisplayList` or `glassPlan` + `glassToDisplayList`; the tables are placed by **`computeLayout(R, ctx)`**:
1. Content area x 50…1550, y from 104 (126 with a subtitle) to 822, pushed down by a large title (at most 200).
2. Text boxes moved freely (x/y) leave the flow; "span" boxes reserve a column at the left/right.
3. Each table + its attached boxes is one unit: width `tableW × w[i] × k` + side boxes, height `H × w[i] × k` +
   top/bottom boxes (stretched boxes may exceed the table).
4. `k` = the largest scale ≤ 2.0 at which all bands fit (binary search, 40 steps; gaps GX 36 / GY 28); with a
   fixed scale (*Same size*), `k = min(fixed, fit)`.
5. Bands are placed by `align` (default centre) and `valign` (default: 17.5 % of the free height above –
   `free / 2 × 0.35`); span columns sit next to the tables actually drawn; text-box fonts shrink to fit.
Sizing values come from `sizingOf(R, ctx)` (per design). A drag's preview on the page runs the same function.
More: `docs/RENDERING.md` §2.

### 6.7 Automated comments
A `Note` with `auto: CommentCfg` → at render time `notesOf` → `commentText` → `gridOf` (displayed values after
edits and version blanking) → `analyse` → `writeSummary`/`writeComment` → `shapeComment` → markup →
`richText`. Because it runs on every render, comments follow the numbers, edits and versions.

### 6.8 Versions
Defined in wizard step 4 → `preset.versions`. `deck.version` (remembered in `prefs.versions[workbook]`) → the
`version` input of the worker → `effItems` blanks the hidden ranges → table keys include the hides → comments
ignore the blanked numbers. `exportVersions(designs)` hands one job per design × version to the export workers.

### 6.9 One export (Export ▾ › every version × all three designs)
```
page: flushDoc() ─► one job per (design × version), Promise.allSettled ─► export pool (≤ 3 workers at once)
  export worker ── slideLists on its own channel ─► core worker: display lists (tables cached), queued per job
  export worker: display lists → PDF (HarfBuzz shaping, hb-subset fonts, shared wallpaper images) → bytes
  page: POST /api/export-file?name=<workbook> - <version> - <design>.pdf  (from disk: a download)
  helper: temp file → lock export-<name> → rename into export\ (" (2)", " (3)"… when the target is open)
  toast "Saved … in the export folder" [Open] [Show folder]
  measured: deck20 (20 slides) ≈ 1.4 s per Liquid Glass PDF, ≈ 0.35–0.44 s per Excel PDF (PROGRESS S3.7–S3.8)
```

### 6.10 Fonts
`GET /api/fonts` → `@font-face` rules pointing at `/fonts/<file>?t=<token>`. Adding a Google font: the page
fetches the css2 stylesheet, keeps latin/latin-ext faces, downloads each face and `POST`s it to `/api/fonts`
(stored once in `data/fonts`). An uploaded **variable** font is first made a static face at its declared weight
by the core worker (`staticFont`, hb-subset), so no export embeds a variable font. The core **measures text from
font files** (`text/measure.ts`): the library's faces and this PC's Windows fonts (`GET /sysfonts`, or from disk
the browser's local fonts once allowed); a face whose browser widths differ from HarfBuzz's is drawn as glyph
outlines on the stage, so the screen equals the PDF. The page captures each Windows font file the workers read,
once (`POST /api/fonts/capture`). In **fingerprint mode** (default) the helper records the file's fingerprint and
the side panel names other PCs with another build of the font (their slides may wrap a little differently). In
**copy mode** – once the licence owner's yes is recorded with
`python slide_builder.py --allow-font-copy "<who confirmed, when>"` (`off` goes back; stored in
`data\fonts\system\licence.json`, so one PC records it for the share) – the helper copies the whole family into
the library (all faces or none; single-face, embeddable, not variable) and every PC lays the deck out with the
same files.

---

## 7. The helper (`helper/slidebuilder`)

Python ≥ 3.8, **standard library only**. Windows is the target; everything except the Excel and GDI+
converters and the Edge window also runs on Linux/macOS (CI runs the tests on Linux).

### 7.1 Start-up (`main.py`)
Arguments: `--port` (8765), `--no-browser`, `--install` (§2.2), `--selftest` (read-only check that this version
can use the folder: the helper imports, the page exists, every saved file and deck snapshot reads and upgrades in
memory, a create/fsync/rename/delete probe in `data\locks`; used by `tools/update.py`), `--allow-font-copy WHO|off`.
Steps: `--allow-font-copy`/`--selftest`/`--install` run and exit → simulated-latency hook if
`SLIDEBUILDER_SIM_FS_MS` (load tests only) → a missing page is reported (the helper starts anyway) → create
`export/`, `data/` → v2 import (`migrate.migrate`, errors logged) → `store.upgrade_all()` → port probe 8765–8784
(`GET /api/ping` without token, 1 s: the same major version → open the app and exit; another major version → try
the next port) → `App()` (token = `secrets.token_urlsafe(24)`) → banner → after 0.6 s open the app (Edge
`--app`, else the default browser) → `serve_forever`. A background thread closes deck journal handles idle for
10 minutes (checked every 60 s).

### 7.2 Module map
| Module | Responsibility |
|---|---|
| `paths.py` | Folder layout: ROOT, DATA, EXPORT_DIR, APP_FILE, `HOME_BACKEND`/`INSTALL_HOME` (a version in `app\<ver>\helper` uses the main folder's `backend\`), `WORKBOOK_EXT`; environment overrides; `configure()`. |
| `util.py` | Logging, identity (`current_user/host`), `doc_key`, name/path safety (`safe_path`), atomic writes (`write_tmp` + fsync + `replace_retry`: 20 tries for Windows sharing violations), a proxy-less opener for 127.0.0.1, `is_network_path`. |
| `fsclock.py` | The **file server's clock**: the offset measured by writing a probe file and reading its mtime (cached 30 s). All ages of shared files use it. |
| `locks.py` | `Lock(name)`: `data/locks/<name>.lock` created with `O_CREAT\|O_EXCL`, body `{user, host, pid, at, token}`; wait ≤ 10 s with jitter; stale after 15 s (server clock) → renamed away atomically and re-checked; keepalive every 3 s for long sections; released only with our token. |
| `decks.py` | Storage v4: open (and create), append (per-writer handle + `os.fsync`, `at` stamped), tail (≤ 8 journals read in parallel, complete frames only, listing cached 3 s), snapshot (retried, unreadable → 503), compact (CAS on `gen` under the deck lock, backup of the last 30), rotate, prepare, presence (empty files, 25 s window), incidents (→ 423 read-only), lean-lock mode. Never parses an operation. |
| `migrate_v3.py` | A deck moves from Slide Builder 3 on its first v4 open (backup, freeze, snapshot), `migrate_all`, rollback, `pinned-v3.json`, `list_decks`. |
| `store.py` | `config.json` (compare-and-set under lock `config`), personal prefs, v3 workbook documents read only (migration, self-test); retried reads (`StoreUnreadable` → 503, never replaced by empty), atomic writes, upgrades on read. |
| `upgrade.py` | `SCHEMA`, `@step(kind, n)` upgrade functions (none yet), `TooNew`. |
| `workbooks.py` | Listing (ROOT then `backend\`, newest first, `~$` files skipped), path-safe lookup, **stable read** (size and mtime unchanged before/after, a zip's end record present; 8 tries × 0.5 s; `Unstable` → 503 while Excel is still saving), per-file stat. |
| `fonts.py` | Font library: signature-checked files (≤ 15 MB, ≤ 64 faces per family), written before the index, under lock `fonts`. |
| `sysfonts.py` | This PC's fonts for the core (`GET /sysfonts`: `%WINDIR%\Fonts` and the per-user fonts folder, `.ttf/.otf/.ttc`) and `POST /api/fonts/capture` (fingerprints; copy mode once `licence.json` records the yes). |
| `exports.py` | `/api/export-file` (.pdf / .png only, checked by signature; temp file → under lock `export-<key>` renamed into place; a locked target → ` (2)` … ` (50)`), `/api/export-feedback` (`export\feedback\<date>-<time>-<user>.json`, ≤ 64 KB, never replaces one). |
| `convert.py` | Windows only: `.xls` and protected files → `.xlsx` via Excel COM through PowerShell (a read-only copy, macros and alerts off, 240 s timeout, 4 results cached); EMF/WMF/TIFF → PNG via GDI+ (ctypes; PowerShell fallback). |
| `server.py` | HTTP server (`ThreadingHTTPServer`, HTTP/1.0, backlog 128, 127.0.0.1), the guard (Host, Origin, token, formats), routing, body limits, exception → status mapping, upload store (8 entries, 2 h), security headers. |
| `migrate.py` | One-time import of v2 settings under lock `migrate`: shared defaults, the importer's prefs, one new deck per workbook. |
| `firstrun.py` | `--install`: the 5 steps with an OK/WARN/FAIL report (§2.2). |
| `selftest.py` | `--selftest` (§7.1). |
| `simfs.py` | **Load tests only**: adds simulated SMB latency to data-folder file calls. |

### 7.3 Environment variables
| Variable | Meaning |
|---|---|
| `SLIDEBUILDER_ROOT`, `SLIDEBUILDER_DATA`, `SLIDEBUILDER_EXPORT` | the folders (workbooks; saved state, default `<backend>\data`; exports, default `<ROOT>\export`) |
| `SLIDEBUILDER_USER`, `SLIDEBUILDER_HOST` | identity (default: the Windows user and PC name) |
| `SLIDEBUILDER_APP_WINDOW` | `0`: a browser tab instead of the Edge app window |
| `SLIDEBUILDER_APP_FILE` | serve another page (tests, load test) |
| `SLIDEBUILDER_STORAGE` | `lean-lock`: the fallback storage mode (§9), any other value: `journal`; unset: `data\v4\storage.json` decides, default `journal` |
| `SLIDEBUILDER_SIM_FS_MS` | simulated share latency in ms (load tests only) |
| `SLIDEBUILDER_SYSFONTS` | other font folders instead of Windows' (tests) |
| `SLIDEBUILDER_ROLLBACK_QUIET` | the rollback's pause in seconds (tests; default 14) |

### 7.4 Lock names
`deck <key>` (the file `v4/decks/<key>/lock`: compaction, creation, lean-lock appends), `wb-<key>` (a deck's
migration / rollback; Slide Builder 3's saves), `config`, `user-<name>`, `fonts`, `migrate`, `export-<key>`,
`export-feedback`, `firstrun-<user>-<host>`; `tools/update.py` uses its own `data\locks\update.lock` (stale after
30 minutes). No lock is taken on the edit path: appends go to the writer's own journal.

### 7.5 Updating the program (`tools/update.py`, run by `Update Slide Builder.bat`)
| Option | What it does |
|---|---|
| *(none)* | In a folder of side-by-side versions: `--release latest` (refused while "held" after a `--use` back). Otherwise update in place: with git, the folder is the working copy (`git init` + fetch the first time, then `fetch` + `reset --hard origin/<branch>`, `-c safe.directory=*`; never `git clean`, never a nested clone); without git, the branch ZIP, writing only changed program files and `data/app-version.json`. |
| `--release [latest\|X.Y.Z]` | install a release ZIP from GitHub side by side (§2.3); the newest 3 versions, the current and the previous one stay, and the newest 3.x while a 4.x is installed |
| `--zip [FILE]` | without FILE: force the ZIP download of the branch; with FILE: install that release ZIP offline |
| `--use X.Y.Z` | make an installed version current (an older one marks the folder "held"; `--use 3.x` gives every deck back first) |
| `--migrate-all`, `--rollback [WORKBOOK]` | move every deck to v4 now / give one or every deck back to 3.x (§2.4) |
| `--check`, `--branch`, `--repo`, `--root`, `--yes` | only report · branch · repository · another folder · no questions |

Never changed: the saved setups in `backend\data\` (the updater only adds `backups\before-update-<time>\` and
`locks\update.lock` there), `backend\logo*`, v2 settings, workbooks, `export\`, `engine\`, `app\` (except
`app\<ver>` and `current.json` by a release install). Before an update the saved setups (and any locally
modified program file) are copied to `backups\before-update-<time>\` (last 5); afterwards a git/ZIP update
test-loads every saved deck with the new code (a release install runs the new version's `--selftest` before it
becomes current). One update at a time. Exit code 0 when all went well, 2 when a deck or a check failed; a refused
update stops with a message (exit code 1).

---

## 8. HTTP API
The helper listens on `127.0.0.1:<port>` only. Every `/api/*` (except `/api/ping`), `/files/*`, `/assets/*`,
`/fonts/*`, `/sysfonts*` request needs `X-SB-Token` (`/assets` and `/fonts` may use `?t=`); `Host` must be
`127.0.0.1:<port>` or `localhost:<port>`; a present `Origin` must match; a POST/PUT/DELETE on `/api/*` with a
non-matching `X-SB-Formats` → 409. Body limits: JSON 2 MB, a compaction's snapshot 32 MB, uploads / exports /
conversions 300 MB, logos 10 MB, fonts 15 MB. **The full request/response shapes are in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §10.**

| Endpoint | Purpose |
|---|---|
| `GET /` | the app, `__SB_TOKEN__` replaced by the token (`<meta name="sb-token">`) |
| `GET /api/ping` (no token) · `GET /api/health` | `{app, version}` · `{app, version, user, host, folder, export}` |
| `GET /api/files` · `GET /api/files/<name>/stat` · `GET /files/<name>` | workbooks in the folder (with each deck's rev and author) · one workbook's `{name, mtime, size}` · workbook bytes (stable read, `X-SB-Mtime`, `X-SB-Size`) |
| `POST /api/decks/open` | `{workbook}` → `{key, writer, created, migrated, storage, snapshot}` (migrates a v3 deck first; a pinned deck → 409) |
| `GET /api/decks` | every deck `{key, workbook, gen, rev, rolledBack}` (Prepare rollback) |
| `GET /api/decks/<key>/snapshot` · `…/tail?since=<json>` · `…/history` | the snapshot · new records of every journal past the given offsets · the backups |
| `POST /api/decks/<key>/append` · `…/prepare` · `…/compact` · `…/rotate` | `{writer, record}` → `{journal, offset, at}` · open the writer's journal ahead · `{baseGen, snapshot}` (CAS on gen) · delete my covered journals |
| `GET /api/config` · `POST /api/config` | shared defaults · `{baseRev, style}` compare-and-set (409 with the current document) |
| `GET /api/me` · `PUT /api/me` | user, host, personal preferences (whole replace) |
| `POST /api/presence` · `POST /api/presence/leave` | `{deck, client}`: heartbeat → others on the deck (25 s window) |
| `GET/POST/DELETE /api/fonts` · `GET /fonts/<file>` | font library · font files |
| `GET /sysfonts` · `GET /sysfonts/<file>` | this PC's fonts `{fonts: [{file, family, subfamily, weight, italic, faces, size}]}` · one listed file |
| `POST /api/fonts/capture?file=` | fingerprint of a Windows font into `data/fonts/system/fingerprints.json`; other PCs' builds; copy mode copies the family |
| `POST /api/logo?name=` · `GET /assets/<name>` | upload a logo to `data/assets` · images from `data/assets`, `backend/`, ROOT |
| `POST /api/export-file?name=` · `POST /api/export-feedback` | save a PDF or PNG in `export\` (returns the name used) · a problem report in `export\feedback\` |
| `POST /api/convert-workbook?name=` · `POST /api/convert?ext=` | .xls / protected file → .xlsx · EMF/WMF/TIFF → PNG (Windows; else 501) |
| `POST /api/upload?name=` · `GET /api/upload/<id>` | temporary in-memory uploads (8, 2 h) |
| `POST /api/open` | open the export folder or an exported file on this PC (`os.startfile`) |
| `GET /fieldcheck` (no token) | `tools/fieldcheck.html`, the browser-capability field test |

Status codes: 400 bad request · 403 Host/token/Origin/path · 404 · 409 format mismatch, newer file, deck rolled
back or pinned, config or compaction conflict · 411/413 body · 423 deck read-only (incident) · 501 converter
unavailable · 503 unreadable file, lock busy, workbook still being saved (clients keep their records and retry) ·
500 unexpected (traceback in the console window). Error bodies are `{"error": "…"}`.

---

## 9. Concurrency and failure model
* **Coordination only through files on the share.** An edit is one record appended to the page session's own
  journal (no lock; `os.fsync` before the answer); the order is the records' Lamport time, so it does not depend
  on whose append reached the share first. A compaction writes the next snapshot by compare-and-set on its `gen`
  under the deck's lock; config and snapshots are written under `O_EXCL` lock files, and config, prefs and
  snapshots are all temp file + fsync + `os.replace` (retried for Windows sharing violations). Ages (stale locks, presence, `at`) use the file server's clock.
* **Field-level merge** (§4.3): different fields never conflict; the same field → the later record in Lamport
  order wins, on every PC alike.
* **Clients** keep `fold(snapshot, records) + in flight + pending`; one append in flight; a record is never
  dropped on errors (sent again, folded once); the deck is tailed every 1.5 s; remote authors are shown.
* **Compaction** folds only records older than 30 s (a new journal may be missing from another reader's listing
  for a while: the helper caches it 3 s, the SMB client up to 10 s) and skips a round in which a journal could not
  be read. Journals covered by the snapshot are deleted by their owner (`rotate`) or, idle 24 h, by a compaction.
* **Torn and damaged journals**: an incomplete last frame (a write in progress or a crash, zero bytes included) is
  left and read again; a complete frame with a wrong length, CRC or newline is corruption: an incident file is
  written and the deck becomes read-only (423) until the maintainer looks at it.
* **Never lose data**: unreadable file → 503 and retry (never treated as empty); workbook still being written by
  Excel → 503; format upgrades and the v3 → v4 move back up the original; updates back up saved setups.
* **Fallback mode `lean-lock`** (ADR-006): every append takes the deck lock and goes to one shared journal – same
  endpoints, records and fold. Set by `SLIDEBUILDER_STORAGE=lean-lock` or `data\v4\storage.json`. Not used in
  production ("journal" ships).
* **Measured** (`tools/loadtest4.py`, PROGRESS S5.4): 20 users on one deck with 40 ms per simulated SMB operation
  → save p50/p95 ≈ 98/115 ms, edits visible to others p50/p95 ≈ 1.4/2.2 s. On the real share with all helpers on
  one PC: 10 users pass every target; 20 users miss two (save p95 171 ms > 150, visible p95 4.6 s > 4 s during
  compactions) – accepted on 2026-10-15 as a limit of running 20 helpers on one PC. No record was lost in any run.

---

## 10. Export
The page writes every PDF and PNG itself; the helper only saves the bytes. The core worker builds each slide's
**display list** (the one the stage draws); up to **three export workers** (the core worker's script under the
name `sb-export`) take one job per (design, version) and ask the core worker for the display lists on a channel
of their own, so the lists never pass through the page's thread. The same workers draw the thumbnails.
* **PDF · text & tables**: `core/src/pdf/writer.ts` with HarfBuzz shaping and `hb-subset` subsetting. Each run's
  CSS family list is resolved to the first family that can be embedded (`text/resolve.ts`): the deck's library,
  then this PC's fonts (`/sysfonts`; from disk the browser's local fonts – Edge asks once; refused or not
  available, the PDF is made of pictures and the toast says so). "Segoe UI Variable …" and "SF Pro …" are skipped
  (static Segoe UI, as the screen draws Liquid Glass); synthetic bold and italic as Chrome draws them; a family
  nobody has → a default face, named in the toast. Never Type 3, never a variable font. Pages are 1200 × 675 pt.
* **PDF · as pictures**: each slide drawn on an `OffscreenCanvas` at **2×** (3200 × 1800, tables on their own
  layers) and passed through as Flate images with PNG predictors (deck20: Excel 11.6 MB, Liquid Glass 69 MB).
* **PNG** (current / every slide) at 3× (4800 × 2700) and **Copy current slide** (a `ClipboardItem` created at the
  click, its PNG following when drawn).
* **PowerPoint** (4.5, B21): *Export ▾ › PowerPoint · all slides / current slide*, *PDF + PowerPoint* (both files at
  once), the versions' items in PDF, PowerPoint or both, and *Run for each value…*'s *Files: PDF · PowerPoint*. The
  same export workers write it with `core/src/pptx/` from the same display lists (asked with `pptx: true`, so the core
  adds each chart's data and each callout's shape): editable text and real tables, native pie / donut charts with their
  data (Edit Data works), everything else native shapes – no picture per slide; a master and layouts made from the
  deck. Fonts are named, not embedded: the first family of each list this PC has; the deck's library fonts are said in
  the toast (PowerPoint substitutes them where they are not installed). Checked by `tools/pptxcheck.py` (structure,
  python-pptx, a lint of what PowerPoint repairs silently, PowerPoint 16 opening it).
* **Names**: `<workbook> - slides.pdf` (one slide: `<workbook> - <slide>.pdf`), `<workbook> - <slide>.png`,
  `<workbook> - <version> - <design>.pdf`, + ` (images)` for pictures; the PowerPoint files the same with `.pptx`.
* **Gates** (`npm run bench`, deck20): Liquid Glass < 2 s and ≤ 80 KB per slide + 190 KB, Excel < 1 s and ≤ 40 KB
  per slide (measured: 1.33 MB and 1.4 s; 313 KB and ≈ 0.4 s). `tools/export-check.mjs` exports every corpus deck
  in every design and checks qpdf, fonts, the text against the goldens, size and time.
The bytes go to `POST /api/export-file?name=` → `save_export`; opened from disk they are downloads.

---

## 11. Development and tests

Everything below was written for **Windows 10/11 with Git Bash** (the maintainers' setup); PowerShell
equivalents are noted. The same commands run on Linux (CI runs them on ubuntu-24.04).

### 11.1 Prerequisites
| Tool | Version, and why |
|---|---|
| Git | any recent; the clone must include tags (`test_migrate_v3.py` runs the real v3.8.0 helper from a `git worktree` of tag `v3.8.0`) |
| Node.js | **22, at least 22.22.2** (the lockfile's jsdom 30 needs `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0`); CI uses Node 22. No admin rights needed: a portable Node folder on `PATH` is enough |
| Python | **≥ 3.8** for the helper and its tests (CI: 3.8 and 3.12); on Windows the tools call `python` (`python3` is the Microsoft Store placeholder there) |
| Chromium | e2e, parity, bench and the export tools drive **Playwright's Chromium** (Playwright 1.63.0, Chromium 153.0.8010.12, revision 1243), or any Chromium named by the `CHROME` environment variable |
| Dev-only Python packages | `openpyxl` + `Pillow` (corpus and fixture workbooks), `pypdf` (parity), `pypdf` + `pypdfium2` + `qpdf` (`npm run sp`, `tools/pdfcheck.py`, export checks). CI pins `openpyxl==3.1.5 pillow==11.3.0 pypdf==6.7.5 pypdfium2==5.14.0` |

**Behind the corporate TLS-inspecting proxy** npm, `npx playwright install` and every Node tool need the
Windows certificate store: `export NODE_OPTIONS=--use-system-ca` (PowerShell: `$env:NODE_OPTIONS="--use-system-ca"`;
cmd: `set NODE_OPTIONS=--use-system-ca`). Run npm from the correctly cased path (`/c/Users/…/Downloads/…`):
a lower-cased `downloads` was seen to crash npm's workspace handling on Windows.

### 11.2 From a clean clone
```bash
# Git Bash, Windows
export NODE_OPTIONS=--use-system-ca                     # behind the proxy (see above)
git clone https://github.com/gualbertol123/slidemaster.git && cd slidemaster
npm ci                                                  # npm workspaces app/ and core/, node_modules/ at the root
npx playwright install chromium                         # once per PC: %LOCALAPPDATA%\ms-playwright\chromium-1243
                                                        #   (or: export CHROME="/c/path/to/chrome.exe")
npm run build                                           # tsc + Vite → helper/slide_builder.html
git diff --exit-code -- helper/slide_builder.html       # must print nothing: the build reproduces the committed page
npm run check                                           # core: typecheck (src, tests) + Vitest; app: typecheck + Vitest
python -m unittest discover -s helper/tests             # helper tests, from the repository root (Python 3.8+)
npm run test:e2e                                        # Playwright: two real helpers (anna :8951, bob :8952) on one temp folder
```
* **The built page is committed.** `helper/slide_builder.html` is what users run; a developer edits `app/src` or
  `core/src`, runs `npm run build` and commits both. `app/tests/build.test.ts` (part of `npm run check`) builds the
  page into a temp folder and fails unless it equals the committed file byte for byte; CI's unit job also runs
  `git diff --exit-code` after its build. Every text file is checked out with LF (`.gitattributes`
  `* text=auto eol=lf`, `.bat` files CRLF), so a Windows clone with `core.autocrlf=true` builds the same bytes.
* `npm run check` without `tests/corpus/workbooks/big30.xlsx` skips the big30 cases of a few corpus tests
  (sheet scanner, detector, XML); generate it (§11.3) to run them.
* The e2e run needs the committed (or freshly built) page and Python; failure artifacts go to
  `app/test-results/`. `npm run test:e2e` = `playwright test` in `app/` (`app/playwright.config.ts`: one worker,
  90 s per test, viewport 1500 × 900).
* `npm test` runs only the Vitest suites (no typecheck). `npm run dev -w app` starts Vite's dev server; such a page
  has no token, so it runs like a page opened from disk (localStorage, downloads).
* Start the helper from the checkout: `python helper/slide_builder.py [--port 8765] [--no-browser]`.

### 11.3 Parity, benchmarks, load test
```bash
python -m pip install --user pypdf                      # parity reads the PDFs' text
npm run parity        # capture this build and compare with golden/ (v3.4.0's slides): exit 1 on any unaccepted difference
npm run dlparity      # the display lists against the goldens (3 designs; full comparison only on the reference PC)

python -m pip install --user openpyxl pillow
python tools/make_corpus.py big30 tests/corpus/workbooks   # the 30 MB workbook (3 × 130 000 rows; git-ignored)
npm run bench         # core: big30 parse (≤ 500 ms, ≤ 40 MB) · app: render counts · tools/bench.mjs: the page in
                      #   Chromium with a real helper → bench-results.json

python tools/loadtest4.py --ci                          # 20 simulated users through real helpers (standard library)
```
* **Parity modes.** `golden/` holds v3.4.0's slides captured on the reference PC (Windows 11, its fonts,
  Playwright's Chromium 153). `tools/parity.mjs` compares geometry, pixels and PDF text positions (**full
  comparison**) only when this machine's Chromium version and font-file fingerprint equal the goldens'
  (`golden/MANIFEST.json` `environment`); everywhere else it compares **texts and styles only** and prints a note
  (`--text-only` forces it). Accepted differences, each signed by a person, are listed in
  `tests/parity/accepted.json`. Reports: `tests/parity/report/index.html`, `tests/parity/report-dl/`.
* **Bench gates** (`tools/bench.mjs`, each scenario twice, the worse run counts, +10 % slack): deck20 open 400 ms,
  big30 sheet read 1 000 ms, longest main-thread task 50 ms, Finish → first slide task 250 ms, heap of page + core
  worker 150 MB, export 2 s / 1 s and PDF size (Liquid Glass / Excel), keypress → pixels p95 50 ms, drag frame
  16 ms, thumbnail scrolling gap 20 ms. The time limits (open, read, exports, core parse) are scaled by this
  machine's speed (`tools/calibrate.mjs`, ≈ 32 ms on the reference PC), never more than 2×. The bench needs
  big30.xlsx (it exits 2 without it) and a quiet PC.
* **How the bench decides on CI** (`tools/benchgate.mjs`, decision 2026-10-20): on GitHub Actions a **timing** gate
  (ms) fails only when it is over its limit + 10 % in **two separate measurements**. When the first pass (the two
  runs, the worse counting) is over, the bench measures again – `tools/bench.mjs` runs every scenario once more in a
  fresh browser, helper and page and judges only the gates that were over on it; the core benches measure again in
  the same process (big30 parse, chart, callout: the repeat runs warm) or, for the engine's cold first use, in a
  fresh process – and fails
  only if the repeat is over too. The report prints both numbers and "repeated after a stall" for a gate that passed
  only on the repeat; a gate over in both keeps its `::error` annotation (both numbers), and `bench-results.json`
  holds both (`gates`, `repeat`). Limits and scaling are the same as above. Size and memory gates (KB, MB), a value
  not measured, and the render counts are never repeated. On any other machine nothing changes: one pass decides.
* **Load test** (`tools/loadtest4.py`): `--ci` runs same deck 20 users at 15 and 40 ms, different decks, a burst and
  compaction while editing, with the limits save p95 150 ms, visible p95 4 s, no record lost, every view equal;
  `--scenario`, `--users`, `--fs-ms`, `--duration`, `--storage lean-lock`, `--real-folder "T:\…"` (a temporary
  sub-folder on a real share, for people).
* Other tools: `npm run sp` (each display-list node type: PDF by PDFium vs canvas; needs qpdf, pypdf, pypdfium2),
  `npm run export-check`, `npm run export-dl`, `npm run g1`, `tools/textref.mjs`, `tools/capture-v3.mjs`,
  `tools/vendor-harfbuzz.mjs`, `tools/make-xlsb-twins.ps1` (Excel needed; regenerates `tests/corpus/workbooks/xlsb/`).
  Each tool's usage is in its header comment.

### 11.4 Releases and CI
* **Release**: `docs/next/release-checklist.md` – (1) versions in `helper/slidebuilder/__init__.py`, the three
  `package.json`, `package-lock.json`, a dated CHANGELOG section; (2) the checks above on a clean clone, with the
  helper tests on Python 3.8 and 3.12; (3) `python tools/make_release.py --version X.Y.Z` (runs the helper tests
  and `npm run check`, writes `dist/slidebuilder-X.Y.Z.zip` with `MANIFEST.json`; reproducible), `--verify` and
  `--notes`; (4) a rehearsal on a copy of a share (`tools/update.py --root <copy> --zip … --yes`, self-test,
  `--use` both ways); (5) tag `vX.Y.Z` and push – the `release` workflow builds and publishes the ZIP and its
  `.sha256`; (6) update the share; (7) record it in PROGRESS.md. `make_release.py` does not build the page: run
  `npm run build` first.
* **CI** (`.github/workflows/ci.yml`, ubuntu-24.04, Node 22, on every push and pull request): `unit` (build +
  stale-page check + app check), `core` (core check), `helper` (Python 3.8 and 3.12; full history for the v3 tag),
  `e2e`, `bench` (generates big30; uploads `bench-results.json`), `load` (`loadtest4.py --ci`), `parity`
  (`parity` + `dlparity`, text-only on the hosted runner), `pdf` (`sp` + `export-check` of 3 decks). Chromium's
  sandbox needs `sysctl kernel.apparmor_restrict_unprivileged_userns=0` there. `release.yml` (tags `v*`) runs
  `ci.yml`, then builds and publishes the release (a version with "-" is a pre-release).

### 11.5 Test suites
| Suite | Covers |
|---|---|
| `core/tests/ops`, `docsync`, `convergence` | every case of `shared/ops-vectors.json` (ops, fold) · DocSync v4 (merging, retries, rebasing, own-changes undo, 409/423, compaction) · 1 000 random seeds of 2–5 writers converging with no acknowledged record lost |
| `core/tests/xml`, `sheetstore`, `zip`, `detect` | the XML tokenizer = DOMParser (jsdom) on every corpus workbook and crafted parts · the byte scanner = v3's parser cell by cell · the zip reader · table suggestions = v3's |
| `core/tests/xlsb` | every `.xlsb` twin equal to Excel's `.xlsx` cell by cell; every corpus deck draws the same from both in all designs and versions, also through slices; crafted records (short cells, unreadable conditional-format formulas, default column width, a record cut short) |
| `core/tests/host`, `slice`, `robustness` | the core worker through its messages · slices give the same slides as the workbook · overlapping opens, refused starts, stopped workers, damaged/encrypted files, the history's 200 steps |
| `core/tests/tables`, `text`, `design`, `comment`, `numfmt` | layout and sizing, text styles and boxes, designs and versions, automated comments, number formats |
| `core/tests/dl`, `excel-dl`, `glass-dl`, `slide-dl` | display-list backends; tables and whole slides as display lists |
| `core/tests/export`, `shape`, `measure`, `w13` | the native export · HarfBuzz shaping and subsetting · measuring from font files · three simulated PCs with different fonts |
| `app/tests/*` | build is fresh, API client, dialogs, export pool, font capture, parity rules, stage patching, the stage's requests and E8 (no redraw under an open editor), render counts (jsdom with React's development build: any console error or warning fails) |
| `app/e2e/app.spec.ts` | two users on one folder: wizard, merging, export, table tools, painter, gridlines, themes, typing under concurrent changes, fonts, comments, text boxes, notes, versions × designs, drags, thumbnails, PNG and clipboard, Prepare rollback, no console errors |
| `app/e2e/file.spec.ts` · `open.spec.ts` | the page from `file://` without a helper (incl. an `.xlsb`) · dropped workbooks, Reload, the "saved again in Excel" banner |
| `helper/tests/test_*.py` | decks (incl. torn and corrupt journals), migration and rollback with the real v3.8.0 helper, store, locks, clock skew, upgrades and saved formats, HTTP and security, fonts and system fonts, exports, workbooks, install, updater, release ZIP, load-test hook |

---

## 12. Where to change what
| Task | Touch |
|---|---|
| **New saved field** | `core/src/model/types.ts` (type + `Op` patch type) → key lists in `model/ops.ts` → a case in `shared/ops-vectors.json` → `docs/ARCHITECTURE.md` → UI → rendering → if it changes how a table is drawn, its cache key (`render/context.ts tableKey`, `render/slide.ts tableDrawKey`) → tests. Optional fields need no format change. |
| **Change the meaning/shape of saved data** | raise `SCHEMA[kind]` in `upgrade.py` + `@step(kind, old)`; raise `FORMATS`; test in `test_upgrade.py`; **add** `fixtures/saved/<kind>.v<n+1>.json`; ARCHITECTURE. Deck files: `format` in `decks.py` and `fold.ts`. |
| Cell formatting control | `ui/Ribbon.tsx` → `editor/textfmt.ts` / `editor/edit.ts applySel` → `render/edits.ts` → `editor/painter.ts`. |
| Table geometry, drags | `editor/tables.ts`, `stage/drags.ts`, `stage/hit.ts`, `core/src/render/layout.ts`. |
| Liquid Glass look | `render/glass.ts` (`glassPlan`), `render/glass-dl.ts`, `render/wallpaper.ts`, themes in `model/style.ts`. |
| Excel look | `render/excel-dl.ts`, `xlsx/layout.ts`, `xlsx/numfmt.ts`. |
| Slide furniture | `render/slide-dl.ts`, `render/slide.ts`, `render/pagenumbers.ts`, `render/text.ts`. |
| A new drawing primitive | a node type in `core/src/dl/types.ts` drawn by **every** backend (`dl/svg.ts`, `dl/canvas.ts`, `pdf/writer.ts`); `npm run sp`. |
| Reading something new from workbooks | `xlsx/workbook.ts`, `xlsx/drawing.ts`, `xlsx/types.ts` – **and** the `.xlsb` reader (`xlsx/xlsb/`), with a twin in `tests/corpus/workbooks/xlsb/` (`tools/make-xlsb-twins.ps1`). |
| Automated comment wording | `model/comment.ts` (`writeSummary`, `writeComment`), options in `ui/CommentDialog.tsx`. |
| Deck options | `ui/Topbar.tsx`, `ui/TextStylesDialog.tsx`, `model/style.ts`, style keys in `model/ops.ts`. |
| Wizard | `wizard/Wizard.tsx`, `xlsx/detect.ts`, `xlsx/sheetview.ts`, `model/preset.ts`. |
| Saving, tailing, conflicts | `core/src/sync/docsync.ts`, `model/fold.ts`, `worker/host.ts`, `state/app.ts onWorkerDoc/onDocChange`, `helper/slidebuilder/decks.py`. |
| A message between page and workers | `core/src/rpc/messages.ts`, `worker/host.ts` or `export-host.ts`, `app/src/state/app.ts` / `rpc/export.ts`. |
| HTTP endpoint | `server.py` + `sync/api.ts` + `docs/ARCHITECTURE.md` + `test_http.py`. |
| Export | `editor/export.ts`, `rpc/export.ts`, `worker/export-host.ts`, `pdf/writer.ts`, `text/` (fonts, shaping, subsetting), `exports.py`. |
| Install / start / update | `*.bat`, `firstrun.py`, `main.py`, `selftest.py`, `tools/update.py`, `tools/make_release.py`. |

---

## 13. Security
127.0.0.1 only; `Host` check (DNS rebinding); a random token per start on every API call, compared in constant
time (other web pages cannot call the helper); `Origin` check; body limits; chunked bodies refused; files served
only by name inside their folder (`safe_path` refuses `..` and escapes; `/assets` images only, with a restrictive
`Content-Security-Policy`); uploaded fonts and exports checked by signature, logos by file extension; security headers on every
answer (`Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`); Excel conversion opens a read-only copy with macros (AutomationSecurity 3) and
alerts off; local requests bypass the proxy. TLS is never disabled.

---

## 14. Gotchas
1. **Never edit `helper/slide_builder.html`** – edit `app/src`/`core/src`, `npm run build`, commit both (a unit
   test and CI fail on a stale build).
2. **The stage, the thumbnails and the exports draw the same display list**: a change to how slides look goes into
   the core's `render/*-dl.ts`, never into page CSS – the slide rules at the end of `styles/app.css` are only for
   the overlays and the comment preview.
3. Anything new a display list draws needs a node type every backend draws (SVG, Canvas2D, PDF); `npm run sp`
   compares the PDF with the canvas, `npm run dlparity` the lists with the goldens.
4. Keep hot paths cheap: no per-cell listeners or elements; reuse per-table caches; include anything that changes
   how a table is drawn in its cache key, or the stage shows a stale table.
5. Hidden sheets stay hidden (user requirement). The workbook is never written.
6. Never write a whole shared document from a client; never treat an unreadable file as empty; the helper never
   interprets an operation.
7. Times on shared files come from the file server's clock (`fsclock.py`).
8. Corporate Windows: executables may not run from the share, TLS is intercepted (`NODE_OPTIONS=--use-system-ca`),
   consoles may be cp1252, PowerShell may be constrained (the start files use none), git on a share needs
   `safe.directory`, a folder path may contain `&` (quote it), local fonts in the browser need the user's
   permission (opened from disk).
9. The placeholder `__SB_TOKEN__` is replaced everywhere in the served page – never write it in code.
10. Controlled inputs reset on every re-render: inputs for shared settings use `ui/Field.tsx`; sliders, colour
    pickers and boxes that store their text without re-rendering use `ui/Input.tsx` (`onCommit` is the browser's
    `change`; React's `onChange` fires on every input).
11. Table sizes are **per design**: read them with `sizingOf`/`tableSizes`, write them with
    `sizingPatch`/`sizingChange`/`sizePatch` – never `cfg.layout`/`def.cols` directly. All of them and
    `computeLayout` live in `core/src/render/layout.ts`, shared by the worker and the page: a drag's preview and the
    slide drawn after it come from the same code.
12. Text is **measured from font files** in the core worker; the page measures only what has no readable file
    there. Anything that lays text out on the page as well (Liquid Glass column widths in a drag) must measure
    through `platform().text.width`, which both sides answer with the same widths.
13. A workbook reader change must cover `.xlsx` **and** `.xlsb` (`core/tests/xlsb.test.ts` compares them).
14. `Start Slide Builder (v3).bat` is in `tools/make_release.py` `ROOT_FILES` and `tools/update.py`
    `MISSING_ONLY`: removing the file alone is not enough (PLAN S6.5).

---

## 15. Known limitations and technical debt
* Charts are not redrawn; Excel data bars, colour scales and icon sets are not reproduced (Slide Builder's own
  colour scales are). Formulas are not recalculated.
* Cell edits are keyed by address: inserting rows above a table moves format edits (text edits pause and are
  listed in the side panel).
* Same field changed by two people at the same moment: the later in Lamport order wins. Two truly concurrent
  edits that straddle a compaction may resolve by arrival, and a page whose tails failed for longer than the
  30 s margin can bring back a value somebody replaced (nothing is lost; every page converges).
* Polling (1.5 s tail) instead of change notifications (PLAN S6.3, `ReadDirectoryChangesW`, not built).
* No shared parsed-sheet cache (PLAN S6.2, not built): every PC reads large workbooks itself.
* The offline mode (`file://`, localStorage) is for emergencies: no sharing, Excel conversions or upgrades.
* "Copy slide" is a picture. Opened from disk without the browser's local fonts, a PDF is made of pictures.
* Layout depends on each PC's fonts (fingerprint mode): another build of a font may wrap differently; copy mode
  (§6.10) removes this once switched on per share.
* A workbook chosen in the first moments after the page opens can be replaced by start-up's reopen of the last
  workbook (the reopen starts after the helper's first answers); decided to be fixed, not done yet.
* `.xls` and protected workbooks still need Excel on the PC; encrypted ones cannot be read at all.
* Field tests on the real environment (PLAN S0.6: Edge's capabilities, the Windows policy matrix W1–W14, W13 on two
  real PCs) were not run; they are watched after the cut-over (`docs/next/cutover.md` §4).
* Debt: `render/roles.ts` is used only by a test; `commentText` treats a missing `mode` as "sections" (legacy
  comments) while new comments default to "summary"; `convert.py` and `server.py` still default an unnamed
  conversion to `.xlsb`; `helper/README-helper.md` still names version 3.8.0 (its title and `VERSION`);
  `helper/slidebuilder/__init__.py` says `VERSION = "4.0.0"` until 4.1 is released; the HTTP server speaks
  HTTP/1.0 (one connection per request) and Chromium on the reference PC sometimes drops a loopback request
  (reads are asked again once); deck20's bench open is close to its 400 ms limit since 4.0 (open + first tail +
  fold) and occasionally fails CI on a cold first run.

---

## 16. Repository map

The files in git, folder by folder (generated corpora, goldens and fixtures summarised). On a share,
`app\<ver>\`, `app\current.json` and `backend\` sit next to these (§2.1); they are not in git.

### Top level
```
/                                      ROOT (the shared folder)
├─ Install Slide Builder.bat           first-time set-up on a PC (--install)
├─ Start Slide Builder.bat             starts app\current.json's version, else helper\ (no PowerShell)
├─ Start Slide Builder (v3).bat        the newest 3.x in app\ on port 8785 (removed in PLAN S6.5)
├─ Update Slide Builder.bat            tools\update.py
├─ README.md · CHANGELOG.md · PROGRESS.md   this guide · user-visible changes · the rebuild's steps and numbers
├─ package.json · package-lock.json    npm workspaces app/ and core/ (developers only)
├─ .gitattributes · .gitignore         LF everywhere, .bat CRLF · ignores data, app\<ver>\, workbooks, build output
├─ .github/workflows/ci.yml · release.yml
├─ shared/ops-vectors.json             operation and fold test vectors
├─ tests/corpus/                       workbooks/ (+ xlsb/ twins), decks/ (op lists), assets/, pixels.json, README.md
├─ tests/parity/accepted.json          parity differences accepted by a person
├─ golden/                             v3.4.0's slides per deck/design/version (never edited; MANIFEST.json, README.md)
├─ review/                             gate packages and milestone walks (G1, S4.4, M3a, M3b, M4)
├─ spikes/                             design-phase experiments (baseline, parser, pdfwriter, fonts, storage)
├─ docs/  tools/  helper/  core/  app/  see below
```

### `helper/` – the helper (§7)
```
helper/
├─ slide_builder.py                    entry point (→ slidebuilder.main)
├─ slide_builder.html                  BUILT page (npm run build); never edit by hand
├─ README-helper.md                    the helper's command line, modules, tests
├─ slidebuilder/                       __init__ (VERSION) · main · server · paths · util · fsclock · locks · store ·
│                                      upgrade · decks · migrate_v3 · migrate · workbooks · fonts · sysfonts ·
│                                      exports · convert · firstrun · selftest · simfs (§7.2)
└─ tests/                              unittest: test_<module>.py, sbtest.py, workers.py (multi-process),
                                       v3/ (v3.6.0's fonts.py), fixtures/saved/ (released data formats)
```

### `app/` – the browser app (§5)
```
app/
├─ package.json · tsconfig.json · slide_builder.html (Vite entry) · vite.config.ts (single file + worker string)
├─ vitest.config.ts                    projects "unit" (node) and "react" (jsdom)
├─ playwright.config.ts                two helpers = two users (anna, bob) on one temp folder
├─ src/
│  ├─ main.tsx                         platform, CSS, <App/>, keyboard, boot()
│  ├─ platform/index.ts                the core's platform in the page (canvas text, canvases)
│  ├─ rpc/                             client.ts (core worker) · export.ts (export pool) · core-worker.d.ts
│  ├─ sync/api.ts                      the helper's API; offline backend (file://)
│  ├─ state/                           store.ts · app.ts · dialogs.ts · fonts.ts · fontfiles.ts
│  ├─ stage/                           Stage.tsx · SlideSvg.tsx · data.ts · patch.ts · model.ts · hit.ts · drags.ts ·
│  │                                   actions.ts · editors.tsx
│  ├─ editor/                          edit · tables · textfmt · painter · keys · thumbs · export · feedback · issues
│  ├─ ui/                              App · Chrome · Topbar · Ribbon · TableTools · Dialogs · TablesDialog ·
│  │                                   TextStylesDialog · CommentDialog · Dropdown · FontPicker · Input · Field · hooks
│  ├─ wizard/Wizard.tsx                1 Sheets · 2 Tables · 3 Slides · 4 Versions
│  └─ styles/                          ui.css · app.css
├─ tests/                              Vitest (*.test.ts node, *.test.tsx jsdom; setup-console.ts, setup-platform.ts,
│                                      core-worker-stub.ts); fixtures/ (generated .xlsx, make_fixtures.py)
└─ e2e/                                app.spec.ts · file.spec.ts · open.spec.ts · pdftext.ts
```

### `core/`, `tools/`, `docs/`
```
core/            package.json · tsconfig.json (ES2022 + WebWorker, no DOM) · vitest.config.ts · vitest.bench.config.ts
├─ src/
│  ├─ platform.ts · index.ts           what the core needs from its host
│  ├─ rpc/                             port.ts (typed postMessage RPC) · messages.ts (every message)
│  ├─ worker/ · workers/               host.ts, export-host.ts · main.ts, core.worker.ts, export.worker.ts
│  ├─ sync/                            docsync.ts · history.ts
│  ├─ xlsx/                            workbook · sheetstore · zip · xml · strings · slice · mirror · sheetview · detect ·
│  │                                   layout · numfmt · color · drawing · types · util · xlsb/ (records, workbook,
│  │                                   styles, strings, sheet, formula)
│  ├─ model/                           types · ops · fold · preset · style · comment · fonts
│  ├─ render/                          slide-dl · slide · excel-dl · glass · glass-dl · layout · edits · text · comment ·
│  │                                   cover · pagenumbers · scales · wallpaper · context · roles
│  ├─ dl/                              types · svg · canvas · geom · color · key
│  ├─ text/                            fonts · hb · shape · measure · lines · kern · outline · family · resolve · pdf ·
│  │                                   subset · static · fvar · sha1 · README.md · wasm/ (harfbuzzjs 0.4.12)
│  ├─ pdf/                             writer · png · ttf · README.md
│  └─ pptx/                            scene · drawingml · chart · writer · README.md
├─ tests/                              Vitest (node; jsdom in dl and xml only), fixtures/
└─ bench/parse.bench.test.ts           npm run bench -w core: big30 parse time and memory
tools/
├─ update.py · make_release.py         updater (§7.5) · release ZIP + MANIFEST.json, --verify, --notes
├─ parity.mjs · capture-v3.mjs · stage-capture.mjs · dlparity.mjs · dlcheck.mjs   parity and screen = PDF checks
├─ bench.mjs · calibrate.mjs           the page in Chromium (npm run bench) · machine speed for the time limits
├─ benchgate.mjs                       how every bench gate decides (on CI: a timing gate over twice fails)
├─ export-check.mjs · export-dl.mjs · g1-package.mjs · s44-package.mjs · textref.mjs · sysfonts.mjs
├─ pdfcheck.py · pdftext.py            PDF checks and text (dev only: pypdf, pypdfium2, qpdf)
├─ make_corpus.py · anonymise.py · make-xlsb-twins.ps1   corpus workbooks · scramble a real one · .xlsb twins (Excel)
├─ loadtest4.py · sharetest.py · fieldcheck.html   load test · field test of a share · browser capabilities
├─ cutover-rehearsal.mjs · vendor-harfbuzz.mjs     the 3.8 → 4.0 dry run · re-vendor HarfBuzz's WASM
docs/
├─ ARCHITECTURE.md · RENDERING.md                  the contract · how slides are drawn
├─ v3/                                             kept for history: Slide Builder 3's README.md and ARCHITECTURE.md,
│                                                  LOADTEST.md (load tests; v4 summary at the top), REVIEW.md (the v2
│                                                  review), MIGRATION-PROMPT.md (the rebuild brief)
└─ next/                                           the Slide Builder 4 rebuild: 00-summary … 06-plan, PLAN.md,
                                                   PROMPTS.md, adr/001–012, cutover.md, release-checklist.md,
                                                   pilot-export.md, review-pre-M3.md, field-results.md, field/
```
