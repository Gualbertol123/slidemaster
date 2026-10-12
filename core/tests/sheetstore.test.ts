/* The byte scanner and columnar SheetStore against v3's regex parser (tests/sheet-v3.ts), cell by cell
   (PLAN S2.3): every sheet of every corpus workbook (big30.xlsx too when it has been generated:
   python tools/make_corpus.py big30 tests/corpus/workbooks), and crafted sheets with every cell shape v3
   handled. Compared: the cells in iteration order (value, type, xf, format, runs), lookups by (r, c) and by
   key, xfAt, and the row information. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { indexWorkbook, readSheet } from "../src/xlsx/workbook";
import { zget } from "../src/xlsx/util";
import { BUILTIN } from "../src/xlsx/numfmt";
import { CellMap, RowMap, SheetScanner } from "../src/xlsx/sheetstore";
import { cellsV3 } from "./sheet-v3";
import type { Cell, RowInfo, Shared, Sheet, Xf } from "../src/xlsx/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(here, "../../tests/corpus/workbooks");
const books = fs.readdirSync(CORPUS).filter(f => /\.xls[xm]$/i.test(f)).sort();

/** a cell as plain data (xf by identity: its index in ctx.xfs, or the object for "{}") */
const plain = (x: Cell | null | undefined, ctx: Shared) => x && { r: x.r, c: x.c, v: x.v, t: x.t, xf: ctx.xfs.indexOf(x.xf) >= 0 ? ctx.xfs.indexOf(x.xf) : x.xf, fmt: x.fmt, scr: x.scr, keys: Object.keys(x).join() };

function compare(ref: { cells: Map<string, Cell>; rowInfo: Map<number, RowInfo> }, cells: ReadonlyMap<string, Cell>, rowInfo: ReadonlyMap<number, RowInfo>, ctx: Shared, S?: Sheet) {
  expect(cells.size).toBe(ref.cells.size);
  const a = ref.cells.values(), b = cells.values();
  for (let n = 0; ; n++) {
    const x = a.next(), y = b.next();
    expect(y.done).toBe(x.done);
    if (x.done || y.done) break;
    const px = plain(x.value, ctx), py = plain(y.value, ctx);
    if (JSON.stringify(px) !== JSON.stringify(py) || !Object.is(x.value.v, y.value.v)) expect({ n, cell: py }).toEqual({ n, cell: px });
    if (n % 97 === 0) {                                          // lookups, on a sample (all cells in the small sheets)
      const k = x.value.r + "," + x.value.c;
      expect(plain(cells.get(k), ctx)).toEqual(plain(ref.cells.get(k), ctx));
      if (S) { expect(plain(S.get(x.value.r, x.value.c), ctx)).toEqual(px); expect(S.xfAt(x.value.r, x.value.c)).toBe(x.value.xf); }
    }
  }
  expect(cells.get("0,0")).toBeUndefined();
  expect(rowInfo.size).toBe(ref.rowInfo.size);
  for (const [r, info] of ref.rowInfo) expect(rowInfo.get(r)).toEqual(info);
}

describe("SheetStore = v3's parser on the corpus", () => {
  it("has the corpus", () => expect(books.length).toBeGreaterThanOrEqual(9));
  for (const f of books) it(f, async () => {
    const buf = fs.readFileSync(path.join(CORPUS, f));
    const wb = await indexWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    for (const m of wb.meta) {
      await wb.ensure([m.name]);
      const S = wb.sheets.find(s => s.name === m.name)!, ctx = wb.shared!;
      expect(S.error).toBeUndefined();
      const xml = await zget(wb.zip, m.path)!.async("string");
      compare(cellsV3(xml, ctx, S.defRowH), S.cells, S.rowInfo, ctx, S);
      wb.sheets.length = 0;                                      // one big sheet in memory at a time
    }
  }, 600_000);
});

/* ---- crafted sheets: every shape v3's regex parser handled ---- */
const xf = (fmt: string): Xf => ({ fmt, font: {}, fill: null, border: {}, h: "general", v: "bottom", wrap: false, indent: 0, rot: 0 });
const ctx: Shared = {
  sst: ["", "plain", "rich text", "x"], sstRuns: [undefined, undefined, [[5, 9, "sup"]], undefined],
  xfs: [xf("General"), xf(BUILTIN["14"] || "mm-dd-yy"), xf("0.00"), xf("dd/mm/yyyy hh:mm")], dxfs: [], defaultFont: {}, color: () => null, theme: [], mdw: 7,
};
const sheet = (data: string, ns = "") => `<?xml version="1.0"?><${ns}worksheet xmlns${ns ? ":" + ns.slice(0, -1) : ""}="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><${ns}sheetFormatPr defaultRowHeight="15"/><${ns}sheetData>${data}</${ns}sheetData></${ns}worksheet>`;
function scan(xml: string) {
  const b = new TextEncoder().encode(xml);
  const sd0 = Buffer.from(xml.slice(0, xml.search(/<(?:\w+:)?sheetData\b/))).length, sd1 = Buffer.from(xml.slice(0, xml.search(/<\/(?:\w+:)?sheetData>/))).length;
  const sc = new SheetScanner(b, sd0, sd1, ctx, 15); sc.run();
  const { cells, rows } = sc.finish();
  return { cells: new CellMap(cells, ctx), rowInfo: new RowMap(rows) };
}
const same = (xml: string) => { const got = scan(xml); compare(cellsV3(xml, ctx, 15), got.cells, got.rowInfo, ctx); return got; };

describe("SheetStore = v3's parser on every cell shape", () => {
  const cases: Record<string, string> = {
    "types s, inlineStr, str, b, e, d, n": sheet(`<row r="1"><c r="A1" t="s"><v>1</v></c><c r="B1" t="inlineStr"><is><t>inline</t></is></c><c r="C1" t="str"><f>A1</f><v>formula text</v></c><c r="D1" t="b"><v>1</v></c><c r="E1" t="b"><v>0</v></c><c r="F1" t="e"><v>#DIV/0!</v></c><c r="G1" t="d"><v>2026-09-25T14:30:00</v></c><c r="H1"><v>3.25</v></c><c r="I1" t="n"><v>-12</v></c><c r="J1" t="n"><v>1E-3</v></c></row>`),
    "numbers as dates by format; styles": sheet(`<row r="2"><c r="A2" s="1"><v>46290</v></c><c r="B2" s="3"><v>46290.5</v></c><c r="C2" s="2"><v>7</v></c><c r="D2" s="99"><v>1</v></c><c r="E2" s="x"><v>2</v></c><c r="F2" s="1.0"><v>3</v></c></row>`),
    "rich runs and phonetic runs": sheet(`<row r="1"><c r="A1" t="s"><v>2</v></c><c r="B1" t="inlineStr"><is><r><t>m</t></r><r><rPr><vertAlign val="superscript"/></rPr><t>2</t></r><r><t> and H</t></r><r><rPr><vertAlign val="subscript"/></rPr><t>2</t></r><r><t>O</t></r></is></c><c r="C1" t="inlineStr"><is><t>漢字</t><rPh sb="0" eb="2"><t>かんじ</t></rPh></is></c></row>`),
    "_xHHHH_ escapes and entities": sheet(`<row r="1"><c r="A1" t="inlineStr"><is><t>a_x000D__x000A_b &amp; c &lt;d&gt; &#233; &#x263A;</t></is></c><c r="B1" t="str"><v>x_x0009_y&amp;z</v></c><c r="C1" t="e"><v>#N/A&amp;</v></c></row>`),
    "namespace prefixes": sheet(`<x:row r="1"><x:c r="A1" t="s"><x:v>1</x:v></x:c><x:c r="B1" t="inlineStr"><x:is><x:t>p</x:t></x:is></x:c><x:c r="C1"><x:v>5</x:v></x:c></x:row>`, "x:"),
    "rows and cells without r": sheet(`<row><c t="s"><v>1</v></c><c><v>2</v></c></row><row><c><v>3</v></c><c r="E2"><v>4</v></c><c><v>5</v></c></row><row r="7"><c><v>6</v></c></row><row><c/></row>`),
    "xml:space, empty values, self-closing": sheet(`<row r="1" spans="1:9"><c r="A1" t="inlineStr"><is><t xml:space="preserve">  padded  </t></is></c><c r="B1"><v xml:space="preserve"> 42 </v></c><c r="C1" t="s"><v></v></c><c r="D1" t="s"/><c r="E1"><v/></c><c r="F1" t="str"><v></v></c><c r="G1" s="2"/><c r="H1" t="inlineStr"/><c r="I1" t="s"><v>0</v></c></row>`),
    "row information": sheet(`<row r="3" ht="30" customHeight="1"/><row r="4" hidden="1"/><row r="5" hidden="true" customFormat="1" s="2"><c r="A5"><v>1</v></c></row><row r="6" customFormat="0" s="2"/><row r="8" customFormat="1"/><row r="9" ht="" hidden="0"/>`),
    "unsorted and duplicated cells and rows": sheet(`<row r="5"><c r="C5"><v>1</v></c><c r="A5"><v>2</v></c></row><row r="2"><c r="B2"><v>3</v></c></row><row r="5"><c r="A5"><v>4</v></c><c r="D5"><v>5</v></c></row>`),
    "odd references and attributes": sheet(`<row r="1"><c r="$B$1"><v>1</v></c><c r="c1"><v>2</v></c><c r="D1" t='s'><v>1</v></c><c x:r="E1" t = "s" ><v>1</v></c><c r="F1"><f t="shared" ref="F1:F3" si="0">A1</f><v>9</v></c><c r=""><v>10</v></c><c r="&#72;1"><v>11</v></c><c r="&#32;"><v>12</v></c></row>`),
    "unclosed cell and row are skipped like v3": sheet(`<row r="1"><c r="A1"><v>1</v><c r="B1"><v>2</v></c></row><row r="2"><c r="A2"><v>3</v></c>`),
    "large and unusual numbers": sheet(`<row r="1"><c r="A1"><v>123456789012345678</v></c><c r="B1"><v>0.1</v></c><c r="C1"><v>-0</v></c><c r="D1"><v>1.5e308</v></c><c r="E1"><v>12abc</v></c><c r="F1"><v>.5</v></c><c r="XFD1"><v>7</v></c></row>`),
  };
  for (const [name, xml] of Object.entries(cases)) it(name, () => { same(xml); });

  it("keeps v3's Map order for unsorted files and the last value of duplicates", () => {
    const got = same(cases["unsorted and duplicated cells and rows"]);
    expect([...got.cells.keys()]).toEqual(["5,3", "5,1", "2,2", "5,4"]);
    expect(got.cells.get("5,1")!.v).toBe(4);
  });
  it("reads a big sheet in slices (run with a row budget) exactly as in one go", () => {
    let rows = ""; for (let r = 1; r <= 500; r++) rows += `<row r="${r}"><c r="A${r}" t="inlineStr"><is><t>n${r % 7}</t></is></c><c r="B${r}"><v>${r * 1.5}</v></c></row>`;
    const xml = sheet(rows), b = new TextEncoder().encode(xml), sd0 = xml.indexOf("<sheetData"), sd1 = xml.indexOf("</sheetData>");
    const sc = new SheetScanner(b, sd0, sd1, ctx, 15); let slices = 0; while (!sc.run(37)) slices++;
    expect(slices).toBeGreaterThan(10);
    const { cells, rows: R } = sc.finish();
    compare(cellsV3(xml, ctx, 15), new CellMap(cells, ctx), new RowMap(R), ctx);
    expect(cells.strs.length).toBe(7);                           // equal strings are kept once
  });
});
