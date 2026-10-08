# 05 · Testing strategy and the functional parity checklist

The rebuild is accepted when **every item in §4 is verified by the method listed** and the CI gates in §5
are green. The principle: **capture v3's behaviour as data before changing anything**, and then make v4
reproduce that data. A difference is either fixed or listed as an accepted behaviour change (B1–B12 in
03 §6.2), each signed off by the product owner.

## 1. Verification methods (codes used in §4)

| Code | Method | Runs |
|---|---|---|
| **OV** | `shared/ops-vectors.json` (1 816 lines), run against the v4 core. Extended with Lamport-order cases and fold de-duplication | CI, every commit |
| **U** | v3 Vitest unit tests (114), moved with the modules they test, plus new unit tests | CI |
| **GT** | **Golden text**: v3 outputs captured as data and required byte-equal in v4. Covers `formatValue` of every cell of every corpus table, automated comment texts (every `CommentCfg` variant), titles and subtitles, page-number and footer strings, contents-slide entries | CI |
| **GG** | **Golden geometry**: per corpus slide × design × version, v3's laid-out boxes captured from the DOM. That includes table boxes, every cell box and text origin, text-box rectangles, title, logo, page number and footer. v4's display list must match within a tolerance (2 px; text origins 1 px), except the cases listed under B7 | CI |
| **GP** | **Golden pixels**: v3 screenshot (Chromium, 1600 × 900) vs v4 canvas render of the same slide. A perceptual diff (ΔE2000 < 2 on ≥ 99 % of pixels, after a 1 px anti-aliasing dilation) produces a heat-map report for human review | CI (report); a human signs off per design |
| **GF** | **PDF facts**: page count, MediaBox 1200 × 675, fonts are Type0/CIDFontType2 or CFF (never Type 3), image count only for real pictures and wallpapers, extracted text equal to v3's PDF text (order-insensitive per page), size within budget (03 §5.2), PDFium render time within budget | CI |
| **SP** | **Screen = PDF**: the PDF page rendered by PDFium vs the v4 SVG stage rendered by Chromium. Same pixel criterion as GP; `TJ` origins read back with pypdf must match the DL within 0.05 pt | CI |
| **E** | Playwright end-to-end with two real v4 helpers (users anna and bob) on one temp share, ported from `frontend/e2e/app.spec.ts` (15 scenarios), plus the new scenarios in §3.6 | CI |
| **S** | Storage tests: multi-process journals, fault injection, migration and rollback (§3.6) | CI |
| **L** | Load: `spikes/storage/journal_sim.py` grown into `tools/loadtest4.py`, which drives real v4 helpers; plus `--real-folder` on the bank's share | CI (simulated); field (real share) |
| **W** | Windows policy matrix (§3.7) on real corporate PCs | per release candidate |
| **M** | Manual check by a pilot user (for things only a human judges: Acrobat, "looks right") | per release candidate |

## 2. Capturing v3 before rewriting (M0 deliverables, PLAN S0.5)

1. **Corpus** (`tests/corpus/`):
   * the 4 fixtures (`frontend/tests/fixtures`);
   * `deck20.xlsx` and `big30.xlsx` (`spikes/baseline/make_workbooks.py`);
   * **anonymised copies of 5 real decks** from the share, workbook plus saved document, with numbers
     scrambled by `tools/anonymise.py`. Labels are kept where they drive comment analysis (Budget, Week,
     Δ…);
   * edge-case workbooks for formats, CF, merges, hidden rows, pictures (EMF/SVG/cropped/rotated), shapes,
     text boxes, superscripts, 1904 dates, locale tags, `.xlsm`, and a `.xlsb` converted once.

   Each saved document gets variants that exercise every option in §4: designs, versions, text boxes,
   comments in both modes, colour scales, painted CF, merges, gridlines, per-design sizes, themes, custom
   colours, text styles, fonts, page numbers, footer, logo.
2. **`tools/capture-v3.mjs`** (Playwright + the v3 build, served by a v3 helper). For each document ×
   design × version it goes to every slide at zoom 100 % and records:
   * the stage DOM geometry (`getBoundingClientRect` of every `.t`, `.wb`, `.tw`, `.note`, title, logo,
     page number, footer) with computed text, font family and size, colour → `golden/<deck>/<design>/
     <version>/<slide>.json` (**GG**);
   * a screenshot → `…/<slide>.png` (**GP**);
   * the PDF export → text and positions via pypdf → `…/pdf.json` (**GF**).

   Text strings (`formatValue`, comments, titles) are taken from the DOM, which the editor itself shows.
   Comment texts per configuration are generated through the comment dialog's live preview (**GT**). The
   capture runs once per v3 release kept as the reference, and the goldens are committed. They are data,
   not code.
3. **Op vectors** stay the canonical contract for document changes. A capture of real journals of user
   sessions (`tools/record-ops`, M3 pilot) adds realistic sequences.
4. **Saved formats:** `backend/tests/fixtures/saved/*` stay and are read by v4's migration tests. New
   examples are added and none are edited.

## 3. Harnesses

### 3.1 Unit (U, OV)

* The v3 Vitest suites move with their modules: `ops`, `docsync` (re-targeted to journals), `tables`,
  `text`, `design`, `comment`, `numfmt`, `printcss` (deleted with `printcss.ts`; replaced by display-list
  tests).
* New suites cover:
  * the SheetStore accessors against v3's `Sheet` behaviour, on every corpus sheet;
  * HarfBuzz measurement;
  * the PDF writer (objects valid, subsetting, ToUnicode round trip);
  * display-list builders.

### 3.2 Golden parity runner (GT, GG, GP)

`tools/parity.mjs` loads each corpus document into the v4 core in Node. The core is pure TypeScript;
HarfBuzz WASM runs in Node. It builds display lists and compares them with the goldens:
* texts must be equal;
* boxes must match within tolerance;
* pixels are compared via `@napi-rs/canvas` (dev only) rendering of the DL.

It writes an HTML report: side by side, with the heat map and the list of differences, each tagged
*regression* or *accepted (B7: "wraps differently because measured")*. Accepted differences are listed in
`tests/parity/accepted.json`, with a reason and the sign-off.

### 3.3 PDF checks (GF)

`tools/pdfcheck.py` extends `spikes/baseline/pdfinfo.py` and `spikes/pdfwriter/render_cost.py`. It reads
the PDF with pypdf for structure and text, and with PDFium for render time. It asserts the budgets in
03 §5.2 and also that:
* every font is subset (name prefix);
* every content stream decodes;
* `qpdf --check`, run in CI only, raises no warnings.

### 3.4 Screen = PDF (SP)

Playwright opens the v4 app on each corpus slide. It screenshots the stage's SVG and renders the same
slide's PDF page with PDFium at the same scale, then compares them. Additionally, every text node of the
DL is located in the PDF content stream and in the SVG (`<text>` x/y/textLength), and the three must agree
within 0.05 pt.

**Font-specific check:** for each font in the library and every Windows font a deck uses, a corpus string
(digits, Italian accents, Δ, €, %) is laid out at 9–40 px. The test then compares the core's HarfBuzz width
with Chrome's `<text>` natural width without `textLength`. A difference above 0.5 % switches that font to
outline rendering on screen (03 §2.6, step 3).

### 3.5 Load (L)

| Scenario | Users | fs ms | Pass criteria |
|---|---|---|---|
| same deck | 10, 20 | 0, 15, 40 | save p95 < 150 ms; visible p95 < 4 s; 0 lost; all views converge |
| different decks | 20 | 40 | save p95 < 150 ms |
| burst (edit every 0.3–0.9 s) | 20 | 15 | 0 lost, converge, journal < 2 MB before compaction |
| compaction during editing | 20 | 40 | no save waits on compaction; snapshot gen strictly increasing |
| real share (`--real-folder T:\…`) | 10 | real | the same criteria, run by the team on the bank's share before cut-over |

### 3.6 Storage, migration, rollback (S)

The v3 tests `test_store`, `test_locks`, `test_fsclock` and `test_upgrade` are kept for the shared files
(config, prefs, fonts, locks). New tests cover:
1. **Multi-process append.** 20 processes append 10 000 records; the fold is identical everywhere; no
   record is missing.
2. **Torn tails.** Kill a writer mid-append (`os._exit` between two `write`s): the reader ignores the torn
   frame; a new session uses a new file.
3. **Duplicate append after a network error** (the same `(w, s)` twice): folded once.
4. **CRC corruption in the middle**: the deck goes read-only, an incident file is written, and nothing is
   overwritten.
5. **Compaction races:** two compactors; a compactor dies after the rename; a writer rotates during
   compaction. The snapshot never goes backwards, and no acknowledged record is lost.
6. **Clock skew:** writers with clocks ±10 min. The order is unaffected, and presence ages are correct
   (file-server clock).
7. **Migration v3 → v4:**
   * every file in `backend/tests/fixtures/saved/` is migrated;
   * the v3 doc is frozen with `schema: 4`;
   * **a real v3 helper then refuses to write it (409) and a v3 page turns "outdated"**. This test runs the
     actual v3 helper from git tag `v3-final`;
   * a v3 save racing the migration is either in the snapshot or refused, never lost.
8. **Rollback:**
   * a deck with records past the frontier is refused;
   * after compaction, the v3 document is equal to the v4 document;
   * a real v3 helper opens it and continues;
   * re-migration recovers v4-only optional fields.
9. **Coexistence:** v3 and v4 helpers editing config.json at the same time (lock `config`): no lost
   update.

### 3.7 Windows policy matrix (W): cannot be verified in this Linux environment

This must run on real corporate PCs (a VM image of the bank's standard build is enough for most rows):

| # | Condition | Expected v4 behaviour | v3 today |
|---|---|---|---|
| W1 | AppLocker default rules (exe only from Program Files/Windows) | runs (no new exe) | export engine from `%LOCALAPPDATA%` blocked → falls back |
| W2 | WDAC enforced, unsigned binaries blocked | runs | same as W1 |
| W3 | "Programs may not run from T:\" | runs (python and msedge are local) | engine mirrored |
| W4 | Edge DevTools disabled (`DeveloperToolsAvailability = 2`) and headless disabled | runs, exports work | DevTools engine disabled |
| W5 | Edge `--app` mode blocked or Edge not default | falls back to the default browser | – |
| W6 | PowerShell Constrained Language Mode | everything works except `.xls` conversion (`.xlsb` native from M6); the desktop shortcut falls back to a `.bat` (as v3) | `.xlsb`/`.xls` conversion fails |
| W7 | TLS-intercepting proxy with a corporate root CA | `Update Slide Builder.bat` downloads with the Windows trust store; Google fonts are fetched by Edge (system trust) | same |
| W8 | Console cp1252 | all helper output ASCII-safe (as v3) | same |
| W9 | Display scaling 125/150/175 % | stage crisp; PDF page exactly 1200 × 675 pt (no device-scale dependency at all) | forced DSF 1 |
| W10 | Python 3.8 (oldest) and 3.13 | helper and self-test pass | same |
| W11 | Antivirus scanning every new file on the share | journals: one new file per session, not per save; v3's retries kept | per save temp file |
| W12 | SMB share via DFS namespace; via VPN at 40 ms | load criteria §3.5 met; `ReadDirectoryChangesW` hint auto-disables if no event arrives within 30 s of a known append | – |
| W13 | Fonts: a PC without Aptos, a PC with an older Calibri | identical layout (fonts from the library) | different layout |
| W14 | Acrobat Reader (current) and Edge's PDF viewer | open in < 1 s; scroll smoothly; text selectable; same look as screen (**M**) | Glass PDFs slow |

---

## 4. Functional parity checklist

The list was built from four sources:
* README §1 and §6;
* the 15 e2e scenarios (E1–E15 = the tests in `frontend/e2e/app.spec.ts`, in order);
* the Vitest suites;
* the UI code.

"v3 test" names the existing coverage. "v4 verification" uses the codes of §1.

### 4.1 Workbooks

| ID | Behaviour | v3 test | v4 verification |
|---|---|---|---|
| WB-01 | Open ▾ lists folder workbooks with date and "slides by <user>" | E1, E2 | E (list comes from snapshot mtimes, 03 §3) |
| WB-02 | "Loading…" / "No .xlsx files next to the app" | – | E (new) |
| WB-03 | Browse… accepts .xlsx/.xlsm/.xlsb/.xls | – | E (new) |
| WB-04 | Drop a file anywhere to open it | – | E (new) |
| WB-05 | Empty state with Open button | – | E (new) |
| WB-06 | Browsed file equal to a folder file opens as folder file | – | U |
| WB-07 | Non-folder file uploaded ("not in the folder") or preview-only | – | E (new) |
| WB-08 | File name shows "Opening …" / "N slides" | E1 | E |
| WB-09 | `.xlsb`/`.xls`/protected converted by Excel; toast "original unchanged". **v4: `.xlsb` native (B10)** | test_http (501 off Windows) | U (BIFF12 corpus) + W6 |
| WB-10 | Clear errors without helper, on conversion failure, for encrypted files | – | U + E |
| WB-11 | Small workbooks parsed fully, big ones per chosen sheet | E14 | U + E; **performance target 03 §6.3** |
| WB-12 | Busy overlay with progress | – | E (UI never blocked > 50 ms: long-task observer) |
| WB-13 | "Saved preset found": Cancel / wizard / continue, with counts | E2 | E |
| WB-14 | No preset → wizard; at start-up an "x" workbook opens directly | E1 | E |
| WB-15 | Reload from disk (menu, ↻) | – | E (new) |
| WB-16 | Last folder file reopens at start-up | E2 | E |
| WB-17 | Last viewed version restored per workbook | – | E (new) |
| WB-18 | Hidden sheets never listed; unreadable sheets disabled with the error | – | U + GG |
| WB-19 | Number formats: Italian separators, sections, scaling, %, exponent, fractions, currency locale tags, General 11 chars | numfmt (8) | U + **GT (every corpus cell)** |
| WB-20 | Dates: English default, Italian with `[$-410]`, minutes vs months, AM/PM, elapsed | numfmt (4) | U + GT |
| WB-21 | Rich-text superscripts/subscripts | numfmt, E13 | GT + GG + GP |
| WB-22 | "x" marker tables detected | E1 | U + GG |
| WB-23 | Range tables, growing ranges | E5 | U + GG |
| WB-24 | Fonts, fills, borders, merges, hidden rows/cols, CF (`cellIs`, simple expressions, relative refs), pictures (EMF/WMF via GDI+), shapes, text boxes | design, tables | U + GG + GP + GF |
| WB-25 | Workbook changed on disk → banner "Reload now" (6 s) | – | E (new) |
| WB-26 | Stable read while Excel is saving (503 + retry) | test_workbooks | S (helper test kept) |
| WB-27 | Errors become toasts | – | E |

### 4.2 Wizard

| ID | Behaviour | v3 test | v4 verification |
|---|---|---|---|
| WZ-01 | ✦ Wizard enabled once a workbook is loaded | E5 | E |
| WZ-02 | 4-step header, clickable back/forward | – | E (new) |
| WZ-03 | ✕/Esc asks "Close the wizard?" | E5, E14 | E |
| WZ-04 | Step 1 sheet list: size, "slide" chip, "N × table", title, used range | E14 | E |
| WZ-05 | Sheets named "slide" preselected | E1 | E |
| WZ-06 | Only "slide" / All / None; "N of M · X MB to read" | – | E (new) |
| WZ-07 | "not read yet" for big sheets | E14 | E |
| WZ-08 | Cancel; Next disabled without sheets | E1 | E |
| WZ-09 | Step 2 sheet tabs with counts | E1 | E |
| WZ-10 | Sheet preview grid (hidden narrow, "x" marked, clip note) | E14 | E + GP (preview) |
| WZ-11 | Drag/Shift-click select; arrows, Shift+arrows (skip hidden) | E5, E14 | E |
| WZ-12 | Enter adds the table; Esc clears | E5 | E |
| WZ-13 | Range box + Add table; invalid flashes | E5 | E |
| WZ-14 | "grows when rows are added below" | – | E (new) + U (growG) |
| WZ-15 | Use "x" tables (N) | – | E (new) |
| WZ-16 | Add detected tables (N), dashed suggestions | – | E (new) + U (detect) |
| WZ-17 | Table list: name, ✕, range, grows, size, > 3 000-cell warning, "on N slides" | E5 | E |
| WZ-18 | Click overlay scrolls to its row | – | E (new) |
| WZ-19 | Step 3 table pool: drag, click-to-add, "unused" | – | E (new) |
| WZ-20 | Cover (first) and Index (after cover) checkboxes | E1 | E |
| WZ-21 | One slide per sheet (asks); + New slide | – | E (new) |
| WZ-22 | Slide cards: title, subtitle, Logo, ↑ ↓, ✕ | E1 | E |
| WZ-23 | Cover fields: title, subtitle, date ("automatic"), note, logo | E1 | E |
| WZ-24 | Index "with subtitles", logo | – | E (new) |
| WZ-25 | Drag tables between slides; ✕ removes | – | E (new) |
| WZ-26 | Next · Versions; Save preset & show slides | E1, E13 | E |
| WZ-27 | "Add at least one slide" | – | E (new) |
| WZ-28 | Step 4 versions: radio, name, "N removed", ✕ | E13 | E |
| WZ-29 | New version (Enter; duplicates refused); chips + Chief, + All | E13 | E |
| WZ-30 | Select cells → Remove; list of cuts with ✕ | E13 | E |
| WZ-31 | Sheet tabs with cut counts; table ghosts; cuts drawn | E13 | E |
| WZ-32 | Others changed slides meanwhile → "Discard mine / Save mine anyway" | – | E (new, two users) |
| WZ-33 | Wizard result is one undo step | – | U |

### 4.3 Designs, looks, themes

| ID | Behaviour | v3 test | v4 verification |
|---|---|---|---|
| DS-01 | Switch Liquid Glass / Excel / Excel Refined, saved and shared | E2, E7, design | E + GG + GP |
| DS-02 | Excel adds nothing (no text boxes, comments, notes; no deck colours on tables); title, logo, page number, footer stay | design, E12 | GG + GP |
| DS-03 | Excel Refined = Excel tables + text boxes, comments, notes | design, E7 | GG + GP |
| DS-04 | Liquid Glass: roles, surfaces, frames, grids, rules, signals, media, implicit cards, separators, tinted glass, capsules, deep ink | design | U (scene unchanged) + GG + **GP (human sign-off)** + SP |
| DS-05 | Glass strength Subtle/Medium/Strong | – | GP (each level) |
| DS-06 | Background colour 0–100 % slider, one undo step | – | GP + U (coalesce) |
| DS-07 | Per-design sizing (layout, scale, align, valign, cols/rows) incl. older shared sizing and raw Excel's text-box correction (`fixedScale`) | text (4), E4, E7 | U (moved) + GG |
| DS-08 | Per-design looks: Apply to this design / all designs | design, E7 | U + E |
| DS-09 | Switching design re-resolves slides with that design's sizes | E7 | E + GG |
| TH-01 | Design… button with swatch → Colours tab | E7 | E |
| TH-02 | Scope This design only / All designs | E7 | E |
| TH-03 | Themes Aurora, Ocean, Forest, Sunset, Graphite, Intesa Sanpaolo, Custom | E7, tables | GP (every theme) |
| TH-04 | Custom theme: 4 background + 2 accent pickers (debounced) | E7 | E + GP |
| TH-05 | "Your colours" per key; unused keys greyed per design | E7 | E |
| TH-06/07/08 | Reset one / all; all-designs scope clears per-design values | E7 | U + E |
| TH-09 | Overrides apply in every design | design | GG + GP |
| TH-10 | Corners 0–200 % | E4 | GP |
| TH-11 | Contrast 0–100 (Glass) | E4 | GP |
| TH-12 | Use as default for new decks (config.json) | – | E (new) + S (config shared with v3) |
| TH-13 | Wallpaper (gradient, blobs, ribbons, grain), contrast baked | – | GP + GF (2 images per PDF) |

### 4.4 Text toolbar, text styles, fonts

| ID | Behaviour | v3 test | v4 verification |
|---|---|---|---|
| TX-01 | Target label: none / Cell / Cells / Title / Subtitle / Cover note / Date / Text box / Notes | E9 | E |
| TX-02 | Controls disabled without a target | E9 | E |
| TX-03 | Font picker (Font from Excel / Design font) | E9 | E |
| TX-04 | A− / A+ steps (1 pt < 12, 2 pt above, 5–150) | – | U + E (new) |
| TX-05 | Size box in pt, comma accepted | E9 | E |
| TX-06/07 | Bold / Italic toggles with state | E2 | E |
| TX-08 | Text colour: 12 swatches, Automatic, Custom… | – | E (new) |
| TX-09 | Align L/C/R + Auto | E7, E9 | E + GG |
| TX-10 | Line spacing (text boxes) | E11 | E + GG |
| TX-11 | Paragraph spacing | E11 | E + GG |
| TX-12 | Vertical top/middle/bottom (text boxes) | E7 | GG |
| TX-13 | Clear format | E9 | E |
| TX-14 | Title/subtitle/cover note/date: click selects, double-click edits (Enter/Esc/blur) | E9 | E |
| TX-15 | Per-slide text formatting (`fmt`) | E9, text | U + GG |
| TX-16–TX-18 | Text styles dialog: rows Titles, Subtitles, Tables (font), Text boxes, Contents, Page numbers & footer; font, size, B, I, colour, align, line spacing, Reset | E9 | E + GG |
| TX-19 | Style resolution over shared defaults; invalid values dropped | text | U |
| TX-20 | Larger title pushes subtitle and tables down | text | U + GG |
| TX-21 | Cover, contents, page numbers use the text styles | text | GG |
| TX-22 | Text boxes take the deck style; own settings win | text | U + GG |
| TX-23 | Done/Esc closes | E9 | E |
| FT-01 | Font menu: search, Default, library, Windows, Google | E9 | E |
| FT-02/03 | Google font added to the shared library on pick; "+ Add <typed>" | – | E (new; network mocked) |
| FT-04 | Google names previewed | – | E (new) |
| FT-05 | Upload .ttf/.otf/.woff/.woff2 | E9 | E + U (**variable fonts instanced**, CFF kept) |
| FT-06–FT-09 | Manage fonts: list, sample, source, styles, who; remove (confirm); add Google; suggestions | E9 | E |
| FT-10 | Library shared, refreshed ≈ 30 s and on menu open | E9 | E |
| FT-11 | Offline: Google remembered locally, upload disabled | – | E (file:// mode) |
| FT-12/13 | Family/weight/style from the file; latin subsets; safe names | text, test_fonts | U |
| FT-14 | Exports embed the faces used. **v4: subset TrueType/CFF, never Type 3** | – | GF |
| FT-15 | **New:** Windows fonts captured into the library so layout is identical on every PC | – | U + W13 |

### 4.5 Cell editing

| ID | Behaviour | v3 test | v4 verification |
|---|---|---|---|
| CE-01 | Click / drag / Shift+click selection | E4, E6 | E |
| CE-02 | Hover highlight (≤ 1 per 16 ms) | – | E |
| CE-03 | Typing starts the editor with that character | E2 | E |
| CE-04 | F2 / double-click edits with all text selected | – | E (new) |
| CE-05 | Inline editor Enter/Shift+Enter/Tab/Shift+Tab/Esc/blur | E2 | E |
| CE-06 | Formula bar: name box, fx (Enter/Esc) | E4 | E |
| CE-07 | ↺ Excel value | – | E (new) |
| CE-08 | Del/Backspace clears text (stored as an edit) | – | E (new) |
| CE-09 | Text edit paused when the Excel value changed (`orig`) | – | U + E (new) |
| CE-10 | Cell colour (12 + 4 swatches, No colour, Colour from Excel) replaces the fill | E6, tables | E + GG + GP |
| CE-11 | Highlight (capsule in Glass) | – | GG + GP |
| CE-12 | Cell colour becomes the Glass block colour | tables | GP |
| CE-13 | Role Auto/Header/Total/Body/Note | – | GG (new corpus variant) |
| CE-14 | Merge/Unmerge (workbook merges split, user merges) | E6, tables | U + GG |
| CE-15 | Format painter: single, sticky (double-click), Esc | E6 | E |
| CE-16 | Painter copies size, B, I, colour, cell colour, highlight, align, role, CF, colour scales | E7, tables | U + E |
| CE-17 | Painter without selection → toast | – | E (new) |
| CE-18 | Selection painting, Glass geometry aware | – | E + GG (hit rects) |
| CE-19 | Click on empty slide clears selection | – | E (new) |
| CE-20 | Status bar describes the selection | – | E |
| CE-21 | Typing is never overwritten by autosave or others' changes | E8 | E |

### 4.6 Tables

| ID | Behaviour | v3 test | v4 verification |
|---|---|---|---|
| TA-01 | W/H boxes (px, "…" when mixed) | E4 | E |
| TA-02 | Excel size reset | – | E (new) |
| TA-03 | Drag column/row border (guide, tip, applies to selection) | – | E (new) |
| TA-04 | Double-click border = Excel size | – | E (new) |
| TA-05 | Drag an edge to stretch (0.2–5×) | E7 | E |
| TA-06 | Corner drag scales | – | E (new) |
| TA-07 | Grip drag moves next to/above/below another table | – | E (new) |
| TA-08 | Same size (this slide) | E4 | E + GG |
| TA-09 | Position L/C/R and T/M/B | E4, E7, tables | U + GG |
| TA-10 | Gridlines H/V: As in Excel / All / None | E7, tables | U + GG + GP |
| TA-11 | Colour scales: row/col/all, ±zero or min→max, fill/ink, reverse, preview | E4, tables | U + GG + GP |
| TA-12 | Colour scale list with ✕ | – | E (new) |
| TA-13 | Reset layout (this slide, this design) | – | E (new) |
| TA-14–TA-18 | Sizes… dialog: same size across slides (largest/smallest/first), copy sizes, align chosen slides, reset to Excel | – | E (new) + U |
| TA-19 | Layout: bands, k ≤ 2, gaps, fixed scale, `reduced` | tables | U (moved) + GG |
| TA-20 | Hover handles: grip with name, corner, edges, + buttons | E7, E11 | E |

### 4.7 Text boxes and notes section

| ID | Behaviour | v3 test | v4 verification |
|---|---|---|---|
| NB-01 | Ribbon ↑ ↓ ← → add a box beside the selected table and edit it | E4, E7 | E |
| NB-02 | On-slide + buttons | E11 | E |
| NB-03 | Toasts "Click a cell first" / "already has a text box" | – | E (new) |
| NB-04 | Editor: Ctrl+Enter, Esc, blur | E4, E7, E11 | E |
| NB-05 | Empty never-written box removed | – | E (new) |
| NB-06 | Select, double-click/Enter/F2 edit, Del deletes, Esc | – | E (new) |
| NB-07 | Drag freely with 8 px snapping guides | E11, E12 | E |
| NB-08 | Stretch by edges with snapping | E10 | E |
| NB-09 | ⤺ Attach back to the table | E11 | E |
| NB-10 | ◯ Bubble | E7 | GG + GP |
| NB-11 | 🗑 deletes | – | E (new) |
| NB-12 | ✎ Notes: notes section at the footer position | E12 | E + GG |
| NB-13 | Markup `#`, `##`, `**bold**`, `[[+12,3]]` by sign | comment | U + GT |
| NB-14 | Font shrinks to fit (≥ 9 px). **v4: measured by HarfBuzz (B7)** | tables | U + GG |
| NB-15 | Left/right as tall as the table; top/bottom as wide | tables | U + GG |
| NB-16 | Span box beside all tables (via Comment… placement) | text | U + GG |
| NB-17 | Free box takes no room from tables | text | U + GG |
| NB-18 | Disabled in raw Excel with tooltip | E12 | E |

### 4.8 Automated comments

| ID | Behaviour | v3 test | v4 verification |
|---|---|---|---|
| AC-01 | ✎ Comment… for selected table/box (disabled in Excel) | E10, E12 | E |
| AC-02 | Table picker for several tables | – | E (new) |
| AC-03 | Summary (default for new) / Detailed; missing `mode` = Detailed (legacy) | E10, comment | U + **GT** |
| AC-04 | Tables in this comment (multi-table) | E10 | GT |
| AC-05 | "Found:" line (blocks, total, rows, latest period) | – | GT |
| AC-06 | Title override | – | GT |
| AC-07 | Joins: previous week / Budget / EoM / Quarter / Year / YoY / Other | E10 | GT |
| AC-08 | Detailed sections from headers; hint when none | comment | GT |
| AC-09 | Title / names / bullets switches | E10, comment | GT |
| AC-10 | Length: plan drivers / full / short | comment | GT |
| AC-11 | Name the top 1–5 | comment | GT |
| AC-12 | Ignore below (materiality) | comment | GT |
| AC-13 | Unit after amounts (default "mln") | comment | GT |
| AC-14 | Rows noun | – | GT |
| AC-15 | Concentration / broad-based / rows without data | comment | GT |
| AC-16 | Rows to include (exclusions) | comment | GT |
| AC-17 | Placement: beside all tables, right/left/below/above | E10 | GG |
| AC-18 | Width/height slider; In a bubble | – | GG |
| AC-19 | Live preview in the current design | E10 | E |
| AC-20 | Insert/Update (disabled without comparison groups) | E10 | E |
| AC-21 | Also on N similar tables | – | E (new) |
| AC-22 | Refuses to overwrite user text | – | U |
| AC-23 | Remove comment; Cancel; Esc | – | E (new) |
| AC-24 | Rewritten at render: follows numbers, edits, versions | E10, design | GT (per version) |
| AC-25 | Editing the text by hand makes it fixed (toast) | – | E (new) |

### 4.9 Versions, cover, contents, page numbers, footer, logo

| ID | Behaviour | v3 test | v4 verification |
|---|---|---|---|
| VR-01 | Version picker (Full deck + versions) | E13 | E |
| VR-02 | Removed cells empty (value, colour, highlight; borders kept); comments ignore them | design, E13 | GG + GT |
| VR-03 | Version remembered per workbook (prefs) | – | E (new) |
| VR-04 | Versions defined in wizard step 4 | E13 | E |
| CV-01 | ⚙ Options (disabled without deck), Design… link | E12 | E |
| CV-02–CV-09 | Page numbers: show, start, 6 positions, size 10–32, format (3, 3 / 12, Page 3, p. 3), capsule/plain, on cover, Text styles link | E12 | GG (every combination in corpus) + GT |
| CV-10–CV-13 | Footer: show, text with `{date}` `{workbook}` `{title}`, 6 positions, size, plain/capsule, on cover, shares corners with page number/logo | E6, E8, tables | GG + GT |
| CV-14 | Logo file + Choose… upload (copied for everyone) | – | E (new) |
| CV-15 | Bubble around the logo | E8 | GG + GP |
| CV-16 | Hide/show logo per slide | – | E (new) + GG |
| CV-17 | Missing logo warning | – | E (new) |
| CV-18 | Contents subtitles toggle | E7 | GG |
| CV-19 | Cover: title, subtitle, date (automatic = today, en-GB), note | E1 | GG + GT |
| CV-20 | Cover/index tags in thumbnails; index lists content slides with page numbers | E7 | GG + GT |

### 4.10 Export

| ID | Behaviour | v3 test | v4 verification |
|---|---|---|---|
| EX-01 | Export PDF (remembered mode, default vector), spinner | E3 | E + GF |
| EX-02 | PDF · text & tables (vector) | E3 | GF + SP |
| EX-03 | PDF · as pictures, "(images)". **v4: 2× PNG pages (B9)** | test_exports | GF |
| EX-04 | PDF · current slide | test_exports | E + GF |
| EX-05 | Copy current slide (PNG to clipboard) | – | E (new; clipboard permission granted in Playwright) |
| EX-06/07 | PNG current / every slide | test_exports | E + GP |
| EX-08–EX-10 | Every version (this design; × Glass + Excel; × all three) | E13 | E + GF (6 files, names per B11) |
| EX-11 | File names; locked target gets " (2)" | test_exports | S (helper test kept) |
| EX-12 | Toast with Open / Show folder | E3 | E |
| EX-13 | ~~In-window fallback~~ (v4 has no engine; B1) | test_assemble | – (removed) |
| EX-14 | PNG download in the browser | – | E (file:// mode export works) |
| EX-15 | Pending edits flushed before export | – | E (new) |
| EX-16 | Offline/local-file refusal. **v4: export works offline (download)** | – | E |
| EX-17 | Version export progress, "Saved N PDFs" | E13 | E |
| EX-18 | One 16:9 page per slide, exactly filled; vector; real fonts; small | E3, test_export_geometry | GF + SP (by construction; tests kept as assertions) |

### 4.11 Collaboration, undo, keyboard, side panel, status

| ID | Behaviour | v3 test | v4 verification |
|---|---|---|---|
| CO-01 | Field-level merge of concurrent edits | E2, docsync, ops | OV + U + S + E |
| CO-02 | Others' changes appear (v3 3 s poll; **v4 ≤ 2 s typical**, B5) | E2 | E + L |
| CO-03 | "Updated by <name> just now / N min ago" | E2, docsync | E + U |
| CO-04 | Presence avatars (≤ 3, initials), "X is also here", "(another window)" | E2 | E |
| CO-05 | Presence heartbeat 10 s; leave on pagehide | test_http | S + E |
| CO-06 | The stage never redraws under an open editor; settings fields keep drafts | E8 | E |
| CO-07 | Config defaults re-read ≈ 30 s | – | E (new) |
| CO-08 | Others' preset changes rebuild slides and keep the current slide | – | E (new) |
| UN-01 | Undo/Redo buttons | – | E (new) |
| UN-02 | Undo only my own changes; others' later edits survive | E2, docsync, ops | OV + U + E |
| UN-03 | Toast "Undo: <label>" | – | E |
| UN-04 | Slider drags coalesce (same key within 1.5 s) | – | U |
| UN-05 | Undo stack 200, redo cleared on change, per workbook | – | U |
| KB-01–KB-25 | Every shortcut: Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y, Ctrl+S, PgUp/PgDn, Alt+↑/↓, Esc (painter), Ctrl+B/I, Enter/F2/Esc/Del on slide text and text boxes, Ctrl+A, arrows/Shift+arrows, Tab/Shift+Tab, Enter/Shift+Enter, F2, Del, printable key, inline editors, fx bar, W/H boxes, dialogs (Esc/Enter), wizard keys | partly E2, E4, E5, E10, E14 | **E: one table-driven test per shortcut (new)** |
| SP-01–SP-15 | Thumbnails with badges; SLIDES N; cover/index info; missing tables; no tables; table facts (sheet, range, size, hidden, grows); error values; small text < 9.5 px; charts not reproduced; unreadable pictures; unsupported CF; edited cells and paused edits; custom layout; logo not found; preset summary | – | **GT (issues list per corpus deck, new)** + E |
| SB-01–SB-13 | Status bar selection text and shortcut hint; save states (Unsaved / Saving / ✓ Saved / browser only / retrying / outdated); retries 2–32 s; 409 → outdated; changed-on-disk banner; offline banner; ~~export pill and engine dialog~~ (B1); health 6 s; zoom −/+/Fit (20–300 %, remembered); toasts with actions | docsync, all E | U + E |
| OF-01–OF-06 | Offline `file://` mode: localStorage docs/prefs/fonts, banner, no folder list or uploads; **exports now work** | – | E (file:// project, new) |

### 4.12 Install, start, update, data

| ID | Behaviour | v3 test | v4 verification |
|---|---|---|---|
| IN-01 | Install: finds `py -3`/`python`, explains if missing | – | W |
| IN-02 | Banner: version, user, host, folder, "safe to run again" | – | S (helper test) |
| IN-03 | Python ≥ 3.8, bitness | test_firstrun | S |
| IN-04/05/06 | pip / Playwright / export engine | test_firstrun, test_installer | **removed** (B1): nothing to install |
| IN-07 | Shared-folder check (lock, export write, round-trip median, > 30 ms warns) **+ journal append and flush** | test_firstrun | S + W |
| IN-08 | Desktop shortcut `.lnk` or `.bat` (CLM), UNC via pushd | test_firstrun | S + W6 |
| IN-09 | Self-test (start, ping, stop) **+ read every deck read-only** | test_firstrun | S |
| IN-10 | OK/WARN/FAIL lines, exit code, ASCII, idempotent | test_firstrun | S |
| IN-11 | Start: helper; on failure says to run Install | – | W |
| IN-12 | Port 8765 (+20); if already running, open the browser (v4 recognises v3 vs v4) | test_main | S |
| IN-13 | v2 settings import | test_migrate | S (ported) |
| UP-01–UP-10 | Update: one click; protected paths; backups of saved setups (last 5); every deck test-loaded; one update at a time; options; final message. **v4: release ZIP + SHA-256 + side-by-side `app\<ver>`, `--use <ver>` rollback** | test_update | S (rewritten) + W7 |
| DA-01 | Every saved v3 format readable, upgraded once with backup | test_upgrade | S (§3.6.7) |
| DA-02 | Newer files refused ("restart") | test_upgrade | S |
| DA-03 | v3 ↔ v4 coexistence and per-deck cut-over; rollback | – | S (§3.6.7–9) |

## 5. CI gates (every pull request)

1. Type check, lint, U, OV (< 1 min).
2. GT and GG on the corpus (< 3 min). Zero unexplained differences.
3. GF and SP on the corpus (< 3 min). Budgets met; no Type 3, no variable font.
4. E: the 15 ported scenarios plus the new ones, two helpers (< 8 min).
5. S and simulated L at 15 and 40 ms (< 5 min).
6. GP report is published as a build artefact. It must be signed off by a human whenever a renderer file
   changes; enforced by CODEOWNERS on `core/render/**`.

**Release candidate:** W matrix and M checks on corporate PCs; L on the real share (`--real-folder`).
