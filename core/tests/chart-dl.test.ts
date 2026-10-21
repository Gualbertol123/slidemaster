/* Charts on slides (S9.2, docs/next/07 §3, CH-01): pie / donut display lists in every design – slices as cubic-Bézier
   paths, labels and leaders, legend, title, palette per design, per-slice colours, the glass card, hit nodes – from a
   table's cells and from a sheet on no slide, with the placeholder and the Issues line of a source that is missing.
   Same corpus loader and deterministic measurer as slide-dl.test.ts. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validate, type DisplayList, type HitNode, type Node, type PathNode, type TextNode } from "../src/dl/types";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, emptyDoc } from "../src/model/ops";
import { presetSheets, runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { slideToDisplayList } from "../src/render/slide-dl";
import { computeLayout } from "../src/render/layout";
import { arcCmds, chartData, chartKey, chartNodes, sliceAt, sliceCmds } from "../src/render/chart-dl";
import { glassVars } from "../src/render/glass-dl";
import { DESIGNS } from "../src/model/designs";
import { wrapLines } from "../src/text/lines";
import type { RenderCtx } from "../src/render/context";
import type { ChartItem, Design, Op } from "../src/model/types";
import type { Sheet } from "../src/xlsx/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const DECKS = path.join(here, "../../tests/corpus/decks"), BOOKS = path.join(here, "../../tests/corpus/workbooks");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
/** advances of 0.5 em per character, ascent .8 em, descent .2 em */
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const flat = (l: DisplayList): Node[] => l.flatMap(n => n.t === "group" ? [n, ...flat(n.children)] : [n]);
const r1 = (v: number) => Math.round(v * 10) / 10;
/** a compact, stable picture of a chart's nodes for the snapshots: kind, geometry, paint, text */
const summary = (l: DisplayList): unknown[] => l.map(n => {
  switch (n.t) {
    case "path": return ["path", n.d.length, n.d.slice(0, 2).map(c => c.map(v => typeof v === "number" ? r1(v) : v).join(" ")).join(" "), JSON.stringify(n.fill), n.stroke ? n.stroke.w : 0];
    case "text": return ["text", n.src, r1(n.x), r1(n.y), n.size, n.weight, n.css, JSON.stringify(n.fill)];
    case "rect": return ["rect", r1(n.x), r1(n.y), r1(n.w), r1(n.h), n.r ?? 0, JSON.stringify(n.fill ?? null), n.stroke ? JSON.stringify(n.stroke) : ""];
    case "line": return ["line", r1(n.x1), r1(n.y1), r1(n.x2), r1(n.y2)];
    case "hit": return ["hit", n.kind, n.id, r1(n.x), r1(n.y), r1(n.w), r1(n.h)];
    case "group": return ["group", n.clip ? "clip" : "", summary(n.children)];
    case "shadow": return ["shadow", n.dy, n.blur, n.a];
    case "image": return ["image", n.id];
  }
});

const PIE: ChartItem = { kind: "chart", type: "pie", values: { table: "dhnms9c", range: "D6:D11" }, show: ["label", "percent"], legend: "right", box: { x: 980, y: 250, w: 560, h: 420 } };
const NUMBERS: ChartItem = { kind: "chart", type: "donut", values: { sheet: "Numbers", range: "B2:B6" }, title: "Numbers", legend: "bottom", box: { x: 60, y: 520, w: 420, h: 330 } };
async function setup(design: Design, items: Record<string, ChartItem>, extra: Op[] = []) {
  const d = JSON.parse(fs.readFileSync(path.join(DECKS, "report.json"), "utf8")) as { workbook: string; ops: Op[] };
  const wb = await readWorkbook(ab(path.join(BOOKS, d.workbook)));
  const ops = [...d.ops, ...Object.entries(items).map(([id, patch]) => ({ op: "item.patch", slide: "u9t3fqb", id, patch }) as Op), ...extra];
  const { doc: view, skipped } = applyOps(emptyDoc("W.xlsx"), ops);
  expect(skipped).toEqual([]);
  const style = resolveStyle({}, { ...view.style, design });
  const slides = runtimeSlides(wb, view.preset, "W.xlsx", design);
  const ctx: RenderCtx = { style, edits: view.edits || {}, slides, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null };
  const build = (i = 0, c = ctx) => {
    const R = c.slides[i], boxes = computeLayout(R, c).boxes;
    return slideToDisplayList(R, i, c, R.tables.map(L => excelToDisplayList(L, c, M)), boxes, { wall: null, logo: null }, M, "1 October 2026");
  };
  return { wb, ctx, slides, view, build };
}
/** a chart's nodes on the slide: from its item hit to the next item's (or the logo / the end) */
function chartPart(l: DisplayList, id: string): DisplayList {
  const k = l.findIndex(n => n.t === "hit" && n.kind === "item" && n.id === id);
  if (k < 0) return [];
  const end = l.findIndex((n, j) => j > k && n.t === "hit" && (n.kind === "item" || (n.kind === "f" && /^logo/.test(n.id))));
  return l.slice(k, end < 0 ? undefined : end);
}

describe("arcs and slices", () => {
  it("a quarter is one cubic with κ = 0.5523; a whole turn four; every point within 0.03 % of the circle", () => {
    const q = arcCmds(0, 0, 100, 0, 90);
    expect(q).toHaveLength(1);
    const [, x1, y1, x2, y2, x3, y3] = q[0] as number[];
    expect([x1, y1, x2, y2, x3, y3]).toEqual([55.23, -100, 100, -55.23, 100, 0]);
    expect(arcCmds(0, 0, 100, 0, 360)).toHaveLength(4);
    for (const span of [7, 45, 90, 130, 359]) for (const c of arcCmds(10, 20, 250, 33, 33 + span)) {
      const [, , , , , x, y] = c as number[];
      expect(Math.abs(Math.hypot(x - 10, y - 20) - 250) / 250).toBeLessThan(3e-4);
    }
    // the curve's midpoint (t = ½), the farthest from the circle, is within 0.03 % of the radius too
    const [, a, b, cc, d, e, f] = arcCmds(0, 0, 1000, 0, 90)[0] as number[], mx = (0 + 3 * a + 3 * cc + e) / 8, my = (-1000 + 3 * b + 3 * d + f) / 8;
    expect(Math.abs(Math.hypot(mx, my) - 1000) / 1000).toBeLessThan(3e-4);
  });
  it("a pie slice starts at the centre; a donut slice is a ring segment; a whole pie is a circle", () => {
    expect(sliceCmds(100, 100, 50, 0, 0, 90).map(c => c[0]).join("")).toBe("MLCZ");
    expect(sliceCmds(100, 100, 50, 20, 0, 180).map(c => c[0]).join("")).toBe("MCCLCCZ");
    expect(sliceCmds(100, 100, 50, 0, 0, 360).map(c => c[0]).join("")).toBe("MCCCCZ");
  });
  it("sliceAt finds the slice under a point by angle (the stage's pick), none outside the ring", () => {
    const G = { cx: 0, cy: 0, r: 100, ri: 40, slices: [{ i: 0, a0: 30, a1: 120 }, { i: 1, a0: 120, a1: 390 }] };
    expect(sliceAt(G, 70, 0)).toBe(0);              // 90°
    expect(sliceAt(G, 0, -70)).toBe(1);             // 0° = 360°, inside slice 1 (120–390)
    expect(sliceAt(G, 0, 70)).toBe(1);
    expect(sliceAt(G, 10, 10)).toBeNull();          // the hole
    expect(sliceAt(G, 200, 0)).toBeNull();
  });
});

describe("the chart's data (through ctx.sheet, as the tables)", () => {
  it("from a table: the numbers of the range, the labels from the column on its left, the cells' formatted texts", async () => {
    const { ctx } = await setup("glass", { c1: PIE });
    const d = chartData(PIE, ctx);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.source).toBe("SLIDE_1!D6:D11");
    // row 9 (Delta) is hidden in the workbook: left out, as Excel's charts do
    expect(d.slices.map(s => s.label)).toEqual(["Alpha", "Beta", "Gamma", "Epsilon", "Zeta"]);
    expect(d.slices[0].v).toBeCloseTo(1234567.891, 3);
    expect(d.slices[0].text).not.toBe("");
    expect(d.series).toBe("Loans");
  });
  it("from a sheet on no slide (Numbers): read for the chart (presetSheets names it); a hidden sheet's range is not found", async () => {
    const { ctx, view } = await setup("excel", { c2: NUMBERS });
    expect(presetSheets(view.preset)).toContain("Numbers");
    const d = chartData(NUMBERS, ctx);
    expect(d.ok && d.slices.map(s => s.label)).toEqual(["1", "2", "3", "4", "5"]);
    // hidden sheets feed formulas only (Decisions 2026-10-18; WB-18): never a chart
    expect(chartData({ ...NUMBERS, values: { sheet: "Hidden data", range: "A1:A5" } }, ctx)).toMatchObject({ ok: false, why: "missing", source: "Hidden data!A1:A5" });
  });
  it("text and blank cells are skipped; a range without numbers is empty; a bad or missing range is missing", async () => {
    const { ctx } = await setup("excel", {});
    expect(chartData({ ...PIE, values: { table: "dhnms9c", range: "C5:D7" } }, ctx)).toMatchObject({ ok: true });
    const two = chartData({ ...PIE, values: { table: "dhnms9c", range: "C5:D7" } }, ctx);
    expect(two.ok && two.slices.length).toBe(2);
    expect(chartData({ ...PIE, values: { table: "dhnms9c", range: "C6:C11" } }, ctx)).toMatchObject({ ok: false, why: "empty" });
    expect(chartData({ ...PIE, values: { table: "nope", range: "D6:D11" } }, ctx)).toMatchObject({ ok: false, why: "missing" });
    expect(chartData({ ...PIE, values: { sheet: "SLIDE_1", range: "D6:D11,E6:E11" } }, ctx)).toMatchObject({ ok: false, why: "missing" });
    expect(chartData({ ...PIE, values: { sheet: "Gone", range: "D6:D11" } }, ctx)).toMatchObject({ ok: false, why: "missing", source: "Gone!D6:D11" });
  });
  it("the cells a version removes are left out; the labels range of the item names the values", async () => {
    const { ctx } = await setup("excel", {});
    const cut = { ...ctx, version: { id: "v", name: "V", hide: { SLIDE_1: ["D7:D8"] } } };
    const d = chartData(PIE, cut);
    expect(d.ok && d.slices.map(s => s.label)).toEqual(["Alpha", "Epsilon", "Zeta"]);
    const named = chartData({ ...PIE, labels: { sheet: "SLIDE_1", range: "J6:J11" } }, ctx);
    expect(named.ok && named.slices.map(s => s.label)).toEqual(["check", "ok", "ok", "ok", "ok"]);
  });
  it("another sheet object (a reload, a scenario's view) is read again; the key follows the values", async () => {
    const { ctx, wb } = await setup("excel", {});
    const S = wb.sheets.find(s => s.name === "SLIDE_1")!;
    const changed = Object.create(S) as Sheet;
    changed.get = (r: number, c: number) => r === 6 && c === 4 ? { ...S.get(r, c)!, v: 99 } : S.get(r, c);
    const ctx2: RenderCtx = { ...ctx, sheet: n => n === "SLIDE_1" ? changed : ctx.sheet!(n), scenario: "abc" };
    const a = chartData(PIE, ctx), b = chartData(PIE, ctx2);
    expect(a.ok && b.ok && [a.slices[0].v !== 99, b.slices[0].v]).toEqual([true, 99]);
    expect(chartKey(PIE, ctx)).not.toBe(chartKey(PIE, ctx2));
    expect(chartKey(PIE, ctx)).toBe(chartKey({ ...PIE }, ctx));
  });
});

describe("the chart on the slide, in every design (CH-01)", () => {
  for (const design of DESIGNS) it(`${design}: a pie from a table and a donut from a sheet on no slide – valid nodes, hits, palette`, async () => {
    const { build } = await setup(design, { c1: PIE, c2: NUMBERS });
    const dl = build();
    expect(validate(dl.nodes)).toEqual([]);
    const pie = chartPart(dl.nodes, "c1"), donut = chartPart(dl.nodes, "c2");
    const slices = flat(pie).filter((n): n is PathNode => n.t === "path");
    expect(slices).toHaveLength(5);
    // the slice hits, one per slice, ids "<item>:<i>"
    expect(flat(pie).filter((n): n is HitNode => n.t === "hit" && n.kind === "slice").map(h => h.id)).toEqual([0, 1, 2, 3, 4].map(i => "c1:" + i));
    // labels: the bank and its share, inside the wide slices
    const texts = flat(pie).filter((n): n is TextNode => n.t === "text").map(t => t.src);
    expect(texts).toContain("Alpha");
    expect(texts.some(t => /%$/.test(t))).toBe(true);
    expect(dl.items?.c1).toMatchObject({ issue: null });
    expect(summary(pie)).toMatchSnapshot("pie");
    expect(summary(donut)).toMatchSnapshot("donut");
  });
  it("Liquid Glass: inside a glass card – a clip group with the blurred wallpaper, the tint and shadows", async () => {
    const { ctx } = await setup("glass", { c1: PIE });
    const out = chartNodes(PIE, "c1", PIE.box, ctx, M, { V: glassVars(ctx), wall: { blurId: "wb", blurSrc: "data:" }, family: "Arial" });
    expect(out.nodes[0]).toMatchObject({ t: "hit", kind: "item", id: "c1" });
    expect(out.nodes.some(n => n.t === "shadow")).toBe(true);
    const g = out.nodes.find(n => n.t === "group");
    expect(g && g.t === "group" && g.clip).toBeTruthy();
    expect(g && g.t === "group" && g.children[0]).toMatchObject({ t: "image", id: "wb" });
    // the slices: the theme's tinted gradient, a white separator
    const p = flat(out.nodes).find((n): n is PathNode => n.t === "path")!;
    expect("linear" in p.fill!).toBe(true);
    expect(p.stroke?.paint).toEqual({ solid: [255, 255, 255], a: .9 });
  });
  it("colours: the item's colour per slice, else the design's palette (Excel: the theme's accent, then Office's)", async () => {
    const { ctx } = await setup("excel", {});
    const paths = (it: ChartItem, c = ctx) => flat(chartNodes(it, "c", it.box, c, M, { V: glassVars(c), wall: null, family: "Arial" }).nodes).filter((n): n is PathNode => n.t === "path").map(p => (p.fill as { solid: number[] }).solid.join());
    const own = paths({ ...PIE, colors: { "2": "#123456" } }), base = paths(PIE);
    expect(own[2]).toBe("18,52,86");
    expect(own.filter((_, i) => i !== 2)).toEqual(base.filter((_, i) => i !== 2));
    // the Intesa Sanpaolo template's palette (B48): Blu, Arancione, Giallo… each at 25 % transparency
    expect(base.slice(0, 3)).toEqual(["64,107,155", "241,139,64", "241,206,64"]);
    // with a colour theme of the user's: the theme's accent, then Office's colours
    const { ctx: ocean } = await setup("excel", {});
    ocean.style = { ...ocean.style, theme: { id: "ocean", c1: "", c2: "", c3: "", c4: "", a1: "", a2: "" } };
    expect(paths(PIE, ocean)[1]).toBe("68,114,196");            // Office blue after the accent
    // Consulting Red: its palette (then "other" grey for any further slice)
    const { ctx: red } = await setup("bain", {});
    const r = paths(PIE, red);
    expect(r).toEqual(["#CC0000", "#333332", "#777776", "#A4A4A3", "#D6D6D6"].map(h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16)).join()));
  });
  it("a thin slice gets its label outside with a leader line; legend capsules in Liquid Glass, squares in Excel, lines in Consulting Red", async () => {
    const thin: ChartItem = { ...PIE, values: { sheet: "Numbers", range: "B2:B6" }, show: ["percent"] };
    for (const [design, w, h] of [["glass", 18, 10], ["excel", 10, 10], ["bain", 16, 2]] as const) {
      const { ctx } = await setup(design, {});
      const n = flat(chartNodes(thin, "c", thin.box, ctx, M, { V: glassVars(ctx), wall: null, family: "Arial" }).nodes);
      expect(n.some(x => x.t === "line"), design).toBe(true);
      const sw = n.filter(x => x.t === "rect" && x.w === w && x.h === h);
      expect(sw.length, design).toBeGreaterThan(0);
    }
  });
  it("a source that is missing: a placeholder on the stage and the Issues line; nothing in an export", async () => {
    const gone: ChartItem = { ...PIE, values: { sheet: "Gone", range: "C5:C9" } };
    const { ctx } = await setup("clean", {});
    const out = chartNodes(gone, "c9", gone.box, ctx, M, { V: glassVars(ctx), wall: null, family: "Arial" });
    expect(out.issue).toBe("source Gone!C5:C9 not found");
    expect(validate(out.nodes)).toEqual([]);
    expect(flat(out.nodes).some(n => n.t === "text" && /not found/.test(n.src))).toBe(true);
    const ex = chartNodes(gone, "c9", gone.box, { ...ctx, forExport: true }, M, { V: glassVars(ctx), wall: null, family: "Arial" });
    expect(flat(ex.nodes).some(n => n.t === "text")).toBe(false);
    expect(chartNodes({ ...PIE, values: { table: "dhnms9c", range: "C6:C11" } }, "c", PIE.box, ctx, M, { V: glassVars(ctx), wall: null, family: "Arial" }).issue).toBe("no numbers in SLIDE_1!C6:C11");
  });
  it("attached to a table's side: laid out by computeLayout beside it (the table gets less room), else at its box", async () => {
    const free = await setup("excel", { c1: { ...PIE } });
    const att = await setup("excel", { c1: { ...PIE, attach: { table: "dhnms9c", side: "right" } } });
    const b0 = computeLayout(free.slides[0], free.ctx).boxes[0], b1 = computeLayout(att.slides[0], att.ctx).boxes[0];
    expect(b1.w).toBeLessThan(b0.w);
    expect(b1.items?.c1).toMatchObject({ y: b1.y, w: 560, h: 420 });
    expect(b1.items!.c1.x).toBeCloseTo(b1.x + b1.w + 14, 5);
    const dl = att.build();
    expect(chartPart(dl.nodes, "c1")[0]).toMatchObject({ x: Math.round(b1.items!.c1.x * 100) / 100, y: Math.round(b1.y * 100) / 100 });
  });
  it("a shared document's odd values (review S9.2): huge or text sizes, a text box size, an attached text width – valid nodes, no stretched layout", async () => {
    const { ctx } = await setup("excel", {});
    const env = { V: glassVars(ctx), wall: null, family: "Arial" };
    for (const size of [1e6, "1e9", Infinity, -3] as unknown[]) {
      const out = chartNodes({ ...PIE, fmt: { size: size as number } }, "c", PIE.box, ctx, M, env);
      expect(validate(out.nodes), String(size)).toEqual([]);
    }
    const bad = await setup("excel", { c1: { ...PIE, box: { x: 0, y: 0, w: 560, h: 420 }, attach: { table: "dhnms9c", side: "right" } } });
    (bad.slides[0].cfg.items!.c1.box as unknown as Record<string, unknown>).w = "300";
    const plain = await setup("excel", {});
    expect(computeLayout(bad.slides[0], bad.ctx).boxes[0].w).toBe(computeLayout(plain.slides[0], plain.ctx).boxes[0].w);
  });
  it("outside labels start beyond the circle at their own height, inside the box; the last slice never takes the first one's colour", async () => {
    const { ctx } = await setup("excel", {});
    const twelve: ChartItem = { ...PIE, values: { table: "dhnms9c", range: "D6:D18" }, show: ["label", "percent"], legend: "none" };
    const out = chartNodes(twelve, "c", twelve.box, ctx, M, { V: glassVars(ctx), wall: null, family: "Arial" }), g = out.geom!;
    const lines = flat(out.nodes).filter(n => n.t === "line") as { x2: number; y2: number }[];
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(Math.hypot(l.x2 - g.cx, l.y2 - g.cy)).toBeGreaterThan(g.r);
      expect(l.y2).toBeGreaterThanOrEqual(twelve.box.y); expect(l.y2).toBeLessThanOrEqual(twelve.box.y + twelve.box.h);
    }
    const cols = g.slices.map(s => s.color);
    expect(cols).toHaveLength(12);
    expect(cols[11]).not.toBe(cols[0]);
  });
});
