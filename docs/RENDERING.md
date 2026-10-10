# Slide Builder – how workbooks become slides

The reading and rendering algorithms were carried over from v2.3 unchanged in behaviour (verified
by `app/e2e/parity.mjs`, which renders the same workbooks with both versions and compares the
HTML), except for the fixes listed in `docs/REVIEW.md` (number formats, conditional formats).
This file describes them; `docs/ARCHITECTURE.md` describes storage, sync and the HTTP API.

In v3 nothing reads globals: renderers receive a `RenderCtx` (`render/context.ts`) with the deck
style, the cell edits, the slides and the workbook name. Per-table caches (`L._cache`) are keyed by
the JSON of that sheet's edits, so a change by another user re-renders only the tables it touches.

## 1. Reading workbooks (`core/src/xlsx/`)

**Index first, parse on demand.** `indexWorkbook()` only unzips the directory, reads
`_rels/.rels` → workbook part → sheet list. Hidden sheets are never listed nor read; chart/dialog/macro
sheets are skipped. Sheets are parsed by `wb.ensure(names)` when chosen in the wizard or needed by a
preset. Workbooks with < 12 MB of uncompressed sheet XML (and < 6 MB file size) are read completely
up front so the wizard can show titles and table suggestions; larger ones show sizes and “not read yet”.

**Fast parser.** `readSheet()` (`xlsx/workbook.ts`) uses regular expressions over the XML string (no DOMParser for
sheetData – far faster and lighter on 50k-row sheets) and yields to the UI every 4000 rows for the
progress bar. `parseSST()` does the same for shared strings. Handles: namespace prefixes, rows/cells
without `r`, `<v xml:space=…>`, inline strings, rich text, `_xHHHH_` escapes. Styles, theme and
drawings are small and use DOMParser (the page's `XmlParser`, `core/src/platform.ts`). A parity test against the old DOM parser was run on all test
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
canvas (the page's `TextMeasurer`); row heights are pt × 96/72.

---

## 2. Rendering (`core/src/render/`, `app/src/render/slidedom.ts`, `styles/slide.css`)

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

---

## 4. Table tools (v3.1)

### 4.1 Column widths and row heights
`table.cols` / `table.rows` (`{"<sheet column or row>": px}`, table pixels = Excel at 100 %) are passed to
`buildLayout(S, g, sizes)`; a table with sizes or colour scales gets its **own** layout object
(`resolveTable`, cached by id + sizes) so two tables on the same "x" region never share overrides.
Sized columns are listed in `L.fixedCols`; Liquid Glass keeps them exactly (`glassGeom` only widens the
others). On the slide (`editor/stage.ts`): within 4 screen px of a border the cursor becomes a resize
cursor; dragging shows a guide and the width, and applies to every selected column/row when the border
belongs to the selection; double-click a border = Excel size. The toolbar's **W / H** boxes set exact
values for the selection.

### 4.2 Same size, copy sizes, alignment (`editor/tables.ts`)
* **Make same size**: target width/height = largest, smallest or first; every column/row of each table
  is scaled (`shownColW × target / width`) and fixed, the tables get weight 1 on their slides, and when
  they are on several slides those slides get one common `slide.scale` = the smallest "fit" scale among
  them (computed on simulated layouts before anything is written), so the tables are the same size on
  screen and in the PDF. One operation batch = one undo step.
* **Copy sizes**: position by position (k-th visible column → k-th).
* **Align**: `slide.align` left / centre / right moves each band to the content area's edge.
* `computeLayout` uses the fixed scale if set, reduced only if it would not fit (`reduced` is reported).

### 4.3 Text boxes around tables
`slide.notes["<tableId>:<side>"]`. `computeLayout` treats a table plus its boxes as one unit:
left/right boxes have a fixed width (`w`, default 240 px) and the table's height; top/bottom boxes have a
height (`h`, or lines × font size) and the table's width; gap 14 px. The scale `k` is found by binary
search so that all units fit the content area. Fonts shrink (down to 9 px) until the text fits, measured
off-screen (`fitNotes`), so thumbnails and exports match the editor.

### 4.4 Colour scales (`render/scales.ts`)
`table.scales[id] = {range, dir: row|col|all, mode: zero|minmax, fill, ink, invert?}`. Numbers in the range
(Excel values, not edited text) are grouped per row, per column or all together. *zero*: positives
green, negatives red, strength = value ÷ largest (or most negative) value of the group; *minmax*: lowest
red → highest green. Strength t gives `scaleColors(t)`: fill = white→green/red at 10–82 %, ink = light→deep
green/red. Applied in `effItems` under explicit user colours. Excel design: cell fill/text colour; Liquid
Glass: a capsule in the scale colour (`.cap.scale`) and the ink.

### 4.5 Deck look
`style.radius` (0–200 %) multiplies every corner radius (glass containers, capsules, cover/index/page
number chrome, logo bubble, Excel shapes; CSS `--rk`). `style.contrast` (0–100, 50 = as designed) sets
`--wfade` (wallpaper towards white), `--gfade` (white veil on glass surfaces, an extra background layer –
`placeGlass` positions three layers) and `--wallf` (wallpaper saturation/brightness). `style.logoBubble =
false` draws the logo without its glass bubble.

### 4.6 Cell colour, merges, footer, format painter (v3.2)
* **Cell colour** – `CellEdit.bg` (`"#RRGGBB"` or `"none"`). In `effItems` it replaces the Excel fill:
  `baseFill` (structure) and `fill` (unless a conditional format colours the cell) both become the new
  colour and `userBg` is set. Liquid Glass builds its blocks from `baseFill`, so a recoloured header
  becomes one tinted block in the new colour (status capsules are not used for such cells; white text on
  it is drawn in the block's deep ink). `CellEdit.fill` is still the *highlight* – a capsule (Signal).
* **Merges** – `TableDef.merges` maps `"C4:J4"` → `"merge" | "split"`. `effectiveMerges` (xlsx/layout.ts)
  takes the workbook merges, drops split ones and any overlapping a user merge, then adds the user
  merges; `buildLayout` uses the result, so both designs and the editor follow. Merging stores
  `"merge"` and clears user merges inside the range; unmerging a user merge deletes it, a workbook merge
  stores `"split"`.
* **Footer** – `style.footer {on,text,pos,size,style,cover}`, drawn by `footerHtml` (render/pagenumbers.ts)
  after the page number. When it shares a corner with the page number or the logo it is moved inwards
  next to them; centred footers sit at the slide centre.
* **Format painter** (editor/painter.ts) – the source selection becomes a pattern of `Fmt` (size, bold,
  italic, colour, cell colour, highlight, alignment, role), tiled over the target selection when the
  mouse selection ends. Values equal to the target's own Excel format are not stored.

### 4.7 Round 4 (v3.3)
* **Themes** – `style.theme {id, c1…c4, a1, a2}`; `themeOf(style)` (model/style.ts) returns a built-in
  `ThemeDef` or the custom colours. `makeWall` paints the wallpaper from c1–c4 (pastel gradient, blobs,
  ribbons; Aurora keeps its hand-tuned values, so the default output is unchanged). Accents are CSS
  variables set on the slide by `themeVars` (`--a1/--a2/--a1rgb/--a2rgb` glass, `--x1/--x2` Excel,
  `--ixink`), with the Aurora values as CSS fallbacks.
* **Gridlines** – `TableDef.gridH/gridV` (`"on"|"off"`), applied in `effItems` (`withGrid`) to the item
  borders, so both designs follow; Liquid Glass also drops its automatic row separators for `gridH:"off"`
  and draws every vertical rule for `gridV:"on"`.
* **Painted conditional formatting** – `CellEdit.cf = "Sheet!C6"`: `evalCF(S, r, c, from)` takes the rules
  covering the source cell and evaluates them on the target's value, relative references shifted like
  Excel copies them; `"none"` removes the cell's own rules. The painter also adds a colour-scale rule over
  the painted range and copies the text colour without the conditional colour (`Item.baseColor`).
* **Vertical alignment** – `SlideDef.valign` (`top|middle|bottom`) places the bands in `computeLayout`.
* **Text boxes** – `Note.valign` (flex `justify-content`) and `Note.bubble` (a `.notebub` glass card or
  framed box behind the text, placed by `applyLayout`; the box gets 20 px more height).
* **Glass blocks next to each other** no longer overlap: the outward padding of a block is clipped at the
  midpoint to a neighbour of the same depth (3 px gap each side).
* **Redraws while editing** – `renderStage` waits while an `.inline-edit` is open and runs when it closes;
  settings boxes use `ui/Field.tsx`, which keeps the typed draft while focused.

