/* B54 (4.13; ADR-015 / ADR-019 amendments of 2026-10-23): chart cards on the owner's workbook (tests/fixtures/B54.xlsx,
   images 16 and 17) – the delta maths (a negative base by |base|, a zero base "n/a"), the good-direction colours, the momentum chips (first, trough, previous), the long-table
   filter, the plot's room, reload / scenario, every design, the PowerPoint shapes (no picture), format 9 (needsV9,
   docNeedsV9, inverses, knownOp). B54_PPTX_OUT=<folder> writes the slide's PowerPoint file per design (pptxcheck). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { validate, type DisplayList, type Node, type TextNode } from "../src/dl/types";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, docNeedsV8, docNeedsV9, emptyDoc, inverseOf, knownOp, needsV8, needsV9 } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { slideToDisplayList, type SlideDL } from "../src/render/slide-dl";
import { computeLayout } from "../src/render/layout";
import { seriesData } from "../src/render/chart-data";
import { seriesLayout, type SeriesLayout, type SeriesStyle } from "../src/render/chart-series";
import { changeOf, changeText, goodColor } from "../src/render/deltas";
import { writePptx } from "../src/pptx/writer";
import type { SlideSem } from "../src/pptx/scene";
import { pptxFamily } from "../src/text/resolve";
import { DESIGNS } from "../src/model/designs";
import { wrapLines } from "../src/text/lines";
import type { RenderCtx } from "../src/render/context";
import type { ChartItem, Design, ItemPatch, Op, WorkbookDoc } from "../src/model/types";
import type { Cell, Sheet } from "../src/xlsx/types";
import { b54Ops, volumeCard } from "./b54-deck";
import { loadVectors } from "./vectors";

const here = path.dirname(fileURLToPath(import.meta.url));
const BOOK = path.join(here, "../../tests/fixtures/B54.xlsx");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const flat = (l: DisplayList): Node[] => l.flatMap(n => n.t === "group" ? [n, ...flat(n.children)] : [n]);
const texts = (l: DisplayList) => flat(l).filter((n): n is TextNode => n.t === "text");
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const NEG = "−";
/** a sheet whose cell (r, c) holds another number (a reload, a scenario's value: another sheet object) */
function withCell(S: Sheet, r: number, c: number, v: number): Sheet {
  const o = Object.create(S) as Sheet;
  o.get = (rr: number, cc: number) => { const x = S.get(rr, cc); return rr === r && cc === c ? { ...(x as Cell), v, t: "n" } as Cell : x; };
  return o;
}
async function deck(design: Design, opts: { ops?: Op[]; sheet?: (n: string, S: Sheet | null) => Sheet | null; forExport?: boolean } = {}) {
  const wb = await readWorkbook(ab(BOOK));
  const { doc: view, skipped } = applyOps(emptyDoc("KPI.xlsx"), opts.ops || b54Ops());
  expect(skipped).toEqual([]);
  const style = resolveStyle({}, { ...view.style, design }), slides = runtimeSlides(wb, view.preset, "KPI.xlsx", design);
  const own = (n: string) => wb.sheets.find(s => s.name === n) || null;
  const ctx: RenderCtx = { style, edits: {}, slides, preset: view.preset || null, workbook: "KPI.xlsx", logoSrc: "", sheet: n => opts.sheet ? opts.sheet(n, own(n)) : own(n), version: null, forExport: opts.forExport ?? true };
  const lists = slides.map((R, i) => slideToDisplayList(R, i, ctx, R.tables.map(L => excelToDisplayList(L, ctx, M)), computeLayout(R, ctx).boxes, { wall: null, logo: null }, M, "23 October 2026", { sem: true }));
  const item = (id: string) => { const l = lists[0]; return { info: l.items[id], nodes: l.nodes.slice(l.items[id].at[0], l.items[id].at[1]) }; };
  const it = <T>(id: string) => view.preset!.slides[0].items![id] as unknown as T;
  return { wb, ctx, view, lists, item, it, own };
}
const pptxOf = (lists: SlideDL[]) => writePptx({ slides: lists.map(l => ({ nodes: l.nodes, sem: { type: "content" as const, items: Object.fromEntries(Object.entries(l.items).flatMap(([id, it]) => it.pptx ? [[id, it.pptx]] : [])), palette: [] } as SlideSem })), image: () => PNG, face: css => pptxFamily(css) });

describe("B54 · delta maths", () => {
  it("a % against a negative base is of |base|; a zero base has none; abs and both", () => {
    expect(changeOf(-10, -10.1010101).pct).toBeCloseTo(.01, 6);
    expect(changeOf(-10, -9.803921569).pct).toBeCloseTo(-.02, 6);
    expect(changeOf(5, 0).pct).toBeNull();
    expect(changeText(changeOf(5, 0), "both", "0")).toBe("+5 (n/a)");
    expect(changeText(changeOf(7000, 8420), "both", "#,##0")).toBe(NEG + "1.420 (" + NEG + "16,9%)");
    expect(changeText(changeOf(7000, 8420), "pct", "#,##0")).toBe(NEG + "16,9%");
  });
  it("good direction: up, down, neutral; zero grey", () => {
    const L = { pos: "#00AA00", neg: "#AA0000", zero: "#888888" };
    expect([goodColor(1, "up", L, "#000"), goodColor(-1, "up", L, "#000"), goodColor(1, "down", L, "#000"), goodColor(-1, "down", L, "#000"), goodColor(1, "neutral", L, "#000"), goodColor(0, "up", L, "#000")])
      .toEqual(["#00AA00", "#AA0000", "#AA0000", "#00AA00", "#000", "#888888"]);
  });
});

describe("B54 · chart cards", () => {
  const STY: SeriesStyle = { lab: { family: "Arial", size: 14, weight: 400, italic: false, color: "#000000" }, ttl: { family: "Arial", size: 18, weight: 700, italic: false, color: "#000000" },
    family: "Arial", colors: ["#111111"], legend: "square", ink: "#000000", gradient: false, radius: 0 };
  it("the long table filtered by product: Period as the categories, Volume as the values", async () => {
    const { ctx, it } = await deck("glass");
    const D = seriesData(it<ChartItem>("cd"), ctx), L = seriesData(it<ChartItem>("cl"), ctx);
    expect(D.ok && L.ok).toBe(true);
    if (!D.ok || !L.ok) return;
    expect([D.cats, D.series[0].vals, D.issues]).toEqual([["Q3", "W37", "W38", "W39"], [8420, 8300, 9000, 7000], []]);
    expect([L.cats, L.series[0].vals]).toEqual([["Q3", "W37", "W38", "W39"], [11576, 11411, 13000, 12000]]);
    // a value of no row: no numbers, named; the value from a cell (a scenario can change it)
    const none = seriesData({ ...it<ChartItem>("cd"), filter: { by: { sheet: "Volumes", range: "A2:A9" }, eq: "Cards" } }, ctx);
    expect(none.ok ? null : none.source).toMatch(/rows of Volumes!A2:A9 showing “Cards”/);
    const byCell = seriesData({ ...it<ChartItem>("cd"), filter: { by: { sheet: "Volumes", range: "A2:A9" }, eq: { sheet: "Volumes", range: "A2" } } }, ctx);
    expect(byCell.ok && byCell.series[0].vals).toEqual([11576, 11411, 13000, 12000]);
    const short = seriesData({ ...it<ChartItem>("cd"), filter: { by: { sheet: "Volumes", range: "A2:A8" }, eq: "Deposits" } }, ctx);
    expect(short.ok && short.issues).toEqual(["the filter column has 7 cells for 8 values"]);
  });
  it("stats, tag, separator and momentum: the image's numbers, coloured by sign", async () => {
    const { item } = await deck("glass");
    const D = texts(item("cd").nodes).map(t => t.src), L = texts(item("cl").nodes).map(t => t.src);
    for (const s of ["DEPOSITS · WEEKLY VOLUME", "ILLUSTRATIVE", "LATEST VOLUME", "7.000", "EOM BUDGET", "8.700", "GAP TO BUDGET", NEG + "1.700", "MOMENTUM",
      NEG + "1.420 (" + NEG + "16,9%)", "vs Q3", "+0 (+0,0%)", "since trough", NEG + "2.000 (" + NEG + "22,2%)", "WoW", "Budget 8.700"]) expect(D, s).toContain(s);
    for (const s of ["ACTUAL LOANS", "12.000", "11.790", "210", "+424 (+3,7%)", "+589 (+5,2%)", NEG + "1.000 (" + NEG + "7,7%)"]) expect(L, s).toContain(s);
    const col = (src: string) => (texts(item("cd").nodes).find(t => t.src === src)!.fill as { solid: number[] }).solid.join(",");
    expect(col(NEG + "1.700")).not.toBe(col("8.700"));
    expect(col(NEG + "1.700")).toBe(col(NEG + "2.000 (" + NEG + "22,2%)"));
    expect(item("cd").info.issue).toBeNull();
  });
  it("the plot shrinks to make room; a chart without card parts lays out as before", async () => {
    const { ctx, it } = await deck("glass");
    const F = { x: 100, y: 100, w: 700, h: 500 }, lay = (c: ChartItem) => seriesLayout(c, F, ctx, M, STY, "x") as SeriesLayout;
    const full = lay(it<ChartItem>("cd")), { stats: _s, moms: _m, sep: _p, tag: _t, ...plain } = it<ChartItem>("cd"), bare = lay(plain as ChartItem);
    expect(bare.card).toEqual([]);
    expect(full.plot.y).toBeGreaterThan(bare.plot.y + 50);
    expect(full.plot.y + full.plot.h).toBeLessThan(bare.plot.y + bare.plot.h - 30);
    const sep = full.card.find(n => n.t === "line")!;
    expect(sep.t === "line" && sep.y1).toBeLessThan(full.plot.y);
  });
  it("a reload and a scenario move the card's numbers; a missing stat cell is an Issues line", async () => {
    const { item } = await deck("excel", { sheet: (n, S) => n === "Volumes" && S ? withCell(S, 9, 3, 6500) : S });
    expect(texts(item("cd").nodes).map(t => t.src)).toEqual(expect.arrayContaining(["6.500", NEG + "2.200", NEG + "2.500 (" + NEG + "27,8%)"]));
    const ops = b54Ops();
    (ops[2] as { patch: ChartItem }).patch.stats!.s4 = { n: 4, label: "Cell", src: "cell", cell: { sheet: "Volumes", range: "B2" } };
    const b = await deck("excel", { ops });
    expect(b.item("cd").info.issue).toBe("stat 'Cell': no number in Volumes!B2");
  });
  it("every design draws the slide; the PowerPoint file holds native charts, KPI shapes and text boxes, no picture of them", async () => {
    const out = process.env.B54_PPTX_OUT;
    for (const d of DESIGNS) {
      const { lists, item } = await deck(d as Design);
      expect(validate(lists[0].nodes)).toEqual([]);
      for (const id of ["cl", "cd"]) expect(item(id).info.issue, d + " " + id).toBeNull();
      const bytes = await pptxOf(lists), z = unzipSync(bytes);
      if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, `b54-${d}.pptx`), bytes); }
      const slide = strFromU8(z["ppt/slides/slide1.xml"]);
      expect(Object.keys(z).filter(n => /^ppt\/charts\/chart\d+\.xml$/.test(n))).toHaveLength(2);
      for (const s of ["ILLUSTRATIVE", "LATEST VOLUME", "MOMENTUM", "since trough", "GAP TO BUDGET"]) expect(slide, d + " " + s).toContain(s);
      expect(slide).not.toContain("<p:cxnSp");
      if (d !== "glass") expect(slide).not.toContain("<p:pic>");
    }
  });
});

describe("B54 · format 9", () => {
  const add = (patch: object): Op => ({ op: "item.patch", slide: "s", id: "i", patch } as Op);
  it("needsV9: a KPI card, a chart's B54 key; not a removal, not a plain chart; slide.add / preset.set carrying one", () => {
    // (a KPI card, v4/B54-kpi-item's kind: by its kind's name alone)
    expect(needsV9(add({ kind: "kpi", box: { x: 0, y: 0, w: 300, h: 120 } }))).toBe(true);
    for (const k of ["stats", "moms", "tag", "sep", "filter", "momLabel"]) expect(needsV9(add({ [k]: k === "momLabel" ? "M" : { a: { n: 1 } } })), k).toBe(true);
    expect(needsV9(add({ deltas: { d1: { n: 1 } } }))).toBe(true);                      // (any later key)
    expect(needsV9(add({ stats: null }))).toBe(false);
    expect(needsV9(add({ stats: { s1: null } }))).toBe(false);
    expect(needsV9({ op: "item.patch", slide: "s", id: "i", patch: null })).toBe(false);
    expect(needsV9(add({ kind: "chart", type: "line", values: { sheet: "A", range: "A1" }, box: { x: 0, y: 0, w: 1, h: 1 } }))).toBe(false);
    expect(needsV9({ op: "slide.add", slide: { id: "x", type: "content", tables: [], items: { k: { kind: "kpi", box: { x: 0, y: 0, w: 1, h: 1 } } } }, after: null } as unknown as Op)).toBe(true);
    expect(needsV9(b54Ops()[0])).toBe(false);
    const { doc } = applyOps(emptyDoc("W"), b54Ops());
    expect(docNeedsV9(doc)).toBe(true);
    expect(needsV9({ op: "preset.set", preset: doc.preset } as Op)).toBe(true);
    // (needsV8 is true too – a key outside 4.10's lists – and the raise goes to the highest: DocSync's due)
    expect(needsV8(add({ stats: { s1: { n: 1, src: "last" } } }))).toBe(true);
    expect(docNeedsV8({ preset: { sheets: [], tables: [], slides: [] }, edits: {} } as unknown as WorkbookDoc)).toBe(false);
  });
  it("knownOp, apply and the inverses: create ↔ delete, a map entry back, a plain key back", () => {
    const ops = b54Ops();
    for (const o of ops) expect(knownOp(o)).toBe(true);
    const { doc } = applyOps(emptyDoc("W"), ops.slice(0, 1));
    const create = ops[1] as Extract<Op, { op: "item.patch" }>;
    expect(inverseOf(doc, create)).toEqual({ op: "item.patch", slide: "b54", id: "cl", patch: null });
    const { doc: d2 } = applyOps(doc, [create]);
    expect(d2.preset!.slides[0].items!.cl).toEqual(create.patch);
    const del: Op = { op: "item.patch", slide: "b54", id: "cl", patch: null };
    const { doc: d4 } = applyOps(d2, [del, inverseOf(d2, del)!]);
    expect(d4.preset!.slides[0].items!.cl).toEqual(create.patch);
    // a chart card's maps per entry
    const c0 = volumeCard("Loans", "D2", { x: 0, y: 0, w: 600, h: 400 }, { text: "A" });
    const { doc: d5 } = applyOps(doc, [{ op: "item.patch", slide: "b54", id: "c", patch: c0 as unknown as ItemPatch }]);
    const e2: Op = { op: "item.patch", slide: "b54", id: "c", patch: { moms: { m2: null, m4: { n: 4, vs: "peak" } }, tag: null, sep: { w: 2 } } };
    const { doc: d6 } = applyOps(d5, [e2, inverseOf(d5, e2)!]);
    expect(d6.preset!.slides[0].items!.c).toEqual(c0);
  });
});
describe("B54 · vectors (shared/ops-vectors.d/b54.json)", () => {
  for (const v of loadVectors().filter(x => /^B54 /.test(x.name))) it(v.name + ": knownOp, needsV8 / needsV9, docNeedsV9", () => {
    expect(v.ops.map((o: Op) => [knownOp(o), needsV8(o), needsV9(o)])).toEqual(v.ops.map((_: Op, k: number) => [v.expect.knownOp[k], v.expect.needsV8[k], v.expect.needsV9[k]]));
    const { doc } = applyOps(v.doc, v.ops);
    expect([docNeedsV8(doc), docNeedsV9(doc)]).toEqual([v.expect.docNeedsV8, v.expect.docNeedsV9]);
  });
});
