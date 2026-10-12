# M3a · walk of 05 §4 rows 4.3, 4.4, 4.7, 4.8, 4.9 (end of Prompt 4)

What the display list (S3.1–S3.6) does for each behaviour that 05 §4 verifies with GG, GT, GP or SP, and what is
left. Rows verified only by E (the editor's end-to-end tests) are about the editing UI, which M3 does not change:
users still see the HTML path (PROMPTS Prompt 4, "User-visible changes: none"); `npm run test:e2e` passed at every
step (17 tests).

Legend: ✓ verified now (tool) · ◐ verified on what the corpus has · ✗ not verified yet (why, and when).

## 4.3 Designs, looks, themes

| ID | v4 check | M3a |
|---|---|---|
| DS-01 | E + GG + GP | ✓ GG + GP for all three designs (`npm run dlparity`, whole slides, every version); E unchanged |
| DS-02 | GG + GP | ✓ raw Excel adds nothing (noteParts / memoPart return none; GG in dlparity; GP: the golden screenshots in dlparity, all 45 Excel slides within 1 % in the G1 package) |
| DS-03 | GG + GP | ✓ Excel Refined: text boxes, comments, notes in the list (dlparity, G1 45/45 within 1 %) |
| DS-04 | U + GG + GP (human sign-off) + SP | ✓ buildScene / inferRoles unchanged (glassPlan; renderGlass's HTML byte-identical); GG ✓; GP → **G1** (the sign-off); SP ✓ (`npm run sp`, every node type) |
| DS-05 | GP (each level) | ✓ subtle, medium, strong are in the corpus (GP summary per look) – pending G1 |
| DS-06 | GP + U | ◐ the corpus has the default colour amount (35 %) and report-looks's; other amounts only through the wallpaper's code (unchanged) |
| DS-07 | U + GG | ✓ computeLayout unchanged; tables placed and scaled from it (GG) |
| DS-09 | E + GG | ✓ GG per design |
| TH-03 | GP (every theme) | ◐ Aurora, Intesa Sanpaolo and Custom are in the corpus; **Ocean, Forest, Sunset, Graphite are not** – a corpus deck per theme belongs in the S3.7/S3.8 pilot (named for G1) |
| TH-04 | E + GP | ◐ one custom theme (report-looks) |
| TH-09 | GG + GP | ✓ colour overrides read through themeVars in every builder |
| TH-10 | GP | ◐ corners: default and report-looks's value |
| TH-11 | GP | ◐ contrast 50 and 70; the veil (gfade) and the wallpaper fade (wfade) follow the CSS formulas |
| TH-13 | GP + GF | ✓ wallpaper made in the core worker (2 JPEGs, content ids); the glass PDFs hold exactly 2 wallpaper images + the logo |

## 4.4 Text toolbar, text styles, fonts

| ID | v4 check | M3a |
|---|---|---|
| TX-09 | E + GG | ✓ alignment of cells, titles, text boxes (GG, origins) |
| TX-10 / TX-11 | E + GG | ✓ line and paragraph spacing of text boxes (lh, pgap; GG, origins; 1/64 px layout units) |
| TX-12 | GG | ✓ vertical position of text boxes (justify per side / valign) |
| TX-15 | U + GG | ✓ per-slide fmt (slideTextFmt in the builder) |
| TX-16–TX-18 | E + GG | ✓ deck text styles (deckFmt: titles, subtitles, text boxes, contents, page numbers) |
| TX-20 | U + GG | ✓ titleGeom: a larger title pushes the subtitle (GG) |
| TX-21 | GG | ✓ cover, contents, page numbers use the text styles |
| TX-22 | U + GG | ✓ effNote: the deck style, then the box's own |
| FT-05 | E + U | ✓ variable uploads instanced to static faces (S3.2); variable system fonts instanced for the PDF (Segoe UI Variable, opsz within its axis) |
| FT-12/13 | U | unchanged (S3.2 kept fonts.json schema 1) |
| FT-14 | GF | ✓ fonts subset as TrueType (FontFile2) or CFF (FontFile3), never Type 3: `npm run sp`, `tools/pdfcheck.py`, the G1 PDFs |
| FT-15 | U + W13 | changed by G0 R7 (fingerprint mode, decision 2026-10-12): Windows fonts are fingerprinted (`POST /api/fonts/capture`), not copied into the library; export reads them from the PC |

## 4.7 Text boxes and notes section

| ID | v4 check | M3a |
|---|---|---|
| NB-10 | GG + GP | ✓ bubbles: glass card / framed box (weekly-options; GP within 1 % in the Excel designs, pending G1 in glass) |
| NB-12 | E + GG | ✓ notes section at the footer position (memoPart) |
| NB-13 | U + GT | ✓ markup #, ##, **bold**, [[±n]] drawn and read (GT in dlparity and in the PDFs) |
| NB-14 | U + GG | ✓ fitted by the page (fitNotes, the screen's fitNoteSize); HarfBuzz measuring is S4.4 (B7) |
| NB-15–NB-17 | U + GG | ✓ computeLayout unchanged (GG) |

## 4.8 Automated comments

| ID | v4 check | M3a |
|---|---|---|
| AC-03–AC-16 | GT | ◐ comment texts come from commentText (unchanged) and are drawn and read as written: GT passes for the corpus's comments (weekly-comments, weekly-looks: Summary/Detailed, joins, names). Every option combination is not in the corpus; the comment unit tests cover the text, dlparity and the PDFs cover that the text is drawn |
| AC-17 / AC-18 | GG | ✓ placement beside all tables / sides, width/height, bubble (GG) |
| AC-24 | GT (per version) | ✓ rewritten at render per version: dlparity captures every version (weekly-options All / Chief) |

## 4.9 Versions, cover, contents, page numbers, footer, logo

| ID | v4 check | M3a |
|---|---|---|
| VR-02 | GG + GT | ✓ removed cells empty in every version (GG + GT per version) |
| CV-02–CV-09 | GG (every combination in corpus) + GT | ◐ page numbers in the corpus: bottom-right and top-right, capsule and plain, formats "3 / 12" and "Page 3"; top-left has a unit test (S3.5 review R1); **bottom-left, bottom-centre and top-centre page numbers are not verified** (footers in the corpus use bottom-left and bottom-centre); all go through pageNoGeom, shared with the HTML |
| CV-10–CV-13 | GG + GT | ✓ footer with {date} {workbook} {title}, corners, next to the page number (footerGeom, shared) |
| CV-15 | GG + GP | ✓ logo bubble (glass) and plain; GP pending G1 |
| CV-16 | E + GG | ✓ hidden per slide (slideHasLogo) |
| CV-18 | GG | ◐ contents with subtitles (corpus default); without them through the same code |
| CV-19 | GG + GT | ✓ cover title, subtitle, date (the page's clock), note; an empty subtitle keeps its min-height (unit test) |
| CV-20 | GG + GT | ✓ contents lists content slides with their page numbers |

## Gaps to carry

1. Themes Ocean, Forest, Sunset, Graphite and more colour / corner / contrast values are not in the corpus (GP). Add
   decks for them with the S3.8 pilot, or record that G1 covers them by the shared formulas.
2. Page numbers: only bottom-right and top-right are in the corpus, top-left in a unit test; bottom-left, bottom-centre
   and top-centre are not verified (a deck in the corpus, or unit tests, before M4 shows the list on screen).
3. GP for Liquid Glass is the G1 decision (B3 and the canvas's tabular figures).
4. PDF size: small glass decks are over Part F's budget (weekly-options 469 KB for 3 slides against 430 KB) because
   of the Segoe UI Variable instances (one per size × weight) – S3.7 (export in workers) owns GF.
