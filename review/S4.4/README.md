# S4.4 review · text measured from the font files (B2, B7)

Open `index.html` (in the zip `review-S4.4.zip`, with `img/` and `differences.json` – generated, not committed): every Liquid Glass slide of the corpus **before** S4.4 (left), **after** (middle) and where their
pixels differ (right), with the parity differences of the slide against v3's goldens below it. The pictures
(`img/`), the page and `differences.json` (every difference of every slide) are not committed: `node tools/s44-package.mjs --before <backend of the build before> --diffs <file>`
makes them (the build before is `git worktree add <dir> 7185d74`, the diffs file `npm run parity -- --diffs <file>`).

## What changed

* **B7 – text is measured from the font files** (HarfBuzz in the core worker, `core/src/text/measure.ts`) instead of
  by the browser. On this PC the widths are the browser's own for Calibri, Century Gothic, Segoe UI (every weight),
  Cambria, Consolas and Verdana, so **Excel and Excel Refined slides are unchanged** (parity: no geometry
  difference). Where a font has no file the core can read (from disk without the browser's fonts, a WOFF2
  upload) the browser measures as before.
* **B7 – Liquid Glass columns are measured.** v3 widened a glass column for its text by an estimate (0.56 em a
  character); now the text is measured in its font. Most glass tables are **narrower: 1.5–15 %, median 4.4 %**,
  and stay centred; the text boxes beside them follow, and some of their lines break at other words.
* **B7 – text boxes are fitted on their own layout** (the largest size from the start down, 1 px steps, whose text
  fits), no longer by the browser's.
* **B2 – Liquid Glass text is static Segoe UI on screen**, no longer "Segoe UI Variable". Each weight draws with the
  nearest static face, as Chromium matches a Windows font: 470 Regular; 500–640 (text, values, labels) Semibold;
  650–740 (bold cells, headings, sections, emphasis) Bold. The PDF takes the same faces now (3.7's took CSS's rule:
  headings in Black, labels in Bold).

## Questions for the product owner

**Decided 2026-10-14 (PROGRESS Decisions): both approved – the differences are signed off, SP is option (a).**

1. **Sign off the B7 / B2 differences** listed in `index.html` (86 entries in `tests/parity/accepted.json`, signed
   "pending: S4.4 sign-off"), or name the slides that are not acceptable.
2. **Screen = PDF in pixels (SP).** PLAN's "SP passes" cannot be met as 05 §3.4 states it (ΔE < 2 on 99 % of the
   pixels): 85 of 135 slides differ on 1–4 % of their pixels, all of it at the edges of glyphs – the screen and the
   PDF place every glyph in the same spot (one display list), but Chromium (DirectWrite, hinted) and PDFium
   rasterise text differently. Measured on this PC:

   | slides (mean pixels beyond ΔE 2) | screen text as `<text>` (now) | every font as glyph outlines |
   |---|---|---|
   | deck20, Excel / Excel Refined | 2.79 % | 2.90 % |
   | deck20, Liquid Glass | 2.08 % | 2.74 % |
   | report-looks (3 designs) | 0.52–0.98 % | 1.10–1.89 % |

   Outlines (03 §2.6 step 3) do not help: PDFium's glyph placement and anti-aliasing differ from Chromium's paths
   too (a synthetic page of glyphs on whole pixels: 5 % → 1.1 %, but real tables sit at fractional positions).
   The per-font outline fallback is in place (a font whose browser widths differ from HarfBuzz's by more than
   0.5 % – on this PC Tahoma, Times New Roman, Arial on some pairs – is drawn as outlines on the stage).
   Choose:
   * **(a, recommended)** SP compares text as data and pixels everywhere else: (1) every text run's position in the
     PDF, read back from the file, within 0.05 pt of the display list's (05 §3.4); (2) every run the screen draws as
     text has a natural width in the browser (without `textLength`) within 0.5 % of the display list's width – the
     check that catches a run measured with the wrong font, which `textLength` would otherwise hide by stretching
     it; (3) pixels at ΔE 2 everywhere but the glyphs (fills, borders, pictures, hairlines);
   * **(b)** keep SP's whole-slide pixel rule and accept the text differences per design (as now, "owned by S4.4");
   * **(c)** draw every font as outlines on screen (`localStorage sbOutlines = "all"` shows it): softer, unhinted
     text on screen and more markup, and SP still does not pass.
