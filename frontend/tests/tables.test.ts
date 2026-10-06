import { describe, expect, it } from "vitest";
import { applyScales, scaleColors } from "../src/render/scales";
import { computeLayout, NOTE_GAP } from "../src/render/slide";
import { resolveStyle } from "../src/model/style";
import type { RenderCtx } from "../src/render/context";

/* a fake 3×3 numeric table: rows 2..4, cols 2..4 */
function fakeTable(vals: number[][], W = 300, H = 90, id = "t1") {
  const cells = new Map<string, any>(), items: any[] = [];
  vals.forEach((row, i) => row.forEach((v, j) => {
    const r = i + 2, c = j + 2; cells.set(r + "," + c, { r, c, v, t: "n" });
    items.push({ b: { r, c, r2: r, c2: c, src: { r, c } }, text: String(v) });
  }));
  const sheet = { name: "S", get: (r: number, c: number) => cells.get(r + "," + c) || null };
  return { id, def: { id }, sheet, items, W, H, g: { r1: 1, c1: 1, r2: 5, c2: 5 }, rows: [2, 3, 4], cols: [2, 3, 4] } as any;
}
const ctx = (): RenderCtx => ({ style: { ...resolveStyle(), design: "excel" }, edits: {}, slides: [], preset: null, workbook: "w", logoSrc: "" });
const slide = (tables: any[], cfg: any = {}) => ({ id: "s", type: "content", tables, missing: 0, title: "T", subtitle: "", label: "T", cfg: { id: "s", type: "content", tables: tables.map(t => t.id), ...cfg } } as any);

describe("colour scales", () => {
  const L = fakeTable([[-10, 0, 5], [-5, 10, 20], [1, 2, 3]]);
  it("around zero: deeper for bigger numbers, red for negatives, nothing for 0", () => {
    const m = applyScales(L, { a: { range: "B2:D4", dir: "all", mode: "zero", fill: true, ink: false } });
    const at = (r: number, c: number) => m.get(L.items.find((it: any) => it.b.src.r === r && it.b.src.c === c));
    expect(at(2, 2)!.fill).toBe(scaleColors(1, true).fill);        // -10 = most negative
    expect(at(3, 2)!.fill).toBe(scaleColors(.5, true).fill);       // -5
    expect(at(3, 4)!.fill).toBe(scaleColors(1, false).fill);       // 20 = largest
    expect(at(2, 3)).toBeUndefined();                               // 0
  });
  it("per row and per column use their own maximum", () => {
    const rows = applyScales(L, { a: { range: "B2:D4", dir: "row", mode: "zero", fill: false, ink: true } });
    const cols = applyScales(L, { a: { range: "B2:D4", dir: "col", mode: "zero", fill: false, ink: true } });
    const it = L.items.find((x: any) => x.b.src.r === 4 && x.b.src.c === 4);       // 3: max of its row, not of its column
    expect(rows.get(it)!.ink).toBe(scaleColors(1, false).ink);
    expect(cols.get(it)!.ink).toBe(scaleColors(3 / 20, false).ink);
    expect(rows.get(it)!.fill).toBeUndefined();
  });
  it("low → high and reversed", () => {
    const m = applyScales(L, { a: { range: "B4:D4", dir: "row", mode: "minmax", fill: true, ink: false, invert: true } });
    const low = L.items.find((x: any) => x.b.src.r === 4 && x.b.src.c === 2);
    expect(m.get(low)!.fill).toBe(scaleColors(1, false).fill);     // lowest becomes green when reversed
  });
});

describe("slide layout with text boxes, alignment and fixed scale", () => {
  it("left/right boxes are as high as the table, top/bottom as wide", () => {
    const T = fakeTable([[1]], 400, 200);
    const R = slide([T], { notes: { "t1:left": { text: "L" }, "t1:right": { text: "R", w: 180 }, "t1:top": { text: "top" }, "t1:bottom": { text: "b", h: 50 } } });
    const { boxes } = computeLayout(R, ctx());
    const b = boxes[0], n = b.notes;
    expect(n.left!.h).toBeCloseTo(b.h); expect(n.right!.h).toBeCloseTo(b.h); expect(n.right!.w).toBe(180);
    expect(n.top!.w).toBeCloseTo(b.w); expect(n.bottom!.w).toBeCloseTo(b.w); expect(n.bottom!.h).toBe(50);
    expect(n.left!.x + n.left!.w + NOTE_GAP).toBeCloseTo(b.x); expect(n.top!.y + n.top!.h + NOTE_GAP).toBeCloseTo(b.y);
    // everything fits the content area (x 50…1550, y 104…822)
    expect(n.left!.x).toBeGreaterThanOrEqual(49.9); expect(n.right!.x + n.right!.w).toBeLessThanOrEqual(1550.1);
    expect(n.top!.y).toBeGreaterThanOrEqual(103.9); expect(n.bottom!.y + n.bottom!.h).toBeLessThanOrEqual(822.1);
  });
  it("text boxes make the table smaller instead of overflowing", () => {
    const T = fakeTable([[1]], 1500, 300);
    const plain = computeLayout(slide([T]), ctx()).boxes[0].scale;
    const withSides = computeLayout(slide([T], { notes: { "t1:left": { text: "x" }, "t1:right": { text: "y" } } }), ctx()).boxes[0].scale;
    expect(withSides).toBeLessThan(plain);
  });
  it("alignment left/right and a fixed scale", () => {
    const T = fakeTable([[1]], 300, 100);
    expect(computeLayout(slide([T], { align: "left" }), ctx()).boxes[0].x).toBeCloseTo(50);
    const r = computeLayout(slide([T], { align: "right" }), ctx()).boxes[0]; expect(r.x + r.w).toBeCloseTo(1550);
    const f = computeLayout(slide([T], { scale: .5 }), ctx()); expect(f.boxes[0].scale).toBeCloseTo(.5); expect(f.reduced).toBe(false);
    const big = computeLayout(slide([T], { scale: 50 }), ctx()); expect(big.reduced).toBe(true); expect(big.boxes[0].scale).toBeCloseTo(big.fit);
  });
});
