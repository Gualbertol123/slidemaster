/* 07 §8 Q8 "keep and mark" (M8, found by G4's stand-in): a locale-dependent TEXT cell the engine computes otherwise than
   Excel keeps Excel's cached value in the engine, so the cells that read it get Excel's value; the self-check counts it
   locale and lists it (pinned). A synthetic workbook: its cached values are what "Excel" saved. */
import { describe, expect, it, beforeAll } from "vitest";
import { readWorkbook } from "../src/xlsx/workbook";
import { CalcModel, loadEngine } from "../src/calc/engine";
import { makeZip } from "./zipbuild";

const NS = `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
function book(cells: string) {
  return makeZip({
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0"?><workbook ${NS}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet ${NS}><sheetData>${cells}</sheetData></worksheet>`,
  });
}
let g: Awaited<ReturnType<typeof loadEngine>>;
beforeAll(async () => { g = await loadEngine(); }, 60_000);

describe("locale-dependent cells keep Excel's value (07 §8 Q8)", () => {
  it("text, number, boolean, error and empty cached values; their dependants equal Excel; an array formula is left alone", async () => {
    const wb = await readWorkbook(book(
      `<row r="1"><c r="A1"><v>45000</v></c><c r="B1" t="str"><f>TEXT(A1,"mmmm aaaa")</f><v>marzo 2023</v></c><c r="C1" t="str"><f>"Rif. "&amp;B1</f><v>Rif. marzo 2023</v></c>`
      + `<c r="D1" t="str"><f t="array" ref="D1:D2">TEXT(A1:A2,"aaaa")</f><v>2023</v></c></row>`
      + `<row r="2"><c r="A2"><v>45001</v></c><c r="B2"><f>VALUE(TEXT(A1,"aaaa"))</f><v>2023</v></c><c r="C2"><f>B2+1</f><v>2024</v></c><c r="D2" t="str"><v>2023</v></c></row>`
      + `<row r="3"><c r="B3" t="b"><f>TEXT(A1,"aaaa")="2023"</f><v>1</v></c><c r="C3" t="b"><f>NOT(B3)</f><v>0</v></c></row>`
      + `<row r="4"><c r="B4" t="e"><f>TEXT(A1,"0")</f><v>#N/A</v></c><c r="C4" t="b"><f>ISNA(B4)</f><v>1</v></c></row>`
      + `<row r="5"><c r="B5" t="str"><f>TEXT(A1,"0")</f><v></v></c><c r="C5"><f>LEN(B5)</f><v>0</v></c></row>`
      + `<row r="6"><c r="B6" t="str"><f>TEXT(A1,"0")</f><v>45000</v></c></row>`));
    const m = new CalcModel(g, [{ name: null, sheets: wb.sheets, externals: [] }]);
    const sc = m.selfCheck();
    // B1…B3 (Italian codes) are formatted by Slide Builder as Italian Excel does (textfmt.ts, Decisions 2026-10-17): exact;
    // B4 / B5, whose saved values no formatting gives, kept at them (locale); B6 equal as computed; the array D1:D2 left
    expect(sc.pinned.map(p => p.ref)).toEqual(["B4", "B5"]);
    expect(sc.pinned.map(p => p.cached)).toEqual([{ err: "#N/A" }, null]);
    expect(sc.different).toEqual([]);
    expect(sc.counts.locale).toBe(3); expect(sc.counts.different).toBe(0);
    expect(m.valueOf(null, "S", 1, 3)).toBe("Rif. marzo 2023");
    expect(m.valueOf(null, "S", 2, 3)).toBe(2024);
    expect(m.valueOf(null, "S", 3, 3)).toBe(false);
    expect(m.valueOf(null, "S", 4, 3)).toBe(true);
    expect(m.valueOf(null, "S", 5, 3)).toBe(0);
    // under a scenario Slide Builder's TEXT follows (46000 = 9 December 2025) and so do the cells that read it; a pinned
    // cell does not move (marked in the run's report, S8.3)
    m.set(null, "S", 1, 1, 46000); m.evaluate();
    expect(m.valueOf(null, "S", 1, 3)).toBe("Rif. dicembre 2025");
    expect(m.valueOf(null, "S", 2, 3)).toBe(2026);
    expect(m.valueOf(null, "S", 6, 2)).toBe("46000");
    expect(m.valueOf(null, "S", 4, 2)).toEqual({ err: "#N/A" });
    // a scenario input on such a cell, then put back: its formula (Slide Builder's TEXT) again
    const was = m.contentOf(null, "S", 1, 2);
    m.set(null, "S", 1, 2, "aprile 2023"); m.evaluate();
    expect(m.valueOf(null, "S", 1, 3)).toBe("Rif. aprile 2023");
    m.restore(null, "S", 1, 2, was); m.evaluate();
    expect(m.valueOf(null, "S", 1, 3)).toBe("Rif. dicembre 2025");
    m.dispose();
  }, 60_000);
  it("a large amount through Slide Builder's TEXT keeps all its digits under a scenario (review of S8.4)", async () => {
    const wb = await readWorkbook(book(`<row r="1"><c r="A1"><v>1000000000000</v></c><c r="B1" t="str"><f>TEXT(A1,"#.##0")</f><v>1.000.000.000.000</v></c></row>`));
    const m = new CalcModel(g, [{ name: null, sheets: wb.sheets, externals: [] }]);
    expect(m.selfCheck().textFormatted).toBe(1);
    m.set(null, "S", 1, 1, 1234567890123); m.evaluate();
    expect(m.valueOf(null, "S", 1, 2)).toBe("1.234.567.890.123");
    m.dispose();
  }, 60_000);
  it("a workbook without such cells evaluates once and pins nothing", async () => {
    const wb = await readWorkbook(book(`<row r="1"><c r="A1"><v>2</v></c><c r="B1" t="str"><f>TEXT(A1,"00")</f><v>02</v></c></row>`));
    const m = new CalcModel(g, [{ name: null, sheets: wb.sheets, externals: [] }]);
    const sc = m.selfCheck();
    expect(sc.pinned).toEqual([]); expect(sc.counts.exact).toBe(1);
    m.dispose();
  }, 60_000);
});

describe("a formula the engine cannot compute keeps Excel's value (2026-10-18, the product owner's deck)", () => {
  it("an array formula reading a linked workbook not in the model: every cell of its range, and what reads them", async () => {
    const wb = await readWorkbook(book(
      `<row r="1"><c r="E1"><f t="array" ref="E1:E2">[1]X!A1:A2*2</f><v>7</v></c><c r="F1"><f>SUM(E1:E2)</f><v>15</v></c></row>`
      + `<row r="2"><c r="E2"><v>8</v></c><c r="F2"><f>E2+1</f><v>9</v></c></row>`));
    const m = new CalcModel(g, [{ name: null, sheets: wb.sheets, externals: ["Other.xlsx"] }]);
    const sc = m.selfCheck();
    expect(sc.frozen.map(d => d.ref + ":" + d.why)).toEqual(["E1:linked"]);
    expect([m.valueOf(null, "S", 1, 5), m.valueOf(null, "S", 2, 5)]).toEqual([7, 8]);
    expect([m.valueOf(null, "S", 1, 6), m.valueOf(null, "S", 2, 6)]).toEqual([15, 9]);
    expect(sc.counts.different).toBe(0);
    m.dispose();
  }, 60_000);
});
