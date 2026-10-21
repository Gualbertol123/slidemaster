# ADR-017: Free layout is a per-design switch of `computeLayout`, saved as boxes, one op each way

* **Status:** proposed (Phase 0 design, 2026-10-16; needs 07 §8 Q9)
* **Deciders:** product owner, maintainers
* **Related:** 07 §5; PLAN S4.2 (drags share `core/render/layout.ts`); README gotcha 11 (sizes per design)

## Context
Users want to move and resize tables, charts, callouts and text boxes freely on some slides, with no re-flow, no linked
sizes, no auto-shrink, in every design, and go back to the automatic layout in one undo step without losing anything.

## Decision
* `SlideDef.free[design] = { on, items: { "t:<tableId>" | "n:<noteKey>" | "i:<itemId>": {x, y, w, h, scale?} } }`
  (optional; per design, as `sizes`).
* `computeLayout` keeps its signature; with `on` it returns the saved boxes (tables at their saved `scale`, else scaled
  to their box's width; built in S10.1) and skips the
  band/fit algorithm. Items without a box get their automatic position alone.
* Switching on writes every current box into `items` (nothing moves); switching off sets `on: false` and keeps the
  boxes (the automatic sizing was never changed). Both are one `slide.patch`: one undo step each.
* Drags: `freeMove`/`freeResize` in `app/src/stage/drags.ts`, previews per frame from the same `computeLayout`,
  snapping guides unless Alt is held, one op on pointer-up.

## Consequences
+ No second layout engine; the drag preview and the drawn slide stay the same function (S4.2 holds).
+ Per-design boxes match per-design table widths.
− Per-design means a free arrangement is made in the design it is made in (Q9); copying to other designs is an
  explicit action (later, if wanted).
− Raw Excel now draws text boxes (B19), so its `fixedScale` correction is removed with accepted parity entries.

## Evidence and alternatives
`core/src/render/layout.ts` already carries free text boxes (`notes.x/y`, `frees`) outside the flow; this generalises
that path. Alternatives: absolute positions on every object always (would break automatic re-flow for every existing
deck); a separate "canvas" slide type (a second slide model: rejected).

## Amendment (4.8, M15 S15.4; docs/next/09 §2.6, §5): snapping and positions on 1/4 px
* **Snapping for every object, in every layout** (B32): the targets are collected once at pointer-down into two arrays
  sorted by position (`core/src/render/snap.ts` `snapTargets`): the slide's edges, centre lines and margins (50 / 1550,
  the content area's top, the footer line 822), every other object's left / centre / right and top / middle / bottom,
  the other tables' column and row borders, the other lines' ends and middles. Per frame a binary search per moving
  edge or centre (`snapMove`, `snapEdge`, `snapPoint`), equal spacing over the moving box's row or column
  (`snapSpacing`) and equal sizes on a resize. The distance is 8 px on screen (`snapTol` = 8 / the stage's scale).
  **Alt disables snapping for every object in every layout** (before 4.8 a text box outside a free layout ignored it).
* **Guides are page markup** (`app/src/stage/guides.tsx`, a DOM overlay; never in the display list or an export): every
  matched line, a centre dashed; equal gaps and sizes as dimension markers with their size in px.
* **"Kept exactly as dropped"**: what a drag moves is put on 1/4 px (`snapRound` in `core/src/render/layout.ts`) before
  the preview is drawn, and the drop writes that same number (the free entry, an item's box, a text box, a line's ends).
  1/4 px is exact in binary floating point and in PowerPoint's EMU (1,905 EMU), so the saved JSON, the PDF and the
  PowerPoint file read the same value. The sides a drag does not move keep their saved value (`freeOp` does not round).
* No new keys or ops: the drops write the existing `item.patch`, `slide.patch` (free / notes) operations.

