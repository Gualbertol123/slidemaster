# AUDIT-2 · Slide Builder 4.2–4.5 against `07-scenarios-charts-pptx.md`, `PLAN.md` and `05-test-and-parity.md`

Independent audit of the four releases built since AUDIT.md (4.2 scenario export, 4.3 charts and callouts, 4.4 free
layout / gridlines / borders / composable looks, 4.5 PowerPoint), 2026-10-20. Audited commit **d83e9dd** (`main` =
`origin/main`, the merge of M11, versions 4.5.0); fixes on branch **`v4/audit-2-fixes`** (one commit per finding,
§8). Read: AUDIT.md (its §0 is this audit's method), `07-scenarios-charts-pptx.md`, `08-consulting-designs.md` §2.8 /
§4, `PLAN.md` Parts A–F (B1–B29), `05-test-and-parity.md` §4 and 07 §6.1–§6.4, `README.md`, `docs/ARCHITECTURE.md`,
`PROGRESS.md` (Steps M7–M11, Decisions, Waiting for), `CHANGELOG.md` 4.2.0–4.5.0.

## Summary verdict

**Not yet for the share: 4.2–4.5 meet 07's design and PLAN's rules almost everywhere and every test suite is green
twice on clean clones, but the audited commit loses users' charts, callouts, free layouts, slide looks, gridlines and
borders when a Slide Builder 4.0 or 4.1 page compacts the deck – and 4.0.0 is what runs on the share today.** The
general defect (a page compacts records it does not understand) is fixed on `v4/audit-2-fixes` for every later
version; 4.0 / 4.1 themselves cannot be changed, so the rollout of 4.5 needs a rule or one more safeguard before it
reaches the share (§8 DATA-7, REL-1). Two more things need people before a release: the third-party licence notices
that no page or ZIP ships (LIC-1), and the open gates G5 and the M7b final sign-off.

What holds, with evidence below:
* **Build and tests are reproducible.** Two clean GitHub clones of d83e9dd, two complete runs of AUDIT §0's protocol:
  page equal to the committed one, `npm run check` 816 + 44, helper 238 on Python 3.12 **and** 3.8, e2e 37, parity /
  dlparity 0 not accepted, dlcheck 8/8 + negative control, load 5/5 PASS 0 lost, export-check **70 PDFs + 75
  PowerPoint files** (pptxcheck, PowerPoint 16 opened every file, GT equal, chart values = the workbook's cells), PDFs
  and PowerPoint × design × version **15 + 15** – identical in both runs except the load-sensitive bench numbers (§1).
* **Data safety of the new features:** a scenario run of 20 values (40 files) while a second user edits changes
  neither workbook, nor the runner's journal, nor the document (only the other user's edits arrive); a missing linked
  workbook leaves the deck readable and whole; a damaged or cut `.pptx` is refused and never left in `export\` (§6).
* **Architecture:** one owner per state (the engine model, the scenario overlay and linked workbooks only in the core
  worker; the page's copies are documented mirrors), op semantics only in `ops.ts`, no DOM types in `core/`, no native
  executable, a standard-library helper, eight display-list node types in every design (§5).
* **Feature rows:** the 33 rows of 07 §6.2 (+ 14 consulting / B28 / B29 rows) all have an automated guard (27 PASS,
  20 partial, 0 MISSING); 05 §4: 105 PASS, 96 partial, **48 MISSING**, 2 MANUAL of 251 – 7 rows better than AUDIT, none
  worse (§2, appendix [`audit/features-2.md`](audit/features-2.md)).
* **Budgets:** every Part F and 07 §6.4 budget met on the quiet run (calibration ×1.02), the new ones with wide margins
  (a 20-value run 3.2 s of 40; PowerPoint deck20 0.5 s of 3); helper start → page ready 847 ms (§4).
* **Documentation:** 26 of 30 random statements true, 4 partly, 0 false – but outside the sample README still says
  three designs and "formulas are not recalculated" (§7).

| Severity | Finding | State |
|---|---|---|
| **high** | DATA-7 a 4.0 / 4.1 page compacts a 4.5 deck and its charts, callouts, free layout, looks, gridlines and borders are gone for everybody (reproduced with the real 4.1 helper and page) | fixed for later versions (af0a729); 4.0 / 4.1 → REL-1 |
| **high** | REL-1 the share runs 4.0.0, nothing stops a running 4.0 helper after an update, and `--use 4.0.0` stays allowed | needs a decision (§8) |
| **high** | LIC-1 no third-party licence notice ships (React, zustand, fflate, IronCalc, HarfBuzz) | proposal |
| medium | GATE-1 G5 (scenario export) and the M7b final sign-off are open; G8 was signed off orally (recorded now) | people |
| medium | BEH-3 four visible 4.2 changes after G5's real-deck fixes are not in the CHANGELOG | proposal |
| medium | LIM-1 a shrinking FILTER spill gives #VALUE!, the unsupported list and the 2-sheet whole-column case are not told to users; CHANGELOG 4.2 says "every formula" | proposal |
| medium | VER-3 48 05-rows still MISSING; 20 new rows partial (PowerPoint's "opened" and "real table" counted, never gated) | proposal |
| low | SEC-6 / SEC-7 (AUDIT, open) long export names → 404 "not found"; `CON.pptx` accepted | fixed (cc217c3, 9c60077) |
| low / info | DOC-A…K, BEH-4…7, ARCH-1…6 | proposals (§8) |

What this audit could not prove and leaves to people (§9): PowerPoint 2016 on a corporate PC (W15 / G8's own check),
Acrobat (W14), the real share with several PCs, G5 on a real deck, geometry / pixel parity outside the consulting
designs (this PC runs parity text-only), and the W rows of G0.

---

## 0. Method

* Clones: `git clone https://github.com/Gualbertol123/slidemaster.git` twice into `%TEMP%\sb-work\m12\r1`, `r2`
  (`main` = d83e9dd, = the local checkout). After the fixes: `git clone -b v4/audit-2-fixes <local checkout>` twice
  (`f1`, `f2`; the branch is not pushed).
* Each run executed the same script (`audit2.sh`; README §11 order; every step runs even when one fails), with Node
  22.23.3 (portable, `NODE_OPTIONS=--use-system-ca`), Python 3.12.7 and 3.8.10 (embeddable), Playwright Chromium,
  qpdf 12.4.2, python-pptx and openpyxl, PowerPoint 16 (this PC's Office):

  | # | Step | Command |
  |---|---|---|
  | 1–4 | install, build, fresh page | `npm ci` · `npx playwright install chromium` · `npm run build` · `git diff --exit-code -- helper/slide_builder.html` |
  | 5 | big30 | `python tools/make_corpus.py big30 tests/corpus/workbooks` |
  | 6 | check | `npm run check` |
  | 7–8 | helper | `python -m unittest discover -s helper/tests` on 3.12 and on 3.8 |
  | 9 | e2e | `npm run test:e2e` |
  | 10–12 | parity | `npm run parity` · `npm run dlparity` · `npm run sp` |
  | 13 | bench | `npm run bench -w core` · `npm run bench -w app` · `node tools/bench.mjs` (each on its own: a failing core gate stops `npm run bench`) |
  | 14 | load | `python tools/loadtest4.py --ci` |
  | 15 | PDFs and PowerPoint × design | `npm run export-check` (14 decks × 5 designs as PDF; the same + the chart corpus as `.pptx` through `tools/pptxcheck.py`: structure, lint, PowerPoint 16 opening each file, texts against the goldens, chart caches against the workbook) |
  | 16 | PDFs and PowerPoint × design × **version** | audit script `audit-export.mjs`: weekly-options × 5 designs × {full, Chief, All}, each exported with Export and Export ▾ › PowerPoint; each PDF through `pdfcheck.py check`, a separate `qpdf --check` (exit code and warnings) and its version's golden texts; each `.pptx` through `pptxcheck.py` (incl. PowerPoint) and the golden texts |
  | 17 | helper start | 7 × spawn helper → `GET /` 200 (and, in §4, Chromium showing `#openBtn`) |
* Read-only reviews (05 rows, 07 rows, behaviour 4.1 → 4.5, architecture and licences, documentation) were run by
  sub-agents; every finding kept here was re-checked by the auditor against the code (e.g. `grep "Discard mine"`,
  `#redoBtn`, `stepSize`, the page for licence texts, `engine.test.ts:25-29`), and every fixed one was reproduced
  first. Experiments against real helpers (`attack2.py`, `compat41.mjs`, `scenario2u.mjs`) are described in §5–§6.
  The audit scripts are not committed (they live in `%TEMP%\sb-work\m12` and the session's scratch folder).

## 1. Build and tests (two clean clones of d83e9dd)

| Step | Run 1 (r1, 09:04–10:09) | Run 2 (r2, 10:09–10:59) | Same? |
|---|---|---|---|
| `npm ci` · build · page fresh | ok 50 s · ok · **equal** | ok 41 s · ok · **equal** | yes |
| big30 | made | made | yes |
| `npm run check` | core 816 passed (52 files), app 44 passed (10 files) | 816 · 44 | yes |
| helper, Python 3.12.7 | 238 OK (1 skipped: `test_http` 501-off-Windows), 311 s | 238 OK (same skip), 233 s | yes |
| helper, Python 3.8.10 | 238 OK (same skip), 250 s | 238 OK, 237 s | yes |
| e2e | **37 passed**, 13.0 min | 37 passed, 4.6 min | yes (run 1 shared the PC with the audit's read-only reviews and experiments) |
| parity | 11,061 differences, **0 not accepted** (text-only; consulting designs: full) | the same | yes |
| dlparity | 11,065 (style 11,051, pixels 4, text 5, elements 5), **0 not accepted** | the same | yes |
| sp (`tools/dlcheck.mjs`) | 8/8 node types + negative control detected | the same | yes |
| bench | core: **FAIL** `big30` parse 684 ms (limit 589) – the audit's two-helper experiment (§6) ran at the same time; engine first use 242 ms, one value 109.5 ms; page: every gate within, `read_big30` 1,153 and `longest_task` 55 within the +10 % slack (×1.05) | core: every gate within (parse 381 / 397 / 354 ms; first use 231 ms, one value 43.3 ms); page: **every gate within** (×1.02) | **differs** (§4) |
| load `--ci` (save p50/p95 · visible p50/p95 ms) | same 15 ms 38/58 · 1242/1981; same 40 ms 90/113 · 1374/2176; different 89/113; burst 37/56 · 1235/1979; compaction 92/113 · 1467/2298 (gens 2, 3, 4) – **5/5 PASS, 0 lost** | 48/60 · 1238/1989; 98/115 · 1411/2199; 95/115; 41/57 · 1242/1987; 91/112 · 1465/2279 – 5/5 PASS, 0 lost | yes (every difference ≤ 10 ms / 2 %, save p50 at 15 ms ±10 ms) |
| export-check | **70 PDFs**: pdfcheck + qpdf ok, GT 70 equal (3 slides by B19's rule); 12 one–two-slide decks over the per-slide size (reported, not gated – decision 2026-10-13). **75 PowerPoint files**: pptxcheck ok 75, **opened in PowerPoint 16 75**, GT 75 equal, chart caches = the workbook's cells; deck20 Glass 509 KB / 809 ms, Excel 140 KB / 499 ms, Navy 286 KB / 473 ms, Red 218 KB / 475 ms | the same 70 / 75 / 75 / 75, the same sizes; 824 / 480 / 498 / 446 ms | yes |
| PDFs and PowerPoint × design × version | **15 PDFs**: pdfcheck ok, `qpdf --check` exit 0 without warnings 15, GT of its version 15; **15 `.pptx`**: pptxcheck ok 15, opened in PowerPoint 15, GT 15 | 15 / 15 / 15 · 15 / 15 / 15 | yes |
| helper start → `GET /` 200 (7 starts) | 729–762 ms | 719–776 ms | yes |

Differences between the runs: only the bench's load-sensitive numbers – run 1 shared the PC with the audit's own
experiments (the core parse gate and the engine's one value, 109.5 vs 43.3 ms). Step 16's first pass in run 1 reported
GT failures that were the audit script's own (it chose a version by its name, the page by its id, and compared the
PowerPoint texts with the PDF's text order); the corrected script passed on run 1's clone (15 + 15) and in run 2.

## 2. Features (05 §4 and 07 §6.2)

Every row is in **[`audit/features-2.md`](audit/features-2.md)** with its guard (test title, path:line) and verdict.
The guarding suites passed in all runs, so a row with a real guard PASSes.

**07 §6.2 (and the consulting / B28 / B29 rows):**

| Code | Rows | PASS | PASS (partial) | MISSING | MANUAL |
|---|---|---|---|---|---|
| RC recalculation | 6 | 2 | 4 | 0 | 0 |
| LK linked workbooks | 3 | 2 | 1 | 0 | 0 |
| SC scenario export | 9 | 7 | 2 | 0 | 0 |
| CH charts · CL callouts | 6 | 6 | 0 | 0 | 0 |
| FL free layout · GL gridlines | 5 | 4 | 1 | 0 | 0 |
| PX PowerPoint | 4 | 2 | 2 | 0 | 0 (PX-02 has a manual part: W15) |
| DS-10…18, TH-14, FT-16 (consulting), TA-10 / CE-16 (B28), B29 | 14 | 4 | 10 | 0 | 0 (7 have a GP part) |
| **All** | **47** | **27** | **20** | **0** | **0** |

What the partial rows leave unguarded (finding VER-3): RC-02 asserts only the sum of the self-check classes, not the
per-class counts the row names (and its locale count is out of date: 0 since M8); RC-04 has no INDIRECT case although
its test title names it (`core/tests/engine.test.ts:64`); RC-05 nothing asserts the engine is not loaded on open;
RC-06 no unsupported function turned into an error cell, and the Issues line is not asserted; LK-03 the "not found in
the folder" Issues line is asserted nowhere (unit test only, `host.test.ts:474`) – §6 shows it by experiment;
SC-06 "failed with reason" unit-only; SC-09 the 3 s gate includes the engine's first use; FL-02 no test moves or
resizes a chart in free layout; **PX-02** pptxcheck's PowerPoint step is skipped without failing when PowerPoint is
absent (`tools/pptxcheck.py:463`) and its result is never gated (`tools/export-check.mjs:217`; CI runs `--no-ppt`);
**PX-03** python-pptx's `has_table` is counted, never gated (`pptxcheck.py:296`, `export-check.mjs:216`) – real tables
are asserted only as `<a:tbl>` in two tests (`core/tests/pptx.test.ts:314`, `app/e2e/app.spec.ts:853`); DS-11–14 parts
held only by snapshots; DS-16 no e2e of sizing / text styles / Reset in a consulting design; TH-14 only the positive
colour; FT-16 the Gelasio stand-in for Georgia untested; TA-10 (B28) only Outside / No border / Clear exercised;
CE-16 no painter unit test; B29 *Apply to all* of the text formats and a ribbon text-format edit unasserted.

**05 §4:**

| Area | Rows | PASS | PASS (partial) | MISSING | MANUAL |
|---|---|---|---|---|---|
| 4.1 WB · 4.2 WZ | 60 | 14 | 26 | 20 | 0 |
| 4.3 DS · TH | 20 (+10 in 07's table) | 8 | 12 | 0 | 0 |
| 4.4 TX · FT | 30 (+1) | 13 | 12 | 5 | 0 |
| 4.5 CE · 4.6 TA | 37 | 12 | 15 | 10 | 0 |
| 4.7 NB · 4.8 AC | 43 | 26 | 8 | 9 | 0 |
| 4.9 VR · CV · 4.10 EX | 29 | 17 | 11 | 1 | 0 |
| 4.11 CO · UN · KB · SP · SB · OF | 17 | 6 | 9 | 2 | 0 |
| 4.12 IN · UP · DA | 15 | 9 | 3 | 1 | **2** (IN-01, IN-11: W only) |
| **All** | **251** | **105** | **96** | **48** | **2** |

AUDIT had 102 / 94 / 53 / 2. Better since: WZ-13 (MISSING → partial: a range typed in the wizard, `app.spec.ts:942`),
CE-01 (partial → PASS: Shift+click on the slide, `:1738-1743`), CE-19 (MISSING → partial), TA-13 (MISSING → partial:
*Reset layout* in free mode, `:1528-1549`), NB-11 (MISSING → PASS: `#noteDelete`), NB-18 (partial → PASS, the row
changed by 07 §6.1), UN-01 (MISSING → partial: `#undoBtn` clicked in nine places; `#redoBtn` never), the dialogs'
Esc / Enter shortcut group (partial → PASS). **Still MISSING** (VER-3): WB-02, 05, 06, 07, 17; WZ-02, 06, 07, 08, 14,
15, 18, 19, 21, 22, 25, 27, 31, 32 ("Discard mine / Save mine anyway": `grep "Discard mine" app/e2e app/tests
core/tests` → nothing), 33; TX-04 (A−/A+: `grep stepSize` in the tests → nothing), TX-08, FT-02/03, FT-04, FT-11;
CE-02, 04, 07, 08, 09, 17, 20; TA-03, TA-12, TA-14–18 (the whole Sizes… dialog); NB-03, NB-05; AC-02, 05, 18, 21, 22,
23, 25; VR-03; CO-07; UN-03; IN-02 – and 13 of the 24 shortcut groups (05's table-driven shortcut test still does not
exist).

## 3. Behaviour changes, 4.1 → 4.5

The 4.1 state is `061a5b3` (main after the audit-fixes merge, CHANGELOG "4.1.0 - unreleased"; no tag v4.1.0 exists).
Full table: [`audit/behaviour-2.md`](audit/behaviour-2.md).

* **CHANGELOG 4.2.0–4.5.0: 31 items, all mapped** to a B-item (B15–B26, B28, B29), a dated Decision or a signed gate
  (G6 2026-10-18, G7 2026-10-19). Two rest on gates that were open at d83e9dd: B15 on **G5** (Waiting for since
  2026-10-17, never signed) and B21 on **G8** (signed off by the product owner on 2026-10-20 – "i approve, tested
  all" – but not recorded; recorded under Decisions by this audit) → GATE-1.
* **The code diff `061a5b3..d83e9dd`** (app, core, helper, `*.bat`, `tools/update.py`): 28 visible changes, 27 inside
  approved B-items; `*.bat`, `tools/update.py`, helper routes and limits unchanged (the helper only accepts `.pptx` at
  `/api/export-file`, `helper/slidebuilder/exports.py:64-74`). Removed: *Look ▾* and *Design… › Layout* (B29,
  CHANGELOG 4.4.0).
* **Not in the CHANGELOG** (BEH-3): the fixes after the owner's real deck on 2026-10-18 – hidden sheets read for
  calculation (Decisions 2026-10-18), the message when a value changes no formula, *Select cell…* for the input cell,
  cells that read a missing linked workbook keep Excel's value and the run report lists them; the Formulas line's
  "hidden" now means only a hidden sheet that could not be read. Small ones (BEH-7): free layout on content slides
  only and *Position ▾* disabled in it; themes "for all designs" locked in a consulting design and its *Design palette*
  button; a page opened from disk cannot link workbooks; Backspace / F2 / Esc on charts and callouts, Ctrl+Enter
  applies a callout's text.
* **Wrong or stale lines** (BEH-4 / BEH-6): every section 4.1.0–4.5.0 says "unreleased" with versions 4.5.0 in the tree
  and no tag after v4.0.0; 4.2.0 describes the *Look ▾* dropdown 4.4.0 removes (no user ever had it);
  `CHANGELOG.md:59` "the deck's look in 4.0–4.3" should be 4.2–4.3 (4.0 / 4.1 show consulting decks in Liquid Glass);
  "decks with charts … open in 4.0–4.2 without them (those keep them in the deck …)" (`:99`, and `:60` for free layout /
  gridlines / borders) is **not true** once such a page compacts (DATA-7); the page grew by 2.40 MB 4.1 → 4.5
  (1,514,306 → 3,915,224 bytes; PLAN B23 says ≈ 2.8 MB, the CHANGELOG ≈ 2 MB).

## 4. Performance (Part F and 07 §6.4), measured by the audit

Calibration (`tools/calibrate.mjs`; the reference PC ≈ 32 ms): run 1 33.5–39.6 ms (×1.05–1.24), **run 2 32.7–37.4 ms
(×1.02–1.17)** – both within the ≤ 1.3× the prompt asks for. Run 2 is the audit's quiet-PC measurement: nothing else of
the audit ran. A third pass on r2 at 11:00 (calibration ×1.03–1.20, the owner's PowerPoint open with a 2.4 GB deck)
shows how load moves the page gates. "Limit" = Part F / 07 §6.4's own number; the bench scales open / read / export /
scenario by calibration and allows +10 %.

| Budget | Limit | Run 1 | **Run 2 (quiet)** | Pass 3 (owner's PowerPoint open) | Verdict |
|---|---|---|---|---|---|
| Open deck20 → first slide | 400 ms | 357 / 339 | **342 / 359** | 358 / 365 | PASS |
| Read big30 (130k rows), page | 1 s | 1,153 (+10 %) | **808** | 1,442 | PASS quiet; load-sensitive |
| … in Node, core parse | 0.5 s | **684 – FAIL** (experiment running) | **381 / 397 / 354** | **666 – FAIL** | PASS quiet → PERF-4 |
| Memory, page + workers | 150 MB | 57 | **69** | 62 | PASS |
| Longest main-thread task (open / edit) | 50 ms | 55 (+10 %) | **0** | 54 (+10 %) | PASS quiet |
| First slide after Finish | 250 ms | 50 | **53** | 0 | PASS |
| Keypress → pixels p95 | 50 ms | 35 / 36 | **25 / 31** | 59 / 45 | PASS quiet |
| Drag frame (table border) | 16 ms | 13.2 | **12.4** | 16.4 (+10 %) | PASS |
| **Free-layout drag frame** (07 §6.4; tables, notes, text boxes, callouts) | 16 ms | 8 | **7.2** | 11 | PASS |
| Thumbnail scroll gap | 20 ms | 17 | **17.2** | 33.4 | PASS quiet; load-sensitive (as AUDIT) |
| Export deck20 PDF, Liquid Glass / Excel | 2 s / 1 s | 1,045 / 519 | **857 / 386** | 1,625 / 779 | PASS |
| PDF size, Glass / Excel | 1,790 / 800 KB | 1,338.3 / 314.6 | **1,338.3 / 314.6** | the same | PASS |
| Export Consulting Navy / Red | 1.5 s | 356 / 241 | **278 / 218** | 463 / 356 | PASS |
| **PowerPoint deck20, Glass / Excel** (time · size) | 3 s / 1.5 s · 3 MB / 300 KB | 664 / 453 ms · 496 / 136 KB | **516 / 316 ms · 496 / 136 KB** | 961 / 612 ms | PASS |
| PowerPoint click → file (export-check, deck20 Glass / Excel) | as above | 809 / 499 | **824 / 480** | – | PASS |
| **Engine first use, cold** (07 §6.4: 300 ms) | 300 ms | 242 | **231** | 228 | PASS |
| **One scenario value** (≤ 2,000 formula cells) | 150 ms | 109.5 | **43.3** | 42.7 | PASS |
| One value + 20 Glass slides to PDF | 3 s | 596 / 624 | **470 / 451** | 865 / 869 | PASS |
| **Scenario run, 20 values × 20 slides** | 40 s | 4,019 / 4,007 | **3,207 / 3,199** | 5,696 / 5,728 | PASS |
| Longest task during a run | 50 ms | 0 | **0** | 0 | PASS |
| **Preview switch** | 400 ms | 41 / 46 | **36 / 38** | 68 / 58 | PASS |
| **Chart build** (pie, 12 slices) · **callout build** | 5 ms · 2 ms | 0.35 · 0.43 | **0.40 · 0.57** | 0.37 · 0.38 | PASS |
| Save durable p95, 20 users, 40 ms | 150 ms | 113 | **115** | – | PASS |
| Others see an edit p50 / p95, 20 users | 2 s / 4 s | 1.37 / 2.18 s | **1.41 / 2.20 s** | – | PASS |
| Helper start → page ready (`#openBtn`) | 1 s | GET / 729–762 | GET / 719–776 | **GET / median 605 ms, page ready median 847 ms** (725–857) | **PASS** (AUDIT PERF-1: 1,136 ms after its fix) |

**Every Part F and 07 §6.4 budget is met on this PC when it is quiet** (run 2, ×1.02), and the new 4.2–4.5 budgets
have wide margins (the 20-value run takes 8 % of its 40 s; PowerPoint 17–21 % of its time). The page gates that fail
under load are the same ones as in AUDIT (read, keypress, thumbnail gap, long task) and the core parse gate (PERF-4):
they measure the PC as much as the code.

## 5. Architecture and logic

| Check | Result | Evidence |
|---|---|---|
| One owner per state | PASS, concerns ARCH-1, ARCH-2 | The IronCalc model only in the worker (`core/src/worker/host.ts:169-212`, lazy import `:177`); the page imports only a type (`app/src/ui/ScenarioDialog.tsx:10`). The scenario overlay only in the worker (`host.ts:221,268,289`, the run `:373`). Linked workbooks attached in the worker (`host.ts:155-163`); the page fetches and transfers the bytes (`app/src/state/app.ts:62-68`). Page copies, all documented mirrors: cell slices `MirrorWorkbook` (`core/src/xlsx/mirror.ts:1-15`, "recalculates nothing"), written only from the worker's `slices` events (`app.ts:70-72,103-120`); the scenario's slices (S8.4, `host.ts:222-233`, 07 §2.4); the predicted document view through the core's `applyOps` (`app.ts:419-431,495`); `ownTexts` during a preview (`app.ts:92-109`, 07:281-284). No second source of truth. ARCH-1: `clearPreview` clears the banner and `ownTexts` before the worker confirms (`app/src/editor/scenario.ts:82-88`) – a failed clear leaves scenario values on the stage without the banner. ARCH-2: *Prepare rollback* runs its own DocSync compactions on the UI thread for other decks (`app.ts:541-559`; compare-and-set, so safe) |
| Op semantics only in `ops.ts` | PASS, ARCH-3 | `item.patch` `core/src/model/ops.ts:58-79`; `free`, `looks` slide map merges (`:7`); `cellGrid`, `borders` table map merges (`:9`); `links` only through `preset.set` (`types.ts:83`). Every other applier imports the core's (`fold.ts:77`, `docsync.ts:143,181`, `app.ts:427,495`, `api.ts:225,277`); app/src only builds ops; the helper applies none (`migrate.py:70-80` builds the v2 import's ops). `shared/ops-vectors.json`: 79 cases (item.patch 13+, free 11, cellGrid 8, borders 6, looks 2, **links 0**; no inverse round trip for `looks`) → ARCH-3 |
| `core/` has no DOM types | PASS | `core/tsconfig.json:7-8` `lib: ["ES2022","WebWorker"]`, `types: []`; grep for `document.`, `window.`, `HTMLElement`, `DOMParser`, `@ts-ignore`, `@ts-expect-error` → comments only. Info: the vendored IronCalc glue carries `@ts-nocheck` (`core/src/calc/wasm/ironcalc-glue.js:3`) |
| No new executable | PASS, ARCH-4 | `git ls-files`: no `.exe .dll .node .pyd .so .wasm .bin .jar .whl .zip`; IronCalc 0.9.0 inlined as zlib + base64 (`tools/vendor-ironcalc.mjs:16-25`, `core/src/calc/wasm/ironcalc-wasm.ts`). ARCH-4: its test compares only the hash **constant** with node_modules (`core/tests/engine.test.ts:25-29`), never the inlined bytes (HarfBuzz's does, `shape.test.ts:36`) |
| Standard-library helper | PASS | AST scan of the 21 non-test helper modules against `sys.stdlib_module_names` (3.12.7): 0 others, no `__import__` / `importlib`; `tools/update.py` likewise |
| Licences | **FAIL → LIC-1** | runtime: react, react-dom, scheduler (MIT, © Meta), zustand (MIT), fflate (MIT), IronCalc 0.9.0 (MIT or Apache-2.0), harfbuzzjs 0.4.12 (MIT, naming Apache-2.0 parts) and HarfBuzz (Old MIT). The page has 0 "Permission is hereby granted" / "Copyright" / "@license" (`legalComments: "none"`, `app/vite.config.ts:21`); the release has no NOTICE (`tools/make_release.py:37-44`); `core/src/calc/wasm/LICENSE-ironcalc` (MIT with the holders' notice) and `core/src/text/wasm/LICENSE-harfbuzzjs` never ship; HarfBuzz's COPYING is not in the repo. Fonts: none shipped (test fixtures only; Google Fonts load at run time) |
| Display list: eight node types in every design | PASS | union `core/src/dl/types.ts:107`, `NODE_TYPES` `:111`, `validate` refuses any other (`:176-178`) before every PDF / PNG / PPTX export incl. the PowerPoint chart cards (`core/src/worker/export-host.ts:116,139-142`); every node literal in render / dl / pptx / worker is one of the eight (rect 60, group 30, hit 17, path 15, line 13, shadow 13, image 10, text 7); M7b's exhibits emit none themselves (`render/exhibit.ts`); tests `dl.test.ts:50-56`, `consult-slide.test.ts:62-67`; `tools/dlcheck.mjs` 8/8 + negative control in every run. Info: the PowerPoint writer also reads `SlideList.sem` (ADR-016; ARCHITECTURE §11 still says the list is the only contract and "three backends") |
| S1 Host (DNS rebinding) | PASS | `evil.com`, `127.0.0.1` (no port), `127.0.0.1.:p`, `localhost.:p`, `[::1]:p`, `0.0.0.0:p`, empty, `127.0.0.1:p.evil` → 403 |
| S2 Origin + token | PASS | foreign / `null` / other-port / https / `localhost.` origins → 403; 28 routes × {no, wrong} token → 56 × 403 |
| S4 limits | PASS | `Content-Length` 10^20 → 413; chunked → 411; −1 → 400 (unchanged since AUDIT) |
| `/api/export-file` with `.pptx` | PASS, **SEC-6 / SEC-7 fixed** | `../`, `..\`, `C:\`, UNC, `x:evil.pptx` → a bare name in `export\`; `::$DATA`, `.pptx.exe`, no extension → 400; control characters, `<>:"|?*`, trailing dots → cleaned; emoji, combining marks, full-width `ＣＯＮ`, `’‘` quotes saved as named; a truncated zip, `PK` header only, a zip without `ppt/presentation.xml`, PDF bytes as `.pptx`, `.pptx` bytes as `.pdf`, an empty body, a body shorter than its Content-Length → 400, nothing left (no `.tmp`). **At d83e9dd:** `CON.pptx`, `NUL.pptx`, `COM1.pptx`, `COM¹.pptx`, `LPT9.pptx` saved under device names (SEC-7) and 200 / 250 / 300-character names in a 167-character export folder answered **404 "not found"** (SEC-6). Info: an RTL override (U+202E) is accepted in a name (`abc‮gnp.pptx` shows as `abcxtpp.png` in Explorer) – the page names its own files, so only the page's token holder can do it |

The attacks (110 requests on raw sockets, `attack2.py`) ran against a helper copy on port 21100 with fresh folders, an
export folder 167 characters deep and an `outside\` folder with a marker file: no response held a marker, nothing
outside `export\` was created or changed, no traceback in the helper's log. Scenario run names are already safe on the
page side (`core/src/export/names.ts:30-110`: device names prefixed, the name cut for the full path, " (2)" inside a
run); the helper now applies the same two rules to every name it receives.

## 6. Data safety

| Check | Result | Evidence |
|---|---|---|
| A scenario run changes nothing (real helpers, two users) | **PASS** | `scenario2u.mjs`: Banks.xlsx + linked Peers.xlsx (the recalc corpus), deck made in the wizard by anna (helper :21301), opened by bob from a second helper (:21302) on the same root and data folders. anna runs *Run for each value…* on `Control!B4` with 20 values × Excel × PDF + PowerPoint; bob changes the slide title 5 times during the run. After: **40 files** (20 PDF, 20 `.pptx`); Banks.xlsx and Peers.xlsx sha256 unchanged; anna's journal unchanged (same sha256, no new journal of hers); bob's journal new; the document equal to the one before except the title = "Bob 5"; anna's page shows "Bob 5". The e2e guard SC-05 (`app.spec.ts:1258`) checks the one-user case in every run |
| A missing linked workbook | **PASS** | Peers.xlsx moved away, Banks.xlsx opened again: the deck opens ("Banks.xlsx · 1 slide"), the Issues panel says *Linked workbook "Peers.xlsx" not found in the folder: its tables are missing until it is back (the deck keeps them)*; after 40 s alone (a compaction may run) the deck still has `links: ["Peers.xlsx"]`, its table and every field; no page error |
| A damaged `.pptx` is never left in `export\` | **PASS** | the helper takes only a zip with `[Content_Types].xml` and `ppt/presentation.xml` (`exports.py:67-74`), writes a unique temporary file, renames it under the lock and removes it in `finally` (`exports.py:43-61`, `util.py:142-153`): the seven damaged / cut bodies of §5 → 400, the folder held no `.tmp` and no partial file |
| A 4.5 deck opened by a **4.1 page** (worktree of 061a5b3, its own helper and committed page, the same folders), one edit, then alone | **FAIL → DATA-7** | `compat41.mjs`: 4.5 wrote the chart corpus (a preset with `links`, 27 `item.patch`) + `free`, `looks`, `cellGrid`, `borders`. The 4.1 page opens it ("report.xlsx · 4 slides", no page error, the edit saved) and, alone and quiet, compacts (gen 1 → 2). 4.5 then reads: links KEPT, **items LOST (27 → 0), free LOST, looks LOST, cellGrid LOST, borders LOST**; the 4.1 edit kept. The same experiment after a 4.5 page had compacted first (`--compact-first`): everything KEPT (the fields were in the snapshot, which 4.1's `clone` keeps – what `core/tests/*-fallback.test.ts` test) |

After the fix, the same `compat41.mjs` cannot show the 4.1 side changed (4.1 is what it is); the fix's test
(`core/tests/docsync.test.ts` "a record of a newer page …") shows a 4.5 page leaving a later version's records alone.

## 7. Documentation truth (30 random statements)

Sampled with `random.Random(20261020)` from the lines that can hold a claim (README 687, ARCHITECTURE 515; one rng,
15 each; ARCH:329, a table header, replaced by ARCH:331). **26 TRUE, 4 PARTLY, 0 FALSE.** Only README:867 of the drawn
lines is about 4.2–4.5, so the 4.2–4.5 sections were also read in full (outside the sample, below).

| # | Doc:line | Statement | Evidence | Verdict |
|---|---|---|---|---|
| 1 | README:45 | a wizard picks sheets and tables and arranges them on slides | `app/src/wizard/Wizard.tsx:167-192` | TRUE |
| 2 | README:82 | one toolbar formats the selected text: cells, text box, title, subtitle, cover note, date | `app/src/editor/textfmt.ts:2,20,30,138-152` | TRUE |
| 3 | README:87 | click / drag / Shift, F2, Enter / Tab, Del, Ctrl+B/I/A/Z/Y/S, PgUp/PgDn | `app/src/editor/keys.ts:18-24,45-56`; `app/src/state/app.ts:511-519` | TRUE |
| 4 | README:106 | *Detailed*: one section per comparison found in the headers | `core/src/model/comment.ts:165-176`: per **chosen** group; `defaultGroups` picks ≤ 2 (`:145-149`) | PARTLY |
| 5 | README:297 | documents change only through `preset.set`, `slide.patch`, `table.patch`, `cell.patch`, `style.patch` | leaves out `item.patch` (`ops.ts:59-79`), which README:425 lists | PARTLY |
| 6 | README:429 | map merge: different columns / boxes never overwrite; the same field → Lamport order | `ops.ts:90-97`; `fold.ts:29-30,71` | TRUE |
| 7 | README:439 | config conflict → 409 with the document, retried | `server.py:468-476`, `store.py:194-213`, `api.ts:274-279` | TRUE |
| 8 | README:573 | drag preview with `computeLayout` once per frame; pointer-up one op; cancel changes nothing | `app/src/stage/drags.ts:12,34,49-50,83,228` | TRUE |
| 9 | README:585 | `keys.ts` global keyboard · `issues.ts` side-panel notes | `app/src/editor/keys.ts:1,11`, `issues.ts:1` | TRUE |
| 10 | README:808 | `POST /api/fonts/capture`: a fingerprint into `fingerprints.json` | `server.py:533-535`; `sysfonts.py:228-326` | TRUE |
| 11 | README:835 | covered journals deleted by `rotate` or after 24 h idle | `decks.py:58,844-854,931` | TRUE |
| 12 | README:854 | up to three export workers, one job per (design, version) | `app/src/rpc/export.ts:1-6,15,34,65`; `app/src/editor/export.ts:5,200` | TRUE |
| 13 | README:867 | PowerPoint: the versions' items in PDF / PowerPoint / both; *Run for each value…* Files: PDF · PowerPoint | `app/src/ui/Topbar.tsx:191-206`; `ScenarioDialog.tsx:145-147` | TRUE |
| 14 | README:1073 | the 30 s margin can bring back a replaced value; nothing lost | `core/src/sync/docsync.ts:48` | TRUE |
| 15 | README:1074 | polling (1.5 s tail); `ReadDirectoryChangesW` not built | `docsync.ts:42,248`; none in `helper/` | TRUE |
| 16 | ARCH:83 | backups `before-update-<time>`, last 5, `data\v4` not copied | `tools/update.py:65-66,147,166-167,631-638` | TRUE |
| 17 | ARCH:134 | `incident-*.json` by the first helper that finds damage, O_EXCL | `decks.py:392-405` | TRUE |
| 18 | ARCH:217 | Preset `{sheets, tables, slides, version?, updated?, versions?}` | `types.ts:80-83` has `links?` too; ARCHITECTURE never names `links` | PARTLY |
| 19 | ARCH:252 | map merge: an entry replaced whole or deleted by `null`; empty maps removed | `ops.ts:90-97` | TRUE |
| 20 | ARCH:331 | `l` = Lamport time, integer ≥ 1 | `fold.ts:10`; `decks.py:474-477` | TRUE |
| 21 | ARCH:335 | `ops` set by the page | `fold.ts:10` | TRUE |
| 22 | ARCH:422 | compaction writes the backup, returns `{gen, dropped}` | `decks.py:816,853-854` | TRUE |
| 23 | ARCH:434 | no compaction on a `skipped` round or a tail without `now` | `docsync.ts:151,310,375` | TRUE |
| 24 | ARCH:445 | every frontier a prefix of records in the snapshot; 409 → the winner's snapshot | `docsync.ts:315,327` | TRUE |
| 25 | ARCH:482 | shared JSON reads retry 5 × 0.1 s, then 503, never empty | `store.py:42-62`; `server.py:321` | TRUE |
| 26 | ARCH:514 | the deck folder checked on open, ≤ every 10 s from tails, every 4 s in the background | `decks.py:65-66,428,484` | TRUE |
| 27 | ARCH:523 | a failed clock probe retried after 1 s; `trusted` false meanwhile | `helper/slidebuilder/fsclock.py:10-22,99-104` | TRUE |
| 28 | ARCH:709 | every display-list number finite, ±1e6; `validate` → "path: what" | `core/src/dl/types.ts:114-116,170`; `export-host.ts:116,139-141` | TRUE |
| 29 | ARCH:750 | `/sysfonts`: the per-user folder wins | `sysfonts.py:53-57,165-176` | TRUE |
| 30 | ARCH:817 | on 409 the page redoes the change, 5 tries (`api.ts:262-268`) | true at `api.ts:274-281`; the cited lines are now `openTail` | PARTLY (stale pointer) |

**07 §1.4's limits at d83e9dd:**

| Limit | Still true? | Evidence | Told to users? |
|---|---|---|---|
| 15-digit read-back (no raw getter; equality to 1e-13) | yes | `core/src/calc/engine.ts:8-9,65-73,305,497`; `core/tests/engine-pin.test.ts:61` | README:519 (maintainers); invisible to users (Excel's own display precision) |
| Hidden sheets | **changed**: read for the engine only, never sent to the page (`host.ts:188-205`); only a hidden sheet that cannot be read stays `hidden`, its formulas keep Excel's value (`engine.ts:378-388,465-467,513-517`; `engine.test.ts:72`) | – | the app (`Chrome.tsx:63`, `ScenarioDialog.tsx:172`); **README:56 and ARCH:784 still say hidden sheets are not read** (DOC-C) |
| TEXT locale | **changed**: Italian codes formatted by Slide Builder (`core/src/calc/textfmt.ts`, `engine.ts:159-225`); a TEXT cell that still differs is pinned to Excel's value and does not follow a scenario even when its inputs change (`engine.ts:227-242`; `engine-pin.test.ts:23-76`) – stricter than §1.4 | – | CHANGELOG 4.2, the app (`Chrome.tsx:61-62`, the run's kept-cells list `ScenarioDialog.tsx:186`); not README |
| Spills | **changed**: arrays load as arrays at Excel's saved size (`engine.ts:357-360,390,418`); **a shrinking FILTER leaves #VALUE! where Excel leaves empty cells, a growing one is cut**; the self-check cannot see it (spilled cells are not formula cells); `large-corpus.test.ts:114-133` logs, asserts nothing | – | **no** (only PROGRESS Waiting for, G5) → LIM-1 |
| Whole columns bounded (except OFFSET, INDIRECT, ROW(S), COLUMN(S); `A:INDEX` rewritten as OFFSET) | yes | `engine.ts:64,446-476`; `engine.test.ts:64`; `calc/rangeindex.ts` | README:519 only |
| Two sheets' whole columns in one array expression → #VALUE! | yes, by construction | `engine.ts:473-476`; no test | **no** → LIM-1 |
| External links | changed: kept at Excel's saved value | `engine.ts:378-388`; `engine.test.ts:93`, `engine-pin.test.ts:79` | the app, CHANGELOG |
| Unsupported: macros / UDFs, data tables, Power Query, RTD, cube functions, circular references, structured references (`refs.ts:37`) | yes | nothing in `calc/` handles them; they end up `different` | **no** → LIM-1 |
| `.xls` values only | **outdated**: `convert.py:127` saves the converted file as `.xlsx` with its formulas (`SaveAs …, 51`), so they reach the engine (from the code, not run) | – | – |

**Outside the sample** (DOC-A…K, §8): README:18 / 46 / 65 say three designs (five since 4.2: `designs.ts:5-6`,
`Topbar.tsx:251`) – FALSE; README:1068 lists "Formulas are not recalculated" as a known limit – FALSE since 4.2
(README:57 PARTLY); README:56 / ARCH:784 hidden sheets – PARTLY; ARCH:245 `slide.patch` omits `looks` and says "other
keys ignored" – FALSE (README:421 PARTLY); ARCH:226 `StylePatch.design` lacks mckinsey / bain – FALSE; ARCH:235 "61
vectors (56 + 5)" – 79 (74 + 5); README §1.1 has no PowerPoint, *Run for each value*, linked workbooks, free layout,
gridlines or borders and README:110 no "× all five designs"; README:519 leaves out the `hidden` class; ARCH pointers
`types.ts:69` → `:112`, `decks.py:727-729` → `:755`, `decks.py:441-451` → `:466-477`; the user guide
`docs/guide/guide.md` §6 (last changed 2026-10-16) still says "not yet released", "the slides still show Excel's
saved values", that the engine starts only on *Check*, and (line 154) that Excel shows no text boxes, comments or
notes – contradicting README:71; it does not mention charts, callouts, free layout, borders, the consulting designs or
PowerPoint. PROGRESS claims that do not hold (12, listed in `audit/features-2.md` Part A): e.g. S7.3 "LK-02 by the host
test" (it is guarded by `engine.test.ts:48` and `app.spec.ts:1121`, not `host.test.ts:426`), S11.2 "pptxcheck: every
table has_table" and S11.3–S11.4 "opened in PowerPoint 16" (counted / recorded, never gated), test counts in S8.3 /
S8.4 (10 not 11, 11 not 13), S7b.4 "the Look dropdown" (removed by B29; the e2e asserts it is absent).

## 8. Findings

Severity: critical · high · medium · low · info. "Fixed" = a commit on `v4/audit-2-fixes` whose test fails before it.

### Fixed (failing reproduction first)

**DATA-7 · high · a 4.0 / 4.1 page compacts a newer deck's charts, callouts and layouts away** – fixed for every
later version in af0a729 (4.0 / 4.1 cannot be changed: REL-1).
* *Defect.* `applyOp` skips an op, a patch key or an item kind it does not know (`core/src/model/ops.ts`, as designed:
  ARCHITECTURE §3), and DocSync's compaction (`core/src/sync/docsync.ts` `candidate`) folds the records it has read
  into a snapshot whose `seen` then says those records are in it. A page that does not know `item.patch` (4.0–4.2),
  `free` / `cellGrid` / `borders` (4.0–4.3) or `looks` (4.0–4.3) therefore writes a snapshot without them, and every
  page – 4.5 included – folds the records as already done. 07 §2.1 assumed "a 4.0/4.1 helper and page read a 4.2 deck
  (they ignore unknown keys)"; reading is fine, compacting is not. The fallback tests (`core/tests/*-fallback.test.ts`)
  start from a document that already holds the fields, the case that is safe.
* *Reproduce (d83e9dd + 061a5b3).* §6: the real 4.1 helper and page, one title edit, 35 s alone → gen 1 → 2; 4.5 reads
  27 → 0 items, free / looks / cellGrid / borders gone; links (inside `preset.set`) kept. The same defect sits in 4.5
  for a later version's ops: `docsync.test.ts` with a record holding `item.patch` of kind `map`, a `slide.patch` key
  `ribbon`, a `table.patch` key `stripes` or an op `chart.patch` – the 4.5 page compacted it away (gen 2).
* *Fix.* `knownOp(op)` in `ops.ts` (a known type, only keys this version applies, a known item kind) and in
  `DocSync.candidate`: nothing is compacted while a record past the snapshot holds an op the page does not know whole
  – not only that record: the records after it in Lamport order must not be folded before it. A newer page compacts
  it. Every op the 4.5 page writes is known (the corpus decks' 58 ops; every op builder in `app/src` read); ARCHITECTURE's
  compaction section says so. Test docsync "a record of a newer page – an op or a key this page does not know – is never
  compacted away (AUDIT-2 DATA-7)".

**SEC-6 · low · a long export name in a deep export folder failed as "not found"** (AUDIT SEC-6, still open; now
reachable with PowerPoint names) – fixed in cc217c3.
* *Reproduce.* `/api/export-file?name=<200 × v>.pptx` with an export folder of 167 characters: `open()` of
  `<folder>\<name>.<32 hex>.tmp` raised `FileNotFoundError` → 404 "not found" (also 250, 300 characters). The page's
  run names are cut for the path (`names.ts` PATH_LIMIT 240); the slide / version names (`pdfName`, `pptxName`,
  `versionTitle`) are not.
* *Fix.* The helper cuts the name so the temporary file's full path stays under 240 UTF-16 units (as the page's run
  names), a folder too deep for any name → 400 with the reason. Test `ExportTests.test_export_file_name_fits_a_deep_export_folder`.

**SEC-7 · low · exports named after devices** (AUDIT SEC-7, open) – fixed in 9c60077. `CON.pptx`, `nul.pdf`,
`COM1.png`, `LPT¹.pdf`, `CON .pptx` were saved as named (devices on older Windows and SMB servers); now prefixed `_`
as the page's run names (`names.ts` RESERVED). Test `ExportTests.test_export_file_never_names_a_device`.

### Not fixed (a decision for people, or no failing reproduction of a product defect)

| ID | Severity | Finding | Evidence | Proposed |
|---|---|---|---|---|
| REL-1 | **high** | The share runs 4.0.0 (Decisions 2026-10-15); a running helper never learns of an update (the 409 "Slide Builder was updated" fires only when the data-format numbers change – `server.py:269-270`, unchanged `workbook=3;config=3;prefs=1`), and `--use 4.0.0` stays allowed after 4.5 (`tools/update.py`, "an older one marks the folder held"). Any 4.0 page left open on update day, or a rollback, compacts 4.5 decks with DATA-7's loss | §6, DATA-7 | before 4.5 reaches the share, one of: (a) **a format guard** – a 4.5 page that writes a 4.2+ op makes the deck's next snapshot `format: 5` (4.0's helper refuses it: "saved by a newer Slide Builder", `decks.py:265-267` at 061a5b3) and the helper refuses a `format: 4` compaction over it; (b) raise `FORMATS` (`workbook=4`) so old pages get 409 at once (`server.py:269`), with the matching upgrade step; (c) at least: release with every Slide Builder window closed (presence files show who is in a deck), and `update.py --use` refusing a 4.0 / 4.1 once a 4.2+ op was written – and say so in the CHANGELOG instead of "those keep them in the deck" |
| LIC-1 | **high** | No third-party licence notice ships: the MIT texts of react, react-dom, scheduler, zustand, fflate, IronCalc (MIT / Apache-2.0) and harfbuzzjs / HarfBuzz are in neither the page nor the ZIP; HarfBuzz's COPYING and the Apache-2.0 text of harfbuzzjs's Apache parts are not even in the repo; ADR-013's "reproduce the MIT text" is not done | §5 | a `THIRD-PARTY-NOTICES.txt` generated from `node_modules` + the vendored LICENSE files + HarfBuzz COPYING, in `make_release.py` ROOT_FILES and REQUIRED (or `legalComments: "eof"` in both bundles), and a test that fails for a runtime dependency without an entry |
| GATE-1 | medium | G5 (B15, scenario export on a real deck) never signed off; its question "release 4.2 first, or once" unanswered; the M7b final sign-off (S7b.5) open, with four dlparity pixel entries accepted on silence; G8 signed orally 2026-10-20 (recorded now) | PROGRESS Waiting for | the product owner signs or says what to change |
| BEH-3 | medium | 4.2's real-deck fixes not in the CHANGELOG | §3 | four CHANGELOG lines |
| LIM-1 | medium | Shrinking FILTER → #VALUE!; growing spill cut; two-sheet whole columns → #VALUE!; the unsupported list – none told to users; CHANGELOG 4.2 "every formula equals Excel's" holds for formula cells only | §7 | README "known limits" + the guide; show a shrinking spill's cells empty (G5's open question a) |
| VER-3 | medium | 48 05-rows MISSING (§2), incl. the table-driven shortcut test 05 asks for; PX-02 / PX-03's PowerPoint checks counted, never gated; RC-04 INDIRECT, LK-03's Issues line, FL-02 chart in free layout unguarded | §2 | gate `powerpoint` and `has_table` in export-check when PowerPoint is present; the tests named in features-2.md |
| VER-1 | medium (process, unchanged) | Geometry / pixel / screen = PDF parity runs text-only on this PC except the consulting designs | parity logs ("text-only comparison; consulting designs: full") | as AUDIT VER-1 |
| ARCH-4 | medium | The inlined IronCalc bytes are never hashed | `core/tests/engine.test.ts:25-29` vs `shape.test.ts:36` | inflate the payload in the test, assert its sha256 |
| PERF-4 | low | The core parse gate (`big30` < 0.5 s) fails whenever anything else runs on the PC (684 ms in run 1 while the audit's experiment ran; M10's afternoon) | §4 | as M10: a reference-PC run decides; keep it, but report it apart from code regressions |
| BEH-4 | low | "unreleased" ×5, no tag after v4.0.0; 4.2.0 describes a dropdown 4.4.0 removes; `CHANGELOG.md:59` "4.0–4.3"; `:60` / `:99` "keep them in the deck" (DATA-7) | §3 | a release plan; fold or annotate the sections before tagging |
| BEH-6 / BEH-7 | low | page +2.40 MB (B23: 2.8, CHANGELOG: 2); small CHANGELOG omissions | §3 | correct the figures; one line each |
| DOC-A…K | low | README three designs, "formulas are not recalculated", hidden sheets; ARCHITECTURE `looks`, `StylePatch.design`, 61 vectors, `links`, stale pointers; README §1.1 without the 4.2–4.5 features; the guide's §6; 12 PROGRESS claims | §7 | correct the sentences; refresh the guide (Prompt 16) |
| ARCH-1 | low | The preview banner can disagree with the worker | §5 | the worker emits the preview state; the page shows the banner from it |
| ARCH-2 | low | *Prepare rollback* compacts other decks from the UI thread | §5 | route it through the worker or document the exception in PLAN Part B §2 |
| ARCH-3 | low | No vector carries `links`; no inverse round trip for `looks` | §5 | two vectors |
| ARCH-5 | info | PLAN.md:110 calls the page's document "read-only" (it is predicted through the core's ops); ARCHITECTURE §11 "the display list is the only contract", "three backends" (four, and `SlideList.sem`) | §5 | reword |
| SEC-3 / 9 / 10 | as AUDIT | unchanged: shared Windows hosts, notes entries replaced whole, prefs PUT whole (the new `item.patch` merges field by field, as AUDIT asked) | AUDIT §8 | as AUDIT |
| SEC-12 | info | An RTL override in an export name is accepted | §5 | strip U+202A–U+202E, U+2066–U+2069 in `clean_name` / `cleanName` |

## 9. What still needs a human

1. **Merge decision for `v4/audit-2-fixes`** (not pushed; 3 fix commits + the audit's docs on d83e9dd) – and **REL-1
   before 4.5 reaches the share**: the format guard (a) or (b) as a 4.5.1, or the release rule (c). The live share
   runs 4.0.0, which DATA-7 affects as soon as anybody uses 4.3+ objects there.
2. **LIC-1**: decide the notices file (and whether the IronCalc dual licence is taken as MIT).
3. **Gates:** G5 on a real deck (10 values) and its open question (shrinking spills); the M7b final sign-off and the
   four dlparity entries; G8's four "to judge" items stay as recorded.
4. **The release plan** (BEH-4): 4.2.0–4.5.0 are unreleased in one tree; tag once as 4.5.x after the fixes, or fold
   the sections.
5. **Field checks never run:** PowerPoint 2016 on a corporate PC (W15 / G8), Acrobat (W14), the real share with several
   PCs and helpers (a 4.0 and a 4.5 helper side by side is exactly REL-1's case), `fieldcheck.html`, W1–W14, IN-01 /
   IN-11.
6. **Missing tests** (VER-3) and the design choices ARCH-1, ARCH-2, SEC-3, SEC-9, SEC-10.
7. **Documentation** (DOC-A…K, LIM-1): README, ARCHITECTURE, the guide.

## 10. After the fixes: the protocol twice more

Two clean clones of `v4/audit-2-fixes` at af0a729 (`f1`, `f2`; 11:04–12:43), the same script as §0:

| Step | Run 3 (f1) | Run 4 (f2) | Before (runs 1 / 2) |
|---|---|---|---|
| `npm ci` · build · page fresh | ok · ok · **equal** | ok · ok · **equal** | equal |
| `npm run check` | core **817**, app 44 passed | 817 · 44 | 816 · 44 (+ docsync DATA-7) |
| helper 3.12.7 / 3.8.10 | **240** OK / 240 OK (1 skip each) | 240 / 240 | 238 (+ SEC-6, SEC-7) |
| e2e | 37 passed, 4.3 min | 37 passed, 4.3 min | 37 |
| parity · dlparity | 11,061 · 11,065 differences, **0 not accepted** | the same | the same |
| sp | 8/8 + negative control | 8/8 | 8/8 |
| bench (calibration) | ×1.02–1.05: **every gate within** (core parse 352 / 379 / 378 ms; first use 222 ms, one value 41.1 ms; open 370, read 806, keypress p95 54 within +10 %, free drag 6.9 ms, scenario 20 values 3,139 ms, PowerPoint Glass 524 ms) | ×1.02–1.28: **every gate within** (parse 479–565 ms at ×1.28; first use 235 ms, one value 43.6 ms; read 1,053 at its limit, longest task 50, drag 16.4 within +10 %, scenario 20 values 3,829 ms) | §4 |
| load `--ci` save p95 / visible p95 (same deck, 40 ms) | 111 ms / 2.18 s; 5/5 PASS, 0 lost | 113 ms / 2.20 s; 5/5 PASS, 0 lost | 113 / 2.18 · 115 / 2.20 |
| export-check | 70/70 GT; 75 PowerPoint: ok 75, opened 75, GT 75 | the same | the same |
| PDFs and PowerPoint × design × version | 15 + 15, qpdf clean, GT, opened in PowerPoint | 15 + 15 | 15 + 15 |
| helper start → `GET /` 200 | 730–761 ms | 733–763 ms | 719–776 ms |

* **The two post-fix runs agree with each other and with the runs on d83e9dd** on every correctness result; only the
  test counts grew (the three new tests). No timing moved beyond the PC's own spread.
* **The reproductions now pass:** the docsync test with a newer page's op / key / item kind (gen stays 1, the record
  kept) and the two helper tests (a 200-character `.pptx` in a 150-character folder saved under 240 characters; `CON.pptx`
  → `_CON.pptx`); each failed on d83e9dd first (§8).
* **Still not shown by any automated run:** the 4.0 / 4.1 side of DATA-7 cannot change (REL-1); PowerPoint 2016 (W15);
  Acrobat (W14); the real share.
