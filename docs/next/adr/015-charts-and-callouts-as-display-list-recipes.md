# ADR-015: Charts and callouts are slide items drawn with the existing eight display-list nodes

* **Status:** proposed (Phase 0 design, 2026-10-16; needs 07 §8 Q6); amended 2026-10-21 for series charts (M14, below)
* **Deciders:** product owner (objects also in raw Excel, 2026-10-16), maintainers
* **Related:** 07 §2.2, §3; ADR-004 (display-list contract), ADR-002 (ops)

## Context
Pie charts (bar/column/line to follow) and data callouts must appear in all three designs, follow the data (reload,
scenario), export to PDF/PNG/PPTX and be selectable on the stage. ADR-004 fixes the backends to eight node types.

## Decision
* **Model:** `SlideDef.items: Record<id, ChartItem | ShapeItem>` with a `DataRef` (sheet id + A1 range, or table id +
  range) and a slide-px box or an attachment to a table side; a new op `item.patch` with field-level merge (two users
  editing one chart both win); op vectors and inverses.
* **Rendering:** `core/src/render/chart-dl.ts` and `shape-dl.ts` emit `path` (arcs as cubic Béziers, arrows, bubbles,
  icons), `rect`, `line`, `text`, `group`/`shadow` (glass card recipe of 03 §4.3) and `hit` nodes. **No new node type.**
  Per-design palettes come from the resolved theme (`resolveStyle`, per design), so a chart has each design's look as
  tables do.
* **Data:** items read cells through the same `ctx.sheet()` facade as tables, so a reload or a scenario overlay
  redraws them; their cache key hashes the referenced values. Callout text replaces `{Sheet!C7}` tokens with
  `formatValue` of the cell (its number format) before the text-box layout (`slide-dl.ts noteNodes`).
* **Raw Excel** draws the user's objects (text boxes, notes, comments, charts, callouts) but adds no decoration of its
  own (DS-02 reworded, B19); `notesOf`'s raw-Excel early return and `fixedScale` go, the affected corpus slides are
  accepted parity entries.

## Consequences
+ Screen, thumbnails, PNG, PDF and PPTX draw the same nodes; parity tools work unchanged.
+ Bar/column/line reuse data resolution, palette, legend, labels and hit nodes.
− Arc precision: 4 cubics per turn are within 0.03 % of a circle; fine at 1600 px and in PDF.
− Structural edits of the workbook (sheet rename, inserted rows) are not tracked, as for tables: an Issues line.

## Evidence and alternatives
03 §4.3 recipes; `dl/types.ts` validators already cover every node used. Alternatives: a `chart` node type (would
force every backend to implement chart layout: rejected, ADR-004); charts as pictures rendered by the worker (not
editable in PPTX, blurry on zoom: rejected).

## Amendment 2026-10-21 (M14, 4.7.0; docs/next/09 §2.2, §3, §4.2; plan-M14 S14.1–S14.6)
Series charts, as built on `v4/M14-charts`. Still **no new display-list node type** and no picture of a chart.

* **Model (09 §2.2, S14.P on main).** `ChartItem` keeps its 4.3 fields and gains maps that `item.patch` merges **per
  entry** (`ITEM_MAPS`): `sers` (series: `n` order, `name` text or cell, `vals` / `xs` / `target` as lists of DataRefs,
  `group`, `type` in a combo, `axis` y / y2, `color`, `line`, `marker`, `smooth`, `labels`, `points[i]` – colour, marker
  colour, label or null, and a waterfall's `total` –, `hide`), `groups` (category groups side by side, each its own
  categories, optional label and divider), `axes` (x / y / y2: min, max, step, number format, gridlines, title, line),
  `marks` (arrow, line, band, icon, text in data coordinates: a series' point, a group's edge, or x / y on an axis),
  `legendHide` and `titleFmt`; plain keys `legendAt`, `stack`, `gap`, `overlap`, `frame`, `titleRule`, `plot`. A whole
  entry is one value: two writers changing two series both keep their change, the same series – the later wins, its
  `points` included (they live inside the entry). New entries get random ids (the panel's `newEntryId`). `total` and a
  series' `hide` are fields inside an entry, `legendHide`'s "up" / "down" / "total" map entries: no new op key.
* **Old charts.** A chart without `sers` draws as before 4.7 whatever its `type`: a donut stays a donut, any other type a
  pie (09 §2.2; the panel shows it as the pie it draws, and its type switch gives it its first series from `values`).
* **Layout in one place.** `render/chart-series.ts` `seriesLayout` decides where every part goes – value axes
  (`chart-axes.ts`: Excel's automatic bounds and unit, or the axis's own), the category axis and its groups, areas
  (`chart-area.ts`), bars (`chart-bars.ts`: gap width, overlap, stacks, "actual inside target"), lines (`chart-lines.ts`),
  scatter (`chart-scatter.ts`), waterfall (`chart-waterfall.ts`), labels, marks (`chart-marks.ts`), the legend
  (`chart-legend.ts`) and the title. Both the display list (`seriesNodes`) and the PowerPoint semantics (`seriesSem` →
  `pptx/chart-sem.ts`) are made from that one layout, so the native chart's plot, bounds and legend box are the slide's.
  Data rules (hidden rows, a version's removed cells, text as a gap, linked workbooks, tables) live in `chart-data.ts`;
  text measuring in `chart-font.ts`.
* **Cache per key.** `chart-dl.ts` `cachedChartNodes` keeps a chart's nodes per key – `chartKey` (the item, its data
  including every sheet's generation, the design's look, the scenario overlay's hash, the export flag) plus its id, box,
  text family, glass variables and wallpaper hash – and takes a hit only when every text it measured measures the same
  again. A reload, a scenario value or a version is another key, so marks and labels follow the data.
* **PowerPoint (09 §4.2).** Every type is a native chart with its data in the embedded workbook (number formats per
  cell, no external link): `c:barChart` / `c:lineChart` / `c:areaChart` groups on primary and secondary axes for column,
  bar, line, area and combo; multi-level categories for named groups; targets as an outlined bar series with overlap 100;
  `c:scatterChart` with two `c:valAx`; the plot area as `manualLayout` and every axis's min / max / unit fixed to the
  drawn ones. **Marks** are plain shapes over the chart in its group: an arrow or line mark is one `p:sp`
  `prst="line"` with native `a:headEnd` / `a:tailEnd` (`pptx/chart-overlay.ts`; a limiter's bar tick stays a shape),
  bands, icons and texts are shapes and text boxes. Never `p:cxnSp`, never a picture. `pptx/scene.ts` changed in two
  lines for this (the overlay call), a recorded exception to M15's ownership.
* **Waterfall as built.** One series' steps on the running total, `points[i].total` columns standing on the axis, up /
  down / total in the design's colours, connectors between the steps. In PowerPoint: the classic stacked `c:barChart` with
  an invisible base (a step across zero in two segments), two invisible `c:lineChart` series carrying the values and the
  labels, the construction columns as **formulas** in the embedded workbook so Edit Data moves the columns while each step
  keeps its side of zero; no chartex.
* **Scatter as built.** Points at (x, y) on a numeric x axis with Excel's bounds, markers, an optional (smoothed) line;
  a point outside a fixed x range is left out; in PowerPoint `c:scatterChart` with each series' x and y columns.

Consequences: + one layout for screen, PDF, PNG and PowerPoint; marks follow the data everywhere. − Numbers inside a
PowerPoint chart take the opening computer's separators (09 §4.2 "Italian separators"); a left-axis series under a
right-axis one is drawn on top in PowerPoint (an Issues line says so); a waterfall step that newly crosses zero needs a
new export.
