# ADR-016: A pure-TypeScript PPTX writer from the display list plus a semantic layer; editable text, tables, charts; materials native (amended 2026-10-19; first: as pictures)

* **Status:** accepted (07 §8 Q4–Q5 answered 2026-10-16); amended 2026-10-19 – materials native, masters generated (below)
* **Deciders:** product owner (editable text + tables, native charts, glass as pictures, 2026-10-16), maintainers
* **Related:** 07 §4; ADR-003 (native PDF writer), ADR-004

## Context
Every export (current slide, deck, versions × designs, scenario runs) needs a `.pptx` next to the `.pdf` that opens in
PowerPoint 2016+ without repair, with text and tables editable. A display list has geometry but no table structure.

## Decision
* `core/src/pptx/writer.ts`: OOXML parts zipped with fflate (already a dependency); no new library. 16:9 at
  12,192,000 × 6,858,000 EMU, 1 slide px = 7,620 EMU, so positions are the display list's by construction.
* The core answers `slideLists` for `kind: "pptx"` with a **semantic layer** per slide (tables with rows/cols/cells,
  texts as paragraphs/runs, charts with data, pictures) whose boxes are those of the DL nodes they replace, plus the
  **remaining nodes** (glass materials, shadows, wallpaper, capsules, rules) which the export worker rasterises with the
  existing canvas backend at 2× into a background PNG per slide (and one per glass table card).
* Fidelity (07 §4.2): text → text boxes; tables → `a:tbl`; pie/donut → `c:chart` with an embedded data workbook;
  callouts → preset/custom geometry shapes; pictures → `p:pic`; everything else → PNG. Fonts named, not embedded (Q4).
* Only ECMA-376 features PowerPoint 2016 reads; checked by `tools/pptxcheck.py` (structure, python-pptx text/table/
  chart facts, PowerPoint COM open without repair on Windows) – dev tools only.

## Consequences
+ The same display list drives PDF, PNG, screen and PPTX; parity and GT texts apply to PPTX too.
+ Editable where it matters; PowerPoint's own text layout may wrap differently (accepted, B21).
− Liquid Glass capsules become rectangular cell fills in tables; shadows are PowerPoint's blur.
− The background PNG costs ≈ 120 KB per Glass slide (budget 3 MB per 20-slide deck).

## Amendment 2026-10-19 (product owner; S11.1)
"Auto generate slidemasters … standardised and lean. no bulk images and connections on slides, use tables" (PROGRESS
Decisions). The **remaining nodes are no longer rasterised**: every node is drawn natively – the alternative rejected
below ("fully native glass") is taken after all, because the display list makes it exact where it matters: a frosted
surface is the deck's one blurred wallpaper picture cropped to the surface's outline (the same picture the PDF draws),
under DrawingML gradients for its tint, rim and sheens; shadows are PowerPoint's. The writer makes a **master and one
layout per kind of slide from the deck** (placeholders where its slides have them, the shared background and
decoration once), no connector shapes and no external relationships. The semantic layer is mostly derived from the
display list (`pptx/scene.ts`); the core adds charts, callout kinds, the kind of slide and the palette
(`SlideList.sem`). Consequences, amended: + no rendered picture per slide or per card (each frosted surface is a picture element showing the one stored blurred wallpaper) (deck20 Liquid Glass ≈ 0.55 MB instead of
≈ 2.8 MB, written in well under a second); + glass cards, capsules and shadows are editable shapes; − PowerPoint's
gradients and blur approximate the screen's (radial sheens, 5-layer shadows), checked side by side on the corpus in
S11.1–S11.3 and for the product owner at G8. Sizes are px × 0.6 pt (7,620 EMU per px), not 0.75.

## Evidence and alternatives
PowerPoint 16 is on the development PC (COM check feasible); python-pptx 1.0.2 (MIT) available as a dev tool.
Alternatives: picture-only slides with a text layer (nothing editable: rejected by the decision); a JavaScript PPTX
library (PptxGenJS is MIT but brings its own model and DOM assumptions; it cannot place our DL exactly and would be a
second renderer: rejected); fully native glass with PowerPoint effects (lower fidelity, large work: rejected).
