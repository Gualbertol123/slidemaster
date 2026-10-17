/* The large stress corpus (product owner 2026-10-17: "test with some very complicated excel workbooks, multiple,
   interconnected… large and complex") – tests/corpus/workbooks/large, made by spikes/recalc/make_large.ps1 with the
   Italian Excel of this PC:
     Model.xlsx (Italian formulas) ⇄ Peers.xlsx (English) ⇄ Regions.xlsx (English, reads both, read back by Model);
     Speed.xlsx: one stand-alone file of ~91k formula cells (60 chained sheets).
   A measurement, not a gate: it prints the self-check classes, every scenario case against the copy Excel recalculated
   (truth/cases.json lists the command cells each case sets), the cells that differ grouped by sheet and column, and
   the timings. It asserts only robust facts (files read, links listed, formula counts, nothing throws). */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkbook } from "../src/xlsx/workbook";
import { CalcModel, loadEngine, sameValue, type CellValue, type FormulaCell } from "../src/calc/engine";
import { numToCol } from "../src/xlsx/util";
import type { Workbook } from "../src/xlsx/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const LARGE = path.join(here, "../../tests/corpus/workbooks/large");
const read = async (p: string) => readWorkbook(fs.readFileSync(p).buffer.slice(0) as ArrayBuffer);
const cachedOf = (wb: Workbook, sheet: string, r: number, c: number): CellValue => { const x = wb.sheets.find(s => s.name === sheet)?.get(r, c); return !x || x.t === "blank" ? null : x.t === "e" ? { err: String(x.v) } : (x.v as CellValue); };
const now = () => performance.now();
const ms = (t: number) => t.toFixed(0) + " ms";
const short = (v: CellValue) => { const s = JSON.stringify(v); return s && s.length > 60 ? s.slice(0, 57) + "…" : s; };
interface Case { name: string; files: string[]; set: { book: string; sheet: string; r: number; c: number; v: string | number }[] }
const cases: Case[] = JSON.parse(fs.readFileSync(path.join(LARGE, "truth", "cases.json"), "utf8").replace(/^﻿/, ""));

/** differing cells grouped by "book sheet!column": the count, and the first cell's formula and values */
function grouped(diffs: { f: FormulaCell; main: string; got: CellValue; want: CellValue; tag?: string }[]) {
  const g = new Map<string, { n: number; first: string; tags: Set<string> }>();
  for (const d of diffs) {
    const key = `${d.f.book ?? d.main} ${d.f.sheet}!${numToCol(d.f.c)}`;
    let e = g.get(key);
    if (!e) g.set(key, e = { n: 0, first: `${numToCol(d.f.c)}${d.f.r} = ${d.f.text}${d.f.array ? " {array " + d.f.array + "}" : ""}: got ${short(d.got)} want ${short(d.want)}`, tags: new Set() });
    e.n++; if (d.tag) e.tags.add(d.tag);
  }
  return [...g.entries()].map(([k, e]) => `${k} ×${e.n}${e.tags.size ? " [" + [...e.tags].join(",") + "]" : ""}: ${e.first}`);
}

/** the cells of an array formula's range other than its anchor (a dynamic array's spill, as Excel last wrote it) */
const arrayCells = (f: FormulaCell): [number, number][] => {
  const m = f.array ? /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(f.array) : null; if (!m) return [];
  const col = (x: string) => [...x].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const out: [number, number][] = [];
  for (let r = +m[2]; r <= (m[4] ? +m[4] : +m[2]); r++) for (let c = col(m[1]); c <= (m[3] ? col(m[3]) : col(m[1])); c++) if (r !== f.r || c !== f.c) out.push([r, c]);
  return out;
};

let g: Awaited<ReturnType<typeof loadEngine>>;
beforeAll(async () => { g = await loadEngine(); }, 60_000);

describe("large corpus: Model.xlsx (Italian) + Peers.xlsx + Regions.xlsx, linked A → B → C → A", () => {
  const files = ["Model.xlsx", "Peers.xlsx", "Regions.xlsx"] as const;
  const wb: Record<string, Workbook> = {};
  let model: CalcModel, tBuild = 0;
  beforeAll(async () => {
    const t0 = now();
    for (const f of files) wb[f] = await read(path.join(LARGE, f));
    const t1 = now();
    model = new CalcModel(g, [
      { name: null, file: files[0], sheets: wb[files[0]].sheets, externals: wb[files[0]].externals, names: wb[files[0]].names },
      { name: files[1], sheets: wb[files[1]].sheets, externals: wb[files[1]].externals, names: wb[files[1]].names },
      { name: files[2], sheets: wb[files[2]].sheets, externals: wb[files[2]].externals, names: wb[files[2]].names },
    ]);
    tBuild = now() - t1;
    console.log(`large trio: read ${ms(t1 - t0)}, CalcModel ${ms(tBuild)} (build ${ms(model.ms.build)}, first evaluate ${ms(model.ms.evaluate)}), ${model.formulas.length} formula cells` +
      files.map(f => `\n  ${f}: ${wb[f].sheets.length} sheets, ${model.formulas.filter(x => (x.book ?? files[0]) === f).length} formulas, externals ${JSON.stringify(wb[f].externals)}`).join("") +
      (model.styleError ? "\n  style error: " + model.styleError : ""));
  }, 300_000);
  afterAll(() => model?.dispose());

  it("reads the three files and their links", () => {
    expect([...wb["Model.xlsx"].externals].sort()).toEqual(["Peers.xlsx", "Regions.xlsx"]);
    expect(wb["Peers.xlsx"].externals).toEqual(["Model.xlsx"]);
    expect([...wb["Regions.xlsx"].externals].sort()).toEqual(["Model.xlsx", "Peers.xlsx"]);
    expect(wb["Model.xlsx"].sheets.length).toBe(47);
    expect(model.formulas.length).toBeGreaterThan(20_000);
  });

  it("self-check (the Formulas line)", () => {
    const t0 = now(); const sc = model.selfCheck(); const t = now() - t0;
    console.log(`large trio self-check (${ms(t)}): ${JSON.stringify(sc.counts)} of ${model.formulas.length}` +
      `\n  pinned (locale): ${sc.pinned.length}` + sc.pinned.slice(0, 15).map(p => `\n    ${p.book ?? files[0]} ${p.sheet}!${p.ref} = ${p.text}: ${short(p.cached)}`).join("") +
      "\n  different (first 40):" + sc.different.slice(0, 40).map(d => `\n    ${d.book ?? files[0]} ${d.sheet}!${d.ref} = ${d.text}: cached ${short(d.cached)} computed ${short(d.computed)}`).join(""));
    // every different cell (not only the first 200 of `different`), grouped
    const all: { f: FormulaCell; main: string; got: CellValue; want: CellValue }[] = [];
    for (const f of model.formulas) {
      const want = cachedOf(wb[f.book ?? files[0]], f.sheet, f.r, f.c), got = model.valueOf(f.book, f.sheet, f.r, f.c);
      if (!sameValue(got, want)) all.push({ f, main: files[0], got, want });
    }
    console.log(`large trio: ${all.length} formula cells differ from Excel's cached value (incl. volatile / locale), by sheet and column:\n  ` + grouped(all).join("\n  "));
    expect(sc.counts.exact).toBeGreaterThan(0);
    // since the defined names reach the engine (M8): nothing differs; the locale-dependent TEXT cells are kept (07 §8 Q8)
    expect(model.namesSkipped).toEqual([]);
    expect(sc.counts.different).toBe(0); expect(sc.counts.external + sc.counts.unreadable + sc.counts.hidden).toBe(0);
  });

  it("every scenario case against the copies Excel recalculated", async () => {
    const trio = cases.filter(c => c.files.includes("Model.xlsx"));
    expect(trio.length).toBe(12);
    const diffs: { f: FormulaCell; main: string; got: CellValue; want: CellValue; tag: string }[] = [];
    const lines: string[] = [];
    const spill: typeof diffs = [];
    for (const k of trio) {
      // the command cells: the engine evaluates on every input unless paused (the first case shows the cost of that)
      const paused = k !== trio[0], tS = now();
      if (paused) model.model.pauseEvaluation();
      for (const s of k.set) expect(model.set(s.book === files[0] ? null : s.book, s.sheet, s.r, s.c, s.v)).toBe(true);
      if (paused) model.model.resumeEvaluation();
      const tSet = now() - tS;
      const t0 = now(); model.evaluate(); const tEval = now() - t0;
      const truth: Record<string, Workbook> = {};
      for (const f of files) truth[f] = await read(path.join(LARGE, "truth", k.name, f));
      if (k.name.includes("region")) {                             // the FILTER spill: 6 banks of Centro → 2 of Isole
        const col = (wbk: Workbook | null) => [2, 3, 4, 5, 6, 7, 8].map(r => short(wbk ? cachedOf(wbk, "Calc_Dynamic", r, 1) : model.valueOf(null, "Calc_Dynamic", r, 1))).join(" ");
        const anchor = model.formulas.find(f => f.book === null && f.sheet === "Calc_Dynamic" && f.r === 2 && f.c === 1);
        console.log(`${k.name}: Calc_Dynamic!A2:A8 (FILTER spill, array ${anchor?.array}) engine ${col(null)} | Excel ${col(truth[files[0]])} | before ${col(wb[files[0]])}`);
      }
      let total = 0, equal = 0;
      for (const f of model.formulas) {
        const want = cachedOf(truth[f.book ?? files[0]], f.sheet, f.r, f.c), got = model.valueOf(f.book, f.sheet, f.r, f.c);
        total++; if (sameValue(got, want)) equal++; else diffs.push({ f, main: files[0], got, want, tag: k.name.slice(0, 2) });
      }
      // the spilled cells (not formula cells: the comparison above never sees them)
      let aTotal = 0, aEqual = 0;
      for (const f of model.formulas) for (const [r, c] of arrayCells(f)) {
        const want = cachedOf(truth[f.book ?? files[0]], f.sheet, r, c), got = model.valueOf(f.book, f.sheet, r, c);
        aTotal++; if (sameValue(got, want)) aEqual++; else spill.push({ f: { ...f, r, c, text: "(spill of " + numToCol(f.c) + f.r + ") " + f.text }, main: files[0], got, want, tag: k.name.slice(0, 2) });
      }
      lines.push(`${k.name}: ${equal} of ${total} equal, spilled cells ${aEqual} of ${aTotal} (set ${k.set.length} cells ${ms(tSet)}${paused ? " paused" : " NOT paused"}, evaluate ${ms(tEval)})`);
    }
    console.log("large trio scenarios:\n  " + lines.join("\n  ") + `\n  differing cells by sheet and column (case numbers in brackets):\n  ` + grouped(diffs).join("\n  ") +
      `\n  differing spilled cells (array ranges as Excel last wrote them):\n  ` + grouped(spill).join("\n  "));
  }, 600_000);
});

describe("large corpus: Speed.xlsx (≈91k formula cells, 60 chained sheets)", () => {
  let w: Workbook, model: CalcModel;
  beforeAll(async () => {
    const t0 = now(); w = await read(path.join(LARGE, "Speed.xlsx")); const t1 = now();
    model = new CalcModel(g, [{ name: null, file: "Speed.xlsx", sheets: w.sheets, externals: w.externals, names: w.names }]);
    console.log(`Speed.xlsx: read ${ms(t1 - t0)}, CalcModel ${ms(now() - t1)} (build ${ms(model.ms.build)}, first evaluate ${ms(model.ms.evaluate)}), ${w.sheets.length} sheets, ${model.formulas.length} formula cells` + (model.styleError ? "\n  style error: " + model.styleError : ""));
  }, 600_000);
  afterAll(() => model?.dispose());

  it("self-check", () => {
    expect(model.formulas.length).toBeGreaterThan(90_000);
    const sc = model.selfCheck();
    const all: { f: FormulaCell; main: string; got: CellValue; want: CellValue }[] = [];
    for (const f of model.formulas) { const want = cachedOf(w, f.sheet, f.r, f.c), got = model.valueOf(f.book, f.sheet, f.r, f.c); if (!sameValue(got, want)) all.push({ f, main: "Speed.xlsx", got, want }); }
    console.log(`Speed.xlsx self-check: ${JSON.stringify(sc.counts)} of ${model.formulas.length}` + (all.length ? "\n  " + grouped(all).slice(0, 60).join("\n  ") : ""));
    expect(sc.counts.exact).toBe(model.formulas.length);
  });

  it("scenario cases against Excel's copies, and the time of one scenario value", async () => {
    const lines: string[] = [];
    const diffs: { f: FormulaCell; main: string; got: CellValue; want: CellValue; tag: string }[] = [];
    for (const k of cases.filter(c => c.files.includes("Speed.xlsx"))) {
      const tS = now();
      for (const s of k.set) expect(model.set(null, s.sheet, s.r, s.c, s.v)).toBe(true);
      const tSet = now() - tS;
      const t0 = now(); model.evaluate(); const tEval = now() - t0;
      const truth = await read(path.join(LARGE, "truth", k.name, "Speed.xlsx"));
      let total = 0, equal = 0;
      for (const f of model.formulas) { const want = cachedOf(truth, f.sheet, f.r, f.c), got = model.valueOf(null, f.sheet, f.r, f.c); total++; if (sameValue(got, want)) equal++; else diffs.push({ f, main: "Speed.xlsx", got, want, tag: k.name }); }
      lines.push(`${k.name}: ${equal} of ${total} equal (set ${k.set.length} cells NOT paused ${ms(tSet)}, evaluate ${ms(tEval)})`);
    }
    const t0 = now(); const v = model.values(); const tRead = now() - t0;
    console.log("Speed.xlsx scenarios:\n  " + lines.join("\n  ") + `\n  reading all ${v.length} values back: ${ms(tRead)}` + (diffs.length ? "\n  " + grouped(diffs).slice(0, 60).join("\n  ") : ""));
    expect(lines.length).toBe(2);
  }, 600_000);
});
