/* ⏱ S16.4 · Excel's conditional formats (docs/next/09 §7.4, plan-M16 S16.4): 10,000 cells, each under five rules of
   different types (a 3-colour scale, a data bar, an icon set, a top 10 and a formula rule), evaluated cell by cell as
   buildLayout does (xlsx/cf.ts cfAt) – the range statistics computed once per rule within the run – in at most 30 ms.
   Median of 20 after 3 untimed; the limit scaled by tools/calibrate.mjs, judged by tools/benchgate.mjs (as the pie gate). */
import { expect, it } from "vitest";
import { readWorkbook } from "../src/xlsx/workbook";
import { cfAt } from "../src/xlsx/cf";
import { makeZip } from "../tests/zipbuild";
import { speedFactor } from "../../tools/calibrate.mjs";
import { describe, judge } from "../../tools/benchgate.mjs";
import type { CFRule } from "../src/xlsx/types";

const CF_MS = 30, ROWS = 100, COLS = 100;
const median = (a: number[]) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const NS = `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const colName = (c: number) => { let s = ""; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };

it("conditional formats: 10,000 cells × 5 rule types evaluate in under 30 ms", async () => {
  const speed = speedFactor();
  let rows = "";
  for (let r = 1; r <= ROWS; r++) { rows += `<row r="${r}">`; for (let c = 1; c <= COLS; c++) rows += `<c r="${colName(c)}${r}"><v>${(r * 7919 + c * 104729) % 1000 - 300}</v></c>`; rows += "</row>"; }
  const all = `A1:${colName(COLS)}${ROWS}`;
  const cf = `<conditionalFormatting sqref="${all}"><cfRule type="colorScale" priority="1"><colorScale><cfvo type="min"/><cfvo type="percentile" val="50"/><cfvo type="max"/><color rgb="FFF8696B"/><color rgb="FFFFEB84"/><color rgb="FF63BE7B"/></colorScale></cfRule>`
    + `<cfRule type="dataBar" priority="2"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF638EC6"/></dataBar></cfRule>`
    + `<cfRule type="iconSet" priority="3"><iconSet iconSet="5Arrows"><cfvo type="percent" val="0"/><cfvo type="percent" val="20"/><cfvo type="percent" val="40"/><cfvo type="percent" val="60"/><cfvo type="percent" val="80"/></iconSet></cfRule>`
    + `<cfRule type="top10" dxfId="0" priority="4" rank="10" percent="1"/><cfRule type="expression" dxfId="1" priority="5"><formula>AND(A1&gt;0,MOD(ROW(),2)=0)</formula></cfRule></conditionalFormatting>`;
  const wb = await readWorkbook(makeZip({
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook ${NS}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<styleSheet ${NS}><fonts><font><sz val="11"/><name val="Calibri"/></font></fonts><fills><fill><patternFill patternType="none"/></fill></fills><borders><border/></borders><cellXfs><xf/></cellXfs><dxfs><dxf><fill><patternFill><bgColor rgb="FFFF0000"/></patternFill></fill></dxf><dxf><font><b/></font></dxf></dxfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": `<worksheet ${NS}><sheetData>${rows}</sheetData>${cf}</worksheet>`,
  }));
  const S = wb.sheets[0], rules0 = S.cfRules;
  expect(rules0.map(r => r.type)).toEqual(["colorScale", "dataBar", "iconSet", "top10", "expression"]);
  const measure = () => {
    const times: number[] = [];
    for (let run = 0; run < 23; run++) {
      // new rule objects each run: the statistics are computed again, as for a workbook just read
      (S as { cfRules: CFRule[] }).cfRules = rules0.map(r => ({ ...r }));
      let n = 0;
      const t0 = performance.now();
      for (let r = 1; r <= ROWS; r++) for (let c = 1; c <= COLS; c++) { const x = cfAt(S, r, c); if (x?.bar && x.icon && x.dxf?.fill) n++; }
      const t = performance.now() - t0;
      expect(n).toBe(ROWS * COLS);
      if (run >= 3) times.push(t);
    }
    return { cf_ms: median(times) };
  };
  const limit = CF_MS * speed.factor;
  const { gates, bad } = await judge({ limits: { cf_ms: limit }, first: measure(), again: () => measure(), strict: true });
  const report = gates.map(g => describe(g)).join(", ");
  console.log(`bench · conditional formats (10,000 cells × 5 rules): ${gates.map(g => `${g.first.toFixed(2)} ms`).join(", ")} (median of 20; limit ${CF_MS} ms × ${speed.factor.toFixed(2)})${gates.some(g => "repeat" in g) ? " · " + report : ""}`);
  expect(bad, `conditional formats: ${report} (+ 10 %)`).toEqual([]);
}, 120_000);
