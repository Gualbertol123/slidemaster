# 07 · Scenarios, charts, callouts, free layout, cell gridlines, PowerPoint (Slide Builder 4.2+)

**Status: Phase 0 – design only, 2026-10-16. Nothing in this document ships until the product owner answers §8 and
approves the B-items of §6.3.** Written against `main` at 061a5b3 (4.1.0-unreleased). The rules of `PLAN.md` Part A hold
for every milestone below: one milestone = one branch = one pull request, one commit per step, `PROGRESS.md` ticked
with measured numbers, the double-check protocol, the `AUDIT.md` §0 protocol twice on clean clones at the end of each
milestone. Decisions already taken by the product owner on 2026-10-16 (asked before this design was written):

| Decision | Answer | Consequence |
|---|---|---|
| May bulk export need Excel on the PC? | **No.** Users have different Excel versions; nothing may open Excel. A workbook is opened read-only and never saved | the formula engine runs in the core worker (§1); the helper's COM path stays for `.xls` only |
| PowerPoint fidelity | **Editable text and tables** (native charts where possible); glass materials and shadows as pictures | §4 |
| Free placement, charts, callouts, text boxes in raw Excel | **Yes, all of them** | 05 DS-02 changes (§5.4, §6.1) |
| A real workbook for the spike | none (confidential). Build two linked files: a command cell, chained tables, a table in the second file fed by the first and read back; **a deck may draw from several files, and a change in one file updates both** | §1.3 spike corpus; §2.3 linked workbooks (new requirement F0) |

Features, as the product owner wrote them: **F1** scenario export ("run for each bank"), **F2** charts (pie first),
**F3** data callouts (cell-bound shapes), **F4** free placement, **F5** gridlines on selected cells, **F6** PowerPoint
export, plus **F0** linked workbooks (several files per deck), which F1–F3 need.

---

## 1. Recalculation (decides F0–F3)

Slide Builder reads the values Excel saved (`core/src/xlsx/sheetstore.ts` keeps `<v>`; the `<f>` text is skipped) and
has no formula engine. F1 changes an input cell and needs every dependent cell recomputed – on the user's PC, without
Excel.

### 1.1 The options compared

| | (a) Engine in the core worker | (b) Excel through the helper's COM path | (c) Hybrid |
|---|---|---|---|
| How | formulas read from the `.xlsx`/`.xlsb`, a dependency graph and evaluator in TypeScript/WASM inside the core worker; one recalculation per scenario value | `helper/slidebuilder/convert.py`-style PowerShell: open a **read-only copy**, set the cell, `Calculate`, read values (or `SaveCopyAs` and parse) | (a), checked against Excel's saved values when the workbook opens; cells the engine cannot compute fall back to (b) |
| Needs on the PC | nothing new (the WASM is inlined in the page like `hb.wasm`) | Excel, PowerShell with COM (**blocked under Constrained Language Mode, W6**), one Excel instance at a time; user profiles differ by Excel version | both |
| Time per value, measured (§1.3) | **65 ms** on the 20-sheet spike deck (1,259 formula cells, bounded ranges); 3 ms on the linked pair | Excel's own `Calculate` 125 ms, but a PowerShell + Excel start, open and quit cost 2–6 s per run (convert.py's `.xls` path, measured in M6: ≈ 3 s) – one Excel per run, so ≈ 3 s + 0.2 s × values | as (a); (b) only for the fallback |
| Function coverage | IronCalc: every function of the spike census (§1.3) incl. SUMIFS, INDEX/MATCH, OFFSET, INDIRECT, RANK, SUMPRODUCT, TEXT, EOMONTH, XLOOKUP, LET, FILTER, IFS, SWITCH; **external links are not an engine feature** (handled by §2.3) | all of Excel | all |
| Unsupported functions | the cell holds `#NAME?`/`#ERROR!`; Slide Builder shows it, lists it in the Issues panel and in the scenario report; the self-check on open (§1.4) catches it before any run | – | the same cells go to Excel |
| Rejected because | – | **the product owner's decision** (no Excel on the running PC; versions differ); W6; 3 s floor per run | it needs (b) |

**Engines considered for (a)** (all pure JavaScript or WASM; licences checked on npm on 2026-10-16):

| Engine | Version · licence · size | Verdict from the spike |
|---|---|---|
| **IronCalc** `@ironcalc/wasm` | 0.9.0 · MIT **or** Apache-2.0 · `wasm_bg.wasm` 2,089,699 bytes (714 KB gzip; ≈ 2.8 MB as base64 in the page) | **Chosen.** A real engine (Rust): parser, dependency graph, incremental recalculation, cycles detected, array formulas, dynamic arrays. On the spike: 1,219 of 1,239 non-volatile formulas equal Excel on the 20-sheet deck and 182 of 189 on the linked file; **every** difference is one of two known kinds (§1.3). Built from our SheetStore cell by cell (`setUserInput`, 30 ms for 4,900 cells) – its `.xlsx` reader is not in the WASM build, which suits us: the core reads the workbook once, as today |
| fast-formula-parser | 1.0.19 · MIT (Chevrotain Apache-2.0) · 615 KB | **No.** Lists 280 functions but `MATCH`, `INDEX`, `SUMIFS` throw "not implemented"; no dependency graph (the spike wrote one around it); last release 2021. 1 of 1,239 big-deck cells equal |
| hot-formula-parser (Handsontable) | 4.0.0 · MIT | archived 2019, fewer functions than the above; not run |
| `@formulajs/formulajs` | 4.6.1 · MIT | function implementations only: no parser, no references, no graph. Useful as a reference for single functions, not as an engine |
| HyperFormula | 3.5.0 · **GPL-3.0-only** (or commercial) | **excluded by Part A** (no GPL/AGPL/commercial engines) |
| an engine of our own | – | parser + graph + ≈ 45 functions of the census ≈ 4–6 weeks before the first real workbook asks for the 46th; every later workbook may need more. Kept only as the recorded alternative (ADR-013) |

### 1.2 The spike corpus (no confidential data; made with Excel 16.0 on this PC by `spikes/recalc/make_linked.ps1`)

* `Banks.xlsx` – `Control!B2` is the command cell (a bank name chosen among 10); `Control!B3..B9` derive from it
  (MATCH, TEXT, INDEX over whole columns, EOMONTH); `Data` = 10 banks × 12 weeks of loans, deposits, budgets, dates;
  `SLIDE_1`, `SLIDE_2`, `SLIDE_3` = marker tables ("x" at B2) whose cells are SUMIFS over `Data` for the chosen bank,
  deltas, IFERROR percentages, totals, L/D ratios, AVERAGE/MAX/MIN/COUNTIF, RANK, SUMPRODUCT, VLOOKUP, LEFT/MID/LEN,
  CHOOSE/MOD, TEXT, OFFSET, INDIRECT, AVERAGEIF, DATE, CONCATENATE, ROUNDUP, TODAY, ISNUMBER, LARGE/SMALL, XLOOKUP,
  IFS, SWITCH, LET, FILTER; **each slide sheet also depends on the previous one** (row 10: "vs SLIDE_n", INDEX/MATCH
  into it) – the chain the product owner asked for; `FromB` reads `Peers.xlsx` back (`[Peers.xlsx]Peer!F7`, `!D8`) and
  `SLIDE_3!D14` uses it.
* `Peers.xlsx` – `Peer` reads `[Banks.xlsx]Control!B2`, `SLIDE_1!G5:G6`, `SLIDE_2!G7` and compares them with its own
  `PeerData` (VLOOKUP, PERCENTRANK.INC, IF). So a change of `Banks.xlsx!Control!B2` changes `Peers.xlsx`, which changes
  `Banks.xlsx!FromB` and `SLIDE_3` – two files, both updated by one cell, no cell cycle.
* `BanksBig.xlsx` – the speed deck: `Control`, `Data` with 52 weeks (520 rows), **20 slide sheets** of the same
  pattern, each chained to the previous: 1,259 formula cells, 39 distinct functions.
* `truth/<bank>/{Banks,Peers}.xlsx` for each of the 10 banks and `truth/big_Bank_G/BanksBig.xlsx`: the same files after
  Excel set the command cell to that bank, recalculated (`CalculateFull`) and saved – **the ground truth of a scenario
  run**, 2,050 formula cells per bank across the pair.
* The repository corpus (`tests/corpus/workbooks`) has 11 formula cells in all (edge-formats 10 × SUM, report 1 × SUM),
  and openpyxl wrote them **with cached value 0**, so they cannot verify an engine (both engines compute them, e.g.
  `SUM(D6:J6)` = 24 where the file says 0). M7 adds the spike files to the corpus and `tools/make_corpus.py` gains a
  "cached values from Excel" note; the parity goldens are untouched.

### 1.3 Spike results (`spikes/recalc/eval.mjs`, `iron_bounded2.mjs`, `results.json`; Node 22.23.3, this PC at
≈ 2× the reference PC's calibration during the audit)

Function census of the three files (formula cells using each): ROUND 230, SUMIFS 230, IF 206, SUM 186, TEXT 117,
IFERROR 93, ABS 46, MAX 44, MATCH 25, VLOOKUP 25, INDEX 23, AVERAGE 23, MIN 23, COUNTIF 23, RANK 23, SUMPRODUCT 23,
LEFT/MID/LEN 23, CHOOSE 23, MOD 23, OFFSET 23, INDIRECT 23, AVERAGEIF 23, DATE 23, CONCATENATE 23, ROUNDUP 23, TODAY 23,
ISNUMBER 23, LARGE/SMALL 23, XLOOKUP 23, IFS 23, SWITCH 23, LET 23, FILTER 23, AND/OR 21, EOMONTH 2, PERCENTRANK.INC 1.

| Check | IronCalc 0.9.0 | fast-formula-parser 1.0.19 | Excel 16.0 (reference) |
|---|---|---|---|
| `Banks.xlsx` alone, 189 formulas (3 volatile `TODAY` skipped) | **182 / 186 equal**; the 4 others are the `FromB` external-link cells (`[1]Peer!F7`) and `SLIDE_3!D14` that depends on one; plus 3 `TEXT` cells, see below | 10 parse errors in the first cells (`MATCH`, `INDEX`, `SUMIFS` "not implemented", `text.match is not a function`); 367 / 2,050 scenario cells equal | – |
| `BanksBig.xlsx`, 1,239 formulas (20 volatile skipped) | **1,219 / 1,239** – the 20 differences are all `TEXT(date,"mmm yy")` | 223 / 1,239 | – |
| Scenario: `Control!B2` set to each of 10 banks, every formula of `Banks.xlsx` against Excel's saved copy for that bank | **1,820 / 1,890** (the same 7 cells × 10 banks: external links, `TEXT`) | 367 / 2,050 | – |
| Scenario on the big deck, Bank G against Excel's copy | **1,219 / 1,239** (`TEXT` only) | 223 / 1,239 | – |
| Build the model from the cells | 30 ms (BanksBig: 4,900 cells) · 5 ms (Banks) | – | open + start ≈ 2–4 s |
| First full evaluation, whole-column references as written (`Data!$C:$C`, `Data!A:A` in an array formula) | 1,398 ms (BanksBig) · 1,775 ms (Banks) | – | `CalculateFull` 192 ms |
| **Per scenario value, whole-column references bounded to the used range** (§1.4 rule 3) | **64.6–67.4 ms** (BanksBig, 10 values) · **3.1–3.5 ms** (Banks) | 29–33 s (BanksBig, re-evaluates everything, no graph) | `Calculate` after the change 125 ms (+ COM round trips) |
| Per scenario value, whole columns left as written | 2,347–2,457 ms (BanksBig) · 2,584–5,978 ms (Banks) | – | – |
| Reading every formula cell back after a recalculation | 3–4 ms (1,259 cells) | – | – |
| WASM instantiate (`initSync`) | ≈ 40 ms (Node) – measured in the page in S7.1 | – | – |

**The two kinds of difference, both understood:**
1. **External links** (`[1]Peer!F7`): no JavaScript engine resolves another file; §2.3 loads the linked workbook into the
   same model, so these become ordinary cross-sheet references. Not an engine limit.
2. **`TEXT(date, "mmm yy")`**: Excel on this PC is Italian and stored `"mar yy"` / `"ott yy"` (Italian `TEXT` codes are
   `"mmm aa"`; `yy` is literal there), IronCalc gives `"Mar 26"` / `"Oct 26"`, which English Excel gives too. `TEXT`
   format codes depend on the **Excel UI language of the PC that saved the file**; the self-check (§1.4) reports such
   cells as "locale-dependent", and the Issues panel names them. No engine can know which language saved the file; the
   workbook's cached text is kept for those cells unless the scenario changes their inputs.
3. **Volatile functions** (`TODAY`, `NOW`, `RAND*`) are computed with the PC's clock and are reported apart (23 cells
   in the spike), never as mismatches.

**Whole-column references are the one performance trap:** `SUMIFS(Data!$C:$C, …)` makes IronCalc scan 1,048,576 rows
per reference and `(Data!A:A=B2)*(Data!B:B=B4)` allocates two 1 M arrays; bounded to the sheet's used range the same
deck recalculates 37× faster (2.4 s → 65 ms). The bounding is exact for SUM-like functions over data that ends at the
used range; §1.4 rule 3 states where it is not.

### 1.4 Recommendation: (a) with IronCalc, plus a self-check on open (no Excel anywhere)

1. **Engine:** IronCalc 0.9.0 WASM in the core worker (ADR-013), pinned, inlined in the page like `hb.wasm`
   (`core/src/text/wasm/*.ts` pattern), instantiated **lazily** on the first use (a scenario, the Issues line "formulas",
   or a callout/chart whose source the self-check has not verified) – never on the open path, so Part F's 400 ms open
   budget is untouched. Page growth ≈ 2.8 MB (B23); the page is served from `127.0.0.1`, so the cost is parse time,
   measured in S7.1 (budget: the engine's first use < 200 ms on the reference PC, in the worker).
2. **Formulas are read, not only values.** `sheetstore.ts`'s scanner keeps `<f>` text (shared formulas expanded as the
   spike's `shiftFormula` does, array formulas with their `ref`), and the `.xlsb` reader decodes `BrtFmla*` Rgce to A1
   text (the CF formula decoder `xlsb/formula.ts` is the start: it already converts Rgce; S7.2 extends it to cell
   formulas or marks the sheet "formulas not readable in .xlsb" and falls back to values only). Memory: one string per
   formula cell (interned), nothing per value cell.
3. **Whole-column and whole-row references** (`A:A`, `1:1`) are rewritten to the sheet's used range when the model is
   built, **except** inside `OFFSET`, `INDIRECT`, `ROW()`/`COLUMN()`/`ROWS()`/`COLUMNS()` calls (at any depth); the
   used range cannot grow at run time (the workbook is read-only). `INDEX(Data!G:G, …)` is bounded (tested: exact). The
   spike shows the exact result on every formula of its corpus with this rule; the self-check (4) proves it per
   workbook.
4. **Self-check on first use** (the "check against Excel's saved values" of option (c), without Excel): the engine
   evaluates every formula cell once and compares with the cached values. Result per workbook: `exact` cells,
   `volatile`, `locale` (TEXT/date formats), `external` (links to files not opened), `different` (engine ≠ Excel). The
   Issues panel gets one line ("Formulas: 1,219 of 1,239 recomputed like Excel; 20 locale-dependent"), and **a scenario
   run that would draw any `different` cell into a slide stops with the list** unless the user ticks "run anyway, mark
   these cells" (then those cells are drawn with a red marker and listed in the report). This is the whole safety net:
   no silently wrong number.
5. **Not supported and said so:** macros/UDFs, data tables, Power Query refreshes, RTD, cube functions, iterative
   calculation (circular references are an error cell), `.xls` (converted by Excel as today, then values only),
   tables' structured references (`Table1[Col]`: the cell keeps its cached value and counts as unreadable).

**Found while building S7.2 (recorded here, not in the engine's favour or against it):**
* The engine's formatted read-back rounds to **15 significant digits** (its `General` display to 9 decimals), and it
  exposes no raw-value getter; the core applies a `0.00000000000000E+00` style to the formula cells and parses the
  text back. Equality with Excel is therefore checked to 1e-13 relative (`sameValue`), and a scenario value's text is
  formatted from a 15-digit number – Excel's own display precision.
* Sheet names are limited to 31 characters and may not contain `[ ] : * ? / \`, as in Excel: a linked workbook's sheet
  gets the internal name `«n»Sheet` (cut to 31, made unique), never saved anywhere.
* Bulk constants go in through the engine's tab-separated paste (`pasteCsvText`, 240 k cells in 0.3 s; `setUserInput`
  does 15 k cells/s), strings cell by cell with a quote prefix so that no text is read as a number, date or formula.
* Dynamic arrays spill in Excel; the spilled cells are constants in the file and in the model, so a workbook whose
  slide tables are fed by spills shows `different` cells in the self-check (a limit, rare in reporting decks).
* Whole columns of **two different sheets inside one array expression** (`SUMPRODUCT((Data!A:A="x")*(Control!B:B))`)
  are bounded to two different heights and give `#VALUE!` where Excel (both 1,048,576 rows) gives a number: classed
  `different` by the self-check, not silent. Structured references (`Table1[Col]`) pass through as text and are
  `different` too (not "unreadable": the formula text is read).
* **Hidden sheets** are never read (WB-18), so a formula that names one is classed **`hidden`** (its own class in the
  self-check and the Issues line) and its dependants `different`; S7.3 reads hidden sheets into the engine's model only
  (they stay out of the deck).

---

## 2. Data model

### 2.1 Principles kept
* Everything saved is in `core/src/model/types.ts`; operation semantics only in `core/src/model/ops.ts`; every new
  key has `shared/ops-vectors.json` cases and an inverse (`inverseOf`) for undo (ADR-002).
* **All new fields are optional**, so a 4.0/4.1 helper and page read a 4.2 deck (they ignore unknown keys: README §4.4);
  the format stays `workbook: 3` / `format: 4`. The migration test `helper/tests/test_migrate_v3.py` gains a 4.2 snapshot
  fixture (added, never edited) read by the real 4.0 code path (`--selftest` reads every deck read-only).
* Cell references are stored as they are everywhere today: **A1 text in a named sheet** (`TableDef.range`, `cf:
  "Sheet!C6"`, `versions.hide`). Sheet renames and inserted rows are not tracked for tables today either: the table
  turns "missing" in the Issues panel (SP-04). The new objects follow the same rule and get the same Issues lines
  ("Chart 2: source `Summary!C5:C9` not found"). Tracking structural edits would need the workbook's change history,
  which a saved file does not have; stated as a limit, not solved.
* A **sheet id** is `Sheet` for the deck's workbook and `[Peers.xlsx]Peer` for a linked one (§2.3): one string, so no
  type and no op changes; `cell.patch`'s `sheet` is already a free string, `edits["[Peers.xlsx]Peer"]["C5"]` works
  unchanged; `REF` stays `^[A-Z]{1,3}[0-9]{1,7}$`.

### 2.2 New document fields

```ts
// core/src/model/types.ts (additions; every field optional)
export type DataRef = { sheet: string; range: string }              // sheet id + A1 range ("C5:C9", "C5:C9,E5:E9" not allowed: one rectangle)
                    | { table: string; range: string };             // a table of the deck + a range inside its sheet (follows a growing range)
export interface ChartItem { kind: "chart"; type: "pie" | "donut" | "bar" | "column" | "line";   // pie/donut in F2; the others keep the same fields
  values: DataRef; labels?: DataRef; series?: string;               // series name (legend/title fallback)
  title?: string | null; legend?: "right" | "bottom" | "none"; show?: ("label" | "value" | "percent")[];
  colors?: Record<string, string> /* slice index → colour; absent = theme palette */; startAngle?: number;
  fmt?: TextFmt;                                                      // label text style over the deck's "note" style
  box: Box; attach?: { table: string; side: Side } }                 // box = slide px; attach = laid out beside a table (as text boxes), else free
export interface ShapeItem { kind: "shape"; shape: "rect" | "round" | "circle" | "pill" | "arrow" | "bubble" | "icon";
  icon?: string;                                                      // one of the built-in icon names (F3: ≈ 16 paths)
  text?: string;                                                      // may hold {Sheet!C7} / {[Peers.xlsx]Peer!F7} references
  fill?: string | null; border?: { color: string; w: number; dash?: "solid" | "dashed" | "dotted" } | null; radius?: number;
  fmt?: TextFmt & { valign?: "top" | "middle" | "bottom"; pad?: number }; tail?: { x: number; y: number } /* bubble tail tip */;
  box: Box; attach?: { table: string; side: Side } }
export type Item = ChartItem | ShapeItem;                            // SlideDef.items: Record<id, Item>
export interface Box { x: number; y: number; w: number; h: number }
export interface FreeLayout { on: boolean; items: Record<string, Box & { scale?: number }> }  // keys: "t:<tableId>", "n:<noteKey>", "i:<itemId>"
export interface CellGrid { h?: "on" | "off"; v?: "on" | "off"; o?: boolean; c?: string; w?: number }   // per cell: horizontal / vertical lines, outline, colour, weight px
// SlideDef += items?: Record<string, Item>; free?: Partial<Record<Design, FreeLayout>>
// TableDef += cellGrid?: Record<string /* A1 */, CellGrid>
// Preset  += links?: string[]                                        // file names of linked workbooks the deck draws from (§2.3)
```

**Operations** (one new op, two extended; semantics only in `ops.ts`):

| Op | Change | Merge rule | Inverse |
|---|---|---|---|
| `item.patch {slide, id, patch}` **new** | sets / deletes fields of `slides[slide].items[id]`; `patch: null` deletes the item; a patch on a missing id with a `kind` creates it | **field-level** (plain keys set/delete, `colors`, `fmt` map-merge), so two people recolouring and moving one chart both win – the fix the audit asked for text boxes (SEC-9) is applied to the new objects from the start | current values of the patched keys, or `null` → the whole item on delete |
| `slide.patch` | `free` joins `SLIDE_MAPS`: `free: {glass: FreeLayout | null}` | map merge per design (an entry replaces the design's layout whole: a free move is one op that writes the whole `items` map of that design – a single undo step by construction) | as `sizes` |
| `table.patch` | `cellGrid` joins `TABLE_MAPS` | map merge per cell | as `cols` |
| `preset.set` | `links` is part of the preset | replaced whole, as today | unchanged |

Op vectors added: ≥ 24 cases (create / patch / delete item, field merge of two writers, `colors` merge, free on/off,
`cellGrid` set/clear, inverses round-trip, unknown `kind` skipped, invalid box skipped). The fold and Lamport order
need no change: `item.patch` is a record op like the others.

### 2.3 Linked workbooks (F0): several files, one deck

* **What the user sees.** Wizard step 1 gets *"+ Add a linked workbook…"*: the Open list (same folder; Browse is not
  built in S7.3 – a browsed file is not in the folder the helper serves, so it would need an upload path like WB-07:
  recorded in PROGRESS, M8 decides). Its
  sheets appear under a tab named after the file; tables, charts and callouts can use them; the deck key and the
  journal stay those of the main workbook (nothing changes in storage); `preset.links` lists the files. Opening the
  deck opens the linked files too (read-only, same `/files/` path and stable-read rule WB-26; a missing linked file →
  Issues line + its tables "missing", the deck still opens).
* **External references in formulas** (`[1]Peer!F7`): the workbook's `externalLink*.xml` maps `[n]` to a file name. If
  that file is among `preset.links` **or in the same folder** (auto-linked for recalculation only, never shown unless
  added), its sheets are loaded into **the same IronCalc model** under a mangled sheet name no real sheet can have
  (the quoting rules of the engine are tested in S7.3; the name is an implementation detail never saved), and `[n]`
  references are rewritten to it. So A ← B ← A chains compute, and a real cell cycle is reported as one. If the file is
  not available, the link's cached values (`<sheetDataSet>` in `externalLink1.xml`) are used as constants and the
  self-check classes those cells `external` – a scenario run then warns that these cells will not follow the value.
* **Scenario on a linked workbook's cell** is allowed: the input cell is `(sheet id, ref)`.
* `.xlsb` linked files: as the main one (B10 reader).

### 2.4 Scenario state lives only in the worker (F1)

```
page ──scenario.plan {input:{sheet,ref}, values, designs, versions, kinds:["pdf","pptx"], mode:"files"|"preview"}──► core worker
core worker: for each value (yielding between values; the stage is served in between):
   1. model.setUserInput(input, value); model.evaluate()                                   ≈ 65 ms (20 sheets)
   2. overlay = changed formula cells → ScenarioOverlay (Map<sheetId, Map<cellIndex, value>>)
   3. ctx.sheet(name) returns an OverlaySheet facade: cellAt() answers from the overlay first, else the SheetStore;
      formatValue, CF, comments, charts, callouts all read through it – nothing else in render/ knows about scenarios
   4. table keys (render/context.ts tableKey) include the overlay's content hash, so every DL cache misses exactly
      where values changed and the export workers get fresh lists through the existing slideLists channel
   5. export workers write the files (PDF / PPTX) and POST them (names §2.5); progress event per value
   6. the overlay is dropped; the document (DocSync) is never touched: no op, no record, no journal write
preview: steps 1–3 with the overlay kept as `previewOverlay`; the stage draws through it; a banner names the value;
         `scenario.preview(null)` clears it. Edits during a preview are ordinary ops on the document (allowed: they are
         the user's deck, not the scenario); the overlay only changes what the workbook's cells say.
```

**Built in S7.4 (and its limit):** the view lives only in the worker (ADR-014); the page's mirror keeps the workbook's
own values during a preview, so what the page computes from its mirror – the ribbon's format state, the painter's
source formats, the comment dialog's preview, the Issues panel's table lines – shows the real workbook while the stage
shows the scenario. S8.4 decides whether the changed cells are mirrored to the page as slices (the overlay's sheets
can be sliced like any other) or the preview banner says so. An export started before a preview builds its lists from
the view for the slides it has not asked for yet (M8's runs set the view on purpose; a stray overlap is guarded in
S8.3).

* **The document is never changed by a run.** No `cell.patch` is generated; `edits` with `orig` keep behaving as
  CE-09 says (a text edit applies only while the Excel value is `orig`; under a scenario the overlay value is "the
  Excel value", so an edited label stays when the value changes to something else – the table keeps the user's text
  only if `orig` matches, exactly as a reload of a changed workbook today).
* **The workbook file is never written** (the helper's `/files/` path is read-only already; the engine holds its own
  model in memory).
* The worker stays single-threaded: one value's recalculation (≤ 150 ms budget) runs between stage requests; the page
  never waits on it (progress events only), so **no main-thread task** is added (Part F 50 ms rule); the stage request
  that arrives during a value waits at most one value.
* Cancel: a flag checked between values; files already saved stay; the report says "cancelled after n of m".

### 2.5 File names of a run

`<value> - <design>.<ext>`; with several versions `<value> - <version> - <design>.<ext>`; `<ext>` = `pdf` / `pptx`.
`<value>` is the cell's **displayed text** (the number format applied, as the formula bar shows it), made safe:
`\ / : * ? " < > |` and control characters → `_`; leading/trailing spaces and dots removed; reserved device names
(`CON`, `NUL`, `COM1`…, audit SEC-7) prefixed with `_`; cut so that `<export folder>\<name>.<uuid>.tmp` stays under 240
characters (audit SEC-6); empty → `(blank)`. **Equal names in one run** (two values that display alike, or one that
collapses to the same safe name) get ` (2)`, ` (3)` **inside the run**, before the helper's own ` (2)` rule for a target
open in Acrobat (EX-11) – so two values never overwrite each other and the report names both files.

---

## 3. Rendering charts and callouts (F2, F3) – display-list nodes only

ADR-004 holds: **no new node type.** Everything below is `rect`, `path`, `line`, `text`, `group`, `shadow`, `hit`.

| Element | Nodes | Liquid Glass | Excel | Excel Refined |
|---|---|---|---|---|
| Pie / donut slice | `path` (arc as cubic Béziers: 4 per full turn, the standard κ = 0.5523), `fill` solid or the theme's tinted gradient; a 1 px `stroke` in the background colour separates slices | slices with the glass palette (`a1`, `a2`, the signal colours of `glass.ts`), sitting in a glass card (`group{clip}` + `image wallblur` + tint `rect` + `shadow`: the table-container recipe of 03 §4.3) | flat Office-like palette (theme accent + the Excel chart defaults), no card | Excel's palette, a plain rounded card like its text boxes |
| Labels (value / % / name) | `text` placed on the slice's mid-angle, outside with a `line` leader when the slice is thin (< 12°) | Segoe UI deck style | Century Gothic / workbook font | as Excel |
| Legend | `rect` swatch + `text` per entry, right or bottom | capsule swatches | square swatches | square |
| Title | `text` (the deck's "note" text style, `fmt` over it) | | | |
| Callout shape: rect / round / circle / pill | `rect` with `r` (0, radius, h/2); `fill`, `stroke`; optional `shadow` | glass material when `fill` is unset (bubble recipe), solid when set | solid | solid |
| arrow / bubble | `path` (arrow polygon; bubble = rounded rect + tail triangle in one path with `evenodd` off) | same materials | | |
| icon | `path` data from a built-in set (≈ 16: arrow up/down, check, warning, info, flag, star, bank, euro, percent, calendar, chart, target, bell, pin, bulb, lock), filled with the text colour | | | |
| Callout text | the text-box renderer (`slide-dl.ts noteNodes`): markup, wrapping, shrink-to-fit ≥ 9 px, valign; **`{Sheet!C7}` tokens replaced** by `formatValue(cell)` with the cell's number format (and the overlay under a scenario) before layout; a missing reference renders `#REF` and an Issues line | | | |
| Selection | `hit {kind: "item", id}` over the item's box; `hit {kind: "slice", id: "<item>:<i>"}` per slice for per-slice colour | | | |

* **Colours**: `colors[i]` per slice (hex) else the design's palette; "from the deck's theme" means the resolved theme
  (`model/style.ts resolveStyle`, per design via `designs[d]`), so the same chart is drawn in each design's own look,
  as tables are.
* **Charts and callouts follow the data** because they read cells through the same `ctx.sheet()` facade as tables: a
  reload (WB-15) rebuilds them with the new SheetStore; a scenario value (§2.4) with the overlay. Their DL cache key is
  the item + the referenced cells' values (hashed), like `tableKey`.
* **Bar / column / line later**: the same `ChartItem`, `type` switched; bars = `rect`s, line = `path`, axes = `line` +
  `text`. The pie step builds the shared parts (data resolution, palette, legend, labels, hit nodes) so that step is
  data-to-geometry only.
* Thumbnails, PNG, "as pictures" and the clipboard need nothing: they draw the DL.

---

## 4. PowerPoint export (F6)

### 4.1 The writer

`core/src/pptx/` – pure TypeScript, like `core/src/pdf/`: a zip (fflate `zipSync`, already a dependency) of OOXML parts
(`[Content_Types].xml`, `_rels`, `ppt/presentation.xml`, `slideMasters/1`, `slideLayouts/1` (blank), `slides/N`,
`theme/1`, `media/*`, `charts/N` + `embeddings/N.xlsx` for charts, `docProps`). Slide size 16:9 = 12,192,000 × 6,858,000
EMU; 1 slide px = 7,620 EMU (1600 → 12,192,000). No library (no licence to add; python-pptx is a dev-only checker).

**Input: the display list plus a semantic layer.** A display list alone cannot give editable tables (it has cell
rects and glyph runs, no rows). The core therefore answers the export worker's `slideLists` with an optional
`semantics` per slide when `kind: "pptx"`:

```ts
interface SlideSemantics { tables: { id; box; rows: number[]; cols: number[]; cells: { r; c; text; runs?; font; size; b; i; color; fill; align; valign; borders; merge? }[] }[];
                           texts: { key; box; paragraphs: { runs: { text; font; size; b; i; color }[]; align; lh }[]; valign; fill?; border? }[];   // titles, text boxes, callouts, footer, page numbers
                           charts: { id; type; title; labels: string[]; values: number[]; colors: string[]; show; legend; box }[];
                           pictures: { id; box; crop; rotation }[];
                           picturesOnly: DisplayList }   // what is left after the above are removed: glass materials, shadows, wallpaper, capsules, rules → one PNG per slide region
```

The DL stays the truth for geometry: every semantic box is the box of the DL nodes it replaces, and the writer renders
`picturesOnly` with the existing canvas backend (OffscreenCanvas in the export worker, 2× like B9) into **one PNG
per slide** (the background layer) plus **one PNG per table card** in Liquid Glass (so a user can move the table and its
glass together). So screen, PDF and PPTX agree by construction on positions; PowerPoint's own text layout may wrap a
line differently (fonts, no `textLength`), which is the accepted cost of editable text (B21).

### 4.2 Fidelity table (what stays editable, what becomes a picture)

| DL / scene element | PPTX | Editable? | Notes |
|---|---|---|---|
| Titles, subtitles, cover texts, footer, page numbers, text boxes, callout text, chart titles | `p:sp` text boxes with `a:p`/`a:r` runs: font name, size (px × 0.75 pt), bold/italic/colour, alignment, line spacing (`a:lnSpc`), vertical anchor; `wrap="square"`, insets 0; autofit off | **yes** | letter-spacing (`ls`) dropped; text shadow (title) as `a:effectLst/outerShdw`; superscript/subscript as `baseline` |
| Tables (all three designs) | `a:graphicFrame` + `a:tbl`: column widths and row heights from the layout, merged cells (`gridSpan`, `rowSpan`), cell fills (solid), borders per side (`a:lnL/R/T/B`, width, dash, colour), text runs as above, margins from the design | **yes, real tables** | Liquid Glass: the card (glass, shadow, rim) is a picture under the table; capsules (highlights, signals, colour-scale capsules) become **cell fills with the capsule colour** (rectangular, not pills); gradient/tinted fills flattened to their mid colour |
| Pie / donut charts | `c:chartSpace` with `c:pieChart`/`c:doughnutChart`, data points with explicit colours, data labels (value / percent / name), legend position, embedded `embeddings/chartN.xlsx` (a 2-column workbook written with fflate) so **Edit Data** works in PowerPoint | **yes, native chart** | PowerPoint draws it with its own geometry (label placement differs); the title is a chart title |
| Pictures from the workbook, logo | `p:pic` with `a:srcRect` crop, rotation, flips | yes (move, crop) | EMF/WMF already converted to PNG by the helper |
| Callout shapes (rect, round, circle, pill, arrow, bubble) | `p:sp` with `prstGeom` (`rect`, `roundRect`, `ellipse`, `rightArrow`…, `wedgeRoundRectCallout`) and the text inside | **yes** | icons: `p:sp` with `custGeom` from the same path data (editable as a shape) |
| Shadows (5-layer recipe) | `a:effectLst/outerShdw` on the shape it belongs to (tables' cards: in the picture) | approximated | PowerPoint's blur, not 5 layers |
| Glass materials: wallpaper, frosted cards, tints, rims, hairline gradients, keyed pictures' drop shadows | **PNG pictures** (background layer at 2× = 3,200 × 1,800, JPEG for the wallpaper layer, PNG with alpha for cards) | no | by decision |
| Solid / simple linear gradient fills of rects (Excel designs, cover bar) | native `a:solidFill` / `a:gradFill` | yes | radial and alpha-stop gradients → picture |
| Cell-level gridlines (F5), borders | table cell borders | yes | |
| Hit nodes | nothing | – | |

**Fonts** (to decide, §8 Q4): named, **not embedded**, in the first release: OOXML font embedding needs the obfuscated
`.fntdata` form and PowerPoint honours it only for fonts whose `fsType` allows installable/editable embedding; Microsoft
fonts (Calibri, Segoe UI, Century Gothic, Aptos) exist on the bank's PCs, and library/Google fonts are substituted by
PowerPoint (the report names them: "Inter not embedded – PowerPoint substitutes it"). A second step can embed
library fonts whose `fsType` is installable (we already read `fsType` for the PDF).

### 4.3 How a PPTX is checked (dev tools; nothing ships)

`tools/pptxcheck.py` (Python, dev-only like `pdfcheck.py`; stdlib for the structure, `python-pptx` 1.0.2 (MIT) for
text, PowerPoint COM when present):
1. **structure**: zip opens, `[Content_Types].xml` lists every part, every `.rels` target exists, every XML part parses
   (`xml.etree`), `presentation.xml` slide count = expected, slide size 12,192,000 × 6,858,000, no empty `a:t`;
2. **text**: every expected slide text (the GT golden texts) is found in the slide's shapes/table cells in order-
   insensitive comparison (python-pptx), chart data equals the source cells;
3. **open / repair**: on Windows with PowerPoint, `PowerPoint.Application.Presentations.Open(path, ReadOnly, Untitled,
   WithWindow=0)`: a file that needs repair raises (PowerPoint reports the repair as an error in automation, so the
   check fails instead of showing a dialog); the slide count and the text of each shape are read back and compared;
   then `Close`. This PC has PowerPoint 16 (checked 2026-10-16: `PowerPoint.Application.16`), so the check runs here
   and on the reference PC; CI (Linux) runs 1–2 only and the run on Windows is recorded in `PROGRESS.md` (as W14 for
   Acrobat). LibreOffice is not available here and is not a target;
4. **PowerPoint 2016**: the writer emits only ECMA-376 1st-edition + the 2010 chart/`a:` features PowerPoint 2016 reads
   (no `p14`/`p15` extensions, no SVG pictures, no `a:ln` on tables beyond 2007 features). A manual open in PowerPoint
   2016 on a corporate PC joins the W matrix (W15).

### 4.4 Budgets
20 Liquid Glass slides → `.pptx` in < 3 s (click → file), Excel < 1.5 s; size < 3 MB Glass (the per-slide background
PNG at 2× dominates: budget 120 KB per slide + 400 KB wallpaper once) / < 300 KB Excel; one `.pptx` opened in
PowerPoint without a repair prompt for every corpus deck × design × version.

---

## 5. Free layout (F4) and cell gridlines (F5)

### 5.1 Free layout and `computeLayout`
* `SlideDef.free[design]` with `on: true` switches **that design of that slide** to free layout (coordinates are per
  design, as `sizes` are, because the designs draw tables at different widths).
* `computeLayout(R, ctx)` keeps its signature. When `free[design].on`, it returns `{boxes, k: 1, fit: 1, reduced: false}`
  where every table box is `items["t:<id>"]` (scale = box.w / tableW), every text box `items["n:<key>"]`, with
  `free: true`; items without an entry (added after the switch) get the automatic position **of that item alone**
  (next to its table for notes and attached items; the first empty spot in a grid for new charts) and the switch-on
  op writes them in. Nothing re-flows, no sizes are linked, no auto-shrink (the `fit` bisection is skipped), no
  attaching. Items can leave the content area but not the slide (clamped 0–1600 / 0–900 as text boxes are).
* **Switching on** = one `slide.patch {free: {[design]: {on: true, items: <every current box as computed now>}}}` – the
  slide looks identical before and after. **Switching back** = one `slide.patch {free: {[design]: {…, on: false}}}` –
  the automatic layout returns as it was (its `sizes`, `layout`, `notes.x/y` were never changed by free mode) and the
  free positions stay saved, so switching on again restores them: one undo step each way, nothing lost.
* **Drags (S4.2)**: `app/src/stage/drags.ts` gets `freeMove` / `freeResize` for every item kind: preview per frame
  with the same `computeLayout` (free branch), snapping to the other items' edges and the slide guides (the existing
  `snapTargets`, SNAP = 8) unless **Alt** is held, one op on pointer-up. Tables in free mode resize by their corner
  (uniform scale) and edges (that axis stretched = the existing `stretchTable` column/row factors are *not* used:
  free mode scales the drawn table so the workbook's proportions hold; W/H boxes still edit columns and rows).
* Raw Excel today correct sizes for text boxes it does not draw (`fixedScale`); with B19 raw Excel draws the user's
  objects, so `notesOf`'s `design === "excel"` early return and `fixedScale`'s correction go, and **the parity of raw
  Excel slides that have text boxes changes**: those corpus slides are re-captured as accepted differences under B19
  (the goldens are not edited: `tests/parity/accepted.json` entries with the reason).
* The "Reset layout" button (TA-13) in free mode asks "Back to automatic layout?" and does the switch-back op.

### 5.2 Cell gridlines (F5)
* `TableDef.cellGrid["C7"] = {h, v, o, c, w}`; applied after the table-level `gridH`/`gridV` (TA-10) and the workbook's
  borders: `h: "on"` draws the cell's top and bottom edges, `v` left and right, `o` the outline of the **selection
  rectangle** (stored per cell as the four outer edges), `c` colour, `w` px (0.5–3). Ribbon 2's **Gridlines ▾** gains a
  section "Selected cells: H · V · Outline · Colour · Weight · Clear"; the format painter copies `cellGrid` entries
  (CE-16 list +1). Rendered in `excel-dl.ts` as `line` nodes (replacing the workbook border of that edge) and in
  `glass-dl.ts` as hairlines of the given colour; versions (VR-02) keep borders, so they keep these too.

---

## 6. Tests, rows, B-items, budgets

### 6.1 05 §4 rows that change

| Row | Today | After (approval needed) |
|---|---|---|
| DS-02 | Excel adds nothing (no text boxes, comments, notes; no deck colours on tables) | **Excel adds no decoration of its own** (no deck colours on tables, no glass), but the user's objects – text boxes, notes section, automated comments, charts, callouts – are drawn in every design (B19) |
| DS-07 | raw Excel's text-box correction (`fixedScale`) | the correction goes with DS-02 (an Excel slide with text boxes gives them room, as Excel Refined does) |
| NB-18 | text boxes disabled in raw Excel with tooltip | enabled |
| AC-01 | Comment… disabled in Excel | enabled |
| TA-10 | gridlines per table | + per selected cells (GL rows) |
| CE-16 | painter copies … colour scales | + cell gridlines |
| EX-01…EX-10, EX-17 | PDF | every item has a PowerPoint twin (PX rows); "Saved N files" |
| EX-11 | names, " (2)" | + scenario names (§2.5) |
| SP-01–SP-15 | issues list | + "Formulas: … recomputed like Excel", "Chart/callout source not found", "linked workbook missing", "locale-dependent TEXT cells" |
| WB-09 | `.xls` / protected converted by Excel | unchanged (values only; no formulas for `.xls`) |
| WZ-04…WZ-09 | one workbook | + linked workbooks' sheets under their file tab (F0) |

### 6.2 New rows (verification codes of 05 §1; "OV" = ops vectors, "E" = Playwright e2e, "U" = unit, "GF/PF" = file facts)

| ID | Behaviour | Verified by |
|---|---|---|
| RC-01 | formulas read from `.xlsx` (shared, array) and `.xlsb` | U: every formula of the spike files text-equal to Excel's (`xlsb` twins made by `make-xlsb-twins.ps1`) |
| RC-02 | self-check classes: exact / volatile / locale / external / different | U on the spike corpus: 1,219 / 20 / 20 / 0 / 0 (BanksBig), 182 / 3 / 3 / 4 / 0 (Banks alone), 0 external with Peers linked |
| RC-03 | scenario value = Excel's saved copy | U: all 10 banks × both files = 100 % of non-volatile, non-locale cells (2,000 of 2,050) |
| RC-04 | whole-column references bounded; the exceptions kept | U (OFFSET/INDIRECT cases) + ⏱ 20-sheet deck < 150 ms per value |
| RC-05 | engine loaded lazily; open budget unchanged | ⏱ bench: `open_deck20_ms` unchanged; `engine_first_use_ms` < 200 |
| RC-06 | unsupported function → error cell, Issues line, run refused unless "run anyway" | U + E |
| LK-01 | add a linked workbook in the wizard; its tables draw | E (two files in the temp folder) |
| LK-02 | a change of the command cell updates the linked file's table and the read-back cell | U (spike pair) + E (scenario → the Peers table shows the value) |
| LK-03 | linked file missing → Issues + tables missing; deck opens | E |
| SC-01 | pick input cell (sheet + cell), values typed / pasted / from a range (de-duplicated, blanks skipped) | E |
| SC-02 | 3 values × 2 designs → 6 files with the right names | E (the brief's case) |
| SC-03 | duplicate display names → " (2)" inside the run | U (name rules) + E |
| SC-04 | unsafe characters, reserved names, long names | U |
| SC-05 | the saved deck and the workbook file are byte-identical after a run | E (hash before/after; journal unchanged) |
| SC-06 | progress, cancel, report (ok / failed with reason) | E |
| SC-07 | preview one value on screen; banner; clear | E |
| SC-08 | no main-thread task > 50 ms during a 20-value run | ⏱ bench (Long Tasks) |
| SC-09 | one value recalculated + 20 Glass slides exported < 3 s; 20 values < 40 s | ⏱ bench |
| CH-01 | pie chart from a table's cells; labels/values/percent; legend; theme colours; per-slice colour | U (DL nodes) + GG-style DL snapshot per design + E |
| CH-02 | pie from a range of a sheet not on any slide | E |
| CH-03 | chart follows a reload and a scenario value | E (reload with changed file; scenario preview) |
| CH-04 | chart source missing → Issues + placeholder | E |
| CL-01 | callout shapes, icons, fill/border/text style, in every design | U (DL) + E |
| CL-02 | `{Sheet!C7}` shown with the cell's number format; follows a scenario value; `#REF` + Issues when missing | U + E |
| FL-01 | free layout on: nothing moves; off: automatic returns; one undo step each | E (positions before/after; undo count) |
| FL-02 | move / resize every item kind; Alt disables snapping; one op per drag | E + Playwright trace ≤ 16 ms per frame |
| FL-03 | works in raw Excel (text boxes drawn, B19) | E + accepted parity entries |
| GL-01 | gridlines on selected cells: H / V / outline / colour / weight; clear | U (DL lines) + E |
| GL-02 | painter copies them | E |
| PX-01 | `.pptx` for current slide, deck, versions × designs, scenario runs | E + PF (`pptxcheck.py` 1–2) |
| PX-02 | opens in PowerPoint without repair; slide count and texts equal | PF 3 on Windows (recorded per release) + W15 (PowerPoint 2016 PC) |
| PX-03 | tables are real tables, text is text, pie charts are charts | PF 2 (python-pptx: `shape.has_table`, `has_chart`) |
| PX-04 | size and time budgets | ⏱ |

Existing rows keep passing; no test is skipped. Parity (`npm run parity`, `dlparity`) must stay at 0 unaccepted
differences; the only new accepted entries are B19's raw-Excel slides with text boxes (listed, signed).

### 6.3 New B-items (PLAN Part B §8; to be approved before any step ships)

| # | Change | Step |
|---|---|---|
| B15 | **Scenario export**: Export ▾ › *Run for each value…* – an input cell, a list of values, designs and versions; one file per value named `<value> - <design>`; progress, cancel, report; preview of one value | M8 |
| B16 | **Charts** (pie/donut first) on any slide, from a table or any range, following reloads and scenarios | M9 |
| B17 | **Callouts**: shapes and icons with text that can quote cells (`{Sheet!C7}`) | M9 |
| B18 | **Free layout** per slide and design, with snapping (Alt disables); switch back is one undo step | M10 |
| B19 | **Raw Excel draws the user's objects** (text boxes, notes section, comments, charts, callouts); it still adds no decoration of its own | M9/M10 |
| B20 | **Gridlines on selected cells**, copied by the painter | M10 |
| B21 | **PowerPoint export** next to every PDF export: editable text, real tables, native pie charts; glass materials and shadows as pictures; fonts named, not embedded | M11 |
| B22 | **Linked workbooks**: a deck can draw from several files; external links are recalculated when the linked file is available | M7 |
| B23 | The page grows by ≈ 2.8 MB (the formula engine), loaded on first use only; start-up unchanged | M7 |
| B24 | The Issues panel reports how many formulas recompute like Excel, locale-dependent `TEXT` cells, and missing chart / callout sources | M7, M9 |

### 6.4 Part F additions (enforced by `npm run bench` from the step that introduces them)

| Budget | From step | Limit |
|---|---|---|
| Engine first use (instantiate + the first model of the 20-sheet recalc deck + self-check, cold), in the worker | S7.2 | 300 ms (reference PC; set at 200 ms in Phase 0 with a warm model in mind, measured cold 225–235 ms in S7.4) |
| One scenario value recalculated, 20-sheet deck ≤ 2,000 formula cells | S7.4 | 150 ms |
| One value recalculated + 20 Liquid Glass slides exported to PDF | S8.3 | 3 s |
| 20 values × 1 design × 20 slides, PDF | S8.3 | 40 s |
| Longest main-thread task during a run | S8.3 | 50 ms |
| Preview switch (value → stage drawn) | S8.4 | 400 ms |
| Chart DL build (pie, 12 slices) · callout DL build | S9.2 / S9.4 | 5 ms · 2 ms |
| Free-layout drag frame | S10.2 | 16 ms |
| PPTX 20 slides, Glass / Excel: time · size | S11.3 | 3 s / 1.5 s · 3 MB / 300 KB |
| Open deck20 → first slide (unchanged) | – | 400 ms |

---

## 7. Milestones and steps (PLAN Part C format; ⏱ benchmark, 🚦 product-owner gate, ⇢ ships)

Branches `v4/M7-recalc`, `v4/M8-scenarios`, `v4/M9-charts-callouts`, `v4/M10-free-layout-gridlines`, `v4/M11-pptx`,
`v4/M12-audit`. Each milestone ends with the `AUDIT.md` §0 protocol twice on clean clones (results in `PROGRESS.md`).

### M7 · Recalculation core (F0; ships 4.2.0-pre, nothing visible but B23/B24 and the wizard's linked files)
**S7.1 · Formulas read** — *Read:* `sheetstore.ts` scanner, `xlsb/sheet.ts`, `xlsb/formula.ts`. *Do:* keep `<f>` (shared expanded, array
refs); `.xlsb` Rgce → A1 for cell formulas (or "values only" per sheet, reported). *Done when:* RC-01 on spike `.xlsx` and
`.xlsb` twins; sheetstore equivalence tests unchanged; big30 parse budget unchanged (formulas are interned strings).
**S7.2 · Engine in the worker** ⏱ — *Read:* `core/src/text/wasm/`, `tools/vendor-harfbuzz.mjs`, `spikes/recalc/`, ADR-013. *Do:* vendor
`@ironcalc/wasm` 0.9.0 (MIT/Apache-2.0: licence file copied, ADR-013), inline like hb.wasm, lazy `initSync`; `core/src/calc/engine.ts`:
build a model from SheetStores (strings, numbers, booleans, errors, formulas), rule 3 bounding, `set(sheetId, ref, value)`,
`evaluate()`, `changed()` → overlay. *Done when:* unit tests on the spike corpus give §1.3's numbers; ⏱ first use < 200 ms;
page size and open bench recorded; no DOM types in core.
**S7.3 · Linked workbooks** — *Read:* `workbook.ts` (externalLinks), `host.ts` open path, `wizard/Wizard.tsx` step 1. *Do:* `preset.links`,
sheet ids, external links into one model (mangled names tested), the wizard's "+ Add a linked workbook", Issues lines. *Done when:*
LK-01…LK-03, OV cases for sheet ids, e2e with two files.
**S7.4 · Self-check and overlay** ⏱ — *Do:* `selfCheck()` classes, Issues line (B24), `OverlaySheet` facade, `tableKey` with the overlay
hash, `scenario.plan/preview/cancel` RPC (no UI yet beyond a hidden dev command). *Done when:* RC-02…RC-06; ⏱ 150 ms per value.
**S7.5 · Milestone close** — AUDIT §0 twice; CHANGELOG (B22–B24); 🚦 product owner reads the self-check numbers of their real workbooks
(run by them with the hidden command; the Issues line) before M8 starts: **gate G4**.

### M8 · Scenario export (F1; ships 4.2.0) ⇢
**S8.1 · Dialog** — Export ▾ › *Run for each value…*: input cell (name box syntax, or click a cell), values (textarea; paste; "From a
range…" reusing the wizard grid through `getSheetWindow`; de-dup; "treat as text"), designs, versions, PDF/PPTX (PPTX greyed until M11),
Run / Preview. *Done when:* SC-01, SC-07 e2e.
**S8.2 · Names and files** — §2.5 rules in `core/src/export/names.ts` (shared with the existing B11 names). *Done when:* SC-03, SC-04 unit.
**S8.3 · The run** ⏱ — worker loop of §2.4, 3 export workers, progress, cancel, report dialog with Open folder. *Done when:* SC-02, SC-05,
SC-06, SC-08, SC-09; the brief's "3 values × 2 designs → 6 files" e2e.
**S8.4 · Preview** ⏱ — banner, clear, edits allowed, preview < 400 ms. **S8.5 · Close** — AUDIT §0 twice; CHANGELOG B15; 🚦 **G5** the
product owner runs a real deck (10 values) and signs off the names and the report.

### M9 · Charts and callouts (F2, F3, B19 part 1; ships 4.3.0) ⇢
**S9.1 · `item.patch`** — types, ops, inverses, ≥ 16 vectors. **S9.2 · Pie/donut DL** ⏱ — `core/src/render/chart-dl.ts`, palette per design,
labels, legend, leaders, hit nodes; glass card recipe. *Done when:* CH-01 DL snapshots per design, 🚦 **G6** pixel sign-off of the three
designs (GP report of the chart corpus slides). **S9.3 · Chart UI** — ribbon *Insert chart ▾* (from selected cells / from range…), side panel
of the selected chart (type, labels, legend, colours, title), Issues lines. *Done when:* CH-02…CH-04. **S9.4 · Callouts** ⏱ — shapes, icons,
`{ref}` substitution with number formats, UI (*Insert shape ▾*, fill/border/text controls on ribbon 2). *Done when:* CL-01, CL-02.
**S9.5 · Objects in raw Excel** — `notesOf` and `fixedScale` changes, accepted parity entries signed (B19). **S9.6 · Close** — AUDIT §0 twice;
CHANGELOG B16, B17, B19, B24.

### M10 · Free layout and cell gridlines (F4, F5; ships 4.4.0) ⇢
**S10.1 · Free layout model** — `free` map, `computeLayout` branch, switch on/off ops, vectors. *Done when:* FL-01 unit + e2e.
**S10.2 · Drags** ⏱ — `freeMove`/`freeResize` for tables, text boxes, charts, callouts; Alt; traces ≤ 16 ms. *Done when:* FL-02, FL-03.
**S10.3 · Cell gridlines** — `cellGrid`, ribbon section, painter, `excel-dl`/`glass-dl` lines. *Done when:* GL-01, GL-02; TA-10 rows still pass.
**S10.4 · Close** — AUDIT §0 twice; CHANGELOG B18, B20; 🚦 **G7** sign-off of the free-layout handles and the gridline look.

### M11 · PowerPoint (F6; ships 4.5.0) ⇢
**S11.1 · Writer skeleton** — zip, presentation/master/layout/theme, one text box per `texts` entry, pictures; `tools/pptxcheck.py` 1–3.
*Done when:* a 20-slide deck opens in PowerPoint (COM check) with its texts. **S11.2 · Tables and shapes** — `a:tbl` from `semantics.tables`,
callout shapes, borders, merges; glass card pictures. *Done when:* PX-03 for tables; GT texts found. **S11.3 · Charts, background layer,
budgets** ⏱ — native pie/donut with embedded workbook; `picturesOnly` PNG layer; PX-04. **S11.4 · Menu and runs** — every Export item gets
*PowerPoint* / *PDF + PowerPoint*; scenario runs with `kinds`. *Done when:* PX-01, PX-02 recorded on this PC's PowerPoint 16; 🚦 **G8**
the product owner opens three decks in PowerPoint 2016 (W15) and signs off the fidelity table. **S11.5 · Close** — AUDIT §0 twice;
CHANGELOG B21.

### M12 · Independent audit of 4.2–4.5 (as Prompt 10) — a new `docs/next/AUDIT-2.md`.

Effort (one engineer, the rhythm of M0–M6): M7 4 weeks, M8 3, M9 5, M10 3, M11 5, M12 2 = **22 weeks** (+20 %).

---

## 8. Questions for the product owner (answers go under PROGRESS "Decisions"; nothing of §7 starts before 1–4)

1. **Engine and page size.** IronCalc (MIT/Apache-2.0, ADR-013) adds ≈ 2.8 MB to the page, loaded on first use. OK? (The
   alternative, an engine of our own, is 4–6 weeks before the first real workbook and open-ended after.)
2. **The self-check gate.** When a scenario would draw a cell the engine computes differently from Excel's saved value,
   the run **stops and lists them** unless "run anyway, mark these cells" is ticked. Agree? Or should it always run
   and only mark?
3. **Linked workbooks.** (a) A deck draws from several files through `preset.links` with sheet ids `[File.xlsx]Sheet`;
   the deck stays keyed by the main workbook (its journal, its "slides by" entry). (b) Linked files in the same folder
   are loaded for recalculation even when not added to the deck. Agree with both?
4. **PowerPoint fonts:** named, not embedded, in the first release (PowerPoint substitutes missing library fonts;
   Microsoft fonts exist on the PCs). Agree, or must library fonts with an installable `fsType` be embedded at once?
5. **Glass tables in PowerPoint:** real table over a picture of the card; capsules become rectangular cell fills.
   Agree, or should Liquid Glass tables be pictures with a transparent editable text layer?
6. **Raw Excel (your "yes, all of them")**: this also turns on **automated comments and the notes section** in raw
   Excel (they are text boxes). Confirm; and confirm that the existing raw-Excel slides that have text boxes may change
   (accepted parity entries under B19).
7. **Scenario value typing:** a value that parses as a number goes in as a number when the input cell holds a number
   today, else as text; a "treat as text" switch overrides. OK?
8. **`TEXT` locale:** the self-check reports locale-dependent cells; under a scenario they are recomputed with English
   codes (IronCalc) – so an Italian-saved `"mmm aa"` label may change language in a run. Accept and show in the report,
   or should such cells keep their cached text and be marked "not recalculated"? (Recommended: keep and mark.)
9. **Free layout in thumbnails and PDFs:** identical by construction (same DL). Any per-design rule you want (e.g. free
   layout only in the current design, or copied to all three when switched on)? Proposed: per design, as sizes.
10. **Releases:** four ships (4.2 scenarios, 4.3 charts/callouts, 4.4 free layout/gridlines, 4.5 PowerPoint) or fewer,
    bigger ones? PowerPoint could move before charts if it matters more (it does not depend on M9/M10 except for drawing
    their objects, which would then be pictures until a later step).
11. **Where do the spike workbooks go?** Proposed: `tests/corpus/workbooks/recalc/` (`Banks`, `Peers`, `BanksBig`,
    `truth/`, ≈ 1 MB) plus the generator in `spikes/recalc/`, regenerated only on a PC with Excel (dev tool, like
    `make-xlsb-twins.ps1`).
12. **Gate order:** G4 (self-check on your real workbooks) is the point where this design is proven on your data; may
    I get the Issues line numbers from you then (no file leaves your PC)?
