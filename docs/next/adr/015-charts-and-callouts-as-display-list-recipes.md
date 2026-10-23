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

## Amendment 2026-10-22 (B52, 4.10: reference lines from cells, gap arrows, change pills)
*Status: proposed (the owner's request B52 of 2026-10-22, with a picture: the weekly loans line against "EoM budget" and
"Ambition" as dashed lines, the gap to budget as a red arrow, the week-on-week changes as pills).*

**Reused, not added.** The three extras are three new **kinds of mark** in the chart's existing `marks` map – `ref`,
`gap`, `change` – so they inherit everything M14 built for marks: one whole entry per extra (`item.patch` merges `marks`
per entry: one undo step per control, two writers on two lines both win), random ids (`newEntryId`), removal with the
series they stand on (`removeSeriesPatch`), a `hit` per mark on the stage, the chart's cache key (`chartKey` hashes the
item; `refSheets` / `itemSheets` add the cells a line reads, so a reload, a linked workbook or a scenario's value is
another key), and the PowerPoint overlay (`pptx/chart-overlay.ts`: the gap arrow is one more `ArrowSem` – one line shape
with native `a:headEnd` / `a:tailEnd`; pills and labels are plain shapes and text boxes of the overlay walk). The point
value labels are the series' own M14 labels (the panel's Targets section only offers them for the line). M14's existing
"line at a value" mark (`kind: "line"` with one `{x, y}` place) stays as it was: its value is a typed number.

**New** (all in `render/chart-targets.ts`, called by `chart-marks.ts` and laid out by `chart-series.ts` seriesLayout):
* `ref`: `value` a DataRef (any sheet, a linked workbook, a deck table – read like a series' cells, in the cell's number
  format, so a reload and *Run for each value* move it) or a typed number (the fallback); `name` text or a DataRef;
  `axis`; `show` (both / name / value / none), `pos` (label at the right end – the plot leaves room for it –, the left
  end, above the line); `style` (colour, width, dash: dashed by default). The values join their axis's automatic bounds.
* `gap`: `a` = `{s, i}` (`i` −1 = the last point with a value), `ref` = a `ref` mark's id; label = point − line, signed
  (+ / − U+2212), in the line's cell's format (or `num`), optional % of the line (`pct`), a caption; `signs` colour by
  sign (the design's pos / neg, a grey for 0; own colours per sign) or `"fixed"` (`style.color`); `style.heads` (default:
  a triangle at the point's end); `pos` right / left of the point.
* `change`: pills between consecutive points of `a.s` (`pairs` all / last), the absolute (`abs`) and / or % (`pct`)
  change, colours as `gap`, `pos` "axis" (a row above the plot's floor) or "line" (under the lower point), a caption.
* `off` on any mark: kept, not drawn.
* Defaults per design (`targetLook`): the first line the design's ink, the others its grey; the Excel designs with the
  Intesa Sanpaolo template (B48) its blue and 50 % black, its green for a rise; Liquid Glass Apple's green / red; the
  consulting designs their palette's pos / neg. Numbers use the workbook's separators, as every chart text.
* Drawn on column, line, area and combo charts (an Issues line on other types); not on horizontal bars, scatter or
  waterfall charts.

**PowerPoint.** A reference line is a **real line series** of the native chart (Edit Data shows it): its value in every
row of the embedded workbook – the first row the number in the cell's format, the others the formula `=$X$2`, so
changing that one cell moves the whole line –, no marker, no labels, left out of the legend; its label is a text box.
To reach across the whole plot as on the slide, the reference series stand on the **secondary axes**: a hidden category
axis "on tick marks" (`c:crossBetween val="midCat"` on its value axis) and a hidden value axis with the primary one's
bounds (`BarsSem.refAxis`). A chart that already has a right axis has no third pair: there the lines stand on their own
axis's line group and reach from the first to the last category's centre – on the slide too (`refSpan: "centres"`), so
both agree; an Issues line notes that PowerPoint draws such a left-axis line under right-axis columns. The slide's own
line node is left out of the PowerPoint overlay (`MarksOut.native`). Never a picture, never `p:cxnSp`, no external link.

**Review of B52 (2026-10-22).** One chart group per type and axis pair: with a right axis, the reference lines join the
left (or right) axis's own standard line group – never a second `c:lineChart` on the same axes (PowerPoint would repair
or merge it); on an axis whose lines PowerPoint stacks (the template's stacked areas drawn as stacked lines) a reference
line cannot be a series there, so it is a plain line shape of the overlay, at the same place, with an Issues line. A
100 % axis shows shares: a reference line (and a gap arrow to it) is not drawn there, with an Issues line. A stacked
series' points stand on the stack's top, not on its own value: a gap arrow from it would measure the wrong thing, so it
is not drawn, with an Issues line (change pills keep the series' own changes, placed by its drawn points). A value
cell the shown version empties (its removed cells) hides that line and the gaps to it, with an Issues line (an
emptied name cell only leaves the name blank). Removing
a reference line in the panel removes its gap arrows in the same patch (one undo step).

**Format.** The entries fit inside `marks`, which 4.9 stores – but 4.9 does not *draw* them (`chart-marks.ts`
`default: continue`), and its panel lists them as marks it cannot show: a deck holding one is raised to **format 7**
(ADR-019 amendment of the same day).

**Amendment 2026-10-22 (B53, 4.11): label places, labels moved by hand, axis bounds from cells, room.** The owner's
second picture of the target chart. All of it is made in `seriesLayout` (and `chart-targets.ts`), so the slide, PDF, PNG
and PowerPoint agree.
* **Room.** The plot keeps on its right only the measured width of the labels present: a reference label "right"
  (after the plot's end) may run into the card's own padding (`unit`, the item's box, against the frame) when nothing
  stands beside the plot; a gap label is measured on its own difference and side (`labelSide`, `pos`), not on a sample
  as wide as the line's value; the 4 px right-axis gap is not added to the labels' room. A line's value label above its
  highest point brings the plot's top down by what it lacks (else it ran over the title – the one change to a chart
  without targets, and only where it happened). One series with targets: no legend unless `legendAt` is chosen (the
  pie's `legend` – "right" on every new chart – does not count on a series chart).
* **A reference line's text.** The mark's `num`, else the cell's format – but a cell in General, and a typed value, take
  the format its axis's tick labels show (the "12000" beside an axis of "12.000"); no name: the value alone.
* **Places.** Series `labels.pos` "auto" (below a dip – both neighbours higher –, else above; the 4.7 collision rule then
  flips it as before; PowerPoint: the series "t", each differing point its own `c:dLblPos`); `points[i].pos` (a line
  point's; a bar's above / right → outside end, below / left → inside base, centre). Reference label `pos` adds
  "below" (under the right end) and "inside" (on the line inside the plot, the card's ground – its fill and opacity – behind
  it so the dashes do not cross the text). Gap: `from` "point" (end a at the point, the default head at the line),
  `labelSide`, `capPos` "above". Pills: `pos` "point" (under each pair's later point), "above" (a row along the plot's
  top), "below" (a row under the category labels: the plot leaves its height); `capPos` "right" / "below".
* **Labels moved by hand (`nudge`).** Per chart, a map label key → {dx, dy} as fractions of the chart's box (clamped to
  ±1): "title", "v:<series>:<i>" (a point value, the series' own index), "r:<mark>", "g:<mark>" (the difference and its
  caption together), "c:<mark>:<i>" (the pill ending at point i), "c:<mark>:cap". Each is added to where the layout puts
  the label, so a label follows its point when the data move and its chart when it is resized; collisions are decided
  before it (a moved label is where the user put it). The screen's list carries one `hit` "label" per label
  ("<item>|<key>", invisible, never in an export's list) for the stage's drag; the drop is one `item.patch` of that entry, and a click without a move selects the mark or point
  under the label, as without one (review).
  PowerPoint: a point value is its series' `c:dLbl` with `c:layout/c:manualLayout` x / y (the offset as a fraction of the
  chart space, the frame); the title's manual layout and the overlay's text boxes are placed from the moved layout.
* **Axis bounds from cells.** `axes.<y|y2|x>.cells` {min, max, step}: each a DataRef (its first cell) over the typed
  number; a cell without a number (a step ≤ 0) leaves the typed / automatic one and adds an Issues line; the chart's key
  follows the cells' sheets (a reload, a scenario's value, *Run for each value*); PowerPoint writes the resolved `c:min`,
  `c:max`, `c:majorUnit`. A min not below the max goes back to the typed / automatic bounds with an Issues line, and
  `autoScale` drops any max not above the min (also a max cell below the automatic minimum): never min ≥ max (review).
* **Format.** 4.10 keeps these keys whole (or, `nudge`, not at all) but draws them its own way: format 8 (ADR-019
  amendment of the same day).


**Amendment 2026-10-23 (B54, 4.13): the chart card and a long table's filter.** The owner's picture of 2026-10-23 (a row
of KPI cards over two chart cards) asks for charts that carry their own numbers. A series chart gains optional parts
inside its own box, each an item key switched on and off in the chart panel's *Card* section, all drawn from the chart's
data (or a cell) so a reload, a scenario and Run for each value move them (render/chart-card.ts):
* `tag` – a small text (or a cell's) in the title line's right corner, its colour; a long title is cut with "…" before it;
* `stats` – up to 4 chips under the title: a small caps label over a big value – the last / first / previous / lowest /
  highest value of a series, a cell, a reference line's value, the last value's gap to a reference line (absolute or %),
  coloured by sign with a good direction (up / down / neutral) where asked (the gap by default);
* `sep` – a hairline under the stats row (`{}`: the design's);
* `moms` and `momLabel` – the momentum row at the bottom: up to 6 chips of the last value's change against the first
  value, the lowest (since the trough), the highest (since the peak), the previous value or a cell – absolute, % of
  |base| (a negative level too; a zero base "n/a" and an Issues line) or both, a change shown as zero reads "+0 (+0.0%)"
  in the design's grey, coloured by sign with a good direction; a caption under each (automatic: "vs Q3", "since trough").
seriesLayout reserves their room (the title, then the stats row and separator, the plot, the momentum row): the plot
shrinks, so the native PowerPoint chart's plot moves with it; a box too small drops the momentum row, then the stats row
(Issues lines), the plot keeping 60 px. The parts are overlay nodes – text boxes and a line over the native chart in
PowerPoint, never pictures. A chart without them lays out byte-identical.
`filter: { by, eq }` reads a long table: only the rows whose cell in column `by` (a range as tall as the values') shows
`eq` (a text, or a cell's text – a scenario or Run for each value can switch the product); categories and every series
are filtered alike; Issues lines for a missing column or value cell, a column of another height, no matching row, an
empty value; a scatter chart takes none. (A sub-range of the table draws one product too, but breaks when the table's
rows move or grow – the filter does not.) Format 9 (ADR-019 amendment of the same day).


**Amendment 2026-10-23 (B55, 4.14): the budget-achievement chart and a chart card's subtitle.** The owner's picture 19
(next to the B54 slide: "BUDGET ACHIEVEMENT – Latest volume / EoM budget", one tall bar per product) asks for a progress
chart. Two models were weighed: an option on the column chart (`progress: { target }` on a series chart) and a chart type
of its own. **Chosen: a chart type, `type: "progress"`, with its whole spec in one plain key `progress`**
(types.ts ChartProgress), laid out by its own module render/chart-progress.ts inside the same card as every chart. Why:
its data is not a series (a value AND a target per category, or a long table's last row per group – neither fits
`sers` / `groups`), its layout shares nothing with seriesLayout's axes, ticks, legends and labels (the % above, the name
and gap under, no axis), and a series chart with an option would have to switch most of seriesLayout off; a type keeps
seriesLayout untouched (no snapshot moves) and makes the switch in the chart panel one key. What it shares is reused:
the chart's card and padding per design (chartNodes), the B54 card parts (title, the new subtitle, tag, separator:
chart-card.ts cardRoom / cardParts), one delta rule (deltas.ts: the gap's sign "+210" and never "−0", the value
cell's number format, General as #,##0), the cell rules (chart-data.ts: hidden rows, a version's removed cells,
reload / scenario through ctx.sheet()).
* Data: `vals` / `targets` (rectangles read in order: a range or single cells; ONE target cell serves every category),
  `cats` (a range or names; else the item's labels, else the text beside the values); or `table: { by, val, target }` –
  per value of column `by`, in the order the values first appear, its LAST row with a number in `val` (the latest
  period) and the target in that row. Issues lines for a missing value or target, a target of 0 or less ("no
  achievement": "n/a" above the bar, an empty track), columns of other heights, more than 8 categories; never a throw.
* Look: the track (100 %), the fill up to value / target capped at the track; `over` "color" (another fill) or "mark"
  (a band of it at the bar's top), default none; colours `fill` / `track` / `overFill`, unset the design's dark (the KPI
  card's header colour – the B54 slide's), a light grey of it, the design's positive colour. The % above (`pct`: off,
  number format, text format; default the design's accent, 1.9 × the label size, bold), the name under it (`cat`: off,
  caps), the gap under that (`gap`: off, words "over" / "to go", sign "over" | "both" | "none", number format). The bars
  stand at Excel's slots (a bar is 1 / (1 + gap) of its slot, the item's `gap`, default 40 %; never wider than 180 px –
  the gap then grows, at most 500 %). The value axis and gridlines only when `axes.y.show` / `axes.y.grid` is true.
* PowerPoint: a NATIVE clustered column chart of two series overlapped 100 % – the track (1 per category) and the fill
  (value / target capped at 1; in the embedded workbook a formula of the Value and Target columns written after the
  series, `{E1}` / `{E2}` tokens of chart.ts) –, its gap width as drawn, the plot at the drawn rectangle, the axes
  deleted unless shown, the % as the track's data labels (static rich text, refreshed at every export), the title as the
  chart's own; the subtitle, tag, separator, names, gaps and over bands are text boxes and shapes over it (the overlay).
* `subtitle` (any chart, text or a cell): a small grey line right under the title (cardRoom reserves it, the plot moves
  down); a chart without one lays out byte-identical.
Format 10 (ADR-019 amendment of the same day).
