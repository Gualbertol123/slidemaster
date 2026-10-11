/* Sheet slices (src/xlsx/slice.ts, PLAN S2.4): the page runs the pure code on slices of the sheets, so every saved
   corpus deck must give the same slides, layouts, effective items, Liquid Glass geometry, automated comments and
   table HTML from the slices as from the whole workbook – in all three designs and every version, with sheets sent
   whole and with every sheet cut to its rectangle (the rule for big sheets, forced here on the corpus). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkbook } from "../src/xlsx/workbook";
import { sliceBoxes, sliceShared, sliceSheet, hydrateShared, hydrateSheet } from "../src/xlsx/slice";
import { MirrorWorkbook } from "../src/xlsx/mirror";
import { applyOps, emptyDoc } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { tableHtml } from "../src/render/slide";
import { effItems } from "../src/render/edits";
import { glassGeom } from "../src/render/glass";
import { notesOf } from "../src/render/slide";
import type { RenderCtx } from "../src/render/context";
import type { Design, Op, RuntimeSlide } from "../src/model/types";
import type { Workbook } from "../src/xlsx/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const DECKS = path.join(here, "../../tests/corpus/decks"), BOOKS = path.join(here, "../../tests/corpus/workbooks");
const decks = fs.readdirSync(DECKS).filter(f => f.endsWith(".json")).sort();
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

function ctxOf(wb: Workbook, view: ReturnType<typeof emptyDoc>, design: Design, slides: RuntimeSlide[], version: string | null): RenderCtx {
  const st = resolveStyle({}, view.style), style = { ...st, design };
  return { style, edits: view.edits || {}, slides, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null,
    version: (view.preset?.versions || []).find(v => v.id === version) || null };
}
/** everything the page computes from a deck */
function picture(wb: Workbook, view: ReturnType<typeof emptyDoc>) {
  const out: unknown[] = [];
  for (const design of ["glass", "excel", "clean"] as Design[]) {
    const slides = runtimeSlides(wb, view.preset, "W.xlsx", design);
    for (const version of [null, ...(view.preset?.versions || []).map(v => v.id)]) {
      const ctx = ctxOf(wb, view, design, slides, version);
      for (const R of slides) {
        out.push({ design, version, id: R.id, title: R.title, subtitle: R.subtitle, missing: R.missing });
        R.tables.forEach((L, i) => {
          out.push({ g: L.g, rows: L.rows, cols: L.cols, W: L.W, H: L.H, errors: L.errors, hidden: [L.hiddenRows, L.hiddenCols], pics: L.pics.length, rects: L.rects.length });
          out.push(effItems(L, ctx).map(it => ({ ...it, L: undefined })));
          if (design === "glass") { const G = glassGeom(L, ctx); out.push({ W: G.W, key: G.key }); }
          out.push(tableHtml(R, i, ctx), tableHtml(R, i, ctx, true));
        });
        R.tables.forEach((_, i) => out.push(notesOf(R, i, ctx)));
      }
    }
  }
  return JSON.stringify(out);
}

describe("slices give the page the same deck", () => {
  for (const f of decks) for (const mode of ["whole", "rectangles"] as const) it(f + " · " + mode, async () => {
    const deck = JSON.parse(fs.readFileSync(path.join(DECKS, f), "utf8")) as { workbook: string; ops: Op[] };
    const wb = await readWorkbook(ab(path.join(BOOKS, deck.workbook)));
    const view = applyOps(emptyDoc("W.xlsx"), deck.ops).doc;
    const full = picture(wb, view);
    // what the worker sends: slices for the tables of the deck (one design is enough: rectangles do not depend on it)
    const layouts = runtimeSlides(wb, view.preset, "W.xlsx", "glass").flatMap(R => R.tables.map(L => ({ sheet: L.sheet, g: L.g })));
    const boxes = sliceBoxes(wb, layouts, view.edits as never, mode === "whole" ? Infinity : 0);
    if (mode === "rectangles") expect([...boxes.values()].every(b => b !== null)).toBe(true);
    const slices = [...boxes].map(([name, box]) => structuredClone(sliceSheet(wb.sheets.find(s => s.name === name)!, box)));
    const mirror = new MirrorWorkbook({ meta: wb.meta, skipped: wb.skipped, hiddenSheets: wb.hiddenSheets, extLinks: wb.extLinks, total: wb.total, ssSize: wb.ssSize, big: wb.big, book: 1 }, async () => ({ shared: null, sheets: [] }));
    mirror.receive(structuredClone(sliceShared(wb.shared!)), slices);
    expect(picture(mirror, view)).toBe(full);
  }, 120_000);

  it("a slice cut to a rectangle holds only its cells, and hydrates to the same cells there", async () => {
    const wb = await readWorkbook(ab(path.join(BOOKS, "deck20.xlsx"))), S = wb.sheets[0];
    const box = { r1: 4, c1: 2, r2: 21, c2: 18 }, s = sliceSheet(S, box), H = hydrateSheet(structuredClone(s), hydrateShared(sliceShared(wb.shared!)));
    for (const x of H.cells.values()) expect(x.r >= 4 && x.r <= 21 && x.c >= 2 && x.c <= 18).toBe(true);
    for (let r = 4; r <= 21; r++) for (let c = 2; c <= 18; c++) expect(JSON.stringify(H.get(r, c))).toBe(JSON.stringify(S.get(r, c)));
    expect(H.tables.map(T => T.g)).toEqual(S.tables.map(T => T.g));
    expect(H.rowPx(30)).toBe(S.rowPx(30));
  });
});

/* conditional formats whose operands lie outside the table: an absolute reference ($B$1) and a relative one (the
   cell to the left, column C): the rectangle must hold them, or the painted fills differ */
describe("slices hold the cells conditional formats read", () => {
  it("absolute and relative operands outside the table", async () => {
    const { makeZip } = await import("./zipbuild");
    const NS = `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
    const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    let rows = `<row r="1"><c r="A1" t="inlineStr"><is><t>limit</t></is></c><c r="B1"><v>50</v></c></row>`;
    for (let r = 3; r <= 9; r++) rows += `<row r="${r}"><c r="C${r}"><v>${r * 7 % 60}</v></c>` + ["D", "E", "F"].map((c, k) => `<c r="${c}${r}"><v>${(r * 13 + k * 29) % 90}</v></c>`).join("") + `</row>`;
    const buf = makeZip({
      "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      "xl/workbook.xml": `<workbook ${NS}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
      "xl/styles.xml": `<styleSheet ${NS}><fonts><font><sz val="11"/><name val="Calibri"/></font></fonts><fills><fill><patternFill patternType="none"/></fill></fills><borders><border/></borders><cellXfs><xf/></cellXfs><dxfs><dxf><fill><patternFill><bgColor rgb="FFFF0000"/></patternFill></fill></dxf><dxf><font><b/><color rgb="FF00AA00"/></font></dxf></dxfs></styleSheet>`,
      "xl/worksheets/sheet1.xml": `<worksheet ${NS}><sheetData>${rows}</sheetData>`
        + `<conditionalFormatting sqref="D4:F9"><cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>$B$1</formula></cfRule><cfRule type="expression" dxfId="1" priority="2"><formula>D4&lt;C4</formula></cfRule></conditionalFormatting></worksheet>`,
    });
    const wb = await readWorkbook(buf);
    const view = applyOps(emptyDoc("W.xlsx"), [{ op: "preset.set", preset: { sheets: ["S"], tables: [{ id: "t", sheet: "S", kind: "range", range: "D3:F9" }], slides: [{ id: "s", type: "content", title: null, subtitle: null, tables: ["t"], layout: null }] } } as Op]).doc;
    const full = picture(wb, view);
    expect(full).toContain("#FF0000");                            // the rules really paint something
    const layouts = runtimeSlides(wb, view.preset, "W.xlsx", "excel").flatMap(R => R.tables.map(L => ({ sheet: L.sheet, g: L.g })));
    const boxes = sliceBoxes(wb, layouts, {}, 0);
    expect(boxes.get("S")).toEqual({ r1: 1, c1: 2, r2: 10, c2: 7 });   // B1 and column C joined the table's rectangle
    const mirror = new MirrorWorkbook({ meta: wb.meta, skipped: [], hiddenSheets: [], extLinks: 0, total: 0, ssSize: 0, big: false, book: 1 }, async () => ({ shared: null, sheets: [] }));
    mirror.receive(sliceShared(wb.shared!), [...boxes].map(([n, b]) => structuredClone(sliceSheet(wb.sheets.find(s => s.name === n)!, b))));
    expect(picture(mirror, view)).toBe(full);
  });
});
