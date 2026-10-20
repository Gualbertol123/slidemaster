# spikes/charts · the Phase 0 pictures of docs/next/09

Prototypes only (nothing here ships; M14–M16 build the real renderers in `core/src/render`):

* `proto.ts` – display-list nodes for series charts (column, bar, stacked, 100 %, line, smoothed, area, scatter,
  waterfall, combined on two axes, category groups with a divider, actual-inside-target bars, marks in data
  coordinates), lines and annotations (straight, elbow, curve, bracket, range, heads), Tabler icons (SVG path → the
  display list's `M L C Z`, arcs as cubics: the vendor step of ADR-020), the stage overlay of snapping guides and handles
  (drawn as nodes for the picture only), Excel conditional formats in cells. Palettes, cards and number formats are the
  core's own (`chartLook`, `glassBox`, `formatValue`).
* `scenes.ts` – what each review slide adds (`window.P09.render`).
* `decks/*.json` – the review decks (`{workbook, ops}`, as `tests/corpus/decks`).
* `make_books.py` – `books/loans-weekly.xlsx` (the reference chart's numbers), `books/report-hidden.xlsx` and
  `books/report-drop.xlsx` (report.xlsx with rows / columns hidden in the sheet XML: F11 and F14 close rows up through
  the path that closes Excel's hidden rows, so these show what the features will draw).

Run (needs `npm ci`, Playwright's Chromium, Python with openpyxl):

    python spikes/charts/make_books.py
    node tools/p09-package.mjs --tabler <folder of the @tabler/icons 3.49.0 package>   # e.g. from `npm pack @tabler/icons@3.49.0`

→ `review/P09/index.html` (pictures in every design) and `review/P09/picker.html` (the icon picker mock).
