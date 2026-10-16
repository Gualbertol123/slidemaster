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
* `computeLayout` keeps its signature; with `on` it returns the saved boxes (tables scaled to their box) and skips the
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
