/* Cell edits applied on top of the workbook: text (only while the Excel value is unchanged),
   size, bold, italic, colours, alignment, role. */
import { A1, parseRange, splitRef } from "../xlsx/util";
import { evalCF } from "../xlsx/layout";
import type { Dxf } from "../xlsx/types";
import type { BorderSide, Item, TableLayout } from "../xlsx/types";
import type { CellEdit } from "../model/types";
import { isNumText, tableKey, type RenderCtx } from "./context";
import { applyScales } from "./scales";

export const keyOf = (it: Item) => A1(it.b.src.r, it.b.src.c);
export function cache<T>(L: TableLayout, name: string, key: string, make: () => T): T {
  const c = L._cache || (L._cache = {});
  const hit = c[name] as { key: string; v: T } | undefined;
  if (hit && hit.key === key) return hit.v;
  const v = make(); c[name] = { key, v }; return v;
}
/** gridlines of the table: "on" = a thin line at every row (H) / column (V) edge, "off" = none */
export const GRIDLINE: BorderSide = { style: "thin", color: "#BFBFBF" };
function withGrid(L: TableLayout, it: Item): Item {
  const gh = L.def?.gridH, gv = L.def?.gridV; if (!gh && !gv) return it;
  const o: Item = Object.assign({}, it), lastR = L.rows[L.rows.length - 1], lastC = L.cols[L.cols.length - 1];
  // like the workbook borders: every cell draws its top/left edge, the last row/column also its bottom/right
  if (gh === "off") { o.top = null; o.bottom = null; } else if (gh === "on") { o.top = GRIDLINE; o.bottom = it.b.r2 >= lastR ? GRIDLINE : null; }
  if (gv === "off") { o.left = null; o.right = null; } else if (gv === "on") { o.left = GRIDLINE; o.right = it.b.c2 >= lastC ? GRIDLINE : null; }
  return o;
}
/** cells removed in a version: drawn completely empty (no value, no colour, no highlight) – borders stay */
function removedCell(it: Item): Item {
  return { ...it, text: "", fill: null, baseFill: null, cf: null, scaleFill: undefined, scaleInk: undefined, userFill: undefined, userBg: undefined, scripts: undefined, removed: true };
}
export function effItems(L: TableLayout, ctx: RenderCtx): Item[] {
  return cache(L, "eff", tableKey(ctx, L), () => {
    const cells = ctx.edits[L.sheet.name] || {};
    const scaled = applyScales(L, L.def?.scales);
    const cut = (ctx.version?.hide[L.sheet.name] || []).map(parseRange);
    const isCut = (it: Item) => cut.some(g => it.b.src.r >= g.r1 && it.b.src.r <= g.r2 && it.b.src.c >= g.c1 && it.b.src.c <= g.c2);
    return L.items.map(it0 => cut.length && isCut(it0) ? removedCell(it0) : it0).map(it0 => {
      if (it0.removed) return it0;
      const it = withGrid(L, it0);
      const e = cells[keyOf(it)], sc = scaled.get(it0);
      if (!e && !sc) return it;
      if (!e) {
        const o: Item = Object.assign({}, it);
        if (sc!.fill) { o.fill = sc!.fill; o.scaleFill = sc!.fill; }
        if (sc!.ink) { o.color = sc!.ink; o.scaleInk = sc!.ink; o.nfColor = null; }
        return o;
      }
      const o: Item = Object.assign({}, it); o.font = Object.assign({}, it.font);
      // painted conditional formatting: the workbook's own rules are replaced by those of the source cell
      if (e.cf !== undefined) {
        const dxf = e.cf === "none" ? null : paintedCF(ctx, L, it, e.cf);
        o.cf = dxf; o.fill = it.baseFill; o.font.color = it.baseColor || o.font.color; o.color = it.nfColor || it.baseColor || "#000000";
        if (dxf) { if (dxf.fill) o.fill = dxf.fill; if (dxf.color) { o.font.color = dxf.color; o.color = it.nfColor || dxf.color; } if (dxf.b !== undefined) o.font.b = dxf.b; if (dxf.i !== undefined) o.font.i = dxf.i; }
      }
      if (e.text !== undefined && e.orig === it.text) { o.text = e.text; o.edited = true; if (!it.text && o.text) { o.isText = !isNumText(o.text); o.ctype = o.isText ? "s" : "n"; } }
      if (e.font) { o.font.name = e.font; o.userFont = e.font; }
      if (e.sz) o.font.sz = e.sz;
      if (e.b !== undefined) { o.font.b = e.b; o.userB = e.b; }
      if (e.i !== undefined) { o.font.i = e.i; o.userI = e.i; }
      if (e.color) { o.userColor = e.color; o.color = e.color; o.nfColor = null; }
      // cell colour: replaces the Excel colour (the block colour in Liquid Glass); conditional formats stay on top
      if (e.bg) { const bg = e.bg === "none" ? null : e.bg; o.baseFill = bg; o.userBg = e.bg; if (!(o.cf && o.cf.fill)) o.fill = bg; }
      if (e.fill) { if (e.fill === "none") { o.fill = null; o.cf = null; o.baseFill = null; o.noFill = true; } else { o.fill = e.fill; o.userFill = e.fill; } }
      if (e.align) o.align = e.align;
      if (e.role) o.role = e.role;
      // colour scales sit under explicit user colours
      if (sc && sc.fill && !e.fill) { o.fill = sc.fill; o.scaleFill = sc.fill; }
      if (sc && sc.ink && !e.color) { o.color = sc.ink; o.scaleInk = sc.ink; o.nfColor = null; }
      return o;
    });
  });
}
/** "Sheet!C6": the conditional-format rules covering that cell, applied to this cell */
function paintedCF(ctx: RenderCtx, L: TableLayout, it: Item, ref: string): Dxf | null {
  const k = ref.lastIndexOf("!"), name = ref.slice(0, k), at = splitRef(ref.slice(k + 1));
  const S = name === L.sheet.name ? L.sheet : ctx.sheet?.(name) || null;
  return S && at ? evalCF(L.sheet, it.b.src.r, it.b.src.c, { S, r: at.r, c: at.c }) : null;
}
export function cellEditOf(ctx: RenderCtx, it: Item): CellEdit { return (ctx.edits[it.L!.sheet.name] || {})[keyOf(it)] || {}; }
export function effText(ctx: RenderCtx, it: Item): string { const e = cellEditOf(ctx, it); return e.text !== undefined && e.orig === it.text ? e.text : it.text; }
export function effFmt(ctx: RenderCtx, it: Item) {
  const e = cellEditOf(ctx, it);
  return { font: e.font || null, sz: e.sz || it.font.sz || 11, b: e.b !== undefined ? e.b : !!it.font.b, i: e.i !== undefined ? e.i : !!it.font.i,
    color: e.color || null, fill: e.fill || null, bg: e.bg || null, align: e.align || null, role: e.role || "auto" };
}
