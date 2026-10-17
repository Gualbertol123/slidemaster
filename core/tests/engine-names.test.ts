/* Defined names in the formula engine (M8, found by the large stand-in corpus: 111 cells came out #NAME?). The reader
   takes workbook.xml's <definedName>s (Excel's own _xlnm.* and #REF! ones left out); the engine defines them before the
   cells – a reference as it is, a constant or a formula through a cell of a sheet of its own (IronCalc takes references
   only). A synthetic workbook whose cached values are what "Excel" saved. */
import { describe, expect, it, beforeAll } from "vitest";
import { readWorkbook } from "../src/xlsx/workbook";
import { CalcModel, loadEngine } from "../src/calc/engine";
import { makeZip } from "./zipbuild";

const NS = `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const sheet = (cells: string) => `<?xml version="1.0"?><worksheet ${NS}><sheetData>${cells}</sheetData></worksheet>`;
function book() {
  return makeZip({
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0"?><workbook ${NS}><sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Calc" sheetId="2" r:id="rId2"/></sheets><definedNames>`
      + `<definedName name="_xlnm.Print_Area" localSheetId="0">Data!$A$1:$B$3</definedName><definedName name="Gone">#REF!</definedName>`
      + `<definedName name="Amounts">Data!$B$1:$B$3</definedName><definedName name="Pick">Data!$A$1</definedName>`
      + `<definedName name="Tax">0.25</definedName><definedName name="Total">SUM(Amounts)*(1-Tax)</definedName>`
      + `<definedName name="Local" localSheetId="1">Data!$B$3</definedName></definedNames></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": sheet(`<row r="1"><c r="A1"><v>2</v></c><c r="B1"><v>10</v></c></row><row r="2"><c r="B2"><v>20</v></c></row><row r="3"><c r="B3"><v>30</v></c></row>`),
    "xl/worksheets/sheet2.xml": sheet(`<row r="1"><c r="A1"><f>SUM(Amounts)</f><v>60</v></c><c r="B1"><f>INDEX(Amounts,Pick)</f><v>20</v></c><c r="C1"><f>A1*Tax</f><v>15</v></c>`
      + `<c r="D1"><f>Total</f><v>45</v></c><c r="E1"><f>Local+1</f><v>31</v></c></row>`),
  });
}
let g: Awaited<ReturnType<typeof loadEngine>>;
beforeAll(async () => { g = await loadEngine(); }, 60_000);

describe("defined names (M8)", () => {
  it("the reader lists them – not Excel's own, not #REF! – with a sheet-level name's sheet", async () => {
    const wb = await readWorkbook(book());
    expect(wb.names).toEqual([
      { name: "Amounts", scope: null, formula: "Data!$B$1:$B$3" }, { name: "Pick", scope: null, formula: "Data!$A$1" },
      { name: "Tax", scope: null, formula: "0.25" }, { name: "Total", scope: null, formula: "SUM(Amounts)*(1-Tax)" },
      { name: "Local", scope: "Calc", formula: "Data!$B$3" }]);
  });
  it("references, a constant, a formula of names and a sheet-level name compute as Excel; they follow a scenario", async () => {
    const wb = await readWorkbook(book());
    const m = new CalcModel(g, [{ name: null, sheets: wb.sheets, externals: [], names: wb.names }]);
    const sc = m.selfCheck();
    expect(m.namesSkipped).toEqual([]);
    expect(sc.counts.different).toBe(0); expect(sc.counts.exact).toBe(5);
    m.set(null, "Data", 1, 2, 40); m.set(null, "Data", 1, 1, 3); m.evaluate();
    expect([1, 2, 3, 4, 5].map(c => m.valueOf(null, "Calc", 1, c))).toEqual([90, 30, 22.5, 67.5, 31]);
    m.dispose();
  }, 60_000);
  it("without its names (as before M8) the same cells are #NAME?: the self-check reports them", async () => {
    const wb = await readWorkbook(book());
    const m = new CalcModel(g, [{ name: null, sheets: wb.sheets, externals: [] }]);
    expect(m.selfCheck().counts.different).toBe(5);
    m.dispose();
  }, 60_000);
});
