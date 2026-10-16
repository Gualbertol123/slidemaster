# Spike · recalculation without Excel (docs/next/07 §1, ADR-013)

Question: can a JavaScript/WASM formula engine, inside the core worker, recompute workbooks of the product owner's kind
(one command cell, chained tables across sheets, two files linked both ways) exactly like Excel, fast enough for "run
for each bank"? Run on 2026-10-16 on a corporate Windows 11 PC (Node 22.23.3 portable, Excel 16.0 Italian).

## Files
| File | What |
|---|---|
| `make_linked.ps1` | makes the workbooks with the PC's Excel into `tests/corpus/workbooks/recalc/` (dev tool; the product never needs Excel; since S7.1 also `Functions.xlsx`, `formulas.json` = Excel's `Range.Formula` of every formula cell, and the `.xlsb` twins): `Banks.xlsx` (Control!B2 = the bank; Data; SLIDE_1..3 chained; FromB reads Peers.xlsx), `Peers.xlsx` (reads Banks.xlsx, compares with its own peer data), `BanksBig.xlsx` (20 slide sheets, 52 weeks, 1,259 formulas, 39 functions), `truth/<bank>/` = both files recalculated and saved by Excel for each of 10 banks, `truth/big_Bank_G/` the same for the big one. Italian Excel stores `TEXT(d,"mmm yy")` as `"mar yy"` (07 §1.3) |
| `eval.mjs` | reads the `.xlsx` files (shared formulas expanded, external links mapped), evaluates every formula cell with **fast-formula-parser** (a dependency-driven evaluator written around it) and **IronCalc** (model built cell by cell with `setUserInput`), compares with Excel's cached values and with the per-bank truth copies; writes `results.json` |
| `iron_bounded2.mjs` | IronCalc timing per scenario value with whole-column references as written vs bounded to the used range |
| `iron_cost.mjs` | IronCalc cost by formula family (shows the cost was the whole-column array formula, not any function) |
| `results.json` | the measured numbers quoted in 07 §1.3 |

Packages (installed in a scratch folder, not in the repository): `fast-formula-parser@1.0.19` (MIT), `@ironcalc/wasm@0.9.0`
(MIT/Apache-2.0), `fflate@0.8.2` (MIT), plus `xlsx-calc@0.9.2` and `hot-formula-parser@4.0.0` (MIT, inspected, not run).
`hyperformula` is GPL-3.0-only and was not installed.

## Results (short; the table is in 07 §1.3)
* IronCalc: 1,219 / 1,239 non-volatile formulas of `BanksBig.xlsx` equal Excel (the 20 others: Italian `TEXT` codes);
  182 / 186 of `Banks.xlsx` alone (the 4: external links – not an engine feature, 07 §2.3); scenario of 10 banks:
  every non-volatile, non-locale, non-external cell equal to Excel's saved copy (1,820 / 1,890 and 1,219 / 1,239).
* Speed: **65 ms per scenario value** on the 20-sheet deck once whole-column references are bounded to the used range
  (2.4 s as written, because of `A:A` over 1,048,576 rows); 3 ms on the small pair; model build 30 ms; Excel itself:
  `Calculate` 125 ms after the change, `CalculateFull` 192 ms, plus process start/open.
* fast-formula-parser: `MATCH`, `INDEX`, `SUMIFS` throw "not implemented"; no dependency graph; 1 / 1,239 equal.
* The repository corpus has 11 formula cells whose cached values openpyxl wrote as 0, so it cannot verify an engine.
