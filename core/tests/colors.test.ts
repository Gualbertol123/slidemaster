/* Colours read from a workbook are always "#RRGGBB" (audit SEC-1, docs/next/AUDIT.md): a theme colour, a sysClr's
   lastClr, a cell's rgb or a drawing's srgbClr went into the colours unchecked, and the wizard's preview grid writes
   them into HTML (style="background:…") – a crafted workbook ran script in the page that holds the helper's token. */
import { describe, expect, it } from "vitest";
import { indexWorkbook } from "../src/xlsx/workbook";
import { readDrawing } from "../src/xlsx/drawing";
import { sheetWindow } from "../src/xlsx/sheetview";
import { featureWorkbook } from "./zipbuild";

const EVIL = `4472C4&quot;&gt;&lt;img src=x onerror=alert(1)&gt;`;
const HEX6 = /^#[0-9A-F]{6}$/i;

function crafted() {
  return featureWorkbook({
    "xl/theme/theme1.xml": `<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Custom"><a:themeElements><a:clrScheme name="Bank">`
      + `<a:dk1><a:sysClr val="windowText" lastClr="11&quot;&gt;&lt;b&gt;"/></a:dk1><a:lt1><a:sysClr val="window"/></a:lt1><a:dk2><a:srgbClr val="0E2841"/></a:dk2><a:lt2><a:srgbClr val="E8E8E8"/></a:lt2>`
      + `<a:accent1><a:srgbClr val="${EVIL}"/></a:accent1><a:accent2><a:srgbClr val="${EVIL}"/></a:accent2><a:accent3><a:srgbClr val="7F7F7F"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>`
      + `<a:accent5><a:srgbClr val="${EVIL}"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:sysClr val="windowText"/></a:folHlink>`
      + `</a:clrScheme></a:themeElements></a:theme>`,
    "xl/styles.xml": `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
      + `<fonts count="2"><font><sz val="11"/><color theme="1"/><name val="Aptos"/></font><font><sz val="11"/><color rgb="FF&quot;&gt;&lt;i&gt;"/><name val="Aptos"/></font></fonts>`
      + `<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>`
      + `<fill><patternFill patternType="solid"><fgColor theme="4"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor theme="8" tint="0"/></patternFill></fill></fills>`
      + `<borders count="1"><border/></borders><cellXfs count="3"><xf fontId="0" fillId="0" borderId="0"/><xf fontId="1" fillId="2" borderId="0" applyFill="1"/><xf fontId="0" fillId="3" borderId="0" applyFill="1"/></cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>`
      + `<row r="1"><c r="A1" s="1" t="inlineStr"><is><t>Revenue</t></is></c><c r="B1" s="2"><v>2</v></c></row></sheetData><drawing r:id="rId1"/></worksheet>`,
    "xl/drawings/drawing1.xml": `<?xml version="1.0"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">`
      + `<xdr:absoluteAnchor><xdr:pos x="0" y="0"/><xdr:ext cx="952500" cy="476250"/><xdr:sp><xdr:nvSpPr><xdr:cNvPr id="3" name="Box"/></xdr:nvSpPr><xdr:spPr><a:prstGeom prst="rect"/>`
      + `<a:solidFill><a:srgbClr val="${EVIL}"/></a:solidFill><a:ln><a:solidFill><a:sysClr val="windowText" lastClr="${EVIL}"/></a:solidFill></a:ln></xdr:spPr></xdr:sp><xdr:clientData/></xdr:absoluteAnchor></xdr:wsDr>`,
  });
}

describe("colours from a workbook are #RRGGBB only (audit SEC-1)", () => {
  it("theme, cell fills and fonts, the wizard's window and drawings carry no markup", async () => {
    const wb = await indexWorkbook(crafted());
    const name = wb.meta[0].name;
    const [sheet] = await wb.ensure([name]);
    const sh = wb.shared!;
    for (const c of sh.theme) expect(c).toMatch(/^[0-9A-F]{6}$/i);
    const win = sheetWindow(sheet, 1, 1, 1, 2);
    const cells = JSON.stringify(win);
    expect(cells).not.toMatch(/onerror|<|>/);
    expect(win.cells.length).toBe(2);
    for (const c of win.cells as { fill?: string | null; color?: string | null }[]) {
      if (c.fill) expect(c.fill).toMatch(HEX6);
      if (c.color) expect(c.color).toMatch(HEX6);
    }
    const drawing = JSON.stringify(await readDrawing(wb.zip, wb.meta[0].path, sh));
    expect(drawing).not.toMatch(/onerror|<img/);
    expect(JSON.stringify(sh.xfs) + JSON.stringify(sh.dxfs)).not.toMatch(/onerror|<|>/);
  });
});
