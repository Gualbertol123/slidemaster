/* B56 (4.14; model/textparts.ts): every text of the owner's slide (app/tests/fixtures/B54.xlsx in the Excel design) gets a
   font, size, colour, bold / italic and alignment; every part of a KPI card and of a chart card its size and place.
   Per part: the style → the display list → the PowerPoint file (text boxes' runs and paragraphs, the native chart's
   c:txPr); the KPI card's value alignment, divider, header bar, rows and padding; the chart card's rows, tag, spacing and
   plot margins; the parts dragged (`offs`) and their inverses; no style = the display list exactly as before; the keys'
   ops (knownOp, inverse, the format guards: needsV9 and B55's needsV10). B56_PPTX_OUT=<folder> writes the
   styled slide's PowerPoint file (pptxcheck). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { validate, type DisplayList, type Node, type TextNode } from "../src/dl/types";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, docNeedsV10, emptyDoc, inverseOf, knownOp, needsV10, needsV9 } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { slideToDisplayList, type SlideDL } from "../src/render/slide-dl";
import { computeLayout } from "../src/render/layout";
import { writePptx } from "../src/pptx/writer";
import type { SlideSem } from "../src/pptx/scene";
import { pptxFamily } from "../src/text/resolve";
import { DESIGNS } from "../src/model/designs";
import { wrapLines } from "../src/text/lines";
import { isOffKey, layNum, layWord, offOf, partFmt } from "../src/model/textparts";
import type { RenderCtx } from "../src/render/context";
import type { ChartItem, Design, ItemPatch, Op } from "../src/model/types";
import type { KpiItem } from "../src/model/kpi";
import { b54Ops } from "./b54-deck";
import { b55Ops } from "./b55-deck";

const here = path.dirname(fileURLToPath(import.meta.url));
const BOOK = path.join(here, "../../app/tests/fixtures/B54.xlsx");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const size = (font: string) => parseFloat(/([\d.]+)px/.exec(font)![1]);
const M: Metrics = {
  run: (t, font) => ({ w: [...t].length * size(font) * .5, asc: size(font) * .8, desc: size(font) * .2 }),
  lines: (t, font, width) => wrapLines(t, width, s => [...s].length * size(font) * .5),
};
const flat = (l: DisplayList): Node[] => l.flatMap(n => n.t === "group" ? [n, ...flat(n.children)] : [n]);
type TN = TextNode & { w: number; css: string; weight: number };
const texts = (l: DisplayList) => flat(l).filter((n): n is TextNode => n.t === "text").map(n => ({ ...n, w: n.w ?? 0, css: n.css ?? n.font, weight: n.weight ?? (n.b ? 700 : 400) }) as TN);
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const NEG = "−";
const hex = (n: TextNode) => "#" + ("solid" in n.fill ? n.fill.solid : [0, 0, 0]).map(v => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
const patch = (id: string, p: Record<string, unknown>): Op => ({ op: "item.patch", slide: "b54", id, patch: p as ItemPatch });

async function deckWith(ops: Op[], forExport = true) { return deck("excel", ops, forExport, true); }
async function deck(design: Design, extra: Op[] = [], forExport = true, own = false) {
  const wb = await readWorkbook(ab(BOOK));
  const { doc: view, skipped } = applyOps(emptyDoc("B54.xlsx"), own ? [b54Ops()[0], ...extra] : [...b54Ops(), ...extra]);
  expect(skipped).toEqual([]);
  const style = resolveStyle({}, { ...view.style, design }), slides = runtimeSlides(wb, view.preset, "B54.xlsx", design);
  const ctx: RenderCtx = { style, edits: {}, slides, preset: view.preset || null, workbook: "B54.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null, forExport };
  const lists = slides.map((R, i) => slideToDisplayList(R, i, ctx, R.tables.map(L => excelToDisplayList(L, ctx, M)), computeLayout(R, ctx).boxes, { wall: null, logo: null }, M, "23 October 2026", { sem: true }));
  const item = (id: string) => { const l = lists[0]; return { info: l.items[id], nodes: l.nodes.slice(l.items[id].at[0], l.items[id].at[1]) }; };
  return { view, lists, item, ctx };
}
const pptxOf = (lists: SlideDL[]) => writePptx({ slides: lists.map(l => ({ nodes: l.nodes, sem: { type: "content" as const, items: Object.fromEntries(Object.entries(l.items).flatMap(([id, it]) => it.pptx ? [[id, it.pptx]] : [])), palette: [] } as SlideSem })), image: () => PNG, face: css => pptxFamily(css) });
async function pptx(lists: SlideDL[]) {
  const z = unzipSync(await pptxOf(lists)), part = (re: RegExp) => Object.keys(z).filter(n => re.test(n)).sort().map(n => strFromU8(z[n]));
  return { slide: part(/^ppt\/slides\/slide\d+\.xml$/)[0], charts: part(/^ppt\/charts\/chart\d+\.xml$/), bytes: z };
}
/** the a:rPr of the run showing `text` in a slide's XML (and the paragraph's algn) */
function runOf(xml: string, text: string, last = false): { rpr: string; algn: string | null } | null {
  const i = last ? xml.lastIndexOf(`<a:t>${text}</a:t>`) : xml.indexOf(`<a:t>${text}</a:t>`); if (i < 0) return null;
  const r = xml.lastIndexOf("<a:rPr", i), p = xml.lastIndexOf("<a:pPr", i), a = /algn="(\w+)"/.exec(xml.slice(p, xml.indexOf(">", p)));
  return { rpr: xml.slice(r, i), algn: a ? a[1] : null };
}
const fmtIn = (rpr: string, f: { face?: string; pt?: number; b?: boolean; i?: boolean; color?: string }, what = "") => {
  if (f.face) expect(rpr, what).toContain(`<a:latin typeface="${f.face}"/>`);
  if (f.pt) expect(rpr, what).toContain(`sz="${Math.round(f.pt * 100)}"`);
  if (f.b !== undefined) expect(rpr, what).toContain(`b="${f.b ? 1 : 0}"`);
  if (f.i !== undefined) expect(rpr, what).toContain(`i="${f.i ? 1 : 0}"`);
  if (f.color) expect(rpr, what).toContain(`<a:srgbClr val="${f.color.slice(1)}"`);
};
/** the c:txPr default run properties of the element `tag` (its first) in a chart part */
function txPrOf(xml: string, tag: string): string {
  const i = xml.indexOf(`<${tag}>`); expect(i, tag).toBeGreaterThanOrEqual(0);
  const end = xml.indexOf(`</${tag}>`, i), seg = xml.slice(i, end), t = seg.lastIndexOf("<c:txPr>");
  return seg.slice(t, seg.indexOf("</c:txPr>", t));
}

describe("B56 · the model's clamps", () => {
  it("a part's format, a layout number / word, an offset; a broken one is none", () => {
    const it = { texts: { value: { align: "center" }, head: "x" }, lay: { split: 140, valign: "side", rows: "top", pad: true, gap: "7" }, offs: { kv: { dx: 2, dy: "x" }, kr: null } } as unknown as KpiItem;
    expect([partFmt(it, "value"), partFmt(it, "head"), partFmt(it, "delta")]).toEqual([{ align: "center" }, undefined, undefined]);
    expect([layNum(it, "split", 10, 90), layNum(it, "pad", 0, 80), layNum(it, "gap", 0, 80), layNum(it, "none", 0, 9)]).toEqual([90, undefined, 7, undefined]);
    expect([layWord(it, "valign", ["top", "middle"]), layWord(it, "rows", ["top", "middle"])]).toEqual([undefined, "top"]);
    expect([offOf(it, "kv", { w: 100, h: 50 }), offOf(it, "kr", { w: 100, h: 50 }), offOf({}, "kv", { w: 1, h: 1 })]).toEqual([{ x: 100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]);
    expect(["kv", "kr", "tag", "mh", "st:s1", "mo:m2", "title", "v:vol:3", "r:r1"].map(isOffKey)).toEqual([true, true, true, true, true, true, false, false, false]);
  });
});

describe("B56 · no style: every design's slide exactly as before", () => {
  it("empty texts / lay / offs maps draw the owner's slide node for node as the deck without them (export and screen)", async () => {
    const empty = ["k1", "k2", "k3", "k4", "cl", "cd"].map(id => patch(id, { texts: {}, lay: {}, offs: {} }));
    for (const d of DESIGNS) for (const fe of [true, false]) {
      const a = await deck(d, [], fe), b = await deck(d, empty, fe);
      expect(JSON.stringify(b.lists[0].nodes), `${d} ${fe}`).toBe(JSON.stringify(a.lists[0].nodes));
    }
  });
  it("(the maps are dropped when emptied: an item.patch of empty maps leaves no key behind)", async () => {
    const { view } = await deck("excel", [patch("k1", { texts: {}, lay: {}, offs: {} })]);
    const k = view.preset!.slides[0].items!.k1 as unknown as Record<string, unknown>;
    expect(["texts", "lay", "offs"].filter(x => x in k)).toEqual([]);
  });
});

describe("B56 · KPI card: each text's format, display list → PowerPoint", () => {
  const STYLED = patch("k1", { texts: {
    head: { font: "Georgia", size: 20, color: "#FFD700", i: true, caps: false },
    value: { font: "Georgia", size: 56, color: "#123456", b: false, align: "center" },
    delta: { font: "Courier New", size: 15, color: "#AA00AA", b: false, i: true, align: "left" },
    label: { font: "Verdana", size: 13, color: "#008080", b: true, align: "right" } } });
  it("the header's title, the value, each change and each label in their own font, size, colour, weight, italic and place", async () => {
    const { item } = await deck("excel", [STYLED]), T = texts(item("k1").nodes), by = (s: string) => T.find(t => t.src === s)!;
    const head = by("Loans"), value = by("10"), delta = by("+1,0%"), label = by("vs Bdg");
    expect([head.css, head.size, hex(head), !!head.i, head.weight]).toEqual(["'Georgia',Georgia,'Times New Roman',serif", 20, "#FFD700", true, 700]);
    expect([value.css, value.size, hex(value), value.weight]).toEqual(["'Georgia',Georgia,'Times New Roman',serif", 56, "#123456", 400]);
    expect([delta.css, delta.size, hex(delta), delta.weight, !!delta.i]).toEqual(["'Courier New',Consolas,'Courier New',monospace", 15, "#AA00AA", 400, true]);
    expect([label.css, label.size, hex(label), label.weight]).toEqual(["'Verdana','Segoe UI',Arial,sans-serif", 13, "#008080", 700]);
    // (the untouched cards keep their look: the second card's title in caps, its value in its tone)
    const { item: other } = await deck("excel", [STYLED]);
    expect(texts(other("k2").nodes).some(t => t.src === "DEPOSITS")).toBe(true);
    // the value centred in its section (36 % of the card), the changes from the column's left, the labels to the card's right
    const box = { x: 61, w: 350 }, vw = box.w * .36;
    expect(value.x + value.w / 2).toBeCloseTo(box.x + vw / 2, 1);
    const pad = Math.max(4, Math.min(24, box.w * .04)), rx = box.x + vw + pad;
    expect(delta.x).toBeCloseTo(rx, 1);
    expect(label.x + label.w).toBeCloseTo(box.x + box.w - pad, 1);
  });
  it("PowerPoint: the runs carry the fonts, sizes, colours, bold and italic; an aligned text is a box of its section, aligned", async () => {
    const { lists } = await deck("excel", [STYLED]), { slide } = await pptx(lists);
    const head = runOf(slide, "Loans")!, value = runOf(slide, "10")!, delta = runOf(slide, "+1,0%")!, label = runOf(slide, "vs Bdg")!;
    fmtIn(head.rpr, { face: "Georgia", pt: 12, i: true, b: true, color: "#FFD700" });
    fmtIn(value.rpr, { face: "Georgia", pt: 33.6, b: false, color: "#123456" });
    fmtIn(delta.rpr, { face: "Courier New", pt: 9, b: false, i: true, color: "#AA00AA" });
    fmtIn(label.rpr, { face: "Verdana", pt: 7.8, b: true, color: "#008080" });
    expect([value.algn, delta.algn, label.algn]).toEqual(["ctr", "l", "r"]);
    // (a card without alignments: each text a box of its own extent, as 4.13 wrote it)
    expect(runOf(slide, "DEPOSITS")!.algn).toBe("l");
    expect(slide).not.toContain("<p:pic");
  });
});

describe("B56 · KPI card: sizing and positioning", () => {
  const node = async (extra: Record<string, unknown>, d: Design = "excel", fe = true) => {
    const { item } = await deck(d, [patch("k1", extra)], fe);
    return item("k1").nodes;
  };
  it("the value: left (default), centre, right in its section; top, middle, bottom", async () => {
    const base = texts(await node({})).find(t => t.src === "10")!;
    const at = async (align: string, valign?: string) => texts(await node({ texts: { value: { align } }, ...(valign ? { lay: { valign } } : {}) })).find(t => t.src === "10")!;
    const c = await at("center"), r = await at("right"), top = await at("left", "top"), bottom = await at("left", "bottom");
    const vw = 350 * .36, pad = 14;
    expect(base.x).toBeCloseTo(61 + pad, 1);
    expect(c.x + c.w / 2).toBeCloseTo(61 + vw / 2, 1);
    expect(r.x + r.w).toBeCloseTo(61 + vw - pad, 1);
    expect(top.y).toBeLessThan(base.y);
    expect(bottom.y).toBeGreaterThan(base.y);
    expect([c.y, r.y]).toEqual([base.y, base.y]);
  });
  it("the divider: its place (split %) and off; the header bar's height and off; the padding", async () => {
    const lines = (ns: Node[]) => flat(ns).filter(n => n.t === "line") as Extract<Node, { t: "line" }>[];
    expect(lines(await node({}))[0].x1).toBeCloseTo(61 + 350 * .36, 1);
    expect(lines(await node({ lay: { split: 50 } }))[0].x1).toBeCloseTo(61 + 175, 1);
    expect(lines(await node({ lay: { split: 5 } }))[0].x1).toBeCloseTo(61 + 35, 1);           // (clamped to 10 %)
    expect(lines(await node({ lay: { div: false } }))).toEqual([]);
    const bar = (ns: Node[]) => flat(ns).find(n => n.t === "rect" && Array.isArray(n.r)) as Extract<Node, { t: "rect" }> | undefined;
    expect(bar(await node({}))!.h).toBe(33.8);
    expect(bar(await node({ lay: { headH: 24 } }))!.h).toBe(24);
    const off = await node({ lay: { bar: false } });
    expect(bar(off)).toBeUndefined();
    expect(hex(texts(off).find(t => t.src === "LOANS")!)).toBe("#16181D");                    // (the title stays, in the card's ink)
    expect(texts(await node({ lay: { pad: 30 } })).find(t => t.src === "LOANS")!.x).toBeCloseTo(91, 1);
  });
  it("the rows: spread (default), a block at the top / middle / bottom with its spacing", async () => {
    const ys = async (lay: Record<string, unknown>) => texts(await node({ lay })).filter(t => /^[+−]/.test(t.src)).map(t => t.y);
    const spread = await ys({}), top = await ys({ rows: "top", rowGap: 2 }), mid = await ys({ rows: "middle", rowGap: 2 }), bottom = await ys({ rows: "bottom", rowGap: 2 }), wide = await ys({ rows: "top", rowGap: 10 });
    expect(spread.length).toBe(3);
    expect(top[0]).toBeLessThan(mid[0]);
    expect(mid[0]).toBeLessThan(bottom[0]);
    expect(top[1] - top[0]).toBeLessThan(spread[1] - spread[0]);
    expect(wide[1] - wide[0]).toBeCloseTo(top[1] - top[0] + 8, 5);
  });
  it("the value and the rows dragged: offsets as fractions of the card; a drag hit for each on screen only", async () => {
    const base = await node({}), moved = await node({ offs: { kv: { dx: .1, dy: -.1 }, kr: { dx: -.02, dy: .05 } } });
    const v = (ns: Node[]) => texts(ns).find(t => t.src === "10")!, d = (ns: Node[]) => texts(ns).find(t => t.src === "+1,0%")!;
    expect([v(moved).x - v(base).x, v(moved).y - v(base).y]).toEqual([35, -13]);
    expect(d(moved).x - d(base).x).toBeCloseTo(-7, 5);
    expect(d(moved).y - d(base).y).toBeCloseTo(6.5, 5);
    const hits = (ns: Node[]) => flat(ns).filter(n => n.t === "hit" && n.kind === "label").map(n => (n as { id: string }).id);
    expect(hits(base)).toEqual([]);
    expect(hits(await node({}, "excel", false))).toEqual(["k1|kv", "k1|kr"]);
    expect(hits(await node({}, "glass", false))).toEqual(["k1|kv", "k1|kr"]);
  });
  it("(review) a value's or title's own size larger than its section is held to it – drawn, and said in the Issues line", async () => {
    const { item } = await deck("excel", [patch("k1", { texts: { value: { size: 80 }, head: { size: 60 } } })]);
    const T = texts(item("k1").nodes), v = T.find(t => t.src === "10"), h = T.find(t => t.src === "LOANS")!;
    const hh = 33.8, bh = 130 - hh;
    expect(v).toBeTruthy();
    expect(v!.size).toBeLessThanOrEqual(bh / 1.25);
    expect(h.size).toBeLessThanOrEqual(hh / 1.25);
    expect(item("k1").info.issue).toMatch(/the title's size, the value cut to fit the card/);
    // (a size that fits: kept, no Issues line)
    const ok = await deck("excel", [patch("k1", { texts: { value: { size: 40 } } })]);
    expect(texts(ok.item("k1").nodes).find(t => t.src === "10")!.size).toBe(40);
    expect(ok.item("k1").info.issue).toBeNull();
  });
  it("(review) a label's own size larger than the changes' sets the rows' pitch: no two rows overlap", async () => {
    for (const rows of ["spread", "top"]) {
      const ns = await node({ texts: { label: { size: 22 } }, lay: { rows, rowGap: 0 }, box: { x: 61, y: 180, w: 350, h: 200 } });
      const L = texts(ns).filter(t => t.src.startsWith("vs ")).sort((a, b) => a.y - b.y);
      expect(L.length, rows).toBeGreaterThan(1);
      for (let i = 1; i < L.length; i++) expect(L[i].y - L[i - 1].y, rows).toBeGreaterThanOrEqual(Math.round(22 * 1.25) - .01);
    }
  });
  it("every design draws a styled, laid-out card with valid nodes", async () => {
    for (const d of DESIGNS) {
      const ns = await node({ texts: { value: { align: "center", size: 40 }, head: { align: "center" } }, lay: { split: 45, rows: "middle", rowGap: 3, headH: 30, pad: 10 }, offs: { kv: { dx: .01, dy: 0 } } }, d);
      expect(validate(ns), d).toEqual([]);
      expect(texts(ns).find(t => t.src === "10")!.size, d).toBe(40);
    }
  });
});

describe("B56 · chart card: each text's format, display list → PowerPoint", () => {
  // the owner's chart: other fonts and sizes for the title and the axis labels, the data labels, the reference line's label,
  // the legend, the card's stats, tag and momentum row
  const STYLED = patch("cd", {
    titleFmt: { font: "Georgia", size: 26, color: "#0A2F6B", b: true, align: "center" },
    axes: { y: { num: "#,##0", fmt: { font: "Verdana", size: 11, color: "#555555", i: true } }, x: { fmt: { font: "Verdana", size: 12, color: "#444444", b: true } } },
    sers: { vol: { n: 1, name: "Deposits", vals: [{ sheet: "Volumes", range: "C2:C9" }], color: "#2F55F4", line: { w: 3 }, marker: { shape: "circle", size: 9 }, labels: { show: ["value"], pos: "auto", fmt: { font: "Tahoma", size: 13, color: "#202020", b: true }, num: "#,##0" } } },
    marks: { r1: { kind: "ref", value: { sheet: "Volumes", range: "D6" }, name: "Budget", style: { dash: "solid", w: 1.5 }, fmt: { font: "Calibri", size: 12, color: "#B00020", i: true } } },
    legendAt: "bottom",
    texts: { legend: { font: "Corbel", size: 12, color: "#333333", i: true },
      statLabel: { font: "Calibri", size: 10, color: "#666666", caps: false }, statValue: { font: "Georgia", size: 30, b: false },
      tag: { font: "Tahoma", size: 11, color: "#00838F" }, momVal: { font: "Calibri", size: 14 }, momCap: { font: "Calibri", size: 10, i: true, color: "#777777" }, momHead: { font: "Calibri", size: 12, color: "#0A2F6B", caps: false } } });
  it("the display list: title, tick and category labels, data labels, the line's label, the legend, the card's texts", async () => {
    const { item } = await deck("excel", [STYLED]), T = texts(item("cd").nodes), by = (s: string) => T.find(t => t.src === s);
    const f = (n: TN | undefined) => n && [n.css.split(",")[0], n.size, hex(n), n.weight >= 600, !!n.i];
    expect(f(by("DEPOSITS · WEEKLY VOLUME"))).toEqual(["'Georgia'", 26, "#0A2F6B", true, false]);
    const ticks = T.filter(t => t.css.startsWith("'Verdana'") && t.size === 11 && /^\d\.\d00$/.test(t.src));
    expect(ticks.length).toBeGreaterThan(3);
    for (const t of ticks) expect(f(t)).toEqual(["'Verdana'", 11, "#555555", false, true]);
    expect(f(by("W38"))).toEqual(["'Verdana'", 12, "#444444", true, false]);
    expect(f(T.find(t => t.src === "7.000" && t.size === 13))).toEqual(["'Tahoma'", 13, "#202020", true, false]);
    expect(f(by("Budget 8.700"))).toEqual(["'Calibri'", 12, "#B00020", true, true]);
    expect(f(by("Deposits"))).toEqual(["'Corbel'", 12, "#333333", false, true]);
    expect(f(by("Latest volume"))).toEqual(["'Calibri'", 10, "#666666", true, false]);
    expect(f(T.find(t => t.src === "8.700" && t.size === 30))).toEqual(["'Georgia'", 30, "#16181D", false, false]);
    expect(f(by("ILLUSTRATIVE"))).toEqual(["'Tahoma'", 11, "#00838F", true, false]);
    expect(f(by("MOMENTUM"))).toEqual(["'Calibri'", 12, "#0A2F6B", true, false]);
    expect(f(by("since trough"))).toEqual(["'Calibri'", 10, "#777777", false, true]);
    expect(f(by(NEG + "1.420 (" + NEG + "16,9%)"))![1]).toBe(14);
  });
  it("PowerPoint: the native chart's c:txPr – title, axes, data labels, legend – and the card's text boxes carry the formats", async () => {
    const { lists } = await deck("excel", [STYLED]), { slide, charts } = await pptx(lists);
    const ch = charts.find(c => c.includes("DEPOSITS · WEEKLY VOLUME"))!;
    expect(ch).toBeTruthy();
    // the title's rich text run
    const ti = ch.indexOf("<c:title>"), title = ch.slice(ti, ch.indexOf("</c:title>"));
    fmtIn(title, { face: "Georgia", pt: 15.6, b: true, color: "#0A2F6B" }, "title");
    // the value axis's and category axis's tick labels
    fmtIn(txPrOf(ch, "c:valAx"), { face: "Verdana", pt: 6.6, i: true, b: false, color: "#555555" }, "valAx");
    fmtIn(txPrOf(ch, "c:catAx"), { face: "Verdana", pt: 7.2, b: true, color: "#444444" }, "catAx");
    // the data labels and the legend
    const dl = ch.slice(ch.indexOf("<c:dLbls>"), ch.indexOf("</c:dLbls>"));
    fmtIn(dl, { face: "Tahoma", pt: 7.8, b: true, color: "#202020" }, "dLbls");
    fmtIn(txPrOf(ch, "c:legend"), { face: "Corbel", pt: 7.2, i: true, color: "#333333" }, "legend");
    // the card: text boxes over the native chart
    fmtIn(runOf(slide, "Latest volume")!.rpr, { face: "Calibri", pt: 6, color: "#666666" }, "stat label");
    fmtIn(runOf(slide, "ILLUSTRATIVE")!.rpr, { face: "Tahoma", pt: 6.6, color: "#00838F" }, "tag");
    fmtIn(runOf(slide, "since trough", true)!.rpr, { face: "Calibri", pt: 6, i: true, color: "#777777" }, "caption");
    fmtIn(runOf(slide, "Budget 8.700")!.rpr, { face: "Calibri", pt: 7.2, i: true, color: "#B00020" }, "ref label");
    expect(slide).not.toContain("<p:pic");
    if (process.env.B56_PPTX_OUT) { fs.mkdirSync(process.env.B56_PPTX_OUT, { recursive: true }); fs.writeFileSync(path.join(process.env.B56_PPTX_OUT, "b56-core.pptx"), await pptxOf(lists)); }
  });
  it("without a legend format the PowerPoint legend keeps the labels' font (no legendFont)", async () => {
    const { lists } = await deck("excel", [patch("cd", { legendAt: "bottom" })]), { charts } = await pptx(lists);
    const ch = charts.find(c => c.includes("DEPOSITS · WEEKLY VOLUME"))!;
    const space = ch.slice(ch.lastIndexOf("<c:txPr>"), ch.indexOf("</c:txPr>", ch.lastIndexOf("<c:txPr>")));
    expect(txPrOf(ch, "c:legend")).toBe(space);
    expect(lists[0].items.cd.pptx && "chart" in lists[0].items.cd.pptx! ? (lists[0].items.cd.pptx as { chart: { legendFont?: unknown } }).chart.legendFont : undefined).toBeUndefined();
  });
});

describe("B56 · chart card: sizing and positioning", () => {
  const card = async (p: Record<string, unknown>, fe = true) => { const { item } = await deck("excel", [patch("cd", p)], fe); return item("cd").nodes; };
  const xOf = (ns: Node[], s: string) => texts(ns).find(t => t.src === s)!;
  it("the stats row: from the left (default), centred as a group, spread to both edges; a chip width", async () => {
    const L = ["LATEST VOLUME", "EOM BUDGET", "GAP TO BUDGET"];
    const left = await card({}), mid = await card({ lay: { stats: "center" } }), spread = await card({ lay: { stats: "spread" } }), w20 = await card({ lay: { statW: 20 } });
    const xs = (ns: Node[]) => L.map(s => xOf(ns, s).x);
    const a = xs(left), c = xs(mid), sp = xs(spread), w = xs(w20);
    expect(a[1] - a[0]).toBeCloseTo(a[2] - a[1], 1);
    expect(c[0]).toBeGreaterThan(a[0] + 20);                                   // (centred: the group starts further right)
    const right = (ns: Node[]) => Math.max(...L.map(s => xOf(ns, s).x + xOf(ns, s).w));
    expect(sp[0]).toBeCloseTo(a[0], 1);
    expect(right(spread)).toBeGreaterThan(right(left));                        // (spread: the last chip at the right edge)
    expect(w[1] - w[0]).toBeGreaterThan(135); expect(w[1] - w[0]).toBeLessThan(146);   // (a fifth of the chart's frame per chip)
    // centred: the group's middle is the frame's middle
    const lo = Math.min(...c), hi = right(mid), frameMid = 812 + 725 / 2;
    expect(Math.abs((lo + hi) / 2 - frameMid)).toBeLessThan(20);
  });
  it("the momentum row: centred and spread too", async () => {
    const base = await card({}), mid = await card({ lay: { moms: "center" } });
    expect(xOf(mid, "since trough").x).toBeGreaterThan(xOf(base, "since trough").x);
    const sp = await card({ lay: { moms: "spread" } }), last = texts(sp).find(t => t.src === "WoW")!;
    expect(last.x + last.w).toBeGreaterThan(xOf(base, "WoW").x + xOf(base, "WoW").w);
  });
  it("in-chip alignment follows the part's format (stat labels centred in their chips)", async () => {
    const base = await card({}), c = await card({ texts: { statLabel: { align: "center" } } });
    expect(xOf(c, "EOM BUDGET").x).toBeGreaterThan(xOf(base, "EOM BUDGET").x);
  });
  it("the tag under the title on a line of its own (the plot comes down); in the corner by default", async () => {
    const base = await card({}), below = await card({ lay: { tag: "below" } });
    const tb = xOf(below, "ILLUSTRATIVE"), t0 = xOf(base, "ILLUSTRATIVE"), title = xOf(below, "DEPOSITS · WEEKLY VOLUME");
    expect(Math.abs(t0.y - title.y)).toBeLessThan(10);                          // (by default: in the title's line, at its right)
    expect(t0.x).toBeGreaterThan(title.x + title.w);
    expect(tb.y).toBeGreaterThan(title.y);
    expect(tb.x).toBeLessThan(t0.x);
    expect(xOf(below, "LATEST VOLUME").y).toBeGreaterThan(xOf(base, "LATEST VOLUME").y);
  });
  it("the spacing under the title, above the plot and above the momentum row; the plot's margins", async () => {
    const { lists: a } = await deck("excel"), { lists: b } = await deck("excel", [patch("cd", { lay: { gapH: 20, gapP: 30, gapF: 30, padL: 40, padR: 20, padT: 10, padB: 10 } })]);
    const plotOf = (l: SlideDL[]) => { const c = (l[0].items.cd.pptx as { chart: { bars: { plot: { x: number; y: number; w: number; h: number } } } }).chart.bars.plot; return c; };
    const p0 = plotOf(a), p1 = plotOf(b);
    expect(p1.x).toBeGreaterThan(p0.x + 30);
    expect(p1.w).toBeLessThan(p0.w - 50);
    expect(p1.y).toBeGreaterThan(p0.y + 30);
    const S = (l: SlideDL[], s: string) => texts(l[0].nodes).filter(t => t.src === s).sort((x, y) => x.x - y.x).slice(-1)[0];
    expect(S(b, "LATEST VOLUME").y - S(a, "LATEST VOLUME").y).toBeCloseTo(12, 5);
    expect(S(b, "WoW").y).toBeLessThanOrEqual(S(a, "WoW").y);
  });
  it("chips, the tag and the momentum label dragged: offsets as fractions of the box; drag hits on screen", async () => {
    const base = await card({}), moved = await card({ offs: { "st:s2": { dx: .1, dy: .02 }, "mo:m3": { dx: -.05, dy: 0 }, tag: { dx: 0, dy: .02 }, mh: { dx: .01, dy: 0 } } });
    expect(xOf(moved, "EOM BUDGET").x - xOf(base, "EOM BUDGET").x).toBeCloseTo(72.5, 5);
    expect(xOf(moved, "EOM BUDGET").y - xOf(base, "EOM BUDGET").y).toBeCloseTo(10.4, 5);
    expect(xOf(moved, "WoW").x - xOf(base, "WoW").x).toBeCloseTo(-36.25, 5);
    expect(xOf(moved, "ILLUSTRATIVE").y - xOf(base, "ILLUSTRATIVE").y).toBeCloseTo(10.4, 5);
    expect(xOf(moved, "MOMENTUM").x - xOf(base, "MOMENTUM").x).toBeCloseTo(7.25, 5);
    expect(xOf(moved, "LATEST VOLUME").x).toBe(xOf(base, "LATEST VOLUME").x);
    const hits = (ns: Node[]) => flat(ns).filter(n => n.t === "hit" && n.kind === "label").map(n => (n as { id: string }).id).filter(k => /\|(st|mo|tag|mh)/.test(k)).sort();
    expect(hits(base)).toEqual([]);
    expect(hits(await card({}, false))).toEqual(["cd|mh", "cd|mo:m1", "cd|mo:m2", "cd|mo:m3", "cd|st:s1", "cd|st:s2", "cd|st:s3", "cd|tag"]);
  });
});

describe("B56 · the ops", () => {
  const P: Record<string, unknown>[] = [
    { texts: { value: { align: "center" } } }, { lay: { split: 40 } }, { offs: { kv: { dx: .1, dy: 0 } } },
    { texts: { legend: { size: 12 } } }, { lay: { stats: "center" } }, { offs: { "st:s1": { dx: .1, dy: 0 } } }];
  it("each new key is known whole and applied; its inverse restores the item; it raises the deck's format (needsV9, and B55's needsV10)", async () => {
    const { view } = await deck("excel");
    for (const p of P) {
      const id = "texts" in p && "legend" in (p.texts as object) || "st:s1" in ((p.offs || {}) as object) || "stats" in ((p.lay || {}) as object) ? "cd" : "k1";
      const op = patch(id, p);
      expect(knownOp(op), JSON.stringify(p)).toBe(true);
      expect(needsV9(op), JSON.stringify(p)).toBe(true);
      const inv = inverseOf(view, op)!, after = applyOps(view, [op]).doc, back = applyOps(after, [inv]).doc;
      expect(after.preset!.slides[0].items![id], JSON.stringify(p)).not.toEqual(view.preset!.slides[0].items![id]);
      expect(back.preset!.slides[0].items![id], JSON.stringify(p)).toEqual(view.preset!.slides[0].items![id]);
    }
    // removing an entry (null) is not new content
    expect(needsV9(patch("k1", { texts: { value: null }, lay: null, offs: { kv: null } }))).toBe(false);
  });
  it("format 10 (B55's needsV10): each new key alone – texts, lay, offs on a KPI card and a chart – raises the deck; removing it does not; a deck holding one is format 10", async () => {
    for (const p of P) for (const id of ["k1", "cd"]) {
      expect(needsV10(patch(id, p)), `${id} ${JSON.stringify(p)}`).toBe(true);
      const k = Object.keys(p)[0];
      expect(needsV10(patch(id, { [k]: null })), `${id} ${k}: null`).toBe(false);
      expect(needsV10(patch(id, { [k]: { x: null } })), `${id} ${k}: {x: null}`).toBe(false);
    }
    for (const k of ["texts", "lay", "offs"]) {
      expect(needsV10({ op: "slide.add", after: null, slide: { id: "n", type: "content", tables: [], items: { k: { kind: "kpi", box: { x: 0, y: 0, w: 9, h: 9 }, [k]: { kv: { dx: .1, dy: 0 } } } } } }), k).toBe(true);
      const { view } = await deck("excel", [patch("k1", { [k]: k === "lay" ? { split: 40 } : k === "texts" ? { value: { b: true } } : { kv: { dx: .1, dy: 0 } } })]);
      expect(docNeedsV10(view), k).toBe(true);
    }
    const { view } = await deck("excel");
    expect(docNeedsV10(view)).toBe(false);
  });
  it("one drag is one op: its inverse puts the offset back (an earlier offset kept)", async () => {
    const { view } = await deck("excel", [patch("k1", { offs: { kv: { dx: .1, dy: 0 } } })]);
    const op = patch("k1", { offs: { kv: { dx: .2, dy: .1 } } }), inv = inverseOf(view, op)!;
    expect(inv).toEqual(patch("k1", { offs: { kv: { dx: .1, dy: 0 } } }));
  });
});

describe("(review) B55's budget-achievement chart follows the card's text and layout", () => {
  const prog = async (p: Record<string, unknown>, fe = true) => {
    const { lists } = await deckWith([...b55Ops("b54").slice(1), patch("ba", { tag: { text: "Illustrative" }, ...p })], fe);
    const l = lists[0], at = l.items.ba.at;
    return { nodes: l.nodes.slice(at[0], at[1]), info: l.items.ba };
  };
  it("the tag under the title on a line of its own, the title then whole; the space under the title; the tag's font; a drag hit for the tag", async () => {
    const base = await prog({}), below = await prog({ lay: { tag: "below", gapH: 30 }, texts: { tag: { font: "Georgia", size: 14 } } });
    const t = (r: { nodes: Node[] }, s: string) => texts(r.nodes).find(x => x.src === s)!;
    const title = t(below, "BUDGET ACHIEVEMENT"), tag = t(below, "ILLUSTRATIVE"), tag0 = t(base, "ILLUSTRATIVE");
    // (default: in the title's line, the title cut clear of it; below it: the title whole)
    const t0 = texts(base.nodes).find(x => x.src.startsWith("BUDGET"))!;
    expect(Math.abs(tag0.y - t0.y)).toBeLessThan(10);
    expect(title).toBeTruthy();
    expect(tag.y).toBeGreaterThan(title.y + 10);
    expect(tag.x).toBeLessThan(tag0.x);
    expect([tag.css.split(",")[0], tag.size]).toEqual(["'Georgia'", 14]);
    expect(t(below, "Latest volume / EoM budget").y).toBeGreaterThan(t(base, "Latest volume / EoM budget").y + 22);
    const hits = (r: { nodes: Node[] }) => flat(r.nodes).filter(n => n.t === "hit" && n.kind === "label").map(n => (n as { id: string }).id);
    expect(hits(base)).toEqual([]);
    expect(hits(await prog({}, false))).toEqual(["ba|tag"]);
    const moved = await prog({ offs: { tag: { dx: 0, dy: .05 } } });
    expect(t(moved, "ILLUSTRATIVE").y - tag0.y).toBeCloseTo(34, 5);
  });
});

describe("(review) format 10 inside the keys 4.13.1 already had (B55's deep gating)", () => {
  it("the panel writes only 4.13.1's TextFmt keys into titleFmt, fmt, an axis's, a series' labels' and a mark's fmt: not format 10 by themselves; a caps there would be", () => {
    const F = { font: "Georgia", size: 20, color: "#112233", b: true, i: false, align: "center" };
    const ser = { n: 1, vals: [{ sheet: "Volumes", range: "C2:C9" }], labels: { show: ["value"], fmt: F } };
    for (const p of [{ titleFmt: F }, { fmt: { ...F, align: undefined } }, { axes: { y: { fmt: F }, x: { fmt: F } } }, { sers: { vol: ser } },
      { marks: { r1: { kind: "ref", value: 1, fmt: F } } }]) expect(needsV10(patch("cd", p)), JSON.stringify(p)).toBe(false);
    for (const p of [{ titleFmt: { caps: false } }, { fmt: { caps: true } }, { axes: { y: { fmt: { caps: true } } } }, { sers: { vol: { ...ser, labels: { show: ["value"], fmt: { caps: true } } } } },
      { marks: { r1: { kind: "ref", value: 1, fmt: { caps: true } } } }]) expect(needsV10(patch("cd", p)), JSON.stringify(p)).toBe(true);
  });
});

describe("(4.14 integration) one format-10 guard for B55, B56 and B57", () => {
  it("needsV10 flags B56's texts / lay / offs and B57's item bind and table.patch sheet / range / bind; their removals are not format 10", () => {
    for (const p of [{ texts: { value: { align: "center" } } }, { lay: { split: 40 } }, { offs: { kv: { dx: .1, dy: 0 } } }, { bind: { "cur": { at: "KPI!B2", h: "Current", f: true } } }])
      expect(needsV10(patch("k1", p)), JSON.stringify(p)).toBe(true);
    for (const p of [{ sheet: "Volumes" }, { range: "A3:D11" }, { bind: { h: ["Product"], r: 1 } }])
      expect(needsV10({ op: "table.patch", id: "t1", patch: p }), JSON.stringify(p)).toBe(true);
    for (const p of [{ texts: null }, { lay: { split: null } }, { offs: null }, { bind: { cur: null } }]) expect(needsV10(patch("k1", p)), JSON.stringify(p)).toBe(false);
    expect(needsV10({ op: "table.patch", id: "t1", patch: { name: "x" } })).toBe(false);
  });
});
