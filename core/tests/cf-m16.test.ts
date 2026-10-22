/* S16.4 · Excel's conditional formats (B39; XC-01, XC-02; docs/next/09 §2.9, §3.10, §4.3):
   - reading: every rule type with its parts from .xlsx (the 2010 extension joined to its rule, the 2010 icon sets read
     from it alone) – the .xlsb reader is held to the same rules by xlsb.test.ts's twins;
   - evaluation (xlsx/cf.ts): colour scales, data bars (2007 and 2010: lengths, automatic axis, negative colour), icon
     sets (thresholds, reverse, icons only), top / bottom, above / below average, unique / duplicate values, text rules,
     blanks / errors, time periods, cellIs and formula rules through the evaluator; true rules' formats merge as Excel's;
     stopIfTrue; the painter carries bars and icons; a sliced sheet keeps the rule's whole range;
   - drawing: the bars and icons in every design (Excel's colours in Excel / Excel Refined, the design's in Liquid Glass
     and the consulting designs, Q15), as display-list nodes only;
   - PowerPoint (09 §4.3): a bar is a shape under the table with its cell's fill dropped, an icon a custGeom shape over
     the table, both in the table's group; no pictures. The corpus deck exported in the five designs, PDF and PowerPoint
     (SB_PPTX_OUT=<folder> keeps the files for tools/pptxcheck.py).
   With tools/make-cf-corpus.ps1's record of Excel's own colours (cf-rules.excel.json, made on Windows with Excel 16)
   the colour-scale and rule fills are compared cell by cell (XC-01); without it that comparison is skipped. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { readWorkbook } from "../src/xlsx/workbook";
import { cfAt, evalCF, todaySerial, unsupportedOf } from "../src/xlsx/cf";
import { cfClosure, hydrateShared, sliceShared } from "../src/xlsx/slice";
import { A1 } from "../src/xlsx/util";
import { applyOps, emptyDoc } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { glassToDisplayList } from "../src/render/glass-dl";
import { consultToDisplayList } from "../src/render/consult-dl";
import { effItems, effText } from "../src/render/edits";
import { calloutText } from "../src/render/shape-dl";
import { chartData } from "../src/render/chart-dl";
import { fold } from "../src/model/fold";
import { XLSB_BAR_LOOK } from "../src/xlsx/xlsb/sheet";
import { cfIcon, EXCEL_TONES } from "../src/render/cf-icons";
import { sceneOf, type El } from "../src/pptx/scene";
import { validate, type Node } from "../src/dl/types";
import { Port, pair, transfer } from "../src/rpc/port";
import { serve } from "../src/worker/host";
import { ExportHost, type ExportCorePort, type ExportPort } from "../src/worker/export-host";
import { FakeDeck } from "./fakedeck";
import { makeZip } from "./zipbuild";
import type { CoreEvents, CoreMethods, ExportJob, ExportMethods, ExportPageMethods, PageEvents, PageMethods } from "../src/rpc/messages";
import type { RenderCtx } from "../src/render/context";
import type { ChartItem, Design, Op, Preset } from "../src/model/types";
import type { Item, Sheet, Workbook } from "../src/xlsx/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const CF = path.join(here, "../../tests/corpus/workbooks/cf"), FILE = path.join(CF, "cf-rules.xlsx");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const DESIGNS: Design[] = ["glass", "excel", "clean", "mckinsey", "bain"];
const M: Metrics = { run: (t, font) => { const size = parseFloat(font.split("px")[0].split(" ").pop()!); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; }, lines: t => [t] };
const itemAt = (S: Sheet, ref: string): Item => S.tables[0].items.find(it => A1(it.b.r, it.b.c) === ref)!;
const flat = (ns: Node[]): Node[] => ns.flatMap(n => n.t === "group" ? [n, ...flat(n.children)] : [n]);

/* ---- a workbook of one sheet, in memory: the rule types the corpus has no room for ---- */
const NS = `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const DXFS = `<dxfs><dxf><fill><patternFill><bgColor rgb="FFFF0000"/></patternFill></fill></dxf><dxf><font><b/></font></dxf><dxf><font><color rgb="FF0000FF"/><strike/></font></dxf><dxf><font><u/></font></dxf></dxfs>`;
type V = number | string | boolean | null | { e: string } | { d: number };
async function book(rows: Record<number, Record<string, V>>, cf: string, extra = "", today?: number): Promise<Workbook> {
  const cell = (ref: string, v: V) => v === null ? `<c r="${ref}"/>` : typeof v === "number" ? `<c r="${ref}"><v>${v}</v></c>` : typeof v === "boolean" ? `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`
    : typeof v === "string" ? `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>` : "e" in v ? `<c r="${ref}" t="e"><v>${v.e}</v></c>` : `<c r="${ref}" s="1"><v>${v.d}</v></c>`;
  const data = Object.entries(rows).map(([r, cs]) => `<row r="${r}">${Object.entries(cs).map(([c, v]) => cell(c + r, v)).join("")}</row>`).join("");
  return readWorkbook(makeZip({
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook ${NS}><sheets><sheet name="S" sheetId="1" r:id="rId1"/><sheet name="T" sheetId="2" r:id="rId3"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId3" Type="${REL}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<styleSheet ${NS}><fonts><font><sz val="11"/><name val="Calibri"/></font></fonts><fills><fill><patternFill patternType="none"/></fill></fills><borders><border/></borders><cellXfs><xf/><xf numFmtId="14"/></cellXfs>${DXFS}</styleSheet>`,
    "xl/worksheets/sheet1.xml": `<worksheet ${NS}><sheetData>${data}</sheetData>${cf}${extra}</worksheet>`,
    "xl/worksheets/sheet2.xml": `<worksheet ${NS}><sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData></worksheet>`,
  }), { today });
}
const col = (vals: V[], c = "A", r0 = 1) => Object.fromEntries(vals.map((v, k) => [r0 + k, { [c]: v }])) as Record<number, Record<string, V>>;
const fills = (S: Sheet, refs: string[]) => refs.map(ref => { const m = /^([A-Z]+)(\d+)$/.exec(ref)!; return evalCF(S, +m[2], m[1].charCodeAt(0) - 64)?.fill ?? null; });

describe("reading (XC-01, XC-02)", () => {
  it("every rule type of the corpus with its parts; the 2010 look joins its rule; the 2010 icon sets come from the extension", async () => {
    const wb = await readWorkbook(ab(FILE)), [A, B] = wb.sheets;
    expect(A.cfRules.map(r => r.type)).toEqual(["expression", "colorScale", "dataBar", "iconSet", "top10", "aboveAverage", "containsText", "beginsWith", "uniqueValues", "dataBar"]);
    expect(A.unsupportedCF.size).toBe(0);
    const scale = A.cfRules[1].scale!;
    expect(scale).toEqual({ cfvo: [{ type: "min" }, { type: "percentile", val: "50" }, { type: "max" }], colors: ["#F8696B", "#FFEB84", "#63BE7B"] });
    expect(A.cfRules[2].bar).toMatchObject({ color: "#638EC6", minLength: 10, maxLength: 90, showValue: true,
      x14: { minLength: 0, maxLength: 100, border: true, gradient: true, borderColor: "#638EC6", negColor: "#FF0000", negBorderColor: "#FF0000", negBorderSame: false, cfvo: [{ type: "autoMin" }, { type: "autoMax" }] } });
    expect(A.cfRules[9].bar!.x14).toMatchObject({ gradient: false, axis: "automatic" });
    expect(A.cfRules[4]).toMatchObject({ rank: 3, percent: false, bottom: false });
    expect(A.cfRules[5]).toMatchObject({ above: false, equal: false, stdDev: 0 });
    expect(A.cfRules[6]).toMatchObject({ text: "KO", op: "containsText" });
    // the icon sets: 17 rules of 2007 + 2 (reversed, icons only), and the 3 of 2010 from the extension list
    const sets = B.cfRules.map(r => r.icons!.set);
    expect(sets).toHaveLength(22);
    expect(sets).toEqual(expect.arrayContaining(["3Stars", "3Triangles", "5Boxes", "5Quarters", "4RedToBlack"]));
    const stars = B.cfRules.find(r => r.icons!.set === "3Stars")!;
    expect(stars.ranges).toEqual([{ r1: 22, c1: 4, r2: 22, c2: 6 }]);
    expect(stars.icons!.cfvo).toEqual([{ type: "percent", val: "0" }, { type: "percent", val: "33" }, { type: "percent", val: "67" }]);
    expect(B.cfRules.find(r => r.icons!.reverse)!.ranges[0].r1).toBe(25);
    expect(B.cfRules.find(r => !r.icons!.showValue)!.ranges[0].r1).toBe(26);
  });
  it("a dxf's number format, underline, strike and borders", async () => {
    const wb = await readWorkbook(ab(FILE));
    expect(wb.shared!.dxfs[5]).toEqual({ u: true, fmt: '"["@"]"' });
    const b = await book(col([1]), "", "");
    expect(b.shared!.dxfs[2]).toEqual({ color: "#0000FF", s: true });
  });
  it("what is not reproduced: a formula naming another sheet or a function the evaluator does not know", async () => {
    const wb = await book(col([1, 2]), `<conditionalFormatting sqref="A1:A2"><cfRule type="expression" dxfId="0" priority="1"><formula>A1&gt;T!$A$1</formula></cfRule>`
      + `<cfRule type="expression" dxfId="0" priority="2"><formula>OFFSET(A1,0,1)&gt;0</formula></cfRule><cfRule type="expression" dxfId="1" priority="3"><formula>MOD(ROW(),2)=0</formula></cfRule></conditionalFormatting>`);
    const S = wb.sheets[0];
    expect([...S.unsupportedCF].sort()).toEqual(["formulas Slide Builder cannot evaluate", "formulas naming another sheet"]);
    expect(S.cfRules.map(unsupportedOf)).toEqual(["formulas naming another sheet", "formulas Slide Builder cannot evaluate", null]);
    expect([evalCF(S, 1, 1), evalCF(S, 2, 1)]).toEqual([null, { b: true }]);         // the known rule still applies
  });
});

describe("evaluation (XC-01, XC-02)", () => {
  it("the corpus table: scale, bars, arrows, top / below average merged, text rules, unique values and their number format, a formula", async () => {
    const wb = await readWorkbook(ab(FILE)), S = wb.sheets[0];
    // a 3-colour scale: min / 50th percentile / max, linear in RGB between them
    expect(["D5", "D9", "D10", "D14"].map(r => itemAt(S, r).fill)).toEqual(["#F8696B", "#FEDD81", "#EEE683", "#63BE7B"]);
    // a 2010 bar from 0 (autoMin), lengths 0–100 %, border; the 2010 solid bar with negatives about its automatic axis
    expect(itemAt(S, "E5").cfBar).toEqual({ from: 0, to: .05, fill: "#638EC6", border: "#638EC6", gradient: true, neg: false, axis: null, axisColor: "#000000" });
    expect(itemAt(S, "E14").cfBar!.to).toBe(1);
    expect(itemAt(S, "I6").cfBar).toEqual({ from: .125, to: .3333, fill: "#FF0000", border: null, gradient: false, neg: true, axis: .3333, axisColor: "#000000" });
    expect(itemAt(S, "I14").cfBar).toMatchObject({ from: .3333, to: 1, fill: "#5B9BD5", neg: false });
    // arrows at 33 / 67 % of -5…9
    expect(["F5", "F8", "F12", "F13"].map(r => itemAt(S, r).cfIcon!.i)).toEqual([0, 1, 1, 2]);
    // top 3 (fill + colour) and below average (italic): both true on no cell; each alone
    expect(itemAt(S, "G12").cf).toEqual({ fill: "#C6EFCE", color: "#006100" });
    expect(itemAt(S, "G5").cf).toEqual({ i: true });
    expect(itemAt(S, "G14").cf).toBeNull();                                               // 50: above the average, not top 3
    expect(itemAt(S, "H6").cf).toEqual({ fill: "#FFC7CE", color: "#9C0006" });
    expect(itemAt(S, "H8").cf).toEqual({ fill: "#FFEB9C", color: "#9C5700" });
    expect([itemAt(S, "H11").text, itemAt(S, "H11").font.u]).toEqual(["[n/a]", true]);    // unique: underline and its number format
    expect(itemAt(S, "H5").cf).toBeNull();
    expect(["C11", "C12"].map(r => itemAt(S, r).cf)).toEqual([null, { color: "#006100", b: true }]);   // $D5>=8
    expect(itemAt(S, "C12").font.b).toBe(true);
  });
  it("the icon sets: every set, reversed, icons only (the value hidden)", async () => {
    const wb = await readWorkbook(ab(FILE)), S = wb.sheets[1];
    for (const it of S.tables[0].items) if (it.cfIcon) expect(cfIcon(it.cfIcon.set, it.cfIcon.i), A1(it.b.r, it.b.c)).not.toBeNull();
    expect(S.tables[0].items.filter(it => it.cfIcon).length).toBe(3 * 12 + 4 * 5 + 5 * 5);
    expect(["D25", "F25"].map(r => itemAt(S, r).cfIcon!.i)).toEqual([2, 0]);
    expect(itemAt(S, "D26")).toMatchObject({ cfHide: true, text: "", cfIcon: { set: "3Symbols", i: 0 } });
  });
  it("top / bottom n and %, above / below / equal and standard deviations, duplicates", async () => {
    const vals = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const S = (await book(col(vals), `<conditionalFormatting sqref="A1:A10"><cfRule type="top10" dxfId="0" priority="1" rank="20" percent="1" bottom="1"/>`
      + `<cfRule type="aboveAverage" dxfId="1" priority="2" stdDev="1"/></conditionalFormatting>`
      + `<conditionalFormatting sqref="A1:A10"><cfRule type="aboveAverage" dxfId="2" priority="3" aboveAverage="0" equalAverage="1"/></conditionalFormatting>`)).sheets[0];
    // bottom 20 %: 10, 20; above the average + 1 sd (55 + 28.7): 90, 100; at or below 55: blue + strike
    const at = (r: number) => evalCF(S, r, 1);
    expect([1, 2, 3].map(at)).toEqual([{ fill: "#FF0000", color: "#0000FF", s: true }, { fill: "#FF0000", color: "#0000FF", s: true }, { color: "#0000FF", s: true }]);
    expect([6, 8, 9, 10].map(at)).toEqual([null, null, { b: true }, { b: true }]);
    const D = (await book(col(["a", "B", "b", 3, 3, 4, null]), `<conditionalFormatting sqref="A1:A7"><cfRule type="duplicateValues" dxfId="0" priority="1"/></conditionalFormatting>`)).sheets[0];
    expect(fills(D, ["A1", "A2", "A3", "A4", "A5", "A6", "A7"])).toEqual([null, "#FF0000", "#FF0000", "#FF0000", "#FF0000", null, null]);
  });
  it("text, blanks, errors, time periods (the workbook's day, given when it is read)", async () => {
    const t = 46296;                                                          // Thursday 1 October 2026
    expect(todaySerial(new Date(2026, 9, 1, 23, 59))).toBe(t);
    const rows = col(["Alpha", "beta", "  ", null, { e: "#DIV/0!" }, { d: t }, { d: t - 1 }, { d: t - 40 }, "gamma"]);
    const S = (await book(rows, `<conditionalFormatting sqref="A1:A9"><cfRule type="endsWith" dxfId="1" priority="1" operator="endsWith" text="A"/>`
      + `<cfRule type="notContainsText" dxfId="2" priority="2" operator="notContains" text="a"/></conditionalFormatting>`
      + `<conditionalFormatting sqref="A1:A9"><cfRule type="containsBlanks" dxfId="0" priority="3"/><cfRule type="containsErrors" dxfId="0" priority="4"/>`
      + `<cfRule type="timePeriod" dxfId="0" priority="5" timePeriod="today"/><cfRule type="timePeriod" dxfId="0" priority="6" timePeriod="yesterday"/></conditionalFormatting>`, "", t)).sheets[0];
    const at = (r: number) => evalCF(S, r, 1);
    expect(at(1)).toEqual({ b: true });                                       // ends with "a" (any case); contains "a"
    expect(at(3)).toEqual({ color: "#0000FF", s: true, fill: "#FF0000" });   // blank-looking text: no "a", and blank
    expect(at(4)).toEqual({ color: "#0000FF", s: true, fill: "#FF0000" });   // empty: the same
    expect(at(5)).toEqual({ fill: "#FF0000" });                              // an error: no text rule, an error rule
    expect([6, 7, 8].map(r => at(r)?.fill ?? null)).toEqual(["#FF0000", "#FF0000", null]);
  });
  it("the day is the workbook's, never the clock while drawing: TODAY() and time periods follow it; the page's mirror gets it with the styles", async () => {
    const t = 46296, rules = `<conditionalFormatting sqref="A1:A3"><cfRule type="timePeriod" dxfId="0" priority="1" timePeriod="today"/>`
      + `<cfRule type="expression" dxfId="1" priority="2"><formula>A1&lt;TODAY()</formula></cfRule><cfRule type="timePeriod" dxfId="2" priority="3" timePeriod="thisWeek"/></conditionalFormatting>`;
    const rows = col([{ d: t }, { d: t - 1 }, { d: t + 3 }]);
    const on = async (day: number) => { const S = (await book(rows, rules, "", day)).sheets[0]; return [1, 2, 3].map(r => evalCF(S, r, 1)); };
    // 1 October 2026 (a Thursday): the week runs Sunday 27 September … Saturday 3 October
    expect(await on(t)).toEqual([{ fill: "#FF0000", color: "#0000FF", s: true }, { b: true, color: "#0000FF", s: true }, null]);
    // the next day: no cell is today; 4 October is in the next week
    expect(await on(t + 1)).toEqual([{ b: true, color: "#0000FF", s: true }, { b: true, color: "#0000FF", s: true }, null]);
    const wb = await book(rows, rules, "", t);
    expect([wb.today, wb.shared!.today, hydrateShared(sliceShared(wb.shared!)).today]).toEqual([t, t, t]);
    // not given: this PC's date when the workbook is read, kept afterwards
    const before = todaySerial(), now = await book(rows, rules), after = todaySerial();
    expect([before, after]).toContain(now.shared!.today);
  });
  it("cellIs with formula operands, formula rules with functions and ranges, stopIfTrue, merged formats", async () => {
    const rows = { 1: { A: 5, B: 10, C: "x" }, 2: { A: 15, B: 10, C: "y" }, 3: { A: -2, B: 10, C: "x" }, 4: { A: 8, B: 10, C: "" } };
    const S = (await book(rows, `<conditionalFormatting sqref="A1:A4"><cfRule type="cellIs" dxfId="0" priority="1" operator="between" stopIfTrue="1"><formula>$B1/2</formula><formula>$B$1</formula></cfRule>`
      + `<cfRule type="expression" dxfId="1" priority="2"><formula>AND(ISNUMBER(SEARCH("x",$C1)),A1&lt;&gt;0,MOD(ROW(),2)=1)</formula></cfRule>`
      + `<cfRule type="expression" dxfId="2" priority="3"><formula>A1&gt;AVERAGE($A$1:$A$4)</formula></cfRule></conditionalFormatting>`)).sheets[0];
    const at = (r: number) => evalCF(S, r, 1);
    expect(at(1)).toEqual({ fill: "#FF0000" });                              // 5 ≤ 5 ≤ 10, stop: no more rules
    expect(at(2)).toEqual({ color: "#0000FF", s: true });                    // 15 > average 6.5
    expect(at(3)).toEqual({ b: true });                                      // "x" in C3, row 3 odd
    expect(at(4)).toEqual({ fill: "#FF0000" });                              // 8 in 5…10 (and > 6.5, but stopped)
  });
  it("a 2-colour scale on numbers and percents; a 2007 bar; an icon set with > thresholds and numbers", async () => {
    const S = (await book(col([0, 25, 50, 100]), `<conditionalFormatting sqref="A1:A4"><cfRule type="colorScale" priority="1"><colorScale><cfvo type="num" val="0"/><cfvo type="percent" val="50"/>`
      + `<color rgb="FF000000"/><color rgb="FFFFFFFF"/></colorScale></cfRule><cfRule type="dataBar" priority="2"><dataBar showValue="0"><cfvo type="min"/><cfvo type="max"/><color rgb="FF00FF00"/></dataBar></cfRule>`
      + `<cfRule type="iconSet" priority="3"><iconSet iconSet="3Flags"><cfvo type="num" val="0"/><cfvo type="num" val="25" gte="0"/><cfvo type="num" val="50"/></iconSet></cfRule></conditionalFormatting>`)).sheets[0];
    expect(fills(S, ["A1", "A2", "A3", "A4"])).toEqual(["#000000", "#808080", "#FFFFFF", "#FFFFFF"]);
    const r = [1, 2, 3, 4].map(k => cfAt(S, k, 1)!);
    expect(r.map(x => [x.bar!.to, x.bar!.gradient, x.hide])).toEqual([[.1, true, true], [.3, true, true], [.5, true, true], [.9, true, true]]);
    expect(r.map(x => x.icon!.i)).toEqual([0, 0, 2, 2]);                     // 25 is not > 25
  });
  it("the painter carries a bar and an icon (cell.patch cf: the rules of another cell, applied to this one)", async () => {
    const wb = await readWorkbook(ab(FILE)), S = wb.sheets[0];
    const view = applyOps(emptyDoc("W.xlsx"), [{ op: "preset.set", preset: PRESET } as Op,
      { op: "cell.patch", sheet: "CF rules", ref: "G9", patch: { cf: "CF rules!E5" } } as Op, { op: "cell.patch", sheet: "CF rules", ref: "G10", patch: { cf: "CF rules!F5" } } as Op]).doc;
    const ctx = ctxOf(wb, view, "excel"), L = runtimeSlides(wb, view.preset, "W.xlsx", "excel")[0].tables[0];
    const items = effItems(L, ctx), at = (ref: string) => items.find(it => A1(it.b.r, it.b.c) === ref)!;
    expect(at("G9").cfBar).toBeTruthy();           // 23 against E5:E14's rule (autoMin 0 … max 100)
    expect(at("G9").cfBar!.to).toBe(.23);
    expect(at("G9").cf).toBeNull();                 // its own italic (below average) replaced by the painted rules
    expect(at("G10").cfIcon).toEqual({ set: "3Arrows", i: 2 });
    expect(S.name).toBe("CF rules");
  });
  it("painted rules look as the source's own: underline and strike too; \"none\" leaves the cell's own font (S16.4 review)", async () => {
    // B2:C3 between the markers; B2:B3 > 0 blue + strike, B2:B3 = 7 underline, C2:C3 bold (a formula)
    const S = (await book({ 1: { A: "x" }, 2: { B: 5, C: 6 }, 3: { B: 7, C: 8 }, 4: { D: "x" } }, `<conditionalFormatting sqref="B2:B3"><cfRule type="cellIs" dxfId="2" priority="1" operator="greaterThan"><formula>0</formula></cfRule>`
      + `<cfRule type="cellIs" dxfId="3" priority="2" operator="equal"><formula>7</formula></cfRule></conditionalFormatting><conditionalFormatting sqref="C2:C3"><cfRule type="expression" dxfId="1" priority="3"><formula>TRUE</formula></cfRule></conditionalFormatting>`)).sheets[0];
    const L = S.tables[0], at = (items: Item[], ref: string) => items.find(it => A1(it.b.r, it.b.c) === ref)!;
    expect([at(L.items, "B3").font.u, at(L.items, "B3").font.s, at(L.items, "C2").font.b]).toEqual([true, true, true]);
    const ctx: RenderCtx = { style: { ...resolveStyle({}, emptyDoc("W.xlsx").style), design: "excel" }, edits: { S: { C3: { cf: "S!B3" }, C2: { cf: "none" }, B3: { cf: "S!C2" } } }, slides: [], preset: null, workbook: "W.xlsx", logoSrc: "", sheet: () => S, version: null };
    const items = effItems(L, ctx);
    // C3 (8) under B3's rules: > 0 (blue, strike), not 7; its own bold gone
    expect(at(items, "C3").font).toMatchObject({ color: "#0000FF", s: true, b: false });
    expect(at(items, "C3").font.u).toBeFalsy();
    // C2 painted "none": no bold; B3 (7) under C2's rule: bold, its own underline and strike gone
    expect([at(items, "C2").font.b, at(items, "C2").cf]).toEqual([false, null]);
    expect(at(items, "B3").font).toMatchObject({ b: true });
    expect([at(items, "B3").font.u, at(items, "B3").font.s].map(Boolean)).toEqual([false, false]);
    // a painted rule that underlines: B2 = 7 under the "= 7" rule, painted onto C2 (7)
    const S3 = (await book({ 1: { A: "x" }, 2: { B: 7, C: 7 }, 3: { B: 1 }, 4: { D: "x" } }, `<conditionalFormatting sqref="B2"><cfRule type="cellIs" dxfId="3" priority="1" operator="equal"><formula>7</formula></cfRule></conditionalFormatting>`)).sheets[0];
    const c3: RenderCtx = { ...ctx, sheet: () => S3, edits: { S: { C2: { cf: "S!B2" } } } };
    expect([at(S3.tables[0].items, "C2").font.u, at(effItems(S3.tables[0], c3), "C2").font.u]).toEqual([false, true]);
  });
  it("text edits saved by 4.8 on cells whose shown text the rules now change (fixtures/saved/cf-edits-4.8.json, added, never edited)", async () => {
    const saved = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "saved", "cf-edits-4.8.json"), "utf8"));
    const doc = fold(saved.snapshot, saved.records).doc;
    const wb = await readWorkbook(ab(FILE)), ctx = ctxOf(wb, doc as ReturnType<typeof emptyDoc>, "excel");
    const [T1, T2] = runtimeSlides(wb, doc.preset, "W.xlsx", "excel").map(R => R.tables[0]);
    const one = effItems(T1, ctx), two = effItems(T2, ctx), at = (items: Item[], ref: string) => items.find(it => A1(it.b.r, it.b.c) === ref)!;
    // H11 shows "[n/a]" (a rule's number format), the edit was made on "n/a"; D26's value is hidden (icons only), the edit on "1"
    expect([at(T1.items, "H11").text, at(T1.items, "H11").rawText, at(T2.items, "D26").text, at(T2.items, "D26").rawText]).toEqual(["[n/a]", "n/a", "", "1"]);
    expect([at(one, "H11").text, at(one, "H11").edited, at(one, "G5").text]).toEqual(["not applicable", true, "twelve"]);
    expect([at(two, "D26").text, at(two, "D26").edited]).toEqual(["low", true]);
    expect([at(two, "E26").text, !!at(two, "E26").edited]).toEqual(["", false]);    // made on a value it no longer holds: paused
    expect(effText(ctx, at(T1.items, "H11"))).toBe("not applicable");
    expect(effText(ctx, at(T2.items, "E26"))).toBe("");
    // an edit made now (orig: the text as shown) holds too
    const now = { ...ctx, edits: { "CF rules": { H11: { orig: "[n/a]", text: "now" } } } };
    T1._cache = {};
    expect(at(effItems(T1, now), "H11").text).toBe("now");
    // a plain cell has no rawText (the items stay as small as before)
    expect(T1.items.filter(it => it.rawText !== undefined).map(it => A1(it.b.r, it.b.c))).toEqual(["H11"]);
  });
  it("a text box's {Sheet!H11} and a chart's labels keep a text edit made on the text the rules show (S16.4 re-check)", async () => {
    const wb = await readWorkbook(ab(FILE)), S = (n: string) => wb.sheets.find(s => s.name === n) || null;
    const ctx = (edits: RenderCtx["edits"]): RenderCtx => ({ style: { ...resolveStyle({}, emptyDoc("W.xlsx").style), design: "excel" }, edits, slides: [], preset: null, workbook: "W.xlsx", logoSrc: "", sheet: S, version: null });
    const box = (edits: RenderCtx["edits"]) => calloutText("{'CF rules'!H11} {'Icon sets'!D26} {'Icon sets'!E26}", ctx(edits)).text;
    // no edits: the Excel value, without the rules' number format (as before S16.4)
    expect(box({})).toBe("n/a 1 " + calloutText("{'Icon sets'!E26}", ctx({})).text);
    // made now: orig is the text as the table shows it ("[n/a]"; "" for an icons-only cell)
    const now = { "CF rules": { H11: { orig: "[n/a]", text: "now" } }, "Icon sets": { D26: { orig: "", text: "low" }, E26: { orig: "7", text: "stale" } } };
    expect(box(now)).toBe("now low " + calloutText("{'Icon sets'!E26}", ctx({})).text);
    // saved by 4.8: orig is the plain text
    expect(box({ "CF rules": { H11: { orig: "n/a", text: "old" } }, "Icon sets": { D26: { orig: "1", text: "one" } } }).startsWith("old one ")).toBe(true);
    // a chart labelled by H11
    const chart = { kind: "chart", type: "pie", values: { sheet: "CF rules", range: "G9" }, labels: { sheet: "CF rules", range: "H11" }, box: { x: 0, y: 0, w: 400, h: 300 } } as ChartItem;
    const label = (edits: RenderCtx["edits"]) => { const d = chartData(chart, ctx(edits)); return d.ok ? d.slices[0].label : "?"; };
    expect([label({}), label(now), label({ "CF rules": { H11: { orig: "n/a", text: "old" } } })]).toEqual(["n/a", "now", "old"]);
  });
  it("an .xlsb's data bars: drawn as Excel 2007's, named under \"not reproduced\" (S16.4 review)", async () => {
    const X = path.join(here, "../../tests/corpus/workbooks/xlsb");
    const bin = await readWorkbook(ab(path.join(X, "edge-xlsb.xlsb"))), xml = await readWorkbook(ab(path.join(X, "edge-xlsb.xlsx")));
    const Sb = bin.sheets.find(S => S.name === "Values")!, Sx = xml.sheets.find(S => S.name === "Values")!;
    expect(Sb.cfRules.some(r => r.bar) && Sx.cfRules.some(r => r.bar?.x14)).toBe(true);
    expect([...Sb.unsupportedCF]).toContain(XLSB_BAR_LOOK);
    expect([...Sx.unsupportedCF]).not.toContain(XLSB_BAR_LOOK);
  });
  it("a slice of a sheet keeps a range rule's whole range (its statistics)", async () => {
    const wb = await readWorkbook(ab(FILE)), S = wb.sheets[0];
    expect(cfClosure(S, { r1: 5, c1: 4, r2: 6, c2: 4 })).toEqual({ r1: 5, c1: 4, r2: 14, c2: 4 });
  });
});

/* ---- the deck ---- */
const PRESET: Preset = { sheets: ["CF rules", "Icon sets"], tables: [{ id: "tcf", sheet: "CF rules", kind: "markers", anchor: "B3", index: 0 }, { id: "tic", sheet: "Icon sets", kind: "markers", anchor: "B3", index: 0 }],
  slides: [{ id: "s1", type: "content", title: null, subtitle: null, tables: ["tcf"], layout: null }, { id: "s2", type: "content", title: null, subtitle: null, tables: ["tic"], layout: null }] } as unknown as Preset;
function ctxOf(wb: Workbook, view: ReturnType<typeof emptyDoc>, design: Design): RenderCtx {
  const style = { ...resolveStyle({}, view.style), design };
  return { style, edits: view.edits || {}, slides: runtimeSlides(wb, view.preset, "W.xlsx", design), preset: view.preset || null, workbook: "W.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null };
}
const tableDL = (design: Design, L: Parameters<typeof excelToDisplayList>[0], ctx: RenderCtx) =>
  design === "glass" ? glassToDisplayList(L, ctx, { x: 0, y: 0, scale: 1 }, null, M) : design === "mckinsey" || design === "bain" ? consultToDisplayList(L, ctx, M) : excelToDisplayList(L, ctx, M);

describe("drawing: bars and icons in every design (Q15: in each design's colours)", () => {
  for (const design of DESIGNS) it(design, async () => {
    const wb = await readWorkbook(ab(FILE)), view = applyOps(emptyDoc("W.xlsx"), [{ op: "preset.set", preset: PRESET } as Op]).doc, ctx = ctxOf(wb, view, design);
    const [R1, R2] = runtimeSlides(wb, view.preset, "W.xlsx", design);
    const dl1 = tableDL(design, R1.tables[0], ctx).nodes, dl2 = tableDL(design, R2.tables[0], ctx).nodes;
    expect(validate(dl1)).toEqual([]); expect(validate(dl2)).toEqual([]);
    const marks = (dl: Node[], id: string) => flat(dl).filter((n, i, a) => n.t === "hit" && n.kind === "cf" && n.id === id && a[i + 1]);
    const after = (dl: Node[], id: string) => { const f = flat(dl); return f.flatMap((n, i) => n.t === "hit" && n.kind === "cf" && n.id === id ? [f[i + 1]] : []); };
    const consult = design === "mckinsey" || design === "bain";
    // every bar cell a bar, every icon an icon: path parts only (no picture, no text)
    const bars = after(dl1, "bar").filter(n => n.t === "rect") as Extract<Node, { t: "rect" }>[];
    expect(bars.length).toBeGreaterThanOrEqual(consult ? 1 : 19);
    if (!consult) expect(marks(dl1, "icon").length).toBeGreaterThanOrEqual(10);
    expect(after(dl2, "icon").every(n => n.t === "path")).toBe(true);
    expect(flat(dl1).concat(flat(dl2)).some(n => n.t === "image")).toBe(false);
    const icons = after(dl2, "icon") as Extract<Node, { t: "path" }>[], colours = new Set(icons.map(n => JSON.stringify((n.fill as { solid: number[] }).solid)));
    const rgb = (h: string) => JSON.stringify([1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16)));
    if (design === "excel" || design === "clean") { expect(colours.has(rgb(EXCEL_TONES.pos))).toBe(true); expect(colours.has(rgb(EXCEL_TONES.neg))).toBe(true); }
    if (design === "glass") { expect(colours.has(rgb("#34C759"))).toBe(true); expect(colours.has(rgb("#FF3B30"))).toBe(true); expect(bars.every(b => b.r !== undefined)).toBe(true); }
    if (consult) { expect(colours.has(rgb(EXCEL_TONES.pos))).toBe(false); expect(bars.every(b => b.h === 2)).toBe(true); }
    // the value hidden where only the icon shows; an icon shifts a left-aligned text (Excel)
    expect(flat(dl2).some(n => n.t === "hit" && n.kind === "t" && n.id === "26,4" && n.label)).toBe(false);
  });
  it("an icon before a left-aligned value moves it right (Excel)", async () => {
    const S = (await book({ 2: { B: "x" }, 3: { C: 1 }, 4: { C: 3 }, 5: { D: "x" } }, `<conditionalFormatting sqref="C3:C4"><cfRule type="iconSet" priority="1"><iconSet iconSet="3Arrows"><cfvo type="percent" val="0"/><cfvo type="percent" val="33"/><cfvo type="percent" val="67"/></iconSet></cfRule></conditionalFormatting>`)).sheets[0];
    const L = S.tables[0], it3 = L.items.find(i => i.b.r === 3)!;
    const view = emptyDoc("W.xlsx"), ctx: RenderCtx = { style: { ...resolveStyle({}, view.style), design: "excel" }, edits: {}, slides: [], preset: null, workbook: "W.xlsx", logoSrc: "", sheet: () => S, version: null };
    const textX = (align: string) => { const o = { ...it3, align }; L.items[L.items.indexOf(L.items.find(i => i.b.r === 3)!)] = o; L._cache = {}; return (flat(excelToDisplayList(L, ctx, M).nodes).find(n => n.t === "text" && n.src === "1") as { x: number }).x; };
    expect(textX("left") - textX("left") === 0).toBe(true);
    const shifted = textX("left"); L.items.forEach(i => { if (i.b.r === 3) delete i.cfIcon; }); L._cache = {};
    expect(shifted - (flat(excelToDisplayList(L, ctx, M).nodes).find(n => n.t === "text" && n.src === "1") as { x: number }).x).toBeGreaterThan(14);
  });
});

describe("PowerPoint: bars under the table with the cell's fill dropped, icons over it (09 §4.3)", () => {
  it("the scene of a table with a filled cell holding a bar, an icon, and a plain filled cell", () => {
    const cellHit = (id: string, x: number): Node => ({ t: "hit", kind: "t", id, x, y: 0, w: 50, h: 20, label: id });
    const nodes: Node[] = [{ t: "hit", kind: "tw", id: "tw", x: 0, y: 0, w: 150, h: 20 }, { t: "group", children: [
      { t: "rect", x: 0, y: 0, w: 50, h: 20, fill: { solid: [255, 0, 0] } }, { t: "rect", x: 50, y: 0, w: 50, h: 20, fill: { solid: [0, 255, 0] } },
      { t: "hit", kind: "cf", id: "bar", x: 2, y: 2, w: 30, h: 16 }, { t: "rect", x: 2, y: 2, w: 30, h: 16, fill: { solid: [99, 142, 198] } },
      { t: "hit", kind: "cf", id: "icon", x: 102, y: 3, w: 16, h: 16 }, { t: "path", d: [["M", 102, 3], ["L", 118, 3], ["L", 110, 19], ["Z"]], fill: { solid: [0, 176, 80] } },
      cellHit("1,1", 0), { t: "text", font: "Calibri", size: 14, x: 30, y: 15, src: "10", w: 14, fill: { solid: [0, 0, 0] } },
      cellHit("1,2", 50), { t: "text", font: "Calibri", size: 14, x: 80, y: 15, src: "20", w: 14, fill: { solid: [0, 0, 0] } },
      cellHit("1,3", 100), { t: "text", font: "Calibri", size: 14, x: 130, y: 15, src: "30", w: 14, fill: { solid: [0, 0, 0] } },
    ] }];
    const els = sceneOf(nodes, null, () => true), grp = els[0] as Extract<El, { k: "grp" }>;
    const kinds = grp.children.map(e => e.k === "sp" ? (e.cf || ("prst" in e.geom ? e.geom.prst : "path")) : e.k);
    expect(kinds).toEqual(["rect", "bar", "tbl", "icon"]);              // the red fill, the bar, the table, the icon
    const tbl = grp.children.find(e => e.k === "tbl") as Extract<El, { k: "tbl" }>;
    expect(tbl.cells[0].map(c => c.fill ? JSON.stringify(c.fill) : null)).toEqual([null, JSON.stringify({ solid: [0, 255, 0] }), null]);
    expect(tbl.cells[0].map(c => c.text?.paras[0].runs.map(r => r.text).join(""))).toEqual(["10", "20", "30"]);
  });
});

/* ---- the export: the corpus deck in the five designs, PDF and PowerPoint ---- */
const OUT = process.env.SB_PPTX_OUT || "";
/** the media parts each design's export has without any picture of the deck (none: no bars or icons as pictures) */
const MEDIA: Record<Design, string[]> = { glass: [], excel: [], clean: [], mckinsey: [], bain: [] } as unknown as Record<Design, string[]>;
/** the innermost <p:grpSp> … </p:grpSp> around index `at` of a slide's XML */
function groupOf(x: string, at: number): string {
  const re = /<p:grpSp>|<\/p:grpSp>/g, open: number[] = []; let m: RegExpExecArray | null;
  while ((m = re.exec(x)) && m.index < at) { if (m[0] === "<p:grpSp>") open.push(m.index); else open.pop(); }
  const from = open.pop(); if (from === undefined) return "";
  re.lastIndex = from + 1; let depth = 1;
  while ((m = re.exec(x))) { depth += m[0] === "<p:grpSp>" ? 1 : -1; if (!depth) return x.slice(from, m.index + m[0].length); }
  return x.slice(from);
}
/** the PDF's fonts: the test's Carlito under the last-resort family the resolver tries first (text/resolve.ts) */
const FONTS = [{ source: "system", file: "Carlito-Regular.ttf", family: "Arial", weight: 400, italic: false }, { source: "system", file: "Carlito-Bold.ttf", family: "Arial", weight: 700, italic: false }] as ExportJob["catalog"];
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));
async function openDeck() {
  const deck = new FakeDeck("cf-rules.xlsx-0123456789", "cf-rules.xlsx"), api = deck.api(), [a, b] = pair();
  serve(new Port<CoreMethods, PageMethods, PageEvents, CoreEvents>(b), { autoTail: false });
  const port = new Port<PageMethods, CoreMethods, CoreEvents, PageEvents>(a);
  port.handle("deckSnapshot", () => api.snapshot("")); port.handle("deckTail", x => api.tail(x.key, x.since));
  port.handle("deckAppend", x => api.append(x.key, x.writer, x.record)); port.handle("deckCompact", x => api.compact(x.key, x.baseGen, x.snapshot));
  port.handle("deckRotate", x => api.rotate(x.key, x.writer)); port.handle("deckFormat5", x => api.format5(x.key));
  port.handle("deckPrepare", () => null); port.handle("digitWidth", () => 0); port.handle("convertPicture", () => null); port.handle("analyzeImages", () => []);
  port.handle("linkedWorkbook", () => null);
  for (const e of ["slices", "stage", "doc"] as const) port.on(e, () => undefined);
  await port.call("init", { served: true, client: "c1", me: "anna" });
  await port.call("index", transfer({ buf: ab(FILE) }, []));
  await port.call("start", { name: "cf-rules.xlsx", deck: deck.open("anna@pc#aaaaaaaa"), preset: structuredClone(PRESET), inputs: { defaults: {}, logoSrc: "", version: "", workbook: "cf-rules.xlsx" }, stage: { slide: 0, known: [] } });
  const [c, d] = pair(), [e, f] = pair();
  const page = new Port<ExportPageMethods, ExportMethods, Record<string, never>, Record<string, never>>(c);
  page.handle("fontFile", x => { const b = fs.readFileSync(path.join(here, "fixtures/fonts", x.file)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; });
  page.handle("pictureBytes", () => PNG.slice().buffer as ArrayBuffer);
  new ExportHost(new Port(d) as unknown as ExportPort).link(new Port(e) as unknown as ExportCorePort);
  new Port<{ slideLists(x: unknown): unknown }, Record<string, never>, Record<string, never>, Record<string, never>>(f).handle("slideLists", x => port.call("slideLists", x as never));
  const run = (kind: "pdf" | "pptx", design: Design) => page.call("run", { kind, design, version: "", forExport: true, thumb: false, today: "1 October 2026", scale: 1, title: "CF", catalog: FONTS } as ExportJob);
  return { run };
}
describe("export: the corpus deck to PDF and PowerPoint in the five designs", () => {
  for (const design of DESIGNS) it(design, async () => {
    const h = await openDeck();
    const pdf = await h.run("pdf", design), pptx = await h.run("pptx", design);
    if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, `cf-${design}.pdf`), new Uint8Array(pdf.files[0])); fs.writeFileSync(path.join(OUT, `cf-${design}.pptx`), new Uint8Array(pptx.files[0])); }
    expect(new TextDecoder().decode(new Uint8Array(pdf.files[0]).slice(0, 5))).toBe("%PDF-");
    const z = unzipSync(new Uint8Array(pptx.files[0])), slide = (i: number) => strFromU8(z[`ppt/slides/slide${i}.xml`]);
    // no pictures: the deck has no logo or picture of its own, so no media part at all, and no <p:pic> in a table's group
    expect(Object.keys(z).filter(n => /^ppt\/media\//.test(n))).toEqual(MEDIA[design]);
    for (const i of [1, 2]) {
      const x = slide(i);
      expect(x).toContain("<a:tbl>");
      expect(x).not.toContain("<p:cxnSp");
      expect(x).not.toMatch(/TargetMode="External"/);
      const g = groupOf(x, x.indexOf("<a:tbl>"));
      expect(g).toContain("<a:tbl>"); expect(g).not.toContain("<p:pic>");
      // the table's group: icons as custom geometry after the table frame
      const tbl = x.indexOf("<a:tbl>"), geoms = [...x.matchAll(/<a:custGeom>/g)].map(m => m.index!);
      expect(geoms.filter(g => g > tbl).length).toBeGreaterThan(i === 2 ? 40 : 5);
    }
    // the bars: shapes before the first table (under it)
    const x1 = slide(1), before = x1.slice(0, x1.indexOf("<a:tbl>"));
    if (design !== "mckinsey" && design !== "bain") expect((before.match(/<p:sp>/g) || []).length).toBeGreaterThanOrEqual(19);
    // the consulting designs' thin bars lie under the value, over the cell: after the table, as on the slide (RENDERING.md)
    else expect((x1.slice(x1.indexOf("</a:tbl>")).match(/<p:sp>/g) || []).length).toBeGreaterThanOrEqual(5);
    // the hidden values: "icons only" row has no 1 / 2 / 3 texts in its cells – the table's texts still hold the set names
    expect(slide(2)).toContain("3Symbols icons only");
  }, 60_000);
});

/* ---- XC-01: Excel's own colours, recorded on Windows by tools/make-cf-corpus.ps1 ---- */
const EXCEL = path.join(CF, "cf-rules.excel.json");
describe("XC-01 against Excel 16 (tools/make-cf-corpus.ps1's record)", () => {
  it.skipIf(!fs.existsSync(EXCEL))("every cell's fill and font colour as Excel shows them", async () => {
    const rec = JSON.parse(fs.readFileSync(EXCEL, "utf8")) as { sheet: string; cell: string; fill: string | null; color: string | null; bold: boolean; italic: boolean }[];
    const wb = await readWorkbook(ab(FILE));
    const near = (a: string | null, b: string | null) => a === b || (!!a && !!b && [1, 3, 5].every(k => Math.abs(parseInt(a.slice(k, k + 2), 16) - parseInt(b.slice(k, k + 2), 16)) <= 2));
    const bad: string[] = [];
    for (const r of rec) {
      const S = wb.sheets.find(s => s.name === r.sheet)!, it = S.tables[0].items.find(i => A1(i.b.r, i.b.c) === r.cell); if (!it) continue;
      if (!near(it.fill, r.fill)) bad.push(`${r.sheet}!${r.cell} fill ${it.fill} ≠ ${r.fill}`);
      if (r.color && !near((it.font.color || "#000000").toUpperCase(), r.color)) bad.push(`${r.sheet}!${r.cell} colour ${it.font.color} ≠ ${r.color}`);
      if (!!it.font.b !== r.bold || !!it.font.i !== r.italic) bad.push(`${r.sheet}!${r.cell} bold/italic`);
    }
    expect(bad).toEqual([]);
  });
});
