/* S14.P: the slide's items go through a per-kind dispatch (render/slide-dl.ts chartItem / shapeItem / lineItem), so M14
   and M15 never edit the same lines. Guards: an old chart without `sers` draws exactly as before whatever its `type`
   (09 §2.2: "Old charts (no sers): exactly as today"); a line item is kept and, until M15, draws nothing; a kind this
   page does not know is skipped. Same corpus deck and measurer as chart-dl.test.ts. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../src/dl/types";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, emptyDoc } from "../src/model/ops";
import { itemSheets, presetSheets, runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { slideToDisplayList } from "../src/render/slide-dl";
import { computeLayout } from "../src/render/layout";
import { DESIGNS } from "../src/model/designs";
import { wrapLines } from "../src/text/lines";
import type { RenderCtx } from "../src/render/context";
import type { ChartType, Design, Item, Op, Preset } from "../src/model/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const DECKS = path.join(here, "../../tests/corpus/decks"), BOOKS = path.join(here, "../../tests/corpus/workbooks");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const SLIDE = "u9t3fqb";
async function build(design: Design, items: Record<string, object>, raw?: Record<string, unknown>) {
  const d = JSON.parse(fs.readFileSync(path.join(DECKS, "report.json"), "utf8")) as { workbook: string; ops: Op[] };
  const wb = await readWorkbook(ab(path.join(BOOKS, d.workbook)));
  const ops = [...d.ops, ...Object.entries(items).map(([id, patch]) => ({ op: "item.patch", slide: SLIDE, id, patch }) as Op)];
  const { doc: view, skipped } = applyOps(emptyDoc("W.xlsx"), ops);
  expect(skipped).toEqual([]);
  // (an item of a later page's kind cannot come through ops: it is put into the preset as a snapshot would hold it)
  if (raw) Object.assign(view.preset!.slides.find(s => s.id === SLIDE)!.items ||= {}, raw);
  const style = resolveStyle({}, { ...view.style, design });
  const slides = runtimeSlides(wb, view.preset, "W.xlsx", design);
  const ctx: RenderCtx = { style, edits: view.edits || {}, slides, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null };
  const R = ctx.slides[0], boxes = computeLayout(R, ctx).boxes;
  return slideToDisplayList(R, 0, ctx, R.tables.map(L => excelToDisplayList(L, ctx, M)), boxes, { wall: null, logo: null }, M, "1 October 2026", { sem: true });
}
const chart = (type: ChartType, extra: object = {}) => ({ kind: "chart", type, values: { table: "dhnms9c", range: "D6:D11" }, show: ["label", "percent"], legend: "right", box: { x: 980, y: 250, w: 560, h: 420 }, ...extra });

describe("items by kind (S14.P dispatch)", () => {
  it("an old chart without sers draws exactly as a pie, whatever its type (09 §2.2), in every design and in the PowerPoint export", async () => {
    for (const design of DESIGNS) {
      const pie = await build(design, { c1: chart("pie") });
      for (const type of ["column", "bar", "line", "area", "scatter", "waterfall", "combo"] as ChartType[]) {
        const other = await build(design, { c1: chart(type) });
        expect(other.nodes, `${design} ${type}`).toEqual(pie.nodes);
        expect(other.items.c1.pptx, `${design} ${type}`).toEqual(pie.items.c1.pptx);
      }
    }
  });
  it("a line item is kept and (until M15) draws nothing: no nodes, no Issues line, an empty range; its PowerPoint member carries its heads", async () => {
    const line = { kind: "line", route: "straight", a: { x: 100, y: 800 }, b: { x: 500, y: 800 }, style: { color: "#1F3864", w: 2, heads: { b: "triangle" } }, box: { x: 99, y: 799, w: 402, h: 2 } };
    const none = await build("excel", {}), dl = await build("excel", { l1: line });
    expect(dl.nodes).toEqual(none.nodes);
    expect(validate(dl.nodes)).toEqual([]);
    const at = dl.items.l1.at;
    expect(dl.items.l1).toEqual({ box: line.box, issue: null, geom: null, at, pptx: { kind: "line", at, heads: { b: "triangle" } } });
    expect(at[0]).toBe(at[1]);
  });
  // (S14.P review, 7: the two plans agree – nothing drawn here, and the page's Issues panel says so: app/tests/item-text.test.ts)
  it("a kind this page does not know (a later page's) is skipped: no nodes, no item info; the other items draw", async () => {
    const shape = { kind: "shape", shape: "pill", text: "Note", box: { x: 1200, y: 760, w: 200, h: 60 } };
    const known = await build("glass", { k1: shape });
    const later = await build("glass", { k1: shape }, { z9: { kind: "sticker", box: { x: 10, y: 10, w: 50, h: 50 } } as unknown as Item });
    expect(later.nodes).toEqual(known.nodes);
    expect(Object.keys(later.items)).toEqual(["k1"]);
  });
});

describe("the sheets a deck's items read, per kind (S14.P review, 4: chartSheets for M14, shapeSheets / lineSheets for M15)", () => {
  it("a chart's values and labels, a callout's and a line's {Sheet!C7} tokens; a later page's kind none", () => {
    const box = { x: 0, y: 0, w: 9, h: 9 };
    const preset = { sheets: [], tables: [], slides: [{ id: "s", type: "content", tables: [], items: {
      c: { kind: "chart", type: "pie", values: { sheet: "Numbers", range: "B2:B4" }, labels: { table: "t1", range: "A2:A4" }, box },
      k: { kind: "shape", shape: "pill", text: "{'Q3 data'!C7} and {[Peers.xlsx]Peer!F7}", box },
      l: { kind: "line", route: "range", a: { x: 0, y: 1 }, b: { x: 9, y: 1 }, text: "{Targets!B3}", box },
      z: { kind: "sticker", text: "{Hidden!A1}", values: { sheet: "Nope", range: "A1" }, box } } }] } as unknown as Preset;
    expect(itemSheets(preset)).toEqual(["Numbers", "Q3 data", "[Peers.xlsx]Peer", "Targets"]);
    expect(presetSheets(preset)).toEqual(["Numbers", "Q3 data", "[Peers.xlsx]Peer", "Targets"]);
  });
});
