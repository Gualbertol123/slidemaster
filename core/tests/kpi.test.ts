/* B54 (4.13): the KPI card item – the delta maths (|ref|, a zero reference), the good-direction colours, its drawing in
   all five designs (display-list snapshot), its Issues lines, a reload / scenario (another sheet object) redraws it, the
   ops (kind "kpi", its keys, the inverse) and PowerPoint: native shapes and text boxes, never a picture. The image-16
   data is an in-memory "KPI" sheet. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { validate, type DisplayList, type Node } from "../src/dl/types";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, emptyDoc, inverseOf, knownOp } from "../src/model/ops";
import { itemSheets, presetSheets, runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { slideToDisplayList } from "../src/render/slide-dl";
import { computeLayout } from "../src/render/layout";
import { fitText, kpiData, signedShown } from "../src/render/kpi-dl";
import { targetLook } from "../src/render/chart-targets";
import { kpiClean, kpiDelta, kpiTone, type KpiItem } from "../src/model/kpi";
import { sceneOf, type El, type SlideSem } from "../src/pptx/scene";
import { writePptx } from "../src/pptx/writer";
import { pptxFamily } from "../src/text/resolve";
import { DESIGNS } from "../src/model/designs";
import { wrapLines } from "../src/text/lines";
import type { RenderCtx } from "../src/render/context";
import type { Design, Op } from "../src/model/types";
import type { Cell, Sheet } from "../src/xlsx/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const DECKS = path.join(here, "../../tests/corpus/decks"), BOOKS = path.join(here, "../../tests/corpus/workbooks");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const SLIDE = "u9t3fqb";
/** image 16: Product, Current, Budget_reference, Previous_week, EoM_reference, Delta_vs_Budget, Delta_vs_prev_Week, Delta_vs_EoM */
const ROWS: (string | number)[][] = [
  ["Product", "Current", "Budget_reference", "Previous_week", "EoM_reference", "Delta_vs_Budget", "Delta_vs_prev_Week", "Delta_vs_EoM"],
  ["Loans", 10, 9.900990099, 10.20408163, 9.708737864, .01, -.02, .03],
  ["Deposits", -10, -10.1010101, -9.803921569, -10.30927835, .01, -.02, .03],
  ["WM", 10, 9.900990099, 10.20408163, 9.708737864, .01, -.02, .03],
  ["Certificates", -10, -10.1010101, -9.803921569, -10.30927835, .01, -.02, .03],
  ["Zero", 5, 0, "text", 0, 0, 0, 0],
];
function kpiSheet(base: Sheet, rows = ROWS): Sheet {
  const o = Object.create(base) as Sheet;
  o.name = "KPI";
  o.get = (r: number, c: number) => { const v = rows[r - 1]?.[c - 1]; if (v === undefined) return undefined as unknown as Cell;
    return { r, c, v, t: typeof v === "number" ? "n" : "s", fmt: typeof v === "number" ? (c >= 6 ? "0.0%" : "#,##0") : "General", xf: {} } as unknown as Cell; };
  o.rowHidden = () => false; o.colHidden = () => false; o.cfRules = [];
  return o;
}
const ref = (a: string) => ({ sheet: "KPI", range: a });
/** a card of image 16's row r (2–5) */
export const card = (r: number, x: number, extra: Partial<KpiItem> = {}): KpiItem => ({ kind: "kpi", head: ref("A" + r), cur: ref("B" + r), box: { x, y: 120, w: 360, h: 110 },
  rows: [{ src: { ref: ref("C" + r), mode: "pct" }, label: "vs Bdg", good: "up" }, { src: { ref: ref("D" + r), mode: "pct" }, label: "vs prev. Week", good: "up" },
    { src: { cell: ref("H" + r) }, label: "vs EoM", good: "up" }], ...extra });
async function build(design: Design, items: Record<string, KpiItem>, rows = ROWS, sem = false) {
  const d = JSON.parse(fs.readFileSync(path.join(DECKS, "report.json"), "utf8")) as { workbook: string; ops: Op[] };
  const wb = await readWorkbook(ab(path.join(BOOKS, d.workbook)));
  const ops = [...d.ops, ...Object.entries(items).map(([id, patch]) => ({ op: "item.patch", slide: SLIDE, id, patch }) as Op)];
  const { doc: view, skipped } = applyOps(emptyDoc("W.xlsx"), ops);
  expect(skipped).toEqual([]);
  const style = resolveStyle({}, { ...view.style, design });
  const slides = runtimeSlides(wb, view.preset, "W.xlsx", design), K = kpiSheet(wb.sheets[0], rows);
  const ctx: RenderCtx = { style, edits: view.edits || {}, slides, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "", sheet: n => n === "KPI" ? K : wb.sheets.find(s => s.name === n) || null, version: null, forExport: true };
  const R = ctx.slides[0], boxes = computeLayout(R, ctx).boxes;
  const dl = slideToDisplayList(R, 0, ctx, R.tables.map(L => excelToDisplayList(L, ctx, M)), boxes, { wall: null, logo: null }, M, "1 October 2026", { sem });
  return { dl, ctx, view };
}
const flat = (l: DisplayList): Node[] => l.flatMap(n => n.t === "group" ? [n, ...flat(n.children)] : [n]);
const r1 = (v: number) => Math.round(v * 10) / 10;
const summary = (l: Node[]): unknown[] => l.map(n => n.t === "text" ? ["text", n.src, r1(n.x), r1(n.y), n.size, n.weight, JSON.stringify(n.fill)]
  : n.t === "rect" ? ["rect", r1(n.x), r1(n.y), r1(n.w), r1(n.h), JSON.stringify(n.r ?? 0), JSON.stringify(n.fill ?? null)] : n.t === "line" ? ["line", r1(n.x1), r1(n.y1), r1(n.x2), r1(n.y2)]
  : n.t === "group" ? ["group", n.clip ? "clip" : "", summary(n.children)] : n.t === "hit" ? ["hit", n.kind, n.id] : [n.t]);

describe("KPI delta maths", () => {
  it("% = (cur − ref) / |ref|; a negative reference keeps the direction; absolute; both", () => {
    const p = kpiDelta(10, 9.900990099, "pct"); expect(p.ok && p.pct).toBeCloseTo(.01, 6);
    const n = kpiDelta(-10, -10.1010101, "pct"); expect(n.ok && n.pct).toBeCloseTo(.01, 6);   // −10 vs −10.1: up 1 %
    const w = kpiDelta(-10, -9.803921569, "pct"); expect(w.ok && w.pct).toBeCloseTo(-.02, 6);
    expect(kpiDelta(12, 10, "abs")).toEqual({ ok: true, pct: null, abs: 2, sign: 1 });
    expect(kpiDelta(8, -10, "both")).toEqual({ ok: true, pct: 1.8, abs: 18, sign: 1 });
  });
  it("a zero reference: no % (n/a), the absolute difference still", () => {
    expect(kpiDelta(5, 0, "pct").ok).toBe(false);
    expect(kpiDelta(5, 0, "both").ok).toBe(false);
    expect(kpiDelta(5, 0, "abs")).toEqual({ ok: true, pct: null, abs: 5, sign: 1 });
  });
  it("good direction: up = positive green, down = negative green, neutral grey; 0 is neutral", () => {
    expect([kpiTone(1, "up"), kpiTone(-1, "up"), kpiTone(1, "down"), kpiTone(-1, "down"), kpiTone(1, "neutral"), kpiTone(0, "up"), kpiTone(-1, undefined)])
      .toEqual(["good", "bad", "bad", "good", "neutral", "neutral", "bad"]);
  });
});

describe("KPI card data (image 16)", () => {
  it("texts, tones and the design's colours", async () => {
    const { ctx } = await build("glass", {});
    const D = kpiData(card(3, 0), ctx);
    expect(D.title).toBe("Deposits"); expect(D.value).toBe("−10"); expect(D.tone).toBe("bad");
    expect(D.rows).toEqual([{ text: "+1,0%", tone: "good", label: "vs Bdg" }, { text: "−2,0%", tone: "bad", label: "vs prev. Week" }, { text: "+3,0%", tone: "good", label: "vs EoM" }]);
    expect(D.issues).toEqual([]);
    const { dl } = await build("glass", { k: card(4, 100) }), T = targetLook(ctx, "#0B0D17");
    const texts = flat(dl.nodes.slice(...dl.items.k.at)).filter(n => n.t === "text") as Extract<Node, { t: "text" }>[];
    const fillOf = (s: string) => JSON.stringify(texts.find(t => t.src === s)!.fill);
    expect(fillOf("WM")).toBe(JSON.stringify({ solid: [255, 255, 255] }));
    expect(fillOf("10")).toContain(JSON.stringify(parseInt(T.pos.slice(1, 3), 16)));
    expect(fillOf("−2,0%")).toContain(JSON.stringify(parseInt(T.neg.slice(1, 3), 16)));
    expect(fillOf("vs Bdg")).toContain(JSON.stringify(parseInt(T.muted.slice(1, 3), 16)));
  });
  it("abs and both modes, the format override, good down", async () => {
    const { ctx } = await build("excel", {});
    const D = kpiData(card(2, 0, { rows: [{ src: { ref: ref("C2"), mode: "abs" }, num: "0.00", good: "down" }, { src: { ref: ref("D2"), mode: "both" }, label: "x" }, { src: { cell: ref("F2") }, num: "0%" }] }), ctx);
    expect(D.rows.map(r => [r.text, r.tone])).toEqual([["+0,10", "bad"], ["+0 (−2,0%)", "neutral"], ["+1%", "good"]]);
  });
  it("a zero reference shows n/a with an Issues line; a missing or text cell: n/a and an Issues line, never a throw", async () => {
    const { ctx } = await build("excel", {});
    const D = kpiData(card(6, 0, { rows: [{ src: { ref: ref("C6"), mode: "pct" }, label: "vs Bdg" }, { src: { ref: ref("D6"), mode: "pct" } }, { src: { cell: { sheet: "Gone", range: "A1" } } }, {} as never] }), ctx);
    expect(D.rows.map(r => r.text)).toEqual(["n/a", "n/a", "n/a", "n/a"]);
    expect(D.issues).toEqual(["row 1: the reference is 0 (KPI!C6): n/a", "row 2: no number in KPI!D6", "row 3: Gone!A1 not found", "row 4: no source"]);
    const E = kpiData({ kind: "kpi", head: "Typed", cur: ref("A3"), box: { x: 0, y: 0, w: 10, h: 10 } }, ctx);
    expect(E.value).toBe("–"); expect(E.issues).toEqual(["value: no number in KPI!A3"]);
    const { dl } = await build("excel", { z: card(6, 0) });
    expect(dl.items.z.issue).toContain("the reference is 0");
  });
  it("a reload / scenario (another sheet object) redraws it", async () => {
    const rows = ROWS.map(r => [...r]); rows[2][1] = 12;
    const { ctx } = await build("excel", {}, rows);
    expect(kpiData(card(3, 0), ctx)).toMatchObject({ value: "12", tone: "good" });
  });
});

describe("KPI cards drawn (all designs)", () => {
  for (const d of DESIGNS) it(`${d}: valid nodes, the item's hit, a header bar, the divider (snapshot)`, async () => {
    const items = Object.fromEntries([2, 3, 4, 5].map((r, i) => ["k" + r, card(r, 40 + i * 385)]));
    const { dl } = await build(d, items);
    expect(validate(dl.nodes)).toEqual([]);
    for (const id of Object.keys(items)) {
      const ns = dl.nodes.slice(...dl.items[id].at), all = flat(ns);
      expect(all.some(n => n.t === "hit" && n.kind === "item" && n.id === id)).toBe(true);
      expect(all.filter(n => n.t === "line")).toHaveLength(1);
      expect(dl.items[id].issue).toBeNull();
    }
    expect(summary(dl.nodes.slice(...dl.items.k3.at).filter(n => n.t !== "image"))).toMatchSnapshot();
  });
  it("the layout follows the box: a bigger box, bigger text", async () => {
    const { dl } = await build("clean", { s: card(2, 40), b: card(2, 500, { box: { x: 500, y: 300, w: 720, h: 220 } }) });
    const size = (id: string) => (flat(dl.nodes.slice(...dl.items[id].at)).find(n => n.t === "text" && n.src === "10") as { size: number }).size;
    expect(size("b")).toBeGreaterThan(size("s") * 1.8);
  });
});

describe("KPI ops", () => {
  it("kind kpi creates, its keys patch, the inverse restores; knownOp", async () => {
    const { view } = await build("excel", { k: card(2, 0) });
    const op = { op: "item.patch", slide: SLIDE, id: "k", patch: { rows: [], good: "down", num: "0.0", head: "X" } } as Op;
    expect(knownOp(op)).toBe(true);
    expect(knownOp({ op: "item.patch", slide: SLIDE, id: "n", patch: card(2, 0) })).toBe(true);
    const inv = inverseOf(view, op)!;
    const after = applyOps(view, [op]).doc, it = after.preset!.slides.find(s => s.id === SLIDE)!.items!.k as KpiItem;
    expect([it.rows, it.good, it.num, it.head]).toEqual([[], "down", "0.0", "X"]);
    const back = applyOps(after, [inv]).doc;
    expect(back.preset!.slides.find(s => s.id === SLIDE)!.items!.k).toEqual(card(2, 0));
  });
});

describe("KPI cards in PowerPoint: native shapes and text boxes, never a picture", () => {
  for (const d of ["glass", "mckinsey", "excel", "clean"] as Design[]) it(d + ": each text its own box where it is drawn; the header bar a shape of its height, rounded on top only", async () => {
    const { dl } = await build(d, { k: card(3, 40) }, ROWS, true);
    const sem: SlideSem = { type: "content", items: Object.fromEntries(Object.entries(dl.items).flatMap(([id, it]) => it.pptx ? [[id, it.pptx]] : [])), palette: [] };
    expect(sem.items.k).toMatchObject({ kind: "kpi" });
    const fl = (els: El[]): El[] => els.flatMap(e => e.k === "grp" ? [e, ...fl(e.children)] : [e]);
    const els = fl(sceneOf(dl.nodes, sem, () => true)), g = els.find(e => e.k === "grp" && e.name === "KPI card");
    expect(g).toBeTruthy();
    const inner = fl((g as Extract<El, { k: "grp" }>).children);
    const boxes = inner.flatMap(e => e.k === "sp" && e.text ? [{ t: e.text.paras.map(p => p.runs.map(r => r.text).join("")).join("\n"), box: e.box }] : []);
    // one box per text: the title, the value, three changes, three labels
    expect(boxes.map(b => b.t)).toEqual(["DEPOSITS", "−10", "+1,0%", "vs Bdg", "−2,0%", "vs prev. Week", "+3,0%", "vs EoM"]);
    const at = (t: string) => boxes.find(b => b.t === t)!.box;
    expect(at("DEPOSITS").y).toBeLessThan(120 + 34);
    expect(at("−10").x + at("−10").w).toBeLessThan(at("+1,0%").x + 1);                  // the value left of the changes
    expect(at("+1,0%").x + at("+1,0%").w).toBeLessThan(at("vs Bdg").x + 1);               // the change left of its label
    expect(at("+1,0%").y).toBeLessThan(at("−2,0%").y);                                     // rows one under the other
    expect(at("−2,0%").y).toBeLessThan(at("+3,0%").y);
    expect(Math.abs(at("+1,0%").y - at("vs Bdg").y)).toBeLessThan(2);
    const bar = inner.find(e => e.k === "sp" && !e.text && e.box.y === 120 && Math.abs(e.box.w - 360) < .5 && e.box.h < 50) as Extract<El, { k: "sp" }>;
    expect(bar).toBeTruthy();
    expect(bar.box.h).toBeCloseTo(Math.max(16, Math.min(56, 110 * .26)), 1);
    if (d === "glass" || d === "clean") { expect("path" in bar.geom).toBe(true); }                      // top corners only: a custom outline
    expect(inner.some(e => e.k === "pic" && !(e.name || "").startsWith("Glass"))).toBe(false);
    const bytes = writePptx({ slides: [{ nodes: dl.nodes, sem }], image: () => new Uint8Array(0), face: css => pptxFamily(css) });
    const slide = strFromU8(unzipSync(bytes)["ppt/slides/slide1.xml"]);
    expect(slide).toContain("DEPOSITS"); expect(slide).toContain("vs Bdg"); expect(slide).not.toContain("a:cxnSp");
  });
});

describe("B54 review fixes", () => {
  it("the header bar is one rect of the bar's height, its top corners rounded, no clip", async () => {
    const { dl } = await build("glass", { k: card(2, 40) });
    const all = flat(dl.nodes.slice(...dl.items.k.at));
    const bar = all.find(n => n.t === "rect" && Array.isArray(n.r)) as Extract<Node, { t: "rect" }>;
    expect(bar.h).toBeCloseTo(28.6, 1); expect((bar.r as number[]).slice(2)).toEqual([0, 0]); expect((bar.r as number[])[0]).toBeGreaterThan(0);
  });
  it("a long value shrinks to fit (no ellipsis); below the minimum it is cut and says so", async () => {
    const rows = ROWS.map(r => [...r]); rows[1][1] = 12000;
    const { dl } = await build("excel", { k: card(2, 40) }, rows);
    const v = flat(dl.nodes.slice(...dl.items.k.at)).find(n => n.t === "text" && /^12/.test(n.src)) as Extract<Node, { t: "text" }>;
    expect(v.src).toBe("12.000"); expect(dl.items.k.issue).toBeNull();
    const { dl: tiny } = await build("excel", { k: card(2, 40, { box: { x: 40, y: 120, w: 90, h: 60 } }) }, rows);
    expect(tiny.items.k.issue).toMatch(/cut to fit the card/);
    expect(fitText(M, "12.000", { family: "Arial", size: 40, weight: 700, italic: false, color: "#000000" }, 100, 10)).toMatchObject({ text: "12.000", cut: false, st: { size: 33 } });
    expect(fitText(M, "12.000.000", { family: "Arial", size: 40, weight: 700, italic: false, color: "#000000" }, 30, 10)).toMatchObject({ cut: true, st: { size: 10 } });
  });
  it("the change column shrinks to fit too; rows that do not fit a tiny card are not drawn (an Issues line); nothing outside the card", async () => {
    const { dl } = await build("clean", { k: card(2, 40, { rows: [{ src: { ref: ref("C2"), mode: "both" }, label: "vs Bdg" }] }) });
    const t = flat(dl.nodes.slice(...dl.items.k.at)).find(n => n.t === "text" && n.src.endsWith("(+1,0%)")) as Extract<Node, { t: "text" }>;
    expect(t.src).toBe("+0 (+1,0%)"); expect(dl.items.k.issue).toBeNull();
    const { dl: tiny } = await build("clean", { k: card(2, 40, { box: { x: 40, y: 120, w: 160, h: 40 } }) });
    expect(tiny.items.k.issue).toMatch(/too small for its rows/);
    for (const n of flat(tiny.nodes.slice(...tiny.items.k.at))) if (n.t === "text") { expect(n.y).toBeLessThanOrEqual(160); expect(n.x).toBeGreaterThanOrEqual(40); expect(n.x + n.w!).toBeLessThanOrEqual(200.5); }
  });
  it("one rule with the chart card (render/deltas.ts): \"abs (%)\", the sign of what is shown; a format with its own sign never doubled", async () => {
    const { ctx } = await build("excel", {});
    const D = kpiData(card(2, 0, { rows: [{ src: { cell: ref("F2") }, num: "+0.0%;-0.0%" }, { src: { cell: ref("G2") }, num: "+0.0%;-0.0%" }, { src: { ref: ref("C2"), mode: "both" }, num: "0.00" }] }), ctx);
    expect(D.rows.map(r => r.text)).toEqual(["+1,0%", "−2,0%", "+0,10 (+1,0%)"]);
    expect(signedShown(.01, "+0.0%;-0.0%").text).toBe("+1,0%");
  });
  it("a near-zero change takes its sign and colour from the number as shown", () => {
    expect(signedShown(-.00001, "0.0%")).toEqual({ text: "+0,0%", sign: 0 });            // (the owner's "+0 (+0.0%)", grey: never −0)
    expect(signedShown(-.0004, "0.00%")).toEqual({ text: "−0,04%", sign: -1 });
  });
  it("a malformed num never breaks the render; the fold drops malformed rows and formats", async () => {
    const { dl } = await build("excel", { k: { ...card(2, 40), num: 5 as never, rows: [{ src: { cell: ref("F2") }, num: 7 as never }] } });
    expect(validate(dl.nodes)).toEqual([]);
    const it = { kind: "kpi", num: 5, good: "sideways", rows: [null, 3, { src: null }, { src: { cell: ref("F2") }, num: 7, good: "x", label: 4 }, { src: { ref: ref("C2"), mode: "odd" } }, { src: { cell: { sheet: 5 } } }] } as Record<string, unknown>;
    kpiClean(it);
    expect(it).toEqual({ kind: "kpi", rows: [{ src: { cell: ref("F2") } }, { src: { ref: ref("C2"), mode: "pct" } }] });
    const { view } = await build("excel", { k: { ...card(2, 40), num: 5 as never, rows: "x" as never } });
    expect(view.preset!.slides.find(s => s.id === SLIDE)!.items!.k).not.toHaveProperty("rows");
  });
  it("presetSheets / itemSheets name the sheets only a card reads (loaded on a reload, a scenario, Run for each value)", async () => {
    const { view } = await build("excel", { k: card(2, 40, { head: { sheet: "Titles", range: "A1" }, rows: [{ src: { cell: { sheet: "Deltas", range: "B2" } } }, { src: { ref: { sheet: "Refs", range: "C2" }, mode: "pct" } }] }) });
    expect(itemSheets(view.preset)).toEqual(expect.arrayContaining(["Titles", "KPI", "Deltas", "Refs"]));
    expect(presetSheets(view.preset!)).toEqual(expect.arrayContaining(["Titles", "KPI", "Deltas", "Refs"]));
  });
});
