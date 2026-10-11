/* The columnar usedRange / detectTables (src/xlsx/detect.ts, PLAN S2.6) give what the cell-by-cell versions gave
   (tests/detect-v3.ts): every corpus sheet (big30 too when generated), sheets read without columns (slices), and
   crafted sheets with blank texts, fills, errors, unsorted cells and hidden rows. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkbook } from "../src/xlsx/workbook";
import { detectTables, usedRange } from "../src/xlsx/detect";
import * as v3 from "./detect-v3";
import { makeZip } from "./zipbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(here, "../../tests/corpus/workbooks");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

describe("columnar suggestions = cell by cell", () => {
  for (const f of fs.readdirSync(CORPUS).filter(f => /\.xls[xm]$/i.test(f)).sort()) it(f, async () => {
    const wb = await readWorkbook(ab(path.join(CORPUS, f)));
    for (const S of wb.sheets) {
      expect(S.cols).toBeTruthy();
      expect(usedRange(S)).toEqual(v3.usedRange(S));
      expect(detectTables(S)).toEqual(v3.detectTables(S));
    }
  }, 300_000);

  it("crafted: blank texts, spaces, fills, errors, booleans, unsorted cells, hidden rows, far cells", async () => {
    const NS = `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
    const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const sheets = [
      // blank and space-only texts do not count; a fill alone does; errors and booleans do
      `<row r="2"><c r="B2" t="inlineStr"><is><t>  </t></is></c><c r="C2" t="str"><v></v></c><c r="D2" s="1"/></row><row r="3"><c r="B3" t="e"><v>#N/A</v></c><c r="C3" t="b"><v>0</v></c><c r="E3"><v>1</v></c><c r="F3"><v>2</v></c></row><row r="4"><c r="B4"><v>1</v></c><c r="C4"><v>2</v></c><c r="D4" t="s"><v>0</v></c><c r="E4" t="s"><v>1</v></c></row><row r="5" hidden="1"><c r="B5"><v>5</v></c></row><row r="6"><c r="B6"><v>6</v></c><c r="C6"><v>7</v></c></row><row r="900"><c r="CC900" t="inlineStr"><is><t>far</t></is></c></row>`,
      // a fill alone sets the used range (F8), an empty text does not (H9)
      `<row r="2"><c r="B2"><v>1</v></c><c r="C2"><v>2</v></c></row><row r="3"><c r="B3"><v>3</v></c><c r="C3"><v>4</v></c></row><row r="8"><c r="F8" s="1"/></row><row r="9"><c r="H9" t="s"><v>0</v></c></row>`,
      // unsorted and duplicated cells
      `<row r="9"><c r="D9"><v>1</v></c><c r="B9"><v>2</v></c></row><row r="3"><c r="B3"><v>3</v></c><c r="C3"><v>4</v></c></row><row r="4"><c r="B4"><v>5</v></c><c r="C4"><v>6</v></c><c r="C4"><v>7</v></c></row><row r="10"><c r="B10"><v>8</v></c><c r="D10"><v>9</v></c></row>`,
    ];
    const files: Record<string, string> = {
      "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      "xl/workbook.xml": `<workbook ${NS}><sheets>${sheets.map((_, i) => `<sheet name="S${i}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i}.xml"/>`).join("")}<Relationship Id="rS" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rT" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
      "xl/styles.xml": `<styleSheet ${NS}><fonts><font><sz val="11"/></font></fonts><fills><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF00B050"/></patternFill></fill></fills><borders><border/></borders><cellXfs><xf/><xf fillId="2"/></cellXfs></styleSheet>`,
      "xl/sharedStrings.xml": `<sst ${NS}><si><t></t></si><si><t xml:space="preserve"> x </t></si></sst>`,
    };
    sheets.forEach((d, i) => { files[`xl/worksheets/sheet${i}.xml`] = `<worksheet ${NS}><sheetData>${d}</sheetData></worksheet>`; });
    const wb = await readWorkbook(makeZip(files));
    for (const S of wb.sheets) {
      expect(usedRange(S)).toEqual(v3.usedRange(S));
      expect(detectTables(S)).toEqual(v3.detectTables(S));
    }
    expect(usedRange(wb.sheets[0])).toEqual({ r2: 400, c2: 80, clipped: true });   // the far cell clips it
    expect(usedRange(wb.sheets[1])).toEqual({ r2: 8, c2: 6, clipped: false });
  });
});
