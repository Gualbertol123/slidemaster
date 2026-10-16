# ADR-016: A pure-TypeScript PPTX writer from the display list plus a semantic layer; editable text, tables, charts; materials as pictures

* **Status:** proposed (Phase 0 design, 2026-10-16; needs 07 §8 Q4–Q5)
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

## Evidence and alternatives
PowerPoint 16 is on the development PC (COM check feasible); python-pptx 1.0.2 (MIT) available as a dev tool.
Alternatives: picture-only slides with a text layer (nothing editable: rejected by the decision); a JavaScript PPTX
library (PptxGenJS is MIT but brings its own model and DOM assumptions; it cannot place our DL exactly and would be a
second renderer: rejected); fully native glass with PowerPoint effects (lower fidelity, large work: rejected).
