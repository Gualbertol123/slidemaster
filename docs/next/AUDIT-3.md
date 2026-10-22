# AUDIT-3 · Slide Builder 4.6–4.9: persistence and compatibility (M17, 09 §6)

Independent persistence and compatibility audit of the releases after AUDIT-2, 2026-10-22: 4.6.0 + B47–B50
(`origin/main` = 71d8806), 4.7.0 M14 charts (`v4/M14-charts` = d327882), 4.8.0 M15 lines / icons / snapping
(`v4/M15-lines-icons` = f647ed7) and the 4.9.0 M16 step branches (`m16/hidden-rebased` a901c22,
`m16/delete-versions-rebased` 9985882, `m16/painter-main` 9e80f33, `m16/excel-cf-main` 35e1af7, `v4/slide-menu`
c47d59a). The integration branch `v4/M16-tables` was still being built (7a0ae85: hidden, delete-versions, Excel CF and
slide menu merged; **painter and M15 not yet in it**), so it was read but not run. Scope: 09 §6 line by line, §1's
format guard against the real old versions (CP-01), every new op / key (vectors, inverse, `knownOp`, `needsV5`), older
pages meeting new data, two writers, undo, journal / snapshot storage, PowerPoint rules, helper on Python 3.8. No fix
was made (this task routes reproductions to the orchestrator).

## Summary verdict

**Not yet for the share as 4.9: one high data-loss finding.** The format guard of 4.6 (ADR-019) holds against
4.0–4.5 – CP-01 re-run here with the real 4.0.0 / 4.1 / 4.4 / 4.5 helpers and pages (§6). But 4.9 reuses format 5,
so **4.6.0, 4.7.0 and 4.8.0 pages open 4.9 decks**, and their wizard's *Save preset* (a whole `preset.set`) erases
4.9's deleted rows / columns of every version (`drop`) and, before the next 4.9 compaction, the version itself and
the slides' hidden rows / columns (`hidden`) – for everybody, silently (COMPAT-1, reproduced with the real 4.6.0
page and the 4.8 page against the 4.9 page, §6). The same old pages also **export** a 4.9 deck's versions with the
deleted rows and the slides with the hidden rows present – a disclosure risk for a feature whose purpose is "the same
deck for another audience". 09 §1 allows a later release to "reuse format 5 … and extend `knownOp`"; `knownOp` stops
an old page's compaction but not its whole-value ops or its exports. Fix proposed: 4.9 raises decks holding `drop` /
`hidden` (and cell `num`) to **format 6** the way 4.6 raised to 5 (the machinery exists; §8).

What holds, with evidence below:
* **Every new op and key has its guard.** `version.patch` (new op), slide map `hidden`, cell `valign` / `num`: in
  `knownOp` (`ops.ts` SLIDE_MAPS / CELL_KEYS / `case "version.patch"`), `needsV5` (the op falls to `return true`;
  the keys are outside 4.0's frozen V40 lists) and `docNeedsV5` (V5_SLIDE `hidden`, V5_VERSION `drop`, V5_CELL
  `valign` / `num` – present since 4.6), inverses (`inverseOf` version.patch create ↔ delete, per sheet entry; the
  map merge for `hidden`; per key for cells), vectors (`m16-hidden.json`, `m16-versions.json`, `m16-cells.json`,
  `m15.json`, M14's in `ops-vectors.json` from S14.P). M14 and M15 add **no** op or key beyond 4.6.0's lists
  (`git diff v4.6.0 v4/M15-lines-icons -- core/src/model/ops.ts` is empty; M14 adds only `points[i].total` inside a
  series entry, which 4.6.0 keeps whole). Narrow runs green: M14 `vectors` + `docsync` 44/44; M16 `vectors` +
  `versions-m16` + `hidden-m16` 52/52.
* **4.0–4.5 cannot open, append to or compact a format-5 deck holding 4.7 objects** (CP-01 on the 4.7 page, §6).
* **Helper**: unchanged in M14–M16 (`git diff origin/main...<branch> -- helper/` touches only the version);
  compiles on Python 3.8.20 (`compileall` of `v4/M16-tables:helper`), and CP-01 ran the 4.7 helper on 3.8.20.
* **Saved fixtures** only added (`charts-4.7`, `lines-4.8` since 4.6.0; `hidden-4.9`, `versions-4.9`,
  `cells-4.9`, `cf-edits-4.8` in M16); none edited or removed on any branch; `golden/` untouched.
* **PowerPoint rules**: charts stay native `c:chart` with an embedded workbook (`c:externalData` → an internal part,
  `autoUpdate 0`); lines are `p:sp` custGeom (no `p:cxnSp` anywhere in `core/src/pptx` on any branch); Excel's data
  bars and icons are `p:sp` shapes beside a real `a:tbl` (`scene.ts` `cf` marks, excel-cf-main); `p:pic` only for
  images (logo, Liquid Glass wallpaper), never for a table or a chart; no `TargetMode="External"`.

| Severity | Finding | State |
|---|---|---|
| **high** | COMPAT-1 a 4.6–4.8 page's wizard erases a 4.9 deck's version `drop` (and, before compaction, the version and slide `hidden`); its exports show deleted / hidden rows | reproduced; fix proposed (format 6) |
| medium | DATA-8 a version whose deleted rows / columns would leave a table empty exports that table **whole** (fail-open); only the on-screen Issues panel says so | reproduced by its own test; decision |
| medium | VER-4 CP-01 has no case for M15 or M16 objects (only `m14`); COMPAT-1 is exactly what it would have found | proposal |
| low | VEC-1 `points[i].total` (4.7) has no ops vector | proposal |
| low | REL-2 the M16 step branches' committed pages are stale (`helper/slide_builder.html` not rebuilt: build.test fails on them) and their CHANGELOG has no 4.9 lines yet | integration |
| low | UNDO-1 undoing a version's delete re-creates it at the end of the list | info / CHANGELOG |
| info | INT-1 `v4/M16-tables` is based on M14 without M15 (4.8.0) and, at 7a0ae85, without the painter (CELL_KEYS lacks `valign` / `num`) | integration |
| info | VEC-2 S13.7 appends to `shared/ops-vectors.json` instead of its own `ops-vectors.d/*.json` (the README's rule) | proposal |

## 0. Method

* Scratch clones (never the existing worktrees): `git clone --branch v4/M14-charts /home/user/slidemaster
  /home/user/sb-audit` and `--branch m16/delete-versions-rebased … /home/user/sb-audit16`; `npm ci` (Node from the
  machine, Playwright's Chromium at /opt/pw-browsers); in sb-audit16 `npm run build` (the branch's committed page did
  not contain `version.patch`: REL-2).
* Code read with `git show` / `git diff` across the branches: `core/src/model/ops.ts`, `types.ts`, `preset.ts`,
  `versions.ts`, `slidecopy.ts`, `core/src/pptx/*`, `app/src/wizard/Wizard.tsx` (4.6.0 and 4.9), `app/src/state/app.ts`
  `openWizard`, `app/src/editor/versions.ts`, `helper/` (diff only), the vectors and the saved fixtures.
* CP-01: `tools/compat-old.mjs` of `v4/M14-charts` (cases cp02, m14, a, b, c, d; journal and lean-lock), old helpers
  on Python 3.13.16 (`python3`), this checkout's 4.7 helper on **Python 3.8.20**, `--bump-wait-s 2` (to fit the
  time box; see §6 on lean-lock), `--port 9101`.
* COMPAT-1's reproduction: `cp-m16.mjs` (compat-old's harness + one case; copy in the session scratchpad,
  `/tmp/claude-0/-home-user-slidemaster/4fb43ab1-9eca-523a-96c3-6cf7e5f53e28/scratchpad/cp-m16.mjs`): the 4.9 page
  (delete-versions, rebuilt) makes a deck, a version `All` with `drop: {SLIDE_1: ["5:5"]}` (one `version.patch`) and a
  hidden row on the first content slide (one `slide.patch hidden`); then the real 4.6.0 (v4.6.0) page, and the 4.8
  page (f647ed7), on their own helpers, open the deck, *Continue*, run the wizard to Finish; the folded deck is read.
* Narrow unit runs only (the machine is shared): `npx vitest run` of single files; no e2e was run.

## 1. Build and tests

Not the full protocol (the orchestrator runs it). Run here: M14 `core/tests/vectors.test.ts` +
`docsync.test.ts` **44 passed**; M16 delete-versions `vectors` + `versions-m16` + `hidden-m16` **52 passed**;
`npm run build` on delete-versions (4,037 kB page); `python3.8 -m compileall helper` of `v4/M16-tables` ok.

## 2. 09 §6 line by line

"Code" = what the auditor read; "Guard" = the test that exists (test id found in the branch); a ✗ is a finding.

| # | State | Saved as / merge / undo / fold | Exports | Reopen / older pages | Guard found | Verdict |
|---|---|---|---|---|---|---|
| 1 | `sers` | item.patch map, per entry, inverse per entry; OV "M14 sers two writers both win" + fold in any order | native `c:ser` + caches | FX `charts-4.7.json`; 4.6.0 keeps whole, compacts (CP-01 m14 on 4.6p in M14's own run, PROGRESS); 4.0–4.5 refused (here) | U CT-01…, E CT-05, OV | PASS |
| 2 | groups, axes, marks, legendHide | maps per entry; OV fold "marks, groups and legendHide … merge per entry" | marks as shapes over the chart | FX | U, OV | PASS |
| 3 | chart plain keys | per key | as 1 | FX | OV, U | PASS |
| 4 | line items | item.patch kind `line`; OV "two writers on one line" | `p:sp` custGeom, never `cxnSp` (grep, all branches) | FX `lines-4.8.json` | U, E LN-01 | PASS |
| 5 | icons | item.patch `icon`, `stroke` | stroked path / custGeom | FX | U, E IC-01, sha256 of the vendored data (`icons.test.ts`) | PASS |
| 6 | slide `hidden` | slide.patch map `hidden` (SLIDE_MAPS), per entry; OV `m16-hidden.json` | closed up | FX `hidden-4.9.json`; **4.6–4.8 pages show and export the hidden rows, and their wizard drops `hidden` before a 4.9 compaction** | U `hidden-m16.test.ts`, E HR-01 | ✗ COMPAT-1 |
| 7 | version `drop` | new op `version.patch` (knownOp, needsV5, inverse create ↔ delete, per sheet), OV `m16-versions.json` | each version's lists | FX `versions-4.9.json`; **4.6–4.8 pages open the deck, export the version with the deleted rows, and their wizard erases `drop`** ; a version deleting every row of a table exports it whole | U, E VD-01…03 | ✗ COMPAT-1, DATA-8 |
| 8 | cell `valign`, `num` | cell.patch keys (CELL_KEYS on painter-main), per key | DL; PowerPoint anchor / text | FX `cells-4.9.json`; 4.6–4.8 pages ignore them (draw Excel's format; visual only, no loss: cell.patch merges per key) | U `cells-m16.test.ts` (needsV5), E PT-01 | PASS (4.6–4.8 render differently: covered by the COMPAT-1 fix) |
| 9 | painter results | existing ops, one change() per paste | as those ops | – | E PT-01…03 | PASS |
| 10 | new slides | slide.add / remove (4.6), Duplicate = one slide.add of `copySlide` (items under new ids, `i:` free-layout keys and line ends renamed) | every export | FX `slides-4.6.json` | OV "two adds after one slide", E NS-01, `slidemenu.test.ts` | PASS |
| 11 | tables added | table.add / remove | every export | FX | OV, E NS-02 | PASS |
| 12 | snapped positions | existing ops | – | – | E SN-03 (M15) | PASS (not run here) |
| 13 | format 5 | snapshot | – | 4.0–4.5 refuse (CP-01 here); **4.6–4.8 read it although 4.9 objects are in it** | helper tests; CP-01 | ✗ COMPAT-1, VER-4 |
| 14 | Excel CF results | none (workbook) | fills / bars / icons as `p:sp`, cell fills given up under a bar (`scene.ts` buildTable) | – | U | PASS |
| 15–16 | icon picker state; vendored icon data | UI only; the page | – | – | sha256 test | PASS |
| 17 | icon names across Tabler updates | the item's `icon` | – | – | U aliases | PASS (not run) |
| 18 | titleFmt, line fmt, `points` | maps / inside a series | as 1 / 4 | FX | OV "two writers, one series"; **no vector carries `points[i].total`** | PASS with VEC-1 |
| 19 | `incident-format-5.json` | helper, O_EXCL | – | 4.0–4.5 read-only (CP-01 probes: append / prepare / compact 423, open / snapshot / rotate 409) | helper test; CP-01 | PASS |

## 5. Ops and storage (logic)

* `version.patch` (`ops.ts`, delete-versions): `name` creates (appended, `hide: {}`), `null` deletes, `hide` / `drop`
  merged per sheet with each sheet's list whole; `knownOp` = `p === null || only(name, hide, drop)`; `needsV5` true
  (an op 4.0 lacks); inverse: create → `null`; delete → a create with name / hide / drop (at the end: UNDO-1); per
  sheet otherwise (`hide: null` → each sheet's list back; `drop: null` → the whole map, or `null` when it was empty).
  Two writers on one sheet: the later list wins (Lamport) – documented in the type.
* The wizard (4.9) still writes versions by a whole `preset.set`, rebuilding each version as `{id, name, hide,
  drop?}` (`Wizard.tsx:143-144`): a later version's key would be lost the same way as COMPAT-1 – the fix should spread
  the version (`{...v, …}`) as slides and tables already are (`{...s}`, `{...t}`).
* Journal / snapshot storage: no helper or DocSync change in M14–M16; `nextSnapshot` keeps `max(format, docNeedsV5 ?
  5 : 4)`; a 4.9 deck stays 5.
* `copySlide` (S13.7): renames `items` ids, `free.*.items` `i:` keys and line `ends.*.to`; tables, notes, `hidden`,
  `hide`, `looks` are copied as they are (shared tables – correct).

## 6. Data safety

| Check | Result | Evidence |
|---|---|---|
| CP-01 on the 4.7 page (M14) against real 4.0.0, 4.1, 4.4, 4.5 + 4.6 (e6c1c4f), 4.6p (v4.6.0) | see the run table below | `cp01-m14.json` / `.log` in the scratchpad |
| A 4.9 deck (version `drop` + slide `hidden`, records still in the journal) and the **4.6.0** page's wizard Finish | **FAIL → COMPAT-1** | `RESULT m16 4.6p: FAIL` want `drop {"SLIDE_1":["5:5"]}`, `hidden {"<t>:r6":true}` → got `drop null`, `hidden null`, and `versions` gone altogether (the 4.6 page skips `version.patch`, so its preset had no version; its whole `preset.set` folds after it) |
| The same with the **4.8** page (f647ed7) | **FAIL** | the same result |
| The same after a 4.9 compaction folded both (`WAITC=1`: snapshot gen 4 holds them) | **FAIL** for `drop`, PASS for `hidden` | 4.6p and 4.8: `versionsAfter: [{"id":"vAll","name":"All","hide":{}}]` – `drop` lost; `hidden` kept (the old wizard spreads slides `{...s}` but rebuilds versions field by field, `v4.6.0:app/src/wizard/Wizard.tsx:141-145`) |

CP-01 results (M14 page, 4.7 helper on Python 3.8.20; `--bump-wait-s 2`):

| Old version | CP-02 | m14 | a | b-journal | c-journal | b-lean-lock | c-lean-lock | d |
|---|---|---|---|---|---|---|---|---|
| 4.0.0 | PASS | PASS (open 409, snapshot unchanged) | PASS | PASS | PASS | FAIL* → **PASS** with the real 23 s wait | PASS (→ PASS with 23 s) | PASS |
| 4.1 (061a5b3) | PASS | PASS | PASS | PASS | PASS | FAIL* | PASS | PASS |
| 4.4 (a1d3aba) | PASS | PASS | PASS | ERROR** | not reported (c-journal follows b-journal) | FAIL* | FAIL* | PASS |
| 4.5 (637f7b4) | PASS | PASS | PASS | PASS | PASS | not run (the background run hit its 30 min limit) | not run | not run |
| 4.6 (e6c1c4f) | PASS | PASS (opens, saves its edit, never compacts the 4.7 keys) | – | – | – | – | – | – |
| 4.6p (v4.6.0) | PASS | PASS (compacts gen 4, every M14 item byte-equal, `points[2].total` kept) | – | – | – | – | – | – |

\* the shortened `--bump-wait-s 2` (below). \*\* harness: `#fileName` not visible within 30 s on a loaded machine
(load average 11; the same locator resolved to a hidden element in the auditor's own script while the page was open
– a screenshot showed the deck opened), not a product failure. Every case whose deck was checked reports
`missing46: []` and no 4.7 item changed. Logs: `cp01-m14.log`, `cp01-m14-b.log`, `cp01-m14-ll.log` in the scratchpad.

`b-lean-lock` on 4.0 failed with the shortened wait: the old page's edit typed after the raise was appended to the
shared journal (`oldRecordsFoldingAfter46: 1`, a `cell.patch`, Lamport 1048582). This is the known dependence of the
lean-lock wall on the real 23 s wait (PROGRESS M14: "an earlier try with `--bump-wait-s 0` failed only b/c-lean-lock
on 4.0, as the helper's own warning says it must"); re-run on 4.0 with the real wait (`--cases b,c --modes lean-lock`, no `--bump-wait-s`): **b-lean-lock PASS, c-lean-lock PASS**. Not a finding; 4.1 / 4.4 lean-lock with the real wait and 4.5 b/c/d were not re-run in the time box (they passed at the M14 close, PROGRESS).

## 8. Findings

Severity: critical · high · medium · low · info. Nothing was fixed in this task: each finding carries its
reproduction for the orchestrator to route.

**COMPAT-1 · high · 4.6–4.8 pages erase and leak 4.9's deleted / hidden rows**
* *Defect.* 4.9 decks stay `format: 5`, which 4.6.0–4.8.0 helpers and pages read (`READ_FORMATS = {4, 5}`). Their
  `knownOp` stops them compacting `version.patch` / `hidden` (correct), but (1) their wizard's Finish writes the
  whole preset (`v4.6.0:app/src/state/app.ts:644`, `openWizard`), building each version as `{id, name, hide}`
  (`v4.6.0:app/src/wizard/Wizard.tsx:141-142`), from a view that never applied `version.patch` or `slide.patch
  hidden` (skipped ops / keys): the `preset.set` folds after them and replaces them for every page, 4.9 included.
  The "slides were changed meanwhile" question does not fire (the old page's view did not change). (2) Their render
  and exports ignore `drop` and `hidden`: a version meant for another audience is exported with its deleted rows.
* *Reproduce.* In a clone of `m16/delete-versions-rebased` (after `npm ci`, `npm run build`): copy
  `/tmp/claude-0/-home-user-slidemaster/4fb43ab1-9eca-523a-96c3-6cf7e5f53e28/scratchpad/cp-m16.mjs` to `tools/`, then
  `CHROME=… node tools/cp-m16.mjs --versions 4.6p,4.8 --pythons python3 --new-python python3.8 --bump-wait-s 2
  --port 9201` → `RESULT m16 4.6p: FAIL`, `RESULT m16 4.8: FAIL` (drop and hidden null, the version gone);
  with `WAITC=1` (4.9 compacts first) → drop null, the version left as `{id, name, hide: {}}`. A unit-level
  reproduction for the fix: a `docsync` / fold test whose journal holds `version.patch {drop}` then a `preset.set`
  built as 4.6.0's `finish()` builds it, asserting the deck afterwards is format 6 (or the preset.set refused).
* *Proposed fix.* Per 09 §1's own rule "or bumps to 6 the same way": `needsV6(op)` / `docNeedsV6(doc)` for
  `version.patch`, a version's `drop`, a slide's `hidden` (and cell `num`, which changes what a number shows);
  `upgrade()` writes `incident-format-6.json` (an incident for every 4.0–4.8 helper → read-only) and CAS-writes the
  snapshot with `format: 6`; helper `READ_FORMATS = {4, 5, 6}`, refuses lowering 6, 409 for a page without
  `X-SB-Deck-Formats: 4,5,6`; CP-01 gets a case for 4.6p / 4.7 / 4.8 (VER-4). And in 4.9's own wizard: spread the
  version (`{...v, name, hide, drop}`), so a later key survives it.

**DATA-8 · medium · a version that would delete every row of a table exports the table whole**
* *Defect.* `runtimeSlides` (`core/src/model/preset.ts`, delete-versions: "a table the version would leave with no row
  or column keeps them all") draws the table with **every** row in that version; the page and the wizard refuse such
  a delete, but the code's own comment says "two writers' merge can reach it" (e.g. a table def changed by one writer
  while another deletes rows against the old range; the menu checks against the table as its own page sees it). Only `app/src/editor/issues.ts:29` (the slide on screen) says so; no export path reads `dropWhole`
  (`git grep dropWhole` → preset.ts, types.ts, issues.ts only). The rows a user deleted for an audience are in that
  audience's PDF / PowerPoint.
* *Reproduce.* `core/tests/versions-m16.test.ts` "a table the version would leave with no row … keeps every row"
  (`drop: {SLIDE_1: ["1:40"]}` → `x.slides[s].tables[*].rows` equal to the full deck's) – the behaviour is the test.
* *Proposed.* The owner decides: fail closed (draw the table's frame with no rows, or leave it out with a note) or
  keep it but refuse the version's export / every-version export with a note naming the slide, as the hidden-slide
  rule refuses an export with every slide hidden.

**VER-4 · medium · CP-01 does not cover M15 or M16** – `tools/compat-old.mjs` has `cp02, a, b, c, d, m14`;
`v4/M15-lines-icons` carries the 4.6.0 version of the tool (no `m14`, no lines / icons case), the M16 branches the
same. 09 §7.2 asks for CP-01 at every milestone close, and §6 row 13 for the old pages "4.0–4.5 refuse 5"; the case
that matters from 4.7 on is the 4.6 / 4.7 / 4.8 pages **reading** the deck. *Proposed:* an `m15` and an `m16` case
(the shape of `cp-m16.mjs`: make the objects in the new page, run the old 4.6p / 4.7 / 4.8 pages' edit **and wizard
Finish**, assert every object byte-equal), run at the M16 close.

**VEC-1 · low** – no vector holds `sers.*.points[i].total` (4.7's waterfall total; `ops-vectors.json` and
`ops-vectors.d/m14.json`, which is `[]`). It is kept whole inside the series entry (CP-01 m14 checks it end to end),
but the rule wants a vector: one item.patch case setting and clearing it, and its inverse.

**REL-2 · low** – `helper/slide_builder.html` is not rebuilt on `m16/hidden-rebased`, `m16/delete-versions-rebased`,
`m16/painter-main`, `v4/slide-menu` (`git diff --stat origin/main...<branch> -- helper/slide_builder.html` empty; the
committed page has no `version.patch`), so `app/tests/build.test` fails on each step branch alone and any
experiment with the committed page tests 4.6; none of the M16 step branches adds a CHANGELOG line (4.9's notes,
incl. what older windows do with these decks, must be written at the integration).

**UNDO-1 · low / info** – the undo of a version's delete re-creates it at the end of the list (`inverseOf`
version.patch: a create appends), so the version menu and an every-version export change order after Undo. Say so
in the CHANGELOG, or give `version.patch` an `at`.

**INT-1 · info** – `v4/M16-tables` (7a0ae85) is built on `v4/M14-charts` without `v4/M15-lines-icons`, and the
painter is not merged yet (its `CELL_KEYS` lacks `valign` / `num`: a cell.patch with them would be skipped and never
compacted by that page). The 4.9.0 release must contain 4.8.0 and the painter's CELL_KEYS; the integration's
`vectors.test` will catch a missing key only if `m16-cells.json` is merged with it.

**VEC-2 · info** – S13.7 (`v4/slide-menu`) appends 431 lines to `shared/ops-vectors.json` instead of
`ops-vectors.d/s13-7.json` as `ops-vectors.d/README.md` asks of every later step.

## 9. What still needs a human

* COMPAT-1's fix is a release decision: format 6 for 4.9 decks locks 4.6–4.8 windows out of them (as 4.6 did 4.0–4.5);
  until then, 4.9 must not reach the share while any 4.6–4.8 window is open (rule (c) of 09 §1).
* DATA-8: fail closed or open for a version that deletes a whole table.
* CP-01 with the real 23 s wait in lean-lock mode, and on Windows / the share (this run: Linux, shortened wait).

## 10. Resolution (2026-10-22)

Every finding is closed. The fixes were made on `m16/audit-fixes` (merged into `v4/M16-tables` and `v4/B51-toc-move`);
the 4.9.0 release is put together on the integration branch `v4/release-4.9.0`.

| Finding | State | Fix | Commits |
|---|---|---|---|
| **COMPAT-1** (high) | fixed | 4.9 objects raise the deck to **format 6** the way 4.6 raised to 5 (ADR-019 amended 2026-10-22): `needsV6` / `docNeedsV6` from 4.8.0's frozen lists (`version.patch`, slide `hidden`, version `drop`, cell `valign` / `num`, and a `slide.add` / `preset.set` carrying them), marker `incident-format-6.json`, `X-SB-Deck-Formats: 4,5,6`, `POST /api/decks/<key>/format6`, helper `READ_FORMATS = {4, 5, 6}` (compaction never lowers 6), `update.py --use 4.6–4.8` names the format-6 decks. 4.0–4.8 now open such decks read-only. The 4.9 wizard copies each version whole (`wizardVersions`), so a later key survives it. Review fix: an op that joins the queue during a 4 → 5 raise is checked again and the deck raised on to 6 before its record is sealed; tests pin the 5 → 6 Lamport jump and a real CAS collision of two raising writers | 700e1e8, review fix 88f30b5, tests 4a1a914 |
| **DATA-8** (medium) | fixed (owner: fail closed) | every export of a version that would delete every row or column of a table – PDF, PNG, PowerPoint, every-version export, Run for each value – is refused with a message naming the version, the table and its slides (`dropWholeRefusal`); the stage still draws the table whole and the Issues panel names it; the full deck and the other versions export as before | da47311 |
| **VER-4** (medium) | fixed | `tools/compat-old.mjs` gets the cases **m15** (a line and a Tabler icon kept byte-equal through an old page's edit, wizard Finish and compaction) and **m16** (4.9 objects raise to format 6; an old page must be refused, the snapshot unchanged, `drop` / `hidden` byte-equal), and the old versions 4.7 (d327882) and 4.8 (b9edb02) | 700e1e8 |
| VEC-1 (low) | fixed | an ops vector setting and clearing a waterfall series' `points[i].total`, with its inverses (`shared/ops-vectors.d/m14.json`) | 89c0131 |
| VEC-2 (info) | fixed | S13.7's duplicated-slide vector moved unchanged into `shared/ops-vectors.d/m16-slides.json` | 48d86c5 |
| UNDO-1 (low) | fixed | `version.patch` takes an optional `at`; the inverse of a delete carries the version's index, so Undo puts it back at its place | 6abda01 |
| REL-2 (low) | resolved by the integration | the 4.9.0 integration branch `v4/release-4.9.0` rebuilds the committed page once over every step and carries the 4.9.0 CHANGELOG section (with what older windows do with these decks) | `v4/release-4.9.0` |
| INT-1 (info) | resolved by the integration | `v4/release-4.9.0` is built on main 4.8.0 (M15 included) with the painter's `CELL_KEYS` (`valign`, `num`) and `m16-cells.json` | `v4/release-4.9.0` |

**CP-01 after the fix** (the m16 / m15 cases, Linux, `--bump-wait-s 2` to fit the time box): **m15 and m16 PASS against
4.6p (v4.6.0) and 4.8 (b9edb02)** – the old pages are refused the format-6 deck (409), the snapshot is unchanged by
them, and the line, the icon, `drop` and `hidden` are byte-equal in the folded deck; **m16 PASS against 4.0, 4.5 and
4.7** (refused, nothing changed). Not run in the fix: the full CP-01 matrix with the real 23 s wait, and CP-01 on
Windows / the share – both are on the owner's list (README *Handover*, PROGRESS *Waiting for*).

**Still for a human** (from §9): the format-6 decision is taken (4.9 decks lock 4.6–4.8 windows out, as 4.6 did
4.0–4.5), so on update day every window on every PC is closed first and the whole team moves to 4.9 together
(`docs/next/release-checklist.md` §6). DATA-8 was decided (fail closed). CP-01 with the real wait and on Windows stays
with the owner.
