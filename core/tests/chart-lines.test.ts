/* Lines, areas, combo, second axis, category groups, targets, marks (S14.3; docs/next/09 §2.2, §3.1–§3.3, §4.2):
   CT-01 (line, smoothed line, area – in all five designs: DL snapshots of the chart corpus's lines deck), CT-03 (series
   from two sheets and a linked workbook in one chart, a group from another table), CT-04 (second value axis; combo
   column + line), CT-05 (per-point colours, markers, labels; label positions; ofTarget), CT-06 (marks in data
   coordinates follow a reload and a scenario value), the owner's reference chart "Loans Volume – Weekly Evolution"
   (09 §3.3; tests/corpus/charts/lines.json slide 1, the acceptance picture of CT-07 / G9), and the native PowerPoint
   chart made from the same layout: c:lineChart / c:areaChart / c:barChart groups, the secondary axes, multi-level
   categories, the target bars, the marks and dividers as plain shapes over the chart (no picture, no connector shape,
   no external link). CHART_PPTX_OUT=<folder> writes the PowerPoint files (pptxcheck runs on them). */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { validate, type DisplayList, type HitNode, type LineNode, type Node, type PathCmd, type PathNode, type RectNode, type TextNode } from "../src/dl/types";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, emptyDoc } from "../src/model/ops";
import { itemSheets, runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { slideToDisplayList, type ItemInfo, type SlideDL } from "../src/render/slide-dl";
import { computeLayout } from "../src/render/layout";
import { cachedChartNodes, chartKey, chartNodes } from "../src/render/chart-dl";
import { seriesData } from "../src/render/chart-data";
import { linePath, markerOf, markerPx, polyHitsBox, runs, strokeNear } from "../src/render/chart-lines";
import { stackAreas } from "../src/render/chart-area";
import { seriesLayout, seriesSem, type SeriesStyle } from "../src/render/chart-series";
import { lineKeyExtra } from "../src/render/chart-legend";
import { resolveIcon, setVendoredIcons } from "../src/render/icons";
import { installTabler } from "../src/icons";
import { glassVars } from "../src/render/glass-dl";
import { chartWorkbook, chartXml } from "../src/pptx/chart";
import { writePptx } from "../src/pptx/writer";
import type { ChartSem } from "../src/pptx/chart-sem";
import type { SlideSem } from "../src/pptx/scene";
import { pptxFamily } from "../src/text/resolve";
import { DESIGNS } from "../src/model/designs";
import { wrapLines } from "../src/text/lines";
import type { RenderCtx } from "../src/render/context";
import type { ChartItem, Design, Op } from "../src/model/types";
import type { Sheet } from "../src/xlsx/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const BOOKS = path.join(here, "../../tests/corpus/workbooks"), DECK = path.join(here, "../../tests/corpus/charts/lines.json");
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

/** the lines deck (tests/corpus/charts/lines.json, workbook loans-weekly.xlsx) in a design: its context and each slide's list */
async function deck(design: Design, opts: { sheet?: (n: string, S: Sheet | null) => Sheet | null; scenario?: string; patch?: Record<string, Partial<ChartItem>>; theme?: string } = {}) {
  const d = JSON.parse(fs.readFileSync(DECK, "utf8")) as { workbook: string; ops: Op[] };
  const wb = await readWorkbook(ab(path.join(BOOKS, d.workbook)));
  const ops = d.ops.map(o => o.op === "item.patch" && opts.patch?.[o.id] ? { ...o, patch: { ...o.patch, ...opts.patch[o.id] } } as Op : o);
  const { doc: view, skipped } = applyOps(emptyDoc("W.xlsx"), ops);
  expect(skipped).toEqual([]);
  // (theme: a colour theme the user picked – in Excel, one other than Aurora / Intesa Sanpaolo leaves the template's
  // chart rules out, B48: M14's own areas and colours)
  const style = resolveStyle({}, { ...view.style, design, ...(opts.theme ? { theme: { id: opts.theme, c1: "", c2: "", c3: "", c4: "", a1: "", a2: "" } } : {}) }), slides = runtimeSlides(wb, view.preset, "W.xlsx", design);
  const own = (n: string) => wb.sheets.find(s => s.name === n) || null;
  const ctx: RenderCtx = { style, edits: {}, slides, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "", sheet: n => opts.sheet ? opts.sheet(n, own(n)) : own(n), version: null, forExport: true, ...(opts.scenario ? { scenario: opts.scenario } : {}) };
  const lists = slides.map((R, i) => slideToDisplayList(R, i, ctx, R.tables.map(L => excelToDisplayList(L, ctx, M)), computeLayout(R, ctx).boxes, { wall: null, logo: null }, M, "1 October 2026", { sem: true }));
  const item = (id: string) => { const l = lists.find(x => x.items[id])!; return { list: l, info: l.items[id], nodes: l.nodes.slice(l.items[id].at[0], l.items[id].at[1]) }; };
  const it = (id: string) => view.preset!.slides.flatMap(s => Object.entries(s.items || {})).find(([k]) => k === id)![1] as ChartItem;
  return { wb, ctx, view, lists, item, it };
}
const semOf = (info: ItemInfo): ChartSem => { if (info.pptx?.kind !== "chart") throw new Error("no chart"); return info.pptx.chart; };
const pptxOf = (lists: SlideDL[]) => writePptx({ slides: lists.map(l => ({ nodes: l.nodes, sem: { type: "content" as const, items: Object.fromEntries(Object.entries(l.items).flatMap(([id, it]) => it.pptx ? [[id, it.pptx]] : [])), palette: [] } as SlideSem })), image: () => PNG, face: css => pptxFamily(css) });
const xml = (ch: ChartSem) => chartXml(ch, "rId1", css => pptxFamily(css));
const texts = (l: DisplayList) => flat(l).filter((n): n is TextNode => n.t === "text");

describe("the parts (chart-lines.ts, chart-area.ts)", () => {
  it("Catmull–Rom with tension ½ (09 §3.2): control points p1 + (p2 − p0)/6 and p2 − (p3 − p1)/6, ends duplicated; straight lines are L", () => {
    const p = [{ x: 0, y: 0 }, { x: 60, y: 30 }, { x: 120, y: 0 }, { x: 180, y: 60 }];
    expect(linePath(p, false)).toEqual([["M", 0, 0], ["L", 60, 30], ["L", 120, 0], ["L", 180, 60]]);
    const d = linePath(p, true);
    expect(d[1]).toEqual(["C", 10, 5, 40, 30, 60, 30]);                       // p0 = p1 at the start
    expect(d[2]).toEqual(["C", 80, 30, 100, -5, 120, 0]);                     // 60 + 120/6, 30 + 0/6; 120 − 120/6, 0 − 30/6
    expect(d[3]).toEqual(["C", 140, 5, 170, 50, 180, 60]);                    // p3 = p2 at the end
    // a gap breaks the line into runs; a run of one point draws no segment
    expect(runs([1, 2, null, 3, null, null, 4, 5])).toEqual([[1, 2], [3], [4, 5]]);
  });
  it("markers: none unless asked; size in whole points (PowerPoint's c:size), circle by default, ringed 1.5 px", () => {
    expect(markerOf(undefined, "#123456", "#FFFFFF")).toBeNull();
    expect(markerOf({ shape: "none" }, "#123456", "#FFFFFF")).toBeNull();
    const m = markerOf({ size: 9 }, "#123456", "#FFFFFF")!;
    expect(m).toEqual({ symbol: "circle", size: 5, color: "#123456", ring: "#FFFFFF", w: 1.5 });
    expect(markerPx(m)).toBeCloseTo(8.333, 3);
    expect(markerOf({ shape: "diamond", size: 1000, color: "#ff0000" }, "#123456", "#FFFFFF")).toMatchObject({ symbol: "diamond", size: 72, color: "#FF0000" });
  });
  it("areas: standard from zero, stacked on the series below, 100 % shares; a blank is zero (as PowerPoint draws it) and adds nothing", () => {
    const v = [[10, 20, null], [5, null, 8]], Z = (lo: number) => ({ lo, hi: lo, v: 0, blank: true });
    expect(stackAreas(v, "none").bands).toEqual([[{ lo: 0, hi: 10, v: 10 }, { lo: 0, hi: 20, v: 20 }, Z(0)], [{ lo: 0, hi: 5, v: 5 }, Z(0), { lo: 0, hi: 8, v: 8 }]]);
    const s = stackAreas(v, "stacked");
    expect(s.bands[1]).toEqual([{ lo: 10, hi: 15, v: 5 }, Z(20), { lo: 0, hi: 8, v: 8 }]);
    expect([s.lo, s.hi]).toEqual([0, 20]);
    expect(stackAreas([[1, 3], [3, 1]], "percent").bands[1]).toEqual([{ lo: .25, hi: 1, v: 3 }, { lo: .75, hi: 1, v: 1 }]);
  });
});

describe("the reference chart (09 §3.3): the owner's \"Loans Volume – Weekly Evolution\"", () => {
  it("its data: the weekly volumes on Weekly, the targets on Targets, two category groups side by side", async () => {
    const { ctx, it } = await deck("excel"), d = seriesData(it("ref"), ctx);
    if (!d.ok) throw new Error(d.why);
    expect(d.cats).toEqual(["Q3", "Week37", "Week38", "Week39", "Eom Budget", "EoM Ambition"]);
    expect(d.groups.map(g => [g.id, g.start, g.len])).toEqual([["wk", 0, 4], ["tgt", 4, 2]]);
    expect(d.series[0].vals).toEqual([11576, 11258, 11258, 11324, null, null]);
    expect(d.series[1].vals).toEqual([null, null, null, null, 11324, 11324]);
    expect(d.series[1].target).toEqual([null, null, null, null, 11624, 12000]);
    expect(d.issues).toEqual([]);
  });
  it("Excel: the smoothed line on the left axis 11.000–11.700, the actual-inside-target columns on the right axis 0–14.000, the divider, the marks", async () => {
    const { item } = await deck("excel"), { info, nodes } = item("ref");
    expect(info.issue).toBeNull();
    expect(validate(nodes)).toEqual([]);
    const T = texts(nodes), src = T.map(t => t.src);
    // the title (bold navy), its rule; no legend
    const title = T.find(t => t.src === "Loans Volume - Weekly Evolution")!;
    expect([title.weight, JSON.stringify(title.fill)]).toEqual([700, JSON.stringify({ solid: [31, 56, 100] })]);
    const lines = flat(nodes).filter((n): n is LineNode => n.t === "line");
    const rule = lines.find(l => l.y1 === l.y2 && l.stroke.w === 1.5 && l.y1 < 230)!;
    expect(rule.y1).toBeGreaterThan(title.y);
    // the axes: 11.000 … 11.700 by 100 on the left, 0 … 14.000 by 2.000 on the right (Italian thousands)
    expect(src.filter(t => /^11\.\d00$/.test(t))).toEqual(["11.000", "11.100", "11.200", "11.300", "11.400", "11.500", "11.600", "11.700"]);
    for (const t of ["0", "2.000", "4.000", "6.000", "8.000", "10.000", "12.000", "14.000"]) expect(src).toContain(t);
    const left = T.find(t => t.src === "11.700")!, right = T.find(t => t.src === "14.000")!;
    expect(right.x).toBeGreaterThan(left.x + 1000);
    // the categories in bold navy; the line's value labels above its points, bold navy
    for (const c of ["Q3", "Week37", "Week38", "Week39", "Eom Budget", "EoM Ambition"]) expect(T.find(t => t.src === c)?.weight, c).toBe(700);
    for (const v of ["11.576", "11.258", "11.324"]) expect(T.find(t => t.src === v && t.weight === 700), v).toBeTruthy();
    // the line: one smoothed path through four points (cubics); the markers, the first grey
    const paths = flat(nodes).filter((n): n is PathNode => n.t === "path");
    const line = paths.find(p => p.stroke && p.d.length === 4 && p.d.slice(1).every(c => c[0] === "C"))!;
    expect(line.stroke!.cap).toBe("round");
    expect(line.stroke!.join).toBe("round");
    const markers = paths.filter(p => p.fill && p.stroke && p.d.length === 6);
    expect(markers.map(p => JSON.stringify(p.fill))).toEqual([JSON.stringify({ solid: [166, 166, 166] }), ...Array(3).fill(JSON.stringify({ solid: [31, 56, 100] }))]);
    // Q3 is the highest point (11.576 of 11.000–11.700), Week37 / Week38 the lowest
    const [, y0] = line.d[0] as ["M", number, number], ys = line.d.slice(1).map(c => c[6] as number);
    expect(y0).toBeLessThan(Math.min(...ys));
    expect(ys[0]).toBe(ys[1]);
    // the target columns: the value filled (navy, grey) and the target outlined over it, the same width
    const rects = flat(nodes).filter((n): n is RectNode => n.t === "rect");
    const fills = rects.filter(r => r.fill && !r.stroke && r.w < 200), outlines = rects.filter(r => !r.fill && r.stroke && r.w < 200);
    expect(fills.map(r => JSON.stringify(r.fill))).toEqual([JSON.stringify({ solid: [31, 56, 100] }), JSON.stringify({ solid: [166, 166, 166] })]);
    expect(outlines.map(r => [r.x, r.w, r.stroke!.w])).toEqual(fills.map(r => [r.x, r.w, 1.5]));
    expect(outlines[0].y).toBeLessThan(fills[0].y);                                        // 11.624 above 11.324
    expect(outlines[1].y).toBeLessThan(outlines[0].y);                                     // 12.000 above 11.624
    expect(fills[0].y + fills[0].h).toBeCloseTo(outlines[0].y + outlines[0].h, 6);         // both stand on 0
    // ofTarget: 11.324 / 11.624 = 97 %, 11.324 / 12.000 = 94 %, white bold inside the end
    const pct = T.filter(t => / %$/.test(t.src));
    expect(pct.map(t => [t.src, t.weight, JSON.stringify(t.fill)])).toEqual([["97 %", 700, JSON.stringify({ solid: [255, 255, 255] })], ["94 %", 700, JSON.stringify({ solid: [255, 255, 255] })]]);
    expect(pct[0].y).toBeGreaterThan(fills[0].y);
    // the divider: dashed grey, between Week39 and Eom Budget, from the plot's top through the category labels
    const div = lines.find(l => l.x1 === l.x2 && l.stroke.dash)!;
    expect(JSON.stringify(div.stroke.paint)).toBe(JSON.stringify({ solid: [127, 127, 127] }));
    const w39 = T.find(t => t.src === "Week39")!, eb = T.find(t => t.src === "Eom Budget")!;
    expect(div.x1).toBeGreaterThan(w39.x + w39.w!);
    expect(div.x1).toBeLessThan(eb.x);
    expect(div.y2).toBeGreaterThan(eb.y);
    // the arrow: from the axis floor up to Q3's point (stopping at its marker), its triangle head at the top
    const arrow = lines.find(l => l.x1 === l.x2 && !l.stroke.dash && l.stroke.w === 1.5)!;
    expect(arrow.x1).toBeCloseTo(line.d[0][1] as number, 6);
    expect(arrow.y2).toBeGreaterThan(arrow.y1);
    expect(Math.abs(arrow.y2 - lines.find(l => l.y1 === l.y2 && l.stroke.w === 1 && l.x2 - l.x1 > 1000)!.y1)).toBeLessThan(.01);   // the floor = the axis line
    const head = paths.find(p => p.fill && !p.stroke && p.d.length === 4)!;
    expect(head.d[0]).toEqual(["M", arrow.x1, r1(arrow.y1 - 6)]);
    expect(arrow.y1 - 6).toBeGreaterThan(y0 + markerPx(markerOf({ size: 9 }, "#000000", "#FFFFFF")!) / 2);
    // the icons (tabler:target: since the merge with M15 the vendored Tabler target – stroked, round – no built-in
    // even-odd shape) and the texts above the target bars
    const nT = (resolveIcon("tabler:target") as { paths: PathCmd[][] }).paths.length;
    expect(paths.filter(p => p.rule === "evenodd")).toHaveLength(0);
    expect(paths.filter(p => !p.fill && p.stroke?.cap === "round" && p.stroke.join === "round" && p.stroke.w === 2.167)).toHaveLength(2 * nT);
    const t1 = T.find(t => t.src === "11.624" && t.size === 22)!, t2 = T.find(t => t.src === "12.000" && t.size === 22)!;
    expect(t1.y).toBeLessThan(outlines[0].y);
    expect(t2.y).toBeLessThan(outlines[1].y);
    // hits: a point per value (its own index in its group), a mark per mark
    const hits = flat(nodes).filter((n): n is HitNode => n.t === "hit");
    expect(hits.filter(h => h.kind === "point").map(h => h.id)).toEqual(["ref:act:0", "ref:act:1", "ref:vol:0", "ref:vol:1", "ref:vol:2", "ref:vol:3"]);
    expect(hits.filter(h => h.kind === "mark").map(h => h.id)).toEqual(["ref:ia", "ref:ib", "ref:start", "ref:ta", "ref:tb"]);
    // the frame round the chart
    expect(rects.some(r => r.stroke && !r.fill && r.w > 1300 && JSON.stringify(r.stroke.paint) === JSON.stringify({ solid: [217, 217, 217] }))).toBe(true);
  });
  for (const design of DESIGNS) it(`${design}: valid, no Issues line, every part – snapshot`, async () => {
    const { item } = await deck(design), { info, nodes } = item("ref");
    expect(validate(nodes)).toEqual([]);
    expect(info.issue).toBeNull();
    expect(texts(nodes).map(t => t.src)).toEqual(expect.arrayContaining(["97 %", "94 %", "11.624", "12.000", "Loans Volume - Weekly Evolution"]));
    expect(summary(nodes)).toMatchSnapshot();
  });
  it("PowerPoint: a line group on the primary axes, the target columns on the secondary ones, the marks and the divider over the chart as plain shapes", async () => {
    const { item, lists } = await deck("excel"), { info } = item("ref"), ch = semOf(info), B = ch.bars!;
    expect(ch.type).toBe("combo");
    expect(B.groups!.map(g => [g.kind, g.axis, g.overlap, g.series])).toEqual([["line", "y", 0, [0]], ["bar", "y2", 100, [1, 2]]]);
    expect([B.val.min, B.val.max, B.val.step, B.val2!.min, B.val2!.max, B.val2!.step]).toEqual([11000, 11700, 100, 0, 14000, 2000]);
    expect(B.series[2]).toMatchObject({ name: "Loans – target", values: [null, null, null, null, 11624, 12000], target: { w: 1.5 } });
    expect(B.legend).toBeNull();
    const x = xml(ch);
    expect(x).toContain('<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>');
    expect(x).toContain("<c:smooth val=\"1\"/>");
    expect(x).toContain('<c:marker><c:symbol val="circle"/><c:size val="5"/>');
    expect(x).toMatch(/<c:dPt><c:idx val="0"\/><c:marker><c:symbol val="circle"\/><c:size val="5"\/><c:spPr><a:solidFill><a:srgbClr val="A6A6A6"\/>/);
    expect(x).toContain('<c:dLblPos val="t"/>');
    // the columns: the actual (per-point navy / grey) and its target (no fill, outlined) at overlap 100 on axes 510003 / 510004
    expect(x).toMatch(/<c:barChart><c:barDir val="col"\/><c:grouping val="clustered"\/><c:varyColors val="0"\/><c:ser><c:idx val="1"\/>.*<c:ser><c:idx val="2"\/>.*<c:gapWidth val="150"\/><c:overlap val="100"\/><c:axId val="510003"\/><c:axId val="510004"\/><\/c:barChart>/);
    expect(x).toContain('<c:dPt><c:idx val="4"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="1F3864"/>');
    expect(x).toContain('<c:spPr><a:noFill/><a:ln w="11430"><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill></a:ln></c:spPr>');
    expect(x).toMatch(/<c:dLbl><c:idx val="4"\/><c:tx><c:rich>.*?<a:t>97 %<\/a:t>.*?<c:dLblPos val="inEnd"\/>/);
    expect(x).toMatch(/<c:dLbl><c:idx val="5"\/><c:tx><c:rich>.*?<a:t>94 %<\/a:t>/);
    // the secondary axes: a hidden category axis, the value axis on the right crossing at the end
    expect(x).toContain('<c:catAx><c:axId val="510003"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/>');
    expect(x).toMatch(/<c:valAx><c:axId val="510004"\/><c:scaling><c:orientation val="minMax"\/><c:max val="14000"\/><c:min val="0"\/><\/c:scaling><c:delete val="0"\/><c:axPos val="r"\/>.*<c:crossAx val="510003"\/><c:crosses val="max"\/><c:crossBetween val="between"\/><c:majorUnit val="2000"\/><\/c:valAx>/);
    expect(x).not.toContain("<c:legend>");
    for (const m of x.matchAll(/<c:f>([^<]*)<\/c:f>/g)) expect(m[1]).toMatch(/^Sheet1!\$[A-D]\$\d+(:\$[A-D]\$\d+)?$/);
    // the embedded workbook: categories, the line, the actual, the target – blanks where a series has none
    const book = strFromU8(unzipSync(chartWorkbook(ch))["xl/worksheets/sheet1.xml"]);
    expect(book).toContain('<dimension ref="A1:D7"/>');
    expect(book).toContain('<c r="B2" s="1"><v>11576</v></c></row>');
    expect(book).toContain('<c r="C6" s="1"><v>11324</v></c><c r="D6" s="1"><v>11624</v></c>');
    // over the chart: the divider, the icons, the texts – plain shapes in the chart's group; the arrow (S14.6) one line
    // shape with a native head from the chart's semantics, not its display list's line and triangle
    if (info.pptx?.kind !== "chart") throw new Error();
    const over = info.pptx.overlay!;
    const nT = (resolveIcon("tabler:target") as { paths: PathCmd[][] }).paths.length;    // the two vendored targets' paths
    expect(over.map(n => n.t)).toEqual(["line", ...Array(2 * nT).fill("path"), "text", "text"]);
    expect(ch.arrows).toHaveLength(1);
    expect(ch.arrows![0]).toMatchObject({ head: "triangle" });
    expect(ch.arrows![0].tail).toBeUndefined();
    expect(flat(info.pptx.card).some(n => n.t === "line" && n.stroke.w === 1.5)).toBe(true);    // the title's rule, under the chart
    const z = unzipSync(pptxOf(lists)), slide = strFromU8(z["ppt/slides/slide1.xml"]);
    expect((slide.match(/<c:chart /g) || []).length).toBe(1);
    expect(slide).not.toContain("<p:cxnSp");
    expect(slide).not.toContain("<p:pic");
    // the arrow: a plain line shape (prst line) whose a:ln ends in a native triangle at its first point – the point
    expect(slide).toMatch(/<p:cNvPr id="\d+" name="Arrow \d+"\/>.*?<a:prstGeom prst="line">.*?<a:ln w="11430"[^>]*>.*?<a:headEnd type="triangle" w="med" len="med"\/><\/a:ln>/s);
    expect(slide).not.toContain("<a:tailEnd");
    expect(slide).toMatch(/<p:grpSp><p:nvGrpSpPr><p:cNvPr id="\d+" name="Chart ref \d+"\/>.*<p:graphicFrame>.*<\/p:graphicFrame>.*<p:sp>.*11\.624.*<\/p:grpSp>/s);
    expect(Object.keys(z).some(n => n.endsWith(".rels") && /TargetMode="External"/.test(strFromU8(z[n])))).toBe(false);
  });
});

describe("lines and areas in every design (CT-01), the chart corpus's lines deck", () => {
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
  it("a line chart: one path per series, markers of each shape, a dashed smoothed line, the labels above / below, a point's own label and marker colour", async () => {
    const { item } = await deck("excel"), { nodes } = item("ln");
    const paths = flat(nodes).filter((n): n is PathNode => n.t === "path");
    const strokes = paths.filter(p => p.stroke && !p.fill);
    expect(strokes).toHaveLength(3 + 0);
    expect(strokes[1].stroke!.dash).toEqual([8, 6]);                      // dashed, 2 px: PowerPoint's dash 4:3
    expect(strokes[1].d.slice(1).every(c => c[0] === "C")).toBe(true);    // smoothed
    expect(strokes[0].d.slice(1).every(c => c[0] === "L")).toBe(true);
    const marks = paths.filter(p => p.fill && p.stroke);
    expect(marks.filter(p => p.d.length === 6)).toHaveLength(6 + 1);     // circles (4 cubics + M + Z), one in the legend
    expect(marks.filter(p => p.d.length === 5).length).toBe(12 + 2);      // diamonds and squares
    expect(marks.some(p => JSON.stringify(p.fill) === JSON.stringify({ solid: [192, 0, 0] }))).toBe(true);
    const T = texts(nodes);
    expect(T.some(t => t.src === "Low")).toBe(true);
    const r530 = T.find(t => t.src === "530")!, s176 = T.find(t => t.src === "176")!;
    const top = (v: string) => { const t = T.find(x => x.src === v)!; return t.y; };
    expect(r530.y).toBeLessThan(top("176"));                              // Retail above its line, SME below its own
    expect(s176).toBeTruthy();
    // the legend: a line swatch (and its marker) per series
    expect(flat(nodes).filter(n => n.t === "line" && n.x2 - n.x1 >= 16 && n.x2 - n.x1 <= 18).length).toBe(3);
  });
  it("a stacked area chart: closed paths, each on the one below, alpha .85; SME drawn but out of the legend", async () => {
    // (Excel with a colour theme of the user's: the template's "areas as lines" does not apply – see the next test)
    const { item } = await deck("excel", { theme: "forest" }), { nodes, info } = item("ar");
    const areas = flat(nodes).filter((n): n is PathNode => n.t === "path" && !!n.fill && "solid" in n.fill && n.fill.a === .85);
    expect(areas).toHaveLength(3);
    expect(areas.every(a => a.d[a.d.length - 1][0] === "Z")).toBe(true);
    // Corporate's top edge is SME… no: series order – Retail at the bottom, Corporate on it, SME on top
    const yAt = (p: PathNode) => p.d[0][2] as number;
    expect(yAt(areas[1])).toBeLessThan(yAt(areas[0]));
    expect(yAt(areas[2])).toBeLessThan(yAt(areas[1]));
    expect(texts(nodes).some(t => t.src === "SME")).toBe(false);
    const x = xml(semOf(info));
    expect(x).toContain('<c:areaChart><c:grouping val="stacked"/><c:varyColors val="0"/>');
    expect(x).toMatch(/<c:legendEntry><c:idx val="2"\/><c:delete val="1"\/><\/c:legendEntry>/);
    expect(x).toContain('<a:solidFill><a:srgbClr val="4472C4"><a:alpha val="85000"/></a:srgbClr></a:solidFill>');
    expect(x.match(/<c:areaChart>.*<\/c:areaChart>/)![0]).not.toContain("<c:dLblPos");   // an area's labels take no position
  });
  it("the Excel designs' template (B48 · ISP.chart, M14 merge): trend charts as a line only – the stacked areas as stacked lines of the template's width, in its palette; the slide and PowerPoint alike", async () => {
    for (const design of ["excel", "clean"] as Design[]) {
      const { item } = await deck(design), { nodes, info } = item("ar");
      const P = flat(nodes).filter((n): n is PathNode => n.t === "path");
      expect(P.filter(p => p.fill && "solid" in p.fill && p.fill.a === .85)).toEqual([]);           // no area
      const lines = P.filter(p => p.stroke && !p.fill);
      expect(lines).toHaveLength(3);
      expect(lines.every(l => Math.abs(l.stroke!.w - 10 / 3) < 1e-3)).toBe(true);                    // 1.5 pt on the template = 3.33 px
      // each on the top of the series below it (Retail, Corporate, SME), as the areas were
      const yAt = (p: PathNode) => p.d[0][2] as number;
      expect(yAt(lines[1])).toBeLessThan(yAt(lines[0]));
      expect(yAt(lines[2])).toBeLessThan(yAt(lines[1]));
      // the template's palette (25 % transparency: blue #406B9B first) – and PowerPoint's chart the same: a stacked line
      // chart, no area chart, the template's colours and width
      expect(JSON.stringify(lines[0].stroke!.paint)).toBe(JSON.stringify({ solid: [0x40, 0x6B, 0x9B] }));
      const x = xml(semOf(info));
      expect(x).not.toContain("<c:areaChart>");
      expect(x).toContain('<c:lineChart><c:grouping val="stacked"/><c:varyColors val="0"/>');
      expect(x).toContain('<a:ln w="25400" cap="rnd"><a:solidFill><a:srgbClr val="406B9B"/>');
      expect(x).toContain('<a:srgbClr val="F18B40"/>');
      // the line chart's own lines: the template's width too
      const ln = flat(item("ln").nodes).filter((n): n is PathNode => n.t === "path" && !!n.stroke && !n.fill);
      expect(ln.filter(l => !l.stroke!.dash).every(l => Math.abs(l.stroke!.w - 10 / 3) < 1e-3)).toBe(true);
    }
    // Liquid Glass and the consulting designs: areas stay areas, lines 2.5 px (M14)
    for (const design of ["glass", "mckinsey", "bain"] as Design[]) {
      const { item } = await deck(design), { nodes, info } = item("ar");
      expect(flat(nodes).filter(n => n.t === "path" && !!n.fill && "solid" in n.fill && n.fill.a === .85)).toHaveLength(3);
      expect(xml(semOf(info))).toContain('<c:areaChart><c:grouping val="stacked"/>');
    }
  });
});

describe("second value axis, combo column + line (CT-04)", () => {
  it("the right axis is drawn only when a shown series stands on it; the line on its own scale, the columns on the left one", async () => {
    const { item } = await deck("excel"), { nodes, info } = item("cb"), T = texts(nodes);
    for (const t of ["0,0 %", "1,5 %", "3,0 %"]) expect(T.map(x => x.src), t).toContain(t);
    const ch = semOf(info);
    expect(ch.bars!.groups!.map(g => [g.kind, g.axis])).toEqual([["bar", "y"], ["line", "y2"]]);
    expect(ch.bars!.val2).toMatchObject({ min: 0, max: 3, step: .5, num: "0.0\" %\"" });
    // the line's points on the right axis: 2,8 % at 2.8 / 3 of the plot's height
    const L = (await deck("excel", { patch: { cb: { sers: { ...((await deck("excel")).it("cb").sers!), m: { ...(await deck("excel")).it("cb").sers!.m, hide: true } } } } })).item("cb");
    expect(texts(L.nodes).map(x => x.src)).not.toContain("1,5 %");
    expect(semOf(L.info).bars!.val2).toBeNull();
    const x = xml(ch);
    expect(x).toMatch(/<c:barChart>.*<c:axId val="510001"\/><c:axId val="510002"\/><\/c:barChart><c:lineChart>.*<c:axId val="510003"\/><c:axId val="510004"\/><\/c:lineChart>/);
    expect(x).toContain('<c:marker><c:symbol val="diamond"/>');
    expect(x).toMatch(/<c:legend><c:legendPos val="t"\/><c:legendEntry><c:idx val="1"\/><c:delete val="1"\/>/);
  });
  it("y2 alone (no series on y) draws on the left axis, as Excel needs a primary axis", async () => {
    const { ctx } = await deck("excel");
    const it: ChartItem = { kind: "chart", type: "line", values: { sheet: "Gallery", range: "B2:G2" }, box: { x: 0, y: 0, w: 600, h: 400 }, sers: { a: { n: 1, axis: "y2", vals: [{ sheet: "Gallery", range: "B2:G2" }] } } };
    const L = seriesLayout(it, it.box, ctx, M, STY);
    if ("why" in L) throw new Error(L.why);
    expect(L.axes).toEqual(["y"]);
    expect(L.y2).toBeNull();
  });
});

describe("category groups, per-point looks and labels (CT-05), sources (CT-03)", () => {
  it("two named groups: their labels in a second row, the divider between them; PowerPoint: multi-level categories", async () => {
    const { item } = await deck("excel"), { nodes, info } = item("gr"), T = texts(nodes);
    const h1 = T.find(t => t.src === "H1")!, jan = T.find(t => t.src === "Jan")!;
    expect(h1.y).toBeGreaterThan(jan.y);
    const div = flat(nodes).find((n): n is LineNode => n.t === "line" && n.x1 === n.x2 && !!n.stroke.dash)!;
    const mar = T.find(t => t.src === "Mar")!, apr = T.find(t => t.src === "Apr")!;
    expect(div.x1).toBeGreaterThan(mar.x + mar.w!);
    expect(div.x1).toBeLessThan(apr.x);
    expect(div.stroke.dash).toEqual([1.5, 1.5]);
    const ch = semOf(info), x = xml(ch);
    expect(ch.bars!.levels).toEqual(["H1", "", "", "H2", "", ""]);
    expect(x).toContain('<c:cat><c:multiLvlStrRef><c:f>Sheet1!$A$2:$B$7</c:f><c:multiLvlStrCache><c:ptCount val="6"/><c:lvl><c:pt idx="0"><c:v>Jan</c:v></c:pt>');
    expect(x).toContain('<c:lvl><c:pt idx="0"><c:v>H1</c:v></c:pt><c:pt idx="3"><c:v>H2</c:v></c:pt></c:lvl>');
    expect(x).toContain("<c:f>Sheet1!$C$2:$C$7</c:f>");                   // the first series after the two category columns
    const book = strFromU8(unzipSync(chartWorkbook(ch))["xl/worksheets/sheet1.xml"]);
    expect(book).toMatch(/<row r="2"><c r="A2" t="inlineStr"><is><t xml:space="preserve">H1<\/t><\/is><\/c><c r="B2" t="inlineStr"><is><t xml:space="preserve">Jan<\/t>/);
    // the mark from the group's edge, the icon above a column
    const hits = flat(nodes).filter((n): n is HitNode => n.t === "hit" && n.kind === "mark");
    expect(hits.map(h => h.id)).toEqual(["gr:edge", "gr:flag"]);
  });
  it("label positions above / below / left / right / center; one that would overlap its neighbour moves to the other side, else is left out", async () => {
    const { ctx } = await deck("excel");
    const same = { sheet: "Gallery", range: "B2:G2" };
    const at = (pos: "above" | "below" | "left" | "right" | "center") => {
      const it: ChartItem = { kind: "chart", type: "line", values: same, box: { x: 0, y: 0, w: 900, h: 500 }, sers: { a: { n: 1, vals: [same], labels: { show: ["value"], pos } } } };
      const L = seriesLayout(it, it.box, ctx, M, STY);
      if ("why" in L) throw new Error(L.why);
      return L;
    };
    const tr = (L: ReturnType<typeof at>) => L.traces[0].pts[0]!;
    const up = at("above"), dn = at("below"), lf = at("left"), rt = at("right"), ct = at("center");
    expect(up.labs[0].top + 17).toBeLessThanOrEqual(tr(up).y);
    expect(dn.labs[0].top).toBeGreaterThan(tr(dn).y);
    expect([lf.labs[0].align, rt.labels[0]!.pos, ct.labels[0]!.pos, up.labels[0]!.pos]).toEqual(["right", "r", "ctr", "t"]);
    // a crowded chart: neighbours' labels collide – a falling line's next label moves below its point; where both sides
    // are taken it is left out; never on top of another
    const G = ctx.sheet!("Gallery")!, fall = Object.create(G) as Sheet;
    fall.get = (r: number, c: number) => r === 2 && c >= 2 && c <= 7 ? { ...G.get(r, c)!, v: 500 - 6 * (c - 2) } : G.get(r, c);
    const c3: RenderCtx = { ...ctx, sheet: n => n === "Gallery" ? fall : ctx.sheet!(n) };
    const it: ChartItem = { kind: "chart", type: "line", values: same, box: { x: 0, y: 0, w: 140, h: 300 }, axes: { y: { min: 0, max: 1000 } }, sers: { a: { n: 1, vals: [same], labels: { show: ["value"], pos: "above" } } } };
    const L = seriesLayout(it, it.box, c3, M, STY);
    if ("why" in L) throw new Error(L.why);
    const boxes = L.labs.map(l => ({ x: l.align === "center" ? l.x - l.text.length * 3.5 : l.x, y: l.top, w: l.text.length * 7, h: 17 }));
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      const p = boxes[a], q = boxes[b];
      expect(p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h, `${a} ${b}`).toBe(false);
    }
    const pts = L.labels[0]!.points;
    expect(pts.some(p => p.pos === "b")).toBe(true);
    expect(pts.length).toBeGreaterThan(0);
  });
  it("ofTarget: the value ÷ its target in the label's own percentage format; no target or a zero one, no label", async () => {
    const { ctx } = await deck("excel");
    const base = (await deck("excel")).it("ref");
    const own: ChartItem = { ...base, sers: { ...base.sers!, act: { ...base.sers!.act, labels: { show: ["ofTarget"], pos: "inEnd", num: "0.0%" } } } };
    const L = seriesLayout(own, own.box, ctx, M, STY);
    if ("why" in L) throw new Error(L.why);
    expect(L.labs.filter(l => l.s === 1).map(l => l.text)).toEqual(["97,4%", "94,4%"]);
    const none: ChartItem = { ...base, sers: { ...base.sers!, act: { ...base.sers!.act, target: [{ sheet: "Weekly", range: "B3:C3" }] } } };
    const N = seriesLayout(none, none.box, ctx, M, STY);
    if ("why" in N) throw new Error(N.why);
    expect(N.labs.filter(l => l.s === 1)).toEqual([]);
    expect(N.labels[1]!.points.map(p => p.hide)).toEqual([true, true]);
  });
  it("series from two sheets and a linked workbook in one chart (a line and columns), a group from another sheet: caches = the cells, every formula into the embedded workbook", async () => {
    const { ctx, wb, it } = await deck("excel");
    const G = wb.sheets.find(s => s.name === "Gallery")!, plan = Object.create(G) as Sheet;
    Object.defineProperty(plan, "name", { value: "[Budget.xlsx]Plan" });
    plan.get = (r: number, c: number) => { const x = G.get(r, c); return x && x.t === "n" ? { ...x, v: (x.v as number) * 2 } : x; };
    const c2: RenderCtx = { ...ctx, sheet: n => n === "[Budget.xlsx]Plan" ? plan : ctx.sheet!(n) };
    const item: ChartItem = { kind: "chart", type: "combo", values: { sheet: "Weekly", range: "C5:F5" }, box: { x: 100, y: 200, w: 1200, h: 560 },
      groups: { g: { n: 1, cats: { sheet: "Weekly", range: "C4:F4" } } },
      sers: { w: { n: 1, type: "line", vals: [{ sheet: "Weekly", range: "C5:E5" }, { sheet: "Targets", range: "B3" }] }, p: { n: 2, axis: "y2", vals: [{ sheet: "[Budget.xlsx]Plan", range: "B2:E2" }], name: { sheet: "Gallery", range: "A2" } } } };
    const d = seriesData(item, c2);
    if (!d.ok) throw new Error(d.why);
    expect(d.series.map(s => [s.name, s.vals])).toEqual([["Loans", [11576, 11258, 11258, 11624]], ["Retail", [840, 910, 940, 1020]]]);
    const preset = { sheets: [], tables: [], slides: [{ id: "s", type: "content", tables: [], items: { x: item } }] } as never;
    expect(itemSheets(preset)).toEqual(["Weekly", "Targets", "[Budget.xlsx]Plan", "Gallery"]);
    const out = chartNodes(item, "x", item.box, c2, M, { V: glassVars(c2), wall: null, family: "Arial" });
    // (every source read; the one Issues line is the draw order: a left axis's line through the right axis's columns,
    // which PowerPoint draws over it – S14.3 review 8)
    expect(out.issue).toBe("'Loans' (left axis) is drawn under 'Retail' (right axis) in PowerPoint, which draws the right axis's columns over the left axis's series");
    // (the reference chart's text marks quote Targets: that sheet is read for it too)
    expect(itemSheets({ sheets: [], tables: [], slides: [{ id: "s", type: "content", tables: [], items: { ref: it("ref") } }] } as never)).toEqual(["Weekly", "Targets"]);
  });
});

describe("marks follow the data (CT-06): a reload, a scenario's value, a version's removed cell", () => {
  afterEach(() => installTabler());     // the set as tests/setup-icons.ts registers it (the workers' set)
  const arrowTop = (nodes: DisplayList) => flat(nodes).find((n): n is LineNode => n.t === "line" && n.x1 === n.x2 && n.stroke.w === 1.5 && !n.stroke.dash)!.y1;
  it("a scenario's Q3 value moves the arrow's tip and its label; a reloaded Targets sheet changes the text marks and the targets", async () => {
    const a = await deck("excel"), base = a.item("ref").nodes;
    const W = a.wb.sheets.find(s => s.name === "Weekly")!, view = Object.create(W) as Sheet;
    view.get = (r: number, c: number) => r === 5 && c === 3 ? { ...W.get(r, c)!, v: 11100 } : W.get(r, c);
    const b = await deck("excel", { sheet: (n, S) => n === "Weekly" ? view : S, scenario: "h1" }), moved = b.item("ref").nodes;
    expect(arrowTop(moved)).toBeGreaterThan(arrowTop(base) + 300);
    expect(texts(moved).some(t => t.src === "11.100" && t.weight === 700)).toBe(true);
    expect(chartKey(b.it("ref"), b.ctx)).not.toBe(chartKey(a.it("ref"), a.ctx));
    // a reload of Targets (another sheet object: another key), with new targets
    const T = a.wb.sheets.find(s => s.name === "Targets")!, re = Object.create(T) as Sheet;
    re.get = (r: number, c: number) => r === 3 && c === 2 ? { ...T.get(r, c)!, v: 11900 } : T.get(r, c);
    const c = await deck("excel", { sheet: (n, S) => n === "Targets" ? re : S }), rn = c.item("ref").nodes;
    expect(texts(rn).some(t => t.src === "11.900" && t.size === 22)).toBe(true);
    expect(texts(rn).some(t => t.src === "95 %")).toBe(true);                              // 11.324 / 11.900
    expect(chartKey(c.it("ref"), c.ctx)).not.toBe(chartKey(a.it("ref"), a.ctx));
    // the PowerPoint overlay follows too: the text mark's new value
    const over = c.item("ref").info.pptx;
    expect(over?.kind === "chart" && over.overlay!.some(n => n.t === "text" && n.src === "11.900")).toBe(true);
  });
  it("a version that removes Q3's cell: no point, so no arrow – and no Issues line (a gap is data, not a mistake)", async () => {
    const a = await deck("excel");
    const ctx: RenderCtx = { ...a.ctx, version: { id: "v", name: "V", hide: { Weekly: ["C5"] } } };
    const out = chartNodes(a.it("ref"), "ref", a.it("ref").box, ctx, M, { V: glassVars(ctx), wall: null, family: "Arial" });
    expect(out.issue).toBeNull();
    expect(flat(out.nodes).some(n => n.t === "hit" && n.id === "ref:start")).toBe(false);
  });
  it("icons: the vendored Tabler icon once registered (stroked, round), the built-in until then; an unknown one an Issues line; an unknown series too", async () => {
    const ring: ["M", number, number][] = [["M", 2, 12]];
    setVendoredIcons((set, name) => set === "tabler" && name === "target" ? [[...ring, ["L", 22, 12]]] : null);
    const a = await deck("excel"), it = a.it("ref");
    const out = chartNodes({ ...it, title: "Vendored" }, "ref", it.box, a.ctx, M, { V: glassVars(a.ctx), wall: null, family: "Arial" });
    const strokes = flat(out.nodes).filter((n): n is PathNode => n.t === "path" && !!n.stroke && n.d.length === 2);
    expect(strokes).toHaveLength(2);
    expect(strokes[0].stroke).toMatchObject({ w: 2.167, cap: "round", join: "round" });
    const bad: ChartItem = { ...it, marks: { ...it.marks!, ib: { ...it.marks!.ib, icon: "tabler:nope" }, x: { kind: "text", text: "?", a: { s: "gone", i: 0 } } } };
    const b = chartNodes(bad, "ref", it.box, a.ctx, M, { V: glassVars(a.ctx), wall: null, family: "Arial" });
    expect(b.issue).toBe("mark 'ib': icon 'tabler:nope' not found; mark 'x': series 'gone' not found");
    // a hidden series' marks are not drawn, and say nothing
    const hid = chartNodes({ ...it, sers: { ...it.sers!, act: { ...it.sers!.act, hide: true } } }, "ref", it.box, a.ctx, M, { V: glassVars(a.ctx), wall: null, family: "Arial" });
    expect(hid.issue).toBeNull();
    expect(flat(hid.nodes).filter(n => n.t === "hit" && n.kind === "mark").map(n => (n as HitNode).id)).toEqual(["ref:start"]);
  });
  it("an icon mark draws a vendored icon through vendoredNodes: each path painted as the set says (M14 × M15 merge)", async () => {
    // an outline icon with a stroked ring, a filled-only dot and a half-ink stroked path (brand-parsinta's kind)
    const ring: PathCmd[] = [["M", 2, 12], ["L", 22, 12]], dot: PathCmd[] = [["M", 11, 11], ["L", 13, 11], ["L", 13, 13], ["Z"]], half: PathCmd[] = [["M", 12, 2], ["L", 12, 22]];
    setVendoredIcons((set, name) => set === "tabler" && name === "target"
      ? { paths: [ring, dot, half], paint: [{ stroke: true, fill: false, alpha: 1 }, { stroke: false, fill: true, alpha: 1 }, { stroke: true, fill: false, alpha: .5 }] } : null);
    const a = await deck("excel"), it = a.it("ref");
    const out = chartNodes({ ...it, title: "Painted" }, "ref", it.box, a.ctx, M, { V: glassVars(a.ctx), wall: null, family: "Arial" });
    const P = flat(out.nodes).filter((n): n is PathNode => n.t === "path" && (n.d.length === 2 || n.d.length === 4) && (n.d[0][1] === n.d[1][1] || n.d[0][2] === n.d[1][2]));
    const filled = P.filter(n => n.fill && !n.stroke && n.d.length === 4), halfInk = P.filter(n => n.stroke && "a" in n.stroke.paint && n.stroke.paint.a === .5);
    expect(filled).toHaveLength(2);                        // the dot of each of the two target icons, filled, not stroked
    expect(halfInk).toHaveLength(2);                       // the half-ink path at alpha .5
    expect(halfInk[0].stroke).toMatchObject({ cap: "round", join: "round" });
    expect(P.filter(n => n.stroke && !("a" in n.stroke.paint && n.stroke.paint.a !== undefined) && n.d.length === 2)).toHaveLength(2);
  });
  it("marks at data coordinates: a band between two categories and values, a reference line at a value on the right axis", async () => {
    const { item } = await deck("excel"), { nodes } = item("cb");
    const band = flat(nodes).find((n): n is RectNode => n.t === "rect" && !!n.fill && "solid" in n.fill && n.fill.a === .15)!;
    const T = texts(nodes), apr = T.find(t => t.src === "Apr")!, jun = T.find(t => t.src === "Jun")!;
    expect(band.x).toBeCloseTo(apr.x + apr.w! / 2, 0);
    expect(band.x + band.w).toBeCloseTo(jun.x + jun.w! / 2, 0);
    const ref = flat(nodes).find((n): n is LineNode => n.t === "line" && n.y1 === n.y2 && JSON.stringify(n.stroke.paint) === JSON.stringify({ solid: [192, 0, 0] }))!;
    const t25 = T.find(t => t.src === "2,5 %")!, t20 = T.find(t => t.src === "2,0 %")!;
    expect(ref.y1).toBeLessThan(t20.y);
    expect(ref.y1).toBeGreaterThan(t25.y - 17);
  });
});

describe("S14.3 review: the export as the slide", () => {
  /** the Gallery sheet with some cells blank ("r,c") */
  const blanks = (...rc: string[]) => (n: string, S: Sheet | null): Sheet | null => {
    if (n !== "Gallery" || !S) return S;
    const B = Object.create(S) as Sheet;
    B.get = (r: number, c: number) => rc.includes(`${r},${c}`) ? null : S.get(r, c);
    return B;
  };
  const legendLayout = (x: string) => { const m = /<c:legend>.*?<c:manualLayout><c:xMode val="edge"\/><c:yMode val="edge"\/><c:x val="([^"]+)"\/><c:y val="([^"]+)"\/><c:w val="([^"]+)"\/><c:h val="([^"]+)"\/>/.exec(x); return m ? m.slice(1).map(Number) : null; };

  it("(2) an area's blank is drawn as zero on the slide – one band, no label, no hit there – and cached as a blank, which PowerPoint draws as zero", async () => {
    // Corporate's Mar (D3) blank in the stacked areas: its band drops onto Retail's top there
    // (Excel with a colour theme of the user's: M14's areas – the template draws them as lines)
    const { item, lists } = await deck("excel", { sheet: blanks("3,4"), theme: "forest" }), { nodes, info } = item("ar");
    if (process.env.CHART_PPTX_OUT) fs.writeFileSync(path.join(process.env.CHART_PPTX_OUT, "area-blank-excel.pptx"), pptxOf(lists));
    const areas = flat(nodes).filter((n): n is PathNode => n.t === "path" && !!n.fill && "solid" in n.fill && n.fill.a === .85);
    expect(areas).toHaveLength(3);                                         // not broken into two runs
    expect(areas.every(a => a.d.filter(c => c[0] === "M").length === 1 && a.d[a.d.length - 1][0] === "Z")).toBe(true);
    const corp = areas[1], n = 6, half = (corp.d.length - 1) / 2;          // M, 5 L along the top, 6 L back along the base, Z
    const top = corp.d.slice(0, n), base = corp.d.slice(n, n * 2).reverse();
    expect(half).toBe(n);
    expect(top[2][2]).toBe(base[2][2]);                                   // Mar: top = base (zero height)
    expect(top[1][2]).not.toBe(base[1][2]);
    expect(texts(nodes).map(t => t.src)).not.toContain("335");             // no label at the blank (Mar's Corporate value)
    expect(texts(nodes).map(t => t.src)).toContain("300");
    const hits = flat(nodes).filter((h): h is HitNode => h.t === "hit" && h.kind === "point").map(h => h.id);
    expect(hits).toContain("ar:corp:1");
    expect(hits).not.toContain("ar:corp:2");
    // PowerPoint: the series' cache keeps the blank (idx 2 missing, ptCount 6) – PowerPoint's areas ignore "gap" and drop
    // to zero, as the slide now does
    const ch = semOf(info), x = xml(ch);
    expect(ch.bars!.series[1].values).toEqual([310, 300, null, 360, 372, 390]);
    const ser = x.match(/<c:ser><c:idx val="1"\/>.*?<\/c:ser>/)![0];
    expect(ser).toContain('<c:ptCount val="6"/>');
    expect(ser.match(/<c:val>.*<\/c:val>/)![0]).not.toContain('<c:pt idx="2">');
    expect(ser).toContain('<c:dLbl><c:idx val="2"/><c:delete val="1"/></c:dLbl>');   // no "0" label at the blank
    // a standard (unstacked) area with a blank at its end: down to the axis there
    const L = seriesLayout({ kind: "chart", type: "area", values: { sheet: "Gallery", range: "B2:G2" }, box: { x: 0, y: 0, w: 900, h: 500 }, sers: { a: { n: 1, vals: [{ sheet: "Gallery", range: "B2:G2" }] } } },
      { x: 0, y: 0, w: 900, h: 500 }, (await deck("excel", { sheet: blanks("2,7") })).ctx, M, STY);
    if ("why" in L) throw new Error(L.why);
    const p = L.traces[0].pts[5]!;
    expect([p.blank, p.y, L.traces[0].d.length]).toEqual([true, p.lo, 1]);
  });

  for (const at of ["right", "left", "top", "bottom", "top-right", "inside-tl", "inside-tr"] as const) it(`(1) the PowerPoint legend holds every line entry: ${at}`, async () => {
    const { item } = await deck("excel", { patch: { ln: { legendAt: at } } }), { info } = item("ln");
    const ch = semOf(info), Lg = ch.bars!.legend!, x = xml(ch), [fx, fy, fw, fh] = legendLayout(x)!;
    // (what PowerPoint needs per entry: the widest line key seen – LibreOffice's, 77 px at 14 px –, 8 px, the name; a row
    // of entries 18 px apart)
    const size = ch.labelFont.size, key = 77 * size / 14, tw = (t: string) => [...t].length * size * .5;
    const names = ["Retail", "Corporate", "SME"];
    // the box written is the PowerPoint box (4 px / 2 px of slack each side), as wide as PowerPoint's entries
    expect(fw * ch.box.w).toBeCloseTo(Lg.box.w + 8, 3);
    expect(fx * ch.box.w + ch.box.x).toBeCloseTo(Lg.box.x - 4, 3);
    expect(fy * ch.box.h + ch.box.y).toBeCloseTo(Lg.box.y - 2, 3);
    expect(fh * ch.box.h).toBeCloseTo(Lg.box.h + 4, 3);
    if (at === "top" || at === "bottom") expect(Lg.box.w).toBeGreaterThanOrEqual(names.reduce((s, n) => s + key + 8 + tw(n) + 18, -18));
    else expect(Lg.box.w).toBeGreaterThanOrEqual(Math.max(...names.map(tw)) + key + 8);
    expect(x).not.toContain("<c:legendEntry>");                            // every entry shown
    // and the plot stays clear of it (beside or above / below it; an inside legend lies over the plot by design)
    const P = ch.bars!.plot, B = Lg.box;
    if (at === "right" || at === "top-right") expect(P.x + P.w).toBeLessThanOrEqual(B.x);
    if (at === "left") expect(B.x + B.w).toBeLessThanOrEqual(P.x);
    if (at === "top") expect(B.y + B.h).toBeLessThanOrEqual(P.y);
    if (at === "bottom") expect(P.y + P.h).toBeLessThan(B.y);
    if (at.startsWith("inside")) expect(x).toMatch(/<c:legend>.*<c:overlay val="1"\/>/);
  });
  it("(1) a legend of bars only is written as S14.2 wrote it (the slide's box)", async () => {
    const { item } = await deck("excel", { theme: "forest" }), L = item("ar");
    const ch = semOf(L.info), lg = ch.bars!.legend!;
    // (the stacked areas' legend: squares only – no line entry, so the box is the slide's own)
    const pg = L.list.nodes.slice(L.info.at[0], L.info.at[1]);
    const sq = flat(pg).filter((n): n is RectNode => n.t === "rect" && n.w === 10 && n.h === 10);
    expect(sq.length).toBe(2);
    expect(lg.box.x).toBeGreaterThanOrEqual(Math.min(...sq.map(r => r.x)) - .01);
    expect(lg.box.w).toBeLessThan(lineKeyExtra(ch.labelFont.size) + 200);
  });

  it("(5) category groups' columns that never share a category: one place, centred on their categories (overlap 100), in PowerPoint too", async () => {
    const { item } = await deck("excel"), { nodes, info } = item("gr");
    const ch = semOf(info), P = ch.bars!.plot, slot = P.w / 6;
    const bars = flat(nodes).filter((n): n is RectNode => n.t === "rect" && !!n.fill && !n.stroke && n.h > 20 && n.w > 20 && n.w < slot);
    expect(bars).toHaveLength(6);
    bars.forEach((b, k) => expect(b.x + b.w / 2).toBeCloseTo(P.x + (k + .5) * slot, 1));
    expect(xml(ch)).toMatch(/<c:barChart><c:barDir val="col"\/><c:grouping val="clustered"\/>.*<c:gapWidth val="150"\/><c:overlap val="100"\/>/);
    // two series sharing categories stay side by side (the combo slide: overlap 0, no c:overlap)
    expect(xml(semOf(item("cb").info))).not.toContain("<c:overlap");
  });

  it("(9) a line's labels clear the bars and the line itself: moved to the other side, else to the cross positions, else left out – the same in PowerPoint", async () => {
    const { item } = await deck("excel");
    // the combo: "2,2" above Mar would sit on the Mar column, below it too, beside it too – left out, hidden in PowerPoint
    const cb = item("cb"), T = texts(cb.nodes);
    expect(T.map(t => t.src)).not.toContain("2,2");
    const m = semOf(cb.info).bars!.series.find(s => s.name === "Margin %")!;
    expect(m.labels!.points).toContainEqual({ i: 2, hide: true });
    // no line label's figure on a bar
    const rects = flat(cb.nodes).filter((n): n is RectNode => n.t === "rect" && !!n.fill && "solid" in n.fill && n.fill.a === undefined && !n.stroke && n.h > 20);   // (the bars; not the band)
    for (const t of T.filter(t => /^\d,\d$/.test(t.src))) {
      const w = t.src.length * t.size * .5, ink = { x: t.x - w / 2 + 1, y: t.y - t.size * .72, w: w - 2, h: t.size * .72 };
      for (const r of rects) expect(ink.x < r.x + r.w && r.x < ink.x + ink.w && ink.y < r.y + r.h && r.y < ink.y + ink.h, t.src).toBe(false);
    }
    // the reference chart: the first 11.258 would sit on the falling line above its point, and the dip below it touches
    // the figures under it – it goes to the right (dLblPos r); no label of the line on its own stroke
    const ref = item("ref"), vol = semOf(ref.info).bars!.series[0];
    expect(vol.labels!.pos).toBe("t");
    expect(vol.labels!.points).toContainEqual({ i: 1, pos: "r" });
    const { ctx, it } = await deck("excel"), L = seriesLayout(it("ref"), it("ref").box, ctx, M, STY);
    if ("why" in L) throw new Error(L.why);
    const tr = L.traces.find(t => t.kind === "line")!;
    expect(L.labs.filter(l => l.s === tr.s)).toHaveLength(4);              // every point labelled
    for (const l of L.labs.filter(l => l.s === tr.s)) {
      const w = l.text.length * l.st.size * .5, x = l.align === "center" ? l.x - w / 2 : l.align === "right" ? l.x - w : l.x;
      const lh = Math.round(l.st.size * 1.25), base = l.top + Math.floor((lh - l.st.size) / 2) + .8 * l.st.size;
      const ink = { x: x + 1, y: base - .72 * l.st.size, w: w - 2, h: .72 * l.st.size };
      expect(strokeNear(tr.pts, l.i, tr.smooth).some(p => polyHitsBox(p, ink)), `${l.text} @${l.i}`).toBe(false);
    }
  });
  it("(9) strokeNear / polyHitsBox: a straight or smoothed stroke on both sides of a point, against a box", () => {
    const pts = [{ x: 0, y: 100 }, { x: 100, y: 0 }, { x: 200, y: 100 }, null, { x: 400, y: 0 }];
    expect(strokeNear(pts, 1, false)).toEqual([[pts[0], pts[1]], [pts[1], pts[2]]]);
    expect(strokeNear(pts, 2, false)).toHaveLength(1);                    // the gap after it
    expect(strokeNear(pts, 4, true)).toEqual([]);                          // a lone point
    expect(strokeNear(pts, 1, true)[0]).toHaveLength(9);
    expect(polyHitsBox([{ x: 0, y: 0 }, { x: 10, y: 10 }], { x: 4, y: 4, w: 2, h: 2 })).toBe(true);
    expect(polyHitsBox([{ x: 0, y: 0 }, { x: 10, y: 10 }], { x: 6, y: 0, w: 4, h: 3 })).toBe(false);
    expect(polyHitsBox([{ x: 0, y: 5 }, { x: 10, y: 5 }], { x: 2, y: 0, w: 2, h: 10 })).toBe(true);
  });

  it("(6) a text mark takes its anchor's colour unless that is light (the grey bar's #A6A6A6): then the design's ink", async () => {
    const { item } = await deck("excel"), T = texts(item("ref").nodes);
    expect(T.find(t => t.src === "12.000")!.fill).toEqual({ solid: [89, 89, 89] });            // Excel's ink, #595959
    expect(T.find(t => t.src === "11.624")!.fill).toEqual({ solid: [31, 56, 100] });
  });

  it("(8) a left axis's line through a right axis's columns: an Issues line (PowerPoint draws the right axis's groups on top); the other way round, none", async () => {
    const S = (await deck("excel")).it("cb").sers!;
    const { item } = await deck("excel", { patch: { cb: { sers: { ...S, m: { ...S.m, axis: "y" }, ret: { ...S.ret, axis: "y2" } } } } });
    expect(item("cb").info.issue).toMatch(/^'Margin %' \(left axis\) is drawn under 'Retail' \(right axis\) in PowerPoint/);
    expect((await deck("excel")).item("cb").info.issue).toBeNull();
  });
});

describe("the cache and the PowerPoint files", () => {
  it("the reference chart is built once per key", async () => {
    const { ctx, it } = await deck("excel"), e = { V: glassVars(ctx), wall: null, family: "Arial" };
    const a = cachedChartNodes(it("ref"), "ref", it("ref").box, ctx, M, e);
    expect(cachedChartNodes({ ...it("ref") }, "ref", it("ref").box, ctx, M, e)).toBe(a);
  });
  for (const design of DESIGNS) it(`${design}: the lines deck as a PowerPoint file – one native chart per chart, no picture, no connector, no link; the same bytes again`, async () => {
    const { lists } = await deck(design);
    const bytes = pptxOf(lists), z = unzipSync(bytes);
    const charts = Object.keys(z).filter(n => /^ppt\/charts\/chart\d+\.xml$/.test(n)).sort();
    expect(charts).toHaveLength(5);
    const kinds = charts.map(n => [...strFromU8(z[n]).matchAll(/<c:(lineChart|areaChart|barChart)>/g)].map(m => m[1]).join("+")).sort();
    // (Excel and Excel Refined: the template's stacked areas are a stacked line chart)
    expect(kinds).toEqual(design === "excel" || design === "clean" ? ["barChart+lineChart", "barChart+lineChart", "lineChart", "lineChart", "lineChart+barChart"]
      : ["areaChart", "barChart+lineChart", "barChart+lineChart", "lineChart", "lineChart+barChart"]);
    for (const n of Object.keys(z).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
      const s = strFromU8(z[n]);
      expect(s).not.toContain("<p:cxnSp");
      expect(s).not.toContain("<p:pic");
    }
    expect(Object.keys(z).some(n => n.endsWith(".rels") && /TargetMode="External"/.test(strFromU8(z[n])))).toBe(false);
    expect(Buffer.from(pptxOf(lists)).equals(Buffer.from(bytes))).toBe(true);
    if (process.env.CHART_PPTX_OUT) fs.writeFileSync(path.join(process.env.CHART_PPTX_OUT, `lines-${design}.pptx`), bytes);
  });
});
