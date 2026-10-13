# core/src/text · fonts and text shaping (PLAN S3.2, ADR-005)

| File | What |
|---|---|
| `fonts.ts` | `FontRegistry`: font files by SHA-1 (the helper's file hash), faces by family + bold + italic (CSS matching). WOFF unpacked, `.ttc` split; WOFF2 not readable yet (kept for the screen) |
| `shape.ts` | `Shaper` (hb.wasm): `shape()` → glyph ids, advances (px), clusters; `shapeNode()` for a display-list text node; `breakLines()` (greedy: after spaces and hyphens, inside a too-long word); `fitText()` (1 px steps down to 9 px) |
| `subset.ts` | hb-subset.wasm: `subsetFont()` for the PDF (glyph ids kept, layout tables dropped; TrueType → FontFile2, CFF → FontFile3), `instanceFont()` (every axis pinned), `pdfSubsetter()` for `writePdf`'s `subset` option. The PDF writer's own TrueType subsetter (`../pdf/ttf.ts`) is the fallback |
| `static.ts` | a static face of an uploaded variable font at its declared weight (the worker's `staticFont` call) |
| `pdf.ts` | `prepareTextForPdf()`: shapes every text node without a glyph run, stretched to its measured width |
| `resolve.ts` | the native export's font choice (S3.7): `FontResolver` takes each run's CSS family list and loads the first family it can embed – the deck's library faces, then this PC's files (`CatalogFont`: the helper's /sysfonts, or the browser's local fonts) – one file per family, weight and style (CSS matching on the index, `pickFace`); "Segoe UI Variable …" / "SF Pro …" / -apple-system skipped (v3's `printReady`); generic families as Windows' defaults; metric-compatible stand-ins (Carlito for Calibri …) only where a family is not installed; else a default face and the list reported as `missing` |
| `measure.ts` | `FontMeasurer` (S4.4, B7): the core worker's `TextMeasurer` – the display list's runs, line breaks and Excel's digit width measured with HarfBuzz on the file the browser draws the CSS font with (the first family of the list the library or this PC has, CSS font matching; no stand-ins), ascent / descent as Chromium reports them on Windows (win or typo metrics, rounded to whole px); a font without a readable file, or a text with a character its face lacks, measured by the page; `width()` at once for fonts `prepare()`d (Liquid Glass's column widths, which the page's drags lay out too); the per-font check and `outlineRun()` |
| `kern.ts` | the legacy 'kern' table's format-0 pairs, applied where HarfBuzz in the browser applies them (no 'kern' feature in GPOS: Segoe UI Italic); harfbuzzjs's lean build leaves the table out |
| `outline.ts` | glyph outlines (`hb_font_draw_glyph`) as SVG path data: the callbacks become tiny WebAssembly functions in hb.wasm's function table |
| `hb.ts` | instantiates the inlined WASM (no emscripten glue) |
| `wasm/` | harfbuzzjs@0.4.12's `hb.wasm` and `hb-subset.wasm`, zlib + base64 (`node tools/vendor-harfbuzz.mjs`; the test checks them against `node_modules`) |

Shaping uses HarfBuzz's default features (kern and liga on). On the golden slides' text lines it equals Chromium's
canvas within 0.002 px (`core/tests/shape.test.ts`, reference `tests/fixtures/text/chromium-widths.json`). Since
S4.4 the designs measure with it too (`measure.ts`), and a Windows font's face is the one Chromium draws: DirectWrite's
nearest weight, the heavier of two equally near (Segoe UI 500 is Semibold, 720 Bold), not CSS font matching, which
Chromium applies to the library's @font-face faces only (`pickFace`, `FontRegistry.match`; the PDF takes the same faces): on the reference PC Calibri, Century Gothic, Segoe UI (regular,
bold, semibold, italic with the legacy kern pairs), Cambria, Consolas, Verdana and Arial's bold equal Chromium's canvas
exactly at 9–40 px; Tahoma, Times New Roman and Arial regular / italic differ by up to 1.4 % on some pairs (the per-font
check draws such a font's runs as outlines on the stage, so its glyphs sit where the PDF's do). The PDF uses the same
glyph runs. `shape(…, features)` switches more OpenType features on (S3.4: a
text node with `tnum` – Liquid Glass numbers, CSS `font-variant-numeric: tabular-nums` – is shaped with "tnum";
the page measures those runs through the DOM, since canvas text has no such setting, and a canvas backend centres
each character in its tabular advance).

Only the core worker carries hb-subset today (the page's in-thread fallback host does not: `HostOptions`).

Rules taken from v3 and CSS: `fitText` is `fitNoteSize`'s rule (from the start size, 1 px steps while above 9 px);
a forced break inside a word falls between clusters only; spaces at a line start go. Shaped runs keep HarfBuzz's
mark offsets (`dx`/`dy`, y up): the PDF keeps such a run on one text line (TJ moves, `Ts` raises a mark) and gives each
cluster of several glyphs its text as ActualText (PDFium and Acrobat read "b́ q̣́ Việt"; plain pypdf ignores ActualText and
puts spaces around the marks, `tools/pdfcheck.py`'s whitespace-free text is right); the screen draws the run whole; a measured
width is spread over the gaps between clusters. `OS/2.fsType`: restricted (0x0002) and bitmap-only (0x0200) faces
are not embedded, no-subsetting (0x0100) ones are embedded whole. A variable upload is made static only when its
other axes need no browser value (wdth 100, slnt 0, ital 0; never opsz); otherwise, and for variable Windows fonts,
`prepareTextForPdf` instances the face as the screen draws it before export (wght at a library face's declared weight,
at the run's weight for a Windows font; opsz at the run's size). Text boxes break as `white-space: pre-wrap` (a
paragraph keeps its indent; spaces go after a soft wrap), wrapping cells and automated comments as `normal`.

Synthetic italic: an italic run in a face without an italic is drawn oblique by the PDF writer (`PdfFontFace.oblique`,
a 0.25 skew in the text matrix, as Chromium slants it; S3.6). Synthetic bold (S3.7): a run of weight 600 or more in a
static face lighter than 600 is stroked as Skia's fake bold (`PdfFontFace.bold`). Not yet (named for the steps that need them):
WOFF2 (most Google fonts) is not readable by the core (no Brotli decoder), so the native PDF draws such a library font
with the next family of its list, or a default face, and the toast names it (the old engine kept it for 3.7);
no fallback font for a missing glyph (it is `.notdef`); tabs and soft hyphens are not break opportunities, CJK breaks between
characters only; a variable CFF2 upload is stored as it is.
