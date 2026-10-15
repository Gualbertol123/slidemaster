/* The native .xlsb reader (PLAN S6.1, B10) against the .xlsx reader: every corpus workbook was saved by Excel both as
   .xlsb and as .xlsx from the same open workbook (tests/corpus/workbooks/xlsb/, tools/make-xlsb-twins.ps1), and the
   two must read the same cell by cell – values, types, formats, styles, rows, columns, merges, conditional formats,
   drawings, sheet titles and table regions. The record reader, the formulas and torn files are tested on crafted
   records. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkbook } from "../src/xlsx/workbook";
import { evalCF } from "../src/xlsx/layout";
import { makeZip } from "./zipbuild";
import { Records } from "../src/xlsx/xlsb/records";
import { readCfFormula } from "../src/xlsx/xlsb/formula";
import { sliceBoxes, sliceShared, sliceSheet } from "../src/xlsx/slice";
import { MirrorWorkbook } from "../src/xlsx/mirror";
import { applyOps, emptyDoc } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { glassToDisplayList } from "../src/render/glass-dl";
import { effItems } from "../src/render/edits";
import { glassGeom } from "../src/render/glass";
import { notesOf } from "../src/render/layout";
import type { RenderCtx } from "../src/render/context";
import type { Design, Op } from "../src/model/types";
import type { Cell, Shared, Sheet, Workbook } from "../src/xlsx/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const TWINS = path.join(here, "../../tests/corpus/workbooks/xlsb");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const twins = fs.readdirSync(TWINS).filter(f => /\.xlsb$/i.test(f)).sort();
const twinOf = (f: string) => fs.readdirSync(TWINS).find(x => /\.xls[xm]$/i.test(x) && x.replace(/\.\w+$/, "") === f.replace(/\.\w+$/, ""))!;

/** a cell as data, its format by index in the workbook's cell formats */
const plain = (x: Cell | null | undefined, ctx: Shared) => x && { r: x.r, c: x.c, v: x.v, t: x.t, xf: ctx.xfs.indexOf(x.xf), fmt: x.fmt, scr: x.scr, keys: Object.keys(x).join() };
const dxfIx = (S: Sheet, d: unknown) => S.ctx.dxfs.indexOf(d as never);
function sheetData(S: Sheet) {
  const cells = [...S.cells.values()].map(c => plain(c, S.ctx));
  return {
    name: S.name, error: S.error, cells, rows: [...S.rowInfo.entries()], colRanges: S.colRanges, merges: S.merges,
    // the XML reader also takes the x14 extension copy of a rule (<x14:conditionalFormatting>, its ranges in an
    // element, not an attribute) as a rule without ranges, which never applies; the binary reader skips them
    cf: S.cfRules.filter(r => r.ranges.length).map(r => ({ ...r, dxf: dxfIx(S, r.dxf) })), unsupportedCF: [...S.unsupportedCF].sort(),
    defColW: S.defColW, defRowH: S.defRowH, zeroH: S.zeroH, drawing: S.drawing, title: S.title, subtitle: S.subtitle,
    tables: S.tables.map(L => ({ g: L.g, rows: L.rows, cols: L.cols, W: L.W, H: L.H, items: L.items.length, errors: L.errors })),
  };
}
function bookData(wb: Workbook) {
  const sh = wb.shared!;
  return {
    sheets: wb.meta.map(m => m.name), skipped: wb.skipped, hidden: wb.hiddenSheets, extLinks: wb.extLinks,
    sst: sh.sst, sstRuns: sh.sstRuns, xfs: sh.xfs, dxfs: sh.dxfs, defaultFont: sh.defaultFont, theme: sh.theme, mdw: sh.mdw,
  };
}

describe("xlsb twins: read the same as Excel's own .xlsx of the same workbook", () => {
  it("has a twin for every corpus workbook but big30, and edge-xlsb (made by Excel itself)", () => {
    const corpus = fs.readdirSync(path.join(TWINS, "..")).filter(f => /\.xls[xm]$/i.test(f) && !/^big30\./.test(f)).map(f => f.replace(/\.\w+$/, ""));
    expect(twins.map(f => f.replace(/\.xlsb$/, ""))).toEqual([...corpus, "edge-xlsb"].sort());
  });
  for (const f of twins) it(f, async () => {
    const bin = await readWorkbook(ab(path.join(TWINS, f))), xml = await readWorkbook(ab(path.join(TWINS, twinOf(f))));
    expect(bin.meta.every(m => /\.bin$/.test(m.path))).toBe(true);
    expect(bookData(bin)).toEqual(bookData(xml));
    expect(bin.sheets.length).toBe(xml.sheets.length);
    bin.sheets.forEach((S, k) => {
      const a = sheetData(S), b = sheetData(xml.sheets[k]);
      expect(a.cells.length).toBe(b.cells.length);
      a.cells.forEach((c, n) => { if (JSON.stringify(c) !== JSON.stringify(b.cells[n])) expect({ n, cell: c }).toEqual({ n, cell: b.cells[n] }); });
      expect(a).toEqual(b);
      // lookups and styles through the facade
      for (const c of S.cells.values()) { expect(plain(S.get(c.r, c.c), S.ctx)).toEqual(plain(xml.sheets[k].get(c.r, c.c), xml.sheets[k].ctx)); expect(S.ctx.xfs.indexOf(S.xfAt(c.r, c.c))).toBe(xml.sheets[k].ctx.xfs.indexOf(xml.sheets[k].xfAt(c.r, c.c))); }
      for (let c = 1; c <= 30; c++) expect(S.colPx(c)).toBe(xml.sheets[k].colPx(c));
      for (let r = 1; r <= 60; r++) expect([S.rowPx(r), S.rowHidden(r)]).toEqual([xml.sheets[k].rowPx(r), xml.sheets[k].rowHidden(r)]);
    });
  });
});

/* ---- the decks drawn from the .xlsb: the same slides, items and display lists as from the .xlsx ---- */
const DECKS = path.join(here, "../../tests/corpus/decks");
const decks = fs.readdirSync(DECKS).filter(f => f.endsWith(".json")).sort();
/** advances of 0.5 em per character; a wrapped text is one line (as slice.test.ts) */
const M: Metrics = { run: (t, font) => { const size = parseFloat(font.split("px")[0].split(" ").pop()!); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; }, lines: t => [t] };
/** what the page computes from a deck in every design and version: slides, layouts, effective items, Liquid Glass
    geometry, the tables' display lists (with and without text) and the notes */
function picture(wb: Workbook, view: ReturnType<typeof emptyDoc>) {
  const out: unknown[] = [];
  for (const design of ["glass", "excel", "clean"] as Design[]) {
    const slides = runtimeSlides(wb, view.preset, "W.xlsx", design);
    for (const version of [null, ...(view.preset?.versions || []).map(v => v.id)]) {
      const ctx: RenderCtx = { style: { ...resolveStyle({}, view.style), design }, edits: view.edits || {}, slides, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "",
        sheet: n => wb.sheets.find(s => s.name === n) || null, version: (view.preset?.versions || []).find(v => v.id === version) || null };
      for (const R of slides) {
        out.push({ design, version, id: R.id, title: R.title, subtitle: R.subtitle, missing: R.missing });
        R.tables.forEach((L, i) => {
          out.push({ g: L.g, rows: L.rows, cols: L.cols, W: L.W, H: L.H, errors: L.errors, hidden: [L.hiddenRows, L.hiddenCols], pics: L.pics, rects: L.rects, texts: L.texts });
          out.push(effItems(L, ctx).map(it => ({ ...it, L: undefined })));
          if (design === "glass") { const G = glassGeom(L, ctx); out.push({ W: G.W, key: G.key }); }
          for (const noText of [false, true]) out.push(design === "glass" ? glassToDisplayList(L, ctx, { x: 0, y: 0, scale: 1 }, null, M, { noText }) : excelToDisplayList(L, ctx, M, { noText }));
          out.push(notesOf(R, i, ctx));
        });
      }
    }
  }
  return JSON.stringify(out);
}

describe("xlsb twins: every corpus deck draws the same", () => {
  for (const f of decks) it(f, async () => {
    const deck = JSON.parse(fs.readFileSync(path.join(DECKS, f), "utf8")) as { workbook: string; ops: Op[] };
    const base = deck.workbook.replace(/\.\w+$/, "");
    const bin = await readWorkbook(ab(path.join(TWINS, base + ".xlsb"))), xml = await readWorkbook(ab(path.join(TWINS, twinOf(base + ".xlsb"))));
    const view = applyOps(emptyDoc("W.xlsx"), deck.ops).doc;
    const p = picture(bin, view);
    expect(p.length).toBeGreaterThan(1000);
    expect(p).toBe(picture(xml, view));
    // and through the page: the worker's slices of the binary workbook, cut to the tables' rectangles
    const layouts = runtimeSlides(bin, view.preset, "W.xlsx", "glass").flatMap(R => R.tables.map(L => ({ sheet: L.sheet, g: L.g })));
    const boxes = sliceBoxes(bin, layouts, view.edits as never, 0);
    const mirror = new MirrorWorkbook({ meta: bin.meta, skipped: bin.skipped, hiddenSheets: bin.hiddenSheets, extLinks: bin.extLinks, total: bin.total, ssSize: bin.ssSize, big: bin.big, book: 1 }, async () => { /* nothing to read */ });
    mirror.receive(structuredClone(sliceShared(bin.shared!)), [...boxes].map(([name, box]) => structuredClone(sliceSheet(bin.sheets.find(s => s.name === name)!, box))));
    expect(picture(mirror, view)).toBe(p);
  }, 120_000);
});

/** one record: type (1–2 bytes) and size (1–4 bytes), 7 bits each */
function rec(type: number, data: number[]): number[] {
  const t = type < 128 ? [type] : [(type & 0x7f) | 0x80, type >> 7];
  const s: number[] = []; let n = data.length; do { s.push((n & 0x7f) | (n > 0x7f ? 0x80 : 0)); n >>= 7; } while (n);
  return [...t, ...s, ...data];
}
const u16 = (x: number) => [x & 255, (x >> 8) & 255], u32 = (x: number) => [x & 255, (x >> 8) & 255, (x >> 16) & 255, (x >>> 24) & 255];
const f64 = (x: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, x, true); return [...b]; };
const wstr = (s: string) => [...u32(s.length), ...[...s].flatMap(ch => u16(ch.charCodeAt(0)))];

describe("records", () => {
  it("reads 1- and 2-byte types and sizes of 1 to 3 bytes; a record cut off ends the part", () => {
    const big = new Array(20000).fill(7);
    const r = new Records(new Uint8Array([...rec(0, [1, 2]), ...rec(463, []), ...rec(5, big), ...rec(9, [1, 2, 3]).slice(0, 4)]));
    expect(r.rec()).toBe(true); expect([r.type, r.left]).toEqual([0, 2]);
    expect(r.rec()).toBe(true); expect([r.type, r.left]).toEqual([463, 0]);
    expect(r.rec()).toBe(true); expect([r.type, r.left]).toEqual([5, 20000]);
    expect(r.rec()).toBe(false); expect(r.rec()).toBe(false);
  });
  it("RK numbers: integers, doubles' high bits, both divided by 100", () => {
    const rk = (x: number) => { const r = new Records(new Uint8Array(rec(2, u32(x)))); r.rec(); return r.rk(); };
    expect(rk((42 << 2) | 2)).toBe(42);
    expect(rk((-7 << 2) | 2)).toBe(-7);
    expect(rk((1234 << 2) | 3)).toBe(12.34);
    expect(rk(0x3ff00000)).toBe(1);                                   // 1.0: high 32 bits 0x3FF00000
    expect(rk(0x3ff00000 | 1)).toBe(0.01);
  });
  it("a value past its record is an error, not a read into the next record", () => {
    const r = new Records(new Uint8Array([...rec(6, [1, 0, 0, 0]), ...rec(6, [0x41, 0])]));
    r.rec(); r.u16();
    expect(() => r.u32()).toThrow(/shorter/);
    r.rec(); expect(() => r.wstr()).toThrow();
  });
});

describe("conditional-format formulas", () => {
  const formula = (rgce: number[], base = { r: 6, c: 11 }) => {
    const r = new Records(new Uint8Array(rec(463, [...u32(rgce.length), ...rgce, ...u32(0)]))); r.rec();
    return readCfFormula(r, base);
  };
  it("references relative to the rule's first cell, absolute parts with $", () => {
    expect(formula([0x4c, ...u32(0), ...u16(0x800a), 0x1e, ...u16(0), 0x09])).toBe("$K6<0");               // as Excel writes $K6<0
    expect(formula([0x4c, ...u32(2), ...u16(0xc000 | 0x3fff), 0x17, ...u16(5), ...[..."check"].flatMap(c => u16(c.charCodeAt(0))), 0x0b])).toBe('J8="check"');
    expect(formula([0x24, ...u32(9), ...u16(1), 0x1f, ...f64(1.5), 0x0d])).toBe("$B$10>1.5");
    expect(formula([0x2d, ...u32(0), ...u32(4), ...u16(0xc000), ...u16(0xc001), 0x19, 0x10, 0, 0])).toBe("SUM(K6:L10)");
  });
  it("functions, operators, strings with quotes; unknown tokens give no formula", () => {
    expect(formula([0x17, ...u16(3), ...[...'a"b'].flatMap(c => u16(c.charCodeAt(0))), 0x1e, ...u16(2), 0x15, 0x13, 0x08])).toBe('"a""b"&-(2)');
    expect(formula([0x4c, ...u32(0), ...u16(0xc000), 0x41, ...u16(129), 0x41, ...u16(38)])).toBe("NOT(ISBLANK(K6))");
    expect(formula([0x23, ...u32(1)])).toBeNull();                       // a defined name
    expect(formula([0x41, ...u16(9999)])).toBeNull();
    expect(formula([0x09])).toBeNull();                                 // an operator without operands
  });
});

describe("crafted workbooks", () => {
  const color = (r: number, g: number, b: number) => [0x05, 0xff, 0, 0, r, g, b, 0xff];
  /** an .xlsb with one cell format, one differential format (a fill) and the given sheet records */
  const book = (sheet: number[]) => makeZip({
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.bin"/></Relationships>',
    "xl/_rels/workbook.bin.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.bin"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.bin"/></Relationships>',
    "xl/workbook.bin": new Uint8Array(rec(156, [...u32(0), ...u32(1), ...wstr("rId1"), ...wstr("S")])),
    "xl/styles.bin": new Uint8Array([...rec(617, u32(1)), ...rec(47, new Array(16).fill(0)), ...rec(618, []),
      ...rec(505, u32(1)), ...rec(507, [0, 0x80, 0, 0, ...u16(1), ...u16(1), ...u16(12), ...color(255, 0, 0)]), ...rec(506, [])]),
    "xl/worksheets/sheet1.bin": new Uint8Array(sheet),
  });
  const row = (r: number) => rec(0, [...u32(r), ...u32(0), ...u16(300), 0, 0, 0, ...u32(0)]);
  const fmtInfo = (base: number) => rec(485, [...u32(0xffffffff), ...u16(base), ...u16(300), ...u16(0), 0, 0]);

  it("short cells (BrtShort*) follow the row's previous cell", async () => {
    const wb = await readWorkbook(book([...rec(145, []), ...row(0), ...rec(5, [...u32(1), ...u32(0), ...f64(5)]),
      ...rec(16, [...u32(0), ...f64(7)]), ...rec(13, [...u32(0), ...u32((2 << 2) | 2)]), ...rec(17, [...u32(0), ...wstr("t")]),
      ...row(1), ...rec(12, u32(0)), ...rec(146, [])]));
    const S = wb.sheets[0];
    expect([1, 2, 3, 4].map(c => S.get(1, c)?.v ?? null)).toEqual([null, 5, 7, 2]);
    expect(S.get(1, 5)?.v).toBe("t");
    expect(S.get(2, 1)?.t).toBe("blank");                             // a short cell first in its row is in column A
  });
  it("a conditional format whose formula cannot be shown never matches (not even 'not equal')", async () => {
    const rule = (param: number, rgce: number[]) => rec(463, [...u32(1), ...u32(0), ...u32(0), ...u32(1), ...u32(param), ...u32(0), ...u32(0), ...u16(0),
      ...u32(rgce.length + 8), ...u32(0), ...u32(0), ...u32(0xffffffff), ...u32(rgce.length), ...rgce, ...u32(0)]);
    const cf = (rgce: number[], param: number) => [...rec(461, [...u32(1), ...u32(0), ...u32(1), ...u32(0), ...u32(0), ...u32(0), ...u32(3)]), ...rule(param, rgce), ...rec(464, []), ...rec(462, [])];
    const sheet = (rgce: number[], param: number) => [...rec(145, []), ...row(0), ...rec(5, [...u32(1), ...u32(0), ...f64(5)]), ...rec(146, []), ...cf(rgce, param)];
    const name = [0x23, ...u32(1)];                                      // a defined name: not shown
    const S = (await readWorkbook(book(sheet(name, 4)))).sheets[0];
    expect(S.cfRules[0]).toMatchObject({ type: "cellIs", op: "notEqual", formulas: ["#NAME?"] });
    expect(evalCF(S, 1, 2)).toBeNull();
    // the same rule with a number it can show matches
    const T = (await readWorkbook(book(sheet([0x1e, ...u16(4)], 4)))).sheets[0];
    expect(evalCF(T, 1, 2)).toEqual({ fill: "#FF0000" });
  });
  it("the default column width: as the .xlsx reader, a base width alone is not used; a record cut short loses only itself", async () => {
    const S = (await readWorkbook(book([...fmtInfo(10), ...rec(145, []), ...row(0), ...rec(5, [...u32(0), ...u32(0), 1, 2]),
      ...rec(5, [...u32(1), ...u32(0), ...f64(3)]), ...rec(146, [])]))).sheets[0];
    expect(S.defColW).toBe(8.43);
    expect(S.error).toBeUndefined();
    expect(S.get(1, 2)?.v).toBe(3);
  });
});
