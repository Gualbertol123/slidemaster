# ADR-015: Charts and callouts are slide items drawn with the existing eight display-list nodes

* **Status:** proposed (Phase 0 design, 2026-10-16; needs 07 §8 Q6)
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
