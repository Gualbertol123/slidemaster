# Audit appendix · 05 §4 feature rows and their guards

Part of [`../AUDIT.md`](../AUDIT.md) §2. Every row of `docs/next/05-test-and-parity.md` §4 with the automated test that
guards it today (path:line and title), found by reading the tests (two independent readers, rows spot-checked).

**Verdicts.** The guarding suites ran four times – two clean clones of 4df923b (runs 1 and 2) and two clean clones of
`v4/audit-fixes` (runs 3 and 4) – and every test named below passed in all four (AUDIT.md §1: check 460 + 41, helper
228 on Python 3.8 and 3.12, e2e 24, parity / dlparity 0 not accepted, sp 8/8, export-check 42/42). So:
* **PASS** – the named test asserts the behaviour and passed;
* **PASS (partial)** – the named test passed, but part of the row is not asserted (the note says which);
* **MISSING** – no automated test asserts it (05 asks for one);
* **MANUAL** – 05 gives only a field / human check (W or M); not passed by this audit.

GG / GP (geometry, pixels) and SP on the corpus need the goldens' environment (Windows 10.0.22631, 357 fonts); this PC
(10.0.26100, 350 fonts) runs parity and dlparity **text-only**, and in that mode the signed Liquid Glass style entries
of `tests/parity/accepted.json` are accepted without their digests – rows marked "GG/GP not effective here" are
guarded on this PC by texts and styles only (AUDIT.md finding VER-1).

## 4.1–4.6


| ID | Behaviour (short) | Guard (path:line – test title) | Suite | Status | Note |
|---|---|---|---|---|---|
| WB-01 | Open ▾ lists folder workbooks with date and "slides by <user>" | helper/tests/test_workbooks.py:18 `test_list` (list rows, `updated`/`updatedBy` from the v3 doc and the v4 snapshot); helper/tests/test_http.py:187 `test_files_listing_and_stable_read`; E1 app.spec.ts:131 clicks `[data-f="report.xlsx"]` in the menu | helper+e2e | PASS (partial) | The listing data is asserted. The menu text (date, "slides by …") is never asserted in the UI. |
| WB-02 | "Loading…" / "No .xlsx files next to the app" | – | – | MISSING | No test shows either state. |
| WB-03 | Browse… accepts .xlsx/.xlsm/.xlsb/.xls | F1 file.spec.ts:25 (.xlsx through `#fileInput`); F2 file.spec.ts:66 "opened from file://: an .xlsb opens natively, without Excel" | e2e | PASS (partial) | `setInputFiles` bypasses the `accept` filter. .xlsm and .xls are never browsed. |
| WB-04 | Drop a file anywhere to open it | O1 open.spec.ts:33 "a dropped workbook opens; of two drops at once the newer opens; reload from disk; changed on disk" (`#fileName` contains report.xlsx, thumbs, no error toast) | e2e | PASS | |
| WB-05 | Empty state with Open button | (open.spec.ts:23 checks `#fileName` "No workbook" only when no last file exists, which never happens after app.spec) | – | MISSING | The branch does not run in the suite order. |
| WB-06 | Browsed file equal to a folder file opens as the folder file | – | – | MISSING | 05 says U, but there is no unit test. |
| WB-07 | Non-folder file uploaded ("not in the folder") or preview-only | – | – | MISSING | |
| WB-08 | File name "Opening …" / "N slides" | app.spec.ts:87 `openApp` helper (`#fileName` = `<name> · N slides`, used by E2…E18); open.spec.ts:22 | e2e | PASS (partial) | "Opening …" is not asserted. |
| WB-09 | .xlsb/.xls/protected converted by Excel; v4: .xlsb native (B10) | core/tests/xlsb.test.ts:62 "xlsb twins: read the same as Excel's own .xlsx" (per twin) and :110 "every corpus deck draws the same"; :58 "has a twin for every corpus workbook…"; F2 file.spec.ts:66 (.xlsb opens natively, no "converted by Excel"); helper/tests/test_http.py:318 `test_convert_is_501_off_windows` | check+e2e+helper | PASS | The .xls and protected-file conversion is W6, a manual check on Windows. test_convert only checks the off-Windows 501 and is skipped on Windows. |
| WB-10 | Clear errors without helper, on conversion failure, for encrypted files | core/tests/host.test.ts:135 "an unreadable file is refused with its code" (NOTZIP); core/tests/robustness.test.ts:237 "an encrypted .xlsx is refused as ENCRYPTED (not sent to Excel); an .xls stays CFB"; :242 "empty, non-zip and truncated files are NOTZIP; …" | check | PASS (partial) | The error codes are unit-tested. No e2e shows the message the user sees, and there is no case for "no helper" or a failed conversion. |
| WB-11 | Small workbooks parsed fully, big ones per sheet; performance (03 §6.3) | core/tests/host.test.ts:144 "calls about the workbook being opened read that one; …" (big.xlsx read on demand); core/tests/robustness.test.ts:110 "a big workbook whose first slides read no sheet still gets its shared styles…" (`info.big`); core/bench/parse.bench.test.ts:25 "big30: one sheet parsed under 0.5 s, under 40 MB retained"; tools/bench.mjs `read_big30_ms` < 1 s | check+bench | PASS | The bench needs big30.xlsx to be generated, which is not committed. It exits 2 if the file is missing. |
| WB-12 | Busy overlay with progress; UI never blocked > 50 ms | tools/bench.mjs `longest_task_ms` ≤ 50 (Long Tasks API while opening deck20 and reading big30); core/tests/robustness.test.ts:60 (progress ends with `<hide>`), :125 "a background read that fails hides the progress overlay and reports the error" | bench+check | PASS (partial) | The overlay and its progress text are never asserted on screen. The first-draw tasks have a looser gate of 250 ms. |
| WB-13 | "Saved preset found": Cancel / wizard / continue, with counts | E3 app.spec.ts:170 and E12 :592 click `[data-a="continue"]`; F1 file.spec.ts:25 (continue after reload) | e2e | PASS (partial) | Only Continue is used. Cancel, the "wizard" choice and the counts are not asserted. |
| WB-14 | No preset → wizard; at start-up an "x" workbook opens directly | E1 app.spec.ts:131 (`.wiz` visible after opening report.xlsx) | e2e | PASS (partial) | The start-up direct open of an "x" workbook is not tested. |
| WB-15 | Reload from disk (menu, ↻) | O1 open.spec.ts:33 (`#reloadBtn`: same thumb count, no wizard, no question) | e2e | PASS | The ↻ button is tested. The menu entry is not. |
| WB-16 | Last folder file reopens at start-up | E2 app.spec.ts:151 (openApp only; `#fileName` = lastFile, 4 thumbs); E1:148 `lastFileSaved` | e2e | PASS | |
| WB-17 | Last viewed version restored per workbook | – | – | MISSING | E16 changes `#versionSel` but never reloads to check it is restored. |
| WB-18 | Hidden sheets never listed; unreadable sheets disabled with the error | core/tests/robustness.test.ts:242 "…a workbook with only hidden sheets lists none" | check | PASS (partial) | The "unreadable sheet disabled with its error" part has no test. GG is not effective here. |
| WB-19 | Number formats (Italian separators, sections, scaling, %, exponent, fractions, currency locale tags, General 11 chars) | core/tests/numfmt.test.ts:6–13 (8 its: "grouping and decimals" … "General: 11 characters"); parity text-only: every corpus cell's text (edge-formats, report, deck20 …); export-check GT | check+parity | PASS | GT is effective here, because texts are compared in text-only mode. |
| WB-20 | Dates: English default, Italian `[$-410]`, minutes vs months, AM/PM, elapsed | core/tests/numfmt.test.ts:16–19 ("English by default, Italian with [$-410]", "m is minutes after h and before s", "12-hour clock with AM/PM", "elapsed hours"); parity text-only (edge-1904, edge-formats) | check+parity | PASS | |
| WB-21 | Rich-text superscripts/subscripts | core/tests/numfmt.test.ts:26 "keeps the plain text and remembers the raised / lowered parts"; core/tests/excel-dl.test.ts:84 "superscript and subscript parts: .62 em, raised .55 em / lowered .25 em"; core/tests/glass-dl.test.ts:126; E16 app.spec.ts:772 ("(1)" smaller and above the baseline); parity GT | check+e2e+parity | PASS | GG/GP not effective here. |
| WB-22 | "x" marker tables detected | E1 app.spec.ts:131 (slides = cover, index, content, content: the two marker sheets); parity text-only (every corpus deck uses `kind:"markers"` tables, so a lost table is an element or text difference); core/tests/host.test.ts:55 (defaultPreset has tables) | e2e+parity+check | PASS | GG not effective here. |
| WB-23 | Range tables, growing ranges | E8 app.spec.ts:421 (range B3:D5 added in the wizard); parity text-only (plain, big and missing-table use `kind:"range"`) | e2e+parity | PASS (partial) | Growing ranges (`grow`) are never asserted. host.test.ts:202 only checks that `tableSize` equals `resolveTable` for grown ranges. GG not effective here. |
| WB-24 | Fonts, fills, borders, merges, hidden rows/cols, CF, pictures (EMF/WMF via GDI+), shapes, text boxes | core/tests/excel-dl.test.ts:98, :125, :131, :146, :155, :187 (fonts, fills, borders, shapes, text boxes, pictures); core/tests/slice.test.ts:87 (CF operands); core/tests/tables.test.ts:74 (merges), :116 (CF); core/tests/sheetstore.test.ts (row info incl. hidden), core/tests/xml.test.ts:58; parity text-only styles (font, colour, bg) for Excel and Excel Refined | check+parity | PASS (partial) | EMF/WMF through GDI+ is not in the corpus and has no test. GG/GP/GF geometry and pixels are not effective here, and glass styles are accepted in text-only mode. |
| WB-25 | Workbook changed on disk → banner "Reload now" (6 s) | O1 open.spec.ts:33 (mtime bumped → `#bannerChanged` visible within 15 s → reload → banner gone) | e2e | PASS | |
| WB-26 | Stable read while Excel is saving (503 + retry) | helper/tests/test_workbooks.py:53 `test_stable_read`, :60 `test_incomplete_zip_is_retried_then_unstable`, :67 `test_file_completed_while_waiting`; helper/tests/test_http.py:255 `test_incomplete_workbook_is_503` | helper | PASS | The page's retry on a 503 is not tested. 05 only asks for the helper test (S). |
| WB-27 | Errors become toasts | core/tests/robustness.test.ts:125 (the core reports the error to the page) | check | PASS (partial) | No test asserts that an error shows as a toast. O1 only asserts that no error toast appears. |
| WZ-01 | ✦ Wizard enabled once a workbook is loaded | E8 app.spec.ts:421, E16 :772 click `#wizardBtn` (implicit: the click fails if it is disabled) | e2e | PASS (partial) | Disabled with no workbook is not asserted. |
| WZ-02 | 4-step header, clickable back/forward | – | – | MISSING | |
| WZ-03 | ✕/Esc asks "Close the wizard?" | E8 app.spec.ts:432, E17 :852 (`[data-x="close"]` then `.modal [data-a="ok"]`; the modal must appear) | e2e | PASS (partial) | Esc is not tested and the question text is not asserted. |
| WZ-04 | Step 1 sheet list: size, "slide" chip, "N × table", title, used range | E17 app.spec.ts:834 (`.sheetrow input[value=…]` exists); core/tests/host.test.ts:185 "summaries, windows, suggestions, cells and table sizes come from the worker's sheets" (the worker's data equals the direct functions) | e2e+check | PASS (partial) | The row's contents (size, chip, count, title, range) are not asserted. |
| WZ-05 | Sheets named "slide" preselected | E1 app.spec.ts:136 (`.wtab` count 3 after Next: the three SLIDE_* sheets, not "Numbers") | e2e | PASS | |
| WZ-06 | Only "slide" / All / None; "N of M · X MB to read" | – | – | MISSING | |
| WZ-07 | "not read yet" for big sheets | – | – | MISSING | E17 opens big.xlsx but asserts no such text. |
| WZ-08 | Cancel; Next disabled without sheets | – | – | MISSING | |
| WZ-09 | Step 2 sheet tabs with counts | E1 app.spec.ts:136 (`.wtab` count 3); E8 :424 clicks a tab by name | e2e | PASS (partial) | The counts on the tabs are not asserted. |
| WZ-10 | Sheet preview grid (hidden narrow, "x" marked, clip note) | E17 app.spec.ts:830 (`.clipnote` visible; `.wgrid-in[data-complete]`; the selection box within 1.5 px of its cells); core/tests/host.test.ts:214 "a window holds the cells the preview shows…" | e2e+check | PASS (partial) | Narrow hidden rows/columns and the "x" marking are not asserted. There is no GP of the preview. |
| WZ-11 | Drag/Shift-click select; arrows, Shift+arrows (skip hidden) | E8 app.spec.ts:421 (Shift+arrows → `#wRange` B3:D5); E16 :789 (Shift+click → H10:I11); E17 :849 (Shift+arrows → D5:E6) | e2e | PASS (partial) | Drag-select and skipping hidden rows/columns are not tested. |
| WZ-12 | Enter adds the table; Esc clears | E8 app.spec.ts:428 (Enter → one `.wtrow`) | e2e | PASS (partial) | Esc clearing the selection is not tested. |
| WZ-13 | Range box + Add table; invalid flashes | (E8 asserts that `#wRange` reflects the selection) | – | MISSING | No test types a range and clicks Add table, and none checks that an invalid range flashes. |
| WZ-14 | "grows when rows are added below" | – | – | MISSING | 05 asks for U (growG), but there is no unit test of growth. |
| WZ-15 | Use "x" tables (N) | – | – | MISSING | |
| WZ-16 | Add detected tables (N), dashed suggestions | core/tests/detect.test.ts:18 (per corpus workbook: `detectTables` = v3's), :27 "crafted: blank texts, …"; core/tests/host.test.ts:185 (`detectTables` through the worker) | check | PASS (partial) | The U part is guarded. The e2e for the button and the dashed suggestions is missing. |
| WZ-17 | Table list: name, ✕, range, grows, size, > 3 000-cell warning, "on N slides" | E8 app.spec.ts:429–431 (`.wtrow` count 1, `.rgin` = B3:D5); core/tests/host.test.ts:185 (table sizes) | e2e+check | PASS (partial) | ✕, grows, the warning and "on N slides" are not asserted. |
| WZ-18 | Click overlay scrolls to its row | – | – | MISSING | |
| WZ-19 | Step 3 table pool: drag, click-to-add, "unused" | – | – | MISSING | |
| WZ-20 | Cover (first) and Index (after cover) checkboxes | E1 app.spec.ts:138–145 (`#cvOn`, `#ixOn` → slide types `["cover","index","content","content"]`) | e2e | PASS | |
| WZ-21 | One slide per sheet (asks); + New slide | – | – | MISSING | |
| WZ-22 | Slide cards: title, subtitle, Logo, ↑ ↓, ✕ | – | – | MISSING | |
| WZ-23 | Cover fields: title, subtitle, date ("automatic"), note, logo | E1 app.spec.ts:139/146 (`#cvTitle` → `slides[0].title` "IBD Weekly"); E4 :233 (the cover text is in the PDF) | e2e | PASS (partial) | Only the title is tested. Subtitle, date, note and logo are not. |
| WZ-24 | Index "with subtitles", logo | E10 app.spec.ts:519–524 (`#ixSubs` → `subs:false`, `.ix-s` gone) | e2e | PASS (partial) | The test uses the slide control, not the wizard option. The index logo is not tested. |
| WZ-25 | Drag tables between slides; ✕ removes | – | – | MISSING | |
| WZ-26 | Next · Versions; Save preset & show slides | E1 app.spec.ts:141 (`[data-a="finish"]` → 4 thumbs, doc saved); E16 :782 (`[data-a="versions"]`) | e2e | PASS | |
| WZ-27 | "Add at least one slide" | – | – | MISSING | |
| WZ-28 | Step 4 versions: radio, name, "N removed", ✕ | E16 app.spec.ts:785–797 (3 `.wvrow`, selecting "All", `.del` removes Board, versions saved) | e2e | PASS (partial) | The "N removed" count is not asserted. |
| WZ-29 | New version (Enter; duplicates refused); chips + Chief, + All | E16 app.spec.ts:783–785 (`[data-addv]` chips, `#wNewVersion` + `#wAddVersion` click) | e2e | PASS (partial) | Adding with Enter and refusing duplicates are not tested. |
| WZ-30 | Select cells → Remove; list of cuts with ✕ | E16 app.spec.ts:788–797 (Shift+click → `#wCutRange` H10:I11 → `#wCut` → one `.wcut` → `hide` saved) | e2e | PASS (partial) | Removing a cut with its ✕ is not tested. |
| WZ-31 | Sheet tabs with cut counts; table ghosts; cuts drawn | – | – | MISSING | |
| WZ-32 | Others changed slides meanwhile → "Discard mine / Save mine anyway" | – | – | MISSING | The two-user e2e 05 asks for does not exist. |
| WZ-33 | Wizard result is one undo step | – | – | MISSING | 05 asks for U. robustness.test.ts applies a "Wizard changes" op but never asserts the history. |
| DS-01 | Switch Glass / Excel / Excel Refined, saved and shared | E3 app.spec.ts:206–208 (bob switches to Excel → anna's stage `.slide.excel`); E10 :539–545, E15 :763 | e2e+parity | PASS | GG/GP not effective here. Parity text-only still covers all three designs' texts and elements. |
| DS-02 | Excel adds nothing; title, logo, page number, footer stay | E15 app.spec.ts:762–766 (no `.tnote`, no `.addnote`, Comment… disabled); core/tests/design.test.ts:57 "Excel is raw: the workbook's colours, …; no text boxes"; parity text-only (Excel element list and styles) | e2e+check+parity | PASS | GG/GP not effective here. |
| DS-03 | Excel Refined = Excel tables + text boxes, comments, notes | E10 app.spec.ts:541–551 (the table markup is identical to Excel's, also after a colour change); core/tests/design.test.ts:52 "Excel Refined draws the tables exactly like Excel…"; parity text-only | e2e+check+parity | PASS | GG/GP not effective here. |
| DS-04 | Liquid Glass: roles, surfaces, frames, grids, rules, signals, media, cards, separators, tinted glass, capsules, deep ink | core/tests/glass-dl.test.ts:51 (per deck: "every material, text, text box and picture of the plan, at its box"), :75–172 (recipes, cell texts); core/tests/design.test.ts:48 (roles); tools/dlcheck.mjs (`npm run sp`: per-node PDF vs canvas, effective anywhere) | check+sp | PASS (partial) | GG/GP not effective here, and in text-only mode glass style differences are accepted by scope. The GP human sign-off is manual (G1 is done). Parity's own SP (stage vs PDF) does not run here. |
| DS-05 | Glass strength Subtle/Medium/Strong | core/tests/glass-dl.test.ts:82 "materials follow --gi: deeper shadows and stronger rims with the glass level" | check | PASS (partial) | 05 asks for GP at each level, which is not effective here. The corpus has medium (weekly-looks) and strong (report-looks). |
| DS-06 | Background colour 0–100 % slider, one undo step | core/tests/host.test.ts:97 (inside "opens a workbook, …": three `coalesce:"radius"` applies → one undo step) | check | PASS (partial) | Coalescing is only tested for radius. The colour slider's coalesce key and its drawing (GP) are not. |
| DS-07 | Per-design sizing incl. older shared sizing and `fixedScale` | core/tests/text.test.ts:166 "raw Excel is not shrunk by text boxes, nor by a scale made with them", :177 "each design uses its own sizing, else the shared one", :184, :191; core/tests/tables.test.ts:64 | check | PASS | GG not effective here. |
| DS-08 | Per-design looks: Apply to this design / all designs | E10 app.spec.ts:526–561 (`#lookScope` design/all → `designs.clean.colors` vs `style.colors`); core/tests/design.test.ts:66 "each design can have its own colours, text styles and theme over the shared ones" | e2e+check | PASS | |
| DS-09 | Switching design re-resolves slides with that design's sizes | core/tests/text.test.ts:177 (computeLayout per design); E7 app.spec.ts:379 and E10 :500 assert that sizing is saved per design (`sizes[design]`) | check+e2e | PASS (partial) | No e2e switches the design and checks the layout change. GG not effective here. |
| TH-01 | Design… button with swatch → Colours tab | E10 app.spec.ts:527–528 (`#themeBtn` opens the dialog, `#lookScope` shown) | e2e | PASS (partial) | The swatch on the button is not asserted. |
| TH-02 | Scope This design only / All designs | E10 app.spec.ts:528 (design scope on by default), :553–555 (all → `style.colors`) | e2e | PASS | |
| TH-03 | Themes Aurora, Ocean, Forest, Sunset, Graphite, Intesa, Custom | E10 app.spec.ts:529–536 (Intesa → `theme.id`, `--a1` #00953B; Custom; Aurora); core/tests/tables.test.ts:99 "themes: built-in by id, custom with stored colours"; core/tests/design.test.ts:38 | e2e+check | PASS (partial) | 05 asks for GP of every theme, which is not effective here. Ocean, Forest, Sunset and Graphite have no test and no golden. |
| TH-04 | Custom theme: 4 background + 2 accent pickers (debounced) | E10 app.spec.ts:533–535 (`[data-tk="c1"]` → saved `c1`) | e2e | PASS (partial) | One picker of six is tested. The debounce is not asserted. GP not effective here. |
| TH-05 | "Your colours" per key; unused keys greyed per design | E10 app.spec.ts:547–549 (no `head` key in Excel Refined; accent saved per design) | e2e | PASS | The test asserts that the key is absent; 05 says "greyed". |
| TH-06/07/08 | Reset one / all; all-designs scope clears per-design values | E10 app.spec.ts:556–561 (`#colorsReset` in all scope clears `style.colors` and `designs.clean.colors`; disabled afterwards) | e2e | PASS (partial) | Resetting one key is not tested. 05's U part has no unit test. |
| TH-09 | Overrides apply in every design | core/tests/design.test.ts:75 "accent, green/red and background overrides reach every design as CSS variables"; :38 | check | PASS | GG/GP not effective here. |
| TH-10 | Corners 0–200 % | E6 app.spec.ts:367–368 (`#radiusRange` 0 → `style.radius` 0) | e2e | PASS (partial) | Only the saved value is checked. 05 asks for GP, which is not effective here. |
| TH-11 | Contrast 0–100 (Glass) | E6 app.spec.ts:367–368 (`#contrastRange` 80 → `style.contrast` 80) | e2e | PASS (partial) | Only the saved value is checked. GP not effective here. |
| TH-12 | Use as default for new decks (config.json) | helper/tests/test_http.py:149 `test_config`; helper/tests/test_store.py:47 `test_config_compare_and_set_and_prefs`, :65, :72; app/tests/api.test.tsx:58 "patches the style read and sends it with its rev; …" | helper+check | PASS (partial) | The S and U parts are guarded. The new e2e 05 asks for (`#styleDefault`) does not exist. |
| TH-13 | Wallpaper (gradient, blobs, ribbons, grain), contrast baked | core/tests/robustness.test.ts:268 "is drawn once when it is asked for again…"; core/tests/glass-dl.test.ts:90 "the blurred wallpaper at placeGlass's lens…" | check | PASS (partial) | GP not effective here. The GF check "2 images per PDF" is not gated: export-check records `images` but never fails on them. |
| TX-01 | Target label: none / Cell / Cells / Title / Subtitle / Cover note / Date / Text box / Notes | E12 app.spec.ts:599, :603, :614 ("No text selected", "Title", /^Cell /) | e2e | PASS (partial) | Cells, Subtitle, Cover note, Date, Text box and Notes are not asserted. |
| TX-02 | Controls disabled without a target | E12 app.spec.ts:600 (`#boldBtn` disabled) | e2e | PASS | |
| TX-03 | Font picker (Font from Excel / Design font) | E12 app.spec.ts:606–609 (Georgia on the title, CSS font-family), :615–616 (Verdana on a cell) | e2e | PASS (partial) | The "Font from Excel" and "Design font" entries are not tested. |
| TX-04 | A− / A+ steps (1 pt < 12, 2 pt above, 5–150) | – | – | MISSING | Both U and E are missing. `stepSize` is in app/src/editor/textfmt.ts:125. |
| TX-05 | Size box in pt, comma accepted | E12 app.spec.ts:604–605 (40 pt → `fmt.title.size` 53.3) | e2e | PASS (partial) | A comma decimal is not tested. |
| TX-06/07 | Bold / Italic toggles with state | E3 app.spec.ts:185–195 (Ctrl+B → `{b:true}`; `#boldBtn` has class `on` for the cell) | e2e | PASS (partial) | Italic (state and result) is not asserted. E11 presses Ctrl+I without checking it. The buttons themselves are never clicked. |
| TX-08 | Text colour: 12 swatches, Automatic, Custom… | – | – | MISSING | |
| TX-09 | Align L/C/R + Auto | E12 app.spec.ts:607–608 (center on the title saved); E10 :514 (center on a text box) | e2e | PASS (partial) | L, R and Auto are not tested. GG not effective here. |
| TX-10 | Line spacing (text boxes) | E14 app.spec.ts:721–724 (`lh` 1.5 saved) | e2e | PASS | GG not effective here. |
| TX-11 | Paragraph spacing | E14 app.spec.ts:722–723 (`pgap` 1 saved) | e2e | PASS | GG not effective here. |
| TX-12 | Vertical top/middle/bottom (text boxes) | E10 app.spec.ts:513–515 (`valign:"middle"` saved) | e2e | PASS (partial) | 05's only method is GG, which is not effective here. Only the saved value is asserted. |
| TX-13 | Clear format | E12 app.spec.ts:610–611 (`#clearFmt` → `fmt` undefined) | e2e | PASS | |
| TX-14 | Title/subtitle/cover note/date: click selects, double-click edits (Enter/Esc/blur) | E12 app.spec.ts:602–603 (click on the title → target "Title") | e2e | PASS (partial) | Double-click editing, Enter, Esc and blur are not tested, nor are subtitle, cover note and date. |
| TX-15 | Per-slide text formatting (`fmt`) | core/tests/text.test.ts:84 "a slide's own formatting sits on top of the deck style"; E12 app.spec.ts:605–608 | check+e2e | PASS | GG not effective here. |
| TX-16–TX-18 | Text styles dialog: rows Titles, Subtitles, Tables, Text boxes, Contents, Page numbers & footer; font, size, B, I, colour, align, line spacing, Reset | E12 app.spec.ts:618–620 (note row font → `designs.glass.text.note`), :646–647 (Reset) | e2e | PASS (partial) | Only the text-box row's font and Reset are tested. The other rows and the size, B, I, colour, align and spacing controls are not. GG not effective here. |
| TX-19 | Style resolution over shared defaults; invalid values dropped | core/tests/text.test.ts:78 "resolve over the shared defaults, entry by entry; invalid values are dropped" | check | PASS | |
| TX-20 | Larger title pushes subtitle and tables down | core/tests/text.test.ts:97 "a larger title pushes the subtitle and the tables down" | check | PASS | GG not effective here. |
| TX-21 | Cover, contents, page numbers use the text styles | core/tests/text.test.ts:103 "cover, contents and page numbers use the text styles"; parity text-only styles (report-looks text styles, Excel and Excel Refined) | check+parity | PASS | GG not effective here. |
| TX-22 | Text boxes take the deck style; own settings win | core/tests/text.test.ts:88 "text boxes take the deck's text box style, their own settings win" | check | PASS | GG not effective here. |
| TX-23 | Done/Esc closes | E12 app.spec.ts:638, :644, :648 (`.tsdlg [data-a="close"]`; only implicit, because the next click would be blocked by an open modal) | e2e | PASS (partial) | Esc is not tested and closing is never asserted directly. |
| FT-01 | Font menu: search, Default, library, Windows, Google | E12 app.spec.ts:606, :615, :619 (`.fontmenu [data-font=…]` picks) | e2e | PASS (partial) | Search, Default and the Google section are not asserted. |
| FT-02/03 | Google font added to the library on pick; "+ Add <typed>" | – | – | MISSING | The network-mocked e2e does not exist. |
| FT-04 | Google names previewed | – | – | MISSING | |
| FT-05 | Upload .ttf/.otf/.woff/.woff2; variable fonts instanced, CFF kept | E12 app.spec.ts:621–637 (.ttf upload → `fonts.json` family/weight/by; Quicksand[wght] stored with glyf and no fvar/gvar/HVAR/avar); core/tests/shape.test.ts:42 "an upload is made static at the weight it declares; …", :274, :293, :80 (WOFF unpacked), :260 (CFF); helper/tests/test_fonts.py:23 `test_upload_list_serve_remove` (.ttf + .woff2) | e2e+check+helper | PASS | No .otf or .woff upload goes through the UI. |
| FT-06–FT-09 | Manage fonts: list, sample, source, styles, who; remove (confirm); add Google; suggestions | E12 app.spec.ts:625 (`#fontLib [data-family]` listed), :636–637 and :642–643 (remove with confirm); helper/tests/test_fonts.py:23 (remove) | e2e+helper | PASS (partial) | Sample, source, styles, who, add Google and suggestions are not asserted in the UI. |
| FT-10 | Library shared, refreshed ≈ 30 s and on menu open | E12 app.spec.ts:639–643 (bob sees anna's Corp Sans in his Fonts tab) | e2e | PASS (partial) | The refresh about every 30 s is not tested. |
| FT-11 | Offline: Google remembered locally, upload disabled | – | – | MISSING | F1–F4 do not touch fonts. |
| FT-12/13 | Family/weight/style from the file; latin subsets; safe names | core/tests/text.test.ts:30 "family names are made safe for CSS and HTML", :61 "Google stylesheets: latin subsets only", :66, :71 "family, weight and italic are read from the font itself"; helper/tests/test_fonts.py:57 `test_bad_uploads_are_refused` | check+helper | PASS | |
| FT-14 | Exports embed the faces used; subset TrueType/CFF, never Type 3 | E4 app.spec.ts:223–225 (`/Font`, `/ToUnicode`, no `/Type3`); F3 file.spec.ts:106 (`/FontFile2`); core/tests/dl.test.ts:347 "subsets fonts per document…"; core/tests/shape.test.ts:225, :239, :260; export-check (pdfcheck: no Type 3) | e2e+check+export-check | PASS | |
| FT-15 | Windows fonts captured into the library (identical layout on every PC) | core/tests/w13.test.ts:59, :70, :84; app/tests/fontcapture.test.tsx:34, :46, :63, :70; helper/tests/test_sysfonts.py:104 `test_capture_records_a_fingerprint_and_copies_nothing`, :189 `test_copy_mode_copies_the_whole_family_into_the_library` | check+helper | PASS | The W13 two-PC field test is manual and is not recorded as done. |
| CE-01 | Click / drag / Shift+click selection | E6 app.spec.ts:335–336 (click + Shift+arrows → `#nameBox` "SLIDE_3 pair!C5:D6"); E9 :446–449 (drag Bank→Note → fill on C4, D4, J4) | e2e | PASS (partial) | Shift+click on the slide is not tested. |
| CE-02 | Hover highlight (≤ 1 per 16 ms) | – | – | MISSING | |
| CE-03 | Typing starts the editor with that character | E3 app.spec.ts:184–188 (typing "Alfa" on a selected cell → `{orig:"Alpha", text:"Alfa"}`) | e2e | PASS | |
| CE-04 | F2 / double-click edits with all text selected | – | – | MISSING | |
| CE-05 | Inline editor Enter/Shift+Enter/Tab/Shift+Tab/Esc/blur | E3 app.spec.ts:184 and E11 :586–588 (Enter commits) | e2e | PASS (partial) | Shift+Enter, Tab, Shift+Tab, Esc and blur are not tested. |
| CE-06 | Formula bar: name box, fx (Enter/Esc) | E6 app.spec.ts:336, :348 (`#nameBox` text) | e2e | PASS (partial) | Editing in fx (Enter and Esc) is not tested. |
| CE-07 | ↺ Excel value | – | – | MISSING | |
| CE-08 | Del/Backspace clears text (stored as an edit) | – | – | MISSING | |
| CE-09 | Text edit paused when the Excel value changed (`orig`) | (E3 asserts that `orig` is stored) | – | MISSING | The pause itself has no U or E test. |
| CE-10 | Cell colour (12+4 swatches, No colour, Colour from Excel) replaces the fill | E9 app.spec.ts:447–449 (`[data-bg="#FF3B30"]` → `bg` on C4, D4, J4); core/tests/tables.test.ts:80 "a cell colour replaces the Excel colour and becomes the block colour" (incl. `bg:"none"`); parity text-only `bg` (weekly-options D12, Excel and Excel Refined) | e2e+check+parity | PASS (partial) | "Colour from Excel" (reset) is not tested. GG/GP not effective here. |
| CE-11 | Highlight (capsule in Glass) | parity text-only (weekly-options C10 `fill`; styles compared in Excel and Excel Refined only) | parity | PASS (partial) | 05's only methods are GG and GP, which are not effective here, and glass styles are accepted in text-only mode. No U or E test covers it. |
| CE-12 | Cell colour becomes the Glass block colour | core/tests/tables.test.ts:80 (`baseFill` and `userBg` = the cell colour) | check | PASS | GP not effective here. |
| CE-13 | Role Auto/Header/Total/Body/Note | core/tests/design.test.ts:48 "finds header, total, body and spacer rows" (auto roles only); corpus weekly-looks sets roles | check+parity | PASS (partial) | User-set roles are only checked by GG, which is not effective here, and glass styles are accepted in text-only mode. |
| CE-14 | Merge/Unmerge | E9 app.spec.ts:451–454 (`merges` = `{"D4:F4":"merge","C5:J5":"split"}`); core/tests/tables.test.ts:74 "user merges replace overlapping workbook merges; split removes one" | e2e+check | PASS | GG not effective here. |
| CE-15 | Format painter: single, sticky (double-click), Esc | E9 app.spec.ts:456–459 (single use: `body.painting` on, then off after one paint) | e2e | PASS (partial) | Sticky mode (double-click) and Esc are not tested. |
| CE-16 | Painter copies size, B, I, colour, cell colour, highlight, align, role, CF, colour scales | E9 app.spec.ts:461 (`bg` copied); E10 :484–490 (`cf` copied, caps drawn); core/tests/tables.test.ts:116 "painted conditional format: …" | e2e+check | PASS (partial) | Size, B, I, colour, highlight, align, role and colour scales are not tested. |
| CE-17 | Painter without selection → toast | – | – | MISSING | The M4 walk says the button is now disabled instead. Neither behaviour is tested. |
| CE-18 | Selection painting, Glass geometry aware | E9 app.spec.ts:446/458 and E10 :487 (drag-paint on the default Liquid Glass stage); core/tests/dl.test.ts:157 "the stage's hits (S4.1): …" | e2e+check | PASS | GG for the hit rectangles is not effective here. |
| CE-19 | Click on empty slide clears selection | – | – | MISSING | E7 clicks the stage at 4,4 but asserts nothing. |
| CE-20 | Status bar describes the selection | (app/tests/renders.test.tsx:65 only counts re-renders) | – | MISSING | |
| CE-21 | Typing is never overwritten by autosave or others' changes | E11 app.spec.ts:564 (footer input and inline editor keep "Draft for" and "Lamb" across bob's change); app/tests/stage.test.tsx:44 "E8: nothing is redrawn under an open editor; …" | e2e+check | PASS | |
| TA-01 | W/H boxes (px, "…" when mixed) | E6 app.spec.ts:337–343 (W = 150 for two columns → `sizes.glass.cols` 3 and 4 = 150) | e2e | PASS (partial) | The H box and the "…" for mixed sizes are not tested. |
| TA-02 | Excel size reset | E6 app.spec.ts:346–355 (`#sizeReset` → `cols` 3 and 4 undefined, table narrower, one undo step) | e2e | PASS | The M4 walk had this as BROKEN. It is fixed and tested now. |
| TA-03 | Drag column/row border (guide, tip, applies to selection) | – | – | MISSING | E10 drags the table edge, which is TA-05. bench.mjs only times the frames. |
| TA-04 | Double-click border = Excel size | E7 app.spec.ts:410–418 (column 3 back to Excel, column 4 kept, one undo step) | e2e | PASS | |
| TA-05 | Drag an edge to stretch (0.2–5×) | E10 app.spec.ts:502–506 (right edge −150 px → 7 column widths saved) | e2e | PASS (partial) | The 0.2–5× limits are not tested. |
| TA-06 | Corner drag scales | E7 app.spec.ts:389–397 (smaller, sizing changed, undo restores) | e2e | PASS | |
| TA-07 | Grip drag moves next to/above/below another table | E7 app.spec.ts:399–408 (above → `bands` `[[1],[0]]`, `.dropmark`, undo) | e2e | PASS (partial) | Only "above" is tested. "Next to" and "below" are not. |
| TA-08 | Same size (this slide) | E6 app.spec.ts:328–329 (`#sameSize` → widths and heights within 1.5 px) | e2e | PASS | GG not effective here. |
| TA-09 | Position L/C/R and T/M/B | E6 app.spec.ts:330–332 (left: x = 50·k); E10 :499–500 (top, per design); core/tests/tables.test.ts:64 "alignment left/right and a fixed scale", :125 "tables can sit at the top, middle or bottom…" | e2e+check | PASS | GG not effective here. |
| TA-10 | Gridlines H/V: As in Excel / All / None | E10 app.spec.ts:493–496 (`gridH:"off"`, `gridV:"on"`); core/tests/tables.test.ts:106 "gridlines on/off replace the borders of every cell" | e2e+check | PASS | GG/GP not effective here. |
| TA-11 | Colour scales: row/col/all, ±zero or min→max, fill/ink, reverse, preview | E6 app.spec.ts:357–364 (scale on I5:K13 saved, `.cap.scale` drawn); core/tests/tables.test.ts:22, :30, :38 | e2e+check | PASS (partial) | The preview is not asserted. GG/GP not effective here. |
| TA-12 | Colour scale list with ✕ | – | – | MISSING | |
| TA-13 | Reset layout (this slide, this design) | – | – | MISSING | |
| TA-14–TA-18 | Sizes… dialog: same size across slides, copy sizes, align chosen slides, reset to Excel | – | – | MISSING | 05 asks for both E and U. Neither exists. |
| TA-19 | Layout: bands, k ≤ 2, gaps, fixed scale, `reduced` | core/tests/tables.test.ts:46, :58, :64 (fixed scale, `reduced`); core/tests/text.test.ts:140, :154, :177 | check | PASS (partial) | Bands, k ≤ 2 and gaps have no unit assertion. GG not effective here. |
| TA-20 | Hover handles: grip with name, corner, edges, + buttons | E7 app.spec.ts:391/400 (`.hbox .size`, `.grip` used); E10 :503 (`.edge.r`); E14 :714 (`.addnote.bottom`) | e2e | PASS (partial) | The handles work, but the grip's name label is not asserted. |


## Counts (147 rows)

| Status | WB (27) | WZ (33) | DS/TH (20) | TX/FT (30) | CE (21) | TA (16) | Total |
|---|---|---|---|---|---|---|---|
| PASS | 11 | 3 | 8 | 13 | 5 | 6 | **46** |
| PASS (partial) | 11 | 14 | 12 | 12 | 8 | 6 | **63** |
| MISSING | 5 | 16 | 0 | 5 | 8 | 4 | **38** |
| MANUAL | 0 | 0 | 0 | 0 | 0 | 0 | **0** |

No row in §4.1–§4.6 is verified only by M or W. Two rows have a manual part next to their automated guards: WB-09 (W6, .xls and protected-file conversion) and FT-15 (W13, the two-PC field test). DS-04's GP human sign-off was given at G1.

These rows rely partly on GG/GP/SP, which do not run on this PC ("GG/GP not effective here"): WB-18, 21, 22, 23, 24; DS-01 to 07, DS-09; TH-03, 04, 09, 10, 11, 13; TX-09, 10, 11, 12, 15, 16–18, 20, 21, 22; CE-10, 11, 12, 13, 14, 18; TA-08, 09, 10, 11, 19.

## 4.7–4.12

## 4.7 Text boxes and notes section

| ID | Behaviour (short) | Guard (path:line – test title) | Suite | Status | Note |
|---|---|---|---|---|---|
| NB-01 | Ribbon ↑↓←→ add a box beside the selected table, edit it | app/e2e/app.spec.ts:317 – "table tools: same size, alignment, widths, text boxes, colour scale, Shift+arrows" (bob: `[data-addnote="top"]`, types, Ctrl+Enter → `preset.slides[3].notes` text, and anna sees `.tnote`); app.spec.ts:471 – "painter copies conditional formats; …text box bubble…" (`[data-addnote="bottom"]` → note saved) | e2e | PASS | Only ↑ and ↓ are pressed; ← and → share the code path but are never clicked |
| NB-02 | On-slide + buttons | app.spec.ts:707 – "the + button puts a text box there at once; text boxes move anywhere, snap, and attach back" (`.hbox .addnote.bottom` → `textarea.note-edit` visible → box drawn) | e2e | PASS | Only the bottom + is clicked |
| NB-03 | Toasts "Click a cell first" / "already has a text box" | – | – | MISSING | No test triggers either toast (TableTools.tsx:82) |
| NB-04 | Editor: Ctrl+Enter, Esc, blur | E4 app.spec.ts:317, E11 :707, E12 :737 (Ctrl+Enter commits; text asserted in the doc or on the stage) | e2e | PASS (partial) | Esc (cancel) and blur (commit) are never exercised |
| NB-05 | An empty, never-written box is removed | – | – | MISSING | Checked by hand in the M4 walk only |
| NB-06 | Select; double-click/Enter/F2 edit; Del deletes; Esc | E7 app.spec.ts:471 (a click selects the box, then `#noteBubble` and the alignments are saved) and E11 :707 (a click selects, then spacing is saved) | e2e | PASS (partial) | Click-to-select is guarded only implicitly. Double-click, Enter, F2, Del and Esc are not tested |
| NB-07 | Drag freely with 8 px snapping guides | E11 app.spec.ts:707 (drag → `x`/`y` saved, `.tnote.free`); E12 :737 (notes section dragged, `.snapline.h` visible, `x` saved) | e2e | PASS | The 8 px threshold itself is not measured |
| NB-08 | Stretch by the edges, with snapping | app.spec.ts:652 – "automated comments: one short summary…; text boxes stretch and snap" (bottom edge → `.snapline.h` visible, `h` saved, guides gone after the drop) | e2e | PASS | |
| NB-09 | ⤺ Attach back to the table | E11 app.spec.ts:707 (`#noteAttach` → `x` undefined) | e2e | PASS | |
| NB-10 | ◯ Bubble | E7 app.spec.ts:471 (`#noteBubble` → `bubble:true` saved, `.notebub` count 1); core/tests/slide-dl.test.ts:68 – "${design}: every furniture element of v3's slideMarkup has its hit; the lists validate" (`notebub` / `tnote right bub` hits); parity text-only (weekly-options classes) | e2e, check, parity | PASS | GG/GP not effective here: the bubble's look is not compared on this PC |
| NB-11 | 🗑 deletes | – | – | MISSING | `#noteDelete` is never clicked |
| NB-12 | ✎ Notes: notes section at the footer position | app.spec.ts:737 – "notes section of a slide: where the footer is, movable next to the page number; raw Excel adds nothing; menus open" (memo y > 85 % of the slide, moved and snapped); slide-dl.test.ts:152 – "the notes section sits at its box; the footer and page number in their corners" | e2e, check | PASS | GG not effective here |
| NB-13 | Markup `#`, `##`, `**bold**`, `[[+12,3]]` by sign | core/tests/comment.test.ts:42 – "writes the budget and weekly sections like the report" (the generator emits the markup); parity text-only (`tnote` texts with the markup stripped); E10 :652 (the preview shows "Total Banks Loans:" without `**`) | check, parity, e2e | PASS (partial) | No test of `richText` / note rendering: bold runs and colour by sign are only in GP, which is not effective here |
| NB-14 | Font shrinks to fit (≥ 9 px), measured by HarfBuzz (B7) | core/tests/shape.test.ts:211 – "fitText shrinks 1 px at a time down to 9 px"; shape.test.ts:335 – "fitText follows v3's fitNoteSize…"; slide-dl.test.ts:101 – "text boxes: padding, the fitted size…"; slide-dl.test.ts:159 – "text boxes are fitted on their own layout…" | check | PASS | GG (font size) not effective here |
| NB-15 | Left/right as tall as the table; top/bottom as wide | core/tests/tables.test.ts:46 – "left/right boxes are as high as the table, top/bottom as wide" | check | PASS | GG not effective here |
| NB-16 | Span box beside all tables | core/tests/text.test.ts:140 – "a spanning box takes a column next to every table, as tall as all of them" | check | PASS | The "via Comment… placement" UI path is not in e2e. GG not effective here |
| NB-17 | A free box takes no room from the tables | text.test.ts:154 – "a moved box keeps its place and size and takes no room from the tables" | check | PASS | |
| NB-18 | Disabled in raw Excel, with a tooltip | E12 app.spec.ts:737 (Excel: no `.tnote`, no `.addnote`, `#commentBtn` disabled); core/tests/design.test.ts:57 – "Excel is raw: …no text boxes" | e2e, check | PASS (partial) | The ribbon's `[data-addnote]` buttons being disabled, and the tooltip, are not asserted |

## 4.8 Automated comments

| ID | Behaviour (short) | Guard (path:line – test title) | Suite | Status | Note |
|---|---|---|---|---|---|
| AC-01 | ✎ Comment… for the selected table/box (disabled in Excel) | E10 app.spec.ts:652 (`#commentBtn` opens the dialog); E12 :737 (`#commentBtn` disabled in Excel) | e2e | PASS | Opening it on an existing comment box is not tested |
| AC-02 | Table picker for several tables | – | – | MISSING | `#cmtTable` (CommentDialog.tsx:100) is never used |
| AC-03 | Summary (default for new) / Detailed; a missing `mode` = Detailed (legacy) | E10 :652 (`#cmtMode [data-mode=summary]` on); parity GT (comments.json, mode summary and sections) | e2e, parity | PASS (partial) | The legacy rule (no `mode` → Detailed, CommentDialog.tsx:36/50) has no test and no golden: every golden cfg has `mode` |
| AC-04 | Tables in this comment (multi-table) | E10 :652 (`#cmtTables` 2 checked; the preview names both tables); comment.test.ts:96 – "the week against the plan; tables joined into one comment"; parity GT (cfg `tables`) | e2e, check, parity | PASS | |
| AC-05 | "Found:" line (blocks, total, rows, latest period) | – | – | MISSING | `.cmtfound` is not asserted anywhere |
| AC-06 | Title override | parity GT (weekly-options cfg `title: "Deposits overview"`, comments.json exact); comment.test.ts:42 (title "Retail Loans") | parity, check | PASS | |
| AC-07 | Joins: previous week / Budget / EoM / Quarter / Year / YoY / Other | E10 :652 (preview "w/w", "vs Budget", "vs EoM Aug"; unchecking month removes "vs EoM"); comment.test.ts:33 – "finds total, entities, period and comparison groups" (target, week, year); parity GT (kinds week, target, month) | e2e, check, parity | PASS (partial) | Quarter, YoY and Other joins are neither in the goldens nor in a unit test |
| AC-08 | Detailed sections from the headers; a hint when there are none | comment.test.ts:42 (the "## vs Budget – …" sections); parity GT (mode sections) | check, parity | PASS (partial) | The hint "No comparison columns found…" is not tested |
| AC-09 | Title / names / bullets switches | comment.test.ts:106 – "a single block does not repeat the title; title, names and bullets can be switched off"; E10 :652 (bullets off → no "•"); parity GT (showTitle, names, bullets false) | check, e2e, parity | PASS | |
| AC-10 | Length: plan drivers / full / short | comment.test.ts:55 – "options: fewer names, a materiality threshold, excluded rows, short"; parity GT (detail full and short) | check, parity | PASS | In v4 "plan drivers" is the label of `full` in summary mode |
| AC-11 | Name the top 1–5 | comment.test.ts:55 (top 1); comment.test.ts:42 (top 3); parity GT (top 1–3) | check, parity | PASS | 4 and 5 are untested values of the same option |
| AC-12 | Ignore below (materiality) | comment.test.ts:55 (minAbs 5); parity GT (minAbs 50); E10 :652 (`#cmtMin` keeps "0.5", cleared → `minAbs` undefined) | check, parity, e2e | PASS | |
| AC-13 | Unit after amounts (default "mln") | comment.test.ts:116 – "amounts get the unit (mln by default)…"; E10 :652 (`unit: "mln EUR"` saved); parity GT (unit "") | check, e2e, parity | PASS | |
| AC-14 | Rows noun | parity GT (noun bank and country); comment.test.ts:55 (noun bank) | parity, check | PASS | |
| AC-15 | Concentration / broad-based / rows without data | comment.test.ts:42 ("largely driven", "No Budget data is available"); parity GT (share, breadth, missing on and off) | check, parity | PASS | |
| AC-16 | Rows to include (exclusions) | comment.test.ts:55 (exclude VUB); parity GT (exclude ["VUB"]) | check, parity | PASS | |
| AC-17 | Placement: beside all tables, right/left/below/above | parity text-only (comments.json key per side, e.g. `l4tsxhl:left`/`right`/`bottom`, and the `tnote <side> auto` classes); text.test.ts:140 (spanning column); tables.test.ts:46 (sides) | parity, check | PASS | GG not effective here: positions are not compared on this PC. Top ("above") is not in the comment goldens |
| AC-18 | Width/height slider; In a bubble | – | – | MISSING | Width and height exist only as geometry (GG, not effective here). No corpus comment is in a bubble, and no e2e uses the slider or the box |
| AC-19 | Live preview in the current design | E10 :652 (`#cmtPreview` text changes as options change) | e2e | PASS (partial) | That the preview is drawn in the current design (its classes or style) is not asserted |
| AC-20 | Insert/Update (disabled without comparison groups) | E10 :652 (`#cmtInsert` → one auto note saved, with its cfg) | e2e | PASS (partial) | "Update comment" on an existing one, and the disabled state, are not tested |
| AC-21 | Also on N similar tables | – | – | MISSING | `#cmtAll` is never clicked |
| AC-22 | Refuses to overwrite user text | – | – | MISSING | 05 asks for U. The refusal (CommentDialog.tsx:86–87) has no test |
| AC-23 | Remove comment; Cancel; Esc | – | – | MISSING | `#cmtRemove`, Cancel and Esc are not tested |
| AC-24 | Rewritten at render: follows numbers, edits, versions | E10 :652 (a typed number → the note's text changes); parity GT per version (weekly-options All/Chief comments.json); design.test.ts:85 – "cells removed in a version are drawn empty and leave the comments' numbers" | e2e, parity, check | PASS | |
| AC-25 | Editing the text by hand makes it fixed (toast) | – | – | MISSING | The toast (stage/actions.ts:83) is not tested |

## 4.9 Versions, cover, contents, page numbers, footer, logo

| ID | Behaviour (short) | Guard (path:line – test title) | Suite | Status | Note |
|---|---|---|---|---|---|
| VR-01 | Version picker (Full deck + versions) | app.spec.ts:772 – "versions: Chief and All made in the wizard, cells removed in All, every version × design exported; superscripts" (`#versionSel` All → 4 fewer texts; Full deck → back) | e2e | PASS | |
| VR-02 | Removed cells empty (value, colour, highlight; borders kept); comments ignore them | design.test.ts:85 – "cells removed in a version are drawn empty and leave the comments' numbers" (text "", fill null, the comment grid null); E13 :772; parity text-only (weekly-options All texts) | check, e2e, parity | PASS (partial) | "Borders kept" and the removed highlight are not asserted. GG not effective here |
| VR-03 | Version remembered per workbook (prefs) | – | – | MISSING | |
| VR-04 | Versions defined in wizard step 4 | E13 :772 (Chief/All/Board added, Board deleted, cut H10:I11 → `preset.versions` saved) | e2e | PASS | |
| CV-01 | ⚙ Options (disabled without a deck), Design… link | E12 :737 (`#optBtn` opens, `#pnOn` visible) | e2e | PASS (partial) | Disabled without a deck, and the Design… link, are not asserted |
| CV-02–CV-09 | Page numbers: show, start, 6 positions, size, format, capsule/plain, on cover, Text styles link | parity text-only (page-number texts "2 / 3" and Page N, start 1 and 3, `pageno` plain/capsule classes, element presence); slide-dl.test.ts:118 – "a page number in the top-left corner moves the title and subtitle…"; slide-dl.test.ts:68 (pageno hits); text.test.ts:103 – "cover, contents and page numbers use the text styles"; E12 :737 (`#pnOn` → `.pageno` drawn) | parity, check, e2e | PASS (partial) | GG not effective here, so positions and sizes are unguarded here. Positions bl, bc and tc are not in the corpus. Formats "3" and "p. 3" are not in the corpus. "On cover = true" is never drawn (report-looks has no cover). The Text styles link is not tested |
| CV-10–CV-13 | Footer: show, text with {date} {workbook} {title}, 6 positions, size, plain/capsule, on cover, shared corners | app.spec.ts:435 – "header colour, merge/unmerge, format painter, footer" (`#ftOn`, `{workbook}` → "Confidential · report" on the stage, pos bc saved); tables.test.ts:90 – "footer placeholders"; parity text-only (weekly-looks/weekly-options footer texts and classes); slide-dl.test.ts:152 | e2e, check, parity | PASS (partial) | Positions, sizes and corner sharing are GG only, not effective here. "On cover = true" is not in the corpus |
| CV-14 | Logo file + Choose… upload (copied for everyone) | helper/tests/test_fonts.py:81 – test_logo_found_by_name_case_and_folder_and_uploaded (POST /api/logo → data/assets, served) | helper | PASS (partial) | The UI (`#logoFile`, Choose…) has no e2e |
| CV-15 | Bubble around the logo | E8 app.spec.ts:564 – "typing is never overwritten…; logo bubble can be removed" (`#logoBubble` → `style.logoBubble` false saved); parity text-only (`logowrap` class, weekly-options logoBubble); slide-dl.test.ts:68 (logowrap hits) | e2e, parity, check | PASS (partial) | That the bubble disappears from the stage after the toggle is not asserted. GP not effective here |
| CV-16 | Hide/show logo per slide | parity text-only (weekly-looks `logo:false`: the logo element is missing from that slide's element list) | parity | PASS (partial) | The UI toggle (05: "E (new)") has no test |
| CV-17 | Missing logo warning | E4 app.spec.ts:317 (`#issues` contains "Logo “logo.png” not found in the folder"); slide-dl.test.ts:78 – "a logo file that cannot be read (no size): no bubble and no picture…" | e2e, check | PASS | |
| CV-18 | Contents subtitles toggle | E7 app.spec.ts:471 (`#ixSubs` → `subs:false`, `.ix-s` count 0) | e2e | PASS | GG not effective here |
| CV-19 | Cover: title, subtitle, date (automatic = today, en-GB), note | parity text-only (weekly-options cover: "Weekly report", "Loans and deposits", automatic date "1 October 2026" at the capture clock); E1 app.spec.ts:131 – "anna creates the deck with the wizard" (cover title saved); E3 :213 (PDF page 1 contains "IBD Weekly"); slide-dl.test.ts:129 – "a cover without a subtitle…" | parity, e2e, check | PASS (partial) | The cover note is not in the corpus or any test. GG not effective here |
| CV-20 | Cover/index tags in thumbnails; the index lists content slides with page numbers | app.spec.ts:151 – "thumbnails are pictures with their tags; an edit draws its own slide again, no other" (`.thumb .tag` = cover, index); parity text-only (weekly-options index rows `ix-n`, `ix-t`, `ix-p` "3") | e2e, parity | PASS | |

## 4.10 Export

| ID | Behaviour (short) | Guard (path:line – test title) | Suite | Status | Note |
|---|---|---|---|---|---|
| EX-01 | Export PDF (remembered mode, default vector), spinner | app.spec.ts:213 – "export writes a PDF into the shared export folder" (the first export is a vector PDF; the mode is remembered: Export after pictures gives "(images)", and the `pdfMode` pref = vector); bench "export deck20" (time and size) | e2e, bench | PASS (partial) | The spinner is not asserted |
| EX-02 | PDF · text & tables (vector) | E3 :213 (`/Font`, `/ToUnicode`, no Type3, page texts "IBD Weekly", "Alpha 1.234.568"); tools/dlcheck.mjs (per-node PDFium vs canvas, qpdf, no Type 3); export-check (GT text on the corpus) | e2e, sp, export-check | PASS | Corpus-wide SP (parity's screen = PDF) is not effective here |
| EX-03 | PDF · as pictures, "(images)" (B9: 2× PNG pages) | E3 :213 (`pdf-exact` → 4 pages of 3200×1800, no `/Font`, "(images)"); core/tests/export.test.ts:153 – "pictures and PNGs come from the rasteriser…" | e2e, check | PASS | |
| EX-04 | PDF · current slide | E3 :213 (`pdf-current` → 1 page, named after the slide) | e2e | PASS | That page's text is not checked |
| EX-05 | Copy current slide (PNG to the clipboard) | app.spec.ts:267 – "PNG of the current slide and of every slide; the current slide copied to the clipboard" (clipboard image/png 4800×2700, nothing in export/) | e2e | PASS | |
| EX-06/07 | PNG current / every slide | Epng :267 (png-current 4800×2700; png-all 4 files) | e2e | PASS | GP of the PNGs is not compared (GP not effective) |
| EX-08–EX-10 | Every version (this design; × Glass + Excel; × all three) | E13 :772 (versions, versions-2, versions-3: names per B11, counts 2/4/6, Chief text > All text, Excel PDF has fonts and no images, 3 workers); app/tests/export-pool.test.ts:41 – "at most three export workers…" | e2e, check | PASS | |
| EX-11 | File names; a locked target gets " (2)" | helper/tests/test_exports.py:23 test_locked_target_gets_a_suffix; :72 test_export_file_open_target_gets_a_suffix; :61 test_export_file_name_without_control_characters; :79 test_export_file_takes_the_lock_of_its_name | helper | PASS | |
| EX-12 | Toast with Open / Show folder | E3 :213 (the toast contains the file name) | e2e | PASS (partial) | The Open and Show folder buttons are not asserted or clicked |
| EX-13 | ~~In-window fallback~~ (removed, B1) | E3 :213 (no `pdf-old` item; POST /api/export → 404); helper/tests/test_http.py:287 test_engine_routes_are_gone | e2e, helper | PASS | Guards the removal |
| EX-14 | PNG download in the browser | file.spec.ts:95 – "opened from file://: exports are downloads (PDF with the PC's fonts, PNG)" (PNG download 4800×2700) | e2e | PASS | |
| EX-15 | Pending edits flushed before export | E3 :213 ("Gammax" typed, then exported: in the PDF text) | e2e | PASS | |
| EX-16 | Export works offline (download) | file.spec.ts:95 (PDF with `/FontFile2`, text "Alpha", toast); file.spec.ts:123 – "opened from file:// without access to the PC's fonts: the PDF is made of pictures, and the toast says so" | e2e | PASS | |
| EX-17 | Version export progress, "Saved N PDFs" | E13 :772 (toast "Saved 4 PDFs", "Saved 6 PDFs") | e2e | PASS (partial) | The progress text ("Exported N of M…") is not asserted |
| EX-18 | One 16:9 page per slide, exactly filled; vector; real fonts; small | E3 :213 (4 MediaBoxes at 16/9, size budget, fonts, no Type3); core/tests/dl.test.ts:282 – "writes every node type as a valid PDF: one page each, 1200 × 675…"; export-check (qpdf, no Type 3, GF budgets); sp | e2e, check, export-check, sp | PASS | |

## 4.11 Collaboration, undo, keyboard, side panel, status

| ID | Behaviour (short) | Guard (path:line – test title) | Suite | Status | Note |
|---|---|---|---|---|---|
| CO-01 | Field-level merge of concurrent edits | app.spec.ts:170 – "edits by anna and bob on the same workbook are merged, and each sees the other" (C6 text + C8 bold both in the doc); core/tests/ops.test.ts:7/20 (OV vectors); core/tests/docsync.test.ts:19, :63; core/tests/convergence.test.ts:97; helper/tests/test_decks.py:249, :302 | e2e, check, helper | PASS | |
| CO-02 | Others' changes appear (≤ 2 s typical, B5) | E2 :170 (bob sees "Alfa" within 10 s); tools/loadtest4.py --ci (visible p95 < 4 s, 0 lost, converged) | e2e, load | PASS | The "≤ 2 s typical" target itself is not asserted (e2e allows 10 s, load allows 4 s p95) |
| CO-03 | "Updated by <name> just now / N min ago" | E2 :170 (`#sbRemote` contains anna / bob); docsync.test.ts:104 – "remote changes are reported with their authors; mine are not" | e2e, check | PASS (partial) | The wording "just now / N min ago" is not asserted |
| CO-04 | Presence avatars (≤ 3, initials), "X is also here", "(another window)" | E2 :170 (`#presence` contains the other user) | e2e | PASS (partial) | The ≤ 3 limit, initials, "is also here" and "(another window)" are not asserted |
| CO-05 | Presence heartbeat 10 s; leave on pagehide | helper/tests/test_http.py:170 test_presence_between_two_clients (presence, then /api/presence/leave); helper/tests/test_decks.py:550 test_presence_v2 (staleness, leave) | helper | PASS (partial) | The page's 10 s heartbeat and its `pagehide` leave (state/app.ts:123) are not tested |
| CO-06 | The stage never redraws under an open editor; settings fields keep drafts | E8 app.spec.ts:564 (`#ftText` keeps "Draft for"; `input.inline-edit` keeps "Lamb" across bob's change); app/tests/stage.test.tsx:44 – "E8: nothing is redrawn under an open editor…" | e2e, check | PASS | |
| CO-07 | Config defaults re-read ≈ 30 s | – | – | MISSING | |
| CO-08 | Others' preset changes rebuild slides and keep the current slide | E4 :317 (bob's new text box, a preset change, appears on anna's current slide 3) | e2e | PASS (partial) | Implicit only. Slides added or removed by others, with the current slide kept, are not tested |
| UN-01 | Undo/Redo buttons | – | – | MISSING | `#undoBtn` / `#redoBtn` are never clicked: undo is tested only by keyboard |
| UN-02 | Undo only my own changes; others' later edits survive | E2 :170 (anna's Ctrl+Z: C6 gone, bob's C8 bold kept); ops.test.ts:50 – "undo of my edit keeps another user's later edit"; docsync.test.ts:114; host.test.ts:117 | e2e, check | PASS | |
| UN-03 | Toast "Undo: <label>" | – | – | MISSING | |
| UN-04 | Slider drags coalesce (same key within 1.5 s) | core/tests/host.test.ts:55 – "opens a workbook, owns the document and its history…" (3 radius applies with `coalesce` → one undo step) | check | PASS | The 1.5 s window's expiry is not tested |
| UN-05 | Undo stack 200, redo cleared on change, per workbook | core/tests/robustness.test.ts:254 – "keeps the last 200 steps, and a new change clears redo"; host.test.ts:144 – "calls about the workbook being opened read that one; the open one's history does not carry over" | check | PASS | |
| KB-01–KB-25 | Every shortcut (05: one table-driven e2e test per shortcut) | See the per-shortcut table below | e2e, check | PASS (partial) | **No table-driven shortcut test exists.** 7 of the 24 shortcut groups are pressed with their effect asserted, 4 partly, 13 not at all |
| SP-01–SP-15 | Side panel: thumbnails with badges, SLIDES N, cover/index info, missing tables, no tables, table facts, error values, small text, charts, unreadable pictures, unsupported CF, edited/paused cells, custom layout, logo not found, preset summary | parity text-only (issues.json exact per corpus slide: cover/index info, missing table, "No tables on this slide.", table facts with hidden rows/cols, "Not reproduced …: colorScale", "N edited cells", preset summary); Eth app.spec.ts:151 (cover/index tags); E4 :317 (logo not found) | parity, e2e | PASS (partial) | No golden or test for: error values, small text < 9.5 px, charts not reproduced, unreadable pictures, paused edits, custom layout, "grows". Badges and the "SLIDES N" header are not asserted |
| SB-01–SB-13 | Status bar: selection text and hint; save states; retries 2–32 s; 409 → outdated; changed-on-disk banner; offline banner; health 6 s; zoom; toasts with actions | every e2e waits on `#sbSave` "✓ Saved"; file.spec.ts:25 ("Saved in this browser only"); docsync.test.ts:28 – "one record per batch… '✓ Saved' when flushed (B6)"; docsync.test.ts:345 – "409 on append: no retries, the page asks to reload…"; docsync.test.ts:356 – "a snapshot in a newer format (409 on read): outdated…"; open.spec.ts:33 (`#bannerChanged` shown and acted on); file.spec.ts:25 (`#bannerOffline`); app/tests/stage.test.tsx:105 – "Fit pressed while the zoom is already fit re-fits the stage"; app.spec openApp (`#srv` absent, B1) | e2e, check | PASS (partial) | Not tested: the selection text and shortcut hint; the Unsaved and retrying states; the 2–32 s back-off; health every 6 s; zoom −/+, its 20–300 % range and memory; the toast action buttons |
| OF-01–OF-06 | Offline `file://`: localStorage docs/prefs/fonts, banner, no folder list or uploads; exports work | file.spec.ts:25 – "opened from file://: choose a workbook, make the deck, edit a cell, keep it after a reload" (localStorage doc, banner, undo/redo in the worker, reload); file.spec.ts:66 (.xlsb); file.spec.ts:95, :123 (exports) | e2e | PASS (partial) | Prefs and fonts in localStorage, and "no folder list / no uploads", are not asserted |

### KB-01–KB-25 per shortcut

| Shortcut | Pressed by | Effect asserted? | Status |
|---|---|---|---|
| Ctrl+Z | E2 app.spec.ts:199 (C6 gone); E4 :354 (cols back to 150); Edr :386 (sizing restored); Eth :166; F1 file.spec.ts:48 ("Alpha" back) | yes | PASS |
| Ctrl+Shift+Z | – | – | MISSING |
| Ctrl+Y | F1 file.spec.ts:50 ("Alfa" back, stored) | yes | PASS |
| Ctrl+S | – | – | MISSING |
| PgUp / PgDn | – | – | MISSING |
| Alt+↑ / Alt+↓ | – | – | MISSING |
| Esc (stops the painter) | – | E6 only asserts that the painter ends after one paint | MISSING |
| Ctrl+B | E2 :185 (C8 `{b:true}`, `#boldBtn.on`); Erb :863 | yes | PASS |
| Ctrl+I | E8 :584 (bob) | only implied (a record arrives at anna); italic is not checked | PASS (partial) |
| Enter/F2/Esc/Del on slide text (titles) | – | – | MISSING |
| Enter/F2/Esc/Del on text boxes | – (only Ctrl+Enter, see NB-04) | – | MISSING |
| Ctrl+A (app: select all) | only inside text inputs (E8 :570, E10 :674), a native select-all | not the app's Ctrl+A | MISSING |
| Arrows (move the cell) | E10 :693 (ArrowRight ×5) | no: the comment would change even if the arrows did nothing | MISSING |
| Shift+arrows | E4 :335/:347 (`#nameBox` "SLIDE_3 pair!C5:D6") | yes | PASS |
| Tab / Shift+Tab | – | – | MISSING |
| Enter / Shift+Enter | Enter commits a cell edit (E2 :184, F1) | the commit, yes; moving down and Shift+Enter, no | PASS (partial) |
| F2 (cell) | – | – | MISSING |
| Del (cell) | – | – | MISSING |
| Printable key starts editing | E2 :184 (typing "Alfa" → C6 text) | yes | PASS |
| Inline editors | E8 :582–588 ("Lamb" kept, then "Lambda 2" saved) | yes | PASS |
| fx (formula) bar | – | – | MISSING |
| W / H boxes | E4 :337 (W 150 + Enter → cols 150) | W yes, H no | PASS (partial) |
| Dialogs (Esc / Enter) | E4 :367–375 (Esc closes Options, implicitly); Epng :301 (Enter in the feedback textarea = new line); app/tests/dialog.test.tsx:12 – "the primary button, when the user is not in the dialog yet" | partly | PASS (partial) |
| Wizard keys | E5 app.spec.ts:421 – "wizard table picker: Shift+arrows select, Enter adds the table"; E14 :830 | yes | PASS |

## 4.12 Install, start, update, data

| ID | Behaviour (short) | Guard (path:line – test title) | Suite | Status | Note |
|---|---|---|---|---|---|
| IN-01 | Install finds `py -3`/`python`, explains if missing | – | – | MANUAL | 05: W (Windows policy matrix) |
| IN-02 | Banner: version, user, host, folder, "safe to run again" | – | – | MISSING | test_firstrun.py:176 asserts the step lines and "Detected: Python", not the banner (firstrun.py:450) |
| IN-03 | Python ≥ 3.8, bitness | helper/tests/test_firstrun.py:41 test_versions (3.7 FAIL, 3.8+ OK) | helper | PASS (partial) | Bitness is not asserted |
| IN-04/05/06 | pip / Playwright / engine (removed, B1) | test_firstrun.py:176 test_install_twice_is_safe (no pip, playwright, engine or Chrome in the output; only the shortcut is run); test_firstrun.py:231 test_engine_installer_is_gone | helper | PASS | Guards the removal |
| IN-07 | Shared-folder check + journal append and flush | test_firstrun.py:104 test_probe; :112 test_unwritable_export_fails_the_step; :119 test_slow_share_warns; :128 test_probe_appends_flushes_and_cleans_up; :142 test_second_append_is_checked; :157 test_failed_flush_fails_the_step; :168 test_unwritable_data_folder | helper | PASS | Plus W (manual, real share) |
| IN-08 | Desktop shortcut `.lnk` or `.bat` (CLM), UNC via pushd | test_firstrun.py:56 test_powershell_blocked_writes_a_launcher_bat; :71 test_powershell_missing_writes_a_launcher_bat; :76 test_unc_folder_uses_pushd; :81 test_lnk_replaces_an_earlier_fallback | helper | PASS | Plus W6 (manual) |
| IN-09 | Self-test (start, ping, stop) + read every deck read-only | helper/tests/test_main.py:168 test_passes_and_writes_nothing; :184 test_fails_on_unreadable_or_too_new; test_firstrun.py:216 test_real_smoke_test; :209 test_failed_self_test_gives_exit_code_1 | helper | PASS | |
| IN-10 | OK/WARN/FAIL lines, exit code, ASCII, idempotent | test_firstrun.py:176 test_install_twice_is_safe (OK lines, run twice, exit 0); :202 test_failed_journal_gives_exit_code_1; :119 (WARN); test_main.py:168 (self-test output decodes as ASCII) | helper | PASS (partial) | The install output is not checked for ASCII (only the self-test's is) |
| IN-11 | Start: helper; on failure, says to run Install | – | – | MANUAL | 05: W |
| IN-12 | Port 8765 (+20); if already running, open the browser (v3 vs v4) | test_main.py:24 test_start_ping_and_second_start ("already running on port"); :61 test_same_major; :69 test_skips_a_port_with_another_major_version | helper | PASS | |
| IN-13 | v2 settings import | helper/tests/test_migrate.py:56 test_import; :107, :129, :138 test_second_run_is_a_noop, :159, :164 | helper | PASS | |
| UP-01–UP-10 | Update: one click; protected paths; backups; every deck test-loaded; one at a time; release ZIP + SHA-256, `app\<ver>`, `--use` rollback | helper/tests/test_update.py:95 test_connect_in_place_then_update ("1 deck(s) open fine", before-update backup); :128 test_zip_update_without_git; :150 test_one_update_at_a_time; :156 test_protected_paths; :283 test_install_offline; :310 test_flip_rollback_and_prune; :347 test_release_digest; :371 test_bad_zip_refused; :397 test_selftest_gates_the_pointer; :425 test_one_click_update_follows_releases; :436 test_a_rollback_with_use_is_held; :217 test_use_3_rolls_every_deck_back_first; helper/tests/test_release.py:81 test_contents_and_manifest | helper | PASS (partial) | Keeping only the last 5 backups is not asserted. The options and the final message are only partly asserted. W7 (proxy/TLS) is manual |
| DA-01 | Every saved v3 format readable, upgraded once, with a backup | helper/tests/test_upgrade.py:69 test_every_saved_example_is_read; :92 test_older_file_is_converted_once_and_kept; :131 test_two_helpers_convert_once; test_migrate_v3.py:150 test_7_every_saved_fixture_migrates_and_v3_refuses_the_frozen_deck; core/tests/ops.test.ts:75 (the saved 4.0 format) | helper, check | PASS | |
| DA-02 | Newer files refused ("restart") | test_upgrade.py:153 test_newer_file_is_never_changed; docsync.test.ts:356 (snapshot in a newer format → outdated); test_main.py:184 | helper, check | PASS | |
| DA-03 | v3 ↔ v4 coexistence, per-deck cut-over, rollback | test_migrate_v3.py:185 test_7_a_v3_save_racing_the_migration_is_in_the_snapshot_or_refused; :221 test_8_rollback_refuses_records_past_the_frontier_then_v3_continues; :263 test_8_pinned_decks_stay_with_v3; :408 test_9_v3_and_v4_edit_config_json_at_once_nothing_lost; test_update.py:183 test_migrate_all_then_rollback; Erb app.spec.ts:855 | helper, e2e | PASS | |

## Counts

The 104 rows of §4.7–§4.12, with grouped rows counted once and KB-01–KB-25 counted as one row:

| Section | Rows | PASS | PASS (partial) | MISSING | MANUAL |
|---|---|---|---|---|---|
| 4.7 Text boxes and notes section | 18 | 11 | 4 | 3 | 0 |
| 4.8 Automated comments | 25 | 13 | 5 | 7 | 0 |
| 4.9 Versions, cover, contents, page numbers, footer, logo | 14 | 5 | 8 | 1 | 0 |
| 4.10 Export | 15 | 12 | 3 | 0 | 0 |
| 4.11 Collaboration, undo, keyboard, side panel, status | 17 | 6 | 8 | 3 | 0 |
| 4.12 Install, start, update, data | 15 | 9 | 3 | 1 | 2 |
| **All** | **104** | **56** | **31** | **15** | **2** |

The KB per-shortcut groups (24): 7 AUTOMATED, 4 PARTIAL, 13 MISSING.

GG/GP not effective here (on this PC, only the reference PC's full parity would guard the geometry or pixels): NB-10, NB-12, NB-14–NB-17, AC-17, AC-18, VR-02, CV-02–09, CV-10–13, CV-15, CV-16, CV-18, CV-19, EX-02 (corpus SP), EX-06/07 (GP).
