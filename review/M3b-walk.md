# M3b walk: 05 §4 row 4.10 (EX-01 … EX-18)

Milestone M3b (S3.7–S3.9, PR #7), walked at the end of the milestone (Prompt 5), 2026-10-13. Oracles as in
`docs/next/05-test-and-parity.md` §4: E = e2e, GF = PDF facts, GP = pixels, SP = screen = PDF, S = helper test.
Mapped by the independent milestone review and spot-checked by the agent.

| Row | What | Covered by | v4 oracle | Note |
|---|---|---|---|---|
| EX-01 | Export PDF (remembered mode, default vector), spinner | `app/e2e/app.spec.ts` E3 (button, remembered `pdfMode`); `tools/export-check.mjs` (CI pdf job, 3 decks × 3 designs); `npm run bench` (deck20) | partly met | GF met. The "Rendering…" spinner is not asserted (the export takes ≈ 0.3–1.5 s); only the button's return to "Export PDF". |
| EX-02 | PDF · text & tables (vector) | E3 (`/FontFile2`, `/ToUnicode`, no Type 3, text, size); export-check (GT 42/42 on the corpus, 9 in CI); `npm run sp` | partly met | SP runs core's writer on the display lists (the same code the export worker runs) but not the worker path with the PC's fonts; the worker path is checked by GT + pdfcheck. |
| EX-03 | PDF · as pictures, "(images)", 2× PNG pages (B9) | E3 `pdf-exact` (4 pages, 3200 × 1800, no fonts, "(images)"); `core/tests/export.test.ts` (PNG pass-through); `export-check --pictures` (size, time) | met | Pictures are not pixel-compared (accepted, Decisions 2026-10-13 §3). |
| EX-04 | PDF · current slide | E3 `pdf-current` (1 page, the slide's name) | partly met | GF: page count only, no text check of that page. |
| EX-05 | Copy current slide (PNG to clipboard) | `app.spec.ts` "PNG of the current slide…": clipboard PNG 4800 × 2700, nothing in the export folder | met | |
| EX-06/07 | PNG current / every slide | the same test (sizes, names, 4 files) | partly met | No GP (accepted gap, Decisions 2026-10-13 §3). |
| EX-08–10 | Every version (this design; × Glass + Excel; × all three) | E13 (`versions`, `versions-2`, `versions-3`: B11 names, 6 files, Chief vs All text, Excel fonts / no images); `app/tests/export-pool.test.ts` | met | |
| EX-11 | File names; locked target gets " (2)" | `backend/tests/test_exports.py` (`export_file` names, control characters, open target " (2)", its lock); `test_http.test_export_file` | met | |
| EX-12 | Toast with Open / Show folder | E3 (toast text) | partly met | The buttons are not clicked in e2e (they open Explorer / a viewer on the PC). |
| EX-13 | ~~In-window fallback~~ (removed in v4, B1) | `test_assemble` kept | handled for 3.7 | Still reachable only through *PDF · text & tables (old engine)* for this release; removed with the old engine in S4.5. |
| EX-14 | PNG download in the browser | `app/e2e/file.spec.ts` "exports are downloads" (PNG 4800 × 2700) | met | |
| EX-15 | Pending edits flushed before export | E3 ("Gamma" → "Gammax" typed, then exported: in the PDF) | met | |
| EX-16 | Export works offline (download) | `file.spec.ts`: PDF with the PC's fonts; without permission → pictures + toast; the problem report downloaded | met | Several downloads at once (every version / every PNG) not in e2e; the toast tells the user the browser may ask. |
| EX-17 | Version export progress, "Saved N PDFs" | E13 ("Saved 4 PDFs", "Saved 6 PDFs") | partly met | The transient "Exported N of M…" is not asserted. |
| EX-18 | One 16:9 page per slide, exactly filled; vector; real fonts; small | E3 (pages, 16:9 MediaBox, fonts, size); export-check (qpdf, pdfcheck: no Type 3 / variable fonts); `test_export_geometry` kept for the old engine | met | |

Gaps named above (spinner, Open / Show folder, progress text, current-slide text, PNG pixels) are carried to M4,
where the screen draws the display list too and GP for PNG / pictures comes with it.
