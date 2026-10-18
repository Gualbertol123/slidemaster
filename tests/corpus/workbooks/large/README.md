# Large stress corpus

Built by `spikes/recalc/make_large.ps1`, which drives the Italian Excel 16 (build 14334) on the dev PC through COM.
The test is `core/tests/large-corpus.test.ts`. The product owner asked on 2026-10-17 for "very complicated excel
workbooks, multiple, interconnected… large and complex". The real dashboards are confidential, so these stand-ins are
built the same way, only bigger than G4's. There are no macros.

To regenerate: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File spikes\recalc\make_large.ps1`. It takes about
18 s and deletes and rebuilds this folder. Excel must be Italian, because FormulaLocal text and NumberFormatLocal
codes are written in Italian.

## Files

| File | Size | Sheets | Formula cells | Formulas typed in |
|---|---:|---:|---:|---|
| Model.xlsx | 711 KB | 47 | 19,958 | Italian (`Formula2Local`) |
| Peers.xlsx | 89 KB | 11 | 2,523 | English (`Formula2`) |
| Regions.xlsx | 31 KB | 9 | 475 | English |
| Speed.xlsx | 2.1 MB | 64 | 91,281 | English |
| truth/ (14 cases) | 13 MB | | | Excel's recalculated copies |

The whole folder is about 17 MB.

* **Model.xlsx** is the group dashboard.
  * `Control` holds the command cells B2 bank (text), B3 month index 1–36, B4 scenario rate and B5 region (text), plus
    about 20 cells derived from them. These include TEXT with Italian codes, TODAY() and two cells that read
    Peers.xlsx and Regions.xlsx back.
  * `Data` has 5,760 rows: 20 banks × 36 months × 8 products, with two formula columns (margin, and a text key).
  * Lookup sheets: `Banks`, `FX` (vertical, plus a horizontal block for HLOOKUP), `Budget` (two 20 × 36 grids for
    two-way INDEX/MATCH), `Products` and `Aree`.
  * 16 `Calc_*` sheets:
    * SUMIFS / AVERAGEIFS / COUNTIFS / MAXIFS / MINIFS over the 5,760 rows, including whole-column references.
    * Three 20 × 36 SUMIFS grids.
    * XLOOKUP with not-found values, match modes 1, -1 and 2 (wildcard), and search mode -1.
    * VLOOKUP, HLOOKUP and INDEX/MATCH two-way.
    * SUMPRODUCT, IF / IFERROR / AND / OR / CHOOSE / SWITCH / IFS, LET, RANK, PERCENTILE, MEDIAN, STDEV.S,
      PERCENTRANK, LARGE / SMALL.
    * Date maths: DATE, EOMONTH, EDATE, DATEDIF, NETWORKDAYS, WORKDAY, WEEKDAY.
    * Text: LEFT, RIGHT, MID, FIND, SUBSTITUTE, TRIM, PROPER, REPT, TEXTJOIN, CONCATENATE, VALUE.
    * Dynamic arrays (each spills): FILTER (its size follows the region), SORT, SORTBY, UNIQUE, SEQUENCE, TRANSPOSE.
    * OFFSET, INDIRECT and ADDRESS.
    * 11 defined names, one of them a formula (`VolSel`) and one a constant (`TaxRate`).
    * A 10-level cross-sheet chain (`Calc_Deep`) and a summary that reads every sheet.
  * 24 `SLIDE …` sheets are marker tables: an x at B2, the title at C3, headers in row 4, and an x after the last cell.
* **Peers.xlsx** reads Model's Control and results through `'[Model.xlsx]Sheet'!A1`, including direct references,
  INDEX into Model ranges and 20-row blocks. It also has:
  * its own peer data (720 rows): SUMIFS, XLOOKUP on a text key, VLOOKUP, IFS, SWITCH, LET, AVERAGEIFS, MAXIFS,
    RANK.EQ, HLOOKUP, OFFSET;
  * a TEXT with English codes ("0.0%") and a TODAY();
  * four slides.
* **Regions.xlsx** reads both Model.xlsx and Peers.xlsx (including SUMIFS whose criteria range is on one sheet and
  whose sum range is on another) and has three slides. Model reads its `Summary` back, so the links run Model → Peers
  → Regions → Model, and Model also reads Peers directly.
* **Speed.xlsx** is a stand-alone speed file:
  * Control (B2 bank, B3 rate), 1,040 data rows and a 20 × 52 SUMIFS grid;
  * 60 chained sheets of 30 × 50 formulas each. Each sheet reads the previous one, with five formula patterns: growth
    with INDEX/MOD, ROUND, IF, SUM/AVERAGE windows and VLOOKUP;
  * a Summary that reaches every step sheet through INDIRECT.
* **truth/** holds the scenario copies. `cases.json` lists the command cells each case sets, and `truth/<case>/` holds
  the files after Excel's CalculateFull and SaveCopyAs. There are 12 cases for the linked trio: 6 banks, rates 0 and
  0.08, months 13 and 36, region "Isole", and one combination. Speed.xlsx has 2 cases: a bank and a rate.

## What the engine does with it (core/tests/large-corpus.test.ts, 2026-10-17)

### Self-check

* **Trio**, 22,956 formula cells: exact 22,766, locale 79 (pinned TEXT), different 111.
* **Speed**, 91,281 cells: all exact.

### Scenarios

* **Trio**: 22,843 of 22,956 cells equal for each bank case, 22,844 for the rate cases, 22,785 and 22,791 for the
  month cases, 22,845 for the region case and 22,794 for the combination.
* **Trio spilled cells**: 128 of 128 equal, except 120 of 128 in the region case and 124 of 128 in the combination.
* **Speed**: 91,281 of 91,281 equal in both cases.

### Classes of difference

* **Defined names are not loaded (111 cells, every case).** These are `Calc_Names`, `SLIDE Nomi` and one
  `SLIDE Controlli` check. The engine computes `#NAME?` where Excel has values. The reader does not read
  `<definedNames>` and CalcModel never calls IronCalc's `newDefinedName`. The engine has the API; the gap is in our
  reader and adapter.
* **Pinned locale cells do not follow a scenario.** By design (07 §8 Q8) TEXT cells keep Excel's base value, so the
  cells that read them go stale. The stale cells per case:
  * Bank cases: 2 (Peers Summary!B7 `TEXT(B2,"0.0%")`, which this Italian Excel shows as "06%", and Model
    Calc_Links!B7, which reads it).
  * Rate cases: 1 (the `SLIDE Scenario` title, `TEXT(rate,"0,0%")`).
  * Month cases: 54–60, and 51 in the combination case. These are Control!B10 "mmmm aaaa" and every title built from
    it (Model and Peers Link!B7), plus Calc_Text!K/P `"#.##0,0"` / `"0,0%"` and SLIDE Testi.
  * Region case: 0.
* **A shrinking dynamic-array spill.** With FILTER by region, Centro's 6 banks become 2 for Isole. The engine keeps
  Excel's original array size and fills the leftover cells with `#VALUE!`, where Excel leaves them empty. This
  happens in Calc_Dynamic!A4:A7 and SLIDE Dinamica!H7:H10. Formula-cell comparisons cannot see it, because spilled
  cells are not formula cells. A growing spill would be truncated; no case grows one.
* **No other differences.** XLOOKUP modes, INDIRECT, OFFSET, ADDRESS, LET, SORT, SORTBY, UNIQUE, SEQUENCE,
  NETWORKDAYS, WORKDAY, DATEDIF, TEXTJOIN, PERCENTRANK, whole columns, three-file links and the 91k-cell chain all
  match Excel exactly.

### Timings

Measured on the dev PC under vitest:

| Step | Trio | Speed |
|---|---:|---:|
| Read the files | 0.2–0.3 s | 0.2 s |
| CalcModel build | 0.8–1.1 s | 5.8–6.3 s |
| First evaluation | 4.2–4.8 s (two evaluations, because of the locale pinning) | 0.6–0.7 s |
| One scenario evaluation | 2.0–3.0 s | 0.56–0.69 s |
| Reading all values back | | 0.45–0.53 s |

`CalcModel.set()` is not paused. Each input runs a full evaluation, so the trio's 4 command cells took 8.4–9.3 s
before the explicit evaluate, and 0 ms with `model.model.pauseEvaluation()` around them. Excel recalculates the trio
and saves three copies in about 0.25 s per case.

### A side note on G4

The Italian name of RANK.EQ is not `RANGO.EQ`: Excel keeps that as an unknown name. So
`g4/Cruscotto.xlsm Calcoli!C14` caches `#NAME?`, and the engine matches it without testing RANK. Here the generator
uses `RANGO` (RANK), and it lists any error values Excel produced in formula cells.
