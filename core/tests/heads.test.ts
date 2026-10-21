/* S14.P (shared by M14 and M15): line ends as display-list geometry (render/heads.ts), the native a:ln writer with joins
   and a:headEnd / a:tailEnd (pptx/drawingml.ts), Stroke.join through the PowerPoint scene, the chart overlay and the line
   item's scene member (pptx/scene.ts). 09 §2.3, §3, §3.4, §4.3; ADR-004 amendment. */
import { describe, expect, it } from "vitest";
import { headGeom, headed, headLength } from "../src/render/heads";
import { headEnd, Ids, elXml, ln, lineEnd } from "../src/pptx/drawingml";
import { sceneOf, type El, type ShapeEl, type SlideSem } from "../src/pptx/scene";
import type { ChartSem } from "../src/pptx/chart-sem";
import { pathBox } from "../src/dl/geom";
import { validate, type DisplayList, type Stroke } from "../src/dl/types";
import type { Head } from "../src/model/types";

const INK: Stroke = { w: 2, paint: { solid: [31, 56, 100] } };
const refs = { image: () => null, chart: () => "rId9", face: (css: string) => css };
const HEADS: Head[] = ["arrow", "triangle", "stealth", "oval", "diamond", "bar"];

describe("heads.ts: Heads → path geometry (09 §3.4)", () => {
  it("every head draws, valid, with its tip on the end; none / unknown / a line of no length draw nothing", () => {
    for (const h of HEADS) {
      const g = headGeom(h, { x: 100, y: 50 }, { x: 0, y: 50 }, 2)!;
      expect(g, h).not.toBeNull();
      const b = pathBox(g.d), L = headLength(2);
      // pointing right: the head lies behind the tip (x ≤ 100), centred heads straddle it
      expect(b.x + b.w, h).toBeLessThanOrEqual(100 + (h === "oval" || h === "diamond" ? L / 2 : 0) + .01);
      expect(b.y + b.h / 2, h).toBeCloseTo(50, 1);
      expect(validate([g.filled ? { t: "path", d: g.d, fill: INK.paint } : { t: "path", d: g.d, stroke: INK }]), h).toEqual([]);
    }
    expect(headGeom("none", { x: 1, y: 1 }, { x: 0, y: 0 }, 2)).toBeNull();
    expect(headGeom(undefined, { x: 1, y: 1 }, { x: 0, y: 0 }, 2)).toBeNull();
    expect(headGeom("rocket" as Head, { x: 1, y: 1 }, { x: 0, y: 0 }, 2)).toBeNull();
    expect(headGeom("triangle", { x: 1, y: 1 }, { x: 1, y: 1 }, 2)).toBeNull();
  });
  it("sizes s / m / l = 2 / 3 / 4.5 × the weight (at least 6 px); filled heads shorten the line, centred and open ones do not", () => {
    expect([headLength(4, "s"), headLength(4, "m"), headLength(4, "l"), headLength(4), headLength(.5)]).toEqual([8, 12, 18, 12, 6]);
    const tri = headGeom("triangle", { x: 100, y: 0 }, { x: 0, y: 0 }, 4, "l")!;
    expect([tri.filled, tri.back]).toEqual([true, 18]);
    expect(tri.d[0]).toEqual(["M", 100, 0]);                                   // the tip is exact
    expect(headGeom("stealth", { x: 100, y: 0 }, { x: 0, y: 0 }, 4)!.back).toBeCloseTo(7.2);
    for (const h of ["oval", "diamond", "arrow", "bar"] as Head[]) expect(headGeom(h, { x: 100, y: 0 }, { x: 0, y: 0 }, 4)!.back, h).toBe(0);
    expect(headGeom("arrow", { x: 100, y: 0 }, { x: 0, y: 0 }, 4)!.filled).toBe(false);
    const bar = headGeom("bar", { x: 100, y: 0 }, { x: 0, y: 0 }, 4)!;      // the limiter: perpendicular through the end
    expect(bar.d).toEqual([["M", 100, 6], ["L", 100, -6]]);
  });
  it("follows the line's direction (a vertical arrow from the floor up to a point: the reference chart's mark, 09 §3.3)", () => {
    const g = headGeom("triangle", { x: 50, y: 100 }, { x: 50, y: 400 }, 1.5)!;
    expect(g.d[0]).toEqual(["M", 50, 100]);
    const b = pathBox(g.d);
    expect(b.y).toBeCloseTo(100); expect(b.y + b.h).toBeCloseTo(106);      // 6 px below the tip
  });
  it("headed(): the shortened stroke and the heads as nodes, never past the middle", () => {
    const h = headed({ x: 0, y: 0 }, { x: 200, y: 0 }, INK, { a: "oval", b: "triangle", size: "l" });
    expect(h.a).toEqual({ x: 0, y: 0 });                                      // oval: centred, the line reaches it
    expect(h.b).toEqual({ x: 191, y: 0 });                                    // triangle: 4.5 × 2 = 9 px back
    expect(h.nodes).toHaveLength(2);
    expect(validate([{ t: "line", x1: h.a.x, y1: h.a.y, x2: h.b.x, y2: h.b.y, stroke: INK }, ...h.nodes])).toEqual([]);
    const short = headed({ x: 0, y: 0 }, { x: 10, y: 0 }, INK, { a: "triangle", b: "triangle" });
    expect([short.a.x, short.b.x]).toEqual([5, 5]);
    const open = headed({ x: 0, y: 0 }, { x: 100, y: 0 }, { w: 2, paint: { linear: [0, 0, 1, 0], stops: [{ o: 0, c: [0, 0, 0], a: 1 }, { o: 1, c: [9, 9, 9], a: .5 }] } }, { b: "arrow" });
    expect(open.nodes[0]).toMatchObject({ t: "path", stroke: { paint: { solid: [9, 9, 9], a: .5 }, join: "round", cap: "round" } });
    expect(validate(open.nodes)).toEqual([]);
    expect(headed({ x: 0, y: 0 }, { x: 10, y: 10 }, INK, undefined).nodes).toEqual([]);
  });
});

describe("drawingml a:ln: joins and native ends (09 §4.3; no connector shape)", () => {
  it("writes join, then headEnd / tailEnd, after the fill and dash (the schema's order)", () => {
    const x = ln({ w: 2, paint: { solid: [0, 0, 0] }, dash: [6, 2], join: "round", head: { type: "oval", size: "s" }, tail: { type: "triangle" } }, 10, 10);
    expect(x).toMatch(/^<a:ln w="15240"><a:solidFill>.*<\/a:solidFill><a:custDash>.*<\/a:custDash><a:round\/><a:headEnd type="oval" w="sm" len="sm"\/><a:tailEnd type="triangle" w="med" len="med"\/><\/a:ln>$/);
    expect(ln({ w: 1, paint: { solid: [0, 0, 0] }, join: "bevel" }, 1, 1)).toContain("<a:bevel/>");
    expect(ln({ w: 1, paint: { solid: [0, 0, 0] }, join: "miter" }, 1, 1)).toContain('<a:miter lim="1000000"/>');
    // unset: the markup of 4.6, unchanged
    expect(ln({ w: 1, paint: { solid: [0, 0, 0] }, cap: "round" }, 1, 1)).toBe('<a:ln w="7620" cap="rnd"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>');
  });
  it("model heads map to DrawingML's line-end types; the limiter's bar and none have no native end", () => {
    expect(["arrow", "triangle", "stealth", "oval", "diamond"].map(h => headEnd(h as Head, "l"))).toEqual(
      ["arrow", "triangle", "stealth", "oval", "diamond"].map(type => ({ type, size: "l" })));
    expect([headEnd("bar"), headEnd("none"), headEnd(undefined)]).toEqual([undefined, undefined, undefined]);
    expect(lineEnd("a:tailEnd", { type: "stealth", size: "l" })).toBe('<a:tailEnd type="stealth" w="lg" len="lg"/>');
    expect(lineEnd("a:headEnd", undefined)).toBe("");
  });
  it("a line shape with heads is a p:sp, never a p:cxnSp", () => {
    const el: ShapeEl = { k: "sp", box: { x: 0, y: 0, w: 100, h: 0 }, geom: { prst: "line" }, fill: null, line: { w: 2, paint: { solid: [0, 0, 0] }, tail: { type: "triangle" } } };
    const x = elXml(el, new Ids(), refs);
    expect(x).toMatch(/^<p:sp>/); expect(x).not.toContain("cxnSp");
    expect(x).toContain('<a:tailEnd type="triangle" w="med" len="med"/>');
  });
});

describe("the PowerPoint scene (S14.P): Stroke.join, the chart overlay, the line item", () => {
  const sem = (items: SlideSem["items"]): SlideSem => ({ type: "content", items, palette: [] });
  it("a stroke's join reaches the shape's line", () => {
    const dl: DisplayList = [{ t: "path", d: [["M", 0, 0], ["L", 50, 40], ["L", 100, 0]], stroke: { w: 3, paint: { solid: [0, 0, 0] }, join: "round", cap: "round" } }];
    const [sh] = sceneOf(dl, null, () => true) as ShapeEl[];
    expect(sh.line).toMatchObject({ w: 3, join: "round", cap: "round" });
    const [plain] = sceneOf([{ t: "line", x1: 0, y1: 0, x2: 9, y2: 0, stroke: { w: 1, paint: { solid: [0, 0, 0] } } }], null, () => true) as ShapeEl[];
    expect(plain.line).not.toHaveProperty("join");
  });
  it("a chart's overlay is drawn over the native chart, in the chart's group, as plain shapes", () => {
    const chart: ChartSem = { type: "pie", title: "", titleFont: { css: "Arial", size: 18, color: "#000000", b: true, i: false }, labelFont: { css: "Arial", size: 14, color: "#000000", b: false, i: false },
      series: "S", labels: ["a"], values: [1], colors: ["#1F3864"], show: [], legend: "none", startAngle: 0, box: { x: 10, y: 10, w: 200, h: 100 }, sep: null, fmt: "General", hole: 58 };
    const card: DisplayList = [{ t: "rect", x: 0, y: 0, w: 220, h: 120, fill: { solid: [255, 255, 255] } }];
    const arrow = headed({ x: 50, y: 110 }, { x: 50, y: 30 }, INK, { b: "triangle" });
    const overlay: DisplayList = [{ t: "line", x1: arrow.a.x, y1: arrow.a.y, x2: arrow.b.x, y2: arrow.b.y, stroke: INK }, ...arrow.nodes];
    const dl: DisplayList = [{ t: "hit", kind: "item", id: "c1", x: 0, y: 0, w: 220, h: 120 }, ...card];
    const g = sceneOf(dl, sem({ c1: { kind: "chart", at: [0, 2], card, chart, overlay } }), () => true)[0] as Extract<El, { k: "grp" }>;
    expect(g.name).toBe("Chart c1");
    expect(g.children.map(e => e.k)).toEqual(["sp", "chart", "sp", "sp"]);
    const without = sceneOf(dl, sem({ c1: { kind: "chart", at: [0, 2], card, chart } }), () => true)[0] as Extract<El, { k: "grp" }>;
    expect(without.children.map(e => e.k)).toEqual(["sp", "chart"]);           // 4.6's charts: unchanged
  });
  it("a line item's nodes become its shapes (grouped when several); an empty one (S14.P's stub) nothing", () => {
    const dl: DisplayList = [{ t: "line", x1: 0, y1: 0, x2: 90, y2: 0, stroke: INK }, { t: "path", d: [["M", 100, 0], ["L", 90, 4], ["L", 90, -4], ["Z"]], fill: INK.paint }];
    const g = sceneOf(dl, sem({ l1: { kind: "line", at: [0, 2], heads: { b: "triangle" } } }), () => true);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ k: "grp", name: "Line" });
    expect(sceneOf([], sem({ l1: { kind: "line", at: [0, 0], heads: null } }), () => true)).toEqual([]);
  });
});
