/* The formula engine (PLAN S7.2, docs/next/07 §1.3–§1.4, rows RC-02 … RC-04): IronCalc fed from the SheetStore. On the
   recalc corpus (tests/corpus/workbooks/recalc, made by Excel): the self-check gives the spike's classes, every
   scenario value (Control!B2 = each bank) gives Excel's own recalculated copy for both linked files, whole columns are
   bounded, the WASM is the pinned package's. */
import { describe, expect, it, beforeAll } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkbook } from "../src/xlsx/workbook";
import { CalcModel, loadEngine, sameValue, type CalcBook, type CellValue } from "../src/calc/engine";
import { IRONCALC_WASM_SHA256 } from "../src/calc/wasm/ironcalc-wasm";
import { numToCol } from "../src/xlsx/util";
import type { Workbook } from "../src/xlsx/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const RECALC = path.join(here, "../../tests/corpus/workbooks/recalc");
const read = async (p: string) => readWorkbook(fs.readFileSync(p).buffer.slice(0) as ArrayBuffer);
const cachedOf = (wb: Workbook, sheet: string, r: number, c: number): CellValue => { const x = wb.sheets.find(s => s.name === sheet)!.get(r, c); return !x || x.t === "blank" ? null : x.t === "e" ? { err: String(x.v) } : (x.v as CellValue); };

let g: Awaited<ReturnType<typeof loadEngine>>;
beforeAll(async () => { g = await loadEngine(); }, 60_000);

describe("the inlined engine", () => {
  it("is the pinned @ironcalc/wasm 0.9.0", () => {
    const pkg = path.join(here, "../../node_modules/@ironcalc/wasm");
    expect(JSON.parse(fs.readFileSync(path.join(pkg, "package.json"), "utf8")).version).toBe("0.9.0");
    expect(IRONCALC_WASM_SHA256).toBe(createHash("sha256").update(fs.readFileSync(path.join(pkg, "wasm_bg.wasm"))).digest("hex"));
  });
});

describe("Banks.xlsx + Peers.xlsx (linked both ways)", () => {
  let banks: Workbook, peers: Workbook, model: CalcModel;
  beforeAll(async () => {
    banks = await read(path.join(RECALC, "Banks.xlsx")); peers = await read(path.join(RECALC, "Peers.xlsx"));
    expect(banks.externals).toEqual(["Peers.xlsx"]); expect(peers.externals).toEqual(["Banks.xlsx"]);
    model = new CalcModel(g, [{ name: null, file: "Banks.xlsx", sheets: banks.sheets, externals: banks.externals }, { name: "Peers.xlsx", sheets: peers.sheets, externals: peers.externals }]);
  }, 60_000);
  it("self-check: every formula equals Excel's cached value except the volatile and locale-dependent ones (07 §1.3)", () => {
    const sc = model.selfCheck();
    expect(sc.different).toEqual([]);
    expect(sc.counts.exact + sc.counts.volatile + sc.counts.locale).toBe(208);
    expect(sc.counts.external + sc.counts.unreadable + sc.counts.different).toBe(0);
    expect(sc.counts.locale).toBe(3);                                  // TEXT(date, "mmm yy"): Italian Excel wrote "mar yy" (07 §1.3)
    expect(model.formulas.length).toBe(192 + 16);
  });
  it("every scenario value equals the copy Excel recalculated for that bank, in both files (RC-03)", async () => {
    const banksDir = fs.readdirSync(path.join(RECALC, "truth")).filter(d => d.startsWith("Bank_")).sort();
    expect(banksDir.length).toBe(10);
    let total = 0, equal = 0; const diffs: string[] = [];
    for (const d of banksDir) {
      expect(model.set(null, "Control", 2, 2, d.replace("_", " "))).toBe(true); model.evaluate();
      const truth = { "Banks.xlsx": await read(path.join(RECALC, "truth", d, "Banks.xlsx")), "Peers.xlsx": await read(path.join(RECALC, "truth", d, "Peers.xlsx")) };
      for (const f of model.formulas) {
        if (/\b(?:TODAY|TEXT)\(/.test(f.text)) continue;
        const want = cachedOf(truth[f.book === null ? "Banks.xlsx" : "Peers.xlsx"], f.sheet, f.r, f.c), got = model.valueOf(f.book, f.sheet, f.r, f.c);
        total++; if (sameValue(got, want)) equal++; else if (diffs.length < 10) diffs.push(`${d} ${f.book ?? "Banks"} ${f.sheet}!${numToCol(f.c)}${f.r} = ${f.text}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
      }
    }
    expect(diffs).toEqual([]);
    expect(equal).toBe(total); expect(total).toBeGreaterThanOrEqual(10 * 180);
  });
  it("whole columns are bounded to the used range, not inside OFFSET / INDIRECT", () => {
    const S = banks.sheets.find(s => s.name === "SLIDE_1")!, b = { name: null, sheets: banks.sheets, externals: ["Peers.xlsx"] };
    expect(model.prep("SUMIFS(Data!$C:$C,Data!$A:$A,Control!$B$2)", b, S)).toBe("SUMIFS(Data!$C$1:$C$121,Data!$A$1:$A$121,Control!$B$2)");
    expect(model.prep("INDEX(Data!G:G,MATCH(1,INDEX((Data!A:A=B2)*(Data!B:B=B4),0),0))", b, S)).toBe("INDEX(Data!G$1:G$121,MATCH(1,INDEX((Data!A$1:A$121=B2)*(Data!B$1:B$121=B4),0),0))");
    expect(model.prep("SUM(OFFSET(Data!A:A,1,0))+SUM(1:1)", b, S)).toBe("SUM(OFFSET(Data!A:A,1,0))+SUM($A1:$L1)");
    expect(model.prep("_xlfn.IFS(A1>1,\"a\",TRUE,\"b\")", b, S)).toBe("IFS(A1>1,\"a\",TRUE,\"b\")");
    expect(model.prep("[1]Peer!F7", b, S)).toBe("'«1»Peer'!F7");
  });
  it("a reference to a linked workbook that is not in the model is classed external", () => {
    const alone = new CalcModel(g, [{ name: null, sheets: banks.sheets, externals: ["Peers.xlsx"] }]);
    const sc = alone.selfCheck();
    expect(sc.counts.external).toBe(2);                                // FromB!D4 and D5 name [Peers.xlsx]Peer
    expect(sc.counts.different).toBe(2);                               // FromB!D6 and SLIDE_3!D14 depend on them
    alone.dispose();
  });
});

describe("BanksBig.xlsx (20 chained slide sheets)", () => {
  it("self-check: every formula exact, volatile or locale-dependent; Bank G equals Excel's copy", async () => {
    const wb = await read(path.join(RECALC, "BanksBig.xlsx"));
    const model = new CalcModel(g, [{ name: null, sheets: wb.sheets, externals: [] }]);
    const sc = model.selfCheck();
    expect(sc.different).toEqual([]);
    expect(sc.counts.exact + sc.counts.volatile + sc.counts.locale).toBe(1259);
    expect(sc.counts.external + sc.counts.unreadable + sc.counts.different).toBe(0);
    const truth = await read(path.join(RECALC, "truth", "big_Bank_G", "BanksBig.xlsx"));
    model.set(null, "Control", 2, 2, "Bank G"); model.evaluate();
    const diffs: string[] = []; let n = 0;
    for (const f of model.formulas) { if (/\b(?:TODAY|TEXT)\(/.test(f.text)) continue; n++; const got = model.valueOf(null, f.sheet, f.r, f.c), want = cachedOf(truth, f.sheet, f.r, f.c); if (!sameValue(got, want) && diffs.length < 10) diffs.push(`${f.sheet}!${numToCol(f.c)}${f.r}: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`); }
    expect(diffs).toEqual([]); expect(n).toBeGreaterThanOrEqual(1100);          // 1,259 formulas less the TEXT and TODAY cells
    console.log(`engine · BanksBig: build ${model.ms.build.toFixed(0)} ms, first evaluate ${model.ms.evaluate.toFixed(0)} ms`);
    model.dispose();
  }, 60_000);
});

describe("values and inputs", () => {
  it("texts stay texts, booleans booleans, errors errors; a number input recomputes", async () => {
    const wb = await read(path.join(RECALC, "Functions.xlsx"));
    const model = new CalcModel(g, [{ name: null, sheets: wb.sheets, externals: [] }]);
    const sc = model.selfCheck();
    expect(model.valueOf(null, "F", 1, 2)).toBe("text");
    expect(model.valueOf(null, "F", 24, 5)).toBe(false);               // ISEVEN(5)
    expect(model.valueOf(null, "F", 1, 5)).toBe(0);                    // IFERROR(A1/0,0)
    model.set(null, "F", 1, 1, 8); model.evaluate();
    expect(model.valueOf(null, "F", 24, 5)).toBe(true);
    expect(model.valueOf(null, "F", 999, 1)).toBeNull();
    // what differs is known: functions this PC's Excel lacks (cached #NAME!/#VALUE!, computed here), AGGREGATE / INFO /
    // GETPIVOTDATA / WEBSERVICE / FILTERXML (not in the engine), and two numerics beyond 1e-13 (LOGNORM.DIST, BESSELJ)
    expect(sc.counts.exact).toBeGreaterThanOrEqual(140);
    const known = new Set(["AGGREGATE", "INFO", "GETPIVOTDATA", "WEBSERVICE", "FILTERXML", "LOGNORM.DIST", "BESSELJ", "TOCOL", "VSTACK", "SORT", "SORTBY", "SEQUENCE", "FILTER", "TEXTSPLIT", "TEXTBEFORE", "TEXTAFTER", "LAMBDA", "MAP", "SCAN"]);
    expect(sc.different.filter(d => !known.has(/([A-Z][A-Z0-9.]*)\(/.exec(d.text.replace(/_xl(?:fn|ws|pm)\./g, ""))?.[1] || ""))).toEqual([]);
    model.dispose();
  }, 60_000);
});
