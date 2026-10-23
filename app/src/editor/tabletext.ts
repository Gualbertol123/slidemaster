/* (B56, 4.14) a table's text in one step: the font, size, colour, bold, italic and alignment of the whole table, of its
   header rows, its body rows or its totals (core render/roles.ts: the rows above the first data row are the header,
   "Total…" rows the totals) – written as the cells' own formats (cell.patch: font, sz, b, i, color, align), exactly what
   the ribbon's text controls write for selected cells, so the PDF and the PowerPoint table show it as every cell format.
   One undo step. */
import type { Item, TableLayout } from "@slide-builder/core/xlsx/types";
import type { TextFmt } from "@slide-builder/core/model/types";
import { effFmt } from "@slide-builder/core/render/edits";
import { rolesOf } from "@slide-builder/core/render/roles";
import { ctx } from "../state/app";
import { applySel } from "./edit";

export type TableScope = "all" | "header" | "body" | "total";
export const SCOPES: [TableScope, string][] = [["all", "Whole table"], ["header", "Header"], ["body", "Body"], ["total", "Totals"]];
/** the cells of a part of the table (a cell's own role, set on the slide, wins over its row's) */
export function scopeItems(T: TableLayout, scope: TableScope): Item[] {
  if (scope === "all") return T.items.slice();
  const c = ctx(), kind = rolesOf(T, c).kind;
  return T.items.filter(it => {
    const own = effFmt(c, it).role, k = own === "header" || own === "total" || own === "body" ? own : kind.get(it.b.r);
    return k === scope;
  });
}
const one = <T,>(xs: T[]): T | undefined => xs.length && xs.every(x => x === xs[0]) ? xs[0] : undefined;
const pt2px = (pt: number) => Math.round(pt * 4 / 3 * 10) / 10, px2pt = (px: number) => Math.round(px * .75 * 2) / 2;
/** what the cells show in common (unset where they differ) – sizes in slide px, as a TextFmt */
export function scopeShown(items: Item[]): TextFmt {
  const c = ctx(), fs = items.map(it => effFmt(c, it)), f: TextFmt = {};
  const font = one(fs.map(x => x.font || null)), sz = one(fs.map(x => x.sz || 0)), color = one(fs.map(x => x.color || null)), align = one(fs.map(x => x.align || null));
  if (font) f.font = font;
  if (sz) f.size = pt2px(sz);
  if (fs.length && fs.every(x => x.b)) f.b = true;
  if (fs.length && fs.every(x => x.i)) f.i = true;
  if (color) f.color = color;
  if (align === "left" || align === "center" || align === "right") f.align = align;
  return f;
}
/** the keys that differ between what was shown and what the control asks for, onto every cell (null: the formats off) */
export function applyTableText(label: string, items: Item[], prev: TextFmt, next: TextFmt | null) {
  if (!items.length) return;
  if (!next) { applySel(label, e => { for (const k of ["font", "sz", "b", "i", "color", "align"] as const) delete e[k]; }, items); return; }
  const ch = (k: keyof TextFmt) => JSON.stringify(prev[k] ?? null) !== JSON.stringify(next[k] ?? null);
  applySel(label, e => {
    if (ch("font")) { if (next.font) e.font = next.font; else delete e.font; }
    if (ch("size")) { if (next.size) e.sz = px2pt(next.size); else delete e.sz; }
    if (ch("b")) e.b = !!next.b;
    if (ch("i")) e.i = !!next.i;
    if (ch("color")) { if (next.color) e.color = next.color; else delete e.color; }
    if (ch("align")) { if (next.align) e.align = next.align; else delete e.align; }
  }, items);
}
