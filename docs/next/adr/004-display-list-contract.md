# ADR-004: A display list of eight primitives is the only rendering contract (screen, PNG, PDF)

* **Status:** proposed (Slide Builder 4 design, 2026-10-08)
* **Deciders:** maintainers of Slide Builder
* **Related:** `docs/next/02-options.md`, `docs/next/03-architecture.md`

## Context
v3 renders HTML strings plus a 19 KB stylesheet. Anything CSS can do reaches the PDF, which is why
`printcss.ts` exists and why screen ≠ PDF (Segoe UI Variable, blurred shadows, masks).

## Decision
* Designs produce `DisplayList` nodes: rect, path, line, image, shadow, text (shaped glyph run), group
  (clip, alpha, transform), hit.
* The Liquid Glass scene inference is kept; only its last step emits nodes instead of HTML.
* The stage renders SVG, with one `<g>` per table swapped on change.
* Thumbnails, PNG and the clipboard use Canvas2D; PDF uses ADR-003.

## Consequences
+ Nothing can be drawn on screen that the PDF cannot draw; geometry is computed once.
+ DLs are plain data: they can be cached, diffed and golden-tested.
− `renderExcel`/`renderGlass` output and `slide.css` must be translated (03 §4.3 maps every material).
− Stepped shadows on screen (B3) unless the screen-only blur option is used.

## Evidence and alternatives
03 §2.4, §4.3; spike PDFs render every Glass material.
