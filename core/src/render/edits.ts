/* Cell edits applied on top of the workbook: text (only while the Excel value is unchanged),
   size, bold, italic, colours, alignment, role. */
import { A1, parseRange, splitRef } from "../xlsx/util";
import { evalCF } from "../xlsx/layout";
import type { Dxf } from "../xlsx/types";
import type { BorderSide, Item, TableLayout } from "../xlsx/types";
import type { CellEdit } from "../model/types";
import { isNumText, tableKey, type RenderCtx } from "./context";
import { applyScales } from "./scales";
import { formatValue } from "../xlsx/numfmt";
import { validNum } from "./numdisplay";

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
/* gridlines on selected cells (4.4, B20, 07 §5.2; product owner 2026-10-19: a layer of their own, not the cell borders): a
   cell's h / v draw on its own edges, o on the edges where the next cell is not outlined (the outline of a rectangle);
   an edge where the cell, or the cell across it, has a border shows the border, not the gridline */
export const CELL_LINE = { grid: "#BFBFBF", outline: "#404040" };
type Edge = "top" | "left" | "right" | "bottom";
const ACROSS: Record<Edge, Edge> = { top: "bottom", bottom: "top", left: "right", right: "left" };
const EDGES: Edge[] = ["top", "left", "right", "bottom"];
const isHex = (c: unknown): c is string => typeof c === "string" && /^#[0-9A-Fa-f]{6}$/.test(c);
/** the cells across one side of a cell, in the table's grid (a merged cell: every cell along that side) */
function acrossOf(L: TableLayout, items: Item[]) {
  const ri = new Map(L.rows.map((r, k) => [r, k])), ci = new Map(L.cols.map((c, k) => [c, k])), at = new Map<string, Item>();
  for (const it of items) for (let r = ri.get(it.b.r) ?? -1, r2 = ri.get(it.b.r2) ?? -1; r >= 0 && r <= r2; r++) for (let c = ci.get(it.b.c) ?? -1, c2 = ci.get(it.b.c2) ?? -1; c >= 0 && c <= c2; c++) at.set(r + "," + c, it);
  return (it: Item, side: Edge): Item[] => {
    const r0 = ri.get(it.b.r), r1 = ri.get(it.b.r2), c0 = ci.get(it.b.c), c1 = ci.get(it.b.c2), out = new Set<Item>();
    if (r0 === undefined || r1 === undefined || c0 === undefined || c1 === undefined) return [];
    if (side === "top" || side === "bottom") { const r = side === "top" ? r0 - 1 : r1 + 1; for (let c = c0; c <= c1; c++) { const o = at.get(r + "," + c); if (o) out.add(o); } }
    else { const c = side === "left" ? c0 - 1 : c1 + 1; for (let r = r0; r <= r1; r++) { const o = at.get(r + "," + c); if (o) out.add(o); } }
    return [...out];
  };
}
/** a table map's entry of a cell (an own key, an object) */
function entryOf<T>(map: Record<string, T>, it: Item): T | null { const k = keyOf(it), e = Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; return e && typeof e === "object" ? e : null; }
/* cell borders on the slide (4.4, B28; product owner 2026-10-19: Borders ▾ as Excel's, separate from the gridlines): a
   cell's side set to a style and a colour, or "none"; the cell across that side draws the same edge (its coincident side
   takes the same value unless it sets that side itself). The workbook is never changed */
const BSTYLES = ["thin", "medium", "thick", "dashed", "dotted", "double"];
export function withBorders(L: TableLayout, items: Item[]): Item[] {
  const g = L.def?.borders; if (!g || typeof g !== "object" || !Object.keys(g).length) return items;
  const across = acrossOf(L, items), own = new Map<Item, Partial<Record<Edge, BorderSide | null>>>();
  for (const it of items) {
    const e = entryOf(g, it); if (!e) continue;
    const m: Partial<Record<Edge, BorderSide | null>> = {};
    for (const side of EDGES) {
      const v = (e as Record<string, unknown>)[side] as { style?: unknown; color?: unknown } | "none" | undefined;
      if (v === "none") m[side] = null;
      else if (v && typeof v === "object" && BSTYLES.includes(v.style as string) && isHex(v.color)) m[side] = { style: v.style as string, color: v.color };
    }
    if (Object.keys(m).length) own.set(it, m);
  }
  if (!own.size) return items;
  // as in the workbook's model (xlsx/layout.ts), an inside edge belongs to one cell – the lower one's top, the right one's
  // left – and a bottom / right is drawn only at the table's edge: a side set on the slide is moved to that owner (the
  // owner's own setting of it wins), and the other cell's facing side is cleared
  const out = new Map<Item, Partial<Record<Edge, BorderSide | null>>>();
  const put = (it: Item, side: Edge, v: BorderSide | null) => out.set(it, { ...out.get(it), [side]: v });
  // "none" removes a border, never the table's own gridline (a layer of its own)
  const keep = (it: Item, side: Edge) => it[side] === GRIDLINE;
  for (const [it, m] of own) for (const side of ["bottom", "right"] as Edge[]) {
    if (!(side in m)) continue;
    const v = m[side]!, n = across(it, side);
    if (!n.length) { if (v || !keep(it, side)) put(it, side, v); continue; }
    if (!keep(it, side)) put(it, side, null);
    for (const o of n) if (!(own.get(o) && ACROSS[side] in own.get(o)!) && (v || !keep(o, ACROSS[side]))) put(o, ACROSS[side], v);
  }
  for (const [it, m] of own) for (const side of ["top", "left"] as Edge[]) {
    if (!(side in m)) continue;
    const v = m[side]!;
    if (v || !keep(it, side)) put(it, side, v);
    for (const o of across(it, side)) if (!keep(o, ACROSS[side])) put(o, ACROSS[side], null);
  }
  return items.map(it => {
    const m = out.get(it); if (!m) return it;
    const ub: NonNullable<Item["ub"]> = {};
    for (const [side, b] of Object.entries(m) as [Edge, BorderSide | null][]) if (b) ub[side] = true;
    // (Liquid Glass reads the workbook's sides to find its frames and grids: `wb` keeps them – it draws no borders)
    return Object.assign({}, it, m, { wb: { top: it.top, left: it.left, right: it.right, bottom: it.bottom } }, Object.keys(ub).length ? { ub } : {});
  });
}
export function withCellGrid(L: TableLayout, items: Item[]): Item[] {
  const g = L.def?.cellGrid; if (!g || typeof g !== "object" || !Object.keys(g).length) return items;
  const across = acrossOf(L, items), entry = (it: Item) => entryOf(g, it);
  const want = new Map<Item, NonNullable<Item["cgrid"]>>();
  for (const it of items) {
    const e = entry(it); if (!e) continue;
    const w = typeof e.w === "number" && Number.isFinite(e.w) ? Math.max(.5, Math.min(3, e.w)) : 1;
    const line = (outline: boolean): BorderSide => ({ style: "thin", color: isHex(e.c) ? e.c : outline ? CELL_LINE.outline : CELL_LINE.grid, w });
    const cg: NonNullable<Item["cgrid"]> = {};
    if (e.h === "on") cg.top = cg.bottom = line(false);
    if (e.v === "on") cg.left = cg.right = line(false);
    if (e.o === true) for (const side of EDGES) { const n = across(it, side); if (!n.length || n.some(o => entry(o)?.o !== true)) cg[side] = line(true); }
    if (Object.keys(cg).length) want.set(it, cg);
  }
  // a border the design draws on that edge (the workbook's or one set on the slide – not the table's own gridlines, which
  // a cell's gridline is drawn over), the cell's or the one across it's
  const real = (b: BorderSide | null | undefined) => !!b && b !== GRIDLINE;
  return items.map(it => {
    const cg0 = want.get(it); if (!cg0) return it;
    const cg: NonNullable<Item["cgrid"]> = {}, cgx: NonNullable<Item["cgx"]> = {}, cgu: NonNullable<Item["cgu"]> = {};
    for (const side of EDGES) {
      const b = cg0[side]; if (!b) continue;
      // each edge once: the cell below / right draws its top / left when it has one
      if (side === "bottom" || side === "right") { const n = across(it, side); if (n.length && n.every(o => want.get(o)?.[ACROSS[side]])) continue; }
      cg[side] = b;
      if (real(it[side]) || across(it, side).some(o => real(o[ACROSS[side]]))) cgx[side] = true;
      if (it.ub?.[side] || across(it, side).some(o => o.ub?.[ACROSS[side]])) cgu[side] = true;
    }
    return Object.keys(cg).length ? Object.assign({}, it, { cgrid: cg }, Object.keys(cgx).length ? { cgx } : {}, Object.keys(cgu).length ? { cgu } : {}) : it;
  });
}
/** cells removed in a version: drawn completely empty (no value, no colour, no highlight) – borders stay */
function removedCell(it: Item): Item {
  return { ...it, text: "", fill: null, baseFill: null, cf: null, scaleFill: undefined, scaleInk: undefined, userFill: undefined, userBg: undefined, scripts: undefined, removed: true };
}
export function effItems(L: TableLayout, ctx: RenderCtx): Item[] {
  // the user's borders before the gridlines (a gridline shows only where no border is)
  return cache(L, "eff", tableKey(ctx, L), () => withCellGrid(L, withBorders(L, effBase(L, ctx))));
}
function effBase(L: TableLayout, ctx: RenderCtx): Item[] {
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
    // 4.9 (S16.3): the vertical position (Excel's words: "center"; `userVAlign`: set on the slide – Liquid Glass then
    // draws a bottom one at the bottom, its own being centred) and the number display (a number's text, its [colour])
    if (e.valign && VALIGN[e.valign]) { o.valign = VALIGN[e.valign]; o.userVAlign = o.valign; }
    if (validNum(e.num) && !o.edited) numDisplay(L, it, o, e.num);
    if (e.role) o.role = e.role;
    // colour scales sit under explicit user colours
    if (sc && sc.fill && !e.fill) { o.fill = sc.fill; o.scaleFill = sc.fill; }
    if (sc && sc.ink && !e.color) { o.color = sc.ink; o.scaleInk = sc.ink; o.nfColor = null; }
    return o;
  });
}
const VALIGN: Record<string, string> = { top: "top", middle: "center", bottom: "bottom" };
/** where a cell's text is drawn in `design`, in the ribbon's words (null: none of the three – justify / distributed outside
    Liquid Glass). `it`: the layout's item, or effBase's (its `userVAlign`). Liquid Glass centres everything but a top –
    and a bottom set on the slide – so a workbook's bottom (Excel's default) is drawn in the middle there (S16.3 review, 1) */
export function drawnVAlign(design: string, it: Pick<Item, "valign" | "userVAlign">): "top" | "middle" | "bottom" | null {
  const v = it.userVAlign || it.valign;
  if (design === "glass") return v === "top" ? "top" : it.userVAlign === "bottom" ? "bottom" : "middle";
  return v === "top" ? "top" : v === "center" ? "middle" : v === "bottom" ? "bottom" : null;
}
/** a number shown with the cell's own format code (CellEdit.num): its text, and the code's [colour] unless a colour was set */
function numDisplay(L: TableLayout, it: Item, o: Item, num: string) {
  const cell = L.sheet.get(it.b.src.r, it.b.src.c); if (!cell || (cell.t !== "n" && cell.t !== "d")) return;
  let f: { text: string; color?: string | null };
  try { f = formatValue({ v: cell.v, t: cell.t, fmt: num }); } catch { return; }
  o.text = f.text; o.nfColor = f.color || null;
  if (!o.userColor) o.color = o.nfColor || o.font.color || "#000000";
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
    color: e.color || null, fill: e.fill || null, bg: e.bg || null, align: e.align || null, role: e.role || "auto", valign: e.valign || null, num: e.num || null };
}
