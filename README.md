# Slide Builder — developer & agent guide

Slide Builder turns tables in an Excel workbook into presentation slides (16:9, 1600 × 900 CSS px =
13.333 × 7.5 in) and exports them as PDF / PNG. It was built for a weekly banking report
(“IBD – Total Banks Loans & Deposits”) and runs on locked-down corporate Windows PCs: no admin rights,
no installs beyond Python, Edge with DevTools disabled by policy, SSL-inspecting proxy, network drives.

Two visual designs are available: **Excel** (faithful copy of the workbook formatting) and
**Liquid Glass** (an Apple iOS 26-style light design that keeps the workbook's meaning: headers,
totals, green/red conditional formatting).

If you only read one section, read **3. Architecture**, **6.3 Scene model** and **11. Gotchas**.

---

## 1. Quick start

| Who | What to do |
|---|---|
| User | Double-click `Start Slide Builder.bat`. A console window opens (keep it open) and the app opens in the browser at `http://127.0.0.1:8765/`. |
| User, first time on a PC | In the app click the status pill at the top right (“Export: …”) → **Install export engine**, or run `backend\Install export engine.bat`. |
| Developer | Edit files in `backend/src/`, run `python backend/src/build.py`, reload the browser tab. The Python helper does not need a restart unless you change `slide_builder.py`. |

Requirements: Python ≥ 3.8 (3.9+ for the optional `playwright` package), Windows 10/11
(macOS/Linux work for development). Nothing else: the helper uses only the Python standard library.

---

## 2. Folder layout

```
Slide Builder\                      ROOT – what the user sees
├─ Start Slide Builder.bat          starts backend\slide_builder.py with the newest Python (py -3)
├─ README.md                        this file
├─ *.xlsx / *.xlsm / *.xlsb / *.xls workbooks placed here appear in the app's Open menu
├─ export\                          every exported PDF / PNG is written here
├─ engine\                          Chrome for Testing (headless shell), installed once
└─ backend\
   ├─ slide_builder.py              the helper: local web server, settings file, export engines
   ├─ slide_builder.html            the app (BUILT FILE – do not edit, see src\)
   ├─ slide_builder_settings.txt    ALL persistent state (JSON, created automatically)
   ├─ Install export engine.bat     runs `slide_builder.py --setup`
   ├─ logo.png                      logo shown on slides (file name configurable in the app)
   └─ src\                          sources of slide_builder.html + build.py
```

Paths are resolved in `slide_builder.py`: `BACKEND` = folder of the script, `ROOT` = its parent when the
folder is named `backend` (otherwise the same folder – old “flat” layout still works),
`EXPORT_DIR = ROOT\export`, `ENGINE_DIR = ROOT\engine`,
`LOCAL_ENGINE_DIR = %LOCALAPPDATA%\SlideBuilder\engine` (used when ROOT is on a network drive, see §8).

---

## 3. Architecture

```
┌──────────────────────── browser tab (slide_builder.html) ────────────────────────┐
│  core.js      workbook index + fast sheet parser, number formats, CF, table layout │
│  drawing.js   pictures / groups / text boxes / EMF conversion requests            │
│  app.js       Excel renderer, slide layout, editor, undo, export client            │
│  scene.js     SCENE MODEL: cells → primitives → structure → Liquid Glass materials │
│  model.js     presets (tables + slides), runtime slides, cover & index pages      │
│  wizard.js    3-step editing wizard (sheets → tables → slides)                     │
└───────────────▲──────────────────────────────────────────────▲──────────────────┘
                │ HTTP (127.0.0.1 only)                         │ static HTML of slides
┌───────────────┴──────────── backend/slide_builder.py ─────────┴──────────────────┐
│  ThreadingHTTPServer: serves the app, workbooks, logo; reads/writes settings.txt   │
│  Exporter: Playwright → DevTools (CDP) → headless command line, per browser        │
│  Converters: .xlsb/.xls → .xlsx via Excel COM; EMF/WMF/TIFF → PNG via GDI+         │
│  PDF writer: pure Python (JPEG or PNG pages, no dependencies)                      │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Design decisions that explain most of the code:

* **All parsing and rendering happens in the browser**, in one self-contained HTML file. The helper
  never parses Excel; it only moves bytes, persists settings and drives a headless browser.
* **Exports render the exact DOM the user sees.** The client serialises each slide
  (`exportPayload()` → `{css, slides:[outerHTML…]}`); the helper loads that into a headless browser
  and screenshots it at 3× (4800 × 2700). Screen and PDF can therefore not drift apart.
* **Everything is local**: the server binds to 127.0.0.1, local requests bypass any proxy.
* **No dependencies at runtime**: JSZip is inlined; the PDF writer, websocket/DevTools client,
  zip extraction etc. are standard-library Python.

---

## 4. Data model

### 4.1 `backend/slide_builder_settings.txt`

Plain JSON (indent 2), written atomically by `PUT /api/settings` (debounced ~450 ms from the client).
If unreadable it is copied to `…unreadable-<timestamp>` and a fresh one is started.

```jsonc
{
  "version": 2,
  "app": {
    "design": "glass",            // "glass" | "excel"
    "glass": "subtle",            // "subtle" | "medium" | "strong"  → --gi 0.35 | 0.65 | 1
    "color": 35,                  // wallpaper colour 0 (white) … 100 (full colour)
    "logo": "logo.png",           // file in backend\ (fallback: ROOT)
    "pdfMode": "exact",           // default of the Export PDF button: "exact" | "vector"
    "scale": 3,                   // export pixel ratio (4800 × 2700)
    "lastFile": "IBD weekly.xlsx",// reopened at start-up
    "pn": { "on": true, "start": 1, "pos": "br",          // tl tc tr bl bc br
            "font": "auto", "size": 16, "format": "n",     // n | nN ("3 / 12") | page | p
            "style": "capsule", "cover": false }
  },
  "presets": { "<workbook file name>": { /* §4.2 */ } },
  "files": {                       // per workbook, per sheet: cell edits (and legacy layouts)
    "<workbook file name>": {
      "<sheet name>": {
        "cells": { "C7": { "orig": "TOTAL BANKS LOANS", "text": "Totale prestiti",
                           "sz": 14, "b": true, "i": false, "color": "#A8101A",
                           "fill": "#34C759" | "none", "align": "center",
                           "role": "header" | "total" | "body" | "caption" } },
        "layouts": { }             // legacy (v2.0); new layouts live in the preset slides
      }
    }
  },
  "sheets": { }                    // legacy sheet selection, only read to migrate old setups
}
```

Keys are the **workbook file name** (not the path) and the **sheet name**. Renaming either “loses”
its preset/edits (they stay in the file, unused).

**Text edits are conditional:** `text` replaces the cell only while the Excel value still equals
`orig`. Next week's new number therefore shows automatically; formatting/roles are permanent.

### 4.2 Preset (`presets[file]`)

```jsonc
{
  "version": 3, "updated": 1791214363000,
  "sheets": ["Overview", "Detail"],                       // sheets chosen in the wizard
  "tables": [
    { "id": "k3j9x0a", "sheet": "SLIDE_1", "kind": "markers", "anchor": "A3", "index": 0 },
    { "id": "p0q8z1b", "sheet": "Detail",  "kind": "range", "range": "A2:K20", "grow": true, "name": "Products" }
  ],
  "slides": [
    { "id": "…", "type": "cover", "title": "IBD Weekly Review", "subtitle": "…", "date": null, "note": "International Banks Division", "logo": false },
    { "id": "…", "type": "index", "title": "Contents" },
    { "id": "…", "type": "content", "title": null, "subtitle": null, "tables": ["k3j9x0a"],
      "layout": { "bands": [[0]], "w": [1] } }            // null = automatic layout
  ]
}
```

* `kind:"markers"` – table between two cells containing only `x`; identified by the top-left marker
  address (`anchor`), `index` is a fallback. Re-resolved on every open, so it follows the markers.
* `kind:"range"` – fixed A1 range picked in the wizard; `grow:true` extends it downwards while the
  next row still has data inside the table's columns (`growG()` in model.js).
* `title:null` → automatic (A1 of the first table's sheet). `logo:false` hides the logo on that slide.
* `layout.bands` = rows of table indices (tables side by side inside a band); `layout.w` = per-table
  size weight (see §6.1).

### 4.3 Runtime objects (browser)

| Object | Created in | Key fields |
|---|---|---|
| `wb` workbook | `indexWorkbook()` | `meta[]` (name, path, size of each visible worksheet), `sheets[]` (parsed sheets only), `ensure(names, progress)`, `big` |
| `S` sheet | `readSheet()` | `cells: Map("r,c" → {v,t,xf,fmt})`, `rowInfo`, `colInfo`, `merges`, `cfRules`, `drawing`, `tables` (x-marker regions), `title` (A1), `subtitle` (A2) |
| `L` table layout | `buildLayout(S, g)` | `g` region (exclusive bounds), `rows/cols` (visible only), `items[]` (one per visible cell/merge with geometry, style, CF result), `pics`, `rects`, `texts`, `W/H`, `colX/colW/rowY/rowH`; at runtime also `sheet`, `def`, `id` |
| `R` runtime slide | `runtimeSlides()` | `type`, `cfg` (the preset slide object – edits write into it), `tables[]` (L), `title`, `subtitle`, `label` |
| `DOC` | app.js | `name, src (folder/upload/local), wb, slides[], mtime` |

---

## 5. Reading workbooks (core.js, drawing.js)

**Index first, parse on demand.** `indexWorkbook()` only unzips the directory, reads
`_rels/.rels` → workbook part → sheet list. Hidden sheets are never listed nor read; chart/dialog/macro
sheets are skipped. Sheets are parsed by `wb.ensure(names)` when chosen in the wizard or needed by a
preset. Workbooks with < 12 MB of uncompressed sheet XML (and < 6 MB file size) are read completely
up front so the wizard can show titles and table suggestions; larger ones show sizes and “not read yet”.

**Fast parser.** `readSheet()` uses regular expressions over the XML string (no DOMParser for
sheetData – far faster and lighter on 50k-row sheets) and yields to the UI every 4000 rows for the
progress bar. `parseSST()` does the same for shared strings. Handles: namespace prefixes, rows/cells
without `r`, `<v xml:space=…>`, inline strings, rich text, `_xHHHH_` escapes. Styles, theme and
drawings are small and use DOMParser. A parity test against the old DOM parser was run on all test
workbooks (identical cells, merges, hidden rows, CF, pictures, tables).

**Robustness:** case-insensitive / %-encoded part names (`zget`), damaged sheets become
`brokenSheet()` stubs (listed as “could not be read”), format detection:
`PK..` zip, `D0 CF 11 E0` = old .xls or encrypted (IRM/sensitivity label) → `CFB`,
`xl/workbook.bin` → `XLSB`. CFB/XLSB are sent to `POST /api/convert-workbook` (Excel COM, read-only
temp copy, macros/events/link updates off) and the resulting .xlsx is read.

**Tables.** `findRegions()` pairs “x” cells (top-left with the nearest bottom-right whose rectangle
holds no other marker). `buildLayout(S, g)` builds visible rows/cols (hidden ones skipped), merged
boxes, borders (shared edges resolved to the heavier style), number formats (`formatValue`, Italian
separators), conditional formatting (`evalCF`: `cellIs` and `$X$n="TEXT"` expressions; data bars,
colour scales and icons are reported as not reproduced), overflow of text into empty neighbours,
pictures and shapes.

**Pictures** (`readDrawing`): one/two-cell/absolute anchors, groups (child frames mapped to fractions
of the anchor), crop (`srcRect`), rotation/flip, SVG preferred over PNG fallback, EMF/WMF/TIFF via
`POST /api/convert` (GDI+), linked pictures and charts reported. Hidden rows/cols: “move and size”
objects collapse, “move but don't size” objects move. `analyzeImages()` samples corners to tell round
badges (flags) from photos/logos (used by Glass).

**Column widths** use Excel's max-digit-width formula with the workbook's default font measured on a
canvas; row heights are pt × 96/72.

---

## 6. Rendering (app.js, model.js, slide.css)

### 6.1 Slide layout
`computeLayout(R, w)`: tables are arranged in **bands** (`layout.bands`), each table scaled by
`k × w[i]`, where `k` is the largest factor (≤ `MAXK = 2.0`) that fits the content area
(`areaFor(R)`: x 50…1550, y 104…822, or from 126 with a subtitle). Gaps `GX = 36`, `GY = 28` stay
constant. Default layout: tables of the same sheet that share rows sit side by side, others stack.
Resizing a table binary-searches the weight that makes its width follow the mouse; moving drops it
left/right of another table or into a new band above/below.

### 6.2 Excel design – `renderExcel(L)`
Absolute-positioned divs: one background/border div per styled cell, one text div per non-empty
cell, shapes, text boxes, pictures. Fonts fall back to Century Gothic → Arial.

### 6.3 Scene model and the Liquid Glass design – `scene.js`

A range of cells can be *anything*: a classic table, a key/value control panel, label boxes next to
value boxes, KPI cards, ruled grids, text blocks, pasted pictures, several of these side by side and
nested. The Glass design therefore never assumes a template. It works in four layers:

```
Grid ──► Primitives ──► Structure ──► Theme (materials)
cells     Surface         containment tree   Excel: faithful (renderExcel, unchanged)
merges    Frame / Grid    roles per text     Glass: material translation, geometry kept
borders   Rule            table rows
fills     Text · Signal
          Media
```

**1. Grid** (`buildScene`): each visible cell/merged block becomes a node on a row/column *index*
grid; borders are placed on grid lines (`H`, `V` edge arrays, heavier style wins). **White borders are
ignored** – in Excel they are used as gaps, not lines.

**2. Primitives** – all inferred from geometry and style, nothing hard-coded:

| Primitive | How it is found | Typical Excel use |
|---|---|---|
| **Surface** | union-find of adjacent cells with a similar *structural* fill (CF and user highlights excluded); holes allowed when boxes/other fills occupy them; irregular areas split into row-runs | dark label blocks, header bands, highlighted cells, coloured backgrounds |
| **Frame** | a cell whose four sides are bordered; or a rectangle whose perimeter is closed (corner search with a budget); outline-only shapes | boxed labels/values, a box around a total line or a section |
| **Grid** | boxed cells that *share* borders → one container + separators | fully ruled tables |
| **Rule** | border segments not used by a frame, grid or surface outline | heading underlines, single separators |
| **Text** | cell text with font, colours, alignment, rotation | everything written |
| **Signal** | conditional formatting fills, user highlights, green/red status fills on values | good/bad indicators |
| **Media** | pictures (icons, photos, keyed white-background graphics), text boxes, filled shapes | flags, logos, pasted titles |

A Frame and a Surface on exactly the same cells merge into a *filled frame*.

**3. Structure** (`inferRoles`):
* **Containment tree**: every primitive gets the smallest container that encloses it (spatial hash,
  so thousands of boxes stay fast) → `depth`. The *background* of a text is its first coloured
  ancestor (`bgOf`).
* **Roles** per text, from evidence, in priority order: user override (`role`) → `heading`
  (a rule right under it, or large text outside any container) → `section` (merged over several rows on
  a coloured block) → `label` (text on a coloured block, or bold text next to numbers) → `caption`
  (italic/small) → `emphasis` (bold number, or number in a filled box) → `value` → `text`.
* **Implicit cards**: texts that no container holds are clustered by proximity (sweep over sorted
  positions); each cluster gets a neutral card. Headings, captions and free-standing graphics stay free.
* **Tables**: a container whose texts form ≥ 3 aligned rows × ≥ 2 columns with ≥ 25 % numbers gets
  row separators where Excel drew no lines (spacer rows are respected).

**4. Theme – material translation** (`renderGlass`): geometry stays exactly as designed in Excel
(only columns are widened for the system font, `glassGeom`). Each container picks a material from
its fill class (`white · light · grey · color · dark`), size (chip vs panel/card) and depth:
dark/grey/colour blocks → *tinted glass* of the same hue (`tintGrad`) and their texts get a deep ink of
that hue (`deepInk`) instead of white; boxes → white glass chips; nested containers → flatter panels;
root containers → cards; a box around one row → emphasis tile; green/red/vivid box outlines → a tone ring;
rules under headings → accent line; other rules/separators → hairlines; signals → capsules (inside the
box when the value is boxed). Text weight follows the role; numbers use tabular figures; Excel text
rotation (`xf.rot`) is honoured in both designs.

**Extending:** a new recogniser (e.g. charts drawn with cells, timelines) adds properties to the scene
in `inferRoles`; a new theme is a new function from scene → HTML. Neither touches the reader or editor.
Test any change with layouts of very different kinds (see §10) – not only the weekly report.

### 6.4 Cover, index, page numbers, logo
* `coverHtml()` / `indexHtml()` in model.js, both designs. Cover: kicker (`note`), auto-sized title,
  accent bar, subtitle, date chip; Glass adds three glass shapes, Excel a navy panel. Index lists the
  content slides with numbers, titles, subtitles, dotted leaders and **page numbers**.
* Page numbers: `pageNumber(i) = pn.start + i` (the cover counts as a page); `pageNoFor(i)` returns the
  label or null; `pageNoHtml()` draws it (capsule or plain, position, font, size). Bottom-right numbers
  move left of the logo; top-left numbers push the title to the right.
* Logo: `logoSrc()` → `/assets/<name>`; hidden per slide with `cfg.logo = false`.

---

## 7. Editor (app.js, wizard.js)

* **Open flow** (`openBuffer`): index → preset? → *Continue with preset* / *Open editing wizard* box →
  `wb.ensure(sheets the preset uses)` → `runtimeSlides()`. Start-up and *Reload* skip the box.
  A workbook changed on disk shows a reload banner (`watchFile`, every 4 s).
* **Wizard** (`runWizard`): 1 sheets (from `wb.meta`), 2 tables (spreadsheet view built once per sheet
  and cached; drag to select, type a range, “x” tables, detected suggestions from `detectTables()`),
  3 slides (drag tables between slides, cover/index, logo per slide). Returns a new preset or null.
* **Selection** is Excel-like: click/drag/Shift, arrows, Tab/Enter, F2/typing opens the inline editor,
  Delete, Ctrl+B/I/Z/Y/A. Hit testing uses **one overlay per table** and a binary search over column/row
  edges (`cellFromPoint`) – no per-cell elements.
* **Edits** go through `mutate(label, fn, full)` → `commit()` (undo snapshot = JSON of this workbook's
  preset + edits, max 200) → `afterChange()`. Cell edits use `refreshStage()`, which re-renders only
  the affected table and swaps only the changed elements (`patchTable`). Full rebuilds (`renderStage`)
  are for slide changes. `EDITV` (edit version) invalidates cached `sheetKey()`, `effItems()`,
  `glassGeom()` and table HTML.
* **Thumbnails** are built lazily (IntersectionObserver) and big tables are drawn without text there.

---

## 8. Export (slide_builder.py)

`POST /api/export {format: pdf|png, mode: exact|vector, css, slides[], names[], scale, inline?}`.
The `Exporter` tries engines in order, each must pass a **self-test** first (background at start-up):

| # | Engine | How | Typical blocker |
|---|---|---|---|
| 1 | `Playwright` | Python package driving Chrome for Testing from `engine\` / local copy | package not installed |
| 2 | `DevTools · <browser>` | own websocket client → `Target.attachToTarget` | Edge policy (“Not allowed”) |
| 3 | `Command line · <browser>` | `--headless --screenshot` per slide (crop computed by self-test) | headless disabled / hangs |
| – | in-window | client renders SVG-foreignObject → JPEG → `POST /api/assemble` | always works |

Browsers: Chrome for Testing (installer) first, then system Edge/Chrome. Failing engines are disabled
for the session (`permanent` errors), hung processes are killed with their children (`run_killable`,
`taskkill /T`). While engines are still being tested the client exports in-window instead of waiting.
**Network drives:** programs cannot run reliably from shares, so `mirror_engine_locally()` copies
`engine\…` to `%LOCALAPPDATA%\SlideBuilder\engine` once and runs it from there.

PDFs are written by `jpegs_to_pdf()` (JPEG q95 pages, or PNG pages embedded losslessly with the PNG
predictor). Vector mode uses `printToPDF` with `@media print { .page { zoom: .8 } }`.
Output names: `<workbook> - slides.pdf`, `… (vector).pdf`, `<workbook> - <slide>.png`; a file locked
by a PDF viewer gets a time suffix.

`--setup` installs: optional `pip install --user playwright` (Python ≥ 3.9), then downloads the
Chrome-for-Testing **headless shell** with Python's `urllib` (uses Windows certificates and proxy –
Node-based `playwright install` fails behind SSL inspection), version matched to the installed
Playwright or the current Stable; a manually downloaded zip in `engine\` is unpacked instead.
The app can run the installer itself (`POST /api/engine/install`, output polled from `GET`).

---

## 9. HTTP API (127.0.0.1 only)

| Method & path | Purpose |
|---|---|
| `GET /` | the app |
| `GET /api/health` | `{app, version, folder, export, engine:{state, browser, local, error, engines[]}}` |
| `GET/PUT /api/settings` | read / write the settings file |
| `GET /api/files` | workbooks in ROOT (and backend) with mtime/size |
| `GET /files/<name>` | workbook bytes (ROOT, then backend) |
| `GET /assets/<name>` | logo / images (backend, then ROOT) |
| `POST /api/upload?name=` · `GET /api/upload/<id>` | keep a dropped workbook in memory (6 h) |
| `POST /api/convert-workbook?name=` | .xlsb/.xls → .xlsx via Excel (Windows) |
| `POST /api/convert?ext=emf` | EMF/WMF/TIFF → PNG via GDI+ (Windows) |
| `POST /api/export` | render & save (see §8); `inline:true` returns PNG data URLs (clipboard) |
| `POST /api/assemble` | build a PDF from client-rendered JPEGs |
| `POST /api/open {name}` / `{folder:true}` | open an export / the export folder in Windows |
| `POST /api/engine/restart` · `POST/GET /api/engine/install` | re-test engines · run/poll installer |

---

## 10. Development

* **Build:** `python backend/src/build.py` concatenates `shell.html` + CSS + JS into
  `backend/slide_builder.html` (see the docstring for the placeholder map). All JS shares one global
  scope, load order: `core.js, drawing.js, app.js, scene.js, model.js, wizard.js`. There is no bundler and no
  framework on purpose.
* **Run:** `python backend/slide_builder.py [--port 8765] [--no-browser] [--setup]`.
* **Environment switches (testing):**
  `SLIDEBUILDER_BROWSER=<exe>` force a browser · `SLIDEBUILDER_ENGINES=playwright,devtools,cli`
  restrict engines · `SLIDEBUILDER_FORCE_NETWORK=1` pretend ROOT is a network share ·
  `PLAYWRIGHT_BROWSERS_PATH` (set automatically to `engine\` when it exists).
* **Testing approach used so far:** Playwright scripts against a running helper (open → wizard →
  edit → export → rasterise the PDF with pdf2image and look at it). Useful synthetic workbooks: x-marker
  tables with hidden rows/cols and CF; no-marker sheets with several tables; a picture stress test
  (groups, crop, rotation, SVG, EMF, chart, text box); a 30 MB workbook with 50k-row sheets;
  “tricky” files (cells without `r`, wrong-case part names, broken sheet XML, fake .xlsb/.xls);
  **layout variety for the Glass design**: a key/value control panel (dark label column, boxed values,
  highlighted cell, underlined headings), a “Depo” slide (vertical section labels on dark blocks, boxed
  labels, boxed values in repeated columns, spacer rows/columns, flags, a pasted title picture), a ruled
  grid, KPI cards, a filled text block, decorative thin bands – plus the classic report tables.
* **Performance budget** (fast desktop; expect 2–4× on a corporate laptop), slide with a 400×14 table:
  open slide ≈ 240 ms, cell edit ≈ 200 ms (≈ 100 ms of it is the scene model), arrow key ≈ 10 ms,
  ~9k DOM nodes. Index of a 31 MB
  workbook ≈ 0.3 s, one 28 MB sheet ≈ 2.4 s. Re-measure after changes to renderers.

---

## 11. Gotchas

1. **Never edit `backend/slide_builder.html`** – edit `src/` and rebuild.
2. **Slide CSS is exported**: `exportPayload()` sends `#slidecss` + `#wallcss` only. Anything a slide
   needs must live in `slide.css` (not `ui.css`) or inline styles; images must be data URLs
   (logo is converted before export).
3. **Glass surfaces need `placeGlass()`** after any geometry change (`applyLayout()` does it). A new
   glass element must have class `wb` and inline `left/top/width/height`.
4. **Keep the hot paths cheap**: no per-cell event listeners or elements beyond what is drawn; reuse
   `sheetKey()`/`EDITV` caches; bump `EDITV` whenever cell edits change outside `commit/restore`.
5. **Hidden sheets stay hidden** – the reader skips them on purpose (user requirement).
6. Corporate Windows: Edge DevTools may be disabled, headless Edge may hang, `T:\` shares cannot run
   executables, TLS is intercepted (use Python `urllib`, not Node, for downloads), the console may be
   cp1252 (`log()` is encoding-safe), PowerShell may be in Constrained Language Mode (GDI+ via ctypes is
   tried first for pictures).
7. The settings file is the single source of truth and is human-readable – keep keys stable and
   migrate old shapes in `normSettings()` (example: `pageStart` → `pn`).

---

## 12. Known limitations / ideas

* Charts are not redrawn (users paste them as pictures); data bars, colour scales and icon sets are
  not reproduced (reported in the side panel).
* Formulas are not recalculated – cached values from the last Excel save are shown (links must be
  updated in Excel before saving).
* Text edits are keyed by cell address; inserting rows above a table moves edits to other cells.
* Possible next steps: Web Worker for parsing, virtualised rendering for > 10k-cell tables,
  PPTX export, per-slide design overrides.
