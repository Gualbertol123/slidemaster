/* Gridlines on selected cells (S10.3, GL-01, B20; docs/next/07 §5.2; product owner 2026-10-19: a layer of their own,
   separate from the cell borders): TableDef.cellGrid → the items' `cgrid` edges (effItems) → line nodes after every fill
   and border (Excel, Excel Refined, the consulting rules tables), hairlines of their colour in Liquid Glass. An edge where
   the cell or the cell across it has a border shows the border. */
import { describe, expect, it } from "vitest";
import { deckOf } from "./corpus-deck";
import { effItems, keyOf, CELL_LINE } from "../src/render/edits";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { glassPlan } from "../src/render/glass";
import { rulesToDisplayList } from "../src/render/consult-rules";
import { wrapLines } from "../src/text/lines";
import type { DisplayList, LineNode, Node } from "../src/dl/types";
import type { CellGrid, Design, Op } from "../src/model/types";
import type { Item, TableLayout } from "../src/xlsx/types";

const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const flat = (l: DisplayList): Node[] => l.flatMap(n => n.t === "group" ? [n, ...flat(n.children)] : [n]);
const lines = (l: DisplayList) => flat(l).filter((n): n is LineNode => n.t === "line");
const TABLE = "l4tsxhl";
const grid = (cells: Record<string, CellGrid | null>): Op => ({ op: "table.patch", id: TABLE, patch: { cellGrid: cells } } as Op);
async function table(design: Design, cells: Record<string, CellGrid | null> = {}) {
  const { ctx, slides } = await deckOf("weekly.json", design, Object.keys(cells).length ? [grid(cells)] : []);
  const L = slides.flatMap(s => s.tables).find(t => t.def?.id === TABLE)! as TableLayout, c = ctx();
  return { L, c, items: effItems(L, c) };
}
const noBorder = (it: Item) => !it.top && !it.bottom && !it.left && !it.right;
const at = (items: Item[], r: number, c: number) => items.find(it => it.b.r === r && it.b.c === c);
const single = (it: Item | undefined) => !!it && it.b.r === it.b.r2 && it.b.c === it.b.c2;
/** a 2 × 2 block of single, borderless cells whose neighbours have no borders either (a clean place to draw on) */
function cleanBlock(L: TableLayout, items: Item[]) {
  for (let i = 1; i + 2 < L.rows.length; i++) for (let j = 1; j + 2 < L.cols.length; j++) {
    const rs = L.rows.slice(i - 1, i + 3), cs = L.cols.slice(j - 1, j + 3), all = rs.flatMap(r => cs.map(c => at(items, r, c)));
    if (all.every(it => it && noBorder(it) && it.b.r === it.b.r2 && it.b.c === it.b.c2)) return { r: L.rows.slice(i, i + 2), c: L.cols.slice(j, j + 2) };
  }
  throw new Error("no clean block");
}
const lineAt = (ls: LineNode[], x1: number, y1: number, x2: number, y2: number) => ls.filter(l => Math.abs(l.x1 - x1) < .01 && Math.abs(l.y1 - y1) < .01 && Math.abs(l.x2 - x2) < .01 && Math.abs(l.y2 - y2) < .01);
const ink = (l: LineNode) => (l.stroke.paint as { solid: number[] }).solid.map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase();

describe("gridlines on selected cells: the edges (GL-01)", () => {
  it("H: the cell's top and bottom; V: its left and right; in the default grey, 1 px, after the fills and borders", async () => {
    const base = await table("excel"), blk = cleanBlock(base.L, base.items), r = blk.r[0], c = blk.c[0];
    const k = keyOf(at(base.items, r, c)!);
    for (const [g, sides] of [[{ h: "on" }, ["top", "bottom"]], [{ v: "on" }, ["left", "right"]], [{ h: "on", v: "on" }, ["top", "left", "right", "bottom"]]] as [CellGrid, string[]][]) {
      const t = await table("excel", { [k]: g }), it = at(t.items, r, c)!;
      expect(Object.keys(it.cgrid || {}).sort()).toEqual([...sides].sort());
      for (const s of sides) expect(it.cgrid![s as "top"]).toEqual({ style: "thin", color: CELL_LINE.grid, w: 1 });
      // never a border: the item's borders are as before
      expect([it.top, it.bottom, it.left, it.right]).toEqual([null, null, null, null].map((_, n) => [at(base.items, r, c)!.top, at(base.items, r, c)!.bottom, at(base.items, r, c)!.left, at(base.items, r, c)!.right][n]));
      const before = lines(excelToDisplayList(base.L, base.c, M).nodes), after = lines(excelToDisplayList(t.L, t.c, M).nodes);
      expect(after.length).toBe(before.length + sides.length);
      const { bx, by, bw, bh } = it;
      if (sides.includes("top")) expect(lineAt(after, bx, by + .5, bx + bw, by + .5)).toHaveLength(1);
      if (sides.includes("bottom")) expect(lineAt(after, bx, by + bh - .5, bx + bw, by + bh - .5)).toHaveLength(1);
      if (sides.includes("left")) expect(lineAt(after, bx + .5, by, bx + .5, by + bh)).toHaveLength(1);
      if (sides.includes("right")) expect(lineAt(after, bx + bw - .5, by, bx + bw - .5, by + bh)).toHaveLength(1);
      // drawn after every fill and border
      const all = excelToDisplayList(t.L, t.c, M).nodes, ours = all.findIndex(n => n.t === "line" && n.stroke.w === 1 && ink(n) === "BFBFBF" && (Math.abs(n.y1 - (by + .5)) < .01 || Math.abs(n.x1 - (bx + .5)) < .01) && n.x1 >= bx - .01 && n.x2 <= bx + bw + .01 && n.y1 >= by - .01 && n.y2 <= by + bh + .01);
      expect(ours).toBeGreaterThan(-1);
      expect(all.slice(0, ours).some(n => n.t === "line")).toBe(true);                    // the workbook's borders first
      const next = all.slice(ours).find(n => n.t !== "line");                             // then the cells' text, no fill
      expect(next && next.t !== "rect" && next.t !== "path").toBe(true);
    }
  });
  it("Outline: the outer edges of the rectangle only (each corner cell two sides), in the dark default", async () => {
    const base = await table("clean"), blk = cleanBlock(base.L, base.items);
    const keys = blk.r.flatMap(r => blk.c.map(c => keyOf(at(base.items, r, c)!)));
    const t = await table("clean", Object.fromEntries(keys.map(k => [k, { o: true }])));
    const sides = (r: number, c: number) => Object.keys(at(t.items, r, c)!.cgrid || {}).sort();
    expect(sides(blk.r[0], blk.c[0])).toEqual(["left", "top"]);
    expect(sides(blk.r[0], blk.c[1])).toEqual(["right", "top"]);
    expect(sides(blk.r[1], blk.c[0])).toEqual(["bottom", "left"]);
    expect(sides(blk.r[1], blk.c[1])).toEqual(["bottom", "right"]);
    expect(at(t.items, blk.r[0], blk.c[0])!.cgrid!.top!.color).toBe(CELL_LINE.outline);
    expect(lines(excelToDisplayList(t.L, t.c, M).nodes).length).toBe(lines(excelToDisplayList(base.L, base.c, M).nodes).length + 8);
  });
  it("colour and weight: the line's ink and width (weight kept within 0.5–3 px)", async () => {
    const base = await table("excel"), blk = cleanBlock(base.L, base.items), r = blk.r[0], c = blk.c[0], k = keyOf(at(base.items, r, c)!);
    const t = await table("excel", { [k]: { h: "on", c: "#C00000", w: 2 } }), it = at(t.items, r, c)!;
    const l = lineAt(lines(excelToDisplayList(t.L, t.c, M).nodes), it.bx, it.by + 1, it.bx + it.bw, it.by + 1);
    expect(l).toHaveLength(1);
    expect([l[0].stroke.w, ink(l[0])]).toEqual([2, "C00000"]);
    const big = await table("excel", { [k]: { h: "on", w: 40 } }), small = await table("excel", { [k]: { h: "on", w: .01 } });
    expect(at(big.items, r, c)!.cgrid!.top!.w).toBe(3);
    expect(at(small.items, r, c)!.cgrid!.top!.w).toBe(.5);
  });
  it("a border on that edge – the cell's own or the cell across it – shows instead of the gridline", async () => {
    const base = await table("excel");
    const withTop = base.items.find(it => it.top && !it.bottom && it.b.r === it.b.r2 && it.b.c === it.b.c2 && !base.items.some(o => o.b.r === it.b.r2 + 1 && o.b.c === it.b.c && o.top))!;
    expect(withTop).toBeTruthy();
    const k = keyOf(withTop), t = await table("excel", { [k]: { h: "on" } }), it = t.items.find(x => keyOf(x) === k)!;
    expect(Object.keys(it.cgrid || {}).sort()).toEqual(["bottom", "top"]);
    expect(Object.keys(it.cgx || {})).toEqual(["top"]);                                   // hidden where Excel draws a border
    expect(it.top).toEqual(withTop.top);
    // the cell above has a bottom border along this cell's top: also kept
    const above = base.items.find(x => x.bottom && x.b.r === x.b.r2 && x.b.c === x.b.c2 && base.items.some(o => o.b.r === x.b.r2 + 1 && o.b.c === x.b.c && o.b.c2 === x.b.c2 && !o.top && !o.bottom))!;
    if (above) {
      const below = base.items.find(o => o.b.r === above.b.r2 + 1 && o.b.c === above.b.c)!;
      const t2 = await table("excel", { [keyOf(below)]: { h: "on" } });
      expect(Object.keys(t2.items.find(x => keyOf(x) === keyOf(below))!.cgx || {})).toContain("top");
    }
  });
  it("unknown values draw nothing; the entry of another table's cell does not leak; an empty map changes nothing", async () => {
    const base = await table("excel"), blk = cleanBlock(base.L, base.items), k = keyOf(at(base.items, blk.r[0], blk.c[0])!);
    for (const g of [{ h: "off" }, { v: "x" }, { o: "yes" }, { c: "#C00000" }, {}] as unknown as CellGrid[]) {
      const t = await table("excel", { [k]: g });
      expect(t.items.some(it => it.cgrid)).toBe(false);
    }
  });
});

describe("gridlines on selected cells: the table's gridlines, shared edges", () => {
  it("over the table's gridlines \"All\": an outline in its colour is drawn (only real borders hide a cell's gridline)", async () => {
    const { ctx, slides } = await deckOf("weekly.json", "excel", [{ op: "table.patch", id: TABLE, patch: { gridH: "on", gridV: "on" } } as Op]);
    const L = slides.flatMap(s => s.tables).find(t => t.def?.id === TABLE)! as TableLayout, items = effItems(L, ctx());
    const blk = cleanBlock(L, (await table("excel")).items), keys = blk.r.flatMap(r => blk.c.map(c => keyOf(at(items, r, c)!)));
    const t = await deckOf("weekly.json", "excel", [{ op: "table.patch", id: TABLE, patch: { gridH: "on", gridV: "on", cellGrid: Object.fromEntries(keys.map(k => [k, { o: true, c: "#C00000" }])) } } as Op]);
    const L2 = t.slides.flatMap(s => s.tables).find(x => x.def?.id === TABLE)! as TableLayout;
    expect(effItems(L2, t.ctx()).some(it => it.cgx)).toBe(false);
    expect(lines(excelToDisplayList(L2, t.ctx(), M).nodes).filter(l => ink(l) === "C00000").length).toBe(8);
  });
  it("an edge two cells share is drawn once (H on two cells one above the other: three lines, not four)", async () => {
    const base = await table("excel"), blk = cleanBlock(base.L, base.items);
    const a = at(base.items, blk.r[0], blk.c[0])!, b = at(base.items, blk.r[1], blk.c[0])!;
    const t = await table("excel", { [keyOf(a)]: { h: "on" }, [keyOf(b)]: { h: "on" } });
    expect(Object.keys(at(t.items, blk.r[0], blk.c[0])!.cgrid!)).toEqual(["top"]);
    expect(Object.keys(at(t.items, blk.r[1], blk.c[0])!.cgrid!).sort()).toEqual(["bottom", "top"]);
    expect(lines(excelToDisplayList(t.L, t.c, M).nodes).length).toBe(lines(excelToDisplayList(base.L, base.c, M).nodes).length + 3);
  });
});

describe("gridlines on selected cells in the other designs", () => {
  it("where a workbook border is (Excel hides the gridline there), Liquid Glass, the rules and the cards tables draw it – they draw no workbook border", async () => {
    const base = await table("excel");
    const withTop = base.items.find(it => single(it) && it.top && !it.bottom && !it.left && !it.right && !base.items.some(o => o.b.r === it.b.r && (o.b.c2 + 1 === it.b.c || o.b.c === it.b.c2 + 1) && (o.left || o.right)))!;
    const k = keyOf(withTop);
    const g = await table("glass", { [k]: { h: "on", c: "#1F4E79" } });
    expect(glassPlan(g.L, g.c).lines.filter(l => l.k === "cell").length).toBeGreaterThanOrEqual(2);
    const r = await table("mckinsey", { [k]: { h: "on", c: "#C00000" } });
    expect(lines(rulesToDisplayList(r.L, r.c, M).nodes).filter(l => ink(l) === "C00000").length).toBe(2);
    const cards = await deckOf("weekly.json", "mckinsey", [{ op: "table.patch", id: TABLE, patch: { cellGrid: { [k]: { h: "on", c: "#C00000" } } } } as Op, { op: "style.patch", patch: { designs: { mckinsey: { consult: { tables: "cards" } } } } } as Op]);
    const L = cards.slides.flatMap(s => s.tables).find(x => x.def?.id === TABLE)!, c = cards.ctx();
    const { cardsToDisplayList } = await import("../src/render/consult-cards");
    const rects = flat(cardsToDisplayList(L, c, M).nodes).filter(n => n.t === "rect" && (n.fill as { solid?: number[] } | undefined)?.solid?.join() === "192,0,0");
    expect(rects.length).toBe(2);
  });

  it("Liquid Glass: hairlines of the cell's colour and weight on its edges, in the scene's geometry", async () => {
    const base = await table("glass"), blk = cleanBlock(base.L, base.items), k = keyOf(at(base.items, blk.r[0], blk.c[0])!);
    const t = await table("glass", { [k]: { v: "on", c: "#1F4E79", w: 2 } });
    const cell = glassPlan(t.L, t.c).lines.filter(l => l.k === "cell");
    expect(cell).toHaveLength(2);
    expect(cell.every(l => l.color === "#1F4E79" && l.w === 2)).toBe(true);
    expect(glassPlan(base.L, base.c).lines.filter(l => l.k === "cell")).toHaveLength(0);
  });
  it("the consulting rules tables draw them too", async () => {
    const base = await table("mckinsey"), blk = cleanBlock(base.L, base.items), k = keyOf(at(base.items, blk.r[0], blk.c[0])!);
    const t = await table("mckinsey", { [k]: { h: "on", c: "#C00000" } });
    const dl = rulesToDisplayList(t.L, t.c, M);
    expect(lines(dl.nodes).filter(l => ink(l) === "C00000").length).toBeGreaterThanOrEqual(2);
  });
  it("a version that removes the cell keeps its gridlines (VR-02: versions keep borders)", async () => {
    const base = await table("excel"), blk = cleanBlock(base.L, base.items), it0 = at(base.items, blk.r[0], blk.c[0])!, k = keyOf(it0);
    const { ctx, slides } = await deckOf("weekly.json", "excel", [grid({ [k]: { h: "on" } })]);
    const L = slides.flatMap(s => s.tables).find(t => t.def?.id === TABLE)!;
    const c = { ...ctx(), version: { id: "v", name: "V", hide: { [L.sheet.name]: [k + ":" + k] } } };
    const it = effItems(L, c).find(x => keyOf(x) === k)!;
    expect([it.removed, Object.keys(it.cgrid || {}).sort()]).toEqual([true, ["bottom", "top"]]);
  });
});
