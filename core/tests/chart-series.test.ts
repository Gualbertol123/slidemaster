/* Columns and bars (S14.2; docs/next/09 §2.2, §3.1, §3.2, §4.2): CT-01 (column / bar, clustered, stacked, 100 %, in all
   five designs: DL snapshots), CT-02 (Excel's automatic axis bounds and unit), LG-01 (legend positions, one entry
   hidden, all hidden), the per-series resolver (chart-data.ts: another slide's table, another sheet, a linked workbook;
   hidden rows, a version's removed cells), chartKey and the node cache (a scenario's overlay is another key), and the
   native PowerPoint c:barChart made from the same layout (bounds, gap / overlap, manualLayout = the drawn plot, caches =
   the cells, the embedded workbook, no external formula). Same corpus deck and measurer as chart-dl.test.ts. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { validate, type DisplayList, type HitNode, type Node, type RectNode, type TextNode } from "../src/dl/types";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, emptyDoc } from "../src/model/ops";
import { itemSheets, runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { slideToDisplayList } from "../src/render/slide-dl";
import { computeLayout } from "../src/render/layout";
import { cachedChartNodes, chartKey, chartNodes, chartSem } from "../src/render/chart-dl";
import { seriesData } from "../src/render/chart-data";
import { autoScale, ticks } from "../src/render/chart-axes";
import { barSlots, stackBars } from "../src/render/chart-bars";
import { seriesLayout } from "../src/render/chart-series";
import { glassVars } from "../src/render/glass-dl";
import { chartWorkbook, chartXml } from "../src/pptx/chart";
import { writePptx } from "../src/pptx/writer";
import type { SlideSem } from "../src/pptx/scene";
import { pptxFamily } from "../src/text/resolve";
import { DESIGNS } from "../src/model/designs";
import { wrapLines } from "../src/text/lines";
import type { RenderCtx } from "../src/render/context";
import type { ChartItem, Design, LegendAt, Op } from "../src/model/types";
import type { Sheet } from "../src/xlsx/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const DECKS = path.join(here, "../../tests/corpus/decks"), BOOKS = path.join(here, "../../tests/corpus/workbooks");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const flat = (l: DisplayList): Node[] => l.flatMap(n => n.t === "group" ? [n, ...flat(n.children)] : [n]);
const r1 = (v: number) => Math.round(v * 10) / 10;
const summary = (l: DisplayList): unknown[] => l.map(n => {
  switch (n.t) {
    case "path": return ["path", n.d.length, JSON.stringify(n.fill)];
    case "text": return ["text", n.src, r1(n.x), r1(n.y), n.size, n.weight, n.css, JSON.stringify(n.fill)];
    case "rect": return ["rect", r1(n.x), r1(n.y), r1(n.w), r1(n.h), JSON.stringify(n.r ?? 0), JSON.stringify(n.fill ?? null), n.stroke ? JSON.stringify(n.stroke) : ""];
    case "line": return ["line", r1(n.x1), r1(n.y1), r1(n.x2), r1(n.y2), JSON.stringify(n.stroke)];
    case "hit": return ["hit", n.kind, n.id, r1(n.x), r1(n.y), r1(n.w), r1(n.h)];
    case "group": return ["group", n.clip ? "clip" : "", summary(n.children)];
    case "shadow": return ["shadow", n.dy, n.blur, n.a];
    case "image": return ["image", n.id];
  }
});

/* the corpus's report deck: SLIDE_3 pair's second table (62de08x, regions R1–R9 × Q1–Q3, negatives among them) on
   slide 2, charted on slide 1; SLIDE_1's Loans / Deposits (row 9 hidden) */
const Q = (c: string) => ({ table: "62de08x", range: `${c}5:${c}13` });
const COLS: ChartItem = { kind: "chart", type: "column", values: Q("I"), box: { x: 900, y: 200, w: 640, h: 460 },
  sers: { q1: { n: 1, vals: [Q("I")] }, q2: { n: 2, vals: [Q("J")] }, q3: { n: 3, vals: [Q("K")] } } };
const LOANS: ChartItem = { kind: "chart", type: "bar", values: { sheet: "SLIDE_1", range: "D6:D11" }, box: { x: 900, y: 200, w: 640, h: 460 },
  sers: { l: { n: 1, vals: [{ sheet: "SLIDE_1", range: "D6:D11" }], labels: { show: ["value"] } }, d: { n: 2, vals: [{ sheet: "SLIDE_1", range: "F6:F11" }] } } };
async function setup(design: Design, items: Record<string, ChartItem> = {}) {
  const d = JSON.parse(fs.readFileSync(path.join(DECKS, "report.json"), "utf8")) as { workbook: string; ops: Op[] };
  const wb = await readWorkbook(ab(path.join(BOOKS, d.workbook)));
  const ops = [...d.ops, ...Object.entries(items).map(([id, patch]) => ({ op: "item.patch", slide: "u9t3fqb", id, patch }) as Op)];
  const { doc: view, skipped } = applyOps(emptyDoc("W.xlsx"), ops);
  expect(skipped).toEqual([]);
  const style = resolveStyle({}, { ...view.style, design });
  const slides = runtimeSlides(wb, view.preset, "W.xlsx", design);
  const ctx: RenderCtx = { style, edits: view.edits || {}, slides, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null };
  const build = (c = ctx, sem = false) => {
    const R = c.slides[0], boxes = computeLayout(R, c).boxes;
    return slideToDisplayList(R, 0, c, R.tables.map(L => excelToDisplayList(L, c, M)), boxes, { wall: null, logo: null }, M, "1 October 2026", sem ? { sem: true } : undefined);
  };
  return { wb, ctx, view, build };
}
const env = (ctx: RenderCtx) => ({ V: glassVars(ctx), wall: null, family: "Arial" });
const nodes = (it: ChartItem, ctx: RenderCtx) => chartNodes(it, "c", it.box, ctx, M, env(ctx));
const bars = (l: DisplayList) => flat(l).filter((n): n is RectNode => n.t === "rect" && !n.stroke && flat(l).some(h => h.t === "hit" && h.kind === "point" && Math.abs(h.x - n.x) < .02 && Math.abs(h.y - n.y) < .02));
const texts = (l: DisplayList) => flat(l).filter((n): n is TextNode => n.t === "text").map(t => t.src);

describe("the value axis: Excel's automatic bounds and major unit (CT-02)", () => {
  // Excel's own axes for these values (its rule: 0 when the spread is over 1/6 of the maximum, else min − spread / 2;
  // max + spread / 20; both rounded outwards to the smallest 1-2-5 unit giving at most 10 intervals)
  const EXCEL: [string, number[], { min: number; max: number; step: number }][] = [
    ["1…10", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { min: 0, max: 12, step: 2 }],
    ["10…50", [10, 20, 30, 40, 50], { min: 0, max: 60, step: 10 }],
    ["10…100", [10, 25, 50, 75, 100], { min: 0, max: 120, step: 20 }],
    ["the reference chart's weekly volumes", [11576, 11258, 11258, 11324], { min: 11000, max: 11600, step: 100 }],
    ["all negative", [-30, -20, -5], { min: -35, max: 0, step: 5 }],
    ["both signs (SLIDE_3's regions)", [-101.25, 221.25], { min: -150, max: 250, step: 50 }],
    ["fractions", [.0123, .1599], { min: 0, max: .18, step: .02 }],
    ["one value", [7], { min: 0, max: 7, step: 1 }],
    ["all zero", [0, 0], { min: 0, max: 1, step: .1 }],
  ];
  for (const [name, vals, want] of EXCEL) it(name, () => expect(autoScale(Math.min(...vals), Math.max(...vals))).toEqual(want));
  it("100 %: 0 to 100 % by tenths; an axis's own min / max / step win; a short plot gets fewer ticks", () => {
    expect(autoScale(0, 1, { percent: true })).toEqual({ min: 0, max: 1, step: .1 });
    expect(autoScale(11258, 11576, { axis: { min: 11000, max: 11700, step: 100 } })).toEqual({ min: 11000, max: 11700, step: 100 });
    expect(autoScale(11258, 11576, { axis: { min: 11200 } })).toEqual({ min: 11200, max: 11600, step: 50 });
    expect(autoScale(1, 10, { maxN: 4 })).toEqual({ min: 0, max: 15, step: 5 });
    expect(ticks({ min: 0, max: 1, step: .1 })).toEqual([0, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1]);
  });
});

describe("bars: gap and overlap as Excel, stacks, 100 %", () => {
  it("a slot holds w·(n − (n − 1)·overlap) + gap·w; stacked bars are one bar per category", () => {
    const one = barSlots(1, 150, 0);
    expect(one.w).toBeCloseTo(.4, 9); expect(one.off(0)).toBeCloseTo(.3, 9);
    const three = barSlots(3, 150, 0);
    expect(three.w).toBeCloseTo(1 / 4.5, 9); expect(three.off(2) + three.w + three.off(0)).toBeCloseTo(1, 9);
    const over = barSlots(2, 50, 50);
    expect(over.w * (2 - .5) + .5 * over.w).toBeCloseTo(1, 9);
  });
  it("stacked: positives up and negatives down from 0, the outermost of each side rounded; 100 %: shares of the category", () => {
    const st = stackBars([[10, -5, null], [20, -5, 4]], "stacked");
    expect(st.segs.map(g => [g.s, g.i, g.from, g.to, g.outer])).toEqual([[0, 0, 0, 10, false], [1, 0, 10, 30, true], [0, 1, 0, -5, false], [1, 1, -5, -10, true], [1, 2, 0, 4, true]]);
    expect([st.lo, st.hi]).toEqual([-10, 30]);
    const pc = stackBars([[1, 3], [3, 1]], "percent");
    expect(pc.segs.map(g => g.to)).toEqual([.25, 1, .75, 1]);
    expect(stackBars([[1, null, -2]], "none").segs.map(g => [g.from, g.to])).toEqual([[0, 1], [0, -2]]);
  });
});

describe("the series resolver (chart-data.ts): every series from its own cells", () => {
  it("another slide's table: categories from the headers on the left, names from the header above, a value per category", async () => {
    const { ctx } = await setup("excel");
    const d = seriesData(COLS, ctx);
    if (!d.ok) throw new Error(d.why);
    expect(d.cats).toEqual(["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9"]);
    expect(d.series.map(s => s.name)).toEqual(["Q1", "Q2", "Q3"]);
    expect(d.series[0].vals.slice(0, 3)).toEqual([-101.25, -63.75, -26.25]);
    expect(d.issues).toEqual([]);
  });
  it("hidden rows are left out (values and categories); a version's removed cell is a gap; text cells are gaps", async () => {
    const { ctx } = await setup("excel");
    const d = seriesData(LOANS, ctx);
    if (!d.ok) throw new Error(d.why);
    expect(d.cats).toEqual(["Alpha", "Beta", "Gamma", "Epsilon", "Zeta"]);            // row 9 (Delta) is hidden
    const cut = seriesData(LOANS, { ...ctx, version: { id: "v", name: "V", hide: { SLIDE_1: ["D7"] } } });
    expect(cut.ok && cut.series[0].vals[1]).toBeNull();
    expect(cut.ok && cut.cats[1]).toBe("Beta");
    const txt = seriesData({ ...LOANS, sers: { t: { n: 1, vals: [{ sheet: "SLIDE_1", range: "J6:J8" }] }, l: { n: 2, vals: [{ sheet: "SLIDE_1", range: "D6:D8" }] } } }, ctx);
    expect(txt.ok && txt.series[0].vals).toEqual([null, null, null]);
  });
  it("two sheets and a linked workbook in one chart, a group from another table; lengths that differ are named", async () => {
    const { ctx, wb } = await setup("excel");
    const S = wb.sheets.find(s => s.name === "SLIDE_1")!, plan = Object.create(S) as Sheet;
    Object.defineProperty(plan, "name", { value: "[Budget.xlsx]Plan" });
    const c2: RenderCtx = { ...ctx, sheet: n => n === "[Budget.xlsx]Plan" ? plan : ctx.sheet!(n) };
    const it: ChartItem = { ...COLS, groups: { g: { n: 1, cats: { table: "62de08x", range: "H5:H7" } } },
      sers: { a: { n: 1, name: "Regions", vals: [{ table: "62de08x", range: "I5:I7" }] }, b: { n: 2, vals: [{ sheet: "[Budget.xlsx]Plan", range: "D6:D7" }, { sheet: "Numbers", range: "B4" }] },
        c: { n: 3, name: { sheet: "SLIDE_1", range: "F4" }, vals: [{ sheet: "SLIDE_1", range: "F6:F10" }] } } };
    const d = seriesData(it, c2);
    if (!d.ok) throw new Error(d.why);
    expect(d.cats).toEqual(["R1", "R2", "R3"]);
    expect(d.series[1].vals).toEqual([1234567.891, 2469135.782, 1.5]);
    expect(d.series[2].name).toBe("Deposits");
    expect(d.issues).toEqual(["'Deposits' has 4 values for 3 categories"]);
    // the sheets the deck must read for it (the helper loads them): the linked workbook's too
    const preset = { sheets: [], tables: [], slides: [{ id: "s", type: "content", tables: [], items: { x: it } }] } as never;
    expect(itemSheets(preset)).toEqual(["[Budget.xlsx]Plan", "Numbers", "SLIDE_1"]);
  });
  it("missing everywhere: missing; no number anywhere: empty", async () => {
    const { ctx } = await setup("excel");
    expect(seriesData({ ...COLS, sers: { a: { n: 1, vals: [{ sheet: "Gone", range: "A1:A3" }] } } }, ctx)).toMatchObject({ ok: false, why: "missing", source: "Gone!A1:A3" });
    expect(seriesData({ ...COLS, sers: { a: { n: 1, vals: [{ sheet: "SLIDE_1", range: "J6:J8" }] } } }, ctx)).toMatchObject({ ok: false, why: "empty" });
  });
});

describe("columns and bars on the slide, in every design (CT-01)", () => {
  const KINDS: [string, ChartItem][] = [
    ["clustered columns", { ...COLS, legendAt: "bottom", sers: { ...COLS.sers!, q1: { ...COLS.sers!.q1, labels: { show: ["value"] } } } }],
    ["stacked columns", { ...COLS, stack: "stacked", legendAt: "right" }],
    ["100 % columns", { ...COLS, stack: "percent", legendAt: "top", sers: { ...COLS.sers!, q3: { ...COLS.sers!.q3, labels: { show: ["percent"] } } } }],
    ["clustered bars", { ...LOANS, legendAt: "inside-tr" }],
  ];
  for (const design of DESIGNS) it(`${design}: valid nodes, a point hit per bar, the axes, the legend – snapshots`, async () => {
    const { ctx } = await setup(design);
    for (const [name, it] of KINDS) {
      const out = nodes(it, ctx);
      expect(validate(out.nodes), name).toEqual([]);
      expect(out.issue, name).toBeNull();
      const L = seriesLayout(it, { x: 0, y: 0, w: 600, h: 400 }, ctx, M, { lab: { family: "Arial", size: 14, weight: 400, italic: false, color: "#000000" }, ttl: { family: "Arial", size: 18, weight: 700, italic: false, color: "#000000" }, family: "Arial", colors: ["#111111"], legend: "square", ink: "#000000", gradient: false, radius: 0 });
      if ("why" in L) throw new Error(L.why);
      const hits = flat(out.nodes).filter((n): n is HitNode => n.t === "hit" && n.kind === "point");
      expect(hits.length, name).toBe(L.bars.length);
      expect(hits[0].id, name).toMatch(/^c:(q1|l):0$/);
      expect(summary(out.nodes)).toMatchSnapshot(name);
    }
  });
  it("clustered: three bars side by side per category, negatives below the zero line; stacked: one column of segments", async () => {
    const { ctx } = await setup("excel");
    const c = bars(nodes(COLS, ctx).nodes);
    expect(c).toHaveLength(27);
    // R1's three bars: equal widths, left to right, all negative – they hang from the axis line
    const [a, b, d] = c.slice(0, 3);                                                 // (drawn category by category)
    expect(a.w).toBeCloseTo(b.w, 6); expect(b.x).toBeGreaterThan(a.x); expect(d.x).toBeGreaterThan(b.x);
    const zero = flat(nodes(COLS, ctx).nodes).find(n => n.t === "line" && n.y1 === n.y2 && n.stroke.paint && JSON.stringify(n.stroke.paint) === JSON.stringify({ solid: [191, 191, 191] }));
    expect(zero && zero.t === "line" && Math.abs(a.y - zero.y1)).toBeLessThan(.02);
    const s = bars(nodes({ ...COLS, stack: "stacked" }, ctx).nodes);
    expect(new Set(s.slice(9, 12).map(r => r.x.toFixed(2))).size).toBe(1);   // R4's segments: one column
  });
  it("Liquid Glass: the gradient and a 4 px radius on the outer end only; Excel flat and square", async () => {
    const { ctx } = await setup("glass");
    const st = bars(nodes({ ...COLS, stack: "stacked" }, ctx).nodes);
    expect(st.every(r => "linear" in r.fill!)).toBe(true);
    expect(st.filter(r => r.r).length).toBeGreaterThan(0);
    expect(st.filter(r => r.r).every(r => Array.isArray(r.r) && (r.r as number[]).filter(v => v > 0).length === 2)).toBe(true);
    const { ctx: x } = await setup("excel");
    expect(bars(nodes(COLS, x).nodes).every(r => !r.r && "solid" in r.fill!)).toBe(true);
  });
  it("labels: the cells' texts outside the end; white inside a dark bar; a point's own text, null hides one; an axis's own bounds clip", async () => {
    const { ctx } = await setup("excel");
    const it: ChartItem = { ...LOANS, sers: { l: { n: 1, vals: LOANS.sers!.l.vals, color: "#051C2C", labels: { show: ["value"], pos: "inEnd" }, points: { "1": { label: "Top" }, "2": { label: null } } } } };
    const out = flat(nodes(it, ctx).nodes).filter((n): n is TextNode => n.t === "text");
    expect(out.some(t => t.src === "Top")).toBe(true);
    // five bars: four labels (one hidden), white inside the dark bars; none for the hidden point
    const white = out.filter(t => JSON.stringify(t.fill) === JSON.stringify({ solid: [255, 255, 255] }));
    expect(white).toHaveLength(4);
    expect(white.map(t => t.src)).toContain("Top");
    // fixed bounds: a bar beyond the axis's max ends at the plot's edge
    const L = seriesLayout({ ...COLS, axes: { y: { min: 0, max: 50, step: 10 } } }, { x: 0, y: 0, w: 600, h: 400 }, ctx, M, { lab: { family: "Arial", size: 14, weight: 400, italic: false, color: "#000" }, ttl: { family: "Arial", size: 18, weight: 700, italic: false, color: "#000" }, family: "Arial", colors: ["#111111"], legend: "square", ink: "#000", gradient: false, radius: 0 });
    if ("why" in L) throw new Error(L.why);
    expect(L.ticks.map(t => t.v)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(Math.min(...L.bars.map(b => b.y))).toBeGreaterThanOrEqual(L.plot.y - 1e-9);
  });
});

describe("the legend (LG-01): positions, one entry hidden, all hidden", () => {
  const POS: LegendAt[] = ["right", "left", "top", "bottom", "top-right", "inside-tl", "inside-tr", "none"];
  it("each position puts the entries there and gives the plot the rest; inside draws a card over the plot", async () => {
    const { ctx } = await setup("excel");
    const st = { lab: { family: "Arial", size: 14, weight: 400, italic: false, color: "#000" }, ttl: { family: "Arial", size: 18, weight: 700, italic: false, color: "#000" }, family: "Arial", colors: ["#111111", "#222222", "#333333"], legend: "square" as const, ink: "#000", gradient: false, radius: 0 };
    const F = { x: 0, y: 0, w: 600, h: 400 }, at: Record<string, { box: unknown; plot: { x: number; y: number; w: number; h: number } }> = {};
    for (const p of POS) {
      const L = seriesLayout({ ...COLS, legendAt: p }, F, ctx, M, st);
      if ("why" in L) throw new Error(L.why);
      at[p] = { box: L.legend.box, plot: L.plot };
    }
    const none = at.none.plot, b = (p: string) => at[p].box as { x: number; y: number; w: number; h: number };
    expect(at.none.box).toBeNull();
    expect(b("right").x).toBeGreaterThan(at.right.plot.x + at.right.plot.w);
    expect(b("left").x + b("left").w).toBeLessThan(at.left.plot.x);
    expect(b("top").y + b("top").h).toBeLessThan(at.top.plot.y);
    expect(b("bottom").y).toBeGreaterThan(at.bottom.plot.y + at.bottom.plot.h);
    expect(b("top-right").y).toBe(0);
    expect(at["inside-tr"].plot).toEqual(none);
    expect(at["inside-tl"].plot).toEqual(none);
    expect(b("inside-tl").x).toBeLessThan(b("inside-tr").x);
    for (const p of ["right", "left", "top", "bottom", "top-right"]) expect(at[p].plot.w * at[p].plot.h, p).toBeLessThan(none.w * none.h);
  });
  it("legendHide: the entry out of the legend, its series still drawn; every entry hidden: no legend; the old key when legendAt is unset", async () => {
    const { ctx } = await setup("excel");
    const all = texts(nodes(COLS, ctx).nodes), one = texts(nodes({ ...COLS, legendHide: { q2: true } }, ctx).nodes);
    expect(all.filter(t => t === "Q2")).toHaveLength(1);
    expect(one.filter(t => t === "Q2")).toHaveLength(0);
    expect(bars(nodes({ ...COLS, legendHide: { q2: true } }, ctx).nodes)).toHaveLength(27);
    const allHidden = seriesLayout({ ...COLS, legendHide: { q1: true, q2: true, q3: true } }, { x: 0, y: 0, w: 600, h: 400 }, ctx, M, { lab: { family: "Arial", size: 14, weight: 400, italic: false, color: "#000" }, ttl: { family: "Arial", size: 18, weight: 700, italic: false, color: "#000" }, family: "Arial", colors: ["#111111"], legend: "square", ink: "#000", gradient: false, radius: 0 });
    expect("why" in allHidden ? null : allHidden.legend.box).toBeNull();
    const old = seriesLayout({ ...COLS, legend: "right" }, { x: 0, y: 0, w: 600, h: 400 }, ctx, M, { lab: { family: "Arial", size: 14, weight: 400, italic: false, color: "#000" }, ttl: { family: "Arial", size: 18, weight: 700, italic: false, color: "#000" }, family: "Arial", colors: ["#111111"], legend: "square", ink: "#000", gradient: false, radius: 0 });
    expect("why" in old ? "" : old.legend.at).toBe("right");
  });
});

describe("chartKey and the node cache (09 §3.2): the same chart is built once; a scenario's overlay is another key", () => {
  it("the same item, data and look → the same nodes object; another sheet object (a scenario's view) → rebuilt, its values drawn", async () => {
    const { ctx, wb } = await setup("excel");
    const e = env(ctx), a = cachedChartNodes(COLS, "c", COLS.box, ctx, M, e), b = cachedChartNodes({ ...COLS }, "c", COLS.box, ctx, M, e);
    expect(b).toBe(a);
    const S = wb.sheets.find(s => s.name === "SLIDE_3 pair")!, view = Object.create(S) as Sheet;
    view.get = (r: number, c: number) => r === 5 && c === 9 ? { ...S.get(r, c)!, v: 999 } : S.get(r, c);
    const sc: RenderCtx = { ...ctx, sheet: n => n === "SLIDE_3 pair" ? view : ctx.sheet!(n), scenario: "h1" };
    expect(chartKey(COLS, sc)).not.toBe(chartKey(COLS, ctx));
    const c = cachedChartNodes(COLS, "c", COLS.box, sc, M, e);
    expect(c).not.toBe(a);
    const d = seriesData(COLS, sc);
    expect(d.ok && d.series[0].vals[0]).toBe(999);
    // a reload of the same name (another sheet object, same overlay hash) is another key too
    const reload = Object.create(S) as Sheet, rc: RenderCtx = { ...ctx, sheet: n => n === "SLIDE_3 pair" ? reload : ctx.sheet!(n) };
    expect(chartKey(COLS, rc)).not.toBe(chartKey(COLS, ctx));
    // the slide's build goes through the cache: its chart nodes are those of the item's key
    const { build, ctx: c2 } = await setup("excel", { c1: COLS });
    expect(validate(build(c2).nodes)).toEqual([]);
  });
  it("the page's measuring rounds (a new measurer each, excel-dl.ts measuredBuild): a probe is never served a cached chart and still records every text; the answers are", async () => {
    const { ctx } = await setup("excel"), e = env(ctx), it: ChartItem = { ...COLS, title: "Rounds" };
    // the probe: answers nothing yet (0), records what is asked
    const asked = new Set<string>(), probe: Metrics = { run: (t, f) => { asked.add(f + "\n" + t); return { w: 0, asc: 0, desc: 0 }; }, lines: t => [t] };
    const answers = () => ({ run: M.run, lines: M.lines }) as Metrics;
    const first = cachedChartNodes(it, "c", it.box, ctx, answers(), e);
    expect(cachedChartNodes(it, "c", it.box, ctx, answers(), e)).toBe(first);           // the next build's answers: the same nodes
    const p = cachedChartNodes(it, "c", it.box, ctx, probe, e);
    expect(p).not.toBe(first);                                                           // the probe measures 0: built again
    expect([...asked].some(k => k.endsWith("\nRounds"))).toBe(true);
    // a font that arrived (other answers): built again with them
    const wider: Metrics = { run: (t, f) => ({ ...M.run(t, f), w: M.run(t, f).w * 1.1 }), lines: M.lines };
    expect(cachedChartNodes(it, "c", it.box, ctx, wider, e)).not.toBe(first);
  });
});

describe("PowerPoint: a native c:barChart from the same layout (09 §4.2)", () => {
  async function semOf(design: Design, it: ChartItem) {
    const { ctx, build } = await setup(design, { c1: it });
    const dl = build({ ...ctx, forExport: true }, true), info = dl.items.c1;
    if (info.pptx?.kind !== "chart") throw new Error("no chart semantics");
    return { ctx, dl, info, ch: info.pptx.chart };
  }
  it("clustered columns: barDir col, gap 150, no overlap, the drawn bounds and unit, the plot as manualLayout, caches = the cells", async () => {
    const { ch, ctx } = await semOf("excel", COLS);
    expect(ch.type).toBe("column");
    const B = ch.bars!;
    expect(B).toMatchObject({ dir: "col", grouping: "clustered", gap: 150, overlap: 0 });
    const d = seriesData(COLS, ctx);
    if (!d.ok) throw new Error(d.why);
    expect(B.series.map(s => s.values)).toEqual(d.series.map(s => s.vals));
    expect(B.cats).toEqual(d.cats);
    expect([B.val.min, B.val.max, B.val.step]).toEqual([-150, 250, 50]);
    const x = chartXml(ch, "rId1", css => pptxFamily(css));
    expect(x).toContain('<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>');
    expect(x).toContain('<c:gapWidth val="150"/><c:axId');
    expect(x).not.toContain("<c:overlap");
    expect(x).toContain('<c:max val="250"/><c:min val="-150"/>');
    expect(x).toContain('<c:majorUnit val="50"/>');
    expect((x.match(/<c:ser>/g) || []).length).toBe(3);
    // the plot area exactly where the bars are drawn: fractions of the chart frame
    const f = ch.box, fr = (v: number) => String(Math.round(v * 1e6) / 1e6);
    expect(x).toContain(`<c:layoutTarget val="inner"/><c:xMode val="edge"/><c:yMode val="edge"/><c:x val="${fr((B.plot.x - f.x) / f.w)}"/><c:y val="${fr((B.plot.y - f.y) / f.h)}"/><c:w val="${fr(B.plot.w / f.w)}"/><c:h val="${fr(B.plot.h / f.h)}"/>`);
    // every formula into the embedded workbook, never a file
    for (const m of x.matchAll(/<c:f>([^<]*)<\/c:f>/g)) expect(m[1]).toMatch(/^Sheet1!\$[A-D]\$\d+(:\$[A-D]\$\d+)?$/);
    const book = strFromU8(unzipSync(chartWorkbook(ch))["xl/worksheets/sheet1.xml"]);
    expect(book).toContain('<dimension ref="A1:D10"/>');
    expect(book).toContain("<c r=\"B2\"><v>-101.25</v></c><c r=\"C2\"><v>-90</v></c><c r=\"D2\"><v>-78.75</v></c>");
  });
  it("stacked and 100 %: grouping and overlap 100; bars: barDir bar; labels as drawn (positions, a hidden one, white inside a dark bar)", async () => {
    const st = (await semOf("excel", { ...COLS, stack: "stacked" })).ch.bars!;
    expect([st.grouping, st.overlap]).toEqual(["stacked", 100]);
    const pc = (await semOf("excel", { ...COLS, stack: "percent" })).ch;
    expect([pc.bars!.grouping, pc.bars!.val.min, pc.bars!.val.max, pc.bars!.val.num]).toEqual(["percentStacked", -1, 1, "0%"]);
    const it: ChartItem = { ...LOANS, sers: { l: { n: 1, vals: LOANS.sers!.l.vals, color: "#051C2C", labels: { show: ["value"], pos: "inEnd" }, points: { "1": { label: "Top", color: "#FF0000" }, "2": { label: null } } } } };
    const { ch } = await semOf("excel", it), x = chartXml(ch, "rId1", css => pptxFamily(css));
    expect(x).toContain('<c:barDir val="bar"/>');
    expect(x).toContain('<c:dLbl><c:idx val="2"/><c:delete val="1"/></c:dLbl>');
    expect(x).toMatch(/<c:dLbl><c:idx val="1"\/><c:tx><c:rich>.*<a:t>Top<\/a:t>/);
    expect(x).toContain('<c:dLblPos val="inEnd"/>');
    expect(x).toContain('<c:dPt><c:idx val="1"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="FF0000"/>');
    expect(ch.bars!.series[0].labels!.points.find(p => p.i === 0)).toMatchObject({ color: "#FFFFFF" });
  });
  it("the legend: its drawn box as a manual layout, a hidden entry deleted, none without a c:legend", async () => {
    const x = chartXml((await semOf("excel", { ...COLS, legendAt: "left", legendHide: { q2: true } })).ch, "rId1", css => pptxFamily(css));
    expect(x).toMatch(/<c:legend><c:legendPos val="l"\/><c:legendEntry><c:idx val="1"\/><c:delete val="1"\/><\/c:legendEntry><c:layout><c:manualLayout><c:xMode/);
    expect(chartXml((await semOf("excel", { ...COLS, legendAt: "none" })).ch, "rId1", css => pptxFamily(css))).not.toContain("<c:legend>");
  });
  it("in the file: one native chart per series chart, the card under it (no bar drawn twice), the same bytes again", async () => {
    for (const design of ["glass", "excel", "mckinsey"] as Design[]) {
      const { dl, info } = await semOf(design, COLS);
      if (info.pptx?.kind !== "chart") throw new Error("no chart");
      expect(bars(info.pptx.card)).toHaveLength(0);
      expect(flat(info.pptx.card).some(n => n.t === "text")).toBe(false);
      const sem: SlideSem = { type: "content", items: Object.fromEntries(Object.entries(dl.items).flatMap(([id, it]) => it.pptx ? [[id, it.pptx]] : [])), palette: [] };
      const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
      const bytes = writePptx({ slides: [{ nodes: dl.nodes, sem }], image: () => PNG, face: css => pptxFamily(css) });
      const z = unzipSync(bytes), slide = strFromU8(z["ppt/slides/slide1.xml"]);
      expect((slide.match(/<c:chart /g) || []).length, design).toBe(1);
      expect(strFromU8(z["ppt/charts/chart1.xml"])).toContain("<c:barChart>");
      expect(Object.values(z).length).toBeGreaterThan(0);
      expect(Object.keys(z).some(n => n.endsWith(".rels") && /TargetMode="External"/.test(strFromU8(z[n])))).toBe(false);
      const again = writePptx({ slides: [{ nodes: dl.nodes, sem }], image: () => PNG, face: css => pptxFamily(css) });
      expect(Buffer.from(again).equals(Buffer.from(bytes))).toBe(true);
      if (process.env.CHART_PPTX_OUT) fs.writeFileSync(path.join(process.env.CHART_PPTX_OUT, `columns-${design}.pptx`), bytes);
    }
  });
  it("chartSem without a measurer (an old caller) gives no series chart rather than a wrong one", async () => {
    const { ctx } = await setup("excel");
    expect(chartSem(COLS, COLS.box, ctx, "Arial")).toBeNull();
    expect(chartSem(COLS, COLS.box, ctx, "Arial", M)?.bars?.dir).toBe("col");
  });
});

describe("the chart corpus's series deck (tests/corpus/charts/series.json): every slide in every design, on the stage and in PowerPoint", () => {
  for (const design of DESIGNS) it(`${design}: valid nodes, no Issues line, one native bar chart per series chart`, async () => {
    const d = JSON.parse(fs.readFileSync(path.join(here, "../../tests/corpus/charts/series.json"), "utf8")) as { workbook: string; ops: Op[] };
    const wb = await readWorkbook(ab(path.join(BOOKS, d.workbook)));
    const { doc: view, skipped } = applyOps(emptyDoc("W.xlsx"), d.ops);
    expect(skipped).toEqual([]);
    const style = resolveStyle({}, { ...view.style, design }), slides = runtimeSlides(wb, view.preset, "W.xlsx", design);
    const ctx: RenderCtx = { style, edits: {}, slides, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null, forExport: true };
    const lists = slides.map((R, i) => slideToDisplayList(R, i, ctx, R.tables.map(L => excelToDisplayList(L, ctx, M)), computeLayout(R, ctx).boxes, { wall: null, logo: null }, M, "1 October 2026", { sem: true }));
    const charts = lists.flatMap(l => Object.values(l.items)).filter(x => x.pptx?.kind === "chart");
    expect(charts).toHaveLength(5);
    for (const l of lists) { expect(validate(l.nodes)).toEqual([]); for (const x of Object.values(l.items)) expect(x.issue).toBeNull(); }
    for (const x of charts) if (x.pptx?.kind === "chart") {
      const B = x.pptx.chart.bars!;
      expect(B.series.length).toBeGreaterThan(0);
      expect(B.val.max).toBeGreaterThan(B.val.min);
    }
    const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
    const bytes = writePptx({ slides: lists.map(l => ({ nodes: l.nodes, sem: { type: "content" as const, items: Object.fromEntries(Object.entries(l.items).flatMap(([id, it]) => it.pptx ? [[id, it.pptx]] : [])), palette: [] } })), image: () => PNG, face: css => pptxFamily(css) });
    const z = unzipSync(bytes), parts = Object.keys(z).filter(n => /^ppt\/charts\/chart\d+\.xml$/.test(n));
    expect(parts).toHaveLength(5);
    for (const p of parts) expect(strFromU8(z[p])).toContain("<c:barChart>");
    if (process.env.CHART_PPTX_OUT) fs.writeFileSync(path.join(process.env.CHART_PPTX_OUT, `series-${design}.pptx`), bytes);
  });
});
