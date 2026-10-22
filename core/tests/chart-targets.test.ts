/* B52 (4.10; ADR-015 amendment of 2026-10-22): a chart's reference lines (their values from cells), gap arrows and change
   pills – the owner's picture as the chart corpus's target-lines deck (tests/corpus/charts/target-lines.json, workbook
   charts/target-lines.xlsx): in all five designs (DL snapshots), a cell change and a scenario value move the line and the
   gap's label, the vectors and the format guard (shared/ops-vectors.d/b52.json: format 7), and the native PowerPoint chart
   made from the same layout – each reference line a real line series (the embedded workbook carries its value, the other
   rows "=" that cell), the gap arrow one line shape with native ends, the pills rounded rectangles with text; no picture,
   no connector shape, no external link. CHART_PPTX_OUT=<folder> writes the PowerPoint files (pptxcheck runs on them). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { validate, type DisplayList, type HitNode, type LineNode, type Node, type RectNode, type TextNode } from "../src/dl/types";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, docNeedsV5, docNeedsV6, docNeedsV7, emptyDoc, knownOp, needsV5, needsV6, needsV7 } from "../src/model/ops";
import { itemSheets, runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { slideToDisplayList, type ItemInfo, type SlideDL } from "../src/render/slide-dl";
import { computeLayout } from "../src/render/layout";
import { chartKey } from "../src/render/chart-dl";
import { seriesLayout, type SeriesLayout, type SeriesStyle } from "../src/render/chart-series";
import { signed, targetLook } from "../src/render/chart-targets";
import { chartWorkbook, chartXml } from "../src/pptx/chart";
import { writePptx } from "../src/pptx/writer";
import type { ChartSem } from "../src/pptx/chart-sem";
import type { SlideSem } from "../src/pptx/scene";
import { pptxFamily } from "../src/text/resolve";
import { DESIGNS } from "../src/model/designs";
import { wrapLines } from "../src/text/lines";
import { loadVectors } from "./vectors";
import type { RenderCtx } from "../src/render/context";
import type { ChartItem, Design, Op } from "../src/model/types";
import type { Cell, Sheet } from "../src/xlsx/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const BOOKS = path.join(here, "../../tests/corpus/workbooks"), DECK = path.join(here, "../../tests/corpus/charts/target-lines.json");
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
/** a sheet whose cell (r, c) holds another number (a reload, a scenario's value: another sheet object) */
function withCell(S: Sheet, r: number, c: number, v: number): Sheet {
  const o = Object.create(S) as Sheet;
  o.get = (rr: number, cc: number) => { const x = S.get(rr, cc); return rr === r && cc === c ? { ...(x as Cell), v, t: "n" } as Cell : x; };
  return o;
}

/** the target-lines deck in a design */
async function deck(design: Design, opts: { sheet?: (n: string, S: Sheet | null) => Sheet | null; scenario?: string } = {}) {
  const d = JSON.parse(fs.readFileSync(DECK, "utf8")) as { workbook: string; ops: Op[] };
  const wb = await readWorkbook(ab(path.join(BOOKS, d.workbook)));
  const { doc: view, skipped } = applyOps(emptyDoc("W.xlsx"), d.ops);
  expect(skipped).toEqual([]);
  const style = resolveStyle({}, { ...view.style, design }), slides = runtimeSlides(wb, view.preset, "W.xlsx", design);
  const own = (n: string) => wb.sheets.find(s => s.name === n) || null;
  const ctx: RenderCtx = { style, edits: {}, slides, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "", sheet: n => opts.sheet ? opts.sheet(n, own(n)) : own(n), version: null, forExport: true,
    ...(opts.scenario ? { scenario: opts.scenario } : {}) };
  const lists = slides.map((R, i) => slideToDisplayList(R, i, ctx, R.tables.map(L => excelToDisplayList(L, ctx, M)), computeLayout(R, ctx).boxes, { wall: null, logo: null }, M, "1 October 2026", { sem: true }));
  const item = (id: string) => { const l = lists.find(x => x.items[id])!; return { list: l, info: l.items[id], nodes: l.nodes.slice(l.items[id].at[0], l.items[id].at[1]) }; };
  const it = (id: string) => view.preset!.slides.flatMap(s => Object.entries(s.items || {})).find(([k]) => k === id)![1] as ChartItem;
  return { wb, ctx, view, lists, item, it, own };
}
const semOf = (info: ItemInfo): ChartSem => { if (info.pptx?.kind !== "chart") throw new Error("no chart"); return info.pptx.chart; };
const pptxOf = (lists: SlideDL[]) => writePptx({ slides: lists.map(l => ({ nodes: l.nodes, sem: { type: "content" as const, items: Object.fromEntries(Object.entries(l.items).flatMap(([id, it]) => it.pptx ? [[id, it.pptx]] : [])), palette: [] } as SlideSem })), image: () => PNG, face: css => pptxFamily(css) });
const layoutOf = (it: ChartItem, ctx: RenderCtx) => { const L = seriesLayout(it, it.box, ctx, M, STY, "x"); if ("why" in L) throw new Error(L.why); return L as SeriesLayout; };
const texts = (l: DisplayList) => flat(l).filter((n): n is TextNode => n.t === "text").map(n => n.src);

const NEG = "−";
const lineAt = (l: DisplayList, y: number) => flat(l).filter((n): n is LineNode => n.t === "line" && Math.abs(n.y1 - y) < .02 && Math.abs(n.y2 - y) < .02 && n.x2 - n.x1 > 100);
const textOf = (l: DisplayList, src: string) => flat(l).find((n): n is TextNode => n.t === "text" && n.src === src);
const colorOf = (n: { fill?: unknown } | undefined) => { const f = (n?.fill as { solid?: number[] } | undefined)?.solid; return f ? "#" + f.map(v => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase() : null; };

describe("the picture (tests/corpus/charts/target-lines.json, slide 1)", () => {
  it("two reference lines from Targets!B3 and C3 across the plot, labelled at the right end with their cells' names and values (the cells' format, the workbook's separators)", async () => {
    const { ctx, it, item } = await deck("excel");
    const L = layoutOf(it("tl"), ctx), P = L.plot, S = L.scale;
    expect(L.issue).toBeNull();
    expect([S.min, S.max, S.step]).toEqual([11300, 12100, 100]);
    expect(L.refSpan).toBe("full");
    expect(L.refs.map(r => [r.id, r.v, r.name, r.text, r.label?.text, r.label?.pos])).toEqual([["r1", 11790, "EoM budget", "11.790", "EoM budget 11.790", "right"], ["r2", 12000, "Ambition", "12.000", "Ambition 12.000", "right"]]);
    for (const r of L.refs) {
      expect(r.y).toBeCloseTo(P.y + P.h - (r.v - S.min) / (S.max - S.min) * P.h, 1);
      expect([r.x1, r.x2]).toEqual([P.x, P.x + P.w].map(v => Math.round(v * 100) / 100));
      expect(r.line.dash).toBe("dash");
    }
    // the design's defaults (Excel with the Intesa Sanpaolo template, B48): the first line its blue, the others its grey
    expect(L.refs.map(r => r.line.color)).toEqual(["#003A79", "#7F7F7F"]);
    for (const r of L.refs) expect(lineAt(L.marks.nodes, r.y).length).toBe(1);
    // the labels start after the plot's end (the plot leaves room for them), inside the chart's box
    const lab = textOf(L.marks.nodes, "EoM budget 11.790")!;
    expect(lab.x).toBeGreaterThan(P.x + P.w);
    expect(lab.x + (lab.w ?? 0)).toBeLessThanOrEqual(it("tl").box.x + it("tl").box.w);
    // on the slide: two dashed lines across the plot
    const dashed = flat(item("tl").nodes).filter((n): n is LineNode => n.t === "line" && !!n.stroke.dash && n.y1 === n.y2 && n.x2 - n.x1 > 500);
    expect(dashed.length).toBe(2); expect(dashed[0].y1).not.toBe(dashed[1].y1);
  });
  it("the gap arrow: from the budget line to beside the last point, its live difference (−348) and caption in the negative colour", async () => {
    const { ctx, it, item } = await deck("excel");
    const L = layoutOf(it("tl"), ctx), look = targetLook(ctx, STY.ink), r = L.refs[0];
    expect(L.marks.arrows.length).toBe(1);
    const A = L.marks.arrows[0], last = L.data.series[0];
    expect(A.a.y).toBe(r.y);                                                     // a: on the line
    expect(A.tail).toBe("triangle");                                             // the head at the point's end
    expect(A.a.x).toBe(A.b.x); expect(A.b.x).toBeGreaterThan(L.traces[0].pts[3]!.x);
    expect(A.b.y).toBeCloseTo(L.traces[0].pts[3]!.y, 1);
    expect(last.vals[3]).toBe(11442);
    const nodes = item("tl").nodes, t = textOf(L.marks.nodes, NEG + "348")!;
    expect(colorOf(textOf(nodes, NEG + "348"))).toBe(look.neg); expect(colorOf(textOf(nodes, "gap to budget"))).toBe(look.neg);
    expect(t.x).toBeGreaterThan(A.a.x);
  });
  it("the change pills: one between each pair of weeks, the change and its %, red / green by sign, a caption above the row", async () => {
    const { ctx, it, item } = await deck("excel");
    const L = layoutOf(it("tl"), ctx), look = targetLook(ctx, STY.ink), nodes = item("tl").nodes;
    const pills = [NEG + "165 (" + NEG + "1,4%)", "+5 (+0,0%)", "+26 (+0,2%)"];
    expect(pills.map(p => !!textOf(nodes, p))).toEqual([true, true, true]);
    expect(colorOf(textOf(nodes, pills[0]))).toBe(look.neg); expect(colorOf(textOf(nodes, pills[2]))).toBe(look.pos);
    const rects = L.marks.nodes.filter((n): n is RectNode => n.t === "rect" && !!n.r && n.r === n.h / 2);
    expect(rects.length).toBe(3);
    const xs = L.traces[0].pts.map(p => p!.x);
    rects.forEach((r, k) => expect(r.x + r.w / 2).toBeCloseTo((xs[k] + xs[k + 1]) / 2, 1));
    for (const r of rects) expect(r.y + r.h).toBeLessThanOrEqual(L.plot.y + L.plot.h);
    expect(textOf(L.marks.nodes, "Week-on-week change")!.y).toBeLessThan(rects[0].y);
    expect(texts(nodes).filter(t => /^\d/.test(t)).slice(0, 4)).toEqual(["11.576", "11.411", "11.416", "11.442"]);   // the point labels (M14's)
  });
  it("a cell change (a reload) and a scenario's value move the line and the gap's label; the chart's key follows the cells", async () => {
    const a = await deck("excel");
    const moved = (n: string, S: Sheet | null) => n === "Targets" && S ? withCell(S, 3, 2, 11500) : S;
    const b = await deck("excel", { sheet: moved }), c = await deck("excel", { sheet: moved, scenario: "Budget 11.500" });
    expect(chartKey(a.it("tl"), b.ctx)).not.toBe(chartKey(a.it("tl"), a.ctx));
    for (const x of [b, c]) {
      const L = layoutOf(x.it("tl"), x.ctx), L0 = layoutOf(a.it("tl"), a.ctx);
      expect(L.refs[0].v).toBe(11500);
      expect(L.refs[0].y).toBeGreaterThan(L0.refs[0].y);
      expect(texts(x.item("tl").nodes)).toEqual(expect.arrayContaining(["EoM budget 11.500", NEG + "58"]));
      expect(colorOf(textOf(x.item("tl").nodes, NEG + "58"))).toBe(targetLook(x.ctx, STY.ink).neg);
    }
  });
  it("without the axis's own bounds the scale holds the lines (12.000 shows)", async () => {
    const { ctx, it } = await deck("excel");
    const L = layoutOf({ ...it("tl"), axes: undefined }, ctx);
    expect(L.scale.max).toBeGreaterThanOrEqual(12000);
  });
});

describe("each extra on its own (modular)", () => {
  it("switched off (`off`): kept, not drawn; a typed value is the fallback; the label left / above, name or value only, none", async () => {
    const { ctx, it } = await deck("excel");
    const base = it("tl"), T = { sheet: "Targets", range: "B3" };
    const L = layoutOf({ ...base, marks: { a: { kind: "ref", value: T, off: true }, b: { kind: "ref", value: 11600, name: "Typed", pos: "left", show: "name" },
      c: { kind: "ref", value: T, name: "Above", pos: "above", show: "value", num: "#,##0.0" }, d: { kind: "ref", value: T, show: "none" }, g: { kind: "gap", ref: "a" } } }, ctx);
    expect(L.refs.map(r => [r.id, r.v, r.label?.text ?? null, r.label?.pos ?? null])).toEqual([["b", 11600, "Typed", "left"], ["c", 11790, "11.790,0", "above"], ["d", 11790, null, null]]);
    expect(L.issue).toBe("gap 'g': reference line 'a' not found");           // the gap's line is off
    const lt = L.marks.nodes.find((n): n is TextNode => n.t === "text" && n.src === "Typed")!;
    expect(lt.x).toBeCloseTo(L.plot.x + 4, 1);
  });
  it("Issues: a value cell not found or holding text, a gap's line not there, a chart type without them", async () => {
    const { ctx, it } = await deck("excel");
    const L = layoutOf({ ...it("tl"), marks: { a: { kind: "ref", value: { sheet: "Nope", range: "A1" } }, b: { kind: "ref", value: { sheet: "Targets", range: "B2" } }, c: { kind: "ref" } } }, ctx);
    expect(L.issue).toBe("reference line 'a': Nope!A1 not found; reference line 'b': no number in Targets!B2; reference line 'c': no value (a cell or a number)");
    const bar = layoutOf({ ...it("tl"), type: "bar" }, ctx);
    expect(bar.issue).toBe("reference lines, gap arrows and change pills are drawn on column, line, area and combo charts only");
    expect(bar.refs).toEqual([]);
  });
  it("the pills: the last pair only, the absolute change only, under the line, own colours; the gap: % of the line, left, a fixed colour, both heads", async () => {
    const { ctx, it, item } = await deck("excel");
    const L = layoutOf(it("tc"), ctx), nodes = item("tc").nodes;
    expect(L.refSpan).toBe("centres");                                        // a right axis: between the categories' centres
    expect(L.refs[0].x1).toBeCloseTo(L.plot.x + L.plot.w / 8, 1);
    expect(L.issue).toContain("a reference line on the left axis is drawn under the right axis's columns in PowerPoint");
    expect(texts(nodes)).toEqual(expect.arrayContaining(["+26", NEG + "348 (" + NEG + "3,0%)", "Floor (typed) 11.500", "Budget"]));
    expect(colorOf(textOf(nodes, "+26"))).toBe("#0B6E4F");
    expect(colorOf(textOf(nodes, NEG + "348 (" + NEG + "3,0%)"))).toBe("#1F3864");
    expect(L.marks.arrows[0]).toMatchObject({ head: "triangle", tail: "triangle" });
    expect(L.marks.arrows[0].a.x).toBeLessThan(L.traces[0].pts[3]!.x);
    expect(texts(nodes)).not.toContain("Off (kept) 12.000");
  });
  it("review of B52: on stacked lines (the template's stacked areas) beside a right axis a reference line is a line shape in PowerPoint, with an Issues line – never a second line group", async () => {
    const { ctx, it, item } = await deck("excel");
    const W = (r: string) => ({ sheet: "Weekly", range: r }), T = { sheet: "Targets", range: "B3" };
    const c: ChartItem = { ...it("tl"), type: "combo", stack: "stacked", axes: undefined, sers: { a: { n: 1, type: "area", vals: [W("C5:F5")] }, b: { n: 2, type: "area", vals: [W("C5:F5")] },
      c: { n: 3, type: "column", axis: "y2", vals: [W("C5:F5")] } }, marks: { r: { kind: "ref", value: T } } };
    const L0 = seriesLayout(c, c.box, ctx, M, { ...STY, trend: { w: 2, areaAsLine: true } }, "x");
    if ("why" in L0) throw new Error(L0.why);
    const L = L0 as SeriesLayout;
    expect(L.stackLines.length).toBe(2);                                       // (the template: stacked areas as stacked lines)
    expect(L.refs.map(r => [r.id, r.series])).toEqual([["r", false]]);
    expect(L.issue).toContain("reference line 'r' is a line shape in PowerPoint, not a series: the lines on its axis are stacked");
    expect(L.marks.native).toEqual([]);                                          // its line stays in the overlay
    const { seriesSem } = await import("../src/render/chart-series");
    const B = seriesSem(L);
    expect(B.series.length).toBe(3);
    expect(B.groups!.filter(g => g.kind === "line" && g.axis === "y").length).toBe(1);
    void item;
  });
  it("review of B52: a 100 % axis draws no reference line (nor a gap arrow to it) – one Issues line", async () => {
    const { ctx, it } = await deck("excel");
    const c: ChartItem = { ...it("tl"), type: "column", stack: "percent", axes: undefined, sers: { ...it("tl").sers, b: { n: 2, vals: [{ sheet: "Weekly", range: "C5:F5" }] } } };
    const L = layoutOf(c, ctx);
    expect(L.refs).toEqual([]);
    expect(L.scale.max).toBeLessThanOrEqual(1);
    expect(L.issue).toBe("reference line 'r1' is not drawn on a 100 % axis; reference line 'r2' is not drawn on a 100 % axis");
  });
  it("review of B52: on a stacked series the gap arrow is not drawn (its point is the stack's top), with an Issues line", async () => {
    const { ctx, it } = await deck("excel");
    const c: ChartItem = { ...it("tl"), type: "column", stack: "stacked", axes: undefined, sers: { ...it("tl").sers, b: { n: 2, vals: [{ sheet: "Weekly", range: "C5:F5" }] } } };
    const L = layoutOf(c, ctx);
    expect(L.marks.arrows).toEqual([]);
    expect(L.issue).toContain("gap 'xg': not drawn on a stacked series (its points stand on the stack, not on its values)");
  });
  it("review of B52: a budget cell the shown version empties hides its line and the gap arrow to it – one Issues line", async () => {
    const { ctx, it, item } = await deck("excel");
    const L = layoutOf(it("tl"), { ...ctx, version: { id: "v", name: "No budget", hide: { Targets: ["B3"] } } });
    expect(L.refs.map(r => r.id)).toEqual(["r2"]);
    expect(L.marks.arrows).toEqual([]);
    expect(L.issue).toBe("reference line 'r1': Targets!B3 is emptied by the version shown");
    expect(layoutOf(it("tl"), ctx).refs.length).toBe(2);                           // (the full deck keeps it)
    void item;
  });
  it("signed(): + / − / none for 0, in the format of the absolute value", () => {
    // (the decimal separator is the workbook's: the last one read here is Italian)
    expect([signed(12.5, "0.0"), signed(-3, "#,##0"), signed(0, "0")]).toEqual([expect.stringMatching(/^\+12[.,]5$/), NEG + "3", "0"]);
  });
  it("the sheets a deck reads include a reference line's value and name cells (a linked workbook's too)", () => {
    const c = { kind: "chart", type: "line", values: { sheet: "A", range: "B1:B2" }, box: { x: 0, y: 0, w: 1, h: 1 },
      marks: { r: { kind: "ref", value: { sheet: "[Plan.xlsx]Targets", range: "B3" }, name: { sheet: "Names", range: "A1" } } } };
    expect(itemSheets({ sheets: [], tables: [], slides: [{ id: "s", type: "content", tables: [], items: { c } }] } as never)).toEqual(["A", "[Plan.xlsx]Targets", "Names"]);
  });
});

describe("every design: the target-lines deck", () => {
  for (const design of DESIGNS) it(`${design}: valid, the picture without an Issues line, snapshots`, async () => {
    const { lists } = await deck(design);
    for (const l of lists) {
      expect(validate(l.nodes)).toEqual([]);
      for (const [id, x] of Object.entries(l.items)) {
        if (id === "tl") expect(x.issue, id).toBeNull();
        else expect(x.issue, id).toContain("a reference line on the left axis is drawn under the right axis's columns in PowerPoint");
        expect(summary(l.nodes.slice(x.at[0], x.at[1]))).toMatchSnapshot(id);
      }
    }
  });
  for (const design of DESIGNS) it(`${design}: as a PowerPoint file – native line charts with the reference lines as series, the gap arrow a line shape with a native head, the pills rounded rectangles; no picture, no connector shape, no link; the same bytes again`, async () => {
    const { lists, item } = await deck(design);
    const sem = semOf(item("tl").info), B = sem.bars!;
    // the reference lines: two line series of their values (never in the legend), on the secondary axes "on tick marks"
    expect(B.series.map(s => s.name)).toEqual(["Loans", "EoM budget", "Ambition"]);
    expect(B.series.slice(1).map(s => [s.values, s.marker, s.labels, s.f])).toEqual([[[11790, 11790, 11790, 11790], null, null, [null, "{TOP}", "{TOP}", "{TOP}"]], [[12000, 12000, 12000, 12000], null, null, [null, "{TOP}", "{TOP}", "{TOP}"]]]);
    expect(B.refAxis).toBe(true); expect(B.val2).toMatchObject({ min: B.val.min, max: B.val.max, show: false });
    expect(B.groups!.map(g => [g.kind, g.axis, g.series])).toEqual([["line", "y", [0]], ["line", "y2", [1, 2]]]);
    const x = chartXml(sem, "rId1", css => pptxFamily(css));
    expect(x).toMatch(/<c:valAx><c:axId val="510004"\/>.*<c:delete val="1"\/>.*<c:crossBetween val="midCat"\/>/);
    expect(x).toContain('<a:prstDash val="dash"/>');
    const book = unzipSync(chartWorkbook(sem)), sheet = strFromU8(book["xl/worksheets/sheet1.xml"]);
    expect(sheet).toMatch(/<c r="C3"( s="\d+")?><f>\$C\$2<\/f><v>11790<\/v><\/c>/);
    expect(sheet).toMatch(/<c r="C2"( s="\d+")?><v>11790<\/v><\/c>/);
    // the gap arrow: one line shape with a native end; the overlay: no reference line (the series draws it), the pills
    expect(sem.arrows!.length).toBe(1); expect(sem.arrows![0].tail).toBe("triangle");
    const ov = (item("tl").info.pptx as { overlay?: Node[] }).overlay ?? [];
    expect(ov.filter(n => n.t === "line" && n.x2 - n.x1 > 100)).toEqual([]);
    expect(ov.filter(n => n.t === "rect" && !!n.r).length).toBe(3);
    const bytes = pptxOf(lists), z = unzipSync(bytes);
    const charts = Object.keys(z).filter(n => /^ppt\/charts\/chart\d+\.xml$/.test(n)).sort();
    expect(charts.map(n => [...strFromU8(z[n]).matchAll(/<c:(lineChart|barChart)>/g)].map(m => m[1]).join("+")).sort()).toEqual(["lineChart+barChart", "lineChart+lineChart"]);
    const slides = Object.keys(z).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map(n => strFromU8(z[n]));
    for (const s of slides) { expect(s).not.toContain("<p:cxnSp"); expect(s).not.toContain("<p:pic"); }
    expect(slides[0]).toContain('prst="roundRect"'); expect(slides[0]).toMatch(/<a:tailEnd type="triangle"/);
    expect(slides[0]).toContain(NEG + "348"); expect(slides[0]).toContain("EoM budget 11.790");
    // (review of B52) one chart group per type and axis pair: slide 2's reference lines join its left axis's line group
    const B2 = semOf(item("tc").info).bars!;
    expect(B2.groups!.map(g => [g.kind, g.axis, g.series])).toEqual([["line", "y", [0, 2, 3]], ["bar", "y2", [1]]]);
    expect(B2.series.slice(2).map(s => s.name)).toEqual(["Floor (typed)", "Budget"]);
    for (const n of charts) {
      const seen = [...strFromU8(z[n]).matchAll(/<c:(lineChart|barChart|areaChart)>[\s\S]*?<c:axId val="(\d+)"\/>/g)].map(m => m[1] + "@" + m[2]);
      expect(new Set(seen).size, n).toBe(seen.length);
    }
    expect(Object.keys(z).some(n => n.endsWith(".rels") && /TargetMode="External"/.test(strFromU8(z[n])))).toBe(false);
    expect(Buffer.from(pptxOf(lists)).equals(Buffer.from(bytes))).toBe(true);
    if (process.env.CHART_PPTX_OUT) fs.writeFileSync(path.join(process.env.CHART_PPTX_OUT, `target-lines-${design}.pptx`), bytes);
  });
});

describe("B52 vectors and the format guard (shared/ops-vectors.d/b52.json)", () => {
  const mine = loadVectors().filter(v => /^B52 /.test(v.name));
  it("three cases", () => expect(mine.length).toBe(3));
  for (const v of mine) it(v.name.slice(0, 60) + "…: knownOp, needsV5 / V6 / V7, docNeedsV5 / V6 / V7", () => {
    expect(v.ops.every((op: Op) => knownOp(op))).toBe(true);
    expect(v.ops.map((op: Op) => needsV5(op))).toEqual(v.expect.needsV5);
    expect(v.ops.map((op: Op) => needsV6(op))).toEqual(v.expect.needsV6);
    expect(v.ops.map((op: Op) => needsV7(op))).toEqual(v.expect.needsV7);
    expect([docNeedsV5(v.expect), docNeedsV6(v.expect), docNeedsV7(v.expect)]).toEqual([v.expect.docNeedsV5, v.expect.docNeedsV6, v.expect.docNeedsV7]);
  });
  it("needsV7: a 4.10 kind, or a 4.10 key on any mark; a removal, 4.9's marks and other ops are not; knownOp refuses a later kind or key", () => {
    const ip = (marks: unknown) => ({ op: "item.patch", slide: "s1", id: "c", patch: { marks } }) as unknown as Op;
    for (const m of [{ r: { kind: "ref", value: 1 } }, { g: { kind: "gap", ref: "r" } }, { p: { kind: "change" } }, { a: { kind: "arrow", a: { s: "s", i: 0 }, off: true } }, { t: { kind: "text", text: "x", caption: "y" } }])
      expect([m, needsV7(ip(m))]).toEqual([m, true]);
    for (const m of [{ r: null }, { a: { kind: "arrow", a: { s: "s", i: 0 }, b: "floor", style: { w: 1 } } }, null])
      expect([m, needsV7(ip(m))]).toEqual([m, false]);
    expect(needsV7({ op: "item.patch", slide: "s1", id: "c", patch: { kind: "chart", type: "line", marks: { r: { kind: "ref", value: 1 } } } } as unknown as Op)).toBe(true);
    expect(needsV7({ op: "item.patch", slide: "s1", id: "c", patch: null } as unknown as Op)).toBe(false);
    expect(needsV7({ op: "version.patch", id: "v", patch: { drop: {} } } as unknown as Op)).toBe(false);
    expect(needsV7({ op: "preset.set", preset: { slides: [{ id: "s", items: { c: { kind: "chart", marks: { g: { kind: "gap" } } } } }] } } as unknown as Op)).toBe(true);
    expect(knownOp(ip({ x: { kind: "future" } }))).toBe(false);
    expect(knownOp(ip({ x: { kind: "ref", later: 1 } }))).toBe(false);
    expect(knownOp(ip({ x: { kind: "ref", value: 1, off: true } }))).toBe(true);
  });
});

// (a look at the slides: B52_PDF_OUT=<file.pdf> writes the deck's slides in every design as one PDF, Carlito for every text)
describe("preview", () => {
  it.runIf(!!process.env.B52_PDF_OUT)("writes the PDF", async () => {
    const { writePdf } = await import("../src/pdf/writer");
    const fontDir = path.join(here, "fixtures/fonts"), reg = new Uint8Array(fs.readFileSync(path.join(fontDir, "Carlito-Regular.ttf"))), bold = new Uint8Array(fs.readFileSync(path.join(fontDir, "Carlito-Bold.ttf")));
    const pages: DisplayList[] = [];
    for (const d of DESIGNS) pages.push(...(await deck(d)).lists.map(l => l.nodes));
    const pdf = writePdf({ pages, image: () => undefined, font: n => (n.b || (n.weight ?? 400) >= 600) ? { key: "b", data: bold } : { key: "r", data: reg } });
    fs.writeFileSync(process.env.B52_PDF_OUT!, pdf);
  });
});
