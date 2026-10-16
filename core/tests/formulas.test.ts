/* Formulas read from workbooks (PLAN S7.1, docs/next/07 §1.4 rule 2, row RC-01): every formula cell of the recalc
   corpus (tests/corpus/workbooks/recalc, made by Excel: spikes/recalc/make_linked.ps1) must read as the text Excel's
   own Range.Formula gives for it (formulas.json) – shared formulas expanded to each child, external references
   named by their file, the `_xlfn.` prefixes of newer functions dropped – from the .xlsx scanner and from the .xlsb
   reader on the twins; plus crafted cases of the shift and of unreadable binary formulas. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, strFromU8 } from "fflate";
import { readWorkbook } from "../src/xlsx/workbook";
import { numToCol } from "../src/xlsx/util";
import { shiftFormula, tokenize, parseSheetId, sheetId } from "../src/calc/refs";
import { quoteSheet } from "../src/xlsx/xlsb/formula";
import type { Sheet } from "../src/xlsx/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const RECALC = path.join(here, "../../tests/corpus/workbooks/recalc");
const truth: Record<string, Record<string, Record<string, string>>> = JSON.parse(fs.readFileSync(path.join(RECALC, "formulas.json"), "utf8").replace(/^﻿/, ""));

/** Excel's text and the file's text, made comparable: no "=", no _xlfn./_xlws./_xlpm. prefixes, external books by
    file name ("[1]" → "[Peers.xlsx]"), no quotes around names that need none */
const norm = (f: string, ext: string[] = []) => f.replace(/^=/, "").replace(/_xl(?:fn|ws|pm)\./g, "")
  .replace(/'?\[(\d+)\]([^'!]*)'?!/g, (_, n, s) => "[" + (ext[+n - 1] || n) + "]" + s + "!")
  .replace(/'\[([^\]]+)\]([^'!]*)'!/g, "[$1]$2!");
/** the external link file names of a workbook, in [n] order, from its package */
function externalNames(file: string): string[] {
  const z = unzipSync(new Uint8Array(fs.readFileSync(file))), out: string[] = [];
  // the external link parts in the order of the workbook's relationships to them (externalLink1, 2, …), which is
  // the [n] order for both the XML and the binary package
  const rels = strFromU8(z["xl/_rels/workbook.xml.rels"] || z["xl/_rels/workbook.bin.rels"] || new Uint8Array());
  const links = [...rels.matchAll(/Target="(externalLinks\/externalLink(\d+)\.(?:xml|bin))"/g)].sort((a, b) => +a[2] - +b[2]);
  for (const l of links) {
    const part = "xl/externalLinks/_rels/" + path.basename(l[1]) + ".rels";
    const tm = z[part] ? /Target="([^"]*)"/.exec(strFromU8(z[part])) : null;
    out.push(tm ? decodeURIComponent(path.basename(tm[1].replace(/\\/g, "/"))) : "?");
  }
  return out;
}

async function formulasOf(file: string): Promise<{ sheets: Record<string, Record<string, string>>; count: number; unreadable: number }> {
  const wb = await readWorkbook(fs.readFileSync(file).buffer.slice(0) as ArrayBuffer);
  const sheets: Record<string, Record<string, string>> = {}; let count = 0;
  for (const S of wb.sheets as Sheet[]) {
    const m: Record<string, string> = {};
    for (const cell of S.cells.values()) { const f = S.formula(cell.r, cell.c); if (f !== null) { m[numToCol(cell.c) + cell.r] = f; count++; } }
    if (Object.keys(m).length) sheets[S.name] = m;
  }
  return { sheets, count, unreadable: 0 };
}

describe("formulas of the recalc corpus equal Excel's Range.Formula", () => {
  // Functions.xlsx: one cell per Excel 2007+ / Analysis ToolPak function (the .xlsb function table was learnt from it)
  for (const name of ["Banks.xlsx", "Peers.xlsx", "BanksBig.xlsx", "Functions.xlsx"]) {
    it(`${name} (.xlsx scanner, shared formulas expanded)`, async () => {
      const file = path.join(RECALC, name), ext = externalNames(file);
      const got = await formulasOf(file), want = truth[name];
      const wantN = Object.values(want).reduce((s, m) => s + Object.keys(m).length, 0);
      const diffs: string[] = [];
      for (const [sh, cells] of Object.entries(want)) for (const [ref, f] of Object.entries(cells)) {
        const g = got.sheets[sh]?.[ref];
        if (g === undefined || norm(g, ext) !== norm(f)) diffs.push(`${sh}!${ref}: file ${g ?? "(none)"} vs Excel ${f}`);
      }
      expect(diffs.slice(0, 20)).toEqual([]);
      expect(got.count).toBe(wantN);
    }, 60_000);
    const twin = path.join(RECALC, "xlsb", name.replace(/\.xlsx$/, ".xlsb"));
    it(`${name} twin (.xlsb reader: Rgce decompiled, PtgExp shared formulas)`, async () => {
      const got = await formulasOf(twin), want = truth[name];
      // the twins were saved last, so their links name the .xlsb twins
      const fix = (s: string) => s.replace(/\[(Banks|Peers)\.xlsb\]/g, "[$1.xlsx]");
      const diffs: string[] = [];
      for (const [sh, cells] of Object.entries(want)) for (const [ref, f] of Object.entries(cells)) {
        const g = got.sheets[sh]?.[ref];
        if (g === undefined || fix(norm(g, externalNames(twin))) !== norm(f)) diffs.push(`${sh}!${ref}: file ${g ?? "(none)"} vs Excel ${f}`);
      }
      expect(diffs.slice(0, 20)).toEqual([]);
    }, 60_000);
  }
  it("every binary formula of the twins is read (none unreadable); an array formula knows its range", async () => {
    for (const name of ["Banks", "Peers", "BanksBig", "Functions"]) {
      const wb = await readWorkbook(fs.readFileSync(path.join(RECALC, "xlsb", name + ".xlsb")).buffer.slice(0) as ArrayBuffer);
      for (const S of wb.sheets) expect({ sheet: S.name, unreadable: S.unreadableFormulas || 0 }).toEqual({ sheet: S.name, unreadable: 0 });
    }
    const fx = await readWorkbook(fs.readFileSync(path.join(RECALC, "xlsb", "Functions.xlsb")).buffer.slice(0) as ArrayBuffer);
    const F = fx.sheets[0];
    expect(F.formula(139, 5)).toBe("_xlfn._xlws.FILTER(A1:A5,A1:A5>1)");   // a dynamic array: PtgExp + BrtArrFmla; the same text as the .xlsx
    expect(F.arrayRef(139, 5)).toBe("E139");
    expect(F.arrayRef(1, 5)).toBeNull();
    const fxX = await readWorkbook(fs.readFileSync(path.join(RECALC, "Functions.xlsx")).buffer.slice(0) as ArrayBuffer);
    expect(fxX.sheets[0].formula(139, 5)).toBe("_xlfn._xlws.FILTER(A1:A5,A1:A5>1)");   // the .xlsx keeps Excel's prefixes (the engine strips them)
    expect(fxX.sheets[0].arrayRef(139, 5)).toBe("E139");
  }, 60_000);
  it("a constant cell has no formula; a sheet without formulas answers null everywhere", async () => {
    const wb = await readWorkbook(fs.readFileSync(path.join(RECALC, "Banks.xlsx")).buffer.slice(0) as ArrayBuffer);
    const data = wb.sheets.find(s => s.name === "Data")!, control = wb.sheets.find(s => s.name === "Control")!;
    expect(data.formula(2, 1)).toBeNull(); expect(data.formula(999, 999)).toBeNull();
    expect(control.formula(2, 2)).toBeNull();                      // the command cell is a constant
    expect(control.formula(3, 2)).toBe("MATCH(B2,Data!H2:H11,0)");
    expect(control.arrayRef(3, 2)).toBeNull();
  });
});

describe("shiftFormula and tokenize", () => {
  it("moves relative references and keeps absolute ones, strings and names", () => {
    expect(shiftFormula("SUM(A1:B2)+$C$3*D$4+E5", 2, 1)).toBe("SUM(B3:C4)+$C$3*E$4+F7");
    expect(shiftFormula('IF(A1="B2",Sheet2!C3,\'My Sheet\'!$D4)', 1, 0)).toBe('IF(A2="B2",Sheet2!C4,\'My Sheet\'!$D5)');
    expect(shiftFormula("LOG10(A1)+ATAN2(B1,C1)", 0, 1)).toBe("LOG10(B1)+ATAN2(C1,D1)");
    expect(shiftFormula("SUM(A:A)+SUM(1:1)+SUM($B:$B)", 1, 1)).toBe("SUM(B:B)+SUM(2:2)+SUM($B:$B)");
    expect(shiftFormula("[1]Peer!F7+'[2]Other Sheet'!A1", 1, 1)).toBe("[1]Peer!G8+'[2]Other Sheet'!B2");
    expect(shiftFormula("TRUE+myName+A1", 1, 1)).toBe("TRUE+myName+B2");
    expect(shiftFormula("A1", 0, 0)).toBe("A1");
  });
  it("wraps at the sheet's edges as Excel does", () => {
    expect(shiftFormula("A1", -1, -1)).toBe("XFD1048576");
  });
  it("tokenizes references with their sheet prefixes", () => {
    const t = tokenize("Data!$C:$C+'Peer data'!A1:B2+\"x!A1\"");
    expect(t.filter(x => x.kind === "ref").map(x => x.s)).toEqual(["Data!$C:$C", "'Peer data'!A1:B2"]);
    expect(t.find(x => x.kind === "str")?.s).toBe('"x!A1"');
  });
  it("sheet ids name the deck's workbook or a linked one", () => {
    expect(parseSheetId("Peer")).toEqual({ book: null, sheet: "Peer" });
    expect(parseSheetId("[Peers.xlsx]Peer")).toEqual({ book: "Peers.xlsx", sheet: "Peer" });
    expect(sheetId("Peers.xlsx", "Peer")).toBe("[Peers.xlsx]Peer"); expect(sheetId(null, "Peer")).toBe("Peer");
    expect(quoteSheet("My Sheet")).toBe("'My Sheet'"); expect(quoteSheet("SLIDE_1")).toBe("SLIDE_1"); expect(quoteSheet("A1")).toBe("'A1'");
  });
});
