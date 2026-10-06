/* Cell edits applied on top of the workbook: text (only while the Excel value is unchanged),
   size, bold, italic, colours, alignment, role. */
import { A1 } from "../xlsx/util";
import type { Item, TableLayout } from "../xlsx/types";
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
export function effItems(L: TableLayout, ctx: RenderCtx): Item[] {
  return cache(L, "eff", tableKey(ctx, L), () => {
    const cells = ctx.edits[L.sheet.name] || {};
    const scaled = applyScales(L, L.def?.scales);
    return L.items.map(it => {
      const e = cells[keyOf(it)], sc = scaled.get(it);
      if (!e && !sc) return it;
      if (!e) {
        const o: Item = Object.assign({}, it);
        if (sc!.fill) { o.fill = sc!.fill; o.scaleFill = sc!.fill; }
        if (sc!.ink) { o.color = sc!.ink; o.scaleInk = sc!.ink; o.nfColor = null; }
        return o;
      }
      const o: Item = Object.assign({}, it); o.font = Object.assign({}, it.font);
      if (e.text !== undefined && e.orig === it.text) { o.text = e.text; o.edited = true; if (!it.text && o.text) { o.isText = !isNumText(o.text); o.ctype = o.isText ? "s" : "n"; } }
      if (e.sz) o.font.sz = e.sz;
      if (e.b !== undefined) { o.font.b = e.b; o.userB = e.b; }
      if (e.i !== undefined) { o.font.i = e.i; o.userI = e.i; }
      if (e.color) { o.userColor = e.color; o.color = e.color; o.nfColor = null; }
      // cell colour: replaces the Excel colour (the block colour in Liquid Glass); conditional formats stay on top
      if (e.bg) { const bg = e.bg === "none" ? null : e.bg; o.baseFill = bg; o.userBg = e.bg; if (!(it.cf && it.cf.fill)) o.fill = bg; }
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
export function cellEditOf(ctx: RenderCtx, it: Item): CellEdit { return (ctx.edits[it.L!.sheet.name] || {})[keyOf(it)] || {}; }
export function effText(ctx: RenderCtx, it: Item): string { const e = cellEditOf(ctx, it); return e.text !== undefined && e.orig === it.text ? e.text : it.text; }
export function effFmt(ctx: RenderCtx, it: Item) {
  const e = cellEditOf(ctx, it);
  return { sz: e.sz || it.font.sz || 11, b: e.b !== undefined ? e.b : !!it.font.b, i: e.i !== undefined ? e.i : !!it.font.i,
    color: e.color || null, fill: e.fill || null, bg: e.bg || null, align: e.align || null, role: e.role || "auto" };
}
