/* Cell borders on the slide (S10.3b, B28; product owner 2026-10-19: Borders ▾ as Excel's, separate from the gridlines):
   TableDef.borders → the items' borders (effItems' withBorders) – over the workbook's, which is never changed; the cell
   across a side draws the same edge; drawn where workbook borders are drawn (Excel, Excel Refined, the consulting rules
   tables), not in Liquid Glass. */
import { describe, expect, it } from "vitest";
import { deckOf } from "./corpus-deck";
import { effItems, keyOf } from "../src/render/edits";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { rulesToDisplayList } from "../src/render/consult-rules";
import { glassPlan } from "../src/render/glass";
import { wrapLines } from "../src/text/lines";
import type { DisplayList, LineNode, Node } from "../src/dl/types";
import type { CellBorders, CellGrid, Design, Op } from "../src/model/types";
import type { Item, TableLayout } from "../src/xlsx/types";

const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const flat = (l: DisplayList): Node[] => l.flatMap(n => n.t === "group" ? [n, ...flat(n.children)] : [n]);
const lines = (l: DisplayList) => flat(l).filter((n): n is LineNode => n.t === "line");
const ink = (l: LineNode) => (l.stroke.paint as { solid: number[] }).solid.map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase();
const TABLE = "l4tsxhl";
async function table(design: Design, borders: Record<string, CellBorders | null> = {}, grid: Record<string, CellGrid> = {}, version: string[] = []) {
  const ops: Op[] = [];
  if (Object.keys(borders).length) ops.push({ op: "table.patch", id: TABLE, patch: { borders } } as Op);
  if (Object.keys(grid).length) ops.push({ op: "table.patch", id: TABLE, patch: { cellGrid: grid } } as Op);
  const { ctx, slides } = await deckOf("weekly.json", design, ops);
  const L = slides.flatMap(s => s.tables).find(t => t.def?.id === TABLE)! as TableLayout;
  const c = version.length ? { ...ctx(), version: { id: "v", name: "V", hide: { [L.sheet.name]: version } } } : ctx();
  return { L, c, items: effItems(L, c) };
}
const at = (items: Item[], r: number, c: number) => items.find(it => it.b.r === r && it.b.c === c);
const single = (it: Item | undefined) => !!it && it.b.r === it.b.r2 && it.b.c === it.b.c2;
/** a cell with no border whose neighbours below and right have none either */
function clean(L: TableLayout, items: Item[]) {
  for (let i = 0; i + 1 < L.rows.length; i++) for (let j = 0; j + 1 < L.cols.length; j++) {
    const a = at(items, L.rows[i], L.cols[j]), b = at(items, L.rows[i + 1], L.cols[j]), r = at(items, L.rows[i], L.cols[j + 1]);
    if ([a, b, r].every(x => single(x) && !x!.top && !x!.bottom && !x!.left && !x!.right)) return { a: a!, below: b!, right: r! };
  }
  throw new Error("no clean cell");
}
const RED = { style: "medium", color: "#C00000" } as const;
/** a Liquid Glass plan without its items: its materials, lines, capsules, pictures and texts with their classes and boxes */
const planSig = (p: ReturnType<typeof glassPlan>) => JSON.stringify([p.W, p.H, p.shells, p.lines, p.caps, p.pics, p.texts.map(t => [t.cls, t.x, t.y, t.w, t.h, t.it?.role]), p.tbx.map(e => e.k === "shell" ? e : [e.k])]);

describe("cell borders on the slide (B28)", () => {
  it("a side set: drawn once, in its style and colour – an inside edge by the cell below / right (as the workbook's model)", async () => {
    const base = await table("excel"), { a, below } = clean(base.L, base.items);
    const t = await table("excel", { [keyOf(a)]: { bottom: RED } });
    const A = t.items.find(x => keyOf(x) === keyOf(a))!, B = t.items.find(x => keyOf(x) === keyOf(below))!;
    expect(A.bottom ?? null).toBeNull(); expect(B.top).toEqual(RED);
    expect(A.ub).toBeUndefined(); expect(B.ub).toEqual({ top: true });
    const red = lines(excelToDisplayList(t.L, t.c, M).nodes).filter(l => ink(l) === "C00000");
    expect(red.length).toBe(1);
    expect(red[0].stroke.w).toBe(2);
    expect(red[0].y1).toBeCloseTo(B.by + 1);
    // a side at the table's edge stays the cell's own
    const last = base.items.find(it => single(it) && it.b.r === base.L.rows[base.L.rows.length - 1] && !it.bottom)!;
    const t2 = await table("excel", { [keyOf(last)]: { bottom: RED } });
    expect(t2.items.find(x => keyOf(x) === keyOf(last))!.bottom).toEqual(RED);
    // the workbook is untouched: its layout items keep their borders
    expect(t.L.items.find(x => keyOf(x) === keyOf(a))!.bottom ?? null).toBeNull();
  });
  it("\"none\" removes the workbook's border of that side, also the cell across it's coincident one", async () => {
    const base = await table("excel");
    const withTop = base.items.find(it => single(it) && it.top && base.items.some(o => single(o) && o.b.r2 + 1 === it.b.r && o.b.c === it.b.c))!;
    expect(withTop).toBeTruthy();
    const above = base.items.find(o => single(o) && o.b.r2 + 1 === withTop.b.r && o.b.c === withTop.b.c)!;
    const t = await table("excel", { [keyOf(withTop)]: { top: "none" } });
    expect(t.items.find(x => keyOf(x) === keyOf(withTop))!.top).toBeNull();
    expect(t.items.find(x => keyOf(x) === keyOf(above))!.bottom).toBeNull();
  });
  it("the edge's owner's own setting wins (Borders ▾ writes both cells' entries, so the last action wins)", async () => {
    const base = await table("excel"), { a, below } = clean(base.L, base.items);
    const blue = { style: "thin", color: "#1F4E79" } as const;
    const t = await table("excel", { [keyOf(a)]: { bottom: RED }, [keyOf(below)]: { top: blue } });
    expect(t.items.find(x => keyOf(x) === keyOf(a))!.bottom ?? null).toBeNull();
    expect(t.items.find(x => keyOf(x) === keyOf(below))!.top).toEqual(blue);
    expect(lines(excelToDisplayList(t.L, t.c, M).nodes).filter(l => ink(l) === "C00000" || ink(l) === "1F4E79").length).toBe(1);
  });
  it("\"none\" removes borders, never the table's own gridlines (a layer of their own)", async () => {
    const base = await table("excel"), { a } = clean(base.L, base.items);
    const { ctx, slides } = await deckOf("weekly.json", "excel", [{ op: "table.patch", id: TABLE, patch: { gridH: "on", gridV: "on", borders: { [keyOf(a)]: { top: "none", left: "none", right: "none", bottom: "none" } } } } as Op]);
    const L = slides.flatMap(s => s.tables).find(x => x.def?.id === TABLE)! as TableLayout, A = effItems(L, ctx()).find(x => keyOf(x) === keyOf(a))!;
    expect([A.top, A.left].map(b => b && b.color)).toEqual(["#BFBFBF", "#BFBFBF"]);
  });
  it("unknown styles and colours are ignored; every style draws", async () => {
    const base = await table("excel"), { a } = clean(base.L, base.items);
    for (const bad of [{ style: "wavy", color: "#C00000" }, { style: "thin", color: "red" }, { style: "thin" }, 7, "x"]) {
      const t = await table("excel", { [keyOf(a)]: { left: bad } as never });
      expect(t.items.find(x => keyOf(x) === keyOf(a))!.left ?? null).toBeNull();
    }
    for (const style of ["thin", "medium", "thick", "dashed", "dotted", "double"] as const) {
      const t = await table("excel", { [keyOf(a)]: { left: { style, color: "#C00000" } } });
      expect(lines(excelToDisplayList(t.L, t.c, M).nodes).filter(l => ink(l) === "C00000").length).toBe(style === "double" ? 2 : 1);
    }
  });
  it("separate from the gridlines: a border set on an edge shows there, the cell's gridline only on the others", async () => {
    const base = await table("excel"), { a } = clean(base.L, base.items);
    const t = await table("excel", { [keyOf(a)]: { top: RED } }, { [keyOf(a)]: { h: "on" } });
    const A = t.items.find(x => keyOf(x) === keyOf(a))!;
    expect(A.top).toEqual(RED);
    expect(Object.keys(A.cgx || {})).toEqual(["top"]);                                    // the border shows there
    const ls = lines(excelToDisplayList(t.L, t.c, M).nodes);
    expect(ls.filter(l => ink(l) === "C00000").length).toBeGreaterThanOrEqual(1);          // the border (and the cell above's, if any)
    expect(ls.filter(l => ink(l) === "BFBFBF" && Math.abs(l.y1 - (A.by + A.bh - .5)) < .01).length).toBe(1);   // the gridline below
  });
  it("a version that removes the cell keeps its borders (VR-02)", async () => {
    const base = await table("excel"), { a } = clean(base.L, base.items), k = keyOf(a);
    const t = await table("excel", { [k]: { left: RED } }, {}, [k + ":" + k]);
    const A = t.items.find(x => keyOf(x) === k)!;
    expect([A.removed, A.left]).toEqual([true, RED]);
  });
  it("drawn by the consulting rules tables; not by Liquid Glass (it draws no workbook borders)", async () => {
    const base = await table("mckinsey"), { a } = clean(base.L, base.items);
    const t = await table("mckinsey", { [keyOf(a)]: { right: RED } });
    expect(lines(rulesToDisplayList(t.L, t.c, M).nodes).filter(l => ink(l) === "C00000").length).toBe(1);
    const g0 = await table("glass"), g = await table("glass", { [keyOf(a)]: { right: RED } });
    expect(planSig(glassPlan(g.L, g.c))).toBe(planSig(glassPlan(g0.L, g0.c)));
  });
  it("Liquid Glass's scene and the consulting cards are not changed by borders set on the slide: a whole row's bottom, none over the table", async () => {
    const g0 = await table("glass"), row = g0.L.rows[Math.floor(g0.L.rows.length / 2)];
    const rowCells = Object.fromEntries(g0.items.filter(it => it.b.r === row).map(it => [keyOf(it), { bottom: RED } as CellBorders]));
    const none = Object.fromEntries(g0.items.map(it => [keyOf(it), { top: "none", left: "none", right: "none", bottom: "none" } as CellBorders]));
    for (const b of [rowCells, none]) {
      const g = await table("glass", b);
      expect(planSig(glassPlan(g.L, g.c))).toBe(planSig(glassPlan(g0.L, g0.c)));
    }
    const c0 = await deckOf("weekly.json", "mckinsey", [{ op: "style.patch", patch: { designs: { mckinsey: { consult: { tables: "cards" } } } } } as Op]);
    const c1 = await deckOf("weekly.json", "mckinsey", [{ op: "style.patch", patch: { designs: { mckinsey: { consult: { tables: "cards" } } } } } as Op, { op: "table.patch", id: TABLE, patch: { borders: none } } as Op]);
    const { cardsToDisplayList } = await import("../src/render/consult-cards");
    const dl = (d: typeof c0) => { const L = d.slides.flatMap(s => s.tables).find(x => x.def?.id === TABLE)!; return JSON.stringify(cardsToDisplayList(L, d.ctx(), M).nodes); };
    expect(dl(c1)).toBe(dl(c0));
  });
});
