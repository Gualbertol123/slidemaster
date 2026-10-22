/* Excel's data bars and icons on a slide (S16.4, B39; 09 §3.10, Q15): display-list nodes for the cells that have them
   (Item.cfBar / cfIcon, xlsx/cf.ts), drawn by every design after its cell fills and before its texts:
   - a data bar is a rect inside the cell from the axis to the value (Excel insets it 2 px), a gradient to 10 % alpha
     (Excel 2010's gradient bars) or solid, its border, the axis a dotted line; Liquid Glass draws it as a capsule
     (r = h / 2), the consulting designs as a hairline bar under the value in their pos / neg colours;
   - an icon is its parts (render/cf-icons.ts) as paths left in the cell, in the design's tones.
   A hit of kind "cf" (id "bar" / "icon") goes before each node: the stage ignores it (svg.ts stageHits), PowerPoint
   uses it to put bars under the table and icons over it (pptx/scene.ts). */
import type { Node } from "../dl/types";
import type { Item, TableLayout } from "../xlsx/types";
import type { TableDL } from "./excel-dl";
import { effItems } from "./edits";
import { parseColor, solid } from "../dl/color";
import { cfIcon, cfTones, EXCEL_TONES, type CFTone } from "./cf-icons";
import { isConsult } from "../model/designs";
import { specOf } from "./consult-spec";
import type { RenderCtx } from "./context";

export interface CFLook {
  /** the icons' colours by tone (cf-icons.ts EXCEL_TONES, or cfTones of the design's colours) */
  tones: Record<CFTone, string>;
  /** bars as capsules (Liquid Glass), or thin bars under the value (the consulting designs) */
  shape?: "capsule" | "thin";
  /** bar colours instead of the workbook's (the consulting designs) */
  barPos?: string; barNeg?: string;
}
type Box = { x: number; y: number; w: number; h: number };
const r2 = (v: number) => Math.round(v * 100) / 100;
/** an icon's size in a cell: as Excel, from the cell's font (16 px at 11 pt), at most the row's height less 2 px */
export const cfIconSize = (it: Item) => Math.max(6, Math.min(it.bh - 2, Math.round((it.font.sz || 11) * 96 / 72 * 1.09)));
/** the room an icon takes before a left-aligned text (excel-dl cellText) */
export const cfIconRoom = (it: Item) => it.cfIcon && it.align !== "right" && it.align !== "center" ? cfIconSize(it) + 2 : 0;
const mark = (id: "bar" | "icon", b: Box): Node => ({ t: "hit", kind: "cf", id, x: r2(b.x), y: r2(b.y), w: r2(b.w), h: r2(b.h) });

/** a design's look of the bars and icons (Q15, answered as proposed: in each design's colours): Excel and Excel Refined
    as Excel; Liquid Glass capsules and its green / amber / red (the deck's own good / bad colours when set); the
    consulting designs thin bars and icons in their pos / neg colours */
export function cfLookOf(ctx: RenderCtx): CFLook {
  const d = ctx.style.design, o = ctx.style.colors || {};
  if (d === "glass") return { tones: cfTones({ pos: o.pos || "#34C759", neg: o.neg || "#FF3B30", mid: "#FF9F0A" }), shape: "capsule" };
  if (isConsult(d)) { const S = specOf(ctx); return { tones: cfTones({ pos: S.pos, neg: S.neg, mid: "#F2A900", rate: S.accent }), shape: "thin", barPos: S.accent, barNeg: S.neg }; }
  return { tones: EXCEL_TONES };
}

/** the bars and icons of the items; boxOf: where a design draws a cell (default: its box in the table) */
export function cfNodes(items: Item[], look: CFLook, boxOf?: (it: Item) => Box | null): Node[] {
  const out: Node[] = [];
  for (const it of items) {
    if ((!it.cfBar && !it.cfIcon) || it.removed) continue;
    const B = boxOf ? boxOf(it) : { x: it.bx, y: it.by, w: it.bw, h: it.bh };
    if (!B || B.w <= 4 || B.h <= 2) continue;
    if (it.cfBar) out.push(...barNodes(it, B, look));
    if (it.cfIcon) out.push(...iconNodes(it, B, look));
  }
  return out;
}
/** a table drawn on a geometry of its own (the consulting designs: exhibit, cards, rules): the bars and icons at the cells'
    hit boxes (kind "t", id "r,c"), after everything (thin bars lie under the values' text, icons left of it) */
export function cfOver(dl: TableDL, L: TableLayout, ctx: RenderCtx): TableDL {
  const items = effItems(L, ctx);
  if (!items.some(it => it.cfBar || it.cfIcon)) return dl;
  const boxes = new Map<string, Box>();
  const walk = (ns: Node[]) => { for (const n of ns) { if (n.t === "hit" && n.kind === "t" && !boxes.has(n.id)) boxes.set(n.id, n); else if (n.t === "group" && !n.transform) walk(n.children); } };
  walk(dl.nodes);
  // a cell drawn without a hit (its value hidden: icons only) takes its column's and its row's place from the others
  const cols = new Map<string, Box>(), rows = new Map<string, Box>();
  for (const [id, b] of boxes) { const [r, c] = id.split(","); if (!cols.has(c)) cols.set(c, b); if (!rows.has(r)) rows.set(r, b); }
  const boxOf = (it: Item): Box | null => {
    const b = boxes.get(it.b.r + "," + it.b.c); if (b) return b;
    const c = cols.get(String(it.b.c)), r = rows.get(String(it.b.r));
    return it.cfHide && c && r ? { x: c.x, y: r.y, w: c.w, h: r.h } : null;
  };
  return { ...dl, nodes: [...dl.nodes, ...cfNodes(items, cfLookOf(ctx), boxOf)] };
}
function barNodes(it: Item, B: Box, look: CFLook): Node[] {
  const b = it.cfBar!, W = B.w - 4, x0 = B.x + 2, out: Node[] = [];
  const thin = look.shape === "thin", h = thin ? 2 : Math.max(1, B.h - 4), y = thin ? B.y + B.h - 3 : B.y + 2;
  const x = x0 + b.from * W, w = (b.to - b.from) * W;
  const color = b.neg ? look.barNeg || b.fill : look.barPos || b.fill;
  if (w > .2) {
    const box = { x: r2(x), y: r2(y), w: r2(w), h: r2(h) };
    const { c } = parseColor(color);
    // gradient: the colour at the axis side, 10 % alpha at the far end (a negative bar runs the other way)
    const fill = b.gradient && !thin ? { linear: (b.neg ? [1, 0, 0, 0] : [0, 0, 1, 0]) as [number, number, number, number], stops: [{ o: 0, c, a: 1 }, { o: 1, c, a: .1 }] } : solid(color);
    const r = look.shape === "capsule" ? r2(h / 2) : undefined;
    out.push(mark("bar", box), { t: "rect", ...box, ...(r ? { r: Math.min(r, box.w / 2) } : {}), fill });
    if (b.border && !thin && w > 1) out.push(mark("bar", box), { t: "rect", x: r2(x + .5), y: r2(y + .5), w: r2(w - 1), h: r2(h - 1), ...(r ? { r: Math.max(0, Math.min(r, box.w / 2) - .5) } : {}), stroke: { w: 1, paint: solid(look.barNeg && b.neg ? look.barNeg : look.barPos || b.border) } });
  }
  if (b.axis !== null && !thin) {
    const ax = r2(x0 + b.axis * W);
    out.push(mark("bar", { x: ax, y: B.y + 1, w: 0, h: B.h - 2 }), { t: "line", x1: ax, y1: r2(B.y + 1), x2: ax, y2: r2(B.y + B.h - 1), stroke: { w: 1, paint: solid(b.axisColor), dash: [1, 1] } });
  }
  return out;
}
function iconNodes(it: Item, B: Box, look: CFLook): Node[] {
  const parts = cfIcon(it.cfIcon!.set, it.cfIcon!.i); if (!parts) return [];
  const s = Math.min(cfIconSize(it), B.h - 2), k = s / 16, x = B.x + 2;
  const y = it.valign === "top" ? B.y + 1 : it.valign === "center" ? B.y + (B.h - s) / 2 : B.y + B.h - s - 1;
  const out: Node[] = [];
  for (const p of parts) {
    const d = p.d.map(cmd => cmd[0] === "Z" ? cmd : [cmd[0], ...(cmd.slice(1) as number[]).map((v, j) => r2(j % 2 ? y + v * k : x + v * k))] as typeof cmd);
    out.push(mark("icon", { x, y, w: s, h: s }), { t: "path", d, fill: solid(look.tones[p.tone]) });
  }
  return out;
}
