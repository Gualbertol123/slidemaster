/* Callouts on slides (4.3, B17; docs/next/07 §3, ADR-015): a shape item – rect, round, circle, pill (`rect` nodes with
   radii; a circle in a box that is not square is an ellipse `path`), arrow and bubble (`path`), or one of the built-in
   icons (icons.ts) – with a fill, a border and the design's material when no fill is set: Liquid Glass's glass (glassBox,
   as its text-box bubbles), Excel's white box with a grey frame, Excel Refined's card with its soft shadow, the consulting
   designs' card tint (Consulting Navy / Red: a circle is an outline in the accent, 08's callout hooks). Its text is laid
   out by the text-box renderer (slide-dl.ts noteNodes) after the cell references in it – {Sheet!C7}, {'Sheet name'!C7},
   {[Peers.xlsx]Peer!F7} – are replaced by the cells' texts as the workbook shows them (formatValue with the cell's number
   format; a cell edit's text; the scenario's overlay, read through ctx.sheet() like the tables); a reference to a sheet
   or cell that cannot be read shows #REF and gives the Issues line. Pure. */
import type { Box, ShapeItem } from "../model/types";
import type { Node, Paint, PathCmd, RGB } from "../dl/types";
import type { RenderCtx } from "./context";
import { glassBox, type GlassVars, type Wallpaper } from "./glass-dl";
import { formatValue } from "../xlsx/numfmt";
import { editedCellText } from "../xlsx/cf";
import { A1, colToNum, parseRange } from "../xlsx/util";
import { CELL_TOKEN, tokenSheet } from "../model/preset";
import { consultOptions, isConsult } from "../model/designs";
import { specOf } from "./consult-spec";
import { ISP } from "./isp";
import { parseColor, solid } from "../dl/color";
import { ICONS, iconCmds } from "./icons";

const r2 = (v: number) => Math.round(v * 100) / 100 || 0;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const KAPPA = 0.5523;

/* ---- cell references ---- */
/** the text with every {Sheet!C7} replaced by what the cell shows; the references that could not be read */
export function calloutText(text: string, ctx: RenderCtx): { text: string; missing: string[] } {
  const missing: string[] = [];
  const out = text.replace(new RegExp(CELL_TOKEN.source, "g"), (_m, sh: string, col: string, row: string) => {
    const name = tokenSheet(sh), S = ctx.sheet?.(name) ?? null, r = +row, c = colToNum(col);
    if (!S || c < 1 || c > 16384 || r < 1 || r > 1048576) { missing.push(name + "!" + col + row); return "#REF"; }
    // a cell the version shown removes is empty, as in its tables and charts
    if ((ctx.version?.hide[S.name] || []).some(g => { const x = parseRange(g); return r >= x.r1 && r <= x.r2 && c >= x.c1 && c <= x.c2; })) return "";
    const cell = S.get(r, c), t = cell ? formatValue(cell).text : "";
    const e = ctx.edits[S.name]?.[A1(r, c)];
    return editedCellText(S, r, c, t, e);
  });
  return { text: out, missing };
}

/* ---- outlines ---- */
/** an ellipse in a box: four cubics */
export function ellipseCmds(x: number, y: number, w: number, h: number): PathCmd[] {
  const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2, kx = rx * KAPPA, ky = ry * KAPPA;
  return [["M", r2(cx), r2(y)], ["C", r2(cx + kx), r2(y), r2(x + w), r2(cy - ky), r2(x + w), r2(cy)], ["C", r2(x + w), r2(cy + ky), r2(cx + kx), r2(y + h), r2(cx), r2(y + h)],
    ["C", r2(cx - kx), r2(y + h), r2(x), r2(cy + ky), r2(x), r2(cy)], ["C", r2(x), r2(cy - ky), r2(cx - kx), r2(y), r2(cx), r2(y)], ["Z"]];
}
/** a block arrow pointing right: its shaft half the box's height, its head at most as long as the box is high */
export function arrowCmds(x: number, y: number, w: number, h: number): PathCmd[] {
  const head = Math.min(w * .4, h), sh = h * .25, cy = y + h / 2, hx = x + w - head;
  return [["M", r2(x), r2(cy - sh)], ["L", r2(hx), r2(cy - sh)], ["L", r2(hx), r2(y)], ["L", r2(x + w), r2(cy)], ["L", r2(hx), r2(y + h)], ["L", r2(hx), r2(cy + sh)], ["L", r2(x), r2(cy + sh)], ["Z"]];
}
/** a speech bubble: a rounded rectangle with a tail to `tip` from the edge facing it (below the box when unset) */
export function bubbleCmds(x: number, y: number, w: number, h: number, r: number, tip?: { x: number; y: number } | null): PathCmd[] {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const t = tip && Number.isFinite(tip.x) && Number.isFinite(tip.y) ? tip : { x: x + w * .25, y: y + h + Math.min(40, h * .5) };
  // the edge the tail leaves from: where the tip lies outside the box, the farthest
  const out = { top: y - t.y, bottom: t.y - (y + h), left: x - t.x, right: t.x - (x + w) };
  const side = (Object.entries(out) as [keyof typeof out, number][]).sort((a, b) => b[1] - a[1])[0];
  const k = KAPPA * r, base = Math.min(24, (side[0] === "top" || side[0] === "bottom" ? w : h) - 2 * r - 4) / 2;
  const at = (lo: number, hi: number, v: number) => Math.max(lo + r + base, Math.min(hi - r - base, v));
  const d: PathCmd[] = [["M", r2(x + r), r2(y)]];
  const tail = (a: [number, number], b: [number, number]) => { if (side[1] > 0 && base > 0) d.push(["L", r2(a[0]), r2(a[1])], ["L", r2(t.x), r2(t.y)], ["L", r2(b[0]), r2(b[1])]); };
  if (side[0] === "top") { const m = at(x, x + w, t.x); tail([m - base, y], [m + base, y]); }
  d.push(["L", r2(x + w - r), r2(y)], ["C", r2(x + w - r + k), r2(y), r2(x + w), r2(y + r - k), r2(x + w), r2(y + r)]);
  if (side[0] === "right") { const m = at(y, y + h, t.y); tail([x + w, m - base], [x + w, m + base]); }
  d.push(["L", r2(x + w), r2(y + h - r)], ["C", r2(x + w), r2(y + h - r + k), r2(x + w - r + k), r2(y + h), r2(x + w - r), r2(y + h)]);
  if (side[0] === "bottom") { const m = at(x, x + w, t.x); tail([m + base, y + h], [m - base, y + h]); }
  d.push(["L", r2(x + r), r2(y + h)], ["C", r2(x + r - k), r2(y + h), r2(x), r2(y + h - r + k), r2(x), r2(y + h - r)]);
  if (side[0] === "left") { const m = at(y, y + h, t.y); tail([x, m + base], [x, m - base]); }
  d.push(["L", r2(x), r2(y + r)], ["C", r2(x), r2(y + r - k), r2(x + r - k), r2(y), r2(x + r), r2(y)], ["Z"]);
  return d;
}

/* ---- look per design ---- */
interface ShapeLook { fill: string | null; border: { w: number; color: string; dash?: number[] } | null; shadow: boolean; glass: boolean; ink: string; radius: number }
function lookOf(it: ShapeItem, ctx: RenderCtx, panel = false): ShapeLook {
  const d = ctx.style.design, rk = ctx.style.radius / 100, own = typeof it.fill === "string" && HEX.test(it.fill) ? it.fill.toUpperCase() : null;
  const none = it.fill === "none", b = it.border && typeof it.border === "object" ? it.border : null, w = b && Number.isFinite(+b.w) ? Math.max(0, Math.min(20, +b.w)) : 0;
  const ownBorder = b && typeof b.color === "string" && HEX.test(b.color) && w > 0 ? { w, color: b.color.toUpperCase(), ...(b.dash === "dashed" ? { dash: [w * 3, w * 2] } : b.dash === "dotted" ? { dash: [w, w * 1.5] } : {}) } : b && w <= 0 ? null : undefined;
  let L: ShapeLook;
  if (isConsult(d)) {
    const C = specOf(ctx);
    // 08's callout hooks: a circle is an outline in the accent, an arrow is filled with it; on Consulting Red's message
    // panel (red) the outline and the text are white and a shape is a white outline, no card
    L = it.shape === "circle" ? { fill: null, border: { w: C.chart.callout.outline.w, color: panel ? "#FFFFFF" : C.chart.callout.outline.color }, shadow: false, glass: false, ink: panel ? "#FFFFFF" : C.note.ink, radius: 0 }
      : it.shape === "arrow" ? { fill: panel ? "#FFFFFF" : C.accent, border: null, shadow: false, glass: false, ink: panel ? C.accent : "#FFFFFF", radius: 0 }
      : panel ? { fill: null, border: { w: 1.5, color: "#FFFFFF" }, shadow: false, glass: false, ink: "#FFFFFF", radius: C.look.card.radius }
      // a card: white on the design's tinted ground, its own tint on a white one (as the text boxes' cards)
      : { fill: C.bg === "#FFFFFF" && consultOptions(ctx).background !== "white" ? "#FFFFFF" : C.card.fill, border: null, shadow: false, glass: false, ink: C.note.ink, radius: C.look.card.radius };
  } else if (d === "glass") L = { fill: null, border: null, shadow: true, glass: true, ink: "#0B0D17", radius: Math.round(22 * rk) };
  // Excel and Excel Refined: the Intesa Sanpaolo template's outlined box (B48, render/isp.ts) – white, Nero 50 % at 1 pt
  else L = { fill: "#FFFFFF", border: { w: ISP.box.w, color: ISP.box.border }, shadow: false, glass: false, ink: "#16181D", radius: Math.round(8 * rk) };
  // the item's own settings over the design's: a fill (or none) ends the glass; a border set, or set to nothing
  if (own || none) L = { ...L, fill: own, glass: false };
  if (ownBorder !== undefined) L = { ...L, border: ownBorder };
  if (Number.isFinite(it.radius as number) && (it.radius as number) >= 0) L = { ...L, radius: Math.min(200, +it.radius!) };
  // dark fills take white text, light ones the design's
  if (L.fill && luminance(L.fill) < .5) L = { ...L, ink: "#FFFFFF" };
  else if ((own || none) && L.ink === "#FFFFFF" && !(none && panel)) L = { ...L, ink: isConsult(d) ? specOf(ctx).note.ink : "#16181D" };
  return L;
}
/** the corner radius a shape item is drawn with (the PowerPoint export's preset geometry, 07 §4.2) */
export const shapeRadius = (it: ShapeItem, ctx: RenderCtx, panel = false) => lookOf(it, ctx, panel).radius;
const luminance = (hex: string) => { const [r, g, b] = parseColor(hex).c; return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

export interface ShapeEnv { V: GlassVars; wall: Wallpaper | null; /** on Consulting Red's message panel (slide-dl.ts inPanel) */ panel?: boolean }
/** a shape item → the nodes of its shape (the item's hit first), the box its text goes in, its text with the cell
    references replaced, and the Issues line of references that could not be read */
export function shapeNodes(it: ShapeItem, id: string, box: Box, ctx: RenderCtx, env: ShapeEnv): { nodes: Node[]; text: string; textBox: Box; ink: string; issue: string | null } {
  const { x, y, w, h } = box, L = lookOf(it, ctx, !!env.panel), shape = it.shape;
  const ref = calloutText(typeof it.text === "string" ? it.text : "", ctx);
  const hitNode: Node = { t: "hit", kind: "item", id, x: r2(x), y: r2(y), w: r2(w), h: r2(h), label: ref.text };
  const fill: Paint | undefined = L.fill ? solid(L.fill) : undefined;
  const stroke = L.border ? { w: L.border.w, paint: solid(L.border.color), ...(L.border.dash ? { dash: L.border.dash } : {}) } : undefined;
  const nodes: Node[] = [];
  const rectR = shape === "rect" ? 0 : shape === "pill" ? h / 2 : shape === "circle" ? Math.min(w, h) / 2 : L.radius;
  const rectLike = shape === "rect" || shape === "round" || shape === "pill" || (shape === "circle" && Math.abs(w - h) < .5);
  if (shape === "icon") {
    // an icon: the built-in outline scaled into the box, filled with the text colour (an own fill colours it)
    const name = typeof it.icon === "string" && Object.prototype.hasOwnProperty.call(ICONS, it.icon) ? it.icon : "info", s = Math.min(w, h) / 24, ox = x + (w - 24 * s) / 2, oy = y + (h - 24 * s) / 2;
    const ink = typeof it.fill === "string" && HEX.test(it.fill) ? it.fill.toUpperCase() : typeof it.fmt?.color === "string" && HEX.test(it.fmt.color) ? it.fmt.color : env.panel ? "#FFFFFF" : isConsult(ctx.style.design) ? specOf(ctx).accent : L.ink;
    nodes.push(hitNode, { t: "path", d: iconCmds(name, ox, oy, s), fill: solid(ink), rule: "evenodd" });
    return { nodes, text: "", textBox: box, ink, issue: null };
  }
  if (L.glass && rectLike) {
    const rr = Math.max(0, Math.min(rectR, w / 2, h / 2));
    nodes.push(...glassBox("gls wb card callout", x, y, w, h, rr, env.V, { x: 0, y: 0, scale: 1 }, env.wall, { hit: { kind: "item", id, label: ref.text } }));
    if (stroke) nodes.push({ t: "rect", x: r2(x + stroke.w / 2), y: r2(y + stroke.w / 2), w: r2(Math.max(0, w - stroke.w)), h: r2(Math.max(0, h - stroke.w)), r: r2(Math.max(0, rr - stroke.w / 2)), stroke });
  }
  else {
    nodes.push(hitNode);
    // the design's soft shadow under a box (Excel Refined, Liquid Glass's paths); outlines take none
    if (L.shadow && rectLike && (fill || L.glass)) nodes.push({ t: "shadow", x: r2(x), y: r2(y), w: r2(w), h: r2(h), r: rectR, dx: 0, dy: 8, blur: 24, spread: -12, c: [20, 30, 60], a: .18 }, { t: "shadow", x: r2(x), y: r2(y), w: r2(w), h: r2(h), r: rectR, dx: 0, dy: 1, blur: 3, spread: 0, c: [20, 30, 60], a: .06 });
    // Liquid Glass's material on an arrow, a bubble or an ellipse: a frosted white with a white rim
    const paint: Paint | undefined = fill ?? (L.glass ? { solid: [255, 255, 255] as RGB, a: .72 } : undefined);
    const edge = stroke ?? (L.glass ? { w: 1.5, paint: { solid: [255, 255, 255] as RGB, a: .95 } } : undefined);
    if (paint || edge) {
      if (rectLike) {
        const inset = edge ? edge.w / 2 : 0;
        nodes.push({ t: "rect", x: r2(x + inset), y: r2(y + inset), w: r2(Math.max(0, w - 2 * inset)), h: r2(Math.max(0, h - 2 * inset)), r: r2(Math.max(0, Math.min(rectR, w / 2, h / 2) - inset)), ...(paint ? { fill: paint } : {}), ...(edge ? { stroke: edge } : {}) });
      } else {
        const d = shape === "arrow" ? arrowCmds(x, y, w, h) : shape === "bubble" ? bubbleCmds(x, y, w, h, L.radius, it.tail) : ellipseCmds(x, y, w, h);
        nodes.push({ t: "path", d, ...(paint ? { fill: paint } : {}), ...(edge ? { stroke: { ...edge, paint: "solid" in edge.paint ? edge.paint : { solid: [255, 255, 255] as RGB } } } : {}) });
      }
    }
  }
  // the text's box: the shape's inside less its padding (an arrow's shaft and head; an ellipse's inscribed rectangle)
  const pad = Number.isFinite(it.fmt?.pad as number) ? Math.max(0, Math.min(60, +it.fmt!.pad!)) : 8;
  const inner = shape === "arrow" ? { x, y: y + h * .25, w: w - Math.min(w * .4, h) * .4, h: h * .5 } : shape === "circle" ? { x: x + w * .146, y: y + h * .146, w: w * .708, h: h * .708 } : { x, y, w, h };
  const textBox = { x: inner.x + pad, y: inner.y + pad * .5, w: Math.max(10, inner.w - 2 * pad), h: Math.max(10, inner.h - pad) };
  const issue = ref.missing.length ? `${ref.missing.join(", ")} not found` : null;
  return { nodes, text: ref.text, textBox, ink: L.ink, issue };
}
