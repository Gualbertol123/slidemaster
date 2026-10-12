# core/src/text · fonts and text shaping (PLAN S3.2, ADR-005)

| File | What |
|---|---|
| `fonts.ts` | `FontRegistry`: font files by SHA-1 (the helper's file hash), faces by family + bold + italic (CSS matching). WOFF unpacked, `.ttc` split; WOFF2 not readable yet (kept for the screen) |
| `shape.ts` | `Shaper` (hb.wasm): `shape()` → glyph ids, advances (px), clusters; `shapeNode()` for a display-list text node; `breakLines()` (greedy: after spaces and hyphens, inside a too-long word); `fitText()` (1 px steps down to 9 px) |
| `subset.ts` | hb-subset.wasm: `subsetFont()` for the PDF (glyph ids kept, layout tables dropped; TrueType → FontFile2, CFF → FontFile3), `instanceFont()` (every axis pinned), `pdfSubsetter()` for `writePdf`'s `subset` option. The PDF writer's own TrueType subsetter (`../pdf/ttf.ts`) is the fallback |
| `static.ts` | a static face of an uploaded variable font at its declared weight (the worker's `staticFont` call) |
| `pdf.ts` | `prepareTextForPdf()`: shapes every text node without a glyph run, stretched to its measured width |
| `hb.ts` | instantiates the inlined WASM (no emscripten glue) |
| `wasm/` | harfbuzzjs@0.4.12's `hb.wasm` and `hb-subset.wasm`, zlib + base64 (`node tools/vendor-harfbuzz.mjs`; the test checks them against `node_modules`) |

Shaping uses HarfBuzz's default features (kern and liga on). On the golden slides' text lines it equals Chromium's
canvas within 0.002 px (`core/tests/shape.test.ts`, reference `tests/fixtures/text/chromium-widths.json`). Until
S4.4 the designs still measure with the page's browser layout (decision 2026-10-12, 3); the PDF uses these glyph
runs so its glyphs sit where the screen's do. `shape(…, features)` switches more OpenType features on (S3.4: a
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
a 0.25 skew in the text matrix, as Chromium slants it; S3.6). Not yet (named for the steps that need them):
synthetic bold (Chrome emboldens a family that has no bold face; to emulate with a stroke in S3.7); WOFF2 (most Google fonts) is not readable by the core, so such library
fonts cannot reach the native PDF yet (S3.7); no fallback font for a missing face or glyph (the writer refuses a
missing face; a missing glyph is `.notdef`); tabs and soft hyphens are not break opportunities, CJK breaks between
characters only; a variable CFF2 upload is stored as it is.
