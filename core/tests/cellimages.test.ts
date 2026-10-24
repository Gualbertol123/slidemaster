/* Pictures in cells (Excel 365 "Place in Cell" and the IMAGE function, xlsx/cellimages.ts): read through the value
   metadata and rich values into Drawing.cells, laid out inside their cell (layout.ts cellPicBox) as the table's `pics` –
   which every design and export draws – and the cell's #VALUE! not shown. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { indexWorkbook } from "../src/xlsx/workbook";
import { cellPicBox } from "../src/xlsx/layout";
import { imageSize, metaBlocksBin } from "../src/xlsx/cellimages";
import { picNodes, type Metrics } from "../src/render/excel-dl";
import { makeZip } from "./zipbuild";
import type { CellPic } from "../src/xlsx/types";

const NS = `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const RELS = (body: string) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
/** a PNG's signature and header: enough for its size */
function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33); b.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h); return b;
}

/** markers B2 and F7 (the table C3:E6, 64 × 20 px cells); C3 a placed picture (40 × 20), D3 a label, C4:D5 merged with an
    IMAGE result at its own size (200 × 100) right-aligned, E3 an IMAGE result whose picture was not kept, E4 vm of
    another kind of metadata (not a picture) */
function book(): ArrayBuffer {
  return makeZip({
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    "_rels/.rels": RELS(`<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>`),
    "xl/workbook.xml": `<?xml version="1.0"?><workbook ${NS}><sheets><sheet name="Pics" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": RELS(`<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/>`
      + `<Relationship Id="rId3" Type="${REL}/sheetMetadata" Target="metadata.xml"/>`
      + `<Relationship Id="rId4" Type="http://schemas.microsoft.com/office/2017/06/relationships/rdRichValue" Target="richData/rdrichvalue.xml"/>`
      + `<Relationship Id="rId5" Type="http://schemas.microsoft.com/office/2017/06/relationships/rdRichValueStructure" Target="richData/rdrichvaluestructure.xml"/>`
      + `<Relationship Id="rId6" Type="http://schemas.microsoft.com/office/2022/10/relationships/richValueRel" Target="richData/richValueRel.xml"/>`
      + `<Relationship Id="rId7" Type="http://schemas.microsoft.com/office/2020/07/relationships/rdRichValueWebImage" Target="richData/rdRichValueWebImage.xml"/>`),
    "xl/styles.xml": `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Aptos"/></font></fonts>`
      + `<fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders>`
      + `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0"><alignment horizontal="right" vertical="top"/></xf></cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet ${NS}><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="10" width="8.43" customWidth="1"/></cols><sheetData>`
      + `<row r="2"><c r="B2" t="inlineStr"><is><t>x</t></is></c></row>`
      + `<row r="3"><c r="C3" t="e" vm="1"><v>#VALUE!</v></c><c r="D3" t="inlineStr"><is><t>Label</t></is></c><c r="E3" t="e" vm="3"><f>_xlfn.IMAGE("https://example.com/a.png")</f><v>#VALUE!</v></c></row>`
      + `<row r="4"><c r="C4" s="1" t="e" vm="2"><f>_xlfn.IMAGE("https://example.com/b.png",,2)</f><v>#VALUE!</v></c><c r="E4" vm="4"><v>3</v></c></row>`
      + `<row r="7"><c r="F7" t="inlineStr"><is><t>x</t></is></c></row>`
      + `</sheetData><mergeCells count="1"><mergeCell ref="C4:D5"/></mergeCells></worksheet>`,
    "xl/metadata.xml": `<?xml version="1.0"?><metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xlrd="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata">`
      + `<metadataTypes count="2"><metadataType name="XLDAPR"/><metadataType name="XLRICHVALUE"/></metadataTypes>`
      + `<futureMetadata name="XLDAPR" count="1"><bk/></futureMetadata>`
      + `<futureMetadata name="XLRICHVALUE" count="3"><bk><extLst><ext uri="{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}"><xlrd:rvb i="0"/></ext></extLst></bk>`
      + `<bk><extLst><ext uri="{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}"><xlrd:rvb i="1"/></ext></extLst></bk><bk><extLst><ext uri="{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}"><xlrd:rvb i="2"/></ext></extLst></bk></futureMetadata>`
      + `<valueMetadata count="4"><bk><rc t="2" v="0"/></bk><bk><rc t="2" v="1"/></bk><bk><rc t="2" v="2"/></bk><bk><rc t="1" v="0"/></bk></valueMetadata></metadata>`,
    "xl/richData/rdrichvaluestructure.xml": `<?xml version="1.0"?><rvStructures xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="2">`
      + `<s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/><k n="Text" t="s"/></s>`
      + `<s t="_webimage"><k n="WebImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/><k n="ComputedImage" t="b"/><k n="ImageSizing" t="i"/></s></rvStructures>`,
    "xl/richData/rdrichvalue.xml": `<?xml version="1.0"?><rvData xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="3">`
      + `<rv s="0"><v>0</v><v>5</v><v>Flag &amp; logo</v></rv><rv s="1"><v>0</v><v>1</v><v>1</v><v>2</v></rv><rv s="1"><v>1</v><v>1</v><v>1</v><v>0</v></rv></rvData>`,
    "xl/richData/richValueRel.xml": `<?xml version="1.0"?><richValueRels xmlns="http://schemas.microsoft.com/office/spreadsheetml/2022/richvaluerel" xmlns:r="${REL}"><rel r:id="rId1"/></richValueRels>`,
    "xl/richData/_rels/richValueRel.xml.rels": RELS(`<Relationship Id="rId1" Type="${REL}/image" Target="../media/image1.png"/>`),
    "xl/richData/rdRichValueWebImage.xml": `<?xml version="1.0"?><webImagesSrd xmlns="http://schemas.microsoft.com/office/spreadsheetml/2020/richdatawebimage" xmlns:r="${REL}">`
      + `<webImageSrd><address r:id="rId1"/><blip r:id="rId2"/></webImageSrd><webImageSrd><address r:id="rId3"/></webImageSrd></webImagesSrd>`,
    "xl/richData/_rels/rdRichValueWebImage.xml.rels": RELS(`<Relationship Id="rId1" Type="${REL}/hyperlink" Target="https://example.com/b.png" TargetMode="External"/>`
      + `<Relationship Id="rId2" Type="${REL}/image" Target="../media/image2.png"/><Relationship Id="rId3" Type="${REL}/hyperlink" Target="https://example.com/a.png" TargetMode="External"/>`),
    "xl/media/image1.png": png(40, 20),
    "xl/media/image2.png": png(200, 100),
  });
}

describe("pictures in cells", () => {
  it("are read from the rich values: placed pictures and IMAGE results, a missing one reported", async () => {
    const wb = await indexWorkbook(book()), [S] = await wb.ensure(["Pics"]);
    const cells = S.drawing.cells!;
    expect(cells.map(q => [q.r, q.c, q.name, q.sizing, q.iw, q.ih, !!q.src, q.unsupported])).toEqual([
      [3, 3, "Flag & logo", 0, 40, 20, true, undefined],
      [3, 5, "Picture in E3", 0, 0, 0, false, "Picture not kept in the workbook"],
      [4, 3, "Picture in C4", 2, 200, 100, true, undefined],
    ]);
    expect(cells[0].src).toMatch(/^data:image\/png;base64,/);
    expect(S.drawing.unsupported).toEqual(["Picture in E3 (picture not kept in the workbook)"]);
  });

  it("are laid out in their cell, the cell's #VALUE! not shown", async () => {
    const wb = await indexWorkbook(book()), [S] = await wb.ensure(["Pics"]);
    const L = S.tables[0], at = (r: number, c: number) => L.items.find(it => it.b.r === r && it.b.c === c)!;
    const cw = S.colPx(3), rh = S.rowPx(3);
    expect(L.errors).toEqual([]);
    for (const [r, c] of [[3, 3], [3, 5], [4, 3]]) expect(at(r, c).text).toBe("");
    expect(at(3, 4).text).toBe("Label");
    const pic = (name: string) => L.pics.find(p => p.name === name)!, fit = pic("Flag & logo"), own = pic("Picture in C4"), missing = pic("Picture in E3");
    expect(L.pics).toHaveLength(3);
    // fit: as large as the cell allows (1 px inside it) keeping 2:1, centred (General), at the bottom (the default)
    const h = Math.min(rh - 2, (cw - 2) / 2), w = 2 * h;
    expect(fit).toMatchObject({ name: "Flag & logo", crop: null });
    expect(fit.w).toBeCloseTo(w); expect(fit.h).toBeCloseTo(h);
    expect(fit.x).toBeCloseTo(1 + (cw - 2 - w) / 2); expect(fit.y).toBeCloseTo(rh - 1 - h);
    // its own size (200 × 100) in the merged C4:D5, right and top aligned: cut at the box's left and bottom
    const BW = 2 * cw - 2, BH = 2 * rh - 2;
    expect(own.x).toBeCloseTo(1); expect(own.y).toBeCloseTo(rh + 1); expect(own.w).toBeCloseTo(BW); expect(own.h).toBeCloseTo(BH);
    expect(own.crop!.l).toBeCloseTo((200 - BW) / 200); expect(own.crop!.r).toBe(0); expect(own.crop!.t).toBe(0); expect(own.crop!.b).toBeCloseTo((100 - BH) / 100);
    // not kept: the missing picture's placeholder over the cell (left out of exports by the renderers)
    expect(missing).toMatchObject({ x: 2 * cw + 1, y: 1, w: cw - 2, h: rh - 2, unsupported: "Picture not kept in the workbook" });
  });

  it("are drawn as images by the renderers", async () => {
    const wb = await indexWorkbook(book()), [S] = await wb.ensure(["Pics"]);
    const M: Metrics = { run: () => ({ w: 10, asc: 8, desc: 2 }), lines: t => [t] };
    const images: Record<string, string> = {};
    const nodes = S.tables[0].pics.filter(p => !p.unsupported).flatMap(p => picNodes(p, true, images, M));
    expect(nodes.filter(n => n.t === "image")).toHaveLength(2);
    expect(Object.values(images).every(s => s.startsWith("data:image/png"))).toBe(true);
  });

  it("fill, custom size and an unknown size", () => {
    const it0 = { bx: 0, by: 0, bw: 102, bh: 52, align: "center", valign: "center" };
    const q = (p: Partial<CellPic>): CellPic => ({ r: 1, c: 1, name: "p", src: "data:image/png;base64,", iw: 10, ih: 10, sizing: 0, ...p });
    expect(cellPicBox(q({ sizing: 1 }), it0)).toMatchObject({ x: 1, y: 1, w: 100, h: 50 });
    expect(cellPicBox(q({ sizing: 3, w: 20, h: 30 }), it0)).toMatchObject({ x: 41, y: 11, w: 20, h: 30, crop: null });
    expect(cellPicBox(q({ sizing: 0 }), it0)).toMatchObject({ x: 26, y: 1, w: 50, h: 50 });
    expect(cellPicBox(q({ sizing: 0, iw: 0, ih: 0 }), it0)).toMatchObject({ x: 1, y: 1, w: 100, h: 50 });
    expect(cellPicBox(q({}), { ...it0, bw: 2 })).toBeNull();
  });

  it("imageSize reads PNG, GIF, BMP, JPEG and WebP headers", () => {
    expect(imageSize(png(40, 20))).toEqual({ w: 40, h: 20 });
    expect(imageSize(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 3, 0, 5, 0]))).toEqual({ w: 3, h: 5 });
    const bmp = new Uint8Array(26); bmp.set([0x42, 0x4D]); new DataView(bmp.buffer).setInt32(18, 7, true); new DataView(bmp.buffer).setInt32(22, -9, true);
    expect(imageSize(bmp)).toEqual({ w: 7, h: 9 });
    // SOI, an APP0 segment, SOF0 (precision, height 300, width 400)
    const jpg = Uint8Array.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 4, 0, 0, 0xFF, 0xC0, 0, 11, 8, 0x01, 0x2C, 0x01, 0x90, 3, 0, 0, 0, 0]);
    expect(imageSize(jpg)).toEqual({ w: 400, h: 300 });
    const webp = new Uint8Array(30); webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
    webp.set([15, 0, 0, 7, 0, 0], 24);
    expect(imageSize(webp)).toEqual({ w: 16, h: 8 });
    expect(imageSize(Uint8Array.from([1, 2, 3]))).toBeNull();
  });
});

/* Functions.xlsx / .xlsb (tests/corpus, saved by Excel): five dynamic array formulas E135:E139 whose values are rich
   values of another kind (_error: vm 1, 1, 2, 3, 1) – never pictures; and the same files with those rich values made a
   placed picture each, to read pictures in cells from files Excel wrote, .xlsb included */
const RECALC = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../tests/corpus/workbooks/recalc");
const real = (f: string) => new Uint8Array(fs.readFileSync(path.join(RECALC, f)));
const ab = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
/** the workbook with its rich values replaced by placed pictures: values 0 and 2 the 40 × 20 picture, 1 the 200 × 100 one */
function withPictures(f: string): ArrayBuffer {
  const z = unzipSync(real(f)), put = (p: string, x: string | Uint8Array) => { z[p] = typeof x === "string" ? Uint8Array.from(strToU8(x)) : x; };
  put("xl/richData/rdrichvaluestructure.xml", `<?xml version="1.0"?><rvStructures xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="1"><s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/></s></rvStructures>`);
  put("xl/richData/rdrichvalue.xml", `<?xml version="1.0"?><rvData xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="3"><rv s="0"><v>0</v><v>5</v></rv><rv s="0"><v>1</v><v>5</v></rv><rv s="0"><v>0</v><v>5</v></rv></rvData>`);
  put("xl/richData/richValueRel.xml", `<?xml version="1.0"?><richValueRels xmlns="http://schemas.microsoft.com/office/spreadsheetml/2022/richvaluerel" xmlns:r="${REL}"><rel r:id="rId1"/><rel r:id="rId2"/></richValueRels>`);
  put("xl/richData/_rels/richValueRel.xml.rels", RELS(`<Relationship Id="rId1" Type="${REL}/image" Target="../media/image1.png"/><Relationship Id="rId2" Type="${REL}/image" Target="../media/image2.png"/>`));
  put("xl/media/image1.png", png(40, 20)); put("xl/media/image2.png", png(200, 100));
  return ab(zipSync(z));
}

describe("pictures in cells: real Excel files", () => {
  it("metadata.bin gives the value metadata blocks metadata.xml gives", () => {
    expect(metaBlocksBin(unzipSync(real("xlsb/Functions.xlsb"))["xl/metadata.bin"])).toEqual([0, 1, 2]);
    expect(strFromU8(unzipSync(real("Functions.xlsx"))["xl/metadata.xml"])).toMatch(/<valueMetadata count="3">/);
  });

  for (const f of ["Functions.xlsx", "xlsb/Functions.xlsb"]) {
    it(f + ": rich values that are not pictures are left as they were", async () => {
      const wb = await indexWorkbook(ab(real(f))), [S] = await wb.ensure([wb.meta[0].name]);
      expect(S.drawing.cells).toBeUndefined();
      expect(S.drawing.unsupported).toEqual([]);
      expect(S.get(135, 5)!.t).toBe("e");
    });

    it(f + ": with placed pictures, each cell has its picture (the cells' vm read from the sheet)", async () => {
      const wb = await indexWorkbook(withPictures(f)), [S] = await wb.ensure([wb.meta[0].name]);
      expect(S.drawing.cells!.map(q => [q.r, q.c, q.iw, q.ih, q.sizing])).toEqual([
        [135, 5, 40, 20, 0], [136, 5, 40, 20, 0], [137, 5, 200, 100, 0], [138, 5, 40, 20, 0], [139, 5, 40, 20, 0],
      ]);
      expect(S.drawing.cells!.every(q => q.src?.startsWith("data:image/png;base64,") && !q.unsupported)).toBe(true);
    });
  }
});
