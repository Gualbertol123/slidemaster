# AUDIT-2 · Appendix: every feature row and its guard (d83e9dd)

The guards of `docs/next/AUDIT-2.md` §2, row by row: **Part A** the rows of `07-scenarios-charts-pptx.md` §6.2 and the
consulting / B28 / B29 rows (05 §4.3, 08 §4.1, PLAN B28 / B29); **Part B** every row of `05-test-and-parity.md` §4
(251), against the previous appendix [`features.md`](features.md) (4df923b). Read-only reviews by sub-agents,
re-checked by the auditor by spot checks; line numbers are d83e9dd's. Verdicts: PASS = an automated test exercises
the behaviour and asserts its result; PASS (partial) = only partly; MISSING = no automated guard; MANUAL = only a W /
field check. The guarding suites passed in all four protocol runs of AUDIT-2 §1 and §10.

## Part A · 07 §6.2 and the consulting / B28 / B29 rows

Read-only. Every path:line was found with grep -n / Read at d83e9dd and the cited test was opened to check what it asserts.
Scope: 07 §6.2 (33 rows); 05 §4.3 / 08 §4.1 consulting rows DS-10..DS-18, TH-14, FT-16; B28 parts of 05 TA-10 / CE-16; B29 (PLAN:299, 08 §2.8).
"MANUAL part" = the row also has a human/field part (GP sign-off, PowerPoint 2016 PC, G-gates). That part is counted separately and is not graded.

### Counts

| Code | Rows | PASS | PASS (partial) | MISSING | MANUAL (whole row) | with a MANUAL part |
|---|---|---|---|---|---|---|
| RC | 6 | 2 | 4 | 0 | 0 | 0 |
| LK | 3 | 2 | 1 | 0 | 0 | 0 |
| SC | 9 | 7 | 2 | 0 | 0 | 0 |
| CH | 4 | 4 | 0 | 0 | 0 | 0 |
| CL | 2 | 2 | 0 | 0 | 0 | 0 |
| FL | 3 | 2 | 1 | 0 | 0 | 0 |
| GL | 2 | 2 | 0 | 0 | 0 | 0 |
| PX | 4 | 2 | 2 | 0 | 0 | 1 (PX-02) |
| **07 §6.2 total** | **33** | **23** | **10** | **0** | **0** | **1** |
| DS (10–18) | 9 | 4 | 5 | 0 | 0 | 6 (DS-11..15, DS-18: GP) |
| TH-14 | 1 | 0 | 1 | 0 | 0 | 0 |
| FT-16 | 1 | 0 | 1 | 0 | 0 | 0 |
| B28 (TA-10, CE-16) | 2 | 0 | 2 | 0 | 0 | 1 (TA-10: GP) |
| B29 | 1 | 0 | 1 | 0 | 0 | 0 |
| **All** | **47** | **27** | **20** | **0** | **0** | **8** |

### MISSING rows
None. Every row has at least one automated guard.

### Partial rows: what is not guarded
- **RC-02**: the per-class counts in the row (1,219 / 20 / 20 / 0 / 0 BanksBig; 182 / 3 / 3 / 4 / 0 Banks) are not asserted. Only the sum 1,259 and 0 different/external are checked, and since M8 (textfmt) locale = 0, so the row's numbers are outdated.
- **RC-04**: no INDIRECT case is asserted (only OFFSET / ROW / INDEX), although the test title names INDIRECT.
- **RC-05**: lazy loading (no engine on open) is not asserted directly; it is only implied by the open_deck20 budget. The budget is 300 ms cold, not the row's 200 ms (amended in 07 §6.4).
- **RC-06**: no test gives an unsupported function → error cell; the fixture is INFO("osversion"), which is "different". The Issues/Formulas line for it is not asserted in the e2e.
- **LK-03**: only a host unit test, no e2e. The Issues line "Linked workbook … not found in the folder" (Chrome.tsx:86) is asserted nowhere.
- **SC-06**: "failed with reason" is asserted only in the host unit test (host.test.ts:605), not end to end.
- **SC-09**: the 3 s gate includes the engine's first use and is scaled ×2 on slow PCs; it is skipped when the build lacks scRunDialog.
- **FL-02**: no move/resize of a chart in free layout (PROGRESS S10.2 admits this). The notes section's free drag is in the bench only, not in the e2e.
- **PX-02**: PF 3 (PowerPoint open, count and texts) runs only on Windows with PowerPoint; it is skipped without failing otherwise (pptxcheck.py:463), and CI uses --no-ppt. W15 / G8 are manual.
- **PX-03**: python-pptx `has_table` is counted but never gated (pptxcheck.py:296, export-check.mjs:216); tables are asserted only as `<a:tbl>` in XML.
- **DS-11 / DS-12**: the empty tracker slot is not asserted. The unit line is asserted only on Red. SP (dlcheck) does not cover consulting slides. GP is manual.
- **DS-13**: merges, sup/sub, rotation, workbook pictures/shapes/text boxes and the user's cell colours are held only by sha1 snapshots and goldens, with no explicit assertion.
- **DS-14**: span columns are not asserted. Automated comments are only validated, not their drawing.
- **DS-16**: the E part is missing; there is no e2e of sizing, text styles or Reset in a consulting design.
- **TH-14**: only the `pos` colour field is checked in the Colours tab; accent, background, text and negative are not.
- **FT-16**: the Gelasio stand-in for Georgia (core/src/text/resolve.ts:30) has no test. That metrics come from the font files is not asserted.
- **TA-10 (B28)**: Bottom, Top, Left, Right, All borders and Thick outside are not exercised (only Outside, No border, Clear). No golden has slide borders.
- **CE-16 (B28/GL-02)**: no unit test of the painter (app/src/editor/painter.ts) for cellGrid/borders. "A cell without one removes the target's" is not tested.
- **B29**: not asserted: Apply to all giving every slide the KPI/panel text format whole; kpiText/panelText edited via the ribbon end to end; cover/contents having no parts. "Defaults = 4.4 output" is held only by unchanged snapshots.

### Table

| Row | Requirement (short) | Kind | Guard (test title, path:line) | Verdict | Note |
|---|---|---|---|---|---|
| RC-01 | Formulas read from .xlsx (shared, array) and .xlsb | U | "${name} (.xlsx scanner, shared formulas expanded)" core/tests/formulas.test.ts:55; "${name} twin (.xlsb reader: Rgce decompiled, PtgExp shared formulas)" :68; "every binary formula of the twins is read (none unreadable); an array formula knows its range" :81 | PASS | Every formula of Banks, Peers, BanksBig, Functions text-equal to Excel's Range.Formula, both readers |
| RC-02 | Self-check classes; locale TEXT cell pinned to Excel's value and listed | U | "self-check: every formula equals Excel's cached value except the volatile and locale-dependent ones (07 §1.3)" core/tests/engine.test.ts:39; "self-check: every formula exact, volatile or locale-dependent; Bank G equals Excel's copy" :108; "a reference to a linked workbook that is not in the model is classed external" :93; engine-pin.test.ts:24; "self-check (the Formulas line)" g4-corpus.test.ts:34 | PASS (partial) | Classes, pinning, `pinned` list, 0 external with Peers linked asserted; the row's per-class counts are not (only the sum 1,259) and are outdated (locale = 0 since M8) |
| RC-03 | Scenario value = Excel's saved copy; pinned TEXT keeps its text | U | "every scenario value equals the copy Excel recalculated for that bank, in both files (RC-03)" engine.test.ts:48; engine-pin.test.ts:24 | PASS | 10 banks × both files, equal === total; asserts total ≥ 1,800, not the row's exact 2,000 of 2,050 |
| RC-04 | Whole columns bounded; OFFSET/INDIRECT exceptions; < 150 ms per value | U + ⏱ | "whole columns are bounded to the used range, not inside OFFSET / INDIRECT" engine.test.ts:64; "engine: first use under 300 ms (cold), one scenario value under 150 ms (BanksBig)" core/bench/engine.bench.test.ts:24 | PASS (partial) | No INDIRECT case asserted |
| RC-05 | Engine lazy; open budget unchanged; first use < 200 ms | ⏱ | engine.bench.test.ts:24 (< 300 ms cold); tools/bench.mjs:68 `open_deck20_ms: 400`, gated :537 | PASS (partial) | Laziness not asserted directly; 300 ms cold per 07 §6.4 amendment |
| RC-06 | Unsupported function → error cell, Issues line, run refused unless "run anyway" | U + E | "the gate (RC-06): a slide cell the self-check classes different stops the run with the list; run anyway marks it" core/tests/host.test.ts:661; "Run for each value, the gate (RC-06): …" app/e2e/app.spec.ts:1327; "without its names (as before M8) the same cells are #NAME?: the self-check reports them" engine-names.test.ts:67 | PASS (partial) | Refusal, gate list, run anyway, red marks (5 designs) asserted; error cell from an unsupported function and the Issues line in e2e not |
| LK-01 | Add a linked workbook in the wizard; its tables draw | E | "linked workbooks (S7.3, B22): a folder file's sheets join the wizard, its table draws on a slide, the deck remembers the file" app/e2e/app.spec.ts:930; host "link: a folder workbook's sheets join under their ids, …" core/tests/host.test.ts:426 | PASS | |
| LK-02 | Command-cell change updates the linked table and read-back cell | U + E | engine.test.ts:48; "Run for each value… (S8.1, SC-01, SC-07): …" app/e2e/app.spec.ts:1121 (preview Bank C: Peers table 1761 → 3141, cleared back) | PASS | Not guarded by the host test PROGRESS names |
| LK-03 | Linked file missing → Issues + tables missing; deck opens | E | "a deck whose linked workbook is missing opens with that table missing" core/tests/host.test.ts:474 | PASS (partial) | Unit only, no e2e; Issues line unasserted |
| SC-01 | Input cell; values typed/pasted/from range; dedup, blanks skipped | E | app/e2e/app.spec.ts:1121; "one per line, trimmed, blank lines skipped, duplicates removed keeping the order" core/tests/scenario-values.test.ts:32; "a paste from Excel: a row's cells (tabs) are values too" :37 | PASS | |
| SC-02 | 3 values × 2 designs → 6 files, right names | E | "Run for each value (S8.3, SC-02/03/05/06): 3 values × 2 designs → 6 files with their names; …" app/e2e/app.spec.ts:1258; host "3 values × 2 designs → 6 files with their names; …" host.test.ts:562 | PASS | Each PDF holds its own bank's figure |
| SC-03 | Duplicate display names → " (2)" in the run | U + E | "equal names inside one run get (2), (3) after the value – also two values that collapse to one safe name" core/tests/names.test.ts:75; host "values that display alike get (2) inside the run (SC-03); …" host.test.ts:613; e2e app.spec.ts:1258 ("12"/"12,0") | PASS | |
| SC-04 | Unsafe chars, reserved names, long names | U | core/tests/names.test.ts:26 (unsafe → _), :37 (reserved), :41 (long, 240 chars, deep folder), :59 (C1 controls, lone surrogates) | PASS | |
| SC-05 | Deck and workbook byte-identical after a run; journal unchanged | E | app/e2e/app.spec.ts:1258 (sha256 of Banks.xlsx, Peers.xlsx, every file of the deck folder, the deck document before/after); host.test.ts:562 | PASS | Journal covered by hashing deckDir |
| SC-06 | Progress, cancel, report (ok / failed with reason) | E | app/e2e/app.spec.ts:1258 (progress, cancel after n of 10, ok entries); host "cancel between values: …" host.test.ts:598; "a file that fails: the value is reported failed with the reason, …" :605 | PASS (partial) | "Failed with reason" only at unit level |
| SC-07 | Preview one value; banner; clear | E | app/e2e/app.spec.ts:1121; bench `preview_switch_ms` tools/bench.mjs:79 | PASS | |
| SC-08 | No main-thread task > 50 ms in a 20-value run | ⏱ | tools/bench.mjs:77 `scenario_task_ms: 50`, gated :537 | PASS | Scaled by ciFactor on CI (:83/:85) |
| SC-09 | 1 value + 20 Glass slides < 3 s; 20 values < 40 s | ⏱ | tools/bench.mjs:77 `scenario_one_ms: 3000, scenario_20_ms: 40000`; runOnce :328; gated :537 | PASS (partial) | 3 s measured from Run incl. engine first use; scaled ×2; skipped if no scRunDialog |
| CH-01 | Pie from table cells; labels/values/percent; legend; theme colours; per-slice colour | U + DL snapshot per design + E | "${design}: a pie from a table and a donut from a sheet on no slide – valid nodes, hits, palette" core/tests/chart-dl.test.ts:157 (snapshots for 5 designs × 2 in __snapshots__/chart-dl.test.ts.snap); chart-dl.test.ts:105, :169 (percent), :187 (per-slice colour), :199 (legend); e2e app/e2e/app.spec.ts:1025 (insert :1033), per-slice colour :1435–1439; budget core/bench/chart.bench.test.ts:29 (< 5 ms) | PASS | Legend asserted for glass, excel, bain only |
| CH-02 | Pie from a range of a sheet on no slide | E | "charts (S9.3, CH-02/03/04, B16, B24): a pie from a sheet on no slide, …" app/e2e/app.spec.ts:1353 (block :1367–1408); U chart-dl.test.ts:117 | PASS | |
| CH-03 | Chart follows reload and scenario value | E | reload app/e2e/app.spec.ts:1461–1467; scenario "charts follow a scenario (S9.3, CH-03): …" app.spec.ts:1025 (:1047, :1049); U chart-dl.test.ts:143 | PASS | |
| CH-04 | Source missing → Issues + placeholder | E | app/e2e/app.spec.ts:1468–1474 (Issues line, placeholder, .itembox.broken, item kept); U chart-dl.test.ts:209 | PASS | |
| CL-01 | Callout shapes, icons, fill/border/text, every design | U + E | "${design}: every shape with text, every icon – valid nodes, the item's hit first" core/tests/shape-dl.test.ts:77 (+ :93, :106); "callouts (S9.4, CL-01, CL-02, B17): …" app/e2e/app.spec.ts:1061; budget core/bench/callout.bench.test.ts:27 (< 2 ms) | PASS | e2e in Glass only; every design covered by U |
| CL-02 | `{Sheet!C7}` with number format; follows scenario; #REF + Issues | U + E | shape-dl.test.ts:56 (formats), :65 (scenario view), :115 (#REF + issue); app/e2e/app.spec.ts:1083, :1101, :1112–1113 | PASS | Number format asserted by U only (e2e quotes a text cell) |
| FL-01 | Free layout on: nothing moves; off: automatic; one undo each | E | "free layout (S10.1, FL-01, B18): …" app/e2e/app.spec.ts:1494 (positions :1512, :1541, :1549; history :1510, :1539, :1547); U core/tests/free-layout.test.ts:51, :62, :138 | PASS | |
| FL-02 | Move/resize every item kind; Alt; one op per drag; ≤ 16 ms per frame | E + trace | "free layout drags (S10.2, FL-02, FL-03, B18): …" app/e2e/app.spec.ts:1552 (Alt :1586–1592, corner :1597, edge :1605, text box :1620/:1626, callout :1636/:1642, one step :1576); tools/bench.mjs:69 `free_drag_frame_ms: 16`, drags :393–414, computed :501–502 | PASS (partial) | Chart not moved/resized in free layout; notes section in bench only |
| FL-03 | Works in raw Excel (text boxes, B19) | E + accepted parity | app/e2e/app.spec.ts:1651–1666; 20 "B19" entries in tests/parity/accepted.json (first :2282, signed off S9.5), matched in tools/parity.mjs:284 | PASS | "0 unaccepted" proven by tool runs, not a test assertion |
| GL-01 | Gridlines on selected cells H/V/outline/colour/weight; clear | U + E | core/tests/cellgrid.test.ts:44, :68, :80, :90, :116, :125, :136–165; "gridlines on selected cells (S10.3, GL-01, GL-02, B20): …" app/e2e/app.spec.ts:1676 (:1690–1719) | PASS | |
| GL-02 | Painter copies them | E | app/e2e/app.spec.ts:1709–1715 | PASS | |
| PX-01 | .pptx: current slide, deck, versions × designs, scenario runs | E + PF 1–2 | "versions: Chief and All made in the wizard, … every version × design exported; superscripts" app/e2e/app.spec.ts:784 (PX-01 block :844–864); "Run for each value (S8.3, …)" app.spec.ts:1258 (:1303–1311); "opened from file://: exports are downloads …" app/e2e/file.spec.ts:95 (:109–113); tools/export-check.mjs:180–222 → tools/pptxcheck.py (structure :194, content :323, check :422) | PASS | PF on deck export only; CI runs export-check --no-ppt |
| PX-02 | Opens in PowerPoint without repair; count and texts equal | PF 3 + W15 | tools/pptxcheck.py:377 powerpoint_open, :444–454; lint :86; export-check.mjs:185 | PASS (partial) + MANUAL part | PF 3 skipped without failure when PowerPoint is absent (:463); not gated (export-check.mjs:217); W15/G8 manual |
| PX-03 | Real tables, text, native pie charts | PF 2 | describe "charts (S11.3, PX-03) …" core/tests/pptx.test.ts:274, :294 (c:pieChart/c:doughnutChart), :314 (real table `<a:tbl>`); pptx.test.ts:78; app.spec.ts:853; pptxcheck.py:434–443 (chart values = workbook cells) | PASS (partial) | `has_table` counted, never gated (pptxcheck.py:296, export-check.mjs:216) |
| PX-04 | Size and time budgets | ⏱ | tools/bench.mjs:70–71 (pptx_glass_ms 3000, pptx_excel_ms 1500, pptx_glass_kb 3072, pptx_excel_kb 300), gated :537; export-check.mjs:49–51, :221–222 | PASS | Bench runs in CI |
| DS-10 | Switch to Navy/Red, saved, shared; 4.0/4.1 page opens it as Glass keeping settings | E + U + S | "consulting designs (M7b, DS-10): Consulting Navy and Consulting Red, saved, one undo step each, their own palette" app/e2e/app.spec.ts:965; core/tests/design-fallback.test.ts:20, :24, :40, :50 (fixtures/v41) | PASS | "Shared" only via the saved file, no second user |
| DS-11 | Navy furniture (band, unit line, rules, footnotes, page number, footer, empty tracker) | U + GG + GP + SP | core/tests/consult-slide.test.ts:61 (page number :102, footer :112), :119, :134, :194, :277, snapshot :452; consult-spec.test.ts:10, :28; parity/dlparity consulting goldens (CI) | PASS (partial) + MANUAL part (GP) | Empty tracker slot not asserted; unit line only on Red (:326); SP not on consulting slides |
| DS-12 | Red furniture | U + GG + GP + SP | consult-slide.test.ts:61 (both designs); "Consulting Red: … a grey rule with a red segment …" consult-spec.test.ts:20 | PASS (partial) + MANUAL part (GP) | Same gaps as DS-11 |
| DS-13 | Consulting tables (roles, rules, merges, sup/sub, rotation, pictures, user colours …) | U + GG + GP | core/tests/consult-dl.test.ts:55 "every corpus table, every version, both designs", :82 (sha1 snapshot), :186, :246–291, :302; exhibit.test.ts:74, :92, :100 | PASS (partial) + MANUAL part (GP) | Merges, sup/sub, rotation, pictures/shapes, user colours held only by snapshots/goldens |
| DS-14 | Text boxes, cards, span columns, bullets, automated comments, notes/kicker | U + GG + GP | consult-slide.test.ts:152, :170, :194, :257, :376 | PASS (partial) + MANUAL part (GP) | Span columns unasserted; comments only validated |
| DS-15 | Cover and contents slides | GG + GP | "${design}: the cover and the contents slide in the spec's colours" consult-slide.test.ts:213, :271, :355, :369, :394; goldens | PASS + MANUAL part (GP) | |
| DS-16 | Per-design sizing, looks, text styles; Reset to spec | U + E | core/tests/text.test.ts:177 "each design uses its own sizing, else the shared one"; design-fallback.test.ts:40; design.test.ts:66 | PASS (partial) | No e2e (the #sizeReset e2e at app.spec.ts:360 runs in Glass) |
| DS-17 | Export: TrueType subsets, no Type 3, budgets, B11 names, versions × five designs | GF + E | app/e2e/app.spec.ts:784 (:838–841 versions-5, :866–873 /FontFile2, no Type3, no Image); export-check.mjs:44–48, :82; bench.mjs:73 | PASS | |
| DS-18 | Old designs 0 unaccepted parity/dlparity; consulting goldens = signed-off render | GG + GP | parity/dlparity CI jobs (.github/workflows/ci.yml:141–148); "Liquid Glass, Excel and Excel Refined are unchanged by the consulting designs" consult-dl.test.ts:90 | PASS + MANUAL part (GP) | CI compares text only |
| TH-14 | Colours tab: accent, background, text, positive, negative; per-design theme | E + U | design-fallback.test.ts:64 "keep their palette under a shared theme; a theme of their own applies"; app/e2e/app.spec.ts:965 (:978–990); consult-spec.test.ts:31 | PASS (partial) | Only `pos` checked in the tab |
| FT-16 | Georgia/Arial measured from files; Gelasio stand-in | U + GF | app/e2e/app.spec.ts:866–873; consult-spec.test.ts:10 | PASS (partial) | Gelasio stand-in untested (no "gelasio" in any test/tool) |
| TA-10 (B28) | Borders ▾: sides, All, Outside, Thick outside, None, style, colour, Clear | U + GG + GP | core/tests/borders.test.ts:48, :65, :74, :82, :88, :99, :109, :115, :122, :129; "cell borders on the slide (S10.3b, B28): …" app/e2e/app.spec.ts:1727 (:1741–1764) | PASS (partial) + MANUAL part (GP/G7) | Only Outside, No border, Clear exercised; no golden with slide borders |
| CE-16 (B28/GL-02) | Painter copies cell gridlines and slide borders | U + E | app/e2e/app.spec.ts:1709–1715 (gridlines), :1754–1759 (borders) | PASS (partial) | No unit test of painter.ts for cellGrid/borders |
| B29 | Composable looks: per slide, Apply to all (one undo), Deck's look, kpiText/panelText, defaults = 4.4 | E + U + OV | app/e2e/app.spec.ts:965 (:991–1013); core/tests/consult-options.test.ts:37, :50; consult-parts.test.ts:72, :82, :88; shared/ops-vectors.json:5448, :5525 run by core/tests/ops.test.ts:7 | PASS (partial) | Apply to all handing the KPI/panel format whole, ribbon text-format e2e, cover/contents without parts are not asserted |

### PROGRESS.md claims that did not hold or could not be confirmed

1. PROGRESS.md:74 (S7.3), "LK-02 by the host test": does not hold. host.test.ts:426 only runs calcCheck, and the scenarioPreview host test (:492) checks SLIDE_1, not the linked table. LK-02 is guarded by engine.test.ts:48 and app.spec.ts:1121.
2. PROGRESS.md:74 (S7.3), "a missing linked file is named in the Issues panel" / "the Issues class" among the tests: no test asserts it.
3. PROGRESS.md:73 (S7.2), "208 formulas exact but 3 locale cells": stale. engine.test.ts:44 now asserts locale = 0.
4. PROGRESS.md:73 (S7.2), "1,890 cells": the test asserts only total ≥ 1,800.
5. PROGRESS.md:75 (S7.4), e2e "205 of 208 · 3 locale-dependent (TEXT)": stale. app.spec.ts:951–952 asserts the line has no "locale".
6. PROGRESS.md (S8.3, ~:124), "host (11 for the run)": the describe has 10 `it`s.
7. PROGRESS.md (S8.4, ~:125), "textfmt (13)": textfmt.test.ts has 11 `it`s.
8. PROGRESS.md:82 (S7b.4), "e2e: … the Look dropdown": out of date. B29 removed it, and the e2e asserts #lookSel is absent (app.spec.ts:1013).
9. PROGRESS.md:130 (S9.3), "thumbnails draw the same list": no test asserts that a chart or callout reaches a thumbnail.
10. PROGRESS.md:139 (S10.3), "Vectors +5": cannot be confirmed from the current file (79 vectors, 6 mention cellGrid; later commits touched it). Minor.
11. PROGRESS.md:150 (S11.2), "pptxcheck: every table has_table": counted, not gated; not a guard.
12. PROGRESS.md:151–152 (S11.3/S11.4), PX-02 "opened in PowerPoint 16 … ×2": this is a record of a local run, not a gate. Step 3 is skipped silently without PowerPoint and CI runs --no-ppt.

## Part B · 05 §4

Re-verification of every row of `docs/next/05-test-and-parity.md` §4 at **d83e9dd** (main, 4.5.0), against the
previous appendix `docs/next/audit/features.md` (written for 4df923b). Read-only: guards found by reading the tests
(`git show d83e9dd:…`, grep), no suite was run for this file. Line numbers are d83e9dd's; the 4df923b citations were
mapped through `git diff -U0 4df923b d83e9dd` (the review's mapping script) and every moved test start
re-located by grep. 07 §6.1 ("05 §4 rows that change") applied: DS-02, DS-07, NB-18, AC-01, TA-10, CE-16, EX-01…10/17,
EX-11, SP-01–15, WB-09, WZ-04…09. DS-10..DS-18, TH-14, FT-16 are covered by the 07 table (Part A): "see 07
table" only. `app.spec` = `app/e2e/app.spec.ts`; e2e tests are cited by their `test(` line, assertions by their own
line.

**Verdicts** (as features.md): PASS = an automated test exercises the behaviour and asserts its result; PASS (partial)
= only partly; MISSING = no automated guard; MANUAL = only a W / field check. **GG/GP not effective here:** on this PC
parity and dlparity run text-only (`tools/parity.mjs:330/349/363`: `--text-only` → texts and styles, no SP; PROGRESS
S7.5 / S7b.1–2 "text-only comparison: this PC's Chromium is not the goldens'"); only the consulting designs' goldens are
compared in full where their environment is (`parity.mjs:288`). Rows whose 05 method is GG/GP only stay "partial"
where nothing else asserts them, as in features.md.

### Counts

Same grouping as features.md (grouped rows such as TH-06/07/08, TX-16–TX-18, KB-01–KB-25 count once). "see 07" rows
are not in the verdict columns.

| Area | Rows | PASS | PASS (partial) | MISSING | MANUAL | see 07 |
|---|---|---|---|---|---|---|
| WB (4.1) | 27 | 11 | 11 | 5 | 0 | – |
| WZ (4.2) | 33 | 3 | 15 | 15 | 0 | – |
| DS/TH (4.3) | 20 (+10) | 8 | 12 | 0 | 0 | 10 (DS-10..18, TH-14) |
| TX/FT (4.4) | 30 (+1) | 13 | 12 | 5 | 0 | 1 (FT-16) |
| CE (4.5) | 21 | 6 | 8 | 7 | 0 | – |
| TA (4.6) | 16 | 6 | 7 | 3 | 0 | – |
| **4.1–4.6** | **147** | **47** | **65** | **35** | **0** | 11 |
| 4.7 Text boxes, notes section | 18 | 13 | 3 | 2 | 0 | – |
| 4.8 Automated comments | 25 | 13 | 5 | 7 | 0 | – |
| 4.9 Versions, cover, contents, page numbers, footer, logo | 14 | 5 | 8 | 1 | 0 | – |
| 4.10 Export | 15 | 12 | 3 | 0 | 0 | – |
| 4.11 Collaboration, undo, keyboard, side panel, status | 17 | 6 | 9 | 2 | 0 | – |
| 4.12 Install, start, update, data | 15 | 9 | 3 | 1 | 2 | – |
| **4.7–4.12** | **104** | **58** | **31** | **13** | **2** | – |
| **All** | **251** | **105** | **96** | **48** | **2** | 11 |

features.md had 4.1–4.6: 46 / 63 / 38 / 0 and 4.7–4.12: 56 / 31 / 15 / 2. KB per-shortcut groups (24): 8 PASS, 3
partial, 13 MISSING (features.md: 7 / 4 / 13).

#### Every MISSING row (48)

* WB-02 "Loading…" / "No .xlsx files next to the app"
* WB-05 Empty state with Open button (open.spec.ts:23 branch never runs in the suite order)
* WB-06 Browsed file equal to a folder file opens as the folder file
* WB-07 Non-folder file uploaded / preview-only
* WB-17 Last viewed version restored per workbook
* WZ-02 4-step header, clickable back/forward
* WZ-06 Only "slide" / All / None; "N of M · X MB to read"
* WZ-07 "not read yet" for big sheets
* WZ-08 Cancel; Next disabled without sheets
* WZ-14 "grows when rows are added below" (E + U growG)
* WZ-15 Use "x" tables (N)
* WZ-18 Click overlay scrolls to its row
* WZ-19 Step 3 table pool: drag, click-to-add, "unused"
* WZ-21 One slide per sheet (asks); + New slide
* WZ-22 Slide cards: title, subtitle, Logo, ↑ ↓, ✕
* WZ-25 Drag tables between slides; ✕ removes
* WZ-27 "Add at least one slide"
* WZ-31 Sheet tabs with cut counts; table ghosts; cuts drawn
* WZ-32 Others changed slides meanwhile → "Discard mine / Save mine anyway"
* WZ-33 Wizard result is one undo step (U)
* TX-04 A− / A+ steps (U + E; `stepSize` now app/src/editor/textfmt.ts:146)
* TX-08 Text colour: 12 swatches, Automatic, Custom…
* FT-02/03 Google font added on pick; "+ Add <typed>"
* FT-04 Google names previewed
* FT-11 Offline: Google remembered locally, upload disabled
* CE-02 Hover highlight (≤ 1 per 16 ms)
* CE-04 F2 / double-click edits with all text selected
* CE-07 ↺ Excel value
* CE-08 Del/Backspace clears text (stored as an edit)
* CE-09 Text edit paused when the Excel value changed (`orig`)
* CE-17 Painter without selection → toast
* CE-20 Status bar describes the selection
* TA-03 Drag column/row border (guide, tip, applies to selection)
* TA-12 Colour scale list with ✕
* TA-14–TA-18 Sizes… dialog
* NB-03 Toasts "Click a cell first" / "already has a text box"
* NB-05 An empty, never-written box is removed
* AC-02 Table picker for several tables
* AC-05 "Found:" line
* AC-18 Width/height slider; In a bubble
* AC-21 Also on N similar tables
* AC-22 Refuses to overwrite user text (U)
* AC-23 Remove comment; Cancel; Esc
* AC-25 Editing the text by hand makes it fixed (toast)
* VR-03 Version remembered per workbook (prefs)
* CO-07 Config defaults re-read ≈ 30 s
* UN-03 Toast "Undo: <label>"
* IN-02 Install banner: version, user, host, folder, "safe to run again"

#### Verdicts changed vs features.md (7 rows + 1 KB group)

| Row | features.md | d83e9dd | Why |
|---|---|---|---|
| WZ-13 | MISSING | PASS (partial) | app.spec:942 types C4:G8 into `#wRange` and clicks `#wAdd`; the table is drawn (:945) and saved (:957). The invalid-range flash is still untested |
| CE-01 | PASS (partial) | PASS | Shift+click on the slide now tested: app.spec:1740 (R1, then Shift+click R2 → borders written on both cells, :1743) and :1032 (Shift+click → chart from the selection, source E5:E6 at :1038) |
| CE-19 | MISSING | PASS (partial) | app.spec:1450–1451: a click on the empty slide clears the selection (`#chartPanel` gone). Only an item (chart) selection is cleared there; the cell selection is not asserted |
| TA-13 | MISSING | PASS (partial) | app.spec:1528–1549 ("free layout (S10.1 …)"): `#resetLayout` asks "Back to automatic layout?", Cancel changes nothing, then switches back, one undo step. Only the free-layout path; the automatic-layout reset (sizing) is untested |
| NB-11 | MISSING | PASS | `#noteDelete` clicked and the note gone from the document: app.spec:1649–1650 and :1668–1669 |
| NB-18 | PASS (partial) | PASS | The row changed (07 §6.1, B19: enabled in every design). app.spec:776–778 (Excel: `.addnote` present, `#commentBtn` and `#slideNotes` enabled), :1653–1656 (a + text box added and drawn in raw Excel); design.test.ts:57 |
| UN-01 | MISSING | PASS (partial) | `#undoBtn` clicked with its effect asserted in nine places, e.g. app.spec:1092–1093, :1421–1422, :1543–1546, :1719–1720, :1752–1753. `#redoBtn` is never clicked |
| KB "Dialogs (Esc / Enter)" | PASS (partial) | PASS | app.spec:1164–1165 (Enter presses the focused button), :1227–1228 (Esc closes the scenario dialog, asserted), :1373–1374 / :1390–1391 (Esc in the cell picker) |

The KB-01–KB-25 row itself stays PASS (partial) (no table-driven shortcut test). Rows whose guard was **rewritten for
the changed behaviour** (07 §6.1) with the same verdict: DS-02 (PASS), DS-07 (PASS), AC-01 (PASS), TA-10 (PASS, now
with the GL and B28 layers), CE-16 (partial), EX-11 (PASS, + scenario names), SP-01–15 (partial, + new issue lines),
WZ-04 / WZ-09 (partial, + linked-workbook sheets), WB-09 (PASS, unchanged behaviour).

### 4.1 Workbooks

| Row | Feature (short) | Guard (test title, path:line) | Verdict | Note (change vs features.md) |
|---|---|---|---|---|
| WB-01 | Open ▾ lists folder workbooks with date, "slides by <user>" | helper/tests/test_workbooks.py:18 `test_list`; helper/tests/test_http.py:210 `test_files_listing_and_stable_read`; app.spec:141 "anna creates the deck with the wizard" (clicks `[data-f="report.xlsx"]`) | PASS (partial) | Lines moved (test_http 187→210, app.spec 131→141). Menu text (date, "slides by …") still not asserted |
| WB-02 | "Loading…" / "No .xlsx files next to the app" | – | MISSING | unchanged |
| WB-03 | Browse… accepts .xlsx/.xlsm/.xlsb/.xls | app/e2e/file.spec.ts:25 "opened from file://: choose a workbook, make the deck, edit a cell, keep it after a reload"; file.spec.ts:66 "opened from file://: an .xlsb opens natively, without Excel" | PASS (partial) | unchanged: `setInputFiles` bypasses `accept`; .xlsm/.xls never browsed |
| WB-04 | Drop a file anywhere to open it | app/e2e/open.spec.ts:33 "a dropped workbook opens; of two drops at once the newer opens; reload from disk; changed on disk" | PASS | unchanged (the open check is now `toHaveText(/^report\.xlsx · \d+ slides?/)`, open.spec.ts:52) |
| WB-05 | Empty state with Open button | (open.spec.ts:23 `toHaveText("No workbook")` only when no last file exists) | MISSING | unchanged |
| WB-06 | Browsed file equal to a folder file opens as the folder file | – | MISSING | unchanged |
| WB-07 | Non-folder file uploaded / preview-only | – | MISSING | unchanged |
| WB-08 | File name "Opening …" / "N slides" | app.spec:89 (openApp helper, `#fileName` = `<name> · N slides`); open.spec.ts:22, :52 | PASS (partial) | Lines moved (87→89). "Opening …" not asserted (open.spec:50–52 now explicitly waits past it) |
| WB-09 | .xlsb/.xls/protected converted by Excel; v4 .xlsb native (B10) | core/tests/xlsb.test.ts:58 "has a twin for every corpus workbook but big30, and edge-xlsb…", :62 (per twin), :110 (per deck); file.spec.ts:66; helper/tests/test_http.py:341 `test_convert_is_501_off_windows`; helper/tests/test_convert.py:40 `test_a_workbook_name_never_reaches_the_command` (new, SEC-2) | PASS | 07 §6.1: behaviour unchanged. .xls / protected conversion is still W6 (manual on Windows). test_convert is new (audit-fixes) |
| WB-10 | Clear errors without helper / conversion failure / encrypted | core/tests/host.test.ts:147 "an unreadable file is refused with its code"; core/tests/robustness.test.ts:238 "an encrypted .xlsx is refused as ENCRYPTED…", :243 "empty, non-zip and truncated files are NOTZIP; …"; helper/tests/test_convert.py:40/:49 (a failed conversion raises, nothing converted) | PASS (partial) | Lines moved. test_convert adds a helper-side failed conversion; no e2e shows the user's message, "no helper" untested |
| WB-11 | Small parsed fully, big per sheet; 03 §6.3 performance | host.test.ts:156 "calls about the workbook being opened read that one; …"; robustness.test.ts:111 "a big workbook whose first slides read no sheet…"; core/bench/parse.bench.test.ts:25 "big30: one sheet parsed under 0.5 s, under 40 MB retained"; tools/bench.mjs `read_big30_ms` | PASS | Lines moved. big30.xlsx must be generated (not committed) |
| WB-12 | Busy overlay with progress; UI never blocked > 50 ms | tools/bench.mjs `longest_task_ms` ≤ 50; robustness.test.ts:61 (progress ends with `<hide>`), :126 "a background read that fails hides the progress overlay and reports the error" | PASS (partial) | Lines moved. Overlay text never asserted on screen. Note: PROGRESS S7.5 records this gate red on this PC (68 / 71 ms, AUDIT PERF-2) |
| WB-13 | "Saved preset found": Cancel / wizard / continue, counts | app.spec:180 "edits by anna and bob on the same workbook are merged…" and :602 "one text toolbar…" (`[data-a="continue"]`); file.spec.ts:25 | PASS (partial) | Lines moved. Only Continue used (many new tests too) |
| WB-14 | No preset → wizard; "x" workbook opens directly at start-up | app.spec:141 (`.wiz` visible); :1329–1330 (Gate.xlsx, no deck → wizard) | PASS (partial) | Start-up direct open still untested |
| WB-15 | Reload from disk (menu, ↻) | open.spec.ts:33 (`#reloadBtn`); app.spec:1466–1467 (↻ reload reads a changed file, chart follows) | PASS | ↻ only; menu entry untested |
| WB-16 | Last folder file reopens at start-up | app.spec:161 "thumbnails are pictures with their tags…" (openApp, `#fileName` = last file), :158 `lastFileSaved`; open.spec.ts:73 "a workbook picked while start-up still reopens the last one stays open (… UX-1)" (new) | PASS | + open.spec:73 (audit-fixes) |
| WB-17 | Last viewed version restored per workbook | – | MISSING | unchanged (`#versionSel` is changed at app.spec:813–815, never reloaded) |
| WB-18 | Hidden sheets never listed; unreadable sheets disabled | robustness.test.ts:243 "…a workbook with only hidden sheets lists none"; host.test.ts:746 (hidden sheet never listed, WB-18, in "hidden data sheets…" describe); core/tests/chart-dl.test.ts:117 (a hidden sheet's range is never a chart) | PASS (partial) | + host.test:746, chart-dl:117 (M8/M9). "Unreadable sheet disabled with its error" untested; GG not effective |
| WB-19 | Number formats (Italian, sections, scaling, %, …, General 11) | core/tests/numfmt.test.ts:6–13 (8 its); parity text-only (GT every corpus cell); core/tests/textfmt.test.ts:8 (TEXT() with Italian codes, new) | PASS | unchanged; textfmt is extra (the TEXT function) |
| WB-20 | Dates: English default, `[$-410]`, minutes vs months, AM/PM, elapsed | numfmt.test.ts:16–19; parity text-only | PASS | unchanged |
| WB-21 | Rich-text superscripts/subscripts | numfmt.test.ts:26; core/tests/excel-dl.test.ts:84; core/tests/glass-dl.test.ts:126; app.spec:784 "versions: …; superscripts" (:789–791) | PASS | Lines moved (772→784). GG/GP not effective |
| WB-22 | "x" marker tables detected | app.spec:141 (slide types :155); host.test.ts:67 "opens a workbook, owns the document and its history…"; parity text-only | PASS | Lines moved |
| WB-23 | Range tables, growing ranges | app.spec:431 "wizard table picker: Shift+arrows select, Enter adds the table"; host.test.ts:197 "summaries, windows, suggestions, cells and table sizes…" (a `grow: true` range at :214); parity text-only | PASS (partial) | Lines moved. Growth itself never asserted |
| WB-24 | Fonts, fills, borders, merges, hidden, CF, pictures (EMF/WMF), shapes, text boxes | excel-dl.test.ts:98, :125, :131, :146, :155, :187; core/tests/slice.test.ts:87; core/tests/tables.test.ts:74, :116; core/tests/xml.test.ts:58; core/tests/colors.test.ts:34 "theme, cell fills and fonts, … carry no markup" (new, SEC-1); parity styles text-only | PASS (partial) | + colors.test (audit-fixes). EMF/WMF via GDI+ untested (test_convert.py:49 only checks the command text); GG/GP/GF not effective |
| WB-25 | Changed on disk → "Reload now" banner | open.spec.ts:33 (`#bannerChanged`) | PASS | unchanged |
| WB-26 | Stable read while Excel is saving (503 + retry) | test_workbooks.py:53 `test_stable_read`, :60, :67; test_http.py:278 `test_incomplete_workbook_is_503` | PASS | Lines moved (255→278) |
| WB-27 | Errors become toasts | robustness.test.ts:126 | PASS (partial) | No test asserts a toast for an error |

### 4.2 Wizard

| Row | Feature (short) | Guard (test title, path:line) | Verdict | Note (change vs features.md) |
|---|---|---|---|---|
| WZ-01 | ✦ Wizard enabled once a workbook is loaded | app.spec:431 "wizard table picker…", :784 "versions: …" (click `#wizardBtn`, :792) | PASS (partial) | Lines moved. Disabled-without-workbook not asserted |
| WZ-02 | 4-step header, clickable back/forward | – | MISSING | unchanged (Next buttons are now located by their text, `[data-a="next"]:has-text("Tables")`, never the header) |
| WZ-03 | ✕/Esc asks "Close the wizard?" | app.spec:442, :898 (`[data-x="close"]` → `.modal [data-a="ok"]`) | PASS (partial) | Lines moved (432→442, 852→898). Esc and the question text untested |
| WZ-04 | Step 1 sheet list (size, chip, N × table, title, range) + linked workbooks' sheets (07 §6.1) | app.spec:880 (`.sheetrow input[value=…]`); host.test.ts:197; linked: app.spec:930 "linked workbooks (S7.3, B22)…" (:938 the row shows "Peers.xlsx") | PASS (partial) | + the linked-file row (07 §6.1 change). Row contents (size, chip, count, title, range) still not asserted |
| WZ-05 | Sheets named "slide" preselected | app.spec:146 (`.wtab` count 3) | PASS | Line moved |
| WZ-06 | Only "slide" / All / None; "N of M · X MB" | – | MISSING | unchanged |
| WZ-07 | "not read yet" for big sheets | – | MISSING | unchanged |
| WZ-08 | Cancel; Next disabled without sheets | – | MISSING | unchanged |
| WZ-09 | Step 2 sheet tabs with counts (+ linked file tab) | app.spec:146, :434 (tab click); :941 (the linked sheet's tab by its file) | PASS (partial) | + linked tab (07 §6.1). Counts not asserted |
| WZ-10 | Sheet preview grid (hidden narrow, "x" marked, clip note) | app.spec:876 "wizard on a sheet larger than the preview…" (:882 `.clipnote`, :883, :894/:897 box within 1.5 px); host.test.ts:226 "a window holds the cells the preview shows…" | PASS (partial) | Lines moved. Hidden-narrow and "x" marking not asserted; no GP |
| WZ-11 | Drag/Shift-click select; arrows, Shift+arrows (skip hidden) | app.spec:431 (Shift+arrows → B3:D5); :801–802 (Shift+click → H10:I11); :895–896 (D5:E6) | PASS (partial) | Lines moved. Drag-select, skipping hidden untested |
| WZ-12 | Enter adds the table; Esc clears | app.spec:438 (Enter → one `.wtrow`, :439) | PASS (partial) | Esc untested |
| WZ-13 | Range box + Add table; invalid flashes | app.spec:930 "linked workbooks…": `#wRange` = C4:G8 + `#wAdd` (:942), the table drawn (:945) and saved (:957) | PASS (partial) | **Changed MISSING → partial**: typing a range and Add table now run. The invalid-range flash is untested |
| WZ-14 | "grows when rows are added below" (E + U growG) | – | MISSING | unchanged (host.test.ts:214 only builds a `grow: true` range for the size check) |
| WZ-15 | Use "x" tables (N) | – | MISSING | unchanged |
| WZ-16 | Add detected tables (N), dashed suggestions | core/tests/detect.test.ts:18 (per corpus workbook), :27 "crafted: blank texts, …"; host.test.ts:197 | PASS (partial) | U only; the button / dashed suggestions e2e missing |
| WZ-17 | Table list (name, ✕, range, grows, size, > 3 000 warning, on N slides) | app.spec:439–441 (`.wtrow` count 1, `.rgin` = B3:D5); host.test.ts:197 | PASS (partial) | Lines moved |
| WZ-18 | Click overlay scrolls to its row | – | MISSING | unchanged |
| WZ-19 | Step 3 table pool | – | MISSING | unchanged |
| WZ-20 | Cover / Index checkboxes | app.spec:148–155 (`#cvOn`, `#ixOn` → slide types) | PASS | Lines moved |
| WZ-21 | One slide per sheet; + New slide | – | MISSING | unchanged |
| WZ-22 | Slide cards: title, subtitle, Logo, ↑ ↓, ✕ | – | MISSING | unchanged |
| WZ-23 | Cover fields | app.spec:149 (`#cvTitle`), :243 (cover text in the PDF) | PASS (partial) | Lines moved. Only the title |
| WZ-24 | Index "with subtitles", logo | app.spec:529–534 (`#ixSubs` on the slide control) | PASS (partial) | Lines moved. Wizard option and index logo untested |
| WZ-25 | Drag tables between slides; ✕ removes | – | MISSING | unchanged |
| WZ-26 | Next · Versions; Save preset & show slides | app.spec:151 (`finish`), :794 (`versions`) | PASS | Lines moved |
| WZ-27 | "Add at least one slide" | – | MISSING | unchanged |
| WZ-28 | Step 4 versions: radio, name, "N removed", ✕ | app.spec:797–809 (3 `.wvrow`, "All" selected, Board `.del`, versions saved) | PASS (partial) | Lines moved. "N removed" not asserted |
| WZ-29 | New version (Enter; duplicates refused); chips | app.spec:795–797 (`[data-addv]`, `#wNewVersion` + `#wAddVersion`) | PASS (partial) | Lines moved. Enter and duplicates untested |
| WZ-30 | Select cells → Remove; cuts with ✕ | app.spec:800–809 (`#wCutRange` H10:I11 → `#wCut` → one `.wcut` → `hide` saved) | PASS (partial) | Lines moved. Removing a cut untested |
| WZ-31 | Sheet tabs with cut counts; ghosts; cuts drawn | – | MISSING | unchanged |
| WZ-32 | Others changed slides → "Discard mine / Save mine anyway" | – | MISSING | unchanged |
| WZ-33 | Wizard result is one undo step (U) | – | MISSING | unchanged (robustness.test.ts:121/:133 apply "Wizard changes" without asserting the history) |

### 4.3 Designs, looks, themes

| Row | Feature (short) | Guard (test title, path:line) | Verdict | Note (change vs features.md) |
|---|---|---|---|---|
| DS-01 | Switch Glass / Excel / Excel Refined, saved and shared | app.spec:180 (bob `[data-design="excel"]` :216 → anna `.slide.excel` :218); :549, :555, :774; parity text-only | PASS | Lines moved. GG/GP not effective. The consulting designs' switch is DS-10 (see 07) |
| DS-02 | Excel adds no decoration of its own; the user's objects drawn in it (B19, 07 §6.1) | core/tests/design.test.ts:57 "Excel is raw: the workbook's colours, whatever the deck's colours say; the user's text boxes drawn (B19, DS-02 since 4.3)"; app.spec:747 "notes section …; raw Excel draws it too (B19)…" (:774–778: memo drawn, `.addnote` present, Comment… and Notes enabled); parity text-only (B19 accepted) | PASS | **Row changed (07 §6.1)**; guards rewritten for the new behaviour (old: "no text boxes", `#commentBtn` disabled) |
| DS-03 | Excel Refined = Excel tables + text boxes, comments, notes | app.spec:551–561 (table markup identical to Excel's); design.test.ts:52 | PASS | Lines moved |
| DS-04 | Liquid Glass recipes | core/tests/glass-dl.test.ts:51 (per deck), :75–:172; design.test.ts:48; tools/dlcheck.mjs (`npm run sp`) | PASS (partial) | unchanged; GG/GP not effective, glass styles accepted text-only |
| DS-05 | Glass strength Subtle/Medium/Strong | glass-dl.test.ts:82 "materials follow --gi…" | PASS (partial) | unchanged; 05's GP per level not effective |
| DS-06 | Background colour slider, one undo step | host.test.ts:67 "opens a workbook, owns the document and its history…" (:109 three `coalesce` applies → one step) | PASS (partial) | Lines moved (97→109). Only radius coalescing |
| DS-07 | Per-design sizing incl. older shared sizing (raw Excel's correction gone with B19) | core/tests/text.test.ts:166 "raw Excel gives text boxes room as the other designs do; a shared scale is the slide's (B19, DS-07 since 4.3)", :177, :184, :191; tables.test.ts:64 | PASS | **Row changed (07 §6.1)**; text.test:166 rewritten (old title "raw Excel is not shrunk by text boxes…") |
| DS-08 | Per-design looks: this design / all designs | app.spec:536–571 (`#lookScope`); design.test.ts:66 | PASS | Lines moved |
| DS-09 | Switching design re-resolves sizes | text.test.ts:177; app.spec:389 "drags on the slide…", :510 (`sizes[design].valign`) | PASS (partial) | Lines moved. No e2e asserts the layout change on a switch |
| DS-10 | Consulting Navy / Red switch, fallback | see 07 table | – | see 07 table |
| DS-11 | Consulting Navy furniture | see 07 table | – | see 07 table |
| DS-12 | Consulting Red furniture | see 07 table | – | see 07 table |
| DS-13 | Consulting tables | see 07 table | – | see 07 table |
| DS-14 | Consulting text boxes, cards, comments, notes | see 07 table | – | see 07 table |
| DS-15 | Consulting cover and contents | see 07 table | – | see 07 table |
| DS-16 | Per-design sizing/looks/text styles in consulting | see 07 table | – | see 07 table |
| DS-17 | Consulting export | see 07 table | – | see 07 table |
| DS-18 | 0 unaccepted parity after M7b | see 07 table | – | see 07 table |
| TH-01 | Design… button with swatch → Colours tab | app.spec:537–538 (`#themeBtn` opens, `#lookScope` shown) | PASS (partial) | Lines moved. Swatch not asserted |
| TH-02 | Scope This design / All designs | app.spec:538, :563–565 | PASS | Lines moved |
| TH-03 | Themes Aurora … Intesa, Custom | app.spec:539, :546; tables.test.ts:99; design.test.ts:38 | PASS (partial) | Lines moved. Ocean, Forest, Sunset, Graphite untested (Ocean only appears disabled in a consulting design, app.spec:986); GP not effective |
| TH-04 | Custom theme: 6 pickers (debounced) | app.spec:543–545 | PASS (partial) | Lines moved. One picker of six |
| TH-05 | "Your colours" per key; unused greyed | app.spec:557–559 (no `head` key in Excel Refined) | PASS | Lines moved |
| TH-06/07/08 | Reset one / all; all-designs scope clears | app.spec:566–571 (`#colorsReset`, disabled after :567–568) | PASS (partial) | Lines moved. Reset one key and the U part untested |
| TH-09 | Overrides in every design | design.test.ts:75 "accent, green/red and background overrides reach every design…", :38; core/tests/design-fallback.test.ts:64 "keep their palette under a shared theme…" (overrides in the consulting designs, TH-09 at :70) | PASS | + design-fallback (M7b). GG/GP not effective |
| TH-10 | Corners 0–200 % | app.spec:377–378 (`radius` 0 saved) | PASS (partial) | Lines moved. GP not effective |
| TH-11 | Contrast 0–100 (Glass) | app.spec:377–378 (`contrast` 80 saved) | PASS (partial) | Lines moved |
| TH-12 | Use as default for new decks | helper/tests/test_http.py:165 `test_config`, :178 `test_config_keeps_a_consulting_design` (new); helper/tests/test_store.py:47, :65, :72; app/tests/api.test.tsx:58 | PASS (partial) | Lines moved (149→165). The `#styleDefault` e2e still missing |
| TH-13 | Wallpaper; contrast baked | robustness.test.ts:269; glass-dl.test.ts:90 | PASS (partial) | Lines moved. GF "2 images per PDF" not gated |
| TH-14 | Colours tab in the consulting designs | see 07 table | – | see 07 table |

### 4.4 Text toolbar, text styles, fonts

| Row | Feature (short) | Guard (test title, path:line) | Verdict | Note (change vs features.md) |
|---|---|---|---|---|
| TX-01 | Target label | app.spec:602 "one text toolbar for cells, titles and text boxes; …" (:609 "No text selected", :613 "Title", :624 /^Cell /) | PASS (partial) | Lines moved. Other targets not asserted |
| TX-02 | Controls disabled without a target | app.spec:610 (`#boldBtn` disabled) | PASS | Line moved |
| TX-03 | Font picker | app.spec:616–619 (Georgia on the title), :625–626 (Verdana on a cell) | PASS (partial) | Lines moved. "Font from Excel" / "Design font" untested |
| TX-04 | A− / A+ steps | – | MISSING | unchanged. `stepSize` moved to app/src/editor/textfmt.ts:146 (was :125); `#sizeDown`/`#sizeUp` never clicked. core/tests/textfmt.test.ts is the TEXT() function, not this. The callout's own A+ (`#shapeLarger`, app.spec:1090–1091) is a separate +2 rule in ShapeTools.tsx:64 |
| TX-05 | Size box in pt, comma accepted | app.spec:614–615 (40 pt → 53.3) | PASS (partial) | Lines moved. Comma untested |
| TX-06/07 | Bold / Italic toggles with state | app.spec:195–205 (Ctrl+B → `{b:true}`, `#boldBtn.on`) | PASS (partial) | Lines moved. Italic not asserted |
| TX-08 | Text colour swatches, Automatic, Custom… | – | MISSING | unchanged |
| TX-09 | Align L/C/R + Auto | app.spec:617–618 (title center), :524 (text box) | PASS (partial) | Lines moved |
| TX-10 | Line spacing (text boxes) | app.spec:731–734 | PASS | Lines moved. GG not effective |
| TX-11 | Paragraph spacing | app.spec:732–733 | PASS | Lines moved |
| TX-12 | Vertical top/middle/bottom | app.spec:523–525 (`valign:"middle"` saved) | PASS (partial) | Lines moved. GG only in 05, not effective |
| TX-13 | Clear format | app.spec:620–621 | PASS | Lines moved |
| TX-14 | Title etc.: click selects, double-click edits | app.spec:612–613 (click → "Title") | PASS (partial) | Lines moved. Double-click editing untested |
| TX-15 | Per-slide text formatting (`fmt`) | text.test.ts:84; app.spec:615–618 | PASS | Lines moved |
| TX-16–TX-18 | Text styles dialog rows and controls | app.spec:628–630 (note row font → `designs.glass.text.note`), :656–657 (Reset) | PASS (partial) | Lines moved |
| TX-19 | Style resolution; invalid values dropped | text.test.ts:78 | PASS | unchanged |
| TX-20 | Larger title pushes subtitle and tables down | text.test.ts:97 | PASS | unchanged |
| TX-21 | Cover, contents, page numbers use text styles | text.test.ts:103; parity text-only | PASS | unchanged |
| TX-22 | Text boxes take the deck style; own settings win | text.test.ts:88 | PASS | unchanged |
| TX-23 | Done/Esc closes | app.spec:648, :654, :658 (`.tsdlg [data-a="close"]`), :568, :990 | PASS (partial) | Lines moved. Esc untested; closing implicit |
| FT-01 | Font menu: search, Default, library, Windows, Google | app.spec:616, :625, :629 (`.fontmenu [data-font=…]`) | PASS (partial) | Lines moved |
| FT-02/03 | Google font added on pick; "+ Add <typed>" | – | MISSING | unchanged |
| FT-04 | Google names previewed | – | MISSING | unchanged |
| FT-05 | Upload .ttf/.otf/.woff/.woff2; variable instanced, CFF kept | app.spec:631–647 (upload → fonts.json; Quicksand static); core/tests/shape.test.ts:42, :80, :260, :274, :293; helper/tests/test_fonts.py:23 `test_upload_list_serve_remove` | PASS | Lines moved |
| FT-06–FT-09 | Manage fonts | app.spec:635, :646–647, :652–653; test_fonts.py:23 | PASS (partial) | Lines moved |
| FT-10 | Library shared, refreshed | app.spec:649–653 (bob sees anna's Corp Sans) | PASS (partial) | Lines moved. 30 s refresh untested |
| FT-11 | Offline: Google remembered locally, upload disabled | – | MISSING | unchanged |
| FT-12/13 | Family/weight/style from file; latin subsets; safe names | text.test.ts:30, :61, :66, :71; test_fonts.py:57 `test_bad_uploads_are_refused` | PASS | unchanged |
| FT-14 | Exports embed the faces used; never Type 3 | app.spec:233–235; file.spec.ts:106; core/tests/dl.test.ts:347; shape.test.ts:225, :239, :260; export-check; app.spec:869–870 (consulting PDFs: `/FontFile2`, no Type 3) | PASS | Lines moved; + consulting PDFs (M7b) |
| FT-15 | Windows fonts captured into the library | core/tests/w13.test.ts:59, :70, :84; app/tests/fontcapture.test.tsx:34, :46, :63, :70; helper/tests/test_sysfonts.py:104, :189 | PASS | unchanged. W13 two-PC test manual |
| FT-16 | Georgia/Arial of the consulting designs; Gelasio | see 07 table | – | see 07 table |

### 4.5 Cell editing

| Row | Feature (short) | Guard (test title, path:line) | Verdict | Note (change vs features.md) |
|---|---|---|---|---|
| CE-01 | Click / drag / Shift+click selection | app.spec:345–346 (click + Shift+arrows → `#nameBox` C5:D6); :456–459 (drag Bank→Note → fill on C4, D4, J4); Shift+click on the slide: app.spec:1727 "cell borders on the slide (S10.3b, B28)…" (:1738–1740 R1 then Shift+click R2 → borders on both cells :1743), app.spec:1025 "charts follow a scenario…" (:1030–1032 → chart source E5:E6 :1038) | PASS | **Changed partial → PASS**: Shift+click on the slide now exercised and its result asserted (M9/M10 tests) |
| CE-02 | Hover highlight | – | MISSING | unchanged |
| CE-03 | Typing starts the editor | app.spec:194–198 | PASS | Lines moved |
| CE-04 | F2 / double-click edits, all text selected | – | MISSING | unchanged (double-clicks at app.spec:1071/:1109 edit callouts, not cells) |
| CE-05 | Inline editor keys | app.spec:194, :596–598 (Enter commits) | PASS (partial) | Lines moved |
| CE-06 | Formula bar: name box, fx (Enter/Esc) | app.spec:346, :358 (`#nameBox`); :1236, :1251 (`#fxInput` shows the selected cell's value, in and after a scenario preview) | PASS (partial) | + `#fxInput` display (M8). Editing in fx (Enter/Esc) still untested |
| CE-07 | ↺ Excel value | – | MISSING | unchanged |
| CE-08 | Del/Backspace clears text | – | MISSING | unchanged (Delete at app.spec:1055/:1481 removes charts / callouts, not cell text) |
| CE-09 | Text edit paused when the Excel value changed (`orig`) | (app.spec:1240–1245: an edit typed during a preview stores `orig` = the workbook's value "1761" and a toast says it shows once cleared) | MISSING | unchanged verdict: the `orig` capture is asserted, the pause after a changed Excel value is not (U + E both absent) |
| CE-10 | Cell colour replaces the fill | app.spec:457–459; tables.test.ts:80; parity text-only `bg` | PASS (partial) | Lines moved. "Colour from Excel" untested; GG/GP not effective |
| CE-11 | Highlight (capsule in Glass) | parity text-only (weekly-options C10 `fill`) | PASS (partial) | unchanged |
| CE-12 | Cell colour becomes the Glass block colour | tables.test.ts:80 | PASS | unchanged |
| CE-13 | Role Auto/Header/Total/Body/Note | design.test.ts:48 (auto roles) | PASS (partial) | unchanged |
| CE-14 | Merge/Unmerge | app.spec:461–464; tables.test.ts:74 | PASS | Lines moved |
| CE-15 | Format painter: single, sticky, Esc | app.spec:466–469 (single use) | PASS (partial) | Lines moved |
| CE-16 | Painter copies … colour scales, + cell gridlines, + borders set on the slide (07 §6.1) | app.spec:471 (`bg`), :494–500 (`cf`, caps drawn); tables.test.ts:116; gridlines: app.spec:1676 "gridlines on selected cells (S10.3, GL-01, GL-02, B20)…" (:1709–1715); borders: app.spec:1727 (:1754–1759) | PASS (partial) | **Row changed (07 §6.1)**; the new parts (GL-02, B28) are guarded. Size, B, I, colour, highlight, align, role, colour scales still untested |
| CE-17 | Painter without selection → toast | – | MISSING | unchanged |
| CE-18 | Selection painting, geometry aware | app.spec:456, :497 (drag-paint on Liquid Glass); core/tests/dl.test.ts:157 "the stage's hits (S4.1)…"; app/tests/hit.test.tsx:8 "drawn cells have their box; an undrawn one has none" (new, consulting exhibit) | PASS | + hit.test (M7b) |
| CE-19 | Click on empty slide clears selection | app.spec:1353 "charts (S9.3, …)" (:1450–1451: a click on the empty slide → `#chartPanel` gone) | PASS (partial) | **Changed MISSING → partial**: an item selection is cleared and asserted; clearing a cell selection is not |
| CE-20 | Status bar describes the selection | (app/tests/renders.test.tsx:65 counts re-renders only) | MISSING | unchanged |
| CE-21 | Typing never overwritten | app.spec:574 "typing is never overwritten…" (:580–598); app/tests/stage.test.tsx:44 | PASS | Lines moved |

### 4.6 Tables

| Row | Feature (short) | Guard (test title, path:line) | Verdict | Note (change vs features.md) |
|---|---|---|---|---|
| TA-01 | W/H boxes | app.spec:347–353 (W 150) | PASS (partial) | Lines moved. H and "…" untested |
| TA-02 | Excel size reset | app.spec:356–365 (`#sizeReset`, one undo step) | PASS | Lines moved |
| TA-03 | Drag column/row border | – | MISSING | unchanged |
| TA-04 | Double-click border = Excel size | app.spec:420–428 | PASS | Lines moved |
| TA-05 | Drag an edge to stretch (0.2–5×) | app.spec:512–516 | PASS (partial) | Lines moved. Limits untested. (Free-layout edge drags, app.spec:1604–1610, are FL-02 – another behaviour) |
| TA-06 | Corner drag scales | app.spec:399–407 | PASS | Lines moved |
| TA-07 | Grip drag next to / above / below | app.spec:409–418 (above) | PASS (partial) | Lines moved |
| TA-08 | Same size | app.spec:338–339 | PASS | Lines moved |
| TA-09 | Position L/C/R and T/M/B | app.spec:340–342, :509–510; tables.test.ts:64, :125 | PASS | Lines moved |
| TA-10 | Gridlines H/V per table + per selected cell (GL-01) + Borders ▾ (B28) (07 §6.1) | app.spec:503–506 (`gridH`/`gridV`); tables.test.ts:106; core/tests/cellgrid.test.ts:44 "H: the cell's top and bottom; V: …", :68 (Outline), :80 (colour, weight), :90 (a border wins), :136/:151/:159 (other designs); core/tests/borders.test.ts:48 "a side set: drawn once, in its style and colour…", :65 ("none"), :99 (separate from gridlines), :115/:122/:129 (designs); cellgrid-fallback.test.ts:15, borders-fallback.test.ts:15 (4.1 pages); app.spec:1676 (GL e2e), :1727 (B28 e2e) | PASS | **Row changed (07 §6.1)**; the new parts have U (display lists) + E. GG/GP not effective |
| TA-11 | Colour scales | app.spec:367–374; tables.test.ts:22, :30, :38 | PASS (partial) | Lines moved. Preview not asserted |
| TA-12 | Colour scale list with ✕ | – | MISSING | unchanged |
| TA-13 | Reset layout (this slide, this design) | app.spec:1494 "free layout (S10.1, FL-01, B18): … Reset layout asks and switches back; one undo step each way" (:1528–1549) | PASS (partial) | **Changed MISSING → partial**: the same `#resetLayout` button (TableTools.tsx:234; free.ts:24 "TA-13") in free mode is tested. The automatic-mode reset (sizing patch) is untested |
| TA-14–TA-18 | Sizes… dialog | – | MISSING | unchanged |
| TA-19 | Layout: bands, k ≤ 2, gaps, fixed scale, `reduced` | tables.test.ts:46, :58, :64; text.test.ts:140, :154, :177 | PASS (partial) | unchanged |
| TA-20 | Hover handles | app.spec:401 (`.hbox .size`), :513 (`.edge.r`), :724 (`.addnote.bottom`) | PASS (partial) | Lines moved. Grip's name label not asserted |

### 4.7 Text boxes and notes section

| Row | Feature (short) | Guard (test title, path:line) | Verdict | Note (change vs features.md) |
|---|---|---|---|---|
| NB-01 | Ribbon ↑↓←→ add a box beside the table | app.spec:327 "table tools: same size, alignment, widths, text boxes, colour scale, Shift+arrows" (:349 `[data-addnote="top"]`); app.spec:481 "painter copies conditional formats; …text box bubble…" (:519 `[data-addnote="bottom"]`) | PASS | Lines moved (317→327, 471→481). ← and → never pressed |
| NB-02 | On-slide + buttons | app.spec:717 "the + button puts a text box there at once…" (:724); :1614 (+ bottom in free layout), :1653 (+ right in raw Excel) | PASS | Lines moved; more uses |
| NB-03 | Toasts "Click a cell first" / "already has a text box" | – | MISSING | unchanged |
| NB-04 | Editor: Ctrl+Enter, Esc, blur | app.spec:327, :717, :747 (Ctrl+Enter commits) | PASS (partial) | Lines moved. Esc / blur untested |
| NB-05 | Empty never-written box removed | – | MISSING | unchanged |
| NB-06 | Select; dbl-click/Enter/F2 edit; Del; Esc | app.spec:481, :717 (click selects), :1649 / :1668 (click selects, then 🗑) | PASS (partial) | Lines moved. Keyboard parts untested |
| NB-07 | Drag freely with snapping guides | app.spec:717 (`.tnote.free` :740); :747 (`.snapline.h` :769, `x` saved :771); free layout: app.spec:1552 "free layout drags (S10.2…)" (:1620–1624) | PASS | Lines moved |
| NB-08 | Stretch by the edges with snapping | app.spec:662 "automated comments: …; text boxes stretch and snap" (:710 `.snapline.h`, :713 gone); :1626–1628 (left edge in free layout) | PASS | Lines moved |
| NB-09 | ⤺ Attach back | app.spec:742–744 (`#noteAttach` → `x` undefined) | PASS | Lines moved |
| NB-10 | ◯ Bubble | app.spec:522 (`#noteBubble`), :526 (`.notebub` count 1); core/tests/slide-dl.test.ts:68 "${design}: every furniture element of v3's slideMarkup has its hit…"; parity text-only | PASS | Lines moved. GG/GP not effective |
| NB-11 | 🗑 deletes | app.spec:1552 "free layout drags…" (:1649–1650 `#noteDelete` → note gone from the doc; :1668–1669 again in raw Excel) | PASS | **Changed MISSING → PASS** (M10 test) |
| NB-12 | ✎ Notes section at the footer position | app.spec:747 (:757 `#slideNotes`, :763 y > 85 %, :769–771 moved and snapped); slide-dl.test.ts:152 | PASS | Lines moved; e2e title now "…raw Excel draws it too (B19); menus open" |
| NB-13 | Markup `#`, `##`, `**bold**`, `[[+12,3]]` | core/tests/comment.test.ts:42; parity text-only; app.spec:662 | PASS (partial) | unchanged |
| NB-14 | Font shrinks to fit (≥ 9 px), HarfBuzz | shape.test.ts:211, :335; slide-dl.test.ts:101, :159; robustness.test.ts (header: NB-14) | PASS | unchanged |
| NB-15 | Left/right as tall as the table | tables.test.ts:46 | PASS | unchanged |
| NB-16 | Span box beside all tables | text.test.ts:140 | PASS | unchanged |
| NB-17 | Free box takes no room | text.test.ts:154 | PASS | unchanged |
| NB-18 | Enabled in every design (B19; 07 §6.1) | app.spec:747 (:776 `.addnote` count > 0 in Excel, :777–778 Comment… and Notes enabled, :775 memo drawn); app.spec:1552 (:1652–1656 a + box added and drawn in raw Excel); design.test.ts:57 | PASS | **Row changed (07 §6.1); partial → PASS**: the old gap (disabled ribbon buttons, tooltip) no longer applies; the enabled behaviour is exercised and asserted |

### 4.8 Automated comments

| Row | Feature (short) | Guard (test title, path:line) | Verdict | Note (change vs features.md) |
|---|---|---|---|---|
| AC-01 | ✎ Comment… for the selected table/box (every design since B19) | app.spec:662 (`#commentBtn` :667 opens the dialog); app.spec:777 (`#commentBtn` enabled in raw Excel) | PASS | **Row changed (07 §6.1)**: guard rewritten (old: disabled in Excel). The dialog is not opened in Excel |
| AC-02 | Table picker for several tables | – | MISSING | unchanged |
| AC-03 | Summary / Detailed; missing `mode` = Detailed | app.spec:668 (`#cmtMode` summary on); parity GT | PASS (partial) | Lines moved. Legacy rule untested |
| AC-04 | Tables in this comment | app.spec:669 (2 checked); comment.test.ts:96; parity GT | PASS | Lines moved |
| AC-05 | "Found:" line | – | MISSING | unchanged |
| AC-06 | Title override | parity GT; comment.test.ts:42 | PASS | unchanged |
| AC-07 | Joins | app.spec:662; comment.test.ts:33; parity GT | PASS (partial) | Quarter, YoY, Other untested |
| AC-08 | Detailed sections; hint when none | comment.test.ts:42; parity GT | PASS (partial) | Hint untested |
| AC-09 | Title / names / bullets switches | comment.test.ts:106; app.spec:662; parity GT | PASS | unchanged |
| AC-10 | Length | comment.test.ts:55; parity GT | PASS | unchanged |
| AC-11 | Name the top 1–5 | comment.test.ts:55, :42; parity GT | PASS | unchanged |
| AC-12 | Ignore below | comment.test.ts:55; parity GT; app.spec:687–688 (`#cmtMin`) | PASS | Lines moved |
| AC-13 | Unit after amounts | comment.test.ts:116; app.spec:684–686 (`#cmtUnit` "mln EUR"); parity GT | PASS | Lines moved |
| AC-14 | Rows noun | parity GT; comment.test.ts:55 | PASS | unchanged |
| AC-15 | Concentration / broad-based / missing rows | comment.test.ts:42; parity GT | PASS | unchanged |
| AC-16 | Rows to include | comment.test.ts:55; parity GT | PASS | unchanged |
| AC-17 | Placement | parity text-only (comments.json per side, `tnote <side> auto`); text.test.ts:140; tables.test.ts:46 | PASS | unchanged. GG not effective |
| AC-18 | Width/height slider; In a bubble | – | MISSING | unchanged |
| AC-19 | Live preview in the current design | app.spec:662 (`#cmtPreview` :670) | PASS (partial) | Lines moved |
| AC-20 | Insert/Update (disabled without groups) | app.spec:662 (`#cmtInsert` :690) | PASS (partial) | Lines moved |
| AC-21 | Also on N similar tables | – | MISSING | unchanged (`#cmtAll` never clicked) |
| AC-22 | Refuses to overwrite user text (U) | – | MISSING | unchanged |
| AC-23 | Remove comment; Cancel; Esc | – | MISSING | unchanged |
| AC-24 | Rewritten at render | app.spec:662 (a typed number changes the note, :703–704); parity GT per version; design.test.ts:85 | PASS | Lines moved |
| AC-25 | Hand edit makes it fixed (toast) | – | MISSING | unchanged |

### 4.9 Versions, cover, contents, page numbers, footer, logo

| Row | Feature (short) | Guard (test title, path:line) | Verdict | Note (change vs features.md) |
|---|---|---|---|---|
| VR-01 | Version picker | app.spec:784 "versions: Chief and All made in the wizard…" (:813–816 All → 4 fewer texts, Full deck → back) | PASS | Lines moved (772→784) |
| VR-02 | Removed cells empty (value, colour, highlight; borders kept); comments ignore them | design.test.ts:85 "cells removed in a version are drawn empty and leave the comments' numbers"; app.spec:784; parity text-only; core/tests/borders.test.ts:109 "a version that removes the cell keeps its borders (VR-02)" (new); core/tests/cellgrid.test.ts:165 "…keeps its gridlines (VR-02: versions keep borders)" (new) | PASS (partial) | "Borders kept" now asserted for borders and gridlines set on the slide (M10). The workbook's own borders and the removed highlight still not asserted; GG not effective |
| VR-03 | Version remembered per workbook | – | MISSING | unchanged |
| VR-04 | Versions defined in wizard step 4 | app.spec:784 (:795–809) | PASS | Lines moved |
| CV-01 | ⚙ Options, Design… link | app.spec:747 (:752–753 `#optBtn` opens, `#pnOn` visible) | PASS (partial) | Lines moved |
| CV-02–CV-09 | Page numbers | parity text-only; slide-dl.test.ts:118, :68; text.test.ts:103; app.spec:754 (`#pnOn`), :765 (`.pageno` drawn) | PASS (partial) | Lines moved. GG not effective; bl/bc/tc, "3"/"p. 3", on cover not in the corpus |
| CV-10–CV-13 | Footer | app.spec:445 "header colour, merge/unmerge, format painter, footer" (:473–477 `#ftOn`, `{workbook}` → "Confidential · report", pos bc); tables.test.ts:90 "footer placeholders"; parity text-only; slide-dl.test.ts:152 | PASS (partial) | Lines moved (435→445). Positions/sizes GG only |
| CV-14 | Logo file + Choose… upload | helper/tests/test_fonts.py:81 `test_logo_found_by_name_case_and_folder_and_uploaded` | PASS (partial) | unchanged. No e2e of `#logoFile` |
| CV-15 | Bubble around the logo | app.spec:574 (:588–590 `#logoBubble` → `logoBubble` false); parity text-only; slide-dl.test.ts:68 | PASS (partial) | Lines moved |
| CV-16 | Hide/show logo per slide | parity text-only (weekly-looks `logo:false`) | PASS (partial) | unchanged. UI toggle untested |
| CV-17 | Missing logo warning | app.spec:327 (:333 `#issues` "Logo “logo.png” not found in the folder"); slide-dl.test.ts:78 | PASS | Lines moved |
| CV-18 | Contents subtitles toggle | app.spec:481 (:531–534 `#ixSubs` → `.ix-s` 0) | PASS | Lines moved |
| CV-19 | Cover: title, subtitle, date, note | parity text-only; app.spec:141 (cover title saved), :223 (:243 PDF page 1 "IBD Weekly"); slide-dl.test.ts:129 | PASS (partial) | Lines moved. Cover note untested |
| CV-20 | Cover/index tags; index lists content slides | app.spec:161 (:165 `.thumb .tag` = cover, index); parity text-only | PASS | Lines moved |

### 4.10 Export

07 §6.1: EX-01…EX-10 and EX-17 each get a PowerPoint twin (PX rows: see 07 table); EX-11 adds scenario names. The
PDF verdicts below are for the PDF behaviour; the PowerPoint guards are listed for reference.

| Row | Feature (short) | Guard (test title, path:line) | Verdict | Note (change vs features.md) |
|---|---|---|---|---|
| EX-01 | Export PDF (remembered mode, vector), spinner | app.spec:223 "export writes a PDF into the shared export folder" (vector first, "(images)" remembered :253); tools/bench.mjs "export deck20"; PX twin: file.spec.ts:110–113 (.pptx download), app.spec:859–865 (`pptx-current`, `pptx`, `both`) | PASS (partial) | Lines moved. Spinner not asserted. PX: see 07 |
| EX-02 | PDF · text & tables (vector) | app.spec:223 (`/Font`, `/ToUnicode`, no Type 3 :233–235; texts); tools/dlcheck.mjs; export-check | PASS | Lines moved. Corpus SP not effective here |
| EX-03 | PDF · as pictures (B9) | app.spec:223 (:253 `pdf-exact` → "report - slides (images).pdf", pages 3200×1800); core/tests/export.test.ts:154 "pictures and PNGs come from the rasteriser…" | PASS | Lines moved (153→154) |
| EX-04 | PDF · current slide | app.spec:223 (:264 `pdf-current` → 1 page) | PASS | Lines moved |
| EX-05 | Copy current slide (PNG to clipboard) | app.spec:277 "PNG of the current slide and of every slide; the current slide copied to the clipboard" (:293–298); app.spec:965 (:1018–1020, 4800×2700 in Consulting Red) | PASS | Lines moved; + consulting |
| EX-06/07 | PNG current / every slide | app.spec:277 (:289 `png-all`); app.spec:1015–1017 (Consulting Red PNG 4800×2700) | PASS | Lines moved. GP not compared |
| EX-08–EX-10 | Every version (this design; × Glass + Excel; × all three) | app.spec:784 (:817–843: `versions-2` "Saved 4 PDFs" :821, `versions-3` "Saved 6 PDFs" :825 with 3 workers :826, `versions` :828, `versions-5` "Saved 10 PDFs" :843); app/tests/export-pool.test.ts:41; PX twin: app.spec:844–857 ("Saved 8 files" :847) | PASS | Lines moved; + five designs and PowerPoint twins (07 §6.1) |
| EX-11 | File names; locked target " (2)"; + scenario names (07 §6.1) | helper/tests/test_exports.py:25 `test_locked_target_gets_a_suffix`, :91 `test_export_file_open_target_gets_a_suffix`, :80, :98, :63 `test_export_file_saves_pptx` (new); scenario names: app.spec:1258 "Run for each value (S8.3, …)" (:1285–1287 "<value> - <design>.pdf", :1300–1301 "12 (2) - Excel.pdf"); host.test.ts:562, :613 "values that display alike get (2)…", :644 "a name the helper gave a file open elsewhere (" (2)")…" | PASS | **Row changed (07 §6.1)**: scenario names guarded (M8). Lines moved (test_exports 23→25, 72→91, 61→80, 79→98) |
| EX-12 | Toast with Open / Show folder | app.spec:223 (:228 toast contains the file name) | PASS (partial) | Lines moved. Buttons not clicked (`#scOpenFolder` visible in a scenario run report, :1322, is another dialog) |
| EX-13 | ~~In-window fallback~~ (removed, B1) | app.spec:223 (no `pdf-old`, POST /api/export → 404); helper/tests/test_http.py:310 `test_engine_routes_are_gone` | PASS | Lines moved (287→310) |
| EX-14 | PNG download in the browser | file.spec.ts:95 "opened from file://: exports are downloads (PDF with the PC's fonts, PNG)" | PASS | unchanged |
| EX-15 | Pending edits flushed before export | app.spec:223 (:247–249 "Gammax" typed then in the PDF) | PASS | Lines moved |
| EX-16 | Export works offline (download) | file.spec.ts:95 (:106 `/FontFile2`), :128 "opened from file:// without access to the PC's fonts…" | PASS | Line moved (123→128) |
| EX-17 | Version export progress, "Saved N PDFs" (+ "Saved N files") | app.spec:784 (:821, :825, :843 "Saved N PDFs"; :847 "Saved 8 files") | PASS (partial) | Lines moved. The progress text is still not asserted |
| EX-18 | One 16:9 page per slide; vector; real fonts; small | app.spec:223; core/tests/dl.test.ts:282; export-check; sp | PASS | Lines moved |

### 4.11 Collaboration, undo, keyboard, side panel, status

| Row | Feature (short) | Guard (test title, path:line) | Verdict | Note (change vs features.md) |
|---|---|---|---|---|
| CO-01 | Field-level merge of concurrent edits | app.spec:180 "edits by anna and bob on the same workbook are merged, and each sees the other"; core/tests/ops.test.ts:7, :20 (OV vectors); core/tests/docsync.test.ts:19, :63; core/tests/convergence.test.ts:107; helper/tests/test_decks.py:321, :374 | PASS | Lines moved (convergence 97→107, test_decks 249→321, 302→374) |
| CO-02 | Others' changes appear (≤ 2 s typical) | app.spec:180 (bob sees "Alfa" within 10 s); tools/loadtest4.py --ci (visible p95 < 4 s) | PASS | unchanged; the 2 s target itself is not asserted |
| CO-03 | "Updated by <name> just now / N min ago" | app.spec:202–203 (`#sbRemote`); docsync.test.ts:104 | PASS (partial) | Lines moved. Wording not asserted |
| CO-04 | Presence avatars, "X is also here", "(another window)" | app.spec:190–191 (`#presence`) | PASS (partial) | Lines moved |
| CO-05 | Presence heartbeat 10 s; leave on pagehide | helper/tests/test_http.py:193 `test_presence_between_two_clients`; test_decks.py:622 `test_presence_v2` | PASS (partial) | Lines moved (170→193, 550→622). Page heartbeat / pagehide untested |
| CO-06 | Stage never redraws under an open editor; drafts kept | app.spec:574 (:580 `#ftText` "Draft for", :596 "Lamb"); app/tests/stage.test.tsx:44 | PASS | Lines moved |
| CO-07 | Config defaults re-read ≈ 30 s | – | MISSING | unchanged |
| CO-08 | Others' preset changes rebuild slides, keep current slide | app.spec:327 (bob's text box appears on anna's slide 3) | PASS (partial) | Lines moved |
| UN-01 | Undo/Redo buttons | `#undoBtn` clicked and its effect asserted: app.spec:1061 "callouts (S9.4, …)" (:1092–1093); app.spec:1353 "charts (S9.3, …)" (:1421–1422, :1431–1432, :1445–1446, :1459–1460, :1484–1486); app.spec:1494 "free layout (S10.1…)" (:1522–1526, :1543–1547); app.spec:1676 (:1719–1720); app.spec:1727 (:1752–1753) | PASS (partial) | **Changed MISSING → partial**: the Undo button is tested (M9/M10); `#redoBtn` is never clicked |
| UN-02 | Undo only my own changes | app.spec:180 (:209 Ctrl+Z: C6 gone, bob's bold kept); ops.test.ts:50; docsync.test.ts:114; host.test.ts:129 "two people: each sees the other's change, and undo reverts only one's own" | PASS | Lines moved (host 117→129) |
| UN-03 | Toast "Undo: <label>" | – | MISSING | unchanged |
| UN-04 | Slider drags coalesce | host.test.ts:67 (:109 three radius applies → one step) | PASS | Lines moved. 1.5 s expiry untested |
| UN-05 | Undo stack 200, redo cleared, per workbook | robustness.test.ts:255 "keeps the last 200 steps, and a new change clears redo"; host.test.ts:156 | PASS | Lines moved (254→255, 144→156) |
| KB-01–KB-25 | Every shortcut (05: one table-driven e2e per shortcut) | see the per-shortcut table below | PASS (partial) | unchanged verdict: still no table-driven test. 8 of 24 groups PASS, 3 partial, 13 MISSING (was 7 / 4 / 13) |
| SP-01–SP-15 | Side panel issues (+ Formulas line, chart/callout source not found, linked workbook missing, TEXT cells; 07 §6.1) | parity text-only (issues.json exact per corpus slide); app.spec:161 (tags :165); app.spec:327 (:333 logo not found); new lines: app.spec:930 (:948–954 `#calcLine` "Formulas: …", "3 with TEXT in Italian, formatted by Slide Builder"); app.spec:1061 (:1113 "Callout 1: Nowhere!B2 not found (shown as #REF)"); app.spec:1353 (:1471 "Chart 1: source Numbers!B9:B11 not found", :1478 gone after reload); core/tests/chart-dl.test.ts:209; core/tests/shape-dl.test.ts:115; app.spec:922 (`#deckHealth` snapshot line) | PASS (partial) | **Row changed (07 §6.1)**: three of the four new lines asserted. "Linked workbook missing" is not (host.test.ts:474 only checks the table is missing). Old gaps unchanged (error values, small text, unreadable pictures, paused edits, custom layout, "grows", badges, "SLIDES N") |
| SB-01–SB-13 | Status bar | every e2e waits on `#sbSave` "✓ Saved"; file.spec.ts:25 ("Saved in this browser only", `#bannerOffline`); docsync.test.ts:28, :356 "409 on append: no retries…", :367 "a snapshot in a newer format (409 on read)…", :219 "a read-only deck takes no change…" (new, DATA-4); open.spec.ts:33 (`#bannerChanged`); app/tests/stage.test.tsx:105 | PASS (partial) | Lines moved (docsync 345→356, 356→367); + read-only state. Same gaps (selection text, retry back-off, health 6 s, zoom, toast actions) |
| OF-01–OF-06 | Offline `file://` | file.spec.ts:25, :66, :95, :128 (+ :110–113 .pptx download) | PASS (partial) | Line moved (123→128). Prefs / fonts in localStorage, no folder list / uploads not asserted |

#### KB-01–KB-25 per shortcut

| Shortcut | Pressed by (path:line) | Effect asserted? | Verdict | Change |
|---|---|---|---|---|
| Ctrl+Z | app.spec:209 (C6 gone), :364, :396, :176, :974–975, :1002–1003; file.spec.ts:48 | yes | PASS | lines moved; more uses |
| Ctrl+Shift+Z | – | – | MISSING | – |
| Ctrl+Y | file.spec.ts:50 ("Alfa" back) | yes | PASS | – |
| Ctrl+S | – | – | MISSING | – |
| PgUp / PgDn | – | – | MISSING | – |
| Alt+↑ / Alt+↓ | – | – | MISSING | Alt held during free-layout drags (app.spec:1562) is not this shortcut |
| Esc (stops the painter) | app.spec:461 presses Escape before a drag, not asserted | no | MISSING | – |
| Ctrl+B | app.spec:195 (C8 `{b:true}`, `#boldBtn.on` :205); :909, :925 | yes | PASS | lines moved |
| Ctrl+I | app.spec:594 (bob) | only implied | PASS (partial) | line moved |
| Enter/F2/Esc/Del on slide text | – | – | MISSING | – |
| Enter/F2/Esc/Del on text boxes | – (Ctrl+Enter only) | – | MISSING | Delete on callouts / charts (app.spec:1055, :1481, :1647) belongs to the 07 CL/CH rows |
| Ctrl+A (app: select all) | only inside text inputs (app.spec:580, :684, :689) | not the app's | MISSING | – |
| Arrows (move the cell) | app.spec:703 (ArrowRight ×5) | no | MISSING | – |
| Shift+arrows | app.spec:345 / :357 (`#nameBox` C5:D6) | yes | PASS | lines moved |
| Tab / Shift+Tab | app.spec:1160 presses Tab inside the scenario dialog (the stage must not act) | no (cell Tab) | MISSING | – |
| Enter / Shift+Enter | Enter commits (app.spec:194, file.spec.ts:40) | commit yes; moving down / Shift+Enter no | PASS (partial) | – |
| F2 (cell) | – | – | MISSING | – |
| Del (cell) | app.spec:1160 checks Delete does nothing to the cell while a dialog is open | no | MISSING | – |
| Printable key starts editing | app.spec:194 | yes | PASS | – |
| Inline editors | app.spec:592–598 | yes | PASS | – |
| fx (formula) bar | app.spec:1236 / :1251 read `#fxInput`; no key pressed in it | no | MISSING | – |
| W / H boxes | app.spec:347 (W 150 + Enter) | W yes, H no | PASS (partial) | – |
| Dialogs (Esc / Enter) | app.spec:1164–1165 (Enter presses the focused button → the range view shows); :1227–1228 (Esc closes the scenario dialog, asserted); :1373–1374, :1390–1391 (Esc in the cell picker: closes / goes back a step); :377–385 (Esc closes Options); :311 (Enter in the feedback textarea = new line); app/tests/dialog.test.tsx:12 | yes | PASS | **partial → PASS** (M8/M9 tests assert Esc and Enter) |
| Wizard keys | app.spec:431 "wizard table picker: Shift+arrows select, Enter adds the table"; app.spec:876 (:895); the scenario cell view's Enter takes the cell (app.spec:1145–1147) | yes | PASS | lines moved |

### 4.12 Install, start, update, data

| Row | Feature (short) | Guard (test title, path:line) | Verdict | Note (change vs features.md) |
|---|---|---|---|---|
| IN-01 | Install finds `py -3`/`python` | – | MANUAL | 05: W |
| IN-02 | Banner: version, user, host, folder, "safe to run again" | – | MISSING | unchanged (test_firstrun.py:176 asserts step lines, not the banner) |
| IN-03 | Python ≥ 3.8, bitness | helper/tests/test_firstrun.py:41 `test_versions` | PASS (partial) | unchanged. Bitness not asserted |
| IN-04/05/06 | pip / Playwright / engine (removed, B1) | test_firstrun.py:176 `test_install_twice_is_safe`, :231 `test_engine_installer_is_gone` | PASS | unchanged |
| IN-07 | Shared-folder check + journal append/flush | test_firstrun.py:104, :112, :119, :128, :142, :157, :168 | PASS | unchanged. + W |
| IN-08 | Desktop shortcut `.lnk`/`.bat`, UNC pushd | test_firstrun.py:56, :71, :76, :81 | PASS | unchanged. + W6 |
| IN-09 | Self-test + read every deck read-only | helper/tests/test_main.py:200 `test_passes_and_writes_nothing`, :216 `test_fails_on_unreadable_or_too_new`, :227 `test_fails_when_the_folder_refuses_writes`; test_firstrun.py:216, :209 | PASS | Lines moved (168→200, 184→216); + :227 |
| IN-10 | OK/WARN/FAIL lines, exit code, ASCII, idempotent | test_firstrun.py:176, :202, :119; test_main.py:200 | PASS (partial) | Lines moved. Install output ASCII not checked |
| IN-11 | Start: helper; on failure run Install | – | MANUAL | 05: W |
| IN-12 | Port 8765 (+20); already running → open the browser | test_main.py:24 `test_start_ping_and_second_start`, :61 `test_same_major`, :69 `test_skips_a_port_with_another_major_version`, :91 `test_a_free_port_is_found_free_at_once` (new) | PASS | + :91 |
| IN-13 | v2 settings import | helper/tests/test_migrate.py:56, :107, :129, :138, :159, :164 | PASS | unchanged |
| UP-01–UP-10 | Update | helper/tests/test_update.py:95, :128, :150, :156, :217, :283, :310, :347, :371, :397, :425, :436; helper/tests/test_release.py:81 | PASS (partial) | unchanged. Last-5 backups not asserted; W7 manual |
| DA-01 | Every saved v3 format readable, upgraded once | helper/tests/test_upgrade.py:69, :92, :131; helper/tests/test_migrate_v3.py:150; core/tests/ops.test.ts:131 "the snapshot and the records past its frontier fold into the deck…" | PASS | ops.test line moved (75→131) |
| DA-02 | Newer files refused | test_upgrade.py:153; docsync.test.ts:367; test_main.py:216 | PASS | Lines moved |
| DA-03 | v3 ↔ v4 coexistence, cut-over, rollback | test_migrate_v3.py:185, :221, :263, :408; test_update.py:183; app.spec:901 "Prepare rollback: every deck's changes folded into its snapshot…" | PASS | Line moved (855→901) |

### Spot-checks (cited lines opened at d83e9dd)

Opened with `git show d83e9dd:<file>`  or Read, and matched against the claim (well over
15): app.spec :141, :146, :149, :151, :155, :165, :176, :195, :205, :209, :216, :218, :228, :233, :235, :243,
:247–249, :253, :264, :289, :311, :333, :349, :358, :377, :385, :396, :401, :409, :420, :434, :438, :441, :442,
:457, :464, :469, :494, :497, :500, :513, :519–534, :537, :549, :563, :566, :580, :588–590, :594, :596, :609, :624,
:628, :631, :647, :649, :656, :667–690, :703, :710–713, :724, :731, :740–744, the whole tests at :747, :784, :876,
:930 and every test from :965 to :1772 (read in full); open.spec :22–23, :52, :73; file.spec :48, :50, :106,
:108–113, :128; core: design.test :57, :85; text.test :166; design-fallback :58–72; host.test :67, :109, :129, :147,
:156, :197, :214, :226, :474–487, :562, :613, :644, :735–760; ops.test :20, :131; robustness :121, :255; docsync :28,
:104, :219, :356, :367; convergence :107; export.test :154; chart-dl :115–130, :209; shape-dl :115; borders :48,
:105–113; cellgrid :136, :160–172; hit.test.tsx :1–16; export-pool :41; dialog.test :12; helper: test_exports (every
test name), test_http :165, :178, :193, :310, :341, test_decks :321, :374, :622, test_main (every test name),
test_convert.py (whole file); app/src/editor/textfmt.ts:146, Ribbon.tsx:71/:74, ShapeTools.tsx:64, TableTools.tsx:234,
app/src/editor/free.ts:24. Every one matched its claim. Lines not opened individually (unchanged files whose numbers
features.md gave at 4df923b and `git diff` shows untouched: numfmt, excel-dl, glass-dl, tables, comment, slide-dl,
shape, dl, w13, fontcapture, test_firstrun, test_update, test_upgrade, test_migrate*, test_sysfonts, test_fonts,
test_store, test_workbooks) are carried over through the diff mapping (`maprows.out`).
