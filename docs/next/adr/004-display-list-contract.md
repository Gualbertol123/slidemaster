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

## Amendment 2026-10-12 (product owner, before M3; docs/next/review-pre-M3.md finding 16)
The designs use CSS that the eight nodes, as first written, cannot express. The contract grows by fields, not
by node types:
* `group.blend?: "multiply"` (`.pic.gink`, `mix-blend-mode: multiply`): PDF `/BM /Multiply`, canvas
  `globalCompositeOperation`, SVG `mix-blend-mode`.
* `shadow.inset?: true` (the glass materials' `inset` box-shadows): drawn inside the rounded rectangle's clip
  with the same stepped recipe.
* A radial paint is `{ radial: { cx, cy, rx, ry, stops } }` in box units: elliptical, centre outside the box
  allowed (`radial-gradient(130% 85% at 16% -20%, …)`), drawn with a transform.
* `image.shadow?` (the keyed pictures' `filter: drop-shadow`): a shadow of the picture's alpha, rasterised once
  per picture and placed as an image.
* Title `text-shadow`: an offset copy of the text run in the shadow's colour, drawn first – no new type.
Shadows use 5 steps (v3's `printcss.ts` STEPS = 5, as in today's PDFs). Anything else a design needs is either
expressed with these or recorded in `tests/parity/accepted.json` with its reason.

## Amendment 2026-10-21 (ADR-020; docs/next/09 §3; shipped in S14.P, the shared preparation of M14 and M15)
`Stroke.join?: "miter" | "round" | "bevel"` (unset = miter, limit 10, as before) – an attribute, not a node type, for
Tabler's outline icons, smoothed chart lines with markers and elbow lines. Every backend draws it: SVG
`stroke-linejoin`, canvas `lineJoin`, PDF `j` (0 / 1 / 2), PowerPoint `a:miter lim="1000000"` / `a:round` / `a:bevel`
(written only when set, so earlier files are unchanged). `validate` names a bad value; the `path` fixture of
`core/tests/dl-fixtures.ts` draws all three, so `tools/dlcheck.mjs` compares them PDF against canvas. Line ends
(`core/src/render/heads.ts`) are `path` nodes; PowerPoint writes them natively (`a:headEnd` / `a:tailEnd`).
