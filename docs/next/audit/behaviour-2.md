# AUDIT-2 · Behaviour changes 4.1 → 4.5 (061a5b3 → d83e9dd)

> Numbering in `AUDIT-2.md`: this review's BEH-1 (G5), BEH-2 (G8) and BEH-5 (M7b sign-off) are AUDIT-2's GATE-1; G8
> was signed off by the product owner on 2026-10-20 and is recorded under PROGRESS Decisions by the audit. BEH-3, BEH-4,
> BEH-6 and BEH-7 keep their numbers. The audit adds that CHANGELOG.md:60 and :99 ("those keep them in the deck") do
> not hold once a 4.0–4.3 page compacts such a deck (AUDIT-2 DATA-7).

Read-only review: `git diff 061a5b3 d83e9dd`, CHANGELOG.md, docs/next/PLAN.md Part B §8, PROGRESS.md (Steps, Decisions,
Waiting for). Line numbers are at d83e9dd. No tests or builds were run.

Baseline facts
* CHANGELOG diff 061a5b3..d83e9dd: +160 lines, all above `## 4.1.0 - unreleased`. **No 4.1.0 line was added or changed
  after 061a5b3.**
* PLAN §8 has B1–B26, B28, B29. B27 is reserved and unused (08-consulting-designs.md:572, 682: "the existing item
  exports five designs" alternative, not chosen). The gap is explained in Decisions 2026-10-19 (B28 entry).
* `*.bat` and `tools/update.py`: no changes. Helper changes: `.pptx` accepted by `/api/export-file`
  (helper/slidebuilder/exports.py:64, zip check `_is_pptx`), `VERSION = "4.5.0"` (helper/slidebuilder/__init__.py:7).
  Routes and size limits are unchanged (`/api/export-file` still takes `BIG_LIMIT` of 300 MB, server.py:489).
* Tags: v3.4.0 to v4.0.0 only. Every CHANGELOG section from 4.1.0 to 4.5.0 says "unreleased". Versions in the tree
  are 4.5.0.

## Part 1 · CHANGELOG items 4.2.0 – 4.5.0 mapped to cover

| Change | Where (path:line at d83e9dd) | Covered by (B-n / Decision date / gate) | CHANGELOG (version, yes/partial/none) | Verdict |
|---|---|---|---|---|
| Run for each value: an input cell set to each value of a list, one PDF per value, design and version; " (2)" for duplicates; progress, Cancel, report, Open folder | app/src/ui/Topbar.tsx:209; app/src/ui/ScenarioDialog.tsx:193; core/src/export/names.ts:81-110 | B15; Phase 0 approval 2026-10-16; **G5 not signed off** (Waiting for 2026-10-17) | 4.2.0 yes | OK for cover, but see BEH-1 (gate) |
| Gate before the first value: cells computed differently stop the run unless "Run anyway and mark these cells" is ticked (red corner) | app/src/ui/ScenarioDialog.tsx (runAnyway); app/src/state/store.ts (ScenarioForm.runAnyway) | 2026-10-16 Phase 0 ("the self-check gate stops a run unless 'run anyway'"), 07 §8 Q2 | 4.2.0 yes | OK |
| Preview one value: banner "Previewing: … – a scenario, not saved · Clear"; formula bar, toolbar and side panel follow it | app/src/ui/Chrome.tsx:129 | B15 ("preview of one value"); 2026-10-17 "Mirror the cells" | 4.2.0 yes | OK |
| An edit during a preview belongs to the workbook's value, and a toast says so | app/src/editor/edit.ts:74 | 2026-10-17 (S8.4, CE-09) | 4.2.0 yes | OK |
| An ordinary export during a preview uses the workbook's own values, and its message says so | app/src/editor/export.ts:92 | B15 / 07 §2.4 (S8.3) | 4.2.0 yes | OK |
| Italian Excel `TESTO(…)` formatted as Italian Excel does; Formulas line "n with TEXT in Italian, formatted by Slide Builder" | core/src/calc/textfmt.ts; app/src/ui/Chrome.tsx:63 | 2026-10-17 "M8 S8.4 and the TEXT cells" ("Yes, in M8"; amends 07 §8 Q8) | 4.2.0 yes | OK |
| Named ranges (defined names) recalculated | core/src/calc/engine.ts (names) | Not a B-item. A correctness fix inside B15/B22 recalculation (07 l.273 "found by the large stand-in corpus and fixed in S8.3") | 4.2.0 yes | OK (a fix inside an approved feature) |
| Linked workbooks: wizard *+ Add a linked workbook…*; deck remembers links; a missing one is reported and the rest opens; cross-workbook formulas recalculated | app/src/wizard/Wizard.tsx:174; app/src/ui/Chrome.tsx:86 | B22; 2026-10-16 Phase 0 ("linked workbooks by sheet id, same-folder files") | 4.2.0 yes | OK |
| Issues panel "Formulas" line with *Check* (exact / volatile / locale / hidden / external / unreadable / different) | app/src/ui/Chrome.tsx:52 | B24 | 4.2.0 yes | OK (but see BEH-3: "hidden" changed meaning after 2026-10-18) |
| Page about 2 MB bigger; formula engine loaded on first use | helper/slide_builder.html (1,514,306 → 3,915,224 bytes overall; S7.2 alone +2.0 MB: 1,539,586 → 3,540,517); core/src/calc/engine.ts:30 (dynamic import) | B23 (PLAN says "≈ 2.8 MB") | 4.2.0 yes | OK. The CHANGELOG figure matches the measurement; PLAN's 2.8 MB is the design estimate (BEH-6, low) |
| Two consulting designs, Consulting Navy and Consulting Red, in the design switch; exhibit tables, KPI line, message panel | app/src/ui/Topbar.tsx:252; core/src/render/consult-*.ts, exhibit.ts | B25, B26; 2026-10-16 "M7b Phase 0 approved"; 2026-10-16 pixel review direction; 2026-10-17 "M7b S7b.3 signed off" | 4.2.0 yes | OK (S7b.5 final sign-off still open: BEH-5) |
| **Look ▾** in the top bar plus Design… › Layout: 36 looks | (removed at d83e9dd) | 2026-10-17 S7b.3 ("keep all of the combinations for now in a dropdown"); removed by B29 | 4.2.0 yes, removed in 4.4.0 | OK, but the user never had it (BEH-4) |
| Export names "weekly - Chief - Consulting Navy.pdf"; new *PDF · every version × all five designs* item | app/src/ui/Topbar.tsx:206; core/src/export/names.ts:20 | B25 ("a new 'every version × all five designs' export item"); B11 | 4.2.0 yes | OK |
| 4.0/4.1 opens a consulting deck in Liquid Glass and keeps its settings | core/src/model/style.ts (isDesign) | 08 §3 (approved 2026-10-16) | 4.2.0 yes | OK |
| Charts: *Insert chart ▾* (from selection / *Choose the cells…*), select, drag, resize, Del, side panel (pie/donut, labels, legend, title, colour per slice), each design's look, follows reloads and scenarios | app/src/ui/TableTools.tsx:237; app/src/ui/ChartPanel.tsx; core/src/render/chart-dl.ts | B16; G6 signed off 2026-10-18 (colour per slice asked in the same session); 2026-10-19 "Cells … chosen in the sheet view, never typed" | 4.3.0 yes | OK |
| Charts from any listed sheet, including one that is on no slide; hidden sheets stay hidden | app/src/ui/PickCells.tsx; core/src/model/preset.ts (itemSheets) | 2026-10-18 hidden sheets (WB-18); 2026-10-19 sheet view | 4.3.0 yes | OK |
| Callouts: 6 shapes and 17 icons, text with {Sheet!C7} quotes, *Quote a cell…*, fill, border and text controls, the design's material | app/src/ui/TableTools.tsx:240; app/src/ui/ShapeTools.tsx; core/src/render/shape-dl.ts, icons.ts | B17; 2026-10-19 (Quote a cell… picks in the sheet view) | 4.3.0 yes | OK |
| Raw Excel draws text boxes, automated comments, notes, charts and callouts; + buttons, Comment… and Notes enabled | app/src/ui/TableTools.tsx:247; app/src/stage/Stage.tsx (addnote no longer excludes excel) | B19; 2026-10-18 "B19 parity differences signed off" | 4.3.0 yes | OK |
| Raw Excel: a shared table size made in another design is used as it is (fixedScale's correction removed) | core/src/render/layout.ts:110 | Follows from B19 (commit 9efd74e); not in B19's text | 4.3.0 yes | OK (a consequence of B19; covered by the parity sign-off only where corpus slides changed) |
| Issues: "Chart n: source … not found", "Callout n: … not found (shown as #REF)"; dashed placeholder on the slide | app/src/editor/issues.ts:17 | B24 | 4.3.0 yes | OK |
| Decks with charts or callouts open in 4.0–4.2 without them | core/src/model/ops.ts (item.patch skips unknown kinds) | 07 §2.2 (Phase 0 2026-10-16) | 4.3.0 yes | OK |
| Free layout: per slide and per design, drags, snapping (Alt), one undo step per drag; *Reset layout* asks "Back to automatic layout?"; free places kept | app/src/ui/TableTools.tsx:232; app/src/editor/free.ts:26; app/src/stage/drags.ts | B18; **G7 signed off 2026-10-19** (border handles scale the whole table) | 4.4.0 yes | OK |
| Gridlines ▾ › Selected cells (H, V, Outline, colour, weight 0.5–3 px, Clear); a separate layer; a border wins | app/src/ui/TableTools.tsx:102 | B20; 2026-10-19 "Cell gridlines and cell borders are separate"; G7 | 4.4.0 yes | OK |
| Borders ▾: Bottom/Top/Left/Right/All/Outside/Thick outside/No border, style, colour, *Clear (as in Excel)*; slide only; drawn where workbook borders are drawn | app/src/ui/TableTools.tsx:209 | B28; 2026-10-19 (same entry); G7 | 4.4.0 yes | OK |
| The format painter copies cell gridlines and borders | app/src/editor/painter.ts (gridOps) | B20 ("copied by the painter"), B28 | 4.4.0 yes | OK |
| Composable consulting looks: one selector per part on ribbon 2, per slide (dot), *Apply to all*, *Deck's*; Look ▾ and Design… › Layout removed | app/src/ui/TableTools.tsx:262; app/src/ui/LookTools.tsx:35 | B29; 2026-10-19 "Composable consulting looks" | 4.4.0 yes | OK |
| "Slides with their own look show the deck's look in 4.0–4.3" | CHANGELOG.md:59 | B29 | 4.4.0 yes, but **inaccurate** | candidate BEH-4 (4.0/4.1 show no consulting design at all; should say 4.2–4.3) |
| Decks with a free layout, gridlines or borders open in 4.0–4.3 with the automatic layout and the workbook's borders | core/src/model/ops.ts (SLIDE_MAPS / TABLE_MAPS) | 07 §5 (Phase 0) | 4.4.0 yes | OK |
| PowerPoint export: *PowerPoint · all slides / current slide*, *PDF + PowerPoint*, versions switch (PDF · PowerPoint · both), Run for each value *Files: PDF · PowerPoint*; downloads from disk | app/src/ui/Topbar.tsx:192, 202; app/src/ui/ScenarioDialog.tsx:147; helper/slidebuilder/exports.py:64 | B21 (amended 2026-10-19); **G8 not signed off** (Waiting for 2026-10-20) | 4.5.0 yes | OK for cover; see BEH-2 (gate) |
| What is in the .pptx: placeholders, real tables, native pie/donut, callouts as shapes, master and layouts from the deck, no connectors or links | core/src/pptx/scene.ts, writer.ts, chart.ts | B21 amended; 2026-10-19 "PowerPoint: slide masters generated, standardised and lean" | 4.5.0 yes | OK |
| Fonts named, not embedded; library fonts named in the toast | app/src/editor/export.ts:87 | B21; 2026-10-16 Phase 0 ("PowerPoint fonts named, not embedded") | 4.5.0 yes | OK |

**Part 1 count:** 31 CHANGELOG items. 30 are mapped to a B-item, a dated Decision or a signed gate. One line is
inaccurate (BEH-4). The B15 and B21 items rest on gates G5 and G8, which are still open (BEH-1, BEH-2).

## Part 2 · Visible behaviour changes found in the code diff (app/src, core/src, helper)

| Change | Where (path:line at d83e9dd) | Covered by (B-n / Decision date / gate) | CHANGELOG (version, yes/partial/none) | Verdict |
|---|---|---|---|---|
| Hidden sheets are read **for calculation only** (progress text "Reading the hidden data sheets…"); the Formulas line's "read a hidden sheet" now means only a hidden sheet that could not be read | core/src/worker/host.ts:188-201; core/src/calc/engine.ts:42 | Decisions 2026-10-18 "The formula engine reads hidden sheets, for calculation only" (after G5, commit 9c7b806) | **none**. The 4.2.0 entry was written 2026-10-17 (6007c2d) and was not updated | candidate BEH-3 |
| Run/preview say when a value moves no formula ("no formula changed with this value of X") | app/src/ui/Chrome.tsx:133; app/src/editor/scenario.ts | After-G5 fix 2026-10-18 (PROGRESS M8 "After G5"); within B15 | none | BEH-3 (same CHANGELOG gap) |
| *Select cell…* button opens the sheet view to pick the input cell (one cell, shown red) | app/src/ui/ScenarioDialog.tsx:24, 118 | After-G5 fix 2026-10-18; within B15 | none | BEH-3 |
| Cells reading a linked workbook that is not in the folder, or an unreadable hidden sheet, keep Excel's saved value; the run report lists "Kept at Excel's own value in every file…" | app/src/ui/ScenarioDialog.tsx:186; core/src/worker/host.ts:300 | After-G5 fix 2026-10-18 (8fea458, 6cbc28f); 07 §8 Q8 "keep and mark" | none | BEH-3 |
| `A:INDEX(…)` / `INDEX(…):INDEX(…)` ranges rewritten so they recalculate | core/src/calc/rangeindex.ts | After-G5 fix 2026-10-18; a correctness fix inside B15 | none (not user-visible except as correct numbers) | OK |
| Formulas line also lists "names not recalculated: …" | app/src/ui/Chrome.tsx:67 | B24 (S8.3 defined names) | partial (4.2.0 names "Named ranges … recalculated", not the skipped ones) | OK (low) |
| Scenario banner: "n TEXT cells not formatted (previous text)" | app/src/ui/Chrome.tsx:133 | 2026-10-17 S8.4 (a cell it cannot match is kept and marked) | none | OK (low; could join the BEH-3 line) |
| *From a range…* reads at most 5,000 cells; line breaks in cells become spaces | app/src/ui/ScenarioDialog.tsx:19, 43 | B15 (UI detail, not decided) | none | OK (low) |
| Scenario file names: "Full deck" for the full deck in a multi-version run, "(blank)" for an empty value, a reserved device name prefixed "_", values cut to fit a 240-character path | core/src/export/names.ts:39-90 | B15 + 07 §2.5 (S8.2, audit SEC-6) | partial (4.2.0 gives the patterns and " (2)") | OK (low) |
| Wizard *Add a linked workbook* lists 12 workbooks at most; linking works only when served by the helper (never from a page opened from disk) | app/src/wizard/Wizard.tsx:177; app/src/state/app.ts:243 | B22; S7.3 ("never from disk-opened pages") | partial ("lists the other workbooks of the folder") | OK (low). The from-disk limit is worth one CHANGELOG clause (BEH-7) |
| Issues: "Linked workbook “X” not found in the folder…"; the wizard shows lost-link sheets as "not found in the folder" | app/src/ui/Chrome.tsx:86; app/src/wizard/Wizard.tsx | B22 | yes (4.2.0 "reported as missing") | OK |
| Theme picker in a consulting design: new "Design palette" button; built-in themes and Custom disabled when "All designs" is the scope (tooltip explains); the shared theme never applies to a consulting design | app/src/ui/Topbar.tsx:69-70; core/src/model/style.ts:29 | 2026-10-16 M7b Phase 0 ("every recommendation of 08 §6", Q4) | partial (4.2.0 "Each design has its own colours") | OK (low; BEH-7 suggests one clause) |
| Design-switch tooltips: Excel "…your text boxes, comments, notes, charts and callouts are drawn too"; Excel Refined loses "with comments and text boxes" | app/src/ui/Topbar.tsx:251 | B19 (S9.5 review) | yes in substance (4.3.0 B19) | OK |
| Text styles dialog: "This design only – Consulting Navy/Red"; colour rows list the five designs | app/src/ui/TextStylesDialog.tsx | B25/B26 | yes (implied) | OK |
| Keys on a selected chart or callout: Delete **and Backspace** remove it; **Enter or F2** edits a shape's text; **Esc** deselects; in the callout editor **Ctrl+Enter** applies and Esc cancels | app/src/editor/keys.ts:25-30; app/src/stage/editors.tsx:76 | B16/B17 (S9.3/S9.4) | partial (4.3.0 says Del, double-click or Enter) | OK (low; BEH-7) |
| Status bar texts for a selected chart / slice / shape / icon, and for the KPI line or panel | app/src/ui/Ribbon.tsx (selStatus) | B16, B17, B29 | none (status texts never listed) | OK |
| Alignment buttons greyed for a look text (KPI line / panel) | app/src/ui/Ribbon.tsx:83 | B29 | partial ("font, size, bold and colour") | OK |
| *Free layout* is enabled only on content slides (not cover or contents); *Position ▾* is disabled while a slide is in free layout | app/src/ui/TableTools.tsx:217, 232 | B18 / G7 | none | OK (low; BEH-7) |
| Consulting exhibit tables: no column or row border drag; a click selects the drawn cell; a cell the exhibit does not draw is edited at its row label | app/src/stage/hit.ts:17; app/src/stage/editors.tsx | B25/B26 (S7b.2), new designs only | none | OK (no existing behaviour changes) |
| Tables dialog sizes use the design's geometry (`tableH`), which differs from before only for exhibit tables | app/src/ui/TablesDialog.tsx:35 | B25/B26 | none | OK (no change for the old three designs) |
| Export ▾ gains a "PowerPoint – …" section, a "Scenarios" section, a file-count hint on "all three designs" when two formats are chosen | app/src/ui/Topbar.tsx:190-210 | B21, B15, B25 | yes | OK |
| Saved toast: "· ⚠ the PDF / the PowerPoint file could not be made: …" when one of the two fails | app/src/editor/export.ts:166 | B21 (S11.4, PX-01) | partial ("PDF + PowerPoint makes both at once") | OK (low) |
| Versions export busy text "Exporting N files…" / toast "Saved N files" when PowerPoint is chosen | app/src/editor/export.ts | B21 | yes ("Saved N files" for runs) | OK |
| Thumbnails draw the previewed scenario | app/src/editor/export.ts (thumbs scenario "preview") | B15 preview | partial (implied by "on the slides") | OK |
| Cover and contents slides list their charts' and callouts' issues | app/src/editor/issues.ts | B24 | yes in substance | OK |
| Helper accepts `.pptx` exports (zip check) and nothing else changes in routes, limits, start files or the updater | helper/slidebuilder/exports.py:64-90 | B21 | yes (implied) | OK |
| Removed: *Look ▾* topbar dropdown and *Design… › Layout* | (absent at d83e9dd; removed in f755d45) | B29 | 4.4.0 yes | OK (BEH-4: added and removed while unreleased) |
| Removed: "raw Excel shows the workbook only" tooltips and disabled text-box / comment / notes buttons in Excel | app/src/ui/TableTools.tsx:247-252 | B19 | 4.3.0 yes | OK |

**Part 2 count:** 28 changes found. 27 map to a B-item, a Decision or a gate. None has zero cover, but 4 are
missing from the CHANGELOG: the after-G5 group, BEH-3.

## Candidate findings

### BEH-1 · G5 (B15, Run for each value) is merged and versioned but never signed off
*Evidence:* PROGRESS.md:444-451, "M8 · gate G5, for the product owner (2026-10-17)", is still open in Waiting for and
is not struck through. Decisions has no G5 entry. PROGRESS.md:427 ("4.2.0 and 4.3.0 are still untagged (G5)") and
PROGRESS.md:437 (M9 item (2): "either sign off G5 and release 4.2.0 from main first, then 4.3.0 … or release once as
4.3.0") record the question, but no answer is recorded. The 2026-10-18 "After G5" deck work (9c7b806…6cbc28f) is not
a sign-off. Also open from G5: "a FILTER whose result shrinks leaves #VALUE!", with "proposed: show them empty".
*Fix:* the product owner signs G5 (or lists changes) in Decisions, and answers the FILTER #VALUE! item.

### BEH-2 · G8 (B21, PowerPoint) is open at the audited commit
*Evidence:* PROGRESS.md:407-415 lists G8 under Waiting for (2026-10-20), with four items "to judge": substituted fonts
are not named in a run's report, page numbers are static text, tables are grouped with their card, and Liquid Glass
slides have about 300 shapes. Decisions has no G8 entry. (The session notes outside the repo suggest an oral sign-off
on 2026-10-20 that was "to record in PROGRESS". It is not in the repo at d83e9dd.)
*Fix:* record the G8 sign-off with its date and a quote, plus the owner's view on the four items. Until then, 4.5.0
should not be released.

### BEH-3 · The CHANGELOG 4.2.0 entry predates the after-G5 changes (2026-10-18)
*Evidence:* the CHANGELOG was last edited for 4.2.0 in 6007c2d (2026-10-17). Commits 9c7b806, 8fea458 and 6cbc28f
(2026-10-18) add visible behaviour:
* hidden data sheets are read for calculation (Decisions 2026-10-18), with a progress line;
* "no formula changed with this value of X" in the banner and the report;
* *Select cell…* for the input cell;
* cells that read a missing linked workbook or an unreadable hidden sheet keep Excel's value, and the run report
  lists them.

None of these is in the CHANGELOG. The 4.2.0 Formulas-line text "read a hidden sheet" now means only a hidden sheet
that could not be read.
*Fix:* add to 4.2.0, for example: "Hidden data sheets are read for calculation only: they stay out of the wizard and
the slides (decided 2026-10-18). *Select cell…* picks the input cell on the sheet. A value that changes no formula is
said so. Cells that read a workbook not in the folder keep Excel's saved value, and the run's report names them."

### BEH-4 · Unreleased intermediate versions: the CHANGELOG describes states users never had
*Evidence:* there are no tags after v4.0.0. The live share runs 4.0.0 (PROGRESS.md:247). Sections 4.1.0–4.5.0 all say
"unreleased" while the tree is versioned 4.5.0. 4.1.0 is tied to S6.5, "not yet allowed" before about 2026-11-12
(PROGRESS.md:69). 4.2.0 adds the *Look ▾* dropdown (CHANGELOG.md:139) and 4.4.0 removes it (CHANGELOG.md:58), so no
user ever saw it. CHANGELOG.md:59 says "Slides with their own look show the deck's look in 4.0–4.3", but per 4.2.0's
own line, 4.0 and 4.1 open consulting decks in Liquid Glass (it should say 4.2–4.3). The release sequence (4.1 with
S6.5, then 4.2… or one combined release) is not decided in Decisions. The only text is Waiting for M9 (2),
unanswered.
*Fix:* (a) the owner decides the release plan (one 4.5.0 release, or 4.1.0 first after S6.5) and records it in
Decisions. (b) Before the tag, fold or annotate the unreleased sections: drop or mark the Look ▾ text in 4.2.0 as
"replaced in 4.4 before release", and correct "4.0–4.3" to "4.2–4.3" on CHANGELOG.md:59. (c) Check that the
release-checklist's `--notes` for the chosen version covers all the unreleased sections.

### BEH-5 · M7b final sign-off (S7b.5 🚦) never recorded
*Evidence:* PROGRESS.md:452-457, "M7b done … (1) **final sign-off** of M7b (S7b.5 🚦)", is not struck through. Only
S7b.3 is signed (Decisions 2026-10-17). The four accepted dlparity differences (PROGRESS.md:458-462) depend on
"say so if you do not accept them", which is passive acceptance. M7b is merged and B29 later replaced its Look
dropdown.
*Fix:* record the final M7b sign-off (or note that it was superseded by the B29 decision and G7/G8), and the explicit
acceptance of the four digests.

### BEH-6 · B23 size figure (low)
*Evidence:* PLAN §8 B23 says "≈ 2.8 MB". The CHANGELOG says "about 2 MB". Measured: S7.2 grew the page by 2.00 MB
(1,539,586 → 3,540,517 bytes). From 4.1 to 4.5 the page grew by 2.40 MB in total (1,514,306 → 3,915,224).
*Fix:* align PLAN B23 with the measurement, or add to the CHANGELOG that the whole 4.2–4.5 growth is about 2.4 MB.

### BEH-7 · Small visible details missing from the CHANGELOG (low; all inside approved B-items)
* Free layout is available on content slides only, and *Position ▾* is disabled in a free layout (B18).
* In a consulting design, colour themes chosen for "All designs" do not apply. The built-ins are greyed there and a
  "Design palette" button exists (08 §6 Q4, approved 2026-10-16).
* Linked workbooks need the helper: a page opened from disk cannot link (B22).
* Keys: Backspace, F2, Esc on items; Ctrl+Enter in a callout's editor (B16/B17).

*Fix:* one clause each in the relevant section, or accept them as covered by the B-item text.

## Release / tagging status (as recorded in PROGRESS at d83e9dd)
* v4.0.0 is tagged and live (2026-10-15).
* 4.1.0 is not prepared as a release. S6.5 (remove the v3 start file) waits for 4 weekly cycles, so not before
  about 2026-11-12.
* G4: measured on a stand-in by decision (2026-10-17, "G4 stands on the stand-in's numbers"). No real-deck numbers
  were recorded as the gate asked; the 2026-10-18 real-deck analysis (1,369 of 1,384 exact) is in Steps, not as a
  sign-off.
* G5: open. G6: signed 2026-10-18. G7: signed 2026-10-19. G8: open.
* 4.2.0 and 4.3.0 are "still untagged (G5)" (PROGRESS.md:427, 437). No decision was recorded on whether to release
  4.2 → 4.5 one by one or once. Versions on main are already 4.5.0.
