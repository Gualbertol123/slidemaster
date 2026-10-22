/* B53 (4.11; ADR-015 amendment of 2026-10-22): the owner's second picture of the target chart – the space a chart gives its
   plot, the places of every label (point values, reference lines, gap arrows, change pills, captions), labels dragged on
   the stage (`nudge`), a value axis's min / max / step from cells, and the 12000 bug (a reference line's value in General
   shown without the axis's format). On the corpus deck tests/corpus/charts/target-lines.json (workbook
   charts/target-lines.xlsx), in all five designs; the PowerPoint chart from the same layout (c:dLbl manualLayout, the
   axis's resolved c:min / c:max / c:majorUnit); the format guard (shared/ops-vectors.d/b53.json: format 8).
   CHART_PPTX_OUT=<folder> writes the PowerPoint files (pptxcheck runs on them). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { validate, type DisplayList, type HitNode, type LineNode, type Node, type RectNode, type TextNode } from "../src/dl/types";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, docNeedsV7, docNeedsV8, emptyDoc, knownOp, needsV7, needsV8 } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { slideToDisplayList, type ItemInfo, type SlideDL } from "../src/render/slide-dl";
import { computeLayout } from "../src/render/layout";
import { chartKey } from "../src/render/chart-dl";
import { legendAtOf } from "../src/render/chart-legend";
import { seriesLayout, type SeriesLayout, type SeriesStyle } from "../src/render/chart-series";
import { chartXml } from "../src/pptx/chart";
import { writePptx } from "../src/pptx/writer";
import type { ChartSem } from "../src/pptx/chart-sem";
import type { SlideSem } from "../src/pptx/scene";
import { pptxFamily } from "../src/text/resolve";
import { DESIGNS } from "../src/model/designs";
import { wrapLines } from "../src/text/lines";
import { loadVectors } from "./vectors";
import type { RenderCtx } from "../src/render/context";
import type { ChartItem, ChartMark, Design, Op } from "../src/model/types";
import type { Cell, Sheet } from "../src/xlsx/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const BOOKS = path.join(here, "../../tests/corpus/workbooks"), DECK = path.join(here, "../../tests/corpus/charts/target-lines.json");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const flat = (l: DisplayList): Node[] => l.flatMap(n => n.t === "group" ? [n, ...flat(n.children)] : [n]);
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const STY: SeriesStyle = { lab: { family: "Arial", size: 14, weight: 400, italic: false, color: "#000000" }, ttl: { family: "Arial", size: 18, weight: 700, italic: false, color: "#000000" },
  family: "Arial", colors: ["#111111", "#222222", "#333333"], legend: "square", ink: "#000000", gradient: false, radius: 0 };
/** a sheet whose cell (r, c) holds another number, or another format (a reload, a scenario's value: another sheet object) */
function withCell(S: Sheet, r: number, c: number, v: number, fmt?: string): Sheet {
  const o = Object.create(S) as Sheet;
  o.get = (rr: number, cc: number) => { const x = S.get(rr, cc); return rr === r && cc === c ? { ...(x as Cell), v, t: "n", ...(fmt ? { fmt } : {}) } as Cell : x; };
  return o;
}
type Patch = (it: Record<string, unknown>) => void;
/** the target-lines deck in a design, its first chart changed by `patch` */
async function deck(design: Design, opts: { sheet?: (n: string, S: Sheet | null) => Sheet | null; scenario?: string; patch?: Patch; forExport?: boolean } = {}) {
  const d = JSON.parse(fs.readFileSync(DECK, "utf8")) as { workbook: string; ops: Op[] };
  if (opts.patch) opts.patch((d.ops[1] as unknown as { patch: Record<string, unknown> }).patch);
  const wb = await readWorkbook(ab(path.join(BOOKS, d.workbook)));
  const { doc: view, skipped } = applyOps(emptyDoc("W.xlsx"), d.ops);
  expect(skipped).toEqual([]);
  const style = resolveStyle({}, { ...view.style, design }), slides = runtimeSlides(wb, view.preset, "W.xlsx", design);
  const own = (n: string) => wb.sheets.find(s => s.name === n) || null;
  const ctx: RenderCtx = { style, edits: {}, slides, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "", sheet: n => opts.sheet ? opts.sheet(n, own(n)) : own(n), version: null,
    forExport: opts.forExport ?? true, ...(opts.scenario ? { scenario: opts.scenario } : {}) };
  const lists = slides.map((R, i) => slideToDisplayList(R, i, ctx, R.tables.map(L => excelToDisplayList(L, ctx, M)), computeLayout(R, ctx).boxes, { wall: null, logo: null }, M, "1 October 2026", { sem: true }));
  const item = (id: string) => { const l = lists.find(x => x.items[id])!; return { list: l, info: l.items[id], nodes: l.nodes.slice(l.items[id].at[0], l.items[id].at[1]) }; };
  const it = (id: string) => view.preset!.slides.flatMap(s => Object.entries(s.items || {})).find(([k]) => k === id)![1] as ChartItem;
  return { wb, ctx, view, lists, item, it, own };
}
const semOf = (info: ItemInfo): ChartSem => { if (info.pptx?.kind !== "chart") throw new Error("no chart"); return info.pptx.chart; };
const pptxOf = (lists: SlideDL[]) => writePptx({ slides: lists.map(l => ({ nodes: l.nodes, sem: { type: "content" as const, items: Object.fromEntries(Object.entries(l.items).flatMap(([id, it]) => it.pptx ? [[id, it.pptx]] : [])), palette: [] } as SlideSem })), image: () => PNG, face: css => pptxFamily(css) });
const FRAME = { x: 120, y: 180, w: 1360, h: 640 };
const layoutOf = (it: ChartItem, ctx: RenderCtx, unit?: { w: number; h: number }) => { const L = seriesLayout(it, FRAME, ctx, M, STY, "tl", unit); if ("why" in L) throw new Error(L.why); return L as SeriesLayout; };
const textOf = (l: DisplayList, src: string) => flat(l).find((n): n is TextNode => n.t === "text" && n.src === src);
const textsOf = (l: DisplayList) => flat(l).filter((n): n is TextNode => n.t === "text").map(n => n.src);
const marks = (p: Record<string, unknown>) => p.marks as Record<string, ChartMark>;
const NEG = "−";
const tw = (t: string, size: number) => [...t].length * size * .5;
const lh = (size: number) => Math.round(size * 1.25);

describe("space: the plot takes what the labels present leave (B53 1)", () => {
  it("the right reserve is the measured width of the reference labels, through the card's padding – no fixed margin", async () => {
    const { ctx, it } = await deck("excel");
    // (the chart's box is the frame plus 6 px of padding on each side, as Excel's card)
    const L = layoutOf(it("tl"), ctx, { w: FRAME.w + 12, h: FRAME.h + 12 }), P = L.plot;
    // "EoM budget 11.790" and "Ambition 12.000": bold 14 px, the wider 17 chars → 119 px; after the plot's end + 6; the pad 6
    const right = FRAME.x + FRAME.w - (P.x + P.w);
    expect(right).toBeCloseTo(tw("EoM budget 11.790", 14) + 6 - 6, 1);
    // 4.10.1 left tw + 8 (and no padding): the plot is wider by 8 px here, 2 px without the pad
    const L0 = layoutOf(it("tl"), ctx);
    expect(FRAME.x + FRAME.w - (L0.plot.x + L0.plot.w)).toBeCloseTo(tw("EoM budget 11.790", 14) + 6, 1);
  });
  it("a gap arrow's room is measured on its own difference (−348), not on a sample as wide as the line's value", async () => {
    // the reference labels moved inside: only the gap's label reaches past the plot
    const { ctx, it } = await deck("excel", { patch: p => { marks(p).r1.pos = "left"; marks(p).r2.pos = "above"; } });
    const L = layoutOf(it("tl"), ctx), P = L.plot, slot = P.w / 4;
    const big = tw(NEG + "348", 20), cap = tw("gap to budget", 11);
    const ext = Math.max(12, Math.min(36, slot * .25)) + 6 + Math.max(big, cap) + 6;
    // (the last point at the last slot's centre; the 4 px right-axis gap when nothing reaches further)
    expect(FRAME.x + FRAME.w - (P.x + P.w)).toBeCloseTo(Math.max(4, ext - slot / 2), 0);
    const label = textOf(L.marks.nodes, NEG + "348")!;
    expect(label.x + tw(NEG + "348", 20)).toBeLessThanOrEqual(FRAME.x + FRAME.w + .01);
  });
  it("the plot area of the picture grows against 4.10.1 (its numbers pinned)", async () => {
    const { ctx, it } = await deck("excel");
    const L = layoutOf(it("tl"), ctx, { w: FRAME.w + 12, h: FRAME.h + 12 });
    // 4.10.1 (c504829) laid this chart's plot out 1360 − 66 (axis) − 127 (EoM budget 11.790 + 8) wide
    const before = 1360 - (L.plot.x - FRAME.x) - (tw("EoM budget 11.790", 14) + 8);
    expect(L.plot.w).toBeGreaterThan(before);
  });
  it("one series with targets: no legend unless one is asked for; a second series, or a legend asked for, has one", async () => {
    const one = (await deck("excel", { patch: p => { delete p.legendAt; } })).it("tl");
    expect(legendAtOf(one)).toBe("none");
    expect(legendAtOf({ ...one, legendAt: "bottom" })).toBe("bottom"); expect(legendAtOf({ ...one, legend: "right" })).toBe("none");
    expect(legendAtOf({ ...one, marks: {} })).toBe("bottom");
    expect(legendAtOf({ ...one, sers: { ...one.sers, b: { n: 2, vals: one.sers!.vol.vals } } })).toBe("bottom");
  });
  it("a value label above the highest point stays inside the frame: the plot's top comes down by what it lacks", async () => {
    const { ctx, it } = await deck("excel", { patch: p => { (p.axes as Record<string, Record<string, unknown>>).y.max = 11600; delete marks(p).r1; delete marks(p).r2; delete marks(p).xg; } });
    const L = layoutOf(it("tl"), ctx);
    const top = L.labs.reduce((a, l) => Math.min(a, l.top), Infinity);
    expect(top).toBeGreaterThanOrEqual(FRAME.y - .01);
  });
});

describe("the 12000 bug: a reference line's value in its axis's format (B53 2)", () => {
  it("a value cell in General, no name: the label is the value alone, as the axis shows numbers (12.000)", async () => {
    const general = (n: string, S: Sheet | null) => n === "Targets" && S ? withCell(S, 3, 3, 12000, "General") : S;
    const { ctx, it } = await deck("excel", { sheet: general, patch: p => { delete marks(p).r2.name; } });
    const L = layoutOf(it("tl"), ctx), r2 = L.refs.find(r => r.id === "r2")!;
    expect([r2.text, r2.label?.text]).toEqual(["12.000", "12.000"]);
    // the name back: "Ambition 12.000"
    const named = await deck("excel", { sheet: general });
    expect(layoutOf(named.it("tl"), named.ctx).refs.find(r => r.id === "r2")!.label?.text).toBe("Ambition 12.000");
  });
  it("a typed value takes the axis's format; an axis without its own takes the series' cells' (#,##0); the mark's own wins", async () => {
    const { ctx, it } = await deck("excel", { patch: p => { marks(p).r2 = { kind: "ref", value: 12000 } as ChartMark; } });
    expect(layoutOf(it("tl"), ctx).refs.find(r => r.id === "r2")!.label?.text).toBe("12.000");
    const b = await deck("excel", { patch: p => { marks(p).r2 = { kind: "ref", value: 12000 } as ChartMark; delete (p.axes as Record<string, Record<string, unknown>>).y.num; } });
    expect(layoutOf(b.it("tl"), b.ctx).refs.find(r => r.id === "r2")!.label?.text).toBe("12.000");
    const c = await deck("excel", { patch: p => { marks(p).r2 = { kind: "ref", value: 12000, num: "0" } as ChartMark; } });
    expect(layoutOf(c.it("tl"), c.ctx).refs.find(r => r.id === "r2")!.label?.text).toBe("12000");
  });
  it("a cell with a format of its own keeps it (#,##0.0 → 11.790,0)", async () => {
    const fmt = (n: string, S: Sheet | null) => n === "Targets" && S ? withCell(S, 3, 2, 11790, "#,##0.0") : S;
    const { ctx, it } = await deck("excel", { sheet: fmt });
    expect(layoutOf(it("tl"), ctx).refs.find(r => r.id === "r1")!.text).toBe("11.790,0");
  });
});

describe("label places (B53 3), in every design", () => {
  for (const design of DESIGNS) it(`${design}: reference labels right / inside / left / above / below, the gap's side and direction, pills' rows, captions`, async () => {
    const { ctx, it, item, lists } = await deck(design, { patch: p => {
      marks(p).r1.pos = "below"; marks(p).r2.pos = "inside";
      Object.assign(marks(p).xg, { labelSide: "left", from: "point", capPos: "above" });
      Object.assign(marks(p).wc, { pos: "point", capPos: "right" });
    } });
    const nodes = item("tl").nodes;
    expect(validate(nodes, design)).toEqual([]);
    // PowerPoint: the same places, no picture, no connector shape
    const z = unzipSync(pptxOf(lists)), slide = strFromU8(z["ppt/slides/slide1.xml"]);
    expect(slide).not.toContain("<p:pic>"); expect(slide).not.toContain("<p:cxnSp");
    if (process.env.CHART_PPTX_OUT) { fs.mkdirSync(process.env.CHART_PPTX_OUT, { recursive: true }); fs.writeFileSync(path.join(process.env.CHART_PPTX_OUT, `b53-places-${design}.pptx`), pptxOf(lists)); }
    const L = layoutOf(it("tl"), ctx), R1 = L.refs.find(r => r.id === "r1")!, R2 = L.refs.find(r => r.id === "r2")!;
    // below: under the line's right end; inside: on the line inside the plot, the ground behind it
    const b = textOf(L.marks.nodes, R1.label!.text)!, i = textOf(L.marks.nodes, R2.label!.text)!;
    expect(b.y).toBeGreaterThan(R1.y); expect(b.x + (b as TextNode & { w: number }).w).toBeLessThanOrEqual(R1.x2);
    expect(i.x + (i as TextNode & { w: number }).w).toBeLessThanOrEqual(R2.x2); expect(i.y).toBeGreaterThan(R2.y - 14); expect(i.y).toBeLessThan(R2.y + 14);
    const ground = L.marks.nodes.find((n): n is RectNode => n.t === "rect" && !n.r && n.y <= R2.y && n.y + n.h >= R2.y);
    expect(ground).toBeTruthy();
    // nothing on the right: the plot reaches the frame but for the right axis's 4 px gap and the gap label's overhang
    expect(L.plot.x + L.plot.w).toBeGreaterThan(FRAME.x + FRAME.w - 60);
    // the gap: from the point to the line (end a at the point, the head at the line), its label left of the arrow, the caption over it
    const A = L.marks.arrows[0], last = L.traces[0].pts[3]!;
    expect(A.a.y).toBeCloseTo(last.y, 1); expect(A.b.y).toBe(R1.y);
    const g = textOf(L.marks.nodes, NEG + "348")!, cap = textOf(L.marks.nodes, "gap to budget")!;
    expect(g.x + (g as TextNode & { w: number }).w).toBeLessThanOrEqual(A.a.x); expect(cap.y).toBeLessThan(g.y);
    // pills under each later point; the caption above the row's right end
    const pills = L.marks.nodes.filter((n): n is RectNode => n.t === "rect" && !!n.r && n.r === n.h / 2);
    expect(pills.length).toBe(3);
    pills.forEach((r, k) => { const B = L.traces[0].pts[k + 1]!; expect(r.x + r.w / 2).toBeCloseTo(B.x, 1); expect(r.y).toBeGreaterThan(B.y); });
    const wc = textOf(L.marks.nodes, "Week-on-week change")!;
    expect(wc.x + (wc as TextNode & { w: number }).w).toBeCloseTo(Math.max(...pills.map(r => r.x + r.w)), 0);
  });
  it("pills above (a row along the plot's top) and below (a row under the category labels: the plot leaves room for it)", async () => {
    const above = await deck("excel", { patch: p => { marks(p).wc.pos = "above"; } });
    const La = layoutOf(above.it("tl"), above.ctx), ra = La.marks.nodes.filter((n): n is RectNode => n.t === "rect" && !!n.r);
    for (const r of ra) expect(r.y).toBeCloseTo(La.plot.y + 2, 1);
    const below = await deck("excel", { patch: p => { marks(p).wc.pos = "below"; } });
    const Lb = layoutOf(below.it("tl"), below.ctx), rb = Lb.marks.nodes.filter((n): n is RectNode => n.t === "rect" && !!n.r);
    const catBottom = Lb.plot.y + Lb.plot.h + 4 + lh(14);
    for (const r of rb) { expect(r.y).toBeGreaterThanOrEqual(catBottom); expect(r.y + r.h).toBeLessThanOrEqual(FRAME.y + FRAME.h + .01); }
    expect(Lb.plot.h).toBeLessThan(La.plot.h);
  });
  it("point values: auto puts a dip's label below and the others above; a point's own place wins; PowerPoint gets the series' place and each point that differs", async () => {
    const { ctx, it, item } = await deck("excel", { patch: p => {
      const s = (p.sers as Record<string, Record<string, unknown>>).vol;
      s.labels = { show: ["value"], pos: "auto" }; s.points = { "0": { pos: "left" } };
    } });
    const L = layoutOf(it("tl"), ctx), pts = L.traces[0].pts;
    const at = (i: number) => L.labs.find(l => l.i === i)!;
    expect(at(0).x).toBeLessThan(pts[0]!.x); expect(at(0).align).toBe("right");   // Q3: its own place, left
    expect(at(1).top).toBeGreaterThan(pts[1]!.y);                      // Week 37 (the dip) below
    expect(at(2).top + lh(14)).toBeLessThanOrEqual(pts[2]!.y);         // Week 38 above
    expect(at(3).top + lh(14)).toBeLessThanOrEqual(pts[3]!.y);         // Week 39 above
    const lab = semOf(item("tl").info).bars!.series[0].labels!;
    expect(lab.pos).toBe("t");
    expect(lab.points.filter(p => p.pos).map(p => [p.i, p.pos])).toEqual([[0, "l"], [1, "b"]]);
  });
  it("a bar's own place: below = inside base, centre", async () => {
    const { ctx, it } = await deck("excel", { patch: p => { const s = (p.sers as Record<string, Record<string, unknown>>).vol; p.type = "column"; s.labels = { show: ["value"] }; s.points = { "0": { pos: "below" }, "1": { pos: "center" } }; } });
    const L = layoutOf(it("tl"), ctx), sem = L.labels[0]!;
    expect(sem.points.filter(p => p.pos).map(p => [p.i, p.pos])).toEqual([[0, "inBase"], [1, "ctr"]]);
  });
});

describe("labels dragged on the stage (B53 3: nudge)", () => {
  const nudge = { title: { dx: .05, dy: .01 }, "v:vol:1": { dx: 0, dy: .05 }, "r:r1": { dx: -.1, dy: -.02 }, "g:xg": { dx: .01, dy: .1 }, "c:wc:3": { dx: 0, dy: -.05 }, "c:wc:cap": { dx: .02, dy: 0 } };
  it("each label moves by its offset (fractions of the chart's box) from where the layout puts it, and follows the data", async () => {
    const box = { w: 1360, h: 640 };
    const a = await deck("excel"), b = await deck("excel", { patch: p => { p.nudge = nudge; } });
    const La = layoutOf(a.it("tl"), a.ctx, box), Lb = layoutOf(b.it("tl"), b.ctx, box);
    expect(Lb.plot).toEqual(La.plot);
    const moved = (src: string) => { const x = textOf(La.marks.nodes, src)!, y = textOf(Lb.marks.nodes, src)!; return [Math.round((y.x - x.x) * 100) / 100, Math.round((y.y - x.y) * 100) / 100]; };
    expect(moved("EoM budget 11.790")).toEqual([-136, -12.8]);
    expect(moved(NEG + "348")[0]).toBeCloseTo(13.6, 1); expect(moved(NEG + "348")[1]).toBe(64); expect(moved("gap to budget")[0]).toBeCloseTo(13.6, 1);
    expect(moved("+26 (+0,2%)")).toEqual([0, -32]); expect(moved("Week-on-week change")).toEqual([27.2, 0]);
    const l1a = La.labs.find(l => l.i === 1)!, l1b = Lb.labs.find(l => l.i === 1)!;
    expect([l1b.x - l1a.x, l1b.top - l1a.top]).toEqual([0, 32]);
    expect(Lb.titleBox!.x - La.titleBox!.x).toBeCloseTo(68, 5);
    // the data changes (a reload: Week 37 → 11,700): the label stays 32 px under its point's place
    const up = (n: string, S: Sheet | null) => n === "Weekly" && S ? withCell(S, 5, 4, 11700, "#,##0") : S;
    const c = await deck("excel", { sheet: up, patch: p => { p.nudge = nudge; } }), d = await deck("excel", { sheet: up });
    const Lc = layoutOf(c.it("tl"), c.ctx, box), Ld = layoutOf(d.it("tl"), d.ctx, box);
    expect(Lc.labs.find(l => l.i === 1)!.top - Ld.labs.find(l => l.i === 1)!.top).toBeCloseTo(32, 6);
    expect(Lc.labs.find(l => l.i === 1)!.top).not.toBe(l1b.top);
  });
  it("on screen each label has a hit to drag (\"label\", <item>|<key>); an export's list has none", async () => {
    const s = await deck("excel", { forExport: false }), e = await deck("excel");
    const hits = (l: DisplayList) => flat(l).filter((n): n is HitNode => n.t === "hit" && n.kind === "label").map(n => n.id);
    const ids = hits(s.item("tl").nodes);
    for (const k of ["tl|title", "tl|v:vol:0", "tl|v:vol:3", "tl|r:r1", "tl|r:r2", "tl|g:xg", "tl|c:wc:1", "tl|c:wc:cap"]) expect(ids).toContain(k);
    expect(hits(e.item("tl").nodes)).toEqual([]);
  });
  it("PowerPoint: a dragged point label is the series' c:dLbl with a manualLayout (its offset as a fraction of the chart space); the overlay's labels and the title stand where the slide draws them", async () => {
    const { item, lists } = await deck("excel", { patch: p => { p.nudge = nudge; } });
    const sem = semOf(item("tl").info), pt = sem.bars!.series[0].labels!.points.find(p => p.i === 1)!;
    expect(pt.dy).toBeCloseTo(.05 * 640 / sem.box.h, 3);
    const xml = chartXml(sem, "rId1", css => pptxFamily(css));
    expect(xml).toMatch(/<c:dLbl><c:idx val="1"\/><c:layout><c:manualLayout><c:x val="0"\/><c:y val="0\.0\d+"\/><\/c:manualLayout><\/c:layout>/);
    const z = unzipSync(pptxOf(lists)), slide = strFromU8(z["ppt/slides/slide1.xml"]);
    expect(slide).toContain("EoM budget 11.790"); expect(slide).not.toContain("<p:pic>");
    const out = process.env.CHART_PPTX_OUT;
    if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, "b53-labels.pptx"), pptxOf(lists)); }
  });
});

describe("axis scale from cells (B53 4)", () => {
  const cells = (p: Record<string, unknown>) => { (p.axes as Record<string, Record<string, unknown>>).y = { num: "#,##0", cells: { min: { sheet: "Weekly", range: "D5" }, max: { sheet: "Targets", range: "C3" }, step: { sheet: "Targets", range: "D3" } } }; };
  const step = (v: number) => (n: string, S: Sheet | null) => n === "Targets" && S ? withCell(S, 3, 4, v) : S;
  it("min, max and step from cells; a reload or a scenario's value moves them; the chart's key follows the cells", async () => {
    const a = await deck("excel", { sheet: step(100), patch: cells });
    const S = layoutOf(a.it("tl"), a.ctx).scale;
    expect([S.min, S.max, S.step]).toEqual([11411, 12000, 100]);
    const b = await deck("excel", { sheet: (n, X) => n === "Targets" && X ? withCell(withCell(X, 3, 4, 50), 3, 3, 12100) : X, patch: cells, scenario: "Ambition 12.100" });
    const T = layoutOf(b.it("tl"), b.ctx).scale;
    expect([T.min, T.max, T.step]).toEqual([11411, 12100, 50]);
    expect(chartKey(a.it("tl"), a.ctx)).not.toBe(chartKey(b.it("tl"), b.ctx));
    // PowerPoint: the resolved values
    const xml = chartXml(semOf(b.item("tl").info), "rId1", css => pptxFamily(css));
    expect(xml).toContain('<c:max val="12100"/>'); expect(xml).toContain('<c:min val="11411"/>'); expect(xml).toContain('<c:majorUnit val="50"/>');
  });
  it("a cell without a number leaves the typed setting (else automatic) and says so in Issues", async () => {
    const { ctx, it } = await deck("excel", { patch: p => { cells(p); (p.axes as Record<string, Record<string, unknown>>).y.step = 200; } });
    const L = layoutOf(it("tl"), ctx);
    expect(L.scale.step).toBe(200);
    expect(L.issue).toContain("the value axis's major unit: no positive number in Targets!D3");
  });
});

describe("the format guard (B53: format 8) and the vectors", () => {
  it("B53's keys and places need format 8 (not 7); removing them does not; knownOp knows them", () => {
    const ip = (patch: Record<string, unknown>): Op => ({ op: "item.patch", slide: "t0", id: "c", patch } as Op);
    const yes = [ip({ nudge: { title: { dx: 0, dy: .1 } } }), ip({ axes: { y: { cells: { min: { sheet: "S", range: "A1" } } } } }),
      ip({ sers: { s: { n: 1, vals: [], labels: { show: ["value"], pos: "auto" } } } }), ip({ sers: { s: { n: 1, vals: [], points: { "0": { pos: "below" } } } } }),
      ip({ marks: { r: { kind: "ref", value: 1, pos: "inside" } } }), ip({ marks: { g: { kind: "gap", ref: "r", from: "point" } } }), ip({ marks: { p: { kind: "change", pos: "point" } } }),
      ip({ marks: { p: { kind: "change", capPos: "right" } } }), ip({ marks: { g: { kind: "gap", ref: "r", labelSide: "left" } } })];
    for (const o of yes) { expect(needsV8(o), JSON.stringify(o)).toBe(true); expect(knownOp(o), JSON.stringify(o)).toBe(true); }
    const no = [ip({ nudge: null }), ip({ nudge: { title: null } }), ip({ marks: { r: { kind: "ref", value: 1, pos: "above" } } }), ip({ sers: { s: { n: 1, vals: [], labels: { show: ["value"], pos: "above" } } } }),
      ip({ axes: { y: { min: 1, max: 2, step: 1 } } }), ip({ marks: { p: { kind: "change", pos: "line" } } })];
    for (const o of no) expect(needsV8(o), JSON.stringify(o)).toBe(false);
    // (a 4.10 mark alone is format 7, not 8)
    expect(needsV7(no[2])).toBe(true);
    const doc = applyOps(emptyDoc("W.xlsx"), [{ op: "preset.set", preset: { sheets: [], tables: [], slides: [{ id: "t0", type: "content", title: "", tables: [] }] } } as Op,
      ip({ kind: "chart", type: "line", values: { sheet: "S", range: "A1:A2" }, box: { x: 0, y: 0, w: 100, h: 100 }, nudge: { title: { dx: 0, dy: .1 } } })]).doc;
    expect(docNeedsV8(doc)).toBe(true); expect(docNeedsV7(doc)).toBe(false);
    expect(needsV8(<Op><unknown>{ op: "slide.add", slide: { id: "x", type: "content", tables: [], items: { c: { kind: "chart", type: "line", nudge: { title: { dx: 0, dy: 0 } } } } } } as Op)).toBe(true);
  });
  for (const v of loadVectors().filter(x => /^B53 /.test(x.name))) it(v.name + ": knownOp, needsV7 / needsV8, docNeedsV7 / docNeedsV8", () => {
    expect(v.ops.map((o: Op) => knownOp(o))).toEqual(v.expect.knownOp);
    expect(v.ops.map((o: Op) => [needsV7(o), needsV8(o)])).toEqual(v.ops.map((_: Op, k: number) => [v.expect.needsV7[k], v.expect.needsV8[k]]));
    expect([docNeedsV7(v.expect), docNeedsV8(v.expect)]).toEqual([v.expect.docNeedsV7, v.expect.docNeedsV8]);
  });
});
