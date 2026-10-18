/* Gate G4's stand-in (product owner 2026-10-17: the team's dashboards are confidential, so G4 is measured on workbooks
   built like them – tests/corpus/workbooks/g4, made by spikes/recalc/make_g4.ps1 with the Italian Excel of this PC):
   two macro-enabled files linked both ways, formulas typed in Italian (Cruscotto.xlsm) and in English (Benchmark.xlsm).
   The self-check's classes (the side panel's Formulas line) and every scenario value against Excel's own copy. */
import { describe, expect, it, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkbook } from "../src/xlsx/workbook";
import { CalcModel, loadEngine, sameValue, type CellValue } from "../src/calc/engine";
import { numToCol } from "../src/xlsx/util";
import type { Workbook } from "../src/xlsx/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const G4 = path.join(here, "../../tests/corpus/workbooks/g4");
const read = async (p: string) => readWorkbook(fs.readFileSync(p).buffer.slice(0) as ArrayBuffer);
const cachedOf = (wb: Workbook, sheet: string, r: number, c: number): CellValue => { const x = wb.sheets.find(s => s.name === sheet)!.get(r, c); return !x || x.t === "blank" ? null : x.t === "e" ? { err: String(x.v) } : (x.v as CellValue); };

let g: Awaited<ReturnType<typeof loadEngine>>;
beforeAll(async () => { g = await loadEngine(); }, 60_000);

describe("G4 stand-in: Cruscotto.xlsm (Italian) + Benchmark.xlsm (English), linked both ways", () => {
  let a: Workbook, b: Workbook, model: CalcModel;
  const files = ["Cruscotto.xlsm", "Benchmark.xlsm"] as const;
  beforeAll(async () => {
    a = await read(path.join(G4, files[0])); b = await read(path.join(G4, files[1]));
    model = new CalcModel(g, [{ name: null, file: files[0], sheets: a.sheets, externals: a.externals, names: a.names }, { name: files[1], sheets: b.sheets, externals: b.externals, names: b.names }]);
  }, 60_000);
  it("reads both macro-enabled files and their links", () => {
    expect(a.externals).toEqual(["Benchmark.xlsm"]); expect(b.externals).toEqual(["Cruscotto.xlsm"]);
    expect(a.sheets.map(s => s.name)).toEqual(["Controllo", "Dati", "Anagrafica", "Calcoli", "SLIDE Sintesi", "SLIDE Area", "Macro"]);
    expect(model.formulas.length).toBe(154);
  });
  it("self-check (the Formulas line)", () => {
    const sc = model.selfCheck();
    console.log("G4 stand-in self-check:", JSON.stringify(sc.counts), "of", model.formulas.length, "\n  different:", sc.different.map(d => `${d.book ?? files[0]} ${d.sheet}!${d.ref} = ${d.text}: cached ${JSON.stringify(d.cached)} computed ${JSON.stringify(d.computed)}`).join("\n  "));
    // Controllo!B10 TEXT(…;"mmmm aaaa") (Italian codes) and Compare!B10 TEXT(…,"dd mmm yyyy") (English codes, which this
    // Italian Excel writes "dd set yyyy"): kept at Excel's text (07 §8 Q8), so SLIDE Sintesi!D13, which reads B10, is exact
    // (since M8 both recompute: Slide Builder formats TEXT as this Italian Excel does – textfmt.ts)
    expect(sc.counts).toEqual({ exact: 154, volatile: 0, locale: 0, external: 0, hidden: 0, unreadable: 0, different: 0 });
  });
  it("every scenario value against the copy Excel recalculated (8 banks, 2 rates)", async () => {
    const dirs = fs.readdirSync(path.join(G4, "truth")).sort();
    let total = 0, equal = 0; const diffs: string[] = [];
    for (const d of dirs) {
      const rate = /^rate_(.*)$/.exec(d);
      model.set(null, "Controllo", 2, 2, rate ? "Banca Nord" : d.replace("_", " "));
      model.set(null, "Controllo", 5, 2, rate ? +rate[1] : 0.035);
      model.evaluate();
      const truth: Record<string, Workbook> = { [files[0]]: await read(path.join(G4, "truth", d, files[0])), [files[1]]: await read(path.join(G4, "truth", d, files[1])) };
      for (const f of model.formulas) {
        const want = cachedOf(truth[f.book ?? files[0]], f.sheet, f.r, f.c), got = model.valueOf(f.book, f.sheet, f.r, f.c);
        total++; if (sameValue(got, want)) equal++; else diffs.push(`${d} ${f.book ?? files[0]} ${f.sheet}!${numToCol(f.c)}${f.r} = ${f.text}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
      }
    }
    console.log(`G4 stand-in scenarios: ${equal} of ${total} equal to Excel\n  ` + [...new Set(diffs.map(x => x.replace(/^\S+ /, "")))].slice(0, 40).join("\n  "));
    expect(diffs).toEqual([]);
    expect(total).toBe(10 * 154);
  }, 120_000);
});
