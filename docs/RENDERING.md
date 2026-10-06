# Slide Builder – how workbooks become slides

The reading and rendering algorithms were carried over from v2.3 unchanged in behaviour (verified
by `frontend/e2e/parity.mjs`, which renders the same workbooks with both versions and compares the
HTML), except for the fixes listed in `docs/REVIEW.md` (number formats, conditional formats).
This file describes them; `docs/ARCHITECTURE.md` describes storage, sync and the HTTP API.

In v3 nothing reads globals: renderers receive a `RenderCtx` (`render/context.ts`) with the deck
style, the cell edits, the slides and the workbook name. Per-table caches (`L._cache`) are keyed by
the JSON of that sheet's edits, so a change by another user re-renders only the tables it touches.

## 1. Reading workbooks (`src/xlsx/`)

**Index first, parse on demand.** `indexWorkbook()` only unzips the directory, reads
`_rels/.rels` → workbook part → sheet list. Hidden sheets are never listed nor read; chart/dialog/macro
sheets are skipped. Sheets are parsed by `wb.ensure(names)` when chosen in the wizard or needed by a
preset. Workbooks with < 12 MB of uncompressed sheet XML (and < 6 MB file size) are read completely
up front so the wizard can show titles and table suggestions; larger ones show sizes and “not read yet”.

**Fast parser.** `readSheet()` (`xlsx/workbook.ts`) uses regular expressions over the XML string (no DOMParser for
sheetData – far faster and lighter on 50k-row sheets) and yields to the UI every 4000 rows for the
progress bar. `parseSST()` does the same for shared strings. Handles: namespace prefixes, rows/cells
without `r`, `<v xml:space=…>`, inline strings, rich text, `_xHHHH_` escapes. Styles, theme and
drawings are small and use DOMParser. A parity test against the old DOM parser was run on all test
workbooks (identical cells, merges, hidden rows, CF, pictures, tables).

**Robustness:** case-insensitive / %-encoded part names (`zget`), damaged sheets become
`brokenSheet()` stubs (listed as “could not be read”), format detection:
`PK..` zip, `D0 CF 11 E0` = old .xls or encrypted (IRM/sensitivity label) → `CFB`,
`xl/workbook.bin` → `XLSB`. CFB/XLSB are sent to `POST /api/convert-workbook` (helper) (Excel COM, read-only
temp copy, macros/events/link updates off) and the resulting .xlsx is read.

**Tables.** `findRegions()` (`xlsx/layout.ts`) pairs “x” cells (top-left with the nearest bottom-right whose rectangle
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

## 2. Rendering (`src/render/`, `styles/slide.css`)

### 2.1 Slide layout (`render/slide.ts`)
`computeLayout(R, w)`: tables are arranged in **bands** (`layout.bands`), each table scaled by
`k × w[i]`, where `k` is the largest factor (≤ `MAXK = 2.0`) that fits the content area
(`areaFor(R)`: x 50…1550, y 104…822, or from 126 with a subtitle). Gaps `GX = 36`, `GY = 28` stay
constant. Default layout: tables of the same sheet that share rows sit side by side, others stack.
Resizing a table binary-searches the weight that makes its width follow the mouse; moving drops it
left/right of another table or into a new band above/below.

### 2.2 Excel design – `renderExcel(L, ctx)` (`render/excel.ts`)
Absolute-positioned divs: one background/border div per styled cell, one text div per non-empty
cell, shapes, text boxes, pictures. Fonts fall back to Century Gothic → Arial.

### 2.3 Scene model and the Liquid Glass design (`render/glass.ts`)

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

### 2.4 Cover, index, page numbers, logo (`render/cover.ts`, `render/pagenumbers.ts`)
* `coverHtml()` / `indexHtml()`, both designs. Cover: kicker (`note`), auto-sized title,
  accent bar, subtitle, date chip; Glass adds three glass shapes, Excel a navy panel. Index lists the
  content slides with numbers, titles, subtitles, dotted leaders and **page numbers**.
* Page numbers: `pageNumber(i) = pn.start + i` (the cover counts as a page); `pageNoFor(i)` returns the
  label or null; `pageNoHtml()` draws it (capsule or plain, position, font, size). Bottom-right numbers
  move left of the logo; top-left numbers push the title to the right.
* Logo: `ctx.logoSrc` → `/assets/<name>?t=<token>`; hidden per slide with `cfg.logo = false`.

---

## 3. Editor (`src/editor/`, `src/wizard/`)

* **Open flow** (`openBuffer`): index → preset? → *Continue with preset* / *Open editing wizard* box →
  `wb.ensure(sheets the preset uses)` → `runtimeSlides()`. Start-up and *Reload* skip the box.
  A workbook changed on disk shows a reload banner (`tick()` in state/app.ts, every 6 s).
* **Wizard** (`wizard/Wizard.tsx`): 1 sheets (from `wb.meta`), 2 tables (spreadsheet view built once per sheet
  and cached; drag to select, type a range, “x” tables, detected suggestions from `detectTables()`),
  3 slides (drag tables between slides; cover and index are ordinary, movable entries; logo per slide).
  Returns a new preset or null. If somebody else changed the slides while the wizard was open, saving asks first.
* **Selection** is Excel-like: click/drag/Shift, arrows, Tab/Enter, F2/typing opens the inline editor,
  Delete, Ctrl+B/I/Z/Y/A. Hit testing uses **one overlay per table** and a binary search over column/row
  edges (`cellFromPoint`) – no per-cell elements.
* **Edits** become operations (see 3.1). Cell edits use `refreshStage()`, which re-renders only the
  affected table and swaps only the changed elements (`patchTable`). Full rebuilds (`renderStage`) are
  for slide and style changes. Caches (`effItems`, `glassGeom`, table HTML) are keyed by the sheet's
  edits (`sheetKey(ctx, S)`).
* **Thumbnails** are built lazily (IntersectionObserver) and big tables are drawn without text there.

### 3.1 Editing in v3

* Every change is an **operation** (`model/ops.ts`): `cell.patch`, `slide.patch`, `style.patch`,
  `preset.set`. `state/app.ts › change(label, ops)` applies them locally through `sync/docsync.ts`,
  which queues them for the helper and returns their **inverse** for undo. Undo/redo therefore only
  ever revert your own changes.
* Cell edits use `editor/edit.ts › applySel()`: the selected cells' edits are changed on a copy and
  the differences become `cell.patch` operations.
* Table moves/resizes preview with a temporary layout (`applyLayout(slide, R, ctx, w, lay)`) and
  commit one `slide.patch {layout}` on pointer-up.
* Remote changes arrive via `DocSync.poll()` every 3 s; `onDocChange` rebuilds slides only when the
  preset changed, otherwise it swaps changed cells in place (`refreshStage`).
