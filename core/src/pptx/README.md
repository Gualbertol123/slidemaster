# core/src/pptx · the PowerPoint writer

Display list (`../dl/types.ts`) + what the core says of each slide (`SlideList.sem`) → a `.pptx`, in pure TypeScript
(no DOM, runs in the export worker; zipped with fflate, no new library). docs/next/07 §4 (amended 2026-10-19), ADR-016,
B21. The display list is the truth for geometry: every element lands where its nodes are drawn on screen and in the PDF.

```ts
import { writePptx } from "@slide-builder/core/pptx/writer";
const bytes = writePptx({ slides: lists.map(l => ({ nodes: l.dl.nodes, sem: l.sem ?? null })), image: id => bytesOf(id),
  face: css => pptxFamily(css, has), title: "Weekly", design: "Liquid Glass" });
```

| File | What |
|---|---|
| `scene.ts` | `sceneOf(nodes, sem, hasImage)`: the display list → a native scene (shapes, pictures, text boxes, real tables, chart frames, groups); `baselineIn` (PowerPoint's baseline in a line of exact spacing, measured) |
| `drawingml.ts` | the scene → PresentationML / DrawingML markup; EMU (`E`: 1 px = 7 620 EMU) and points (`PT` = 0.6 per px) |
| `chart.ts` | a pie / donut as `c:chartSpace` with cached labels and values, and the embedded two-column workbook |
| `writer.ts` | `writePptx(input)`: the package – content types, relationships, the master and its layouts made from the deck, the theme, slides, media once each, docProps; the same slides give the same bytes |

## The slide and its units

* 16:9, `p:sldSz` 12 192 000 × 6 858 000 EMU: slide px × 7 620. Points are px × 0.6 (1600 px across 960 pt).
* Text: exact line spacing (`a:spcPts`) at the display list's pitch (a single line: its element's height when that is a
  line's, else 1.2 em); the box's top inset puts the first baseline on the display list's, with PowerPoint 16's measured
  rule `baselineIn` (0.75 S from the line's top; S − 0.225 em while S is 0.9–1.2 em – the same in Segoe UI, Arial,
  Century Gothic, Georgia and Calibri). Frames 2 % wider for PowerPoint's own metrics; `wrap="square"`; autofit off.

## How each node becomes PowerPoint

| Node | PowerPoint |
|---|---|
| `rect` | `p:sp`, `prstGeom` `rect` or `roundRect` (adj = radius / shorter side), other radii `custGeom`; a rect filling its group's rounded clip takes the clip's corners; fill and `a:ln` below |
| `path` | `prstGeom` `ellipse` for four cubics round a box, `rect` for an axis-aligned rectangle, else `custGeom` (move / line / cubic / close) |
| `line` | `p:sp` with an open `custGeom` path and `a:ln` (width, `custDash`, cap) – never `p:cxnSp`; on a table's cell edge, the cells' borders |
| `image` | `p:pic`, `a:srcRect` crop, rotation, flips, `alphaModFix`; beyond its group's clip, the clip is its geometry (`roundRect`, `ellipse`, `custGeom`) and the part outside cropped away – Liquid Glass's frosted surfaces are the one blurred wallpaper so; a keyed picture's shadow its `outerShdw` |
| `shadow` | outer, blurred: the next shape of its box gets it as `outerShdw` (the strongest of the recipe's layers; the spread as `sx`/`sy`); inset: the shape under it gets `innerShdw`; sharp (no blur): a shape of its own, the box moved and grown by the spread |
| `text` | runs of one element (the last hit holding them) → one text box: lines by baseline, paragraphs by the hit's label (wrapped lines are one paragraph), runs per style (`sz`, `b`, `i`, colour + alpha, `spc`, `u`, `strike`, `baseline` ±), a decorative copy → the run's `outerShdw`; turned text → a turned box; titles, cover subtitles, footers, page numbers → placeholders (`title`, `ctrTitle`, `subTitle`, `ftr`, `sldNum`) |
| `group` | its transform composes (a turn becomes the shapes' `rot`), alpha multiplies into the paints, a clip as above; a table's group ("tw" hit) becomes the table below |
| `hit` | nothing drawn: hits mark elements (text owners), cells (kind "t") and items |

**Paints**: solid → `solidFill` + `alpha`; linear → `gradFill` `lin` at the direction's angle (`scaled="0"`), the stops
moved onto the box's projection on it; radial → `gradFill` `path="circle"` from its centre (`fillToRect`), the stops
scaled to the farthest corner. **Strokes**: `a:ln` with the same fills (a gradient rim too).

**Tables** (`buildTable`): the grid is every cell box's edges (kind "t" hits); a box over several grid cells is a merged
cell (`gridSpan` / `rowSpan`, `hMerge` / `vMerge`); a solid rectangle or Excel's seam polygon over one cell (or merged
cell) is its fill; a line on a grid line from one edge to another – or a thin separator across half the table – sets
the borders of the cells on both sides; cell texts go in when PowerPoint can lay them out in the row (one line's pitch at
most the row: rows never grow), else they stay text boxes over the table; empty cells are 1 pt paragraphs. Style
"No Style, No Grid" ({2D5ABB26-…}): only what the slide draws. The table sits where its cells' texts are drawn, with
its other shapes (cards, capsules, bars, sparklines) under and over it in one group.

**Items** (`sem.items`, by their node range): a chart is its card (drawn alone by `chart-dl.ts` with `noContent`) and a
`c:chart` frame over the plot area; a callout's main shape becomes its preset (`rect`, `roundRect`, `ellipse`,
`rightArrow`, `wedgeRoundRectCallout` with the tail's tip as adjustments) holding its text, insets from the preset's own
text rectangle.

## The package

* `ppt/presentation.xml`, one `slideMasters/slideMaster1.xml`, `slideLayouts/` – one per kind of slide the deck has
  (cover "Title Slide", contents, content "Title Only") and "Blank" –, `slides/`, `theme/theme1.xml` (the design's name,
  its chart palette as accents, the titles' and the body's fonts), `presProps`, `viewProps`, `tableStyles`, `docProps`
  (no time unless given: the same slides give the same bytes), `media/` (each picture once, by content), `charts/` and
  `embeddings/`.
* **Made from the deck** (product owner, 2026-10-19): a slide's background is its topmost opaque full-slide rectangle or
  picture (Liquid Glass's wallpaper: the master's background); a layout takes the background all its slides share and
  the decoration they all begin with (two slides or more); slides keep only what is theirs. Placeholder templates on the
  master and layouts sit where the deck's slides have them.
* Nothing outside the file: no `TargetMode="External"`, no connector shapes. ECMA-376 1st edition features only (no
  p14 / p15, no SVG) – PowerPoint 2016 reads them.

Checked by `tools/pptxcheck.py` (structure and a lint of what PowerPoint repairs silently – child order, unique ids,
value ranges, table rows; python-pptx: texts, tables, charts; PowerPoint 16 opening it: a file it cannot read raises)
in `npm run export-check`, and by `core/tests/pptx.test.ts`.
