# Slide Builder

Slide Builder turns tables in Excel workbooks into 16:9 presentation slides and exports them as vector
PDFs (one page per slide) or PNGs. It was built for a weekly banking report deck and runs on
**locked-down corporate Windows PCs**: no admin rights, nothing installed beyond Python, Edge DevTools
possibly disabled by policy, an SSL-inspecting proxy, and the application living in a **shared network
folder (SMB)** that several people use **at the same time, on the same or on different workbooks**.

This README is written for a software engineer who has to understand, run, change or replace the whole
system. It explains what the product does (§1), how it is deployed and run (§2), the architecture (§3),
the data model (§4), every front-end and back-end module (§5, §7), the important flows end to end (§6),
the HTTP API (§8), concurrency and failure handling (§9), the export engine (§10), development and tests
(§11), recipes for common changes (§12), security (§13), and known gaps (§14–§15).

| Deeper document | Read it for |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | **the binding contract**: saved files, every field of the document, every operation and its merge semantics, locking protocol, full HTTP request/response shapes, format versions |
| [`docs/RENDERING.md`](docs/RENDERING.md) | the workbook reader and the three designs in algorithmic detail (Liquid Glass scene model) |
| [`docs/LOADTEST.md`](docs/LOADTEST.md) | 10 simulated users on a shared folder: measured costs, bottlenecks, options |
| [`docs/REVIEW.md`](docs/REVIEW.md) | review of the previous generation (v2) and why the current architecture was chosen (and why not Next.js) |
| [`docs/MIGRATION-PROMPT.md`](docs/MIGRATION-PROMPT.md) | brief for designing a full rebuild on a new local stack |
| [`docs/next/`](docs/next/00-summary.md) | **design of the rebuild (Slide Builder 4)**: summary, measured baseline, options, architecture, migration, test/parity plan, phased plan, ADRs; spikes in `spikes/` |
| [`backend/README-backend.md`](backend/README-backend.md) | helper command line, module table, environment variables |

**Contents** — [1 Product](#1-what-the-product-does) · [2 Deployment](#2-deployment-and-running-it) ·
[3 Architecture](#3-architecture) · [4 Data model](#4-data-model) · [5 Front end](#5-front-end-frontendsrc) ·
[6 Flows](#6-key-flows-end-to-end) · [7 Back end](#7-back-end-the-helper-backendslidebuilder) ·
[8 HTTP API](#8-http-api) · [9 Concurrency](#9-concurrency-and-failure-model) ·
[10 Export engine](#10-export-engine) · [11 Development](#11-development-and-tests) ·
[12 Recipes](#12-where-to-change-what) · [13 Security](#13-security) · [14 Gotchas](#14-gotchas) ·
[15 Limitations and tech debt](#15-known-limitations-and-technical-debt) · [16 Repository map](#16-repository-map)

---

## 1. What the product does

A user opens a workbook from the shared folder. A wizard picks sheets and tables and arranges them on
slides. The tables are then drawn in one of three **designs**, edited on the slide like in Excel, and
exported. Everything a user changes is stored **beside** the workbook (`backend/data/`); the workbook is
never modified. Several users can work on the same deck simultaneously.

### 1.1 Feature reference

**Workbooks**
* `.xlsx/.xlsm` are read in the browser; `.xlsb/.xls` (and IRM-protected files) are converted to `.xlsx`
  by the installed Excel (COM) on Windows. Hidden sheets are skipped on purpose (user requirement).
* Reads values (cached formula results – formulas are **not** recalculated), number formats (Italian
  separators by default, locale tags, dates), fonts, fills, borders, merges, hidden rows/columns,
  conditional formatting (`cellIs` and simple `expression` rules), rich-text **superscripts/subscripts**,
  pictures (incl. EMF/WMF via conversion), shapes and text boxes.
* Tables are found by **"x" markers** in the top-left and bottom-right corners of a region (the marker row
  and column are outside the table), or picked as ranges in the wizard (optionally "grows" to follow new
  rows).

**Wizard** (✦ Wizard, 4 steps): 1 sheets → 2 tables (drag/type ranges on a sheet preview, Shift+arrows,
Enter adds, detected suggestions) → 3 slides (drag tables between slides; optional cover and contents
slide; logo per slide) → 4 **versions** (named variants of the deck in which chosen cells are removed,
e.g. *Chief* = everything, *All* = some cells blanked).

**Designs** (top bar: *Liquid Glass · Excel · Excel Refined*)
* **Excel** – raw Excel: the workbook's own formatting, nothing added (no text boxes, comments or notes
  section; no deck colours on tables). Title, logo, page number and footer stay.
* **Excel Refined** – the same tables drawn exactly like Excel, **plus** text boxes, automated comments
  and the notes section.
* **Liquid Glass** – a light iOS-style design: the table structure (header bands, boxes, rules, signals)
  is inferred from the workbook and redrawn as translucent glass cards, capsules and hairlines over a
  theme wallpaper.
* **Per-design looks**: Design… › *Apply to: This design only / All designs*. Each design can have its
  own theme, colour overrides and text styles.
* **Per-design table sizing**: column widths, row heights, table size and position, alignment, *Make same
  size*, *Reset layout* and fixed scales belong to the design they were made in.

**Text** – one toolbar (first ribbon row) formats whatever text is selected: cells, a text box, the
title, subtitle, cover note or date. *Text styles…* sets every text of a kind deck-wide (titles,
subtitles, tables, text boxes, contents, page numbers/footer). **Fonts**: Windows fonts, any Google Font
(downloaded once into the shared folder) and uploaded font files (.ttf/.otf/.woff/.woff2).

**Cell editing (Excel-like)** – click/drag/Shift-select, type or F2 to edit, Enter/Tab, Del, Ctrl+B/I,
Ctrl+Z/Y (undoes **only your own** changes), PgUp/PgDn. Text size/bold/italic/colour/alignment, role
(header/total/body/note), **cell colour** (replaces the Excel fill), **highlight** (a capsule in Liquid
Glass), merge/unmerge, restore the Excel text, **format painter** (also copies conditional formatting
and colour scales).

**Tables** – drag column/row borders (double-click = Excel size) or type W/H; drag a table border to
stretch, the corner to scale, the grip to move next to/above/below another table; *Same size* across
tables and slides; align left/centre/right and top/middle/bottom; gridlines on/off per direction;
**colour scales** (deeper green/red with the size of the number, per row/column/range).

**Text boxes** – above/below/left/right of a table (the **+** buttons), or beside all tables ("span");
draggable anywhere with snapping guide lines; stretchable; optional bubble; markup `# title`,
`## heading`, `**bold**`, `[[+12,3]]` (green/red by sign); line and paragraph spacing. The **notes
section** is a text box of the slide itself (sources, footnotes), starting where the footer is.

**Automated comments** (✎ Comment…) – an analyst-style text written **live** from the table's numbers:
* *Summary* (default): one short paragraph per block (sub-tables are detected), joining previous week,
  Budget and EoM – how good the week was, who drove it, who offset it, the plan gap and how much the
  week closed. One comment can cover several tables of the slide.
* *Detailed*: one section per comparison found in the headers ("Δ vs. Budget", "vs. Prev. Week"…).
* Amounts carry a unit ("+476 **mln**" by default); title, names and bullets can be switched off.
  Editing a comment's text by hand turns it into fixed text.

**Versions** – Top bar › *Version* shows the deck as any version; removed cells are drawn empty
(value, colour, highlight; comments ignore them). Export ▾ › every version (× Liquid Glass + Excel, or ×
all three designs) → one PDF each, `<workbook> - <version> - <design>.pdf`.

**Deck** (shared by everyone on the workbook) – design, glass strength, background colour strength,
colour theme (Aurora, Ocean, Forest, Sunset, Graphite, Intesa Sanpaolo, Custom), corner roundness,
contrast, logo (file, bubble, hidden per slide), page numbers (position, font, size, format, style,
start, cover), footer (`{date}`, `{workbook}`, `{title}`). *Use as default for new decks*.

**Export** – PDF *text & tables* (vector, default), PDF *as pictures* (lossless PNG pages, file name
"(images)"), current slide PDF/PNG, all slides PNG, copy slide to clipboard, every version. PDFs are one
unscaled slide per page (1200 × 675 pt), checked before saving, light enough for Acrobat (§10).

**Working together** – changes are merged field by field; others' changes appear within ~3 s with their
name; presence shows who else is in the workbook; typing is never overwritten by autosave or others'
changes. **Updating**: `Update Slide Builder.bat` pulls the new version from GitHub into the shared
folder without touching saved setups; saved data in an older format is converted automatically.

---

## 2. Deployment and running it

### 2.1 Physical layout
```
T:\Slide Builder\                          ROOT – the shared folder users see
├─ Install Slide Builder.bat               first-time set-up on a PC → backend\slide_builder.py --install
├─ Start Slide Builder.bat                 start the helper + open the app → app\<current>\backend\ or backend\slide_builder.py
├─ app\current.json  app\<ver>\            side-by-side program versions (tools\update.py --release, §7.5)
├─ Update Slide Builder.bat                update the program from GitHub → tools\update.py
├─ *.xlsx …                                users' workbooks (not in git)
├─ export\                                 exported PDFs/PNGs (not in git)
├─ engine\                                 Chrome for Testing headless shell (optional, not in git)
└─ backend\
   ├─ slide_builder.py                     entry point
   ├─ slide_builder.html                   THE APP: one self-contained HTML file built from frontend\
   ├─ slidebuilder\                        the helper package (Python standard library only)
   └─ data\                                ALL saved state (not in git) – §4.1
```
Every user runs **their own helper** on their own PC (`Start Slide Builder.bat`). The helper listens on
`http://127.0.0.1:8765/` (next free port up to +20; if a Slide Builder already answers there, it just
opens the app) and serves the app page with a random per-start token injected. The helpers never
talk to each other: **the shared folder is the only channel**, coordinated with lock files (§9).

### 2.2 Who does what
| Who | What |
|---|---|
| User, first time on a PC | `Install Slide Builder.bat`: Python ≥ 3.8 check, pip/ensurepip, optional `playwright` package (`--user`; behind SSL inspection retried with `--use-feature=truststore`, never `--trusted-host`), export engine (Chrome for Testing downloaded with Python `urllib`; on a network share it is placed in `%LOCALAPPDATA%\SlideBuilder\engine` because executables may not run from the share), shared-folder check (lock file, `export\` write, round-trip time; > 30 ms warns), desktop shortcut (`.lnk`, or a `.bat` if PowerShell is restricted), self-test. No admin rights; idempotent. Code: `backend/slidebuilder/firstrun.py`, `installer.py`. |
| User, daily | `Start Slide Builder.bat` (or the shortcut). Keep the console window open. The app opens in an Edge app window (`msedge --app=<url>`, no tabs or address bar; a normal browser tab when Edge is missing; `SLIDEBUILDER_APP_WINDOW=0` forces the tab). |
| One person, to update everyone | `Update Slide Builder.bat` (§7.5). Everybody then restarts Slide Builder and reloads the page. |
| Export engine only | status pill "Export: …" → *Install export engine*, or `backend\Install export engine.bat` (`--setup`). |
| Developer | §11. Users never need Node.js: the built `backend/slide_builder.html` is committed. |

### 2.3 Upgrading from v2
If `backend\slide_builder_settings.txt` (v2's single settings file) exists, the first v3 helper imports it
once under a lock (presets, cell edits, style → shared defaults, last file → preferences), never
overwriting existing documents, and renames it `slide_builder_settings.v2-backup.txt`
(`backend/slidebuilder/migrate.py`).

---

## 3. Architecture

```
┌──────────────── browser tab: backend/slide_builder.html (ONE self-contained file, Preact + TS) ───────────────┐
│ xlsx/    unzip (JSZip) + regex sheet parser, styles, number formats, conditional formats, drawings,           │
│          "x" table regions, per-cell geometry (TableLayout)                                                    │
│ model/   persistent types · operations (+ inverses) · preset → runtime slides · style layering & themes ·      │
│          automated comment analysis/writing · font catalogue                                                    │
│ render/  edits on top of the workbook · Excel design · Liquid Glass scene model · slide layout & composition ·│
│          cover/contents · page numbers/footer · wallpaper · comment text · PDF-ready CSS                         │
│ sync/    HTTP client (token, formats) · DocSync (optimistic ops, batching, retry, polling) · offline store     │
│ state/   global app state S · actions (open, change, undo, doc changes, presence) · dialogs · font library      │
│ editor/  stage (imperative DOM: hit testing, selection, inline editors, drags, snapping) · tables · painter ·   │
│          unified text toolbar · keyboard · thumbnails · export · side-panel issues                              │
│ ui/, wizard/   Preact chrome: top bar, ribbons, dialogs, 4-step wizard                                          │
└──────────────▲──────────────────────────────────────────────────────────────────▲──────────────────────────────┘
               │ HTTP on 127.0.0.1 (X-SB-Token, X-SB-Formats)                       │ slide HTML + CSS for exports
┌──────────────┴──────────── helper: backend/slidebuilder (Python ≥ 3.8 standard library) ──────────┴──────────────┐
│ server (routing, Host/Origin/token/format checks) · store (documents, upgrades, backups) · ops (same semantics  │
│ as the front end) · locks + fsclock (O_EXCL lock files, file-server clock) · presence · workbooks (stable reads)│
│ fonts · exports + engines (Playwright → DevTools → command line; output checks) · pdf (writer, page fitting) ·  │
│ convert (Excel COM, GDI+) · migrate (v2) · upgrade (format versions) · firstrun/installer                       │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
        one helper per PC  ⇄  the same shared folder (SMB): workbooks, backend/data/, export/ — the only channel
```

**Design principles**
1. **All parsing, layout and rendering happen in the browser.** The helper moves bytes, stores documents,
   merges operations under file locks, and drives a headless browser for exports. Exports print **the
   same DOM** the user sees (built by the same `buildSlide`).
2. **Documents change only through operations** (`preset.set`, `slide.patch`, `table.patch`,
   `cell.patch`, `style.patch`) with field-level merge semantics, implemented twice (TypeScript
   `model/ops.ts`, Python `ops.py`) and kept identical by `shared/ops-vectors.json`, which both test
   suites run. Clients never write whole documents.
3. **Optimistic local application, server-side merge.** The page applies ops immediately, sends them in
   batches; the helper applies them to the *latest* document under the workbook's lock; the page rebases
   its pending ops on the result (§6.3).
4. **The workbook is never modified**; user changes are keyed by sheet and cell address.
5. **No runtime dependencies on users' PCs**: one HTML file + standard-library Python (Playwright and a
   Chrome for Testing copy are optional accelerators for exports).
6. **Never lose data**: atomic writes, unreadable files are never replaced by empty ones, unsent ops are
   kept and retried, every format change is a versioned upgrade with a backup.

**Why not a server app?** There is no server: no admin rights, no hosting, only a shared drive. A local
helper per PC plus files on the share is the only deployable topology (see `docs/REVIEW.md` §6).

---

## 4. Data model

### 4.1 What is saved where (`backend/data/`, never in git)
```
data/
├─ config.json                     shared defaults for new decks         {schema:3, rev, updated, updatedBy, defaults:{style}}
├─ workbooks/<key>.json            ONE document per workbook (§4.2)
├─ users/<user>.json               personal preferences                  {schema:1, lastFile, pdfMode, zoom, versions}
├─ fonts/fonts.json + font files   shared font library                   {schema:1, fonts:[{family, source, faces[], by, at}]}
├─ assets/                         logos uploaded via Options › Logo
├─ presence/<user>@<host>.json     heartbeats (who has which workbook open)
├─ locks/<name>.lock               lock files (short-lived)
├─ migrated.json                   marker: v2 settings were imported
├─ app-version.json                installed version (ZIP updates only)
└─ backups/
   ├─ <key>/<rev>.json             rolling copies of each workbook document (last 30, ≤ 1 per 5 min)
   ├─ upgrades/<kind>/<file>.v<n>.<time>.json   a file as it was before a format upgrade (kept)
   └─ before-update-<time>/        saved setups (+ replaced program files) before each update (last 5)
```
`<key>` = workbook file name with `[^A-Za-z0-9._-]` → `_` (max 60 chars) + `-` + first 10 hex chars of
`sha1(name.lower())` (`util.doc_key`). Lower-casing matches Windows' case-insensitive names.

### 4.2 The workbook document
```jsonc
{
  "schema": 3, "workbook": "IBD weekly.xlsx",
  "rev": 42,                         // +1 per successful batch of ops (helper)
  "updated": 1791214363000,          // ms, file-server clock
  "updatedBy": "rossim", "log": [{"rev": 42, "by": "rossim", "at": …}],   // last 20
  "backupAt": 1791214000000,         // when the last rolling backup was taken (saves never list the folder)
  "preset": {                        // null = no setup yet (the wizard creates one)
    "sheets": ["SLIDE_1", …],
    "tables": [ {"id": "k3j9x0a", "sheet": "SLIDE_1", "kind": "markers", "anchor": "C3", "index": 0,
                 "name"?, "cols"?, "rows"?, "sizes"?: {"glass"|"excel"|"clean": {cols?, rows?}},
                 "scales"?, "merges"?, "gridH"?, "gridV"?},
                {"id": "p0q8z1b", "sheet": "Detail", "kind": "range", "range": "A2:K20", "grow": true} ],
    "slides": [ {"id": "c1", "type": "cover", "title": "IBD Weekly", "date": null, "note": "…", "tables": []},
                {"id": "i1", "type": "index", "subs"?: false, "tables": []},
                {"id": "s1", "type": "content", "tables": ["k3j9x0a"], "logo"?: false,
                 "layout"?, "scale"?, "align"?, "valign"?,            // shared sizing of older decks
                 "sizes"?: {"glass"|"excel"|"clean": {layout?, scale?, align?, valign?}},
                 "notes"?: {"k3j9x0a:right": Note, "slide:notes": Note},
                 "fmt"?: {"title"|"subtitle"|"note"|"date": TextFmt}} ],
    "versions"?: [{"id": "v1", "name": "All", "hide": {"SLIDE_1": ["H10:I11"]}}]
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
* `CellEdit`: `text` + `orig` (the Excel text it replaced – a text edit applies only while the Excel value
  is still `orig`), `bg` = cell colour (replaces the Excel fill, `"none"` removes it), `fill` = highlight,
  `cf = "Sheet!C6"` = conditional formatting painted from another cell (`"none"` removes the cell's own).
* **Effective style** = built-ins ← `config.defaults.style` ← `doc.style`, then each layer's
  `designs[<current design>]` on top (`model/style.ts resolveStyle`).
* **Effective sizing** of a slide/table in a design = its own `sizes[design]` entry if present (even
  empty), else the shared `layout/scale/align/valign` or `cols/rows` of older decks
  (`render/slide.ts sizingOf`, `model/preset.ts tableSizes`).
* The full field table is `docs/ARCHITECTURE.md` §3; the TypeScript types are `frontend/src/model/types.ts`.

### 4.3 Operations
| op | fields | plain keys (`null` deletes, else set) | map keys (map merge) |
|---|---|---|---|
| `preset.set` | `preset` | replaces `doc.preset` (wizard) | – |
| `slide.patch` | `id`, `patch` | title, subtitle, date, note, logo, layout, align, scale, valign, subs | notes, fmt, sizes |
| `table.patch` | `id`, `patch` | name, gridH, gridV | cols, rows, scales, merges, sizes |
| `cell.patch` | `sheet`, `ref` (A1), `patch` | text, orig, font, sz, b, i, color, fill, bg, cf, align, role | – |
| `style.patch` | `patch` | design, glass, color, logo, radius, contrast, logoBubble | pn, footer, theme, text, colors, designs |

**Map merge**: `null` deletes the whole map; an object sets each entry (replacing the entry whole, no
deep merge) or deletes it when `null`; an empty map is removed. So two people changing different
columns, text boxes, rules or designs never overwrite each other; the same field at the same time → last
write wins. Unknown ops, invalid fields, unknown slide/table ids are **skipped** (reported by index). A
batch with ≥ 1 applied op increments `rev` and sets `updated`/`updatedBy`. `config.json` accepts only
`style.patch` (applied to `defaults.style`). The client computes an **inverse** op for each op before
applying it (`model/ops.ts inverseOf`) – that is the undo.

### 4.4 Format versions (`schema`)
Current formats: `SCHEMA = {workbook: 3, config: 3, prefs: 1}` (`backend/slidebuilder/upgrade.py`) =
`FORMATS` (`frontend/src/model/types.ts`; a test checks they match). On every read (`store._load`):
* **older file** → under its lock, re-read, copy to `backups/upgrades/…`, apply `@step(kind, n)`
  functions n → n+1 in order, write atomically. Exactly once even with several PCs. `store.upgrade_all()`
  converts every file at start-up.
* **newer file** (written by an already-updated PC) → never changed; HTTP 409 "restart Slide Builder".
* Pages send `X-SB-Formats` with every write; a mismatch → 409 → the page shows "Slide Builder was updated
  – reload the page" and stops writing (its pending ops stay queued).
* Optional new fields need **no** format change (readers ignore unknown keys; missing = default).
  `backend/tests/fixtures/saved/` keeps a real example of every released format; never edit them.

---

## 5. Front end (`frontend/src`)

TypeScript, Preact for the chrome, imperative DOM for slides (for speed). Runtime dependencies: `preact`,
`jszip`. Built by Vite + `vite-plugin-singlefile` into `backend/slide_builder.html`. `main.tsx` injects
`ui.css`+`app.css` as `<style id="uicss">` and `slide.css` as **`<style id="slidecss">`** (exports send
exactly this text), mounts `<App/>`, installs the keyboard handler and calls `boot()`.

### 5.1 `xlsx/` – reading workbooks
| File | Responsibility |
|---|---|
| `workbook.ts` | `indexWorkbook(buf)`: sniff (`D0CF11E0` → `CFB` = .xls/encrypted, `.bin` part → `XLSB`, not zip → error), JSZip, sheet list (hidden and chart sheets skipped), uncompressed sizes; `big` when > 12 MB sheet XML or > 6 MB file. `wb.ensure(names)` parses sheets lazily: `loadShared` once (theme, shared strings with rich-text runs, styles, number formats, fonts, fills, borders, `cellXfs`, `dxfs`, max digit width measured on a canvas), `readSheet` = **regex parser** over the XML string (no DOMParser for `sheetData`; yields every 4000 rows), merges, conditional formats, drawings, `findRegions`. `makeSheet` adds geometry methods (`colPx` = Excel's width formula, `rowPx` = pt × 96/72, cumulative offsets, `cellAt`). |
| `layout.ts` | `findRegions(S)`: pairs "x" markers (top-left with the nearest bottom-right whose rectangle holds no other marker). `buildLayout(S, g, sizes)` → **`TableLayout`**: visible rows/cols, x/y/w/h maps (user sizes applied), one `Item` per cell or merged block (`effectiveMerges` = workbook merges − user splits + user merges), borders (shared edges → heavier style), fonts, fills, number-format text and colour, alignment, text overflow into empty neighbours, conditional formatting (`evalCF`, also with `from` for painted formats), pictures/shapes/text boxes (hidden rows/cols collapse anchored objects). |
| `numfmt.ts` | `formatValue(cell)`: Excel number formats → text (sections, colours, locale tags, %, fractions, exponents, thousands scaling, General, dates/times incl. elapsed and Italian names). Separators: "." thousands, "," decimals. |
| `drawing.ts` | `readDrawing`: anchors (two/one/absolute), groups, crop, rotation/flip, SVG preferred, EMF/WMF/TIFF via the helper (`setPictureConverter`), shapes and text boxes, charts listed (not drawn). `analyzeImages` samples each picture (round badge, white background → keyed transparent copy) for Liquid Glass. |
| `color.ts` | Excel colour resolution (theme, indexed, tint in HSL) and colour maths (`lum`, `tone` = pos/neg/…, `fillClass`). |
| `types.ts`, `util.ts` | `Sheet`, `Cell`, `Item`, `TableLayout`, `Workbook`…; A1 helpers, `zget` (case/%-tolerant zip lookup), `hashStr`, `uid`. |

### 5.2 `model/` – persistent data and pure logic
| File | Responsibility |
|---|---|
| `types.ts` | **All persistent types** (§4) + `FORMATS`, `Op`, and the runtime `RuntimeSlide = {id, type, cfg: SlideDef, tables: TableLayout[], title, subtitle, label, missing}`. |
| `ops.ts` | `applyOp/applyOps` (the semantics of §4.3), `inverseOf` (undo), `emptyDoc`. Mirrors `backend/slidebuilder/ops.py`. |
| `preset.ts` | `resolveTable(wb, def, design)` (marker or range table → `TableLayout`, with that design's sizes; **`LCACHE`** keyed by sheet + region + def + sizes/merges + workbook identity), `tableSizes(def, design)`, `runtimeSlides(wb, preset, name, design)` (titles fall back to the sheet's A1, subtitles to A2), `defaultPreset(wb)` (one slide per sheet named "*slide*" with marker tables), `growG` (growing ranges). |
| `style.ts` | Built-in style, `resolveStyle(...layers)` (scalars, `pn`/`footer` per field, theme/colours/text per entry, then per-design looks, clamping), themes (`THEMES`, `themeOf`), `palette(style)` (theme defaults + overrides), `COLOR_KEYS` (what Design… offers per design), `cleanFmt`, `mix`. |
| `comment.ts` | Automated comments, pure functions over a `Grid` of displayed cells: `analyse(grid)` finds the label column, data rows, headers, **comparison groups** (a header matching Δ/vs/var/delta… with Abs. and % columns, classified week/target/month/quarter/year/yoy by regex), latest period, total rows, entities and **blocks** (a bold or "Total…" row with the rows under it). `writeComment` (sections mode) and `writeSummary` (summary mode: facts joined with "·", a judgement word from the week's % (thresholds 1 % and 0.3 %), drivers and offsets with materiality, plan gap closure). `shapeComment` applies layout options and the unit (`withUnit`, default "mln"). |
| `fonts.ts` | Font catalogue (`SYSTEM_FONTS`, `GOOGLE_POPULAR`), `fontStack`, `@font-face` generation, `readFontInfo` (family/weight/italic from the sfnt `name`/`OS/2` tables, WOFF inflated), Google CSS parsing (latin subsets). |

### 5.3 `render/` – from layouts to HTML
| File | Responsibility |
|---|---|
| `context.ts` | `RenderCtx = {style, edits, slides, preset, workbook, logoSrc, version?, forExport?}` (rebuilt when the document changes) and **`tableKey(ctx, L)`** – the master cache key (sheet edits, table def incl. sizes/scales/merges/gridlines, radius, table font, version hides, colours, theme). |
| `edits.ts` | `effItems(L, ctx)` = the workbook items with everything the user changed: **version blanking** (cells in `version.hide` → empty, no fill, `removed`), gridlines, colour scales, painted conditional formats, cell edits (text only while `orig` matches), cell colour vs highlight, roles. `cache(L, name, key, make)` = the per-table cache (`L._cache`). |
| `excel.ts` | `renderExcel`: absolutely positioned divs (box layer: fills/borders; text layer: fonts, alignment, indent, rotation, `<sup>/<sub>`), shapes, text boxes, pictures. Used by **Excel and Excel Refined**. |
| `glass.ts` | Liquid Glass: `glassGeom` (columns widened for the system font, user-fixed columns kept), `buildScene` (grid → surfaces by union-find of structural fills, frames/grids from borders, rules, texts, signals (CF fills, highlights, green/red status), media; containment tree), `inferRoles` (heading/section/label/value/emphasis/caption, implicit cards, table detection with automatic separators), `renderGlass` (materials by fill class and depth, tinted glass, capsules, hairlines, ink colours). Details: `docs/RENDERING.md` §2.3. |
| `slide.ts` | Slide composition. `areaFor` (content area 50…1550 × 104/126…822, pushed by large titles), `defaultLayout`/`layoutOf`, **per-design sizing** (`sizingOf`, `sizingPatch`, `sizingChange`, `fixedScale`), `notesOf` (none in raw Excel; automated comments get their text here), **`computeLayout`** (§6.6), `tableHtml` (cached per design/glass level/tableKey), **`buildSlide`** (CSS variables, wallpaper, title or cover, contents, page number, footer, tables, text boxes, notes section, editing handles, logo), `applyLayout` (positions + `placeGlass` = aligns each glass element's blurred wallpaper), `fitNotes` (shrinks text box fonts to fit, measured off-screen). |
| `text.ts` | Deck text styles under per-slide formatting (`slideTextFmt`, `effNote`, `fmtCss`), `titleGeom`, text box markup (`richText`). |
| `comment.ts` | `gridOf(L, ctx)` (displayed values, removed cells → null), `analysisOf`, `commentText(L, cfg, ctx, R)` (all tables covered by the comment). |
| `cover.ts`, `pagenumbers.ts` | Cover and contents slides (page numbers of the content slides); page number and footer placement (avoid the logo, share corners). |
| `scales.ts` | Colour scale computation (`applyScales`, `scaleColors`). |
| `wallpaper.ts` | `makeWall(style)`: paints the theme wallpaper on a canvas (gradient, blobs, ribbons, grain; contrast baked in) → `<style id="wallcss">` with `--wall`, `--wallblur` (half-size blurred copy sampled by glass cards), `--wallbase`. |
| `printcss.ts` | `printReady` / `PRINT_CSS`: makes slides light for vector PDF (blurred shadows → stepped sharp layers, variable fonts → classic, glass rim mask → border). §10.3. |
| `roles.ts` | `rolesOf` (header/total/body rows) – used only by a unit test today (was the old Excel Refined renderer). |

### 5.4 `sync/`, `state/` – data flow
| File | Responsibility |
|---|---|
| `sync/api.ts` | The `Backend` interface; `helper` (HTTP: adds `X-SB-Token` from `<meta name="sb-token">` and `X-SB-Formats`; `ApiError`) and `offline` (localStorage, for a page opened as `file://`). `backend = SERVED ? helper : offline`. |
| `sync/docsync.ts` | **`DocSync`**: `server` doc + `inflight` + `pending` ops → `view`. `apply(ops)` (local, returns inverse), `flush()` (one request in flight, 300 ms debounce, retry 2–32 s, 409 → `outdated`), `poll()` (`?since=rev`, rebase), `on(listener)` with `Change {local, by, presetChanged, styleChanged, editsChanged}`. |
| `state/store.ts` | The global mutable state **`S`** (health, user, prefs, config, file, wb, sync, slides, cur, version, selections `sel`/`noteSel`/`textSel`, painter, zoom, undo/redo, toast, busy…), `emit()` (microtask-batched re-render of every `useApp()` component), `STAGE`/`THUMBS` controller hooks filled by the editor. |
| `state/app.ts` | Actions: `boot`, `openFromFolder`/`openLocalFile`/`openBuffer`, `onDocChange`, `onStyleChanged`, **`change(label, ops, coalesce?)`**, `undo`, `styleChange`, `lookChange` (scope: this design / all), `slidesFor(design)`, `showVersion`, `ctx()` (memoised `RenderCtx`), `style()`, `tick` (poll 3 s, health/changed-on-disk 6 s, fonts/config 30 s), presence heartbeat 10 s. |
| `state/dialogs.ts` | Promise-based dialogs (`ask`, `confirmBox`, `runWizard`, installer) – `DLG` flags rendered by `ui/`. |
| `state/fonts.ts` | Font library in the page: `loadFonts`, `@font-face` in `<style id="fontcss">`, `addGoogleFont` (downloads faces, uploads them to the helper), `uploadFontFiles`, `embeddedFontCss(html)` (fonts used by exported slides as data URLs). |

### 5.5 `editor/` – the slide editor
| File | Responsibility |
|---|---|
| `stage.ts` | Imperative stage: `renderStage` (full build, deferred while an inline editor is open), `refreshStage` (re-renders only changed tables and patches changed DOM nodes), `fitStage`/zoom, hit testing (one `.hits` overlay per table + binary search over column/row edges), selection painting, column/row border drags, inline cell editor, slide-text and text-box editors, table handles (resize = binary search of the layout weight, edge stretch, grip move between bands), text box move/stretch with snapping guides, notes section, logo load state. |
| `edit.ts` | Selection model (`setSel`, `moveSel`, merged-block expansion), `applySel(label, fn)` (diffs `CellEdit`s → `cell.patch`), `commitText`. |
| `tables.ts` | Column/row sizes, stretch, same size, copy/reset sizes, align/valign, merge/unmerge – **per design** (`sizePatch`, `sizingChange`). |
| `textfmt.ts` | The **unified text toolbar**: `textTarget()` → cells / text box / slide text with the same `apply`/`clear` interface (cells store pt, others px). |
| `painter.ts` | Format painter (incl. conditional formats and colour scales). |
| `export.ts` | `doExport(kind)`, `exportVersions(designs)`, `exportPayload`, in-window fallback (§6.9). |
| `keys.ts`, `thumbs.ts`, `issues.ts` | Global keyboard; lazy thumbnails (IntersectionObserver); side-panel notes (missing tables, hidden rows, stale text edits…). |

### 5.6 `ui/`, `wizard/`, `styles/`
* `ui/App.tsx` (layout, thumbnails, canvas, status bar, dialogs), `Topbar.tsx` (open, wizard, version
  picker, presence, design switch, Design…, glass/colour sliders, Options, export menu, engine pill),
  `Ribbon.tsx` (row 1: text toolbar + formula bar), `TableTools.tsx` (row 2: cells, tables, text boxes,
  slide), `TextStylesDialog.tsx` (Design…: colours, text styles, fonts), `CommentDialog.tsx` (live
  preview), `TablesDialog.tsx` (sizes across slides), `FontPicker.tsx`, `Dialogs.tsx`, `Dropdown.tsx`,
  `Field.tsx` (input that keeps its draft while focused so background re-renders never overwrite typing).
* `wizard/Wizard.tsx` (4 steps; spreadsheet preview per sheet), `wizard/detect.ts` (table suggestions by
  flood fill of occupied cells).
* `styles/slide.css` (**everything a slide needs**, exported with slides), `ui.css`, `app.css` (chrome).

---

## 6. Key flows end to end

### 6.1 Boot
`main.tsx` → `boot()`: health, `/api/me` (user, prefs), `/api/config`, font library, zoom, wallpaper; when
served: reopen `prefs.lastFile`, start `tick` (3 s) and the presence heartbeat (10 s); `pagehide` →
`/api/presence/leave`.

### 6.2 Opening a workbook
1. Bytes: `GET /files/<name>` (stable read; `X-SB-Mtime/Size`), or a dropped/browsed file (uploaded to the
   helper's memory store when served).
2. `indexWorkbook`; `.xlsb/.xls/encrypted` → `POST /api/convert-workbook` (Excel COM) → re-index. Small
   workbooks are parsed completely, big ones lazily.
3. `LCACHE.clear()`, `GET /api/workbooks/<name>/doc`.
4. Preset: continue with the saved one, or the wizard (with `defaultPreset` as draft); then
   `wb.ensure(presetSheets)` parses only the sheets used.
5. New `DocSync`; `runtimeSlides(wb, preset, name, design)` → `S.slides`; restore the person's last
   version; `makeWall`; `STAGE.render()`, `THUMBS.render()`.

### 6.3 Making an edit (e.g. Ctrl+B on cells)
1. `editor/keys.ts` → `toggleBold()` → `applySel` diffs the selected cells' `CellEdit`s → `cell.patch` ops →
   **`change(label, ops)`**.
2. `DocSync.apply`: for each op compute `inverseOf` on the current view, apply locally, push to `pending`,
   emit (the stage updates at once), schedule a flush in 300 ms. `change` stores an undo entry (same
   `coalesce` key within 1.5 s → one entry, e.g. a slider drag).
3. `flush`: `POST /api/workbooks/<name>/ops {ops, client}` (one request in flight).
4. Helper: Host/Origin/token/format checks → `store.update_workbook`: lock `wb-<key>` → read latest
   (upgrading an older format) → `ops.apply_ops` → atomic write → rolling backup if due → unlock → `{doc,
   applied, skipped}`.
5. Page: `server = doc`, `view = server + inflight + pending` (rebase), emit with the authors of foreign
   revisions (`doc.log`).
6. Failure: ops go back to the front of `pending`; 409 → `outdated` (reload banner, no retries); other
   errors → retry after 2, 4, … 32 s.

### 6.4 Seeing other people's changes
Every 3 s `DocSync.poll()` → `GET …/doc?since=<rev>` (204 if unchanged) → rebase → `onDocChange`:
preset changed → rebuild runtime slides + full render; titles/logo changed → rebuild; style changed →
`onStyleChanged` (re-resolve slides if the design changed; wallpaper; full render); otherwise
`STAGE.refresh()` (only tables whose `tableHtml` changed are patched) and thumbnails. The stage never
redraws while an inline editor is open; settings inputs use `ui/Field.tsx`.

### 6.5 Undo/redo
`undo()` pops the user's own entry (same workbook) and applies its stored inverse ops as **new** ops via
`change`. Inverses only touch the fields this user changed, so another user's later change to other
fields survives.

### 6.6 Rendering a slide and the layout algorithm
`buildSlide(R, idx, ctx)` → for each table `tableHtml` (cached) → `effItems` (cached) → `renderExcel` or
`renderGlass`; then `applyLayout` → **`computeLayout(R, ctx)`**:
1. Text boxes moved freely (x/y) leave the flow; "span" boxes reserve a column at the left/right.
2. Each table + its attached boxes is one unit: width `tableW × w[i] × k` + side boxes, height `H × w[i] × k`
   + top/bottom boxes (stretched boxes may exceed the table).
3. `k` = the largest scale ≤ 2.0 at which all bands fit the content area (binary search, gaps GX 36 /
   GY 28); with a fixed scale (*Make same size*), `k = min(fixed, fit)`.
4. Bands are placed by `align` (default centre) and `valign` (default: 35 % of the free space above);
   span columns sit next to the tables actually drawn; text box fonts shrink to fit (`fitNotes`).
Sizing values come from `sizingOf(R, ctx)` (per design, §4.2). In raw Excel a shared fixed scale made
while text boxes existed is enlarged by the room they took (`fixedScale`).

### 6.7 Automated comments
A `Note` with `auto: CommentCfg` → at render time `notesOf` → `commentText` → `gridOf` (displayed values
after edits and version blanking) → `analyse` → `writeSummary`/`writeComment` → `shapeComment` (unit,
options) → markup → `richText`. Because it runs on every render, comments follow the numbers, edits and
versions. Comment-bearing slides always get a full re-render on refresh.

### 6.8 Versions
Defined in wizard step 4 → `preset.versions`. `S.version` (remembered in `prefs.versions[workbook]`) →
`ctx().version` → `effItems` blanks the hidden ranges (borders kept) → `tableKey` includes the hides →
comments ignore the blanked numbers. `exportVersions(designs)` builds a `RenderCtx` per design × version.

### 6.9 Export (page side)
`doExport(kind)` flushes pending ops → `exportPayload(idx, ctx, vector)`: `buildSlide(..., forExport)` for
each slide **of the requested design** (`slidesFor(design)` re-resolves tables with that design's
sizes), missing pictures removed, logo inlined as a data URL; CSS = `#slidecss` + `#wallcss` (+
`printReady`/`PRINT_CSS` for vector) + `embeddedFontCss` → `POST /api/export`. If no engine works (503,
network error, engine not ready): **in-window fallback** – each slide is serialised into an SVG
`<foreignObject>` (escaped slide CSS + embedded fonts), drawn on a canvas at 3×, sent as JPEGs to
`POST /api/assemble`, which writes an image PDF. Helper side: §10.

### 6.10 Fonts
`GET /api/fonts` → `@font-face` rules pointing at `/fonts/<file>?t=<token>`. Adding a Google font: the page
fetches the css2 stylesheet, keeps latin/latin-ext faces, downloads each face and `POST`s it to
`/api/fonts` (stored once in `data/fonts`, so slides and exports never need Google again). Uploaded files
are read with `readFontInfo` for family/weight/style. Exports embed the faces a slide uses as data URLs.

---

## 7. Back end: the helper (`backend/slidebuilder`)

Python ≥ 3.8, **standard library only** (`playwright` optional). Windows is the target; everything except
the Excel/GDI+ converters also runs on Linux/macOS (tests run there).

### 7.1 Start-up (`main.py`)
Arguments: `--port` (8765), `--no-browser`, `--setup` (export engine install), `--install` (first-time
set-up). Steps: simulated-latency hook if `SLIDEBUILDER_SIM_FS_MS` (load tests only) → create `export/`,
`engine/`, `data/` → v2 migration (`migrate.migrate`, errors logged) → `store.upgrade_all()` → port probe
(`GET /api/ping` on each port; if a Slide Builder answers, open the browser and exit) → `App()` (token =
`secrets.token_urlsafe(24)`) → banner → engine self-tests in a background thread (`Exporter.warm`) → open
the browser → `serve_forever`.

### 7.2 Module map
| Module | Responsibility |
|---|---|
| `paths.py` | Folder layout: ROOT, DATA, EXPORT_DIR, ENGINE_DIR, `LOCAL_ENGINE_DIR` (`%LOCALAPPDATA%\SlideBuilder\engine`), slide/page size; env overrides; `configure()`. |
| `util.py` | Logging, identity (`current_user/host`), `doc_key`, name/path safety (`safe_path` refuses escapes), atomic writes (`write_tmp` + fsync + `replace_retry` for Windows sharing violations), a no-proxy opener for 127.0.0.1. |
| `fsclock.py` | The **file server's clock**: offset measured by writing a probe file and reading its mtime (cached 30 s). All ages of shared files use it, so PCs with skewed clocks agree. |
| `locks.py` | `Lock(name)`: `data/locks/<name>.lock` created with `O_CREAT\|O_EXCL` (atomic on SMB), body `{user, host, pid, at, token}`; wait ≤ 10 s with jitter; stale after 15 s (server clock) → atomically renamed away and re-checked; keepalive thread for long sections; release only with our token. |
| `store.py` | Documents: retried reads (`StoreUnreadable` → 503, never replaced by empty), atomic writes, format upgrades on read, `update_workbook` under the lock, revision log, rolling backups (`backupAt` in the doc → a normal save never lists the backup folder), history, config and personal prefs. |
| `ops.py` | Operation semantics (mirror of `model/ops.ts`). |
| `upgrade.py` | `SCHEMA`, `@step(kind, n)` upgrade functions (none yet), `TooNew`. |
| `presence.py` | Heartbeat files `presence/<user>@<host>.json`; others seen in the last 25 s; cleanup after 24 h. |
| `workbooks.py` | Listing (ROOT then `backend/`), path-safe lookup, **stable read** (size/mtime unchanged before/after, zip end record present; retried; `Unstable` → 503 while Excel is still saving). |
| `fonts.py` | Font library: signature-checked files (≤ 15 MB, ≤ 64 faces/family), written before the index, under lock `fonts`; unreferenced files swept. |
| `exports.py` | `/api/export` (modes, file naming) and `/api/assemble`; `save_export`: temp file → under lock `export-<name>` renamed into place; a target open in a viewer (locked) → ` (2)`, ` (3)`… |
| `engines.py` | Browser discovery, the three engines, `Exporter` (ordering, self-tests, output checks), page CSS and geometry checks, engine mirror to the local disk. §10. |
| `pdf.py` | PDF writer for image pages, PNG helpers (crop), PDF page-box reading and **fitting** (marker detection in content streams, xref rewrite). §10. |
| `cdp.py` | Minimal websocket + Chrome DevTools Protocol client. |
| `convert.py` | Windows only: `.xlsb/.xls` → `.xlsx` via Excel COM (read-only copy, macros/events off, 240 s timeout); EMF/WMF/TIFF → PNG via GDI+ (PowerShell fallback). |
| `server.py` | HTTP server (`ThreadingHTTPServer`, HTTP/1.0), security guard, routing, body limits, exception → status mapping, upload store (8 entries, 2 h), asset lookup. |
| `migrate.py` | One-time import of v2 settings under lock `migrate`. |
| `installer.py`, `firstrun.py` | `--setup` (Chrome for Testing download/copy/test, Playwright) and `--install` (7-step first-time set-up with OK/WARN/FAIL report). |
| `simfs.py` | **Load tests only**: adds simulated SMB latency to data-folder file calls. |

### 7.3 Environment variables
`SLIDEBUILDER_ROOT`, `SLIDEBUILDER_DATA` (folders) · `SLIDEBUILDER_USER`, `SLIDEBUILDER_HOST` (identity) ·
`SLIDEBUILDER_BROWSER` (force a browser) · `SLIDEBUILDER_ENGINES` (`playwright,devtools,cli` subset or
`none`) · `SLIDEBUILDER_APP_FILE` (serve another page) · `SLIDEBUILDER_FORCE_NETWORK` (treat ROOT as a
network drive) · `SLIDEBUILDER_SIM_FS_MS`, `SLIDEBUILDER_TIMING` (load tests; `X-SB-Timing` header) ·
`PLAYWRIGHT_BROWSERS_PATH` (set by the helper to `engine/` when present).

### 7.4 Lock names
`wb-<key>` (a workbook document), `config`, `user-<name>`, `fonts`, `migrate`, `export-<name>`, `install`
(shared and on the local disk), `firstrun-<user-host>`, `update` (tools/update.py, own lock file).

### 7.5 Updating the program (`tools/update.py`)
* With git: the existing folder becomes the working copy **in place** (`git init` + fetch + forced checkout
  of tracked files; later `fetch` + `reset --hard origin/<branch>`). Never `git clean`; never a nested
  clone (it offers to delete one that holds no saved work). `-c safe.directory=*` for shares.
* Without git: downloads the branch ZIP and writes only program files (atomic replace,
  `data/app-version.json`).
* Never written: `backend/data/`, `backend/logo*`, v2 settings, workbooks, `export/`, `engine/`. Saved
  setups (and any locally modified program file) are copied to `backups/before-update-<time>/` first;
  afterwards every saved deck is test-loaded with the new code. One update at a time. Options: `--check`,
  `--branch`, `--zip`, `--yes`.
* **Side-by-side releases** (`--release [latest|X.Y.Z]`, `--zip <file.zip>` offline, `--use X.Y.Z` to roll
  back): the release ZIP of `tools/make_release.py` is checked against GitHub's asset digest (when the API
  gives one) and always against its `MANIFEST.json`, extracted to `app\<ver>.part\` and renamed to
  `app\<ver>\`. The new version's `slide_builder.py --selftest` (reads every deck, `config.json` and
  preference file without writing; create/rename/delete probe in `data\locks`) must pass before
  `app\current.json` is replaced atomically. The newest 3 versions stay (and the previous one).
  `Start Slide Builder.bat` starts the version named in `app\current.json`, else `backend\`. A version in
  `app\<ver>\` uses the main folder's workbooks, `export\` and `backend\data\` (`paths.HOME_BACKEND`).

---

## 8. HTTP API
The helper listens on `127.0.0.1:<port>` only. Every `/api/*`, `/files/*`, `/assets/*`, `/fonts/*` request
needs `X-SB-Token` (`/assets` and `/fonts` may use `?t=`); `Host` must be `127.0.0.1:<port>` or
`localhost:<port>`; a present `Origin` must match; POST/PUT/DELETE with a non-matching `X-SB-Formats` → 409.
JSON bodies ≤ 2 MB, uploads/exports ≤ 300 MB. Full shapes: `docs/ARCHITECTURE.md` §5.

| Endpoint | Purpose |
|---|---|
| `GET /` | the app with the token injected (`__SB_TOKEN__` replaced; `<meta name="sb-token">`) |
| `GET /api/ping` (no token) · `GET /api/health` | liveness · version, user, folders, export engine status |
| `GET /api/files` · `GET /files/<name>` | workbooks in the folder (with doc rev/author) · workbook bytes (stable read) |
| `GET /api/workbooks/<name>/doc?since=rev` | the document (204 if unchanged) |
| `POST /api/workbooks/<name>/ops` | `{ops, client}` → `{doc, applied, skipped}` |
| `GET /api/workbooks/<name>/history` | rolling backups |
| `GET /api/config` · `POST /api/config/ops` | shared defaults (style.patch only) |
| `GET /api/me` · `PUT /api/me` | user, host, personal preferences (whole replace) |
| `POST /api/presence` · `POST /api/presence/leave` | heartbeat → others in the folder |
| `GET/POST/DELETE /api/fonts` · `GET /fonts/<file>` | font library · font files |
| `POST /api/logo?name=` · `GET /assets/<name>` | upload a logo to `data/assets` · images from data/assets, `backend/`, ROOT (case-insensitive) |
| `POST /api/export` · `POST /api/assemble` | render + write exports · PDF from page-rendered images |
| `POST /api/convert-workbook` · `POST /api/convert` | .xlsb/.xls → .xlsx · EMF/WMF/TIFF → PNG (Windows; else 501) |
| `POST /api/upload` · `GET /api/upload/<id>` | temporary in-memory uploads (local files) |
| `POST /api/open` · `POST /api/engine/restart` · `GET/POST /api/engine/install` | open the export folder/file · restart engines · install the engine |

Status codes: 400 bad request · 403 Host/token/Origin/path/file type · 404 · 409 format mismatch (newer
file, outdated page) · 411/413 body · 501 converter unavailable · 503 unreadable document, lock busy,
workbook still being saved, no export engine (clients keep their ops and retry) · 500 unexpected (logged).

---

## 9. Concurrency and failure model
* **Coordination only through files on the share.** Writes to a shared document happen under its lock
  (`O_EXCL` lock file), read-latest → apply ops → temp file + fsync + `os.replace` (retried for Windows
  sharing violations) → release. Ages (stale locks, presence, backups, `updated`) use the file server's
  clock.
* **Field-level merge** (§4.3): different fields never conflict; the same field → the later write wins.
* **Clients** keep `server + inflight + pending`; one request in flight; ops are never dropped on errors;
  polling every 3 s; remote authors are shown.
* **Never lose data**: unreadable file → 503 and retry (never treated as empty); workbook still being
  written by Excel → 503 (stable read); format upgrades back up the original; updates back up saved setups.
* **Measured** (`docs/LOADTEST.md`): 10 users on one workbook at 15 ms per SMB operation → save p50/p95
  ≈ 285/870 ms, edits visible to others after ≈ 1.4 s. The cost is the number of sequential file
  round trips per save under the lock; beyond ~40 ms per operation the design stops scaling.

---

## 10. Export engine
### 10.1 Engines and selection (`engines.py`)
`Exporter` tries engines in order, each after a self-test (in the background at start-up):
1. **Playwright** (optional Python package) driving the Chrome for Testing copy (or its bundled Chromium);
2. **DevTools** – Edge/Chrome started with `--remote-debugging-port`, driven by `cdp.py` (often disabled
   by policy);
3. **Command line** – `--headless --print-to-pdf` / `--screenshot` (needs no DevTools; calibrated once).
Browsers: local Chrome for Testing copies first, then system Edge/Chrome. A Chrome for Testing copy on the
share is mirrored to `%LOCALAPPDATA%` (programs may not start from the share). The last engine that
worked is tried first; an engine failing permanently (policy block, timeout) is disabled until restart.
All engines run at **device scale factor 1** for PDFs (Windows display scaling used to shrink slides).

### 10.2 Page geometry and output checks
* `compose(css, slides)` wraps each slide in a `.page` of **exactly 1600 × 900 CSS px** with
  `@page{size:1600px 900px;margin:0}`: one **unscaled** slide per page (scaling slides to 13.333 in pages
  depended on the browser version and left white strips). The page box is painted **#FFFFFE** (invisible
  under the slide) as a marker.
* Before printing, `GEOMETRY_JS` checks in the browser (screen and print media) that every slide is
  1600 × 900 at its page's origin.
* After rendering, `check_output`: a PDF must have one page per slide; `pdf.pdf_fit_pages` parses each
  page's content stream (tracking the `cm` transforms), finds the rectangle filled with the marker colour
  and **cuts the page's MediaBox to exactly where the browser drew the slide** (this absorbs Chrome's
  1/300-inch paper rounding and any scaling); pages that cannot be made 16:9 are refused. Pictures must be
  exactly one slide (larger → cropped with `png_crop`, smaller → refused). Output that fails is never
  saved: the next engine renders it.
* Modes: `vector` (default; real text and tables), `exact` = PNG pages at `scale` packed losslessly by
  `pdf.jpegs_to_pdf` (file name "(images)"), `png` files, `inline` PNG for the clipboard.

### 10.3 Keeping PDFs light (`frontend/src/render/printcss.ts`)
Chrome prints what it cannot draw as vector as 300 dpi pictures and embeds variable/CFF fonts glyph by
glyph (Type 3 – slow in Acrobat). For vector exports the page therefore sends: blurred `box-shadow`s
replaced by 5 sharp layers of fading strength (`vectorShadow`), "Segoe UI Variable"/"SF Pro" removed from
font lists (classic Segoe UI is TrueType), the glass rim's CSS mask replaced by a border (`PRINT_CSS`), and
the wallpaper's contrast baked into its image (no CSS filter). A 4-slide Liquid Glass PDF went from
8.7 MB to ≈ 1.2 MB; Excel slides are ≈ 35 KB each. Fonts added from Google may still be variable fonts.

---

## 11. Development and tests
```
cd frontend
npm install                  # once (Node 20+; developers only)
npm run build                # type-check + single-file build → ../backend/slide_builder.html  (commit it)
npm test                     # Vitest unit tests (incl. "the built file is up to date")
npm run test:e2e             # Playwright: two real helpers (users anna/bob) on one temp shared folder
node e2e/parity.mjs <old.html> ../backend/slide_builder.html tests/fixtures/*.xlsx   # renderer diff vs. an older build

cd backend
python -m unittest discover -s tests -v                  # helper tests (Python 3.8+)
python slide_builder.py [--port 8765] [--no-browser] [--setup] [--install]
python ../tools/loadtest.py --users 10 --scenario same --fs-ms 15        # load test (docs/LOADTEST.md)
```
Without a downloaded browser set `CHROME=/path/to/chrome` (e2e) or `SLIDEBUILDER_BROWSER`. Test
workbooks are generated by `frontend/tests/fixtures/make_fixtures.py` (openpyxl).

| Suite | Covers |
|---|---|
| `frontend/tests/ops.test.ts` + `backend/tests/test_ops.py` | every case of `shared/ops-vectors.json`; inverses |
| `frontend/tests/docsync.test.ts` | merging two users, retries, rebasing, own-changes-only undo, authors, 409 |
| `frontend/tests/tables.test.ts`, `text.test.ts`, `design.test.ts` | layout, sizes, same size, per-design sizing, scales, merges, gridlines, painted CF, themes, text styles, fonts, text boxes, designs, versions |
| `frontend/tests/comment.test.ts`, `numfmt.test.ts`, `printcss.test.ts`, `build.test.ts` | automated comments · number formats & superscripts · PDF CSS · committed build is fresh |
| `frontend/e2e/app.spec.ts` | 15 scenarios: wizard, two users merging, export, table tools, painter, gridlines, themes, typing under concurrent changes, text toolbar & fonts, comments, text boxes, notes section, versions × designs |
| `backend/tests/test_store.py`, `test_locks.py`, `test_fsclock.py` | multi-process saves, stale locks, clock skew |
| `backend/tests/test_upgrade.py` | saved-format examples, upgrades once, too-new files, page/helper formats |
| `backend/tests/test_http.py`, `test_fonts.py` | API, security checks, fonts, logos |
| `backend/tests/test_exports.py`, `test_export_geometry.py`, `test_engine_cli.py` | naming/atomicity, page fitting (marker, rounding, shrunk slides), real Chromium PDFs edge to edge |
| `backend/tests/test_update.py`, `test_migrate.py`, `test_firstrun.py`, `test_installer.py`, `test_workbooks.py`, `test_main.py`, `test_simfs.py` | updater, v2 import, installer, stable reads, entry point, load-test hook |

---

## 12. Where to change what
| Task | Touch |
|---|---|
| **New saved field** | `model/types.ts` (type + `Op` patch type) → key lists in `model/ops.ts` **and** `backend/slidebuilder/ops.py` → a case in `shared/ops-vectors.json` → `docs/ARCHITECTURE.md` §3 → UI → rendering → if it changes a table's HTML, add it to `tableKey` (`render/context.ts`) → tests. Optional fields need no format change. |
| **Change the meaning/shape of saved data** | raise `SCHEMA[kind]` in `upgrade.py` + `@step(kind, old)`; raise `FORMATS`; test in `test_upgrade.py`; **add** `fixtures/saved/<kind>.v<n+1>.json`; ARCHITECTURE §3.3. |
| Cell formatting control | `ui/Ribbon.tsx` → `editor/textfmt.ts` / `editor/edit.ts applySel` → `render/edits.ts` → painter (`editor/painter.ts`). |
| Table geometry, drags | `editor/tables.ts`, `editor/stage.ts`, `render/slide.ts computeLayout/sizingOf`. |
| Liquid Glass look | `render/glass.ts`, `styles/slide.css`, `render/wallpaper.ts`, themes in `model/style.ts`; check vector export (`render/printcss.ts`). |
| Excel look | `render/excel.ts`, `xlsx/layout.ts`, `xlsx/numfmt.ts`. |
| Reading something new from .xlsx | `xlsx/workbook.ts`, `xlsx/drawing.ts`, `xlsx/types.ts`. |
| Automated comment wording | `model/comment.ts` (`writeSummary`, `writeComment`), options in `ui/CommentDialog.tsx`. |
| Deck options | `ui/Topbar.tsx`, `ui/TextStylesDialog.tsx`, `model/style.ts`, style keys/maps in both `ops` files. |
| Wizard | `wizard/Wizard.tsx`, `wizard/detect.ts`, `model/preset.ts`. |
| Saving, polling, conflicts | `sync/docsync.ts`, `state/app.ts onDocChange`, `backend/slidebuilder/store.py`. |
| HTTP endpoint | `server.py` + `sync/api.ts` + ARCHITECTURE §5 + `test_http.py`. |
| Export | `editor/export.ts`, `render/printcss.ts`, `exports.py`, `engines.py`, `pdf.py`. |
| Install / start / update | `*.bat`, `firstrun.py`, `installer.py`, `main.py`, `tools/update.py`. |

---

## 13. Security
127.0.0.1 only; `Host` check (DNS rebinding); a random token per start on every API call (other web pages
cannot call the helper); `Origin` check; body limits; files served only by extension from the app folder
(`safe_path` refuses `..` and escapes); uploaded fonts/logos checked by signature/type; security headers
(`nosniff`, `X-Frame-Options: DENY`, `no-store`); Excel conversion opens a read-only copy with macros,
events and link updates off. TLS is never disabled (downloads use the system/corporate trust store).

## 14. Gotchas
1. **Never edit `backend/slide_builder.html`** – edit `frontend/src`, `npm run build`, commit both (a unit
   test fails on a stale build).
2. **Exports carry only `#slidecss` + `#wallcss` + embedded fonts** – anything a slide needs must be in
   `styles/slide.css` or inline; images must be data URLs.
3. New glass elements need class `wb` and inline `left/top/width/height`; `applyLayout()`/`placeGlass()`
   must run after geometry changes. New blurred shadows/masks/filters become pictures in PDFs unless
   handled in `render/printcss.ts`.
4. Keep hot paths cheap: no per-cell listeners or elements; reuse per-table caches; include anything that
   changes a table's HTML in `tableKey`.
5. Hidden sheets stay hidden (user requirement). The workbook is never written.
6. Never write a whole shared document from a client; never treat an unreadable file as empty.
7. Times on shared files come from the file server's clock (`fsclock.py`).
8. Corporate Windows: DevTools may be disabled, headless Edge may hang, executables may not run from the
   share, TLS is intercepted, consoles may be cp1252, PowerShell may be constrained, git on a share needs
   `safe.directory`.
9. The placeholder `__SB_TOKEN__` is replaced everywhere in the served page – never write it in code.
10. Preact controlled inputs reset on every re-render: inputs for shared settings use `ui/Field.tsx`.
11. Table sizes are **per design**: read them with `sizingOf`/`tableSizes`, write them with
    `sizingPatch`/`sizingChange`/`sizePatch` – never `cfg.layout`/`def.cols` directly.

## 15. Known limitations and technical debt
* Charts are not redrawn; Excel data bars/colour scales/icon sets are not reproduced (Slide Builder's own
  colour scales are). Formulas are not recalculated.
* Cell edits are keyed by address: inserting rows above a table moves format edits (text edits pause and
  are listed in the side panel).
* Same field changed by two people at the same moment: the later wins. Polling (3 s) instead of push.
* The offline mode (`file://`, localStorage) is for emergencies: no sharing, exports or upgrades.
* The in-window export fallback produces pictures and cannot reproduce web fonts and `backdrop-filter`
  exactly; "Copy slide" is a picture.
* Layout depends on fonts installed on each PC (text is measured by the browser).
* Debt noted during the last review: `render/roles.ts` is only used by a test; `commentText` treats a
  missing `mode` as "sections" (legacy) while new comments default to "summary"; the installer's zip
  clean-up has a disabled branch (`and False`); `tools/loadtest.py`'s `seed_backups` docstring predates
  `backupAt`; workbook parsing runs on the UI thread.

---

## 16. Repository map
```
/                                      ROOT (the shared folder)
├─ Install / Start / Update Slide Builder.bat
├─ README.md · docs/                   documentation (table at the top)
├─ shared/ops-vectors.json             operation test vectors (both test suites)
├─ tools/  update.py (GitHub update in place / ZIP) · loadtest.py (N simulated users)
├─ backend/
│  ├─ slide_builder.py · slide_builder.html (BUILT) · Install export engine.bat · requirements.txt (optional playwright)
│  ├─ slidebuilder/                    the helper package (§7.2)
│  ├─ tests/                           unittest; fixtures/saved/ (released data formats)
│  └─ data/                            saved state (not in git, §4.1)
└─ frontend/
   ├─ package.json · vite.config.ts (single-file build → ../backend/slide_builder.html) · playwright.config.ts
   ├─ src/  main.tsx · xlsx/ · model/ · render/ · sync/ · state/ · editor/ · ui/ · wizard/ · styles/   (§5)
   ├─ tests/   Vitest unit tests; fixtures/ (generated .xlsx + make_fixtures.py)
   └─ e2e/     app.spec.ts (Playwright, two helpers = two users) · parity.mjs (renderer diff)
```
