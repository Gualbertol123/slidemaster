# ADR-013: Recalculation by IronCalc (WASM) inside the core worker, checked against Excel's saved values; no Excel at run time

* **Status:** proposed (Phase 0 design, 2026-10-16; needs the product owner's answer to 07 §8 Q1–Q2)
* **Deciders:** product owner (no Excel on the running PC, 2026-10-16), maintainers
* **Related:** `docs/next/07-scenarios-charts-pptx.md` §1, `spikes/recalc/`, ADR-001, ADR-002

## Context
Scenario export (F1), charts (F2) and callouts (F3) need the values of dependent cells after an input cell changes.
Slide Builder keeps only Excel's cached values (`core/src/xlsx/sheetstore.ts`). The product owner ruled out opening
Excel on the user's PC (different versions; PowerShell Constrained Language Mode blocks COM anyway, W6). Part A allows
only MIT/BSD/Apache dependencies, recorded in an ADR, and no native executable (ADR-001; WASM in the page is already
accepted for HarfBuzz).

## Decision
* **`@ironcalc/wasm` 0.9.0** (MIT or Apache-2.0, Rust compiled to WebAssembly, 2,089,699 bytes; 714 KB gzip) is vendored
  and inlined in the page like `hb.wasm`, pinned by content hash, instantiated lazily in the core worker on first use.
  Its licence texts are copied to `core/src/calc/wasm/LICENSE-ironcalc`.
* The core builds the engine's model from its own SheetStore (cells, formula text read by S7.2), so the workbook is read
  once, by our reader, as today; whole-column/row references are bounded to the used range (07 §1.4 rule 3).
* **Self-check**: on first use every formula cell is evaluated and compared with the cached value; cells are classed
  exact / volatile / locale / external / different, reported in the Issues panel, and a scenario run that would draw a
  `different` cell stops with the list unless the user chooses "run anyway, mark these cells".
* The helper's COM conversion (`convert.py`) stays for `.xls` and protected files only; it never recalculates.

## Consequences
+ No Excel, no PowerShell, no new executable; works under W6 and from `file://`.
+ Measured (spike, 20-sheet deck with 1,259 formulas): 65 ms per scenario value; 100 % of non-volatile, non-locale
  cells equal Excel across 10 scenario values of two linked files.
+ Incremental recalculation, cycle detection, dynamic arrays (XLOOKUP, LET, FILTER) come with the engine.
− Page + 2.8 MB (B23); first use ≈ 200 ms budget (never on the open path).
− Functions IronCalc lacks give error cells; the self-check makes that visible before a run, but it is a limit.
− `TEXT`/date format codes depend on the saving Excel's UI language; the engine uses English codes (07 §1.3).
− External links are not an engine feature: ADR-014 loads linked files into the same model.
− Values are read back through a 15-significant-digit format (no raw getter in the WASM API); the model built from
  our SheetStore keeps no number formats, so `TEXT()` with locale codes and dynamic-array spills are limits (07 §1.4).
+ Measured in S7.2 (reference-speed PC): engine first use 113 ms (WASM 32 + model and self-check of the 20-sheet deck
  81), one scenario value 74 ms; the page grows from 1,540,884 to 3,540,517 bytes (B23).

## Evidence and alternatives
`spikes/recalc/results.json`, 07 §1.3. fast-formula-parser (MIT) lacks MATCH/INDEX/SUMIFS (throws) and a graph: 1 of
1,239 cells; hot-formula-parser archived; formulajs has no parser; HyperFormula is GPL-3.0 (excluded by Part A); an
engine of our own ≈ 4–6 weeks before the first real workbook, open-ended after. Excel COM: 3 s floor per run, W6,
rejected by the product owner.
