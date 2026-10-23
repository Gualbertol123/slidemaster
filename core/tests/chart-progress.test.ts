/* B55 (4.14; ADR-015 / ADR-019 amendments of 2026-10-23): the budget-achievement chart on the owner's workbook
   (app/tests/fixtures/B54.xlsx, the Volumes long table; image 19) – the maths (101.8 %, 80.5 %, "+210 over",
   "1.700 to go" in the it-IT numbers the app shows), the cap at the track, a zero or negative target, the long table's
   last row per product, ranges and cells, a reload, every design, the subtitle of any chart card, the PowerPoint file
   (a native overlapped column chart, no picture), format 10 (needsV10, docNeedsV10, inverses, knownOp, vectors).
   B55_PPTX_OUT=<folder> writes the slide's PowerPoint file per design (pptxcheck). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { validate, type DisplayList, type Node, type TextNode } from "../src/dl/types";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, docNeedsV10, docNeedsV9, emptyDoc, inverseOf, knownOp, needsV10, needsV9 } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { slideToDisplayList, type SlideDL } from "../src/render/slide-dl";
import { computeLayout } from "../src/render/layout";
import { gapText, progressData, progressLayout, progressTexts, type ProgressLayout } from "../src/render/chart-progress";
import { seriesLayout, type SeriesLayout, type SeriesStyle } from "../src/render/chart-series";
import { writePptx } from "../src/pptx/writer";
import type { SlideSem } from "../src/pptx/scene";
import { pptxFamily } from "../src/text/resolve";
import { DESIGNS } from "../src/model/designs";
import { wrapLines } from "../src/text/lines";
import type { RenderCtx } from "../src/render/context";
import type { ChartItem, Design, ItemPatch, Op, WorkbookDoc } from "../src/model/types";
import type { Cell, Sheet } from "../src/xlsx/types";
import { achievementCard, achievementCells, b55Ops } from "./b55-deck";
import { b54Ops, volumeCard } from "./b54-deck";
import { loadVectors } from "./vectors";

const here = path.dirname(fileURLToPath(import.meta.url));
const BOOK = path.join(here, "../../app/tests/fixtures/B54.xlsx");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const flat = (l: DisplayList): Node[] => l.flatMap(n => n.t === "group" ? [n, ...flat(n.children)] : [n]);
const texts = (l: DisplayList) => flat(l).filter((n): n is TextNode => n.t === "text");
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const NEG = "−";
const STY: SeriesStyle = { lab: { family: "Arial", size: 14, weight: 400, italic: false, color: "#000000" }, ttl: { family: "Arial", size: 18, weight: 700, italic: false, color: "#000000" },
  family: "Arial", colors: ["#2F55F4"], legend: "square", ink: "#000000", gradient: false, radius: 0 };
/** a sheet whose cells hold other values (a reload, a scenario's value: another sheet object); null blanks a cell */
function withCells(S: Sheet, cells: [number, number, number | string | null][]): Sheet {
  const o = Object.create(S) as Sheet;
  o.get = (r: number, c: number) => {
    const x = S.get(r, c), hit = cells.find(([rr, cc]) => rr === r && cc === c);
    if (!hit) return x;
    const v = hit[2];
    return v === null ? null as unknown as Cell : { ...(x as Cell), v, t: typeof v === "number" ? "n" : "s" } as Cell;
  };
  return o;
}
async function deck(design: Design, opts: { ops?: Op[]; sheet?: (n: string, S: Sheet | null) => Sheet | null } = {}) {
  const wb = await readWorkbook(ab(BOOK));
  const { doc: view, skipped } = applyOps(emptyDoc("B54.xlsx"), opts.ops || b55Ops());
  expect(skipped).toEqual([]);
  const style = resolveStyle({}, { ...view.style, design }), slides = runtimeSlides(wb, view.preset, "B54.xlsx", design);
  const own = (n: string) => wb.sheets.find(s => s.name === n) || null;
  const ctx: RenderCtx = { style, edits: {}, slides, preset: view.preset || null, workbook: "B54.xlsx", logoSrc: "", sheet: n => opts.sheet ? opts.sheet(n, own(n)) : own(n), version: null, forExport: true };
  const lists = slides.map((R, i) => slideToDisplayList(R, i, ctx, R.tables.map(L => excelToDisplayList(L, ctx, M)), computeLayout(R, ctx).boxes, { wall: null, logo: null }, M, "23 October 2026", { sem: true }));
  const item = (id: string) => { const l = lists[0]; return { info: l.items[id], nodes: l.nodes.slice(l.items[id].at[0], l.items[id].at[1]) }; };
  const it = <T>(id: string) => view.preset!.slides[0].items![id] as unknown as T;
  return { wb, ctx, view, lists, item, it, own };
}
const pptxOf = (lists: SlideDL[]) => writePptx({ slides: lists.map(l => ({ nodes: l.nodes, sem: { type: "content" as const, items: Object.fromEntries(Object.entries(l.items).flatMap(([id, it]) => it.pptx ? [[id, it.pptx]] : [])), palette: [] } as SlideSem })), image: () => PNG, face: css => pptxFamily(css) });
const F = { x: 100, y: 100, w: 260, h: 640 };
const lay = (c: ChartItem, ctx: RenderCtx, f = F) => progressLayout(c, f, ctx, M, STY) as ProgressLayout;

describe("B55 · the maths", () => {
  it("the owner's numbers from the long table: 101,8 % and +210 over, 80,5 % and 1.700 to go (it-IT, as B54's 1.420)", async () => {
    const { ctx } = await deck("glass");
    expect(progressTexts(achievementCard(F), ctx)).toEqual([{ cat: "Loans", pct: "101,8%", gap: "+210 over" }, { cat: "Deposits", pct: "80,5%", gap: "1.700 to go" }]);
    // the same from cells (one value and one target cell each, the names typed)
    expect(progressTexts(achievementCells(F), ctx)).toEqual([{ cat: "Loans", pct: "101,8%", gap: "+210 over" }, { cat: "Deposits", pct: "80,5%", gap: "1.700 to go" }]);
    const d = progressData(achievementCard(F), ctx);
    expect(d.ok && d.rows.map(r => [r.v, r.t])).toEqual([[12000, 11790], [7000, 8700]]);
    expect(d.ok && d.issues).toEqual([]);
  });
  it("the gap's words and signs: never −0, the words editable, sign both / none, the format's own sign kept", () => {
    expect([gapText(210, "#,##0"), gapText(-1700, "#,##0"), gapText(0, "#,##0"), gapText(-0.4, "#,##0")]).toEqual(["+210 over", "1.700 to go", "+0 over", "+0 over"]);
    expect(gapText(-1700, "#,##0", { sign: "both" })).toBe(NEG + "1.700 to go");
    expect(gapText(210, "#,##0", { sign: "none", over: "above budget", under: "below" })).toBe("210 above budget");
    expect(gapText(-1700, "#,##0", { under: "" })).toBe("1.700");
    expect(gapText(-1700.25, "#,##0.0", { sign: "both" })).toBe(NEG + "1.700,3 to go");
    expect(gapText(-0.04, "0.0", { sign: "both" })).toBe("+0,0 over");
  });
  it("one target cell serves every category; a range of values with its own number format follows the cell", async () => {
    const { ctx } = await deck("excel");
    const c: ChartItem = { ...achievementCells(F), progress: { vals: [{ sheet: "Volumes", range: "C2:C5" }], targets: [{ sheet: "Volumes", range: "D2" }] } };
    const t = progressTexts(c, ctx);
    expect(t.map(x => x.cat)).toEqual(["Q3", "W37", "W38", "W39"]);                 // (the text beside the values: the Period column)
    expect(t.map(x => x.pct)).toEqual(["98,2%", "96,8%", "110,3%", "101,8%"]);
    const own = progressTexts({ ...c, progress: { ...c.progress, gap: { num: "#,##0.0" }, pct: { num: "0%" } } }, ctx);
    expect(own[3]).toEqual({ cat: "W39", pct: "102%", gap: "+210,0 over" });
  });
});

describe("B55 · the bars", () => {
  it("the fill is capped at the track; under target it stands at value / target; no axis, no gridlines by default", async () => {
    const { ctx } = await deck("glass");
    const L = lay(achievementCard(F), ctx);
    const [loans, dep] = L.bars;
    expect(loans.fill).toEqual(loans.track);
    expect(loans.over).toBe(true);
    expect(dep.fill!.h / dep.track.h).toBeCloseTo(7000 / 8700, 6);
    expect(dep.fill!.y + dep.fill!.h).toBeCloseTo(dep.track.y + dep.track.h, 6);
    expect([L.axis.show, L.axis.grid, L.axis.nodes]).toEqual([false, null, []]);
    // Excel's slots: the bar 1 / (1 + gap) of its slot (default gap 40 %), centred
    expect(L.barW).toBeCloseTo(L.slot / 1.4, 6);
    expect(L.issue).toBeNull();
  });
  it("over target: another fill, or a small band; the axis and gridlines when asked; the gap adjustable; 1–8 bars, more named", async () => {
    const { ctx } = await deck("excel");
    const c = achievementCard(F);
    const col = lay({ ...c, progress: { ...c.progress, over: "color", overFill: "#00AA00" } }, ctx);
    expect([col.bars[0].fillColor, col.bars[1].fillColor]).toEqual(["#00AA00", col.colors.fill]);
    const mark = lay({ ...c, progress: { ...c.progress, over: "mark" } }, ctx);
    expect(mark.bars[0].mark).not.toBeNull(); expect(mark.bars[1].mark).toBeNull();
    const ax = lay({ ...c, axes: { y: { show: true, grid: true } }, gap: 150 }, ctx);
    expect(ax.axis.ticks.map(t => t.text)).toEqual(["0%", "25%", "50%", "75%", "100%"]);
    expect(ax.axis.grid).not.toBeNull(); expect(ax.plot.x).toBeGreaterThan(F.x);
    expect(ax.barW).toBeCloseTo(ax.slot / 2.5, 6);
    const own = lay({ ...c, progress: { ...c.progress, fill: "#123456", track: "#EEEEEE" } }, ctx);
    expect(own.colors).toMatchObject({ fill: "#123456", track: "#EEEEEE" });
    // one bar in a wide box stays a bar; nine values: eight drawn and the rest named
    const one = lay({ ...achievementCells(F), progress: { vals: [{ sheet: "Volumes", range: "C5" }], targets: [{ sheet: "Volumes", range: "D5" }] } }, ctx, { x: 0, y: 0, w: 1200, h: 500 });
    expect(one.barW).toBeLessThanOrEqual(1200 / 6 + 1e-9);                         // (at most 180 px, or the widest gap Excel takes: 500 %)
    expect(one.gap).toBe(500);
    const nine = progressData({ ...achievementCells(F), progress: { vals: [{ sheet: "Volumes", range: "C2:C9" }, { sheet: "Volumes", range: "C2" }], targets: [{ sheet: "Volumes", range: "D2" }] } }, ctx);
    expect(nine.ok && [nine.rows.length, nine.issues]).toEqual([8, ["the chart draws 8 bars: 1 more not drawn"]]);
  });
  it("a zero or a negative target, a missing value, a bad range: an Issues line, n/a, never a throw", async () => {
    const { ctx } = await deck("excel", { sheet: (n, S) => n === "Volumes" && S ? withCells(S, [[5, 4, 0], [9, 4, -10], [9, 3, "x"]]) : S });
    const L = lay(achievementCells(F), ctx);
    expect(L.pctTexts).toEqual(["n/a", "–"]);
    expect(L.issue).toBe("'Loans': the target is 0 – no achievement; 'Deposits': no value; 'Deposits': the target is negative – no achievement");
    expect(L.bars.map(b => b.fill)).toEqual([null, null]);
    const neg = lay({ ...achievementCells(F), progress: { vals: [{ sheet: "Volumes", range: "C5" }], targets: [{ sheet: "Volumes", range: "D9" }], cats: ["Loans"] } }, ctx);
    expect(neg.issue).toBe("'Loans': the target is negative – no achievement");
    const gone = progressLayout({ ...achievementCells(F), progress: { vals: [{ sheet: "Nope", range: "C5" }] } }, F, ctx, M, STY);
    expect("why" in gone && gone.why).toBe("missing");
    const noT = lay({ ...achievementCells(F), progress: { vals: [{ sheet: "Volumes", range: "C2" }] } }, ctx);
    expect(noT.issue).toMatch(/no targets chosen/);
    const bad = progressLayout({ ...achievementCells(F), progress: { table: { by: { sheet: "Volumes", range: "ZZZ" }, val: { sheet: "Volumes", range: "C2:C9" }, target: { sheet: "Volumes", range: "D2:D9" } } } }, F, ctx, M, STY);
    expect("why" in bad && bad.why).toBe("missing");
    const malformed = progressLayout({ ...achievementCells(F), progress: 5 as unknown as ChartItem["progress"] }, F, ctx, M, STY);
    expect("why" in malformed).toBe(true);
  });
});

describe("B55 · the long table", () => {
  it("per product its LAST row with a number (the latest period); the order the products first appear; columns of another height named", async () => {
    // W39 of Loans emptied: its latest number is W38's; a new product row at the end (row 10 is outside the range: ignored)
    const { ctx } = await deck("glass", { sheet: (n, S) => n === "Volumes" && S ? withCells(S, [[5, 3, null]]) : S });
    const t = progressTexts(achievementCard(F), ctx);
    expect(t[0]).toEqual({ cat: "Loans", pct: "110,3%", gap: "+1.210 over" });
    const { ctx: c2 } = await deck("glass", { sheet: (n, S) => n === "Volumes" && S ? withCells(S, [[2, 1, "Deposits"], [6, 1, "Loans"]]) : S });
    expect(progressTexts(achievementCard(F), c2).map(x => x.cat)).toEqual(["Deposits", "Loans"]);
    const short = progressData({ ...achievementCard(F), progress: { table: { by: { sheet: "Volumes", range: "A2:A9" }, val: { sheet: "Volumes", range: "C2:C8" }, target: { sheet: "Volumes", range: "D2:D9" } } } }, ctx);
    expect(short.ok && short.issues).toEqual(["the value column Volumes!C2:C8 has 7 cells for 8 in Volumes!A2:A9", "'Deposits': the target is 0 – no achievement"].slice(0, 1).concat(short.ok ? short.issues.slice(1) : []));
    // a product without any number: its bar empty, said once
    const { ctx: c3 } = await deck("glass", { sheet: (n, S) => n === "Volumes" && S ? withCells(S, [[6, 3, null], [7, 3, null], [8, 3, null], [9, 3, null]]) : S });
    const d3 = progressData(achievementCard(F), c3);
    expect(d3.ok && d3.issues).toEqual(["'Deposits': no number in Volumes!C2:C9"]);
  });
  it("a reload (another sheet object) moves the card: the % and the gap follow the edited cell", async () => {
    const { item } = await deck("excel", { sheet: (n, S) => n === "Volumes" && S ? withCells(S, [[9, 3, 9000]]) : S });
    const T = texts(item("ba").nodes).map(t => t.src);
    expect(T).toEqual(expect.arrayContaining(["103,4%", "+300 over", "101,8%", "+210 over"]));
    expect(T).not.toContain("80,5%");
  });
});

describe("B55 · every design, the subtitle, PowerPoint", () => {
  it("every design draws the slide with the card at the right; the card's texts in the picture's order; no Issues", async () => {
    for (const d of DESIGNS) {
      const { lists, item } = await deck(d as Design);
      expect(validate(lists[0].nodes)).toEqual([]);
      for (const id of ["k1", "k2", "k3", "k4", "cl", "cd", "ba"]) expect(item(id).info.issue, d + " " + id).toBeNull();
      const T = texts(item("ba").nodes).map(t => t.src);
      for (const s of ["BUDGET ACHIEVEMENT", "Latest volume / EoM budget", "101,8%", "80,5%", "LOANS", "DEPOSITS", "+210 over", "1.700 to go"]) expect(T, d + " " + s).toContain(s);
      const y = (s: string) => texts(item("ba").nodes).find(t => t.src === s)!.y;
      expect(y("BUDGET ACHIEVEMENT")).toBeLessThan(y("Latest volume / EoM budget"));
      expect(y("Latest volume / EoM budget")).toBeLessThan(y("101,8%"));
      expect(y("101,8%")).toBeLessThan(y("LOANS"));
      expect(y("LOANS")).toBeLessThan(y("+210 over"));
    }
  });
  it("a subtitle on a series chart: its line under the title, the plot lower; a chart without one lays out as before", async () => {
    const { ctx } = await deck("glass", { ops: b54Ops() });
    const c = volumeCard("Deposits", "D6", { x: 0, y: 0, w: 700, h: 500 }, { text: "Illustrative" }), Fr = { x: 100, y: 100, w: 700, h: 500 };
    const a = seriesLayout(c, Fr, ctx, M, STY, "x") as SeriesLayout, b = seriesLayout({ ...c, subtitle: "Weekly, EUR m" }, Fr, ctx, M, STY, "x") as SeriesLayout;
    expect(b.plot.y).toBeGreaterThan(a.plot.y + 10);
    const sub = b.card.find(n => n.t === "text" && n.src === "Weekly, EUR m") as TextNode;
    expect(sub.y).toBeLessThan((b.card.find(n => n.t === "text" && n.src === "LATEST VOLUME") as TextNode).y);
    // from a cell (a reload moves it); a cell not found is an Issues line
    const cell = seriesLayout({ ...c, subtitle: { sheet: "Volumes", range: "A6" } }, Fr, ctx, M, STY, "x") as SeriesLayout;
    expect(cell.card.some(n => n.t === "text" && n.src === "Deposits")).toBe(true);
    const lost = seriesLayout({ ...c, subtitle: { sheet: "Nope", range: "A1" } }, Fr, ctx, M, STY, "x") as SeriesLayout;
    expect(lost.issue).toMatch(/the subtitle's cell Nope!A1 not found/);
    expect(lost.plot.y).toBe(a.plot.y);
    const { stats: _s, moms: _m, sep: _p, tag: _t, ...plain } = c;
    expect((seriesLayout({ ...plain, subtitle: "" } as ChartItem, Fr, ctx, M, STY, "x") as SeriesLayout).card).toEqual([]);
  });
  it("PowerPoint: a native column chart (track and fill overlapped, the % as data labels, the workbook's formula), the names and gaps as text boxes, no picture", async () => {
    const out = process.env.B55_PPTX_OUT;
    for (const d of DESIGNS) {
      const { lists, item } = await deck(d as Design);
      const sem = item("ba").info.pptx;
      expect(sem?.kind).toBe("chart");
      if (sem?.kind !== "chart") continue;
      const B = sem.chart.bars!;
      expect([B.dir, B.grouping, B.overlap, B.series.length, B.val.min, B.val.max, B.val.show, B.val.grid, B.cat.show]).toEqual(["col", "clustered", 100, 2, 0, 1, false, null, false]);
      expect(B.series[0].values).toEqual([1, 1]);
      expect(B.series[1].values[0]).toBe(1); expect(B.series[1].values[1]).toBeCloseTo(7000 / 8700, 9);
      expect(B.series[0].labels!.points.map(p => p.text)).toEqual(["101,8%", "80,5%"]);
      const bytes = await pptxOf(lists), z = unzipSync(bytes);
      if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, `b55-${d}.pptx`), bytes); }
      const slide = strFromU8(z["ppt/slides/slide1.xml"]);
      const charts = Object.keys(z).filter(n => /^ppt\/charts\/chart\d+\.xml$/.test(n)).map(n => strFromU8(z[n]));
      expect(charts).toHaveLength(3);
      const ch = charts.find(x => x.includes("101,8%"))!;
      expect(ch).toContain('<c:barDir val="col"/>'); expect(ch).toContain('<c:overlap val="100"/>'); expect(ch).toContain(`<c:gapWidth val="${B.gap}"/>`);
      expect(ch).toContain("BUDGET ACHIEVEMENT");
      for (const s of ["LOANS", "DEPOSITS", "+210 over", "1.700 to go", "Latest volume / EoM budget"]) expect(slide, d + " " + s).toContain(s);
      expect(slide).not.toContain("<p:cxnSp");
      if (d !== "glass") expect(slide).not.toContain("<p:pic>");
      // the embedded workbook: the values, the targets, the fill as a formula of them
      const books = Object.keys(z).filter(n => /^ppt\/embeddings\/.*\.xlsx$/.test(n)).map(n => unzipSync(z[n])["xl/worksheets/sheet1.xml"]).map(x => strFromU8(x));
      const bk = books.find(x => x.includes("Volume_EUR_m"))!;
      expect(bk).toContain("<f>MIN(1,MAX(0,IF(E2&gt;0,D2/E2,0)))</f>");
      expect(bk).toContain("Volume_EUR_m");
    }
  });
});

describe("B55 · format 10", () => {
  const add = (patch: Record<string, unknown>): Op => ({ op: "item.patch", slide: "s", id: "c", patch } as unknown as Op);
  it("needsV10: the chart type \"progress\", a progress key, a subtitle; not their removal; not B54's keys (format 9)", () => {
    expect(needsV10(add({ type: "progress" }))).toBe(true);
    expect(needsV10(add({ progress: { vals: [] } }))).toBe(true);
    expect(needsV10(add({ subtitle: "Latest volume / EoM budget" }))).toBe(true);
    expect(needsV10(add({ subtitle: { sheet: "S", range: "A1" } }))).toBe(true);
    expect(needsV10(add({ subtitle: null, progress: null }))).toBe(false);
    expect(needsV10(add({ type: "column" }))).toBe(false);
    expect(needsV10(add({ stats: { s1: { n: 1, src: "last" } }, sep: {}, kind: "kpi" }))).toBe(false);
    expect(needsV9(add({ stats: { s1: { n: 1, src: "last" } } }))).toBe(true);
    expect(needsV10({ op: "item.patch", slide: "s", id: "c", patch: null })).toBe(false);
    const create = b55Ops().find(o => o.op === "item.patch" && o.id === "ba")!;
    expect([needsV10(create), needsV9(create)]).toEqual([true, true]);
    for (const o of b54Ops()) expect(needsV10(o)).toBe(false);
    expect(needsV10({ op: "slide.add", slide: { id: "x", type: "content", tables: [], items: { c: achievementCard(F) } }, after: null } as unknown as Op)).toBe(true);
    const { doc } = applyOps(emptyDoc("W"), b55Ops()), { doc: d54 } = applyOps(emptyDoc("W"), b54Ops());
    expect([docNeedsV10(doc), docNeedsV10(d54), docNeedsV9(d54)]).toEqual([true, false, true]);
    expect(needsV10({ op: "preset.set", preset: doc.preset } as Op)).toBe(true);
    expect(docNeedsV10({ preset: { sheets: [], tables: [], slides: [] }, edits: {} } as unknown as WorkbookDoc)).toBe(false);
  });
  it("knownOp, apply and the inverses: create ↔ delete, a plain key back (type, progress, subtitle)", () => {
    const ops = b55Ops();
    for (const o of ops) expect(knownOp(o)).toBe(true);
    const { doc } = applyOps(emptyDoc("W"), ops.slice(0, 1));
    const create = ops.find(o => o.op === "item.patch" && o.id === "ba") as Extract<Op, { op: "item.patch" }>;
    expect(inverseOf(doc, create)).toEqual({ op: "item.patch", slide: "b54", id: "ba", patch: null });
    const { doc: d2 } = applyOps(doc, [create]);
    expect(d2.preset!.slides[0].items!.ba).toEqual(create.patch);
    const e: Op = { op: "item.patch", slide: "b54", id: "ba", patch: { type: "column", subtitle: null, progress: { vals: [{ sheet: "Volumes", range: "C5" }] }, gap: 80 } as ItemPatch };
    const inv = inverseOf(d2, e)!;
    expect(inv).toEqual({ op: "item.patch", slide: "b54", id: "ba", patch: { type: "progress", subtitle: "Latest volume / EoM budget", progress: (create.patch as ChartItem).progress, gap: null } });
    const { doc: d3 } = applyOps(d2, [e, inv]);
    expect(d3.preset!.slides[0].items!.ba).toEqual(create.patch);
  });
});
describe("B55 · vectors (shared/ops-vectors.d/b55.json)", () => {
  const cases = loadVectors().filter(x => /^B55 /.test(x.name));
  it("there are B55 cases", () => expect(cases.length).toBeGreaterThanOrEqual(2));
  for (const v of cases) it(v.name + ": knownOp, needsV9 / needsV10, docNeedsV10", () => {
    expect(v.ops.map((o: Op) => [knownOp(o), needsV9(o), needsV10(o)])).toEqual(v.ops.map((_: Op, k: number) => [v.expect.knownOp[k], v.expect.needsV9[k], v.expect.needsV10[k]]));
    const { doc } = applyOps(v.doc, v.ops);
    expect([docNeedsV9(doc), docNeedsV10(doc)]).toEqual([v.expect.docNeedsV9, v.expect.docNeedsV10]);
  });
});
