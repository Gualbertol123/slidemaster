/* Scatter and waterfall charts (S14.4; docs/next/09 §2.2, §3.1, §3.2, §4.2): CT-01 complete – scatter (a numeric x
   axis, markers, an optional straight or smoothed line) and waterfall (up / down / total colours, totals on the axis,
   connectors) in all five designs (DL snapshots of the chart corpus's scatter-waterfall deck) –, old charts of these types
   without `sers` drawn exactly as before (a pie), and the native PowerPoint charts made from the same layout: a
   c:scatterChart on two c:valAx with each series' x and y cached, and a waterfall as the classic stacked construction (an
   invisible base under the up / down / total series, the values and the labels on invisible line series) – no chartex,
   no picture, no connector shape, no external link. CHART_PPTX_OUT=<folder> writes the PowerPoint files (pptxcheck runs
   on them). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { validate, type DisplayList, type HitNode, type LineNode, type Node, type RectNode, type TextNode } from "../src/dl/types";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, emptyDoc, inverseOf } from "../src/model/ops";
import { itemSheets, runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { slideToDisplayList, type ItemInfo, type SlideDL } from "../src/render/slide-dl";
import { computeLayout } from "../src/render/layout";
import { chartKey, chartNodes, chartSem } from "../src/render/chart-dl";
import { seriesData, type SerData } from "../src/render/chart-data";
import { seriesLayout, seriesSem, type SeriesLayout, type SeriesStyle } from "../src/render/chart-series";
import { lightOf } from "../src/render/chart-bars";
import { lineH } from "../src/render/chart-font";
import { scatterLine, scatterMarker, xAxisOf } from "../src/render/chart-scatter";
import { connectorLine, mixHex, waterfallSteps } from "../src/render/chart-waterfall";
import { glassVars } from "../src/render/glass-dl";
import { chartWorkbook, chartXml } from "../src/pptx/chart";
import { writePptx } from "../src/pptx/writer";
import type { ChartSem } from "../src/pptx/chart-sem";
import type { SlideSem } from "../src/pptx/scene";
import { pptxFamily } from "../src/text/resolve";
import { DESIGNS } from "../src/model/designs";
import { wrapLines } from "../src/text/lines";
import type { RenderCtx } from "../src/render/context";
import type { ChartItem, ChartSeries, Design, Op } from "../src/model/types";
import type { Sheet } from "../src/xlsx/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const BOOKS = path.join(here, "../../tests/corpus/workbooks"), DECK = path.join(here, "../../tests/corpus/charts/scatter-waterfall.json");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const flat = (l: DisplayList): Node[] => l.flatMap(n => n.t === "group" ? [n, ...flat(n.children)] : [n]);
const r1 = (v: number) => Math.round(v * 10) / 10;
const summary = (l: DisplayList): unknown[] => l.map(n => {
  switch (n.t) {
    case "path": return ["path", n.d.length, JSON.stringify(n.d[0]), JSON.stringify(n.fill ?? null), n.stroke ? JSON.stringify(n.stroke) : ""];
    case "text": return ["text", n.src, r1(n.x), r1(n.y), n.size, n.weight, JSON.stringify(n.fill)];
    case "rect": return ["rect", r1(n.x), r1(n.y), r1(n.w), r1(n.h), JSON.stringify(n.r ?? 0), JSON.stringify(n.fill ?? null), n.stroke ? JSON.stringify(n.stroke) : ""];
    case "line": return ["line", r1(n.x1), r1(n.y1), r1(n.x2), r1(n.y2), JSON.stringify(n.stroke)];
    case "hit": return ["hit", n.kind, n.id, r1(n.x), r1(n.y), r1(n.w), r1(n.h)];
    case "group": return ["group", n.clip ? "clip" : "", summary(n.children)];
    case "shadow": return ["shadow", n.dy, n.blur, n.a];
    case "image": return ["image", n.id];
  }
});
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const STY: SeriesStyle = { lab: { family: "Arial", size: 14, weight: 400, italic: false, color: "#000000" }, ttl: { family: "Arial", size: 18, weight: 700, italic: false, color: "#000000" },
  family: "Arial", colors: ["#111111", "#222222", "#333333"], legend: "square", ink: "#000000", gradient: false, radius: 0 };

/** the scatter-waterfall deck (tests/corpus/charts/scatter-waterfall.json, workbook charts/bridge.xlsx) in a design */
async function deck(design: Design, opts: { sheet?: (n: string, S: Sheet | null) => Sheet | null; patch?: Record<string, Partial<ChartItem>> } = {}) {
  const d = JSON.parse(fs.readFileSync(DECK, "utf8")) as { workbook: string; ops: Op[] };
  const wb = await readWorkbook(ab(path.join(BOOKS, d.workbook)));
  const ops = d.ops.map(o => o.op === "item.patch" && opts.patch?.[o.id] ? { ...o, patch: { ...o.patch, ...opts.patch[o.id] } } as Op : o);
  const { doc: view, skipped } = applyOps(emptyDoc("W.xlsx"), ops);
  expect(skipped).toEqual([]);
  const style = resolveStyle({}, { ...view.style, design }), slides = runtimeSlides(wb, view.preset, "W.xlsx", design);
  const own = (n: string) => wb.sheets.find(s => s.name === n) || null;
  const ctx: RenderCtx = { style, edits: {}, slides, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "", sheet: n => opts.sheet ? opts.sheet(n, own(n)) : own(n), version: null, forExport: true };
  const lists = slides.map((R, i) => slideToDisplayList(R, i, ctx, R.tables.map(L => excelToDisplayList(L, ctx, M)), computeLayout(R, ctx).boxes, { wall: null, logo: null }, M, "1 October 2026", { sem: true }));
  const item = (id: string) => { const l = lists.find(x => x.items[id])!; return { list: l, info: l.items[id], nodes: l.nodes.slice(l.items[id].at[0], l.items[id].at[1]) }; };
  const it = (id: string) => view.preset!.slides.flatMap(s => Object.entries(s.items || {})).find(([k]) => k === id)![1] as ChartItem;
  return { wb, ctx, view, lists, item, it };
}
const semOf = (info: ItemInfo): ChartSem => { if (info.pptx?.kind !== "chart") throw new Error("no chart"); return info.pptx.chart; };
const pptxOf = (lists: SlideDL[]) => writePptx({ slides: lists.map(l => ({ nodes: l.nodes, sem: { type: "content" as const, items: Object.fromEntries(Object.entries(l.items).flatMap(([id, it]) => it.pptx ? [[id, it.pptx]] : [])), palette: [] } as SlideSem })), image: () => PNG, face: css => pptxFamily(css) });
const xml = (ch: ChartSem) => chartXml(ch, "rId1", css => pptxFamily(css));
const texts = (l: DisplayList) => flat(l).filter((n): n is TextNode => n.t === "text");
const layoutOf = (it: ChartItem, ctx: RenderCtx): SeriesLayout => { const L = seriesLayout(it, it.box, ctx, M, STY, "c"); if ("why" in L) throw new Error(L.why); return L; };
const ser = (vals: (number | null)[], points: ChartSeries["points"] = {}): SerData => ({ id: "s", n: 1, name: "S", type: "column", axis: "y", stack: null, color: null, vals, texts: vals.map(v => v === null ? "" : String(v)), fmt: "General", target: null, source: "", src: { n: 1, vals: [], points }, start: 0 });

describe("the parts (chart-scatter.ts, chart-waterfall.ts)", () => {
  it("waterfall steps: a running total; a total stands on the axis and the total goes on from it; a gap keeps it (09 §3.2)", () => {
    const W = waterfallSteps(ser([900, 260, 180, -220, -90, 1030], { 0: { total: true } as never, 5: { total: true } as never }));
    expect(W.steps.map(s => s && [s.kind, s.from, s.to])).toEqual([["total", 0, 900], ["up", 900, 1160], ["up", 1160, 1340], ["down", 1340, 1120], ["down", 1120, 1030], ["total", 0, 1030]]);
    expect([W.lo, W.hi]).toEqual([0, 1340]);
    // (no totals: the first column is an increase from 0; a gap: no column, the total unchanged)
    const G = waterfallSteps(ser([10, null, -15]));
    expect(G.steps.map(s => s && [s.kind, s.from, s.to])).toEqual([["up", 0, 10], null, ["down", 10, -5]]);
    expect([G.lo, G.hi]).toEqual([-5, 10]);
    // a point marked anything but true is no total
    expect(waterfallSteps(ser([5, 7], { 1: { total: "yes" } as never })).steps[1]!.kind).toBe("up");
    expect(connectorLine({ n: 1, vals: [] })).toEqual({ color: "#8A93A3", w: 1, dash: "dash" });
    expect(connectorLine({ n: 1, vals: [], line: { dash: "solid", color: "#123456" } })).toEqual({ color: "#123456", w: 1 });
  });
  it("scatter: markers (a circle unless asked) – none only where a line shows the points; a line when `line` or `smooth` is set", () => {
    expect(scatterLine({ n: 1, vals: [] })).toBe(false);
    expect(scatterLine({ n: 1, vals: [], smooth: true })).toBe(true);
    expect(scatterLine({ n: 1, vals: [], line: {} })).toBe(true);
    expect(scatterMarker({ n: 1, vals: [] }, "#123456", "#FFFFFF")).toMatchObject({ symbol: "circle", color: "#123456" });
    expect(scatterMarker({ n: 1, vals: [], marker: { shape: "none" } }, "#123456", "#FFFFFF")).toMatchObject({ symbol: "circle" });
    expect(scatterMarker({ n: 1, vals: [], marker: { shape: "none" }, line: { w: 2 } }, "#123456", "#FFFFFF")).toBeNull();
    // the x axis: Excel's automatic bounds over the x values that have a y value, fewer intervals where labels do not fit
    const s = { ...ser([1, 2, null]), xs: [410, 1060, 5000], xFmt: "#,##0" };
    const X = xAxisOf([s], undefined, 1000, () => 30);
    expect(X.scale).toEqual({ min: 0, max: 1200, step: 200 });
    expect(X.ticks.map(t => t.text)).toEqual(["0", "200", "400", "600", "800", "1.000", "1.200"]);
    expect(xAxisOf([s], undefined, 120, () => 30).ticks.length).toBeLessThan(7);
    expect(xAxisOf([s], { min: 400, max: 1100, step: 100 }, 1000, () => 30).scale).toEqual({ min: 400, max: 1100, step: 100 });
  });
});

describe("old charts of these types (no `sers`) draw exactly as before: a pie (09 §2.2)", () => {
  for (const design of DESIGNS) it(design, async () => {
    const { ctx, it } = await deck(design), env = { V: glassVars(ctx), wall: null, family: "Arial" };
    for (const type of ["scatter", "waterfall"] as const) {
      const old: ChartItem = { ...it("wf"), type, sers: undefined, labels: undefined };
      const pie: ChartItem = { ...old, type: "pie" };
      expect(chartNodes(old, "c", old.box, ctx, M, env)).toEqual(chartNodes(pie, "c", pie.box, ctx, M, env));
      expect(chartSem(old, old.box, ctx, "Arial", M)).toEqual(chartSem(pie, pie.box, ctx, "Arial", M));
      expect(chartSem(old, old.box, ctx, "Arial", M)!.type).toBe("pie");
    }
  });
});

describe("scatter (CT-01): a numeric x axis, markers, an optional line", () => {
  it("its data: each series' x and y values from its own cells; without xs Excel's 1, 2, 3 …; a missing or short xs is an Issues line", async () => {
    const { ctx, it } = await deck("excel"), d = seriesData(it("sc"), ctx);
    if (!d.ok) throw new Error(d.why);
    expect(d.cats).toEqual(Array.from({ length: 12 }, (_, i) => String(i + 1)));
    expect(d.series[0].xs!.slice(0, 3)).toEqual([730, 755, 805]);
    expect(d.series[0].xTexts!.slice(0, 3)).toEqual(["730", "755", "805"]);
    expect(d.series[0].vals.slice(0, 3)).toEqual([2.1, 2.3, 2.2]);
    expect(d.issues).toEqual([]);
    const no = seriesData({ ...it("sc"), sers: { a: { n: 1, vals: [{ sheet: "Scatter", range: "C2:C4" }] } } }, ctx);
    expect(no.ok && no.series[0].xs).toEqual([1, 2, 3]);
    const bad = seriesData({ ...it("sc"), sers: { a: { n: 1, name: "A", xs: [{ sheet: "Nope", range: "B2:B4" }], vals: [{ sheet: "Scatter", range: "C2:C4" }] },
      b: { n: 2, name: "B", xs: [{ sheet: "Scatter", range: "B2:B3" }], vals: [{ sheet: "Scatter", range: "C2:C4" }] } } }, ctx);
    if (!bad.ok) throw new Error(bad.why);
    expect(bad.series[0].xs).toEqual([1, 2, 3]);
    expect(bad.series[1].xs).toEqual([730, 755, null]);
    expect(bad.issues).toEqual(["'A': x values Nope!B2:B4 not found", "'B' has 2 x values for 3 values"]);
  });
  it("each point at (x, y): markers, Retail's labels at the right (Dec's own text and marker), Corporate's smoothed line, the x axis's ticks and gridlines, the marks", async () => {
    const { ctx, it, item } = await deck("excel"), L = layoutOf(it("sc"), ctx), P = L.plot, X = L.xAxis!;
    expect(X.scale).toEqual({ min: 0, max: 1200, step: 200 });
    const xp = (x: number) => P.x + x / 1200 * P.w, yp = (y: number) => P.y + P.h - (y - L.scale.min) / (L.scale.max - L.scale.min) * P.h;
    const ret = L.traces.find(t => t.s === 0)!, corp = L.traces.find(t => t.s === 1)!;
    expect(ret.pts[0]!.x).toBeCloseTo(xp(730), 6);
    expect(ret.pts[0]!.y).toBeCloseTo(yp(2.1), 6);
    expect(ret.stroke).toBeNull();                                         // markers only
    expect(ret.d).toEqual([]);
    expect(corp.d[0].slice(1).every(c => c[0] === "C")).toBe(true);       // smoothed
    expect(corp.marker!.symbol).toBe("diamond");
    const { nodes } = item("sc"), T = texts(nodes);
    for (const t of ["0", "200", "1.000", "1.200"]) expect(T.map(x => x.src)).toContain(t);
    const dec = L.labs.find(l => l.text === "Dec")!;
    expect(dec.x).toBeGreaterThan(xp(1060));                                // at the right of its point
    expect(dec.align).toBe("left");
    expect(T.some(t => t.src === "Corporate trend")).toBe(true);
    // the x axis's gridlines (axes.x.grid): one per tick, across the plot
    const vgrid = flat(nodes).filter((n): n is LineNode => n.t === "line" && n.x1 === n.x2), span = new Map<string, number>();
    for (const g of vgrid) span.set(`${g.y1}:${g.y2}`, (span.get(`${g.y1}:${g.y2}`) || 0) + 1);
    expect(Math.max(...span.values())).toBe(7);
    // Dec's own marker colour; the legend: Retail's marker alone, Corporate's line and marker
    expect(flat(nodes).some(n => n.t === "path" && JSON.stringify(n.fill) === JSON.stringify({ solid: [192, 0, 0] }))).toBe(true);
    const hits = flat(nodes).filter((n): n is HitNode => n.t === "hit" && n.kind === "point");
    expect(hits).toHaveLength(24);
    expect(hits[0].label).toBe("Retail · 730: 2,1");
    expect(hits.some(h => h.id === "sc:corp:11")).toBe(true);
    // the arrow from the floor stops at Oct's marker; the text mark at x 600, y 2.6
    const tm = flat(L.marks.nodes).find((n): n is TextNode => n.t === "text" && n.src === "Corporate trend")!;
    expect(tm.x + (tm.w ?? 0) / 2).toBeCloseTo(xp(600), 0);
  });
  it("a { x, y } mark off the x axis, or one at a category name, is an Issues line", async () => {
    const { ctx, it } = await deck("excel");
    const L = layoutOf({ ...it("sc"), marks: { a: { kind: "text", a: { x: "Jan", y: 2 }, text: "?" }, b: { kind: "text", a: { x: 300, y: 2 }, text: "ok" } } }, ctx);
    expect(L.issue).toBe("mark 'a': x \"Jan\" not on the axis");
  });
  it("PowerPoint: a c:scatterChart on two c:valAx (x at the bottom, midCat), each series' x and y cached from its two columns of the embedded workbook", async () => {
    const { item } = await deck("excel"), sem = semOf(item("sc").info), x = xml(sem);
    expect(sem.type).toBe("scatter");
    expect(x).toContain('<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>');
    expect(x).not.toContain("<c:catAx>");
    expect(x).not.toContain("<c:barChart>");
    expect(x).toMatch(/<c:valAx><c:axId val="510001"\/><c:scaling><c:orientation val="minMax"\/><c:max val="1200"\/><c:min val="0"\/><\/c:scaling><c:delete val="0"\/><c:axPos val="b"\/>/);
    expect(x.match(/<c:crossBetween val="midCat"\/>/g)).toHaveLength(2);
    expect(x).toContain("<c:xVal><c:numRef><c:f>Sheet1!$A$2:$A$13</c:f>");
    expect(x).toContain("<c:yVal><c:numRef><c:f>Sheet1!$B$2:$B$13</c:f>");
    expect(x).toContain("<c:xVal><c:numRef><c:f>Sheet1!$C$2:$C$13</c:f>");
    expect(x).toContain('<c:pt idx="0"><c:v>730</c:v></c:pt>');
    // Retail: no line, circles; Corporate: a smoothed line, diamonds; Dec's label and marker
    const sers = x.match(/<c:ser>.*?<\/c:ser>/g)!;
    expect(sers[0]).toContain('<c:spPr><a:ln><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="circle"/>');
    expect(sers[0]).toContain('<c:smooth val="0"/>');
    expect(sers[1]).toContain('<c:symbol val="diamond"/>');
    expect(sers[1]).toContain('<c:smooth val="1"/>');
    expect(sers[0]).toMatch(/<c:dLbl><c:idx val="11"\/><c:tx><c:rich>.*<a:t>Dec<\/a:t>/);
    expect(sers[0]).toMatch(/<c:dPt><c:idx val="11"\/><c:marker><c:symbol val="circle"\/><c:size val="\d+"\/><c:spPr><a:solidFill><a:srgbClr val="C00000"\/>/);
    // the workbook: x and y per series, no category column
    const sheet = strFromU8(unzipSync(chartWorkbook(sem))["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain('<dimension ref="A1:D13"/>');
    expect(sheet).toContain('<c r="A2"><v>730</v></c><c r="B2"><v>2.1</v></c><c r="C2"><v>410</v></c><c r="D2"><v>1.6</v></c>');
    expect(sheet).toContain("Retail (x)");
  });
});

describe("waterfall (CT-01): up / down / total colours, totals on the axis, connectors", () => {
  it("the budget bridge: columns floating on the running total, totals from 0, the design's colours, the values above / below, connectors at each total", async () => {
    const { ctx, it, item } = await deck("excel"), L = layoutOf(it("wf"), ctx), P = L.plot;
    expect(L.issue).toBeNull();
    const vp = (v: number) => P.y + P.h - (v - L.scale.min) / (L.scale.max - L.scale.min) * P.h;
    // (the total in the chart's ink: STY's here, Excel's #16181D on the slide)
    expect(L.bars.map(b => [b.from, b.to, b.dir, b.color])).toEqual([[0, 900, "up", "#000000"], [900, 1160, "up", "#1E8E3E"], [1160, 1340, "up", "#1E8E3E"],
      [1340, 1120, "down", "#D93025"], [1120, 1030, "down", "#D93025"], [0, 1030, "up", "#000000"]]);
    for (const b of L.bars) { expect(b.y).toBeCloseTo(vp(Math.max(b.from, b.to)), 6); expect(b.y + b.h).toBeCloseTo(vp(Math.min(b.from, b.to)), 6); }
    expect(L.connectors).toHaveLength(5);
    L.connectors.forEach((c, k) => { expect(c.y).toBeCloseTo(vp([900, 1160, 1340, 1120, 1030][k]), 1); expect(c.x1).toBeCloseTo(L.bars[k].x + L.bars[k].w, 1); expect(c.x2).toBeCloseTo(L.bars[k + 1].x, 1); });
    const { nodes } = item("wf"), T = texts(nodes);
    const lab = (s: string) => L.labs.find(t => t.text === s)!;
    expect(lab("260").top).toBeLessThan(L.bars[1].y);                       // an increase's above its top
    expect(lab("-220").top).toBeGreaterThan(L.bars[3].y + L.bars[3].h);     // a decrease's below its bottom
    expect(T.some(t => t.src === "1.030")).toBe(true);
    expect(flat(nodes).filter(n => n.t === "rect" && JSON.stringify(n.fill) === JSON.stringify({ solid: [22, 24, 29] })).length).toBe(2);
    expect(flat(nodes).filter(n => n.t === "line" && JSON.stringify(n.stroke).includes("[4,3]")).length).toBe(5);
    expect(flat(nodes).filter((n): n is HitNode => n.t === "hit" && n.kind === "point").map(h => h.id)).toEqual([0, 1, 2, 3, 4, 5].map(i => `wf:w:${i}`));
  });
  it("across zero: a decrease from 30 to −60, a point's own colour, centred labels (white inside), the legend Increase / Decrease / Total listed bottom-up beside the plot; legendHide by kind", async () => {
    const { ctx, it, item } = await deck("excel"), L = layoutOf(it("wz"), ctx);
    expect(L.bars.map(b => [b.from, b.to])).toEqual([[0, 120], [120, 180], [180, 30], [30, -60], [-60, -20], [0, -20]]);
    expect(L.bars[4].color).toBe("#7F7F7F");
    expect(L.bars[5].dir).toBe("down");
    expect(L.labs.find(l => l.text === "-150")!.st.color).toBe("#FFFFFF");
    const T = texts(item("wz").nodes).map(t => t.src);
    expect(T.indexOf("Total")).toBeLessThan(T.indexOf("Decrease"));
    expect(T.indexOf("Decrease")).toBeLessThan(T.indexOf("Increase"));
    const H = layoutOf({ ...it("wz"), legendHide: { down: true } }, ctx);
    expect(H.fall!.legend).toEqual(["up", "total"]);
    // a waterfall draws one series: another is named in the Issues panel
    const two = layoutOf({ ...it("wz"), sers: { ...it("wz").sers!, q: { n: 2, name: "More", vals: [{ sheet: "Bridge", range: "C4:C9" }] } } }, ctx);
    expect(two.issue).toBe("'More' is not drawn: a waterfall draws one series");
    expect(two.bars).toHaveLength(6);
  });
  it("PowerPoint: one stacked c:barChart – an invisible base, Increase / Decrease / Total (a part below zero in its own series) – adding up to each column; the values and the labels on invisible lines", async () => {
    const { ctx, it, item } = await deck("excel"), L = layoutOf(it("wz"), ctx), sem = semOf(item("wz").info), B = sem.bars!;
    expect(sem.type).toBe("waterfall");
    expect(B.series.map(s => s.name)).toEqual(["Base", "Increase", "Decrease", "Decrease (below 0)", "Total", "Profit walk", "Labels"]);
    expect(B.groups!.map(g => [g.kind, g.grouping, g.series])).toEqual([["bar", "stacked", [0, 1, 2, 3, 4]], ["line", "standard", [5, 6]]]);
    // each category: the positives stack to the column's top, the negatives to its bottom (PowerPoint stacks them so)
    const bars = B.groups![0].series.map(k => B.series[k]);
    B.cats.forEach((_, i) => {
      const vs = bars.map(s => s.values[i] ?? 0), up = vs.filter(v => v > 0).reduce((a, v) => a + v, 0), dn = vs.filter(v => v < 0).reduce((a, v) => a + v, 0);
      const b = L.bars.find(x => x.i === i)!;
      expect(up).toBeCloseTo(Math.max(0, b.from, b.to), 9);
      expect(dn).toBeCloseTo(Math.min(0, b.from, b.to), 9);
    });
    expect(B.series[5].values).toEqual([120, 60, -150, -90, 40, -20]);   // the cells (Edit Data, --sources)
    expect(B.legend!.hide).toEqual([0, 3, 5, 6]);
    const x = xml(sem);
    expect(x).toContain('<c:barChart><c:barDir val="col"/><c:grouping val="stacked"/>');
    expect(x).toContain('<c:overlap val="100"/>');
    const sers = x.match(/<c:ser>.*?<\/c:ser>/g)!;
    expect(sers[0]).toContain("<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>");
    expect(sers[5]).toContain('<c:spPr><a:ln><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker>');
    // the labels: each at the very place the slide draws it (centred on a point at the label's centre), its text
    const P = L.plot, span = L.scale.max - L.scale.min;
    for (const l of L.labs) {
      const v = B.series[6].values[l.i]!, cy = P.y + P.h - (v - L.scale.min) / span * P.h;
      expect(cy).toBeCloseTo(l.top + Math.round(l.st.size * 1.25) / 2, 6);
    }
    expect(sers[6]).toContain('<c:dLblPos val="ctr"/>');
    expect(sers[6]).toMatch(/<a:t>-150<\/a:t>/);
    expect(x).toContain("FFFFFF");
    expect(x).not.toContain("cx:");
    // the FX column's own grey on its Increase point
    expect(sers[1]).toMatch(/<c:dPt><c:idx val="4"\/>.*7F7F7F/);
  });
});

describe("every design (CT-01): the chart corpus's scatter-waterfall deck", () => {
  for (const design of DESIGNS) it(`${design}: every chart valid, no Issues line, snapshots`, async () => {
    const { lists } = await deck(design);
    for (const l of lists) {
      expect(validate(l.nodes)).toEqual([]);
      for (const [id, x] of Object.entries(l.items)) {
        expect(x.issue, id).toBeNull();
        expect(summary(l.nodes.slice(x.at[0], x.at[1]))).toMatchSnapshot(id);
      }
    }
  });
  for (const design of DESIGNS) it(`${design}: as a PowerPoint file – four native charts, no picture, no connector shape, no link; the connectors under the waterfalls; the same bytes again`, async () => {
    const { lists, item } = await deck(design);
    const bytes = pptxOf(lists), z = unzipSync(bytes);
    const charts = Object.keys(z).filter(n => /^ppt\/charts\/chart\d+\.xml$/.test(n)).sort();
    expect(charts.map(n => [...strFromU8(z[n]).matchAll(/<c:(lineChart|barChart|scatterChart)>/g)].map(m => m[1]).join("+")).sort()).toEqual(["barChart+lineChart", "barChart+lineChart", "scatterChart", "scatterChart"]);
    for (const n of Object.keys(z).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
      const s = strFromU8(z[n]);
      expect(s).not.toContain("<p:cxnSp");
      expect(s).not.toContain("<p:pic");
    }
    expect(Object.keys(z).some(n => n.endsWith(".rels") && /TargetMode="External"/.test(strFromU8(z[n])))).toBe(false);
    for (const n of charts) expect(strFromU8(z[n])).not.toMatch(/<c:f>[^<]*[[\]]/);
    // the waterfall's connectors: drawn on the card under the native chart (the slide's lines, not shapes over it)
    const info = item("wf").info;
    if (info.pptx?.kind !== "chart") throw new Error("no chart");
    expect(flat(info.pptx.card).filter(n => n.t === "line" && JSON.stringify(n.stroke).includes("[4,3]")).length).toBe(5);
    expect(info.pptx.overlay ?? []).toEqual([]);
    expect(Buffer.from(pptxOf(lists)).equals(Buffer.from(bytes))).toBe(true);
    if (process.env.CHART_PPTX_OUT) fs.writeFileSync(path.join(process.env.CHART_PPTX_OUT, `scatter-waterfall-${design}.pptx`), bytes);
  });
});

describe("the cache", () => {
  it("a scatter chart's key follows its x values' sheet (a reload there is another key)", async () => {
    const a = await deck("excel"), it: ChartItem = { ...a.it("sc"), sers: { s: { n: 1, xs: [{ sheet: "Bridge", range: "C4:C9" }], vals: [{ sheet: "Scatter", range: "C2:C7" }] } } };
    const b = await deck("excel", { sheet: (n, S) => n === "Bridge" && S ? Object.create(S) as Sheet : S });
    expect(chartKey(it, b.ctx)).not.toBe(chartKey(it, a.ctx));
    const rects = (l: DisplayList) => flat(l).filter((n): n is RectNode => n.t === "rect");
    expect(rects(chartNodes(a.it("wf"), "wf", a.it("wf").box, a.ctx, M, { V: glassVars(a.ctx), wall: null, family: "Arial" }).nodes).length).toBeGreaterThanOrEqual(6);
    // the sheets the deck reads include a scatter series' x values (a linked workbook's too)
    const xs: ChartItem = { ...it, sers: { s: { n: 1, xs: [{ sheet: "[Peers.xlsx]Vol", range: "B2:B7" }], vals: [{ sheet: "Scatter", range: "C2:C7" }] } } };
    expect(itemSheets({ sheets: [], tables: [], slides: [{ id: "s", type: "content", tables: [], items: { xs } }] } as never)).toEqual(["Scatter", "[Peers.xlsx]Vol"]);
  });
});

/* ---- S14.4 review follow-ups (S14.5) ---- */
/** a sheet with some cells' numbers replaced ("C5" → -900): the rest as the workbook has it */
const withCells = (S: Sheet, cells: Record<string, number>): Sheet => {
  const o = Object.create(S) as { get: (r: number, c: number) => unknown };
  const base = (S as unknown as { get: (r: number, c: number) => Record<string, unknown> | undefined }).get.bind(S);
  o.get = (r: number, c: number) => {
    const k = Object.keys(cells).find(a => { const m = /^([A-Z]+)(\d+)$/.exec(a)!; return +m[2] === r && m[1].charCodeAt(0) - 64 === c; });
    return k === undefined ? base(r, c) : { ...(base(r, c) || { t: "n", fmt: "General" }), t: "n", v: cells[k] };
  };
  return o as unknown as Sheet;
};
/** the formulas of an embedded workbook evaluated (IF, MIN, MAX, AND, N over its own cells; "" a blank) */
function evalBook(sheetXml: string): (ref: string) => number | string {
  const cells = new Map<string, { v: string; f?: string }>();
  for (const m of sheetXml.matchAll(/<c r="([A-Z]+\d+)"[^>]*>(?:<f>(.*?)<\/f>)?(?:<v>(.*?)<\/v>)?/g)) cells.set(m[1], { v: m[3] ?? "", ...(m[2] ? { f: m[2].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") } : {}) });
  const memo = new Map<string, number | string>();
  const val = (ref: string): number | string => {
    if (memo.has(ref)) return memo.get(ref)!;
    const c = cells.get(ref); let out: number | string;
    if (!c) out = ""; else if (!c.f) out = c.v === "" ? "" : +c.v;
    else {
      const js = c.f.replace(/([A-Z]+\d+)/g, (_, r) => `val("${r}")`).replace(/(?<![<>])=/g, "==");
      // eslint-disable-next-line no-new-func
      out = new Function("val", "IF", "MIN", "MAX", "AND", "N", "TRUE", `return ${js};`)(val, (c: unknown, a: unknown, b: unknown) => c ? a : b,
        (...a: number[]) => Math.min(...a.map(Number)), (...a: number[]) => Math.max(...a.map(Number)), (...a: unknown[]) => a.every(Boolean), (x: unknown) => typeof x === "number" ? x : 0, true);
    }
    memo.set(ref, out); return out;
  };
  return val;
}
describe("S14.4 review follow-ups", () => {
  const bridge = (cells: Record<string, number>) => (n: string, S: Sheet | null) => n === "Bridge" && S ? withCells(S, cells) : S;
  it("1 · a waterfall's labels stay inside the plot (a decrease ending on the axis's minimum, an increase up to its maximum), and so do PowerPoint's carrier points", async () => {
    const { ctx, it } = await deck("excel", { sheet: bridge({ C5: -900 }) });
    for (const it2 of [{ ...it("wf"), sers: { w: { n: 1, vals: [{ sheet: "Bridge", range: "C4:C5" }] } }, axes: { y: { min: 0 } } } as ChartItem,
      { ...it("wf"), sers: { w: { n: 1, vals: [{ sheet: "Bridge", range: "C4" }] } }, axes: { y: { min: 0, max: 900 } }, titleFmt: undefined, labels: undefined } as ChartItem]) {
      const L = layoutOf(it2, ctx), P = L.plot;
      expect(L.labs.length).toBe(L.bars.length);
      for (const l of L.labs) { expect(l.top).toBeGreaterThanOrEqual(P.y - .01); expect(l.top + lineH(l.st)).toBeLessThanOrEqual(P.y + P.h + .01); }
      const B = seriesSem(L), car = B.series.find(s => s.name === "Labels")!;
      for (const v of car.values) if (v !== null) { expect(v).toBeGreaterThanOrEqual(L.scale.min); expect(v).toBeLessThanOrEqual(L.scale.max); }
    }
    // the decrease to 0: its label above its column (beyond the other end), not under the axis
    const L = layoutOf({ ...it("wf"), sers: { w: { n: 1, vals: [{ sheet: "Bridge", range: "C4:C5" }] } }, axes: { y: { min: 0 } } } as ChartItem, ctx);
    expect(L.labs.find(l => l.text === "-900")!.top + lineH(L.labs[1].st)).toBeLessThanOrEqual(L.bars[1].y);
  });
  it("2 · a scatter point outside a fixed x range is not drawn (no point on the plot's edge) and breaks the line", async () => {
    const { ctx, it } = await deck("excel"), base = it("sc");
    const L = layoutOf({ ...base, axes: { ...base.axes, x: { ...base.axes!.x, min: 800, max: 1000 } } }, ctx);
    const ret = L.traces.find(t => t.s === 0)!;
    // Retail's x: 730, 755, 805, 870, 870, 920, 905, 860, 940, 985, 1010, 1060 → the first two and the last two are out
    expect(ret.pts.map(p => p === null)).toEqual([true, true, false, false, false, false, false, false, false, false, true, true]);
    for (const tr of L.traces) for (const p of tr.pts) if (p) { expect(p.x).toBeGreaterThan(L.plot.x + .01); expect(p.x).toBeLessThan(L.plot.x + L.plot.w - .01); }
    const sl = layoutOf({ ...it("sl"), axes: { x: { min: 760, max: 900 } } }, ctx), line = sl.traces.find(t => t.s === 0)!;
    expect(line.pts.filter(p => p).length).toBeGreaterThan(1);
    expect(line.d.length).toBeGreaterThanOrEqual(1);
    for (const run of line.d) for (const c of run) if (c[0] !== "Z") expect(c[c.length - 2] as number).toBeGreaterThanOrEqual(sl.plot.x);
  });
  it("3 · Edit Data: the waterfall's construction columns are formulas over its values and a running total – the export's caches, and new columns when a value changes", async () => {
    const { item } = await deck("excel"), sem = semOf(item("wz").info), B = sem.bars!;
    const sheet = strFromU8(unzipSync(chartWorkbook(sem))["xl/worksheets/sheet1.xml"]);
    expect(strFromU8(unzipSync(chartWorkbook(sem))["xl/workbook.xml"])).toContain('<calcPr fullCalcOnLoad="1"/>');
    expect(sheet).toContain("Running total");
    expect(sheet).not.toMatch(/<f>[^<]*\{/);
    const n = B.cats.length, col = (k: number) => String.fromCharCode(66 + k);       // series k in column B + k
    const bars = B.groups![0].series, valuesCol = col(B.series.findIndex(s => s.name === "Profit walk"));
    // the formulas give the caches
    let at = evalBook(sheet);
    for (const k of bars) for (let i = 0; i < n; i++) {
      const v = at(`${col(k)}${i + 2}`), want = B.series[k].values[i];
      expect(typeof v === "number" ? v : 0, `${B.series[k].name} ${i}`).toBeCloseTo(want ?? 0, 9);
    }
    // a value edited in Edit Data (Volume 60 → 80): the columns after it move up by 20, each still adding up to its total
    // (every step keeps its side of zero; one that newly crosses it needs a new export – 09 §4.2)
    const edited = sheet.replace(new RegExp(`(<c r="${valuesCol}3"><v>)60(</v>)`), "$180$2");
    expect(edited).not.toBe(sheet);
    at = evalBook(edited);
    // (each column from → to: the running totals now, the first and the last totals)
    const span = [[0, 120], [120, 200], [200, 50], [50, -40], [-40, 0], [0, -20]];
    for (let i = 0; i < n; i++) {
      const vs = bars.map(k => at(`${col(k)}${i + 2}`)).map(v => typeof v === "number" ? v : 0);
      const up = vs.filter(v => v > 0).reduce((a, v) => a + v, 0), dn = vs.filter(v => v < 0).reduce((a, v) => a + v, 0);
      expect(up, `row ${i} top`).toBeCloseTo(Math.max(0, ...span[i]), 9);
      expect(dn, `row ${i} bottom`).toBeCloseTo(Math.min(0, ...span[i]), 9);
    }
    // a chart without formulas keeps its workbook as before (no calcPr)
    expect(strFromU8(unzipSync(chartWorkbook(semOf(item("sc").info)))["xl/workbook.xml"])).not.toContain("calcPr");
  });
  it("6 · Liquid Glass: a waterfall column across zero – its two PowerPoint parts carry the slide's one gradient, split at zero", async () => {
    const { ctx, it, item } = await deck("glass"), sem = semOf(item("wz").info), B = sem.bars!;
    const L = seriesLayout(it("wz"), item("wz").info.box, ctx, M, { ...STY, gradient: true }, "wz");
    if ("why" in L) throw new Error();
    const S2 = seriesSem(L), main = S2.series.find(s => s.name === "Decrease")!, below = S2.series.find(s => s.name === "Decrease (below 0)")!;
    const b = L.bars.find(x => x.i === 3)!, c = b.color, light = lightOf(c);
    const zeroY = L.plot.y + L.plot.h - (0 - L.scale.min) / (L.scale.max - L.scale.min) * L.plot.h, mid = mixHex(c, light, (zeroY - b.y) / b.h);
    expect(main.points.find(p => p.i === 3)).toEqual({ i: 3, color: mid, light: c });
    expect(below.points.find(p => p.i === 3)).toEqual({ i: 3, color: light, light: mid });
    expect(B.series.some(s => s.name === "Decrease (below 0)")).toBe(true);
  });
  it("7 · a point's `total` round-trips through item.patch on `sers` (one series entry, merged per entry) and its undo", async () => {
    const { view } = await deck("excel"), slide = view.preset!.slides[1].id;
    const cur = view.preset!.slides[1].items!.wz as ChartItem, ser = cur.sers!.p;
    const op = { op: "item.patch", slide, id: "wz", patch: { sers: { p: { ...ser, points: { ...ser.points, 2: { total: true } } } } } } as unknown as Op;
    const inv = inverseOf(view, op)!;
    const after = applyOps(view, [op]).doc, a = after.preset!.slides[1].items!.wz as ChartItem;
    expect((a.sers!.p.points as Record<string, { total?: boolean }>)["2"].total).toBe(true);
    expect((a.sers!.p.points as Record<string, { total?: boolean }>)["0"].total).toBe(true);
    const back = applyOps(after, [inv]).doc;
    expect(back.preset!.slides[1].items!.wz).toEqual(cur);
    // another writer's new series at the same time: both kept (per entry)
    const other = { op: "item.patch", slide, id: "wz", patch: { sers: { q: { n: 2, vals: [{ sheet: "Bridge", range: "C4:C9" }] } } } } as unknown as Op;
    for (const order of [[op, other], [other, op]]) { const d = applyOps(view, order).doc.preset!.slides[1].items!.wz as ChartItem; expect(Object.keys(d.sers!).sort()).toEqual(["p", "q"]); expect((d.sers!.p.points as Record<string, { total?: boolean }>)["2"].total).toBe(true); }
  });
  it("8 · the connectors take the design's axis-line colour", async () => {
    for (const [design, color] of [["excel", [191, 191, 191]], ["glass", [174, 182, 198]]] as const) {
      const { item } = await deck(design);
      const lines = flat(item("wf").nodes).filter((n): n is LineNode => n.t === "line" && JSON.stringify(n.stroke).includes("[4,3]"));
      expect(lines).toHaveLength(5);
      for (const l of lines) expect((l.stroke!.paint as { solid: number[] }).solid).toEqual(color);
    }
  });
  it("5 · export-check's --sources: a waterfall's first series only; a scatter series' y values masked by its x cells", async () => {
    // @ts-expect-error – a tool's plain JavaScript module, no declarations
    const { chartSources } = await import("../../tools/export-check.mjs") as { chartSources: (d: unknown) => Record<string, unknown>[] };
    const d = JSON.parse(fs.readFileSync(DECK, "utf8"));
    const wz = d.ops.find((o: { id?: string }) => o.id === "wz");
    wz.patch.sers.q = { n: 2, name: "Second", vals: [{ sheet: "Bridge", range: "C4:C9" }] };
    const src = chartSources(d);
    expect(src.filter(s => s.name === "Second")).toEqual([]);
    expect(src.find(s => s.name === "Profit walk")).toMatchObject({ sheet: "Bridge", range: "E4:E9" });
    expect(src.find(s => s.name === "Retail" && !s.axis)).toMatchObject({ range: "C2:C13", mask: { sheet: "Scatter", range: "B2:B13" } });
  });
});
