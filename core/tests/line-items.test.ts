/* S15.3 · Line items (LN-01, LN-02 core part; 09 §2.3, §3.4, §4.3): straight, elbow, curved, bracket and range lines,
   drawn with display-list nodes only in every design; heads (render/heads.ts), dashes, caps and joins; the label on the
   slide's ground; ends attached to a table, a text box or an item follow it – in automatic and free layout, per design –
   and an end whose object is gone stays at its saved point with the Issues line; the PowerPoint export writes each as a
   plain shape (a:prstGeom "line" with flips, or an open a:custGeom) with native a:headEnd / a:tailEnd, never a connector,
   at its resolved place. PPTX_OUT=dir writes lines-5-designs.pptx there (python3 tools/pptxcheck.py check …). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { NODE_TYPES, validate, type LineNode, type Node, type PathNode } from "../src/dl/types";
import { toSvg } from "../src/dl/svg";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, emptyDoc } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { slideToDisplayList } from "../src/render/slide-dl";
import { computeLayout, freeBoxes } from "../src/render/layout";
import { anchorPoint, anchorTargets, lineBox, lineEnds, routeDistance, routeOf } from "../src/render/line-dl";
import { headLength } from "../src/render/heads";
import { DESIGNS } from "../src/model/designs";
import { wrapLines } from "../src/text/lines";
import { sceneOf, type El, type ShapeEl, type SlideSem } from "../src/pptx/scene";
import { writePptx } from "../src/pptx/writer";
import { pptxFamily } from "../src/text/resolve";
import type { RenderCtx } from "../src/render/context";
import type { Design, LineItem, Op } from "../src/model/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const DECKS = path.join(here, "../../tests/corpus/decks"), BOOKS = path.join(here, "../../tests/corpus/workbooks");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const SLIDE = "u9t3fqb", TABLE = "dhnms9c";
const DECK = JSON.parse(fs.readFileSync(path.join(DECKS, "report.json"), "utf8")) as { workbook: string; ops: Op[] };
const WB = readWorkbook(ab(path.join(BOOKS, DECK.workbook)));
async function build(design: Design, items: Record<string, object>, more: Op[] = [], look: object = {}) {
  const wb = await WB;
  const ops = [...DECK.ops, ...Object.entries(items).map(([id, patch]) => ({ op: "item.patch", slide: SLIDE, id, patch }) as Op), ...more];
  const { doc: view, skipped } = applyOps(emptyDoc("W.xlsx"), ops);
  expect(skipped).toEqual([]);
  const style = resolveStyle({}, { ...view.style, design }, look);
  const slides = runtimeSlides(wb, view.preset, "W.xlsx", design);
  const ctx: RenderCtx = { style, edits: view.edits || {}, slides, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null, forExport: true };
  const R = ctx.slides[0], boxes = computeLayout(R, ctx).boxes;
  const dl = slideToDisplayList(R, 0, ctx, R.tables.map(L => excelToDisplayList(L, ctx, M)), boxes, { wall: null, logo: null }, M, "1 October 2026", { sem: true });
  const sem: SlideSem = { type: "content", items: Object.fromEntries(Object.entries(dl.items).flatMap(([id, it]) => it.pptx ? [[id, it.pptx]] : [])), palette: [] };
  return { dl, sem, R, ctx, boxes };
}
const line = (route: LineItem["route"], a: { x: number; y: number }, b: { x: number; y: number }, extra: Partial<LineItem> = {}): LineItem => ({ kind: "line", route, a, b, box: lineBox(a, b), ...extra });
const nodesOf = (dl: Awaited<ReturnType<typeof build>>["dl"], id: string) => dl.nodes.slice(dl.items[id].at[0], dl.items[id].at[1]);
const drawn = (ns: Node[]) => ns.filter(n => n.t !== "hit");
const flat = (els: El[]): El[] => els.flatMap(e => e.k === "grp" ? [e, ...flat(e.children)] : [e]);
const pptx = (slides: { dl: { nodes: Node[] }; sem: SlideSem }[]) => writePptx({ slides: slides.map(s => ({ nodes: s.dl.nodes, sem: s.sem })), image: () => new Uint8Array(0), face: css => pptxFamily(css), title: "Lines", design: "Excel" });
const ALL = {
  s: line("straight", { x: 100, y: 820 }, { x: 600, y: 820 }, { style: { heads: { b: "triangle" } } }),
  e: line("elbow", { x: 1000, y: 200 }, { x: 1400, y: 400 }, { mid: .25, style: { color: "#C42B1C", w: 3, heads: { b: "arrow", size: "l" } } }),
  c: line("curve", { x: 1000, y: 600 }, { x: 1400, y: 600 }, { mid: 60, style: { dash: "dashed", heads: { a: "oval", b: "stealth" } } }),
  k: line("bracket", { x: 1500, y: 150 }, { x: 1500, y: 450 }, { mid: 20 }),
  r: line("range", { x: 700, y: 760 }, { x: 1100, y: 760 }, { text: "+12 %" }),
};

describe("line items on the slide (LN-01: display-list nodes only, every design)", () => {
  it("every route in every design: valid nodes of the eight types, a hit band along it, the bounds round what is drawn", async () => {
    for (const design of DESIGNS) {
      const { dl } = await build(design, ALL);
      expect(validate(dl.nodes), design).toEqual([]);
      for (const id of Object.keys(ALL)) {
        const ns = nodesOf(dl, id), info = dl.items[id];
        expect(ns.every(n => (NODE_TYPES as readonly string[]).includes(n.t)), `${design} ${id}`).toBe(true);
        expect(ns.some(n => n.t === "hit" && n.kind === "line" && n.id === id), `${design} ${id}`).toBe(true);
        expect(info.issue, `${design} ${id}`).toBeNull();
        // the stage's layer box holds every drawn node's points
        for (const n of drawn(ns)) {
          const pts = n.t === "line" ? [[n.x1, n.y1], [n.x2, n.y2]] : n.t === "path" ? n.d.flatMap(c => c[0] === "Z" ? [] : c[0] === "C" ? [[c[5], c[6]]] : [[c[1], c[2]]]) : n.t === "rect" ? [[n.x, n.y], [n.x + n.w, n.y + n.h]] : [];
          for (const [x, y] of pts) expect(x >= info.box.x && x <= info.box.x + info.box.w && y >= info.box.y && y <= info.box.y + info.box.h, `${design} ${id} ${x},${y}`).toBe(true);
        }
      }
      expect(toSvg(dl.nodes, { imageHref: () => "" })).toContain("<path");
    }
  });
  it("routes: a straight line is one line node; an elbow three segments bent at mid (hv / vh); a curve one cubic; a bracket three segments at its depth", async () => {
    const { dl } = await build("excel", { ...ALL, v: line("elbow", { x: 100, y: 100 }, { x: 300, y: 300 }, { bend: "vh" }) });
    expect(drawn(nodesOf(dl, "s")).filter(n => n.t === "line")).toHaveLength(1);
    const e = drawn(nodesOf(dl, "e"))[0] as PathNode;
    expect(e.d.map(c => c[0])).toEqual(["M", "L", "L", "L"]);
    expect(e.d[1]).toEqual(["L", 1100, 200]);                  // a quarter of the way across, horizontal first
    const v = drawn(nodesOf(dl, "v"))[0] as PathNode;
    expect(v.d.slice(0, 3)).toEqual([["M", 100, 100], ["L", 100, 200], ["L", 300, 200]]);
    const c = drawn(nodesOf(dl, "c"))[0] as PathNode;
    expect(c.d.map(x => x[0])).toEqual(["M", "C"]);
    expect(routeOf(ALL.c, ALL.c.a, ALL.c.b).mid).toEqual({ x: 1200, y: 660 });   // the bulge: 60 px off the chord's middle
    const k = drawn(nodesOf(dl, "k"))[0] as PathNode;
    expect(k.d).toEqual([["M", 1500, 150], ["L", 1480, 150], ["L", 1480, 450], ["L", 1500, 450]]);
  });
  it("heads: a filled head shortens the stroke so the tip is exact; an open arrow is a round-joined stroke; a range marker has bar ticks", async () => {
    const { dl } = await build("excel", ALL);
    const s = drawn(nodesOf(dl, "s"));
    expect(s[0]).toMatchObject({ t: "line", x1: 100, y1: 820, x2: 600 - headLength(2), y2: 820 });
    expect(s[1]).toMatchObject({ t: "path", fill: { solid: [64, 64, 64] } });
    expect((s[1] as PathNode).d[0]).toEqual(["M", 600, 820]);                // the tip on end b
    const e = drawn(nodesOf(dl, "e"));
    expect(e[1]).toMatchObject({ t: "path", stroke: { w: 3, cap: "round", join: "round" } });
    expect((e[0] as PathNode).d.at(-1)).toEqual(["L", 1400, 400]);             // an open head does not shorten
    const r = drawn(nodesOf(dl, "r"));
    const ticks = r.filter((n): n is PathNode => n.t === "path" && !!n.stroke);
    expect(ticks).toHaveLength(2);
    expect(ticks.map(t => t.d.map(c => c[1]))).toEqual([[700, 700], [1100, 1100]]);   // perpendicular at each end
  });
  it("style: weight 0.5–8, dashes scaled by it, caps butt with heads or dashes and round on a plain line, joins set", async () => {
    const { dl } = await build("excel", { ...ALL, p: line("straight", { x: 100, y: 300 }, { x: 400, y: 300 }, { style: { w: 20 } }), d: line("straight", { x: 100, y: 350 }, { x: 400, y: 350 }, { style: { w: 2, dash: "dotted" } }) });
    expect((drawn(nodesOf(dl, "p"))[0] as LineNode).stroke).toEqual({ w: 8, paint: { solid: [64, 64, 64] }, cap: "round", join: "miter" });
    expect((drawn(nodesOf(dl, "d"))[0] as LineNode).stroke).toMatchObject({ w: 2, dash: [2, 4], cap: "butt" });
    expect((drawn(nodesOf(dl, "c"))[0] as PathNode).stroke).toMatchObject({ w: 2, dash: [8, 6], cap: "butt", join: "round" });
    expect((drawn(nodesOf(dl, "e"))[0] as PathNode).stroke).toMatchObject({ w: 3, paint: { solid: [196, 43, 28] }, cap: "butt", join: "miter" });
  });
  it("colours per design: unset → the design's ink; a divider (straight, dashed, no heads) → its rule colour; never glass on a line", async () => {
    const want: Record<Design, [string, string]> = { glass: ["0B0D17", "9AA1AE"], excel: ["404040", "BFBFBF"], clean: ["404040", "BFBFBF"], mckinsey: ["051C2C", "D6DEE6"], bain: ["4D4D4D", ""] };
    for (const design of DESIGNS) {
      const { dl } = await build(design, { p: line("straight", { x: 100, y: 300 }, { x: 400, y: 300 }), d: line("straight", { x: 100, y: 850 }, { x: 1500, y: 850 }, { style: { w: 1, dash: "dashed" } }) });
      const hex = (n: Node) => ((n as LineNode).stroke.paint as { solid: number[] }).solid.map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase();
      expect(hex(drawn(nodesOf(dl, "p"))[0]), design).toBe(want[design][0]);
      if (want[design][1]) expect(hex(drawn(nodesOf(dl, "d"))[0]), design).toBe(want[design][1]);
      expect(nodesOf(dl, "p").some(n => n.t === "image" || n.t === "shadow"), design).toBe(false);
    }
  });
  it("the label: on a rect of the slide's ground at the middle (a range's above the line), its hit carries the text, cells quoted", async () => {
    const { dl } = await build("excel", { ...ALL, q: line("straight", { x: 100, y: 500 }, { x: 500, y: 500 }, { text: "{Nope!A1} vs plan", fmt: { b: true, color: "#1E8E3E" } }) });
    const r = drawn(nodesOf(dl, "r")), bg = r.find(n => n.t === "rect")!, tx = r.find(n => n.t === "text")!;
    expect(bg).toMatchObject({ fill: { solid: [255, 255, 255] } });
    if (bg.t !== "rect" || tx.t !== "text") throw new Error("no label");
    expect(bg.y + bg.h).toBeLessThan(760);                                       // above the range line
    expect(tx.src).toBe("+12 %");
    expect(nodesOf(dl, "r").some(n => n.t === "hit" && n.kind === "item" && n.label === "+12 %")).toBe(true);
    const q = drawn(nodesOf(dl, "q")), qt = q.find(n => n.t === "text")!;
    expect(qt).toMatchObject({ src: "#REF vs plan", weight: 700, fill: { solid: [30, 142, 62] } });
    expect(dl.items.q.issue).toBe("the cell Nope!A1 cannot be read (shown as #REF)");
    const qb = q.find(n => n.t === "rect")!;
    if (qb.t === "rect") expect(qb.y < 500 && qb.y + qb.h > 500).toBe(true);    // across the line
  });
  it("routeDistance: the stage's hit test along a route", () => {
    const R = routeOf(ALL.e, ALL.e.a, ALL.e.b);
    expect(routeDistance(R.d, { x: 1100, y: 300 })).toBe(0);
    expect(routeDistance(R.d, { x: 1105, y: 300 })).toBe(5);
  });
});

describe("attached ends (LN-02 core part: they follow their object in automatic and free layout, per design)", () => {
  const icon = { kind: "shape", shape: "icon", icon: "target", box: { x: 700, y: 300, w: 64, h: 64 } };
  const att = line("elbow", { x: 0, y: 0 }, { x: 10, y: 10 }, { ends: { a: { to: "i:k1", at: "r" }, b: { to: "t:" + TABLE, at: "l", dy: 12 } } });
  it("an end attached to an item and to a table is drawn at their points; moving the item moves the end", async () => {
    const { dl, R, ctx, boxes } = await build("excel", { k1: icon, l1: att });
    const t = boxes[0], e = lineEnds(R, "l1", att, boxes, ctx)!;
    expect(e.a).toEqual({ x: 764, y: 332 });
    expect(e.b).toEqual(anchorPoint(t, "l", 0, 12));
    expect(e.attached).toEqual(["a", "b"]);
    expect((drawn(nodesOf(dl, "l1"))[0] as PathNode).d[0]).toEqual(["M", 764, 332]);
    const moved = await build("excel", { k1: icon, l1: att }, [{ op: "item.patch", slide: SLIDE, id: "k1", patch: { box: { x: 200, y: 100, w: 64, h: 64 } } } as Op]);
    expect((drawn(nodesOf(moved.dl, "l1"))[0] as PathNode).d[0]).toEqual(["M", 264, 132]);
    // the attach targets the stage offers: the table, its text boxes, the other items – no line
    expect(anchorTargets(R, boxes, ctx, "l1").map(x => x.to)).toEqual(expect.arrayContaining(["t:" + TABLE, "i:k1"]));
    expect(anchorTargets(R, boxes, ctx, "l1").some(x => x.to === "i:l1")).toBe(false);
  });
  it("free layout, per design: the line's own ends there, an attached end following its object's free box; the other design untouched", async () => {
    const free: Op = { op: "slide.patch", id: SLIDE, patch: { free: { glass: { on: true, items: { "i:k1": { x: 300, y: 600, w: 64, h: 64 }, "i:l2": { x: 99, y: 99, w: 202, h: 2, a: { x: 100, y: 100 }, b: { x: 300, y: 100 } } } } } } } as Op;
    const l2 = line("straight", { x: 500, y: 500 }, { x: 900, y: 500 });
    const g = await build("glass", { k1: icon, l1: att, l2 }, [free]), x = await build("excel", { k1: icon, l1: att, l2 }, [free]);
    expect((drawn(nodesOf(g.dl, "l2"))[0] as LineNode)).toMatchObject({ x1: 100, y1: 100, x2: 300, y2: 100 });
    expect((drawn(nodesOf(x.dl, "l2"))[0] as LineNode)).toMatchObject({ x1: 500, y1: 500, x2: 900, y2: 500 });
    expect((drawn(nodesOf(g.dl, "l1"))[0] as PathNode).d[0]).toEqual(["M", 364, 632]);
    expect((drawn(nodesOf(x.dl, "l1"))[0] as PathNode).d[0]).toEqual(["M", 764, 332]);
    // switching free layout on saves the line's ends with its box (plan-M15 risk 1): nothing moves
    const fb = freeBoxes(x.R, x.ctx)["i:l2"];
    expect(fb).toMatchObject({ a: { x: 500, y: 500 }, b: { x: 900, y: 500 } });
    // an entry an older page wrote with its box only: the ends move as the box moved
    const old: Op = { op: "slide.patch", id: SLIDE, patch: { free: { excel: { on: true, items: { "i:l2": { x: 599, y: 399, w: 402, h: 2 } } } } } } as Op;
    const o = await build("excel", { l2 }, [old]);
    expect((drawn(nodesOf(o.dl, "l2"))[0] as LineNode)).toMatchObject({ x1: 600, y1: 400, x2: 1000, y2: 400 });
    expect(freeBoxes(o.R, o.ctx)["i:l2"]).toMatchObject({ a: { x: 600, y: 400 }, b: { x: 1000, y: 400 } });
  });
  it("an end whose object is gone stays at its saved point, with the Issues line", async () => {
    const { dl } = await build("excel", { l1: att });
    expect(dl.items.l1.issue).toBe("its end lost its object");
    expect((drawn(nodesOf(dl, "l1"))[0] as PathNode).d[0]).toEqual(["M", 0, 0]);
    const both = await build("excel", { l1: { ...att, ends: { a: { to: "i:gone", at: "c" }, b: { to: "t:gone", at: "c" } } } });
    expect(both.dl.items.l1.issue).toBe("both its ends lost their objects");
  });
  it("the saved fixture lines-4.8.json: its lines draw in every design; the elbow's table end (t:t1, not on this slide) is lost", async () => {
    const F = JSON.parse(fs.readFileSync(path.join(here, "fixtures/saved/lines-4.8.json"), "utf8"));
    const items = { ...F.snapshot.doc.preset.slides[0].items };
    for (const r of F.records) for (const op of r.ops) if (op.op === "item.patch" && op.patch?.kind) items[op.id] = op.patch;
    for (const design of DESIGNS) {
      const { dl } = await build(design, items);
      expect(validate(dl.nodes), design).toEqual([]);
      for (const id of Object.keys(items).filter(k => items[k].kind === "line")) expect(drawn(nodesOf(dl, id)).length, `${design} ${id}`).toBeGreaterThan(0);
      expect(dl.items.l2.issue).toBe("its end lost its object");
    }
  });
});

describe("lines in PowerPoint (09 §4.3, LN-03): plain shapes with native ends, never a connector", () => {
  it("a straight line is a:prstGeom line, flipped so its first point is end a, with a:tailEnd on b; an elbow an open custGeom", async () => {
    const back = line("straight", { x: 600, y: 300 }, { x: 200, y: 100 }, { style: { heads: { a: "diamond", b: "triangle", size: "s" } } });
    const { dl, sem } = await build("excel", { s: ALL.s, e: ALL.e, back });
    const els = flat(sceneOf(dl.nodes, sem, () => true)).filter((e): e is ShapeEl => e.k === "sp" && e.name === "Line");
    const s = els.find(e => e.box.x === 100 && e.box.y === 820)!;
    expect(s).toMatchObject({ geom: { prst: "line" }, box: { x: 100, y: 820, w: 500, h: 0 }, fill: null, line: { w: 2, tail: { type: "triangle" } } });
    expect(s.line).not.toHaveProperty("head");
    const b = els.find(e => e.box.x === 200)!;
    expect(b).toMatchObject({ geom: { prst: "line" }, flipH: true, flipV: true, box: { x: 200, y: 100, w: 400, h: 200 }, line: { head: { type: "diamond", size: "s" }, tail: { type: "triangle", size: "s" } } });
    const e = els.find(x => !("prst" in x.geom))!;
    if ("prst" in e.geom) throw new Error("a preset");
    expect(e.geom.open).toBe(true);
    expect(e.geom.path.map(c => c[0])).toEqual(["M", "L", "L", "L"]);
    expect(e.line).toMatchObject({ w: 3, join: "miter", tail: { type: "arrow", size: "l" } });
    const xml = strFromU8(unzipSync(pptx([{ dl, sem }]))["ppt/slides/slide1.xml"]);
    expect(xml).not.toContain("<p:cxnSp");
    expect(xml).toMatch(/<a:prstGeom prst="line">/);
    expect(xml).toMatch(/<a:xfrm flipH="1" flipV="1">/);
    expect(xml).toContain('<a:headEnd type="diamond" w="sm" len="sm"/><a:tailEnd type="triangle" w="sm" len="sm"/>');
    expect(xml).toContain('<a:tailEnd type="arrow" w="lg" len="lg"/>');
    expect(xml).toMatch(/<a:path w="\d+" h="\d+" fill="none">/);
  });
  it("the limiter's bars: segments of the one custGeom when the line has no native end, a shape of their own beside a native end; the label grouped with it", async () => {
    const mixed = line("straight", { x: 100, y: 400 }, { x: 500, y: 400 }, { style: { heads: { a: "bar", b: "triangle" } } });
    const { dl, sem } = await build("excel", { r: ALL.r, m: mixed });
    const top = sceneOf(dl.nodes, sem, () => true).filter(e => e.name === "Line");
    expect(top).toHaveLength(2);
    expect(top.every(e => e.k === "grp")).toBe(true);
    const r = flat([top[0]]).filter((e): e is ShapeEl => e.k === "sp");
    const rl = r.find(e => e.name === "Line")!;
    if ("prst" in rl.geom) throw new Error("a preset");
    expect(rl.geom.path.filter(c => c[0] === "M")).toHaveLength(3);             // the line and its two ticks
    expect(rl.line).not.toHaveProperty("head"); expect(rl.line).not.toHaveProperty("tail");
    expect(r.some(e => !!e.text && e.text.paras.some(p => p.runs.some(x => x.text.includes("+12"))))).toBe(true);
    const m = flat([top[1]]).filter((e): e is ShapeEl => e.k === "sp");
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ geom: { prst: "line" }, line: { tail: { type: "triangle" } } });
    expect(m[1].line).toMatchObject({ cap: "round" });
  });
  it("an attached line is written where it is drawn (resolved ends)", async () => {
    const att = line("straight", { x: 0, y: 0 }, { x: 10, y: 10 }, { ends: { a: { to: "i:k1", at: "b" } } });
    const { dl, sem } = await build("excel", { k1: { kind: "shape", shape: "icon", icon: "target", box: { x: 700, y: 300, w: 64, h: 64 } }, l: att });
    const s = flat(sceneOf(dl.nodes, sem, () => true)).find((e): e is ShapeEl => e.k === "sp" && e.name === "Line")!;
    expect(s).toMatchObject({ flipH: true, flipV: true, box: { x: 10, y: 10, w: 722, h: 354 } });
  });
  it("every design: the file has only plain line shapes (no cxnSp, no picture) – PPTX_OUT writes it for pptxcheck", async () => {
    const slides = [];
    for (const design of DESIGNS) {
      const b = await build(design, ALL);
      const lines = sceneOf(b.dl.nodes, b.sem, () => true).filter(e => e.name === "Line");
      expect(lines.length, design).toBe(5);
      slides.push(b);
    }
    const bytes = pptx(slides);
    if (process.env.PPTX_OUT) {
      fs.writeFileSync(path.join(process.env.PPTX_OUT, "lines-5-designs.pptx"), bytes);
      fs.writeFileSync(path.join(process.env.PPTX_OUT, "lines-5-designs.expect.json"), JSON.stringify({ [path.join(process.env.PPTX_OUT, "lines-5-designs.pptx")]: DESIGNS.map((_, k) => ({ slide: k + 1, tables: 1, charts: 0, lines: 5, heads: 4, dashed: 1 })) }));
    }
    const z = unzipSync(bytes);
    for (let k = 1; k <= DESIGNS.length; k++) {
      const s = strFromU8(z[`ppt/slides/slide${k}.xml`]);
      expect(s).not.toContain("<p:cxnSp");
      expect(s).not.toContain("<p:pic>");
      expect((s.match(/name="Line \d+"/g) || []).length).toBeGreaterThanOrEqual(5);
    }
  });
});

/* ---- S15.3 review follow-ups (w2-review-S15.3 findings 2–5) ---- */
const hexOf = (p: unknown) => ((p as { solid: number[] }).solid).map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase();
describe("S15.3 follow-ups: ticks, the label's ground, the ink per theme, the stroke under a head at a bend", () => {
  it("a dashed range or limiter: its ticks are a solid round-capped shape of their own, the dashed route apart (PowerPoint draws them as the slide)", async () => {
    const dr = line("range", { x: 300, y: 600 }, { x: 900, y: 600 }, { style: { dash: "dashed" } });
    const eb = line("elbow", { x: 300, y: 300 }, { x: 700, y: 450 }, { style: { heads: { a: "bar", b: "bar" } } });
    const { dl, sem } = await build("excel", { dr, eb });
    // the slide: the ticks solid, round caps
    const ticks = drawn(nodesOf(dl, "dr")).filter((n): n is PathNode => n.t === "path" && !!n.stroke);
    expect(ticks).toHaveLength(2);
    for (const t of ticks) { expect(t.stroke!.dash).toBeUndefined(); expect(t.stroke!.cap).toBe("round"); }
    const grp = sceneOf(dl.nodes, sem, () => true).filter(e => e.name === "Line");
    expect(grp).toHaveLength(2);
    for (const g of grp) {
      const sps = flat([g]).filter((e): e is ShapeEl => e.k === "sp" && e.name === "Line");
      expect(sps).toHaveLength(2);                                                // the route and its ticks
      const [route, tk] = sps;
      if ("prst" in tk.geom) throw new Error("ticks as a preset");
      expect(tk.geom.path.filter(c => c[0] === "M")).toHaveLength(2);
      expect(tk.line).toMatchObject({ cap: "round", join: "round" });
      expect(tk.line).not.toHaveProperty("dash");
      expect(route.line).not.toHaveProperty("head"); expect(route.line).not.toHaveProperty("tail");
    }
    const [r0] = flat([grp[0]]).filter((e): e is ShapeEl => e.k === "sp" && e.name === "Line");
    expect(r0).toMatchObject({ geom: { prst: "line" } });
    expect(r0.line!.dash).toBeTruthy();
    const bytes = pptx([{ dl, sem }]), xml = strFromU8(unzipSync(bytes)["ppt/slides/slide1.xml"]);
    if (process.env.PPTX_OUT) {
      const f = path.join(process.env.PPTX_OUT, "lines-ticks.pptx");
      fs.writeFileSync(f, bytes);
      fs.writeFileSync(f.replace(/\.pptx$/, ".expect.json"), JSON.stringify({ [f]: [{ slide: 1, tables: 1, charts: 0, lines: 2, heads: 0, dashed: 1 }] }));
    }
    expect(xml).not.toContain("<p:cxnSp");
    // the undashed ticks: a round cap without a dash in the same a:ln
    expect(xml).toMatch(/<a:ln w="\d+" cap="rnd">(?:(?!<a:custDash|<a:prstDash|<\/a:ln>).)*<a:round\/>/s);
    // a solid range keeps its ticks in the one geometry, round-capped (the caps under the ticks)
    const solidR = await build("excel", { r: ALL.r });
    const one = flat(sceneOf(solidR.dl.nodes, solidR.sem, () => true)).filter((e): e is ShapeEl => e.k === "sp" && e.name === "Line");
    expect(one).toHaveLength(1);
    expect(one[0].line).toMatchObject({ cap: "round" });
  });
  it("an elbow bent at an end (mid 0 or 1): the stroke is still shortened under a filled head (towards the first point that is not the tip)", async () => {
    for (const mid of [0, 1]) {
      const it0 = line("elbow", { x: 200, y: 200 }, { x: 600, y: 400 }, { mid, style: { heads: { a: "triangle", b: "triangle" } } });
      const { dl } = await build("excel", { e: it0 });
      const d = (drawn(nodesOf(dl, "e"))[0] as PathNode).d, L = headLength(2);
      const pts = d.map(c => [c[1], c[2]] as [number, number]);
      // neither end of the stroke stays on the tip
      expect(pts[0], `mid ${mid}`).not.toEqual([200, 200]);
      expect(pts.at(-1), `mid ${mid}`).not.toEqual([600, 400]);
      if (mid === 0) { expect(pts[0]).toEqual([200, 200 + L]); expect(pts.at(-1)).toEqual([600 - L, 400]); }
      else { expect(pts[0]).toEqual([200 + L, 200]); expect(pts.at(-1)).toEqual([600, 400 - L]); }
    }
  });
  it("the label's ground: the slide's own colour, a consulting design's dark band or Consulting Red's panel under it – the text white on a dark ground", async () => {
    const top = line("straight", { x: 900, y: 60 }, { x: 1300, y: 60 }, { text: "In the band" });
    const low = line("straight", { x: 900, y: 860 }, { x: 1300, y: 860 }, { text: "Below" });
    const mk = await build("mckinsey", { top, low });
    const chip = (dl: typeof mk.dl, id: string) => drawn(nodesOf(dl, id)).find(n => n.t === "rect")!;
    const txt = (dl: typeof mk.dl, id: string) => drawn(nodesOf(dl, id)).find(n => n.t === "text")!;
    expect(hexOf((chip(mk.dl, "top") as { fill: unknown }).fill)).toBe("051C2C");          // the navy band
    expect(hexOf((txt(mk.dl, "top") as { fill: unknown }).fill)).toBe("FFFFFF");
    expect(hexOf((chip(mk.dl, "low") as { fill: unknown }).fill)).not.toBe("051C2C");
    expect(hexOf((txt(mk.dl, "low") as { fill: unknown }).fill)).toBe("051C2C");
    // the background drawn first is the same colour as the low label's ground
    expect(hexOf((mk.dl.nodes[0] as { fill: unknown }).fill)).toBe(hexOf((chip(mk.dl, "low") as { fill: unknown }).fill));
    const inPanel = line("straight", { x: 60, y: 700 }, { x: 400, y: 700 }, { text: "On the panel" });
    const bn = await build("bain", { inPanel, low });
    const panel = hexOf((chip(bn.dl, "inPanel") as { fill: unknown }).fill);
    expect(panel).not.toBe(hexOf((chip(bn.dl, "low") as { fill: unknown }).fill));
    expect(bn.dl.nodes.some(n => n.t === "rect" && n.x === 0 && n.y === 0 && n.h === 900 && n.w < 1600 && hexOf(n.fill) === panel)).toBe(true);   // the panel's own colour
  });
  it("the ink per theme: the deck's text-box colour when set, Liquid Glass's text colour, a light ink on a dark slide colour (Excel, Clean)", async () => {
    const p = line("straight", { x: 100, y: 300 }, { x: 400, y: 300 }), d = line("straight", { x: 100, y: 850 }, { x: 1500, y: 850 }, { style: { w: 1, dash: "dashed" } });
    const ink = (dl: Awaited<ReturnType<typeof build>>["dl"], id: string) => hexOf((drawn(nodesOf(dl, id))[0] as LineNode).stroke.paint);
    for (const design of DESIGNS) {
      const t = await build(design, { p, d }, [], { text: { note: { color: "#123456" } } });
      expect(ink(t.dl, "p"), design).toBe("123456");
    }
    for (const design of ["excel", "clean"] as const) {
      const dark = await build(design, { p, d }, [], { colors: { bg: "#1A1A1A" } });
      expect(ink(dark.dl, "p"), design).toBe("F2F2F2");
      expect(ink(dark.dl, "d"), design).toBe("8C8C8C");
      const light = await build(design, { p, d }, [], { colors: { bg: "#FFF8E7" } });
      expect(ink(light.dl, "p"), design).toBe("404040");
    }
    // Liquid Glass ignores a slide colour (its wallpaper): its text colour
    expect(ink((await build("glass", { p }, [], { colors: { bg: "#1A1A1A" } })).dl, "p")).toBe("0B0D17");
  });
});
