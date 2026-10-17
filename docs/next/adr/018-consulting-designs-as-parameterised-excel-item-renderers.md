# ADR-018: Consulting designs as parameterised Excel-item renderers

* **Status:** accepted (2026-10-16, product owner; 08 §6 answered as recommended, neutral names "Consulting Navy" /
  "Consulting Red")
* **Deciders:** product owner, maintainers
* **Related:** `docs/next/08-consulting-designs.md`; ADR-004 (display list), ADR-005 (text from font files),
  ADR-011 (goldens); 03 §4.2 (one set of geometry rules); 07 §3 (charts and callouts drawn per design)

## Context
Users want two more designs, in the style of McKinsey and Bain slides ("McKinsey", "Bain"), beside Liquid Glass,
Excel and Excel Refined. They differ from the existing three in their look: palette, typefaces, rules, table
recipe, furniture, cover and contents. They do not differ in what a slide contains or where tables go. They must be
saved and shared like the others, export through the display list, and later carry charts and callouts (M9) and
PowerPoint (M11).

## Decision
* `Design` grows to `"glass" | "excel" | "clean" | "mckinsey" | "bain"`. Design stays a style field: no new op, no
  new document field (`sizes[d]` and `designs[d]` are already keyed by design).
* **One renderer, two specs.** `core/src/render/consult-dl.ts` builds a table's display list from the Excel item
  list (`effItems`), as `excel-dl.ts` does, never from the Liquid Glass scene. It is parameterised by a
  `DesignSpec` (`consult-spec.ts`): fonts by role, colours, rule recipe, header and total recipe, cards, bullets,
  title band, cover, contents and chart / callout hooks. `MCKINSEY` and `BAIN` are two data objects. A third
  consulting look would be a third object, not new code.
* The furniture (title band, rules, footnotes, page number, footer, cover, contents) is a `consult` branch of
  `slide-dl.ts`, driven by the same spec.
* Geometry stays one set of rules: `computeLayout` is unchanged. The only per-design number is the content area's
  top (a two-line title band), a constant per design, as `titleGeom`'s base already is.
* The workbook's fills, borders and font families are replaced by the recipe. Text, number formats, emphasis,
  alignment, merges, pictures and the user's own cell colours are kept.
* Per-design defaults (`DESIGN_LOOK`) sit under the user's layers in `resolveStyle`, so Reset returns to the spec.
  The shared deck theme is not applied to these designs; a per-design theme and every colour override are.
* Fonts: Georgia and Arial (Windows core fonts, embeddable subsets). No proprietary firm font, no logo, no firm
  name on a slide.
* Old pages (4.0 / 4.1) resolve an unknown design to Liquid Glass and keep the unknown keys: no data loss (test).

## Consequences
+ No new node type, no second geometry, no new runtime dependency.
+ Screen, PNG, PDF and thumbnails need nothing new: they draw the display list.
+ Charts, callouts and PPTX (M9, M11) read the palette, labels, legend and callout defaults from the same spec.
+ `excel-dl.ts`'s shared helpers move to a common module. dlparity on Excel and Excel Refined proves the move
  changes nothing.
− Two more designs in every matrix: parity, export-check, bench, the e2e switch, "every version × designs".
− The new designs have no v3 goldens. Their goldens are their own signed-off first render (S7b.3): evidence of
  what was approved, not of v3 parity.
− A deck switched to McKinsey on 4.2 and opened on 4.1 shows Liquid Glass until the user upgrades.

## Evidence and alternatives
08 §1 (34 public references, 6 Bain and 6 McKinsey PDFs measured), §2 (specs with sources), §3 (sites in the code).
Alternatives:
* **themes of Liquid Glass:** rejected; the prompt and the references need flat rules, serif titles and no
  materials, which the glass scene cannot express without becoming a second renderer inside it;
* **themes of Excel Refined:** rejected; Refined draws the workbook's own fills and borders, which consulting
  tables replace;
* **two separate renderers:** rejected; their table recipes differ only in parameters.

## Amendment 2026-10-16 (product owner, at the S7b.3 pixel review)
The first render – the Excel item list with rules and colours – was rejected ("too barebone … no difference between me
making a small change in Excel and this"), and so was a flat-material version of the Liquid Glass scene ("a fake version
of the liquid glass … they have to be DIFFERENT; square corners are fine"). Decision: the consulting designs draw tables
as **data exhibits**. `core/src/render/exhibit.ts` reads a table's meaning (label column, body and total rows, a series of
period columns, reference columns, variance groups) and the designs draw it as an exhibit: Consulting Navy "Insight
board" (a KPI line from the total row, trend lines, diverging variance bars) and Consulting Red "Signal" (a red message
panel with the lead variance and its facts, grey evidence bars, red only for shortfalls). Every number is a cell of the
table; a table that does not read as an exhibit is drawn as a plain typographic table. Exhibits have their own geometry
(`exhibitGeom`), used by `computeLayout` through `tableW` / `tableH` and by the stage's hit-testing. Still no new node
type and one `computeLayout`.
