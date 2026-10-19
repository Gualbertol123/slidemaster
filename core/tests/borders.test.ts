/* Cell borders on the slide (S10.3b, B25; product owner 2026-10-19: Borders ▾ as Excel's, separate from the gridlines):
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

describe("cell borders on the slide (B25)", () => {
  it("a side set: the cell's border, and the same edge on the cell across it; drawn by Excel in its style and colour", async () => {
    const base = await table("excel"), { a, below } = clean(base.L, base.items);
    const t = await table("excel", { [keyOf(a)]: { bottom: RED } });
    const A = t.items.find(x => keyOf(x) === keyOf(a))!, B = t.items.find(x => keyOf(x) === keyOf(below))!;
    expect(A.bottom).toEqual(RED); expect(B.top).toEqual(RED);
    expect(A.ub).toEqual({ bottom: true }); expect(B.ub).toEqual({ top: true });
    const red = lines(excelToDisplayList(t.L, t.c, M).nodes).filter(l => ink(l) === "C00000");
    expect(red.length).toBe(2);
    expect(red.every(l => l.stroke.w === 2)).toBe(true);
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
  it("a cell's own setting of that edge wins over its neighbour's", async () => {
    const base = await table("excel"), { a, below } = clean(base.L, base.items);
    const blue = { style: "thin", color: "#1F4E79" } as const;
    const t = await table("excel", { [keyOf(a)]: { bottom: RED }, [keyOf(below)]: { top: blue } });
    expect(t.items.find(x => keyOf(x) === keyOf(a))!.bottom).toEqual(RED);
    expect(t.items.find(x => keyOf(x) === keyOf(below))!.top).toEqual(blue);
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
    expect(Object.keys(A.cgrid || {})).toEqual(["bottom"]);
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
    expect(lines(rulesToDisplayList(t.L, t.c, M).nodes).filter(l => ink(l) === "C00000").length).toBe(2);
    const g0 = await table("glass"), g = await table("glass", { [keyOf(a)]: { right: RED } });
    expect(JSON.stringify(glassPlan(g.L, g.c).lines)).toBe(JSON.stringify(glassPlan(g0.L, g0.c).lines));
  });
});
