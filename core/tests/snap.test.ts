/* S15.4 · Snapping (09 §5, F8; SN-01…SN-03 core part): the targets (the slide's edges, centre lines and margins, the
   other objects' edges and centres, the tables' cell borders, the lines' ends and middles), the per-frame answers (the
   nearest target within 8 screen px, equal gaps, equal sizes, a line's end), the marks the stage draws, and the 1/4 px
   rounding that makes the dropped number the saved one and the exported one – the display list and PowerPoint's EMU
   (1/4 px = 1,905 EMU) show the same value. PPTX_OUT=dir writes snap-quarter-px.pptx there (python3 tools/pptxcheck.py
   check …). The stage's drags themselves: app/tests/snap.test.tsx. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { computeLayout, snapRound } from "../src/render/layout";
import { guidesOf, resizeMarks, snapAxis, snapEdge, snapMove, snapPoint, snapSize, snapSpacing, snapTargets, snapTol, SNAP_PX } from "../src/render/snap";
import { E, EMU } from "../src/pptx/drawingml";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, emptyDoc } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { slideToDisplayList } from "../src/render/slide-dl";
import { writePptx } from "../src/pptx/writer";
import { pptxFamily } from "../src/text/resolve";
import { wrapLines } from "../src/text/lines";
import type { SlideSem } from "../src/pptx/scene";
import type { RenderCtx } from "../src/render/context";
import type { Design, Op } from "../src/model/types";
import type { Node } from "../src/dl/types";

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe("snapRound: positions on 1/4 px (09 §2.6)", () => {
  it("rounds to the nearest quarter, exact in binary and in EMU (1/4 px = 1,905 EMU)", () => {
    expect([snapRound(10.13), snapRound(10.12), snapRound(-3.3), snapRound(799.875), snapRound(0)]).toEqual([10.25, 10, -3.25, 800, 0]);
    expect(EMU / 4).toBe(1905);
    for (let k = 0; k < 2000; k++) {
      const v = snapRound(Math.random() * 1600);
      expect(v * 4).toBe(Math.round(v * 4));                                   // exact
      expect(E(v) % 1905).toBe(0);                                             // a whole number of quarter pixels in EMU
      expect(E(v)).toBe(v * EMU);                                              // no rounding in the PowerPoint writer
      expect(JSON.parse(JSON.stringify(v))).toBe(v);                           // the saved JSON reads back the same number
    }
  });
});

describe("targets (SN-01: slide edges / centre / margins, others' edges and centres, cells, lines)", () => {
  const T = snapTargets({ boxes: [box(100, 200, 300, 100), null, box(NaN, 0, 1, 1)], cells: [{ x: [130, 160], y: [230] }], points: [{ x: 1000, y: 700 }], top: 128 });
  it("two arrays sorted by position, each with its kind; bad boxes left out", () => {
    for (const list of [T.x, T.y]) expect(list.map(t => t.v)).toEqual(list.map(t => t.v).slice().sort((a, b) => a - b));
    const xs = (k: string) => T.x.filter(t => t.kind === k).map(t => t.v), ys = (k: string) => T.y.filter(t => t.kind === k).map(t => t.v);
    expect(xs("slide")).toEqual([0, 1600]); expect(xs("centre")).toEqual([800]); expect(xs("margin")).toEqual([50, 1550]);
    expect(ys("slide")).toEqual([0, 900]); expect(ys("centre")).toEqual([450]); expect(ys("margin")).toEqual([128, 822]);
    expect(xs("edge")).toEqual([100, 400]); expect(xs("middle")).toEqual([250]);
    expect(ys("edge")).toEqual([200, 300]); expect(ys("middle")).toEqual([250]);
    expect(xs("cell")).toEqual([130, 160]); expect(ys("cell")).toEqual([230]);
    expect(xs("line")).toEqual([1000]); expect(ys("line")).toEqual([700]);
    expect(T.boxes).toHaveLength(1);
  });
  it("8 px on screen: 8 / scale slide px (zoomed in snaps finer)", () => {
    expect(SNAP_PX).toBe(8);
    expect(snapTol(1)).toBe(8); expect(snapTol(2)).toBe(4); expect(snapTol(.5)).toBe(16); expect(snapTol(0)).toBe(8);
  });
  it("the nearest target of any moving edge within the distance, or none", () => {
    expect(snapAxis(T.x, [96], 8)).toEqual({ d: 4, line: 100, edge: 0 });
    expect(snapAxis(T.x, [90, 252], 8)).toEqual({ d: -2, line: 250, edge: 1 });
    expect(snapAxis(T.x, [500], 8)).toBeNull();
    expect(snapAxis(T.x, [125], 4)).toBeNull();
    expect(snapAxis(T.x, [127], 4)).toEqual({ d: 3, line: 130, edge: 0 });     // a cell border
  });
});

describe("a moved box (SN-01, SN-02)", () => {
  it("its left / centre / right edge to the nearest target; every matched line a guide, centre matches dashed", () => {
    const T = snapTargets({ boxes: [box(100, 100, 200, 100)] });
    // left edge 3 px right of the other's left, top 5 px below its bottom → x 100, y 200
    const a = snapMove(T, box(103, 205, 200, 50), 8);
    expect(a.box).toEqual(box(100, 200, 200, 50));
    // the same width: left and right both line up, its centre too – three vertical guides; the top: one horizontal
    expect(a.marks.guides.filter(g => g.axis === "v").map(g => [g.at, g.centre])).toEqual([[100, false], [200, true], [300, false]]);
    expect(a.marks.guides.filter(g => g.axis === "h").map(g => g.at)).toEqual([200]);
    // the slide's centre: the box's centre on 800 (dashed)
    const c = snapMove(T, box(745, 600, 100, 40), 8);
    expect(c.box.x).toBe(750);
    expect(c.marks.guides).toContainEqual({ axis: "v", at: 800, centre: true });
    // nothing within reach: unchanged, no marks
    const n = snapMove(T, box(500, 520, 60, 60), 8);
    expect(n.box).toEqual(box(500, 520, 60, 60)); expect(n.marks.guides).toEqual([]); expect(n.marks.gaps).toEqual([]);
  });
  it("a snap that would take it off the slide is not taken; positions on 1/4 px", () => {
    const T = snapTargets({ boxes: [box(1003, 0, 10, 10)] });
    expect(snapMove(T, box(700, 300, 298, 50), 8).box.x).toBe(705);            // right edge 998 → 1003
    expect(snapMove(T, box(700, 300, 298, 50), 8, box(0, 0, 1000, 900)).box.x).toBe(700);   // not inside 0–1000: not taken
    expect(snapMove(T, box(1480, 300, 118, 50), 8).box.x).toBe(1482);          // right edge 1598 → 1600, the slide's edge
    expect(snapMove(snapTargets({}), box(1201.3, 300, 98.7, 50), 1).box.x).toBe(1201.25);  // nothing to snap: on 1/4 px all the same
    expect(snapMove(snapTargets({ boxes: [box(333.33, 0, 10, 10)] }), box(330, 400, 50, 50), 8).box.x).toBe(333.25);
  });
  it("equal spacing: between two neighbours, beyond a pair, before a pair – the gaps marked with their size", () => {
    const A = box(100, 300, 100, 80), B = box(300, 310, 100, 80), C = box(700, 290, 100, 80);
    const T = snapTargets({ boxes: [A, C] });
    // between A (ends 200) and C (starts 700), 100 wide: gaps 200 each at x 400
    const s = snapSpacing(T, box(405, 600 - 300, 100, 80), 8, true)!;
    expect(s.d).toBe(-5);
    expect(s.gaps.map(g => [g.from, g.to, g.px])).toEqual([[200, 400], [500, 700]].map(([a, b]) => [a, b, b - a]));
    // beyond the pair A, B (gap 100): x 500
    const T2 = snapTargets({ boxes: [A, B] });
    const m = snapMove(T2, box(497, 320, 80, 60), 8);
    expect(m.box.x).toBe(500);
    expect(m.marks.gaps.map(g => [g.axis, g.from, g.to, g.px])).toEqual([["x", 200, 300, 100], ["x", 400, 500, 100]]);
    // before the pair B, C on its left side (gap 300): x = 300 − 300 − 50 = −50 → not on the slide; a nearer pair instead
    const T3 = snapTargets({ boxes: [box(400, 300, 100, 80), box(600, 300, 100, 80)] });
    const p = snapMove(T3, box(206, 310, 90, 60), 8);
    expect(p.box.x).toBe(210);                                                 // 210 + 90 = 300; gap 100 = the pair's
    expect(p.marks.gaps.map(g => g.px)).toEqual([100, 100]);
    // vertical: a column
    const T4 = snapTargets({ boxes: [box(500, 100, 100, 50), box(510, 250, 100, 50)] });
    const v = snapMove(T4, box(520, 396, 90, 40), 8);
    expect(v.box.y).toBe(400);
    expect(v.marks.gaps.map(g => [g.axis, g.px])).toEqual([["y", 100], ["y", 100]]);
    // a box not on the row (no vertical overlap) does not count
    expect(snapSpacing(T2, box(497, 600, 80, 60), 8, true)).toBeNull();
  });
  it("the guide of a centre match is dashed, of an edge match solid; guidesOf only for the lines asked", () => {
    const T = snapTargets({ boxes: [box(100, 100, 100, 100)] });
    expect(guidesOf(T, box(150, 400, 100, 10), { x: ["l"] })).toEqual([{ axis: "v", at: 150, centre: true }]);
    expect(guidesOf(T, box(200, 400, 100, 10), { x: ["l", "r"] })).toEqual([{ axis: "v", at: 200, centre: false }]);
    expect(guidesOf(T, box(0, 100, 10, 10), { y: ["t"] })).toEqual([{ axis: "h", at: 100, centre: false }]);
  });
});

describe("a resize (SN-02: equal size) and a line's end (09 §5.3)", () => {
  it("a moving edge snaps to a target or to another object's width / height, whichever is nearer; both sizes marked", () => {
    const T = snapTargets({ boxes: [box(900, 100, 150, 80)] });
    // right edge of a box at x 300: width 147 → 150 (equal width; no target near 447)
    expect(snapEdge(T, true, 300 + 147, 8, { now: 147, sign: 1 })).toBe(3);
    // the left edge moving (size grows as it moves left): width 154 → 150, the edge 4 px right
    expect(snapEdge(T, true, 450 - 154, 8, { now: 154, sign: -1 })).toBe(4);
    // a target nearer than the size: x 1050 (the other box's right edge)
    expect(snapEdge(T, true, 1048, 8, { now: 200, sign: 1 })).toBe(2);
    expect(snapEdge(T, true, 1200, 8)).toBe(0);
    expect(snapSize(T.ws, 152, 4)).toEqual({ d: -2, px: 150 });
    const m = resizeMarks(T, box(300, 400, 150, 60), { x: ["r"] }, { w: true });
    expect(m.sizes.map(z => [z.axis, z.box.x, z.px])).toEqual([["w", 900, 150], ["w", 300, 150]]);
  });
  it("an end: x and y each to the nearest target (a cell border, another line's end, the slide's centre)", () => {
    const T = snapTargets({ cells: [{ x: [612], y: [] }], points: [{ x: 0, y: 305 }] });
    const s = snapPoint(T, { x: 609, y: 302 }, 8);
    expect(s.p).toEqual({ x: 612, y: 305 });
    expect(s.marks.guides.map(g => [g.axis, g.at])).toEqual([["v", 612], ["h", 305]]);
    expect(snapPoint(T, { x: 805, y: 446 }, 8).p).toEqual({ x: 800, y: 450 });
    expect(snapPoint(T, { x: 700, y: 600 }, 8).marks.guides).toEqual([]);
  });
});

/* SN-03 core part: what a drag drops (1/4 px) is drawn and exported at exactly that number – the display list and the
   PowerPoint file (EMU) – in automatic and free layout */
const here = path.dirname(fileURLToPath(import.meta.url));
const DECKS = path.join(here, "../../tests/corpus/decks"), BOOKS = path.join(here, "../../tests/corpus/workbooks");
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
describe("dropped = saved = exported (SN-03, the core's part)", () => {
  it("a shape at 1/4 px: its box in the display list and its a:off / a:ext in PowerPoint are the same numbers (EMU exact), automatic and free layout", async () => {
    const SLIDE = "u9t3fqb", d = JSON.parse(fs.readFileSync(path.join(DECKS, "report.json"), "utf8")) as { workbook: string; ops: Op[] };
    const b = fs.readFileSync(path.join(BOOKS, d.workbook)), wb = await readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    const at = { x: 100.25, y: 200.5, w: 300.75, h: 120.25 }, freeAt = { x: 412.75, y: 610.25, w: 250.5, h: 90.75 };
    let checked = 0;
    const all: { nodes: Node[]; sem: SlideSem }[] = [];
    for (const free of [false, true]) for (const design of ["excel", "glass"] as Design[]) {
      const ops: Op[] = [...d.ops, { op: "item.patch", slide: SLIDE, id: "sq", patch: { kind: "shape", shape: "rect", box: at } } as Op,
        ...(free ? [{ op: "slide.patch", id: SLIDE, patch: { free: { [design]: { on: true, items: { "i:sq": freeAt } } } } } as Op] : [])];
      const view = applyOps(emptyDoc("W.xlsx"), ops).doc, style = resolveStyle({}, { ...view.style, design });
      const ctx: RenderCtx = { style, edits: {}, slides: runtimeSlides(wb, view.preset, "W.xlsx", design), preset: view.preset || null, workbook: "W.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null, forExport: true };
      const R = ctx.slides[0], boxes = computeLayout(R, ctx).boxes;
      const dl = slideToDisplayList(R, 0, ctx, R.tables.map(L => excelToDisplayList(L, ctx, M)), boxes, { wall: null, logo: null }, M, "1 October 2026", { sem: true });
      const want = free ? freeAt : at;
      expect(dl.items.sq.box, `${design} free=${free}`).toEqual(want);
      const sem: SlideSem = { type: "content", items: Object.fromEntries(Object.entries(dl.items).flatMap(([id, it]) => it.pptx ? [[id, it.pptx]] : [])), palette: [] };
      all.push({ nodes: dl.nodes, sem });
      const zip = unzipSync(writePptx({ slides: [{ nodes: dl.nodes, sem }], image: () => new Uint8Array(0), face: css => pptxFamily(css), title: "Snap", design: "Excel" }));
      const xml = strFromU8(zip["ppt/slides/slide1.xml"]);
      // the shape as drawn: its rect (inset by half its outline, as every design draws a stroked box) – the same numbers in
      // the display list and in PowerPoint, exact in EMU
      const r = dl.nodes.slice(dl.items.sq.at[0], dl.items.sq.at[1]).find(n => n.t === "rect") as Extract<Node, { t: "rect" }> | undefined;
      // (Liquid Glass draws the box as its glass card: in PowerPoint a group at exactly the box)
      if (!r) { const off = `<a:off x="${want.x * EMU}" y="${want.y * EMU}"/><a:ext cx="${want.w * EMU}" cy="${want.h * EMU}"/>`; expect(xml.includes(off), `${design} free=${free}: ${off}`).toBe(true); continue; }
      checked++;
      const sw = r.stroke ? r.stroke.w : 0;
      expect([r.x - sw / 2, r.y - sw / 2, r.w + sw, r.h + sw], `${design} free=${free}`).toEqual([want.x, want.y, want.w, want.h]);
      const off = `<a:off x="${r.x * EMU}" y="${r.y * EMU}"/><a:ext cx="${r.w * EMU}" cy="${r.h * EMU}"/>`;
      expect(xml.includes(off), `${design} free=${free}: ${off}`).toBe(true);
      for (const v of [r.x, r.y, r.w, r.h]) expect(E(v)).toBe(v * EMU);
      for (const v of [want.x, want.y, want.w, want.h]) expect((v * EMU) % 1905).toBe(0);
    }
    expect(checked).toBe(2);
    // PPTX_OUT=dir: the four slides in one file for tools/pptxcheck.py (its expected real objects beside it)
    if (process.env.PPTX_OUT) {
      const f = path.join(process.env.PPTX_OUT, "snap-quarter-px.pptx");
      fs.writeFileSync(f, writePptx({ slides: all, image: () => new Uint8Array(0), face: css => pptxFamily(css), title: "Snap", design: "Excel" }));
      fs.writeFileSync(path.join(process.env.PPTX_OUT, "snap-quarter-px.expect.json"), JSON.stringify({ [f]: all.map((_, k) => ({ slide: k + 1, tables: 1, charts: 0, lines: 0, quarter: ["Callout"] })) }));
    }                                                  // Excel's rect, automatic and free
  });
});
