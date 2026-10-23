/* 4.13.1: a line's value label stays inside the plot (the owner's B54 slide: the Deposits card's axis typed 6,900–9,100,
   the W39 dip at 7,000 – B53's "auto" put its label below the point, over the plot's bottom edge and the category label
   "W39"). "Auto" takes the other side when its own would cross the plot's bottom or the room above the plot (the title,
   stats, card header) and the other fits, else the side with more room, held inside; a place the user chose is kept, held
   above the category labels; a dragged label's offset is added as set. PowerPoint gets the same place: the dLbl's
   dLblPos, and a manualLayout for a label held inside. On the owner's workbook app/tests/fixtures/B54.xlsx (Volumes:
   Deposits in rows 6–9 – Q3, W37, W38, W39). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import type { Node } from "../src/dl/types";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, emptyDoc } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { slideToDisplayList, type SlideDL } from "../src/render/slide-dl";
import { computeLayout } from "../src/render/layout";
import { seriesLayout, type SeriesLayout, type SeriesStyle } from "../src/render/chart-series";
import { chartXml } from "../src/pptx/chart";
import { writePptx } from "../src/pptx/writer";
import type { ChartSem } from "../src/pptx/chart-sem";
import type { SlideSem } from "../src/pptx/scene";
import { pptxFamily } from "../src/text/resolve";
import { wrapLines } from "../src/text/lines";
import type { RenderCtx } from "../src/render/context";
import type { ChartItem, Design, Op } from "../src/model/types";
import type { Cell, Sheet } from "../src/xlsx/types";
import { b54Ops } from "./b54-deck";

const here = path.dirname(fileURLToPath(import.meta.url));
const BOOK = path.join(here, "../../app/tests/fixtures/B54.xlsx");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const STY: SeriesStyle = { lab: { family: "Arial", size: 14, weight: 400, italic: false, color: "#000000" }, ttl: { family: "Arial", size: 18, weight: 700, italic: false, color: "#000000" },
  family: "Arial", colors: ["#111111", "#222222", "#333333"], legend: "square", ink: "#000000", gradient: false, radius: 0 };
const F = { x: 100, y: 100, w: 700, h: 500 };
const lh = (size: number) => Math.round(size * 1.25);
/** the Volumes sheet with other numbers in column C (row → value: a reload) */
function withVals(S: Sheet, vals: Record<number, number>): Sheet {
  const o = Object.create(S) as Sheet;
  o.get = (r: number, c: number) => { const x = S.get(r, c); return c === 3 && r in vals ? { ...(x as Cell), v: vals[r], t: "n" } as Cell : x; };
  return o;
}
/** the B54 slide, the Deposits card (cd) patched */
async function deck(design: Design, mut: (c: ChartItem) => void, vals: Record<number, number> = {}) {
  const wb = await readWorkbook(ab(BOOK));
  const ops: Op[] = b54Ops();
  mut((ops[6] as { patch: ChartItem }).patch);
  const { doc: view, skipped } = applyOps(emptyDoc("B54.xlsx"), ops);
  expect(skipped).toEqual([]);
  const style = resolveStyle({}, { ...view.style, design }), slides = runtimeSlides(wb, view.preset, "B54.xlsx", design);
  const own = (n: string) => wb.sheets.find(s => s.name === n) || null;
  const sheet = (n: string) => { const S = own(n); return n === "Volumes" && S ? withVals(S, vals) : S; };
  const ctx: RenderCtx = { style, edits: {}, slides, preset: view.preset || null, workbook: "B54.xlsx", logoSrc: "", sheet, version: null, forExport: true };
  const lists = slides.map((R, i) => slideToDisplayList(R, i, ctx, R.tables.map(L => excelToDisplayList(L, ctx, M)), computeLayout(R, ctx).boxes, { wall: null, logo: null }, M, "23 October 2026", { sem: true }));
  const cd = view.preset!.slides[0].items!.cd as unknown as ChartItem;
  const L = seriesLayout(cd, F, ctx, M, STY, "cd") as SeriesLayout;
  const info = lists[0].items.cd;
  if (info.pptx?.kind !== "chart") throw new Error("no chart");
  return { L, sem: info.pptx.chart as ChartSem, lists, cd, ctx };
}
const pptxOf = (lists: SlideDL[]) => writePptx({ slides: lists.map(l => ({ nodes: l.nodes, sem: { type: "content" as const, items: Object.fromEntries(Object.entries(l.items).flatMap(([id, it]) => it.pptx ? [[id, it.pptx]] : [])), palette: [] } as SlideSem })), image: () => PNG, face: css => pptxFamily(css) });
const dLbl = (xml: string, i: number) => new RegExp(`<c:dLbl><c:idx val="${i}"/>.*?</c:dLbl>`).exec(xml)?.[0] ?? null;
const sepY = (L: SeriesLayout) => { const s = L.card.find((n: Node) => n.t === "line"); return s && s.t === "line" ? s.y1 : null; };
const axis = (y: Record<string, unknown>) => (c: ChartItem) => { c.axes = { y: { num: "#,##0", ...y } } as ChartItem["axes"]; };
const lab = (L: SeriesLayout, s: number, i: number) => L.labs.find(l => l.s === s && l.i === i)!;

describe("4.13.1 · a line's label stays inside the plot", () => {
  it("floor: a dip on the axis's floor (W39 7,000 on 6,900–9,100) – its label above, not over the category labels; PowerPoint the series' place (no dLbl)", async () => {
    // (W38 at 7,100: the line comes in flat, nothing else in the way above)
    const { L, sem, lists } = await deck("excel", axis({ min: 6900, max: 9100 }), { 8: 7100 });
    const P = L.plot, p = L.traces[0].pts[3]!, l = lab(L, 0, 3);
        expect(l.top + lh(14)).toBeLessThanOrEqual(p.y);
    expect(l.top + lh(14)).toBeLessThanOrEqual(P.y + P.h);
    expect(L.labels[0]!.points.find(q => q.i === 3)).toBeUndefined();
    const s = sem.bars!.series[0].labels!;
    expect(s.pos).toBe("t");
    expect(s.points.find(q => q.i === 3)).toBeUndefined();
    const xml = strFromU8(unzipSync(await pptxOf(lists))["ppt/charts/chart2.xml"]);
    expect(dLbl(xml, 3)).toBeNull();
  });
  it("floor, the owner's picture (W38 9,000 → W39 7,000): above crosses its own steep line – the collision order goes on (below held → right); never below the plot", async () => {
    for (const d of ["excel", "glass", "navy"] as Design[]) {
      const { L, sem } = await deck(d, axis({ min: 6900, max: 9100 }));
      const l = lab(L, 0, 3);
      expect(l.top + lh(14), d).toBeLessThanOrEqual(L.plot.y + L.plot.h + .5);
      expect(sem.bars!.series[0].labels!.points.find(q => q.i === 3)?.pos, d).not.toBe("b");
    }
  });
  it("ceiling: a peak at the top of a typed max on the right axis (no room is made above for it) – its label below; PowerPoint dLblPos b", async () => {
    // the left series without labels; the right one's W38 and W39 at 9,000 = its max (W39: flat on its left, nothing in
    // the way below)
    const patch = (c: ChartItem) => {
      c.axes = { y: { num: "#,##0", min: 6900, max: 9100 }, y2: { num: "#,##0", min: 6900, max: 9000 } } as ChartItem["axes"];
      const vol = c.sers!.vol!;
      c.sers = { vol: { ...vol, labels: undefined }, v2: { ...vol, n: 2, name: "Right", axis: "y2", color: "#D93025" } } as ChartItem["sers"];
    };
    const { L, sem, lists } = await deck("excel", patch, { 9: 9000 });
    const top = sepY(L)!;    expect(top).not.toBeNull();
    const p = L.traces.find(t => t.s === 1)!.pts[3]!, l = lab(L, 1, 3);
    expect(p.y).toBeCloseTo(L.plot.y, 6);
    expect(l.top).toBeGreaterThan(p.y);
    expect(l.top + lh(14)).toBeLessThanOrEqual(L.plot.y + L.plot.h);
    // every label of it under the separator (the card's stats above it)
    for (const x of L.labs.filter(x => x.s === 1)) expect(x.top).toBeGreaterThanOrEqual(top);
    const pt = sem.bars!.series[1].labels!.points.find(q => q.i === 3)!;
    expect(pt.pos).toBe("b"); expect(pt.dy).toBeUndefined();
    const xml = strFromU8(unzipSync(await pptxOf(lists))["ppt/charts/chart2.xml"]);
    expect(dLbl(xml, 3)).toContain('<c:dLblPos val="b"/>');
    expect(dLbl(xml, 3)).not.toContain("manualLayout");
  });
  it("a peak under a typed or cell max on the left axis keeps its label above, inside the room made over the plot (no flip)", async () => {
    for (const y of [{ min: 6900, max: 9100 }, { min: 6900, max: 9000 }, { min: 6900, cells: { max: { sheet: "Volumes", range: "C8" } } }]) {
      const { L, sem } = await deck("excel", axis(y));
      const p = L.traces[0].pts[2]!, l = lab(L, 0, 2);
      expect(l.top + lh(14), JSON.stringify(y)).toBeLessThanOrEqual(p.y);
      expect(l.top).toBeGreaterThanOrEqual(sepY(L)! - .5);
      expect(sem.bars!.series[0].labels!.points.find(q => q.i === 2)).toBeUndefined();
    }
  });
  it("ceiling and clamp on a scatter chart (no line, no room made above): the peak at the max below; on a short chart, where neither side fits, below held inside the plot – PowerPoint dLblPos b moved up by a manualLayout", async () => {
    const scatter = (c: ChartItem) => {
      const vol = c.sers!.vol!;
      Object.assign(c, { type: "scatter", stats: undefined, moms: undefined, sep: undefined, tag: undefined, marks: undefined, title: "" });
      c.sers = { vol: { ...vol, line: undefined, xs: vol.vals } } as ChartItem["sers"];
      c.axes = { y: { num: "#,##0", min: 6900, max: 9000 } } as ChartItem["axes"];
    };
    const { cd, ctx, sem } = await deck("excel", scatter);
    const L = seriesLayout(cd, F, ctx, M, STY, "cd") as SeriesLayout, p = L.traces[0].pts[2]!, l = lab(L, 0, 2);
    expect(p.y).toBeCloseTo(L.plot.y, 6);
    expect(l.top).toBeGreaterThan(p.y);
    expect(L.labels[0]!.points.find(q => q.i === 2)).toEqual({ i: 2, pos: "b" });
    expect(sem.bars!.series[0].labels!.points.find(q => q.i === 2)).toEqual({ i: 2, pos: "b" });
    // a short chart: the plot 10 px high, the label 18 px – the side with more room (below: the point at the top), held
    const short = { x: 100, y: 100, w: 700, h: 40 };
    const S = seriesLayout(cd, short, ctx, M, STY, "cd") as SeriesLayout, P = S.plot, ls = lab(S, 0, 2), ps = S.traces[0].pts[2]!;
    expect(P.h).toBe(10);
    expect(ls.top + lh(14)).toBeCloseTo(P.y + P.h, 6);
    expect(ls.top).toBeGreaterThanOrEqual(short.y);
    const pt = S.labels[0]!.points.find(q => q.i === 2)!;
    expect(pt.pos).toBe("b");
    // (PowerPoint's below, under the point's marker: moved up by what the label was held, as a fraction of the frame)
    expect(ls.top).toBeLessThan(ps.y);
    expect(pt.dy).toBeLessThan(0);
    expect(ls.top - pt.dy! * short.h).toBeGreaterThan(ps.y);
    const xml = chartXml({ ...sem, bars: { ...sem.bars!, series: [{ ...sem.bars!.series[0], labels: S.labels[0]! }] } } as ChartSem, "rId1", css => pptxFamily(css));
    expect(dLbl(xml, 2)).toMatch(/<c:layout><c:manualLayout><c:x val="0"\/><c:y val="-0\.\d+"\/><\/c:manualLayout><\/c:layout>.*<c:dLblPos val="b"\/>/);
  });
  it("a place the user chose is kept (below), held above the category labels; PowerPoint dLblPos b with a manualLayout up", async () => {
    const { L, sem, lists } = await deck("excel", c => { axis({ min: 6900, max: 9100 })(c); c.sers!.vol!.points = { "3": { pos: "below" } } as never; }, { 8: 7100 });
    const P = L.plot, p = L.traces[0].pts[3]!, l = lab(L, 0, 3);
    expect(l.top + lh(14)).toBeCloseTo(P.y + P.h, 6);
    expect(l.top + lh(14)).toBeGreaterThan(p.y);
    const pt = sem.bars!.series[0].labels!.points.find(q => q.i === 3)!;
    expect(pt.pos).toBe("b");
    expect(pt.dy).toBeLessThan(0);
    const xml = strFromU8(unzipSync(await pptxOf(lists))["ppt/charts/chart2.xml"]);
    expect(dLbl(xml, 3)).toMatch(/<c:layout><c:manualLayout><c:x val="0"\/><c:y val="-0\.\d+"\/><\/c:manualLayout><\/c:layout>.*<c:dLblPos val="b"\/>/);
  });
  it("a dragged label: its offset added to its place exactly, never held (the user's)", async () => {
    const box = { w: 725, h: 520 };
    const a = await deck("excel", axis({ min: 6900, max: 9100 }), { 8: 7100 });
    const b = await deck("excel", c => { axis({ min: 6900, max: 9100 })(c); c.nudge = { "v:vol:3": { dx: 0, dy: .1 } } as never; }, { 8: 7100 });
    const La = seriesLayout(a.cd, F, a.ctx, M, STY, "cd", box) as SeriesLayout, Lb = seriesLayout(b.cd, F, b.ctx, M, STY, "cd", box) as SeriesLayout;
    const la = lab(La, 0, 3), lb = lab(Lb, 0, 3);
    expect(lb.top - la.top).toBeCloseTo(52, 6);
    // (52 px down: past the plot's bottom, where the user put it)
    expect(lb.top + lh(14)).toBeGreaterThan(Lb.plot.y + Lb.plot.h);
    expect(lb.x).toBe(la.x);
  });
});

