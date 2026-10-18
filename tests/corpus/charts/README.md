# Chart corpus (M9, S9.2 · gate G6)

Decks with charts (`SlideDef.items`, docs/next/07 §2.2) for the pixel review of the pie / donut recipe in every
design (`node tools/m9-package.mjs` → `review/S9.2/`). They are kept out of `decks/` because they have no v3
goldens (v3 had no charts); the unit tests (`core/tests/chart-dl.test.ts`) pin their display lists instead.

| Deck | Workbook | What |
|---|---|---|
| `charts.json` | `workbooks/report.xlsx` | slide 1: a 12-slice pie attached right of the table (names and shares, thin slices with leaders); slide 3: a donut and a pie (one slice recoloured, legend below) right of x 560 (Consulting Red's message panel is x 0–500), and a small pie from the sheet *Numbers*, which is on no slide; slide 4: callouts of every shape (a bubble with markup and a quoted cell, a pill, a circle, an arrow with its own fill, a dashed rect quoting a missing sheet – #REF, a rounded box) and the 17 icons |
