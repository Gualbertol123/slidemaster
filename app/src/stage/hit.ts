/* Hit testing on the stage (PLAN S4.1): a table's place on the slide comes from its display-list layer (the "tw"
   hit: where the worker drew it), the cell under the pointer from v3's binary search over the column and row
   edges (cellFromPoint) – every cell, empty ones too (the display list has hit nodes for drawn text only). Liquid
   Glass widens columns: its edges are the glass geometry's. */
import type { Item, TableLayout } from "@slide-builder/core/xlsx/types";
import { glassGeom, gItem } from "@slide-builder/core/render/glass";
import { tableW } from "@slide-builder/core/render/layout";
import type { RenderCtx } from "@slide-builder/core/render/context";
import { itemAt } from "../editor/edit";

/** [start, size, key] of a column or row */
export type Edge = [number, number, number];
const cacheOf = (T: TableLayout) => (T._cache || (T._cache = {})) as Record<string, unknown>;
export function colEdges(T: TableLayout, c: RenderCtx): Edge[] {
  const glassy = c.style.design === "glass", G = glassy ? glassGeom(T, c) : null, key = glassy ? "g" + G!.key : "x";
  const cache = cacheOf(T), hit = cache.ce as { key: string; list: Edge[] } | undefined;
  if (hit && hit.key === key) return hit.list;
  const list = T.cols.map(col => (glassy ? [G!.X.get(col)!, G!.Wc.get(col)!, col] : [T.colX.get(col)!, T.colW.get(col)!, col]) as Edge);
  cache.ce = { key, list }; return list;
}
export function rowEdges(T: TableLayout): Edge[] {
  const cache = cacheOf(T);
  return (cache.re || (cache.re = T.rows.map(r => [T.rowY.get(r)!, T.rowH.get(r)!, r]))) as Edge[];
}
function bsearch(list: Edge[], v: number): Edge | undefined { let lo = 0, hi = list.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (list[m][0] <= v) lo = m; else hi = m - 1; } return list[lo]; }
/** the item at a point in table px */
export function cellFromPoint(T: TableLayout, c: RenderCtx, lx: number, ly: number): Item | null {
  const col = bsearch(colEdges(T, c), lx), row = bsearch(rowEdges(T), ly);
  if (!col || !row) return null;
  return itemAt(T, row[2], col[2]) || null;
}
/** a cell's box on screen in table px (Liquid Glass widens columns) */
export function cellBox(it: Item, c: RenderCtx): Item { return c.style.design !== "glass" || !it.L ? it : gItem(it, glassGeom(it.L, c)); }

/** a column or row border near a point (within 4 screen px): dragging it sets the width / height */
export interface Border { kind: "col" | "row"; key: number; start: number; size: number; pos: number }
export function borderAt(T: TableLayout, c: RenderCtx, lx: number, ly: number, k: number): Border | null {
  const tol = 4 / k;
  let best: Border | null = null, bd = tol;
  for (const [x0, w, col] of colEdges(T, c)) { const d = Math.abs(lx - (x0 + w)); if (d <= bd && ly >= 0 && ly <= T.H) { bd = d; best = { kind: "col", key: col, start: x0, size: w, pos: x0 + w }; } }
  for (const [y0, hh, r] of rowEdges(T)) { const d = Math.abs(ly - (y0 + hh)); if (d < bd) { bd = d; best = { kind: "row", key: r, start: y0, size: hh, pos: y0 + hh }; } }
  return best;
}
/** a point on screen in a table's px: its overlay element (.hits) is the table's box on screen */
export function tablePoint(el: HTMLElement, T: TableLayout, c: RenderCtx, e: { clientX: number; clientY: number }) {
  const rc = el.getBoundingClientRect(), k = rc.width / tableW(T, c);
  return { lx: (e.clientX - rc.left) / k, ly: (e.clientY - rc.top) / k, k };
}
