/* "Excel Refined" design: the workbook's table, same cells and geometry as the Excel design, redrawn
   in one consistent style – a solid header band, tinted total rows, striped body rows with hairlines,
   positive/negative cells as soft green/red tiles, one font. Every colour comes from the deck palette
   (theme + overrides); the user's own cell colours, text colours and roles still win. */
import { esc } from "../xlsx/util";
import { lum, tone } from "../xlsx/color";
import type { Rect, TableLayout } from "../xlsx/types";
import type { RenderCtx } from "./context";
import { effItems } from "./edits";
import { picHtml, rotBox, rotSpan, shapeTransform, textboxInner } from "./excel";
import { rolesOf, type RowKind } from "./roles";
import { mix, palette } from "../model/style";
import { fontStack } from "../model/fonts";

/** factor that makes `text` fit `w` px (estimated from its length), at least `min` */
function fitK(text: string, size: number, weight: number, w: number, min: number) {
  const need = text.length * size * (weight >= 600 ? .6 : .56) + 12;
  return need > w ? Math.max(min, (w - 12) / (need - 12)) : 1;
}
export const CLEANFONT = `'Segoe UI Variable Text','Segoe UI',Calibri,Arial,sans-serif`;
const rgba = (hex: string, a: number) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

export function renderClean(L: TableLayout, ctx: RenderCtx, opts: { noText?: boolean } = {}): string {
  const P = palette(ctx.style), items = effItems(L, ctx), roles = rolesOf(L, ctx), rk = ctx.style.radius / 100, rad = Math.round(4 * rk);
  const deckFont = ctx.style.text?.table?.font;
  const kindOf = (r: number, role?: string): RowKind | "caption" => role === "header" ? "header" : role === "total" ? "total" : role === "body" ? "body" : role === "caption" ? "caption" : roles.kind.get(r) || "body";
  const lastC = L.cols[L.cols.length - 1], firstC = L.cols[0];
  let back = "", text = "";
  // one scale per column of numbers: the widest number of the column must fit
  const colScale = new Map<number, number>();
  for (const it of items) {
    if (it.isText || !String(it.text || "").trim() || it.b.c !== it.b.c2 || it.ov || it.b.c === roles.labelC) continue;
    const k = kindOf(it.b.r, it.role); if (k === "header") continue;
    const kk = fitK(String(it.text), (it.font.sz || 11) * 96 / 72, k === "total" || tone(it.fill) ? 700 : 400, it.tw || it.bw, .72);
    colScale.set(it.b.c, Math.min(colScale.get(it.b.c) ?? 1, kk));
  }
  // total rows: one band across the table, with an accent rule above
  const bandRows = new Set<number>();
  for (const it of items) { const k = kindOf(it.b.r, it.role); if (k === "total" && !bandRows.has(it.b.r)) bandRows.add(it.b.r); }
  for (const r of bandRows) {
    const y = L.rowY.get(r)!, h = L.rowH.get(r)!, x0 = L.colX.get(firstC)!, x1 = L.colX.get(lastC)! + L.colW.get(lastC)!;
    back += `<div class="b ctot" style="left:${x0}px;top:${y}px;width:${x1 - x0}px;height:${h}px;background:${P.total};border-top:2px solid ${P.accent};border-radius:${rad}px"></div>`;
  }
  for (const it of items) {
    const k = kindOf(it.b.r, it.role), hasText = !!String(it.text || "").trim();
    const userBg = it.userBg ? (it.userBg === "none" ? null : it.userBg) : undefined;
    const t = it.scaleFill ? null : tone(it.fill), labelCell = it.b.c === roles.labelC;
    const x = it.bx, y = it.by, w = it.bw, h = it.bh;
    let bg: string | null = null, ink = P.ink, weight = it.font.b ? 650 : 400, size = (it.font.sz || 11) * 96 / 72, italic = !!it.font.i;
    let cls = "";
    if (k === "header") {
      const filled = !!it.fill && lum(it.fill) < .97;
      if (labelCell && !filled) { ink = mix(P.ink, "#FFFFFF", .45); italic = true; size *= .9; weight = 400; }
      else if (hasText || filled) {
        const light = !!it.fill && lum(it.fill) > .8;                 // a pale sub-header stays pale, in the palette's colour
        bg = light ? mix(P.head, "#FFFFFF", .86) : P.head; ink = light ? P.head : P.headInk; weight = 650; cls = "chead"; size *= .94;
      }
    } else if (k === "total") { ink = P.totalInk; weight = 700; }
    else if (k === "caption") { ink = mix(P.ink, "#FFFFFF", .45); italic = true; size *= .92; }
    else if (k === "body" && roles.stripe.get(it.b.r)) bg = P.stripe;
    if (k !== "header" && (t === "pos" || t === "neg")) {                // semantic cells: soft tiles in the palette's green/red
      const c = t === "pos" ? P.pos : P.neg; bg = rgba(c, .13); ink = mix(c, "#000000", .12); weight = Math.max(weight, 600); cls = "csig";
    }
    if (it.scaleFill) bg = it.scaleFill;
    if (userBg !== undefined) bg = userBg;
    if (it.userColor) ink = it.userColor;
    else if (k !== "header" && !cls && it.color && (tone(it.color) === "pos" || tone(it.color) === "neg")) ink = tone(it.color) === "pos" ? P.pos : P.neg;   // red/green numbers keep their meaning
    if (it.userB !== undefined) weight = it.userB ? 700 : 400;
    if (it.userI !== undefined) italic = it.userI;
    if (bg) {
      const tile = cls === "chead" || cls === "csig";
      back += `<div class="b ${cls}" style="left:${x}px;top:${y}px;width:${tile ? w - 1 : w}px;height:${tile ? h - 1 : h}px;background:${bg}${tile ? `;border-radius:${rad}px` : ""}"></div>`;
    }
    if (k === "body") back += `<div class="b" style="left:${x}px;top:${y + h - 1}px;width:${w}px;height:1px;background:${P.rule}"></div>`;
    if (opts.noText || !hasText) continue;
    const tw = it.tw || w;
    // the design font is wider than Excel's: numbers shrink by the same amount in a whole column (even
    // look), headers and labels one by one – never below 60 % / 72 %
    if ((!it.ov || cls === "chead") && !it.wrap && !it.rot) {
      const col = colScale.get(it.b.c);
      if (col !== undefined && k !== "header" && it.b.c === it.b.c2) size *= col;
      else size *= fitK(String(it.text), size, weight, cls === "chead" ? w : tw, k === "header" ? .6 : .72);
    }
    const st = [`left:${x}px`, `top:${y}px`, `width:${tw}px`, `height:${h}px`,
      `font-family:${it.userFont || deckFont ? fontStack(it.userFont || deckFont, CLEANFONT) : CLEANFONT}`, `font-size:${size.toFixed(2)}px`, `color:${ink}`, `font-weight:${weight}`,
      `justify-content:${it.align === "right" ? "flex-end" : it.align === "center" ? "center" : "flex-start"}`, `align-items:${it.wrap && it.valign === "top" ? "flex-start" : "center"}`, `text-align:${it.align}`];
    if (italic) st.push("font-style:italic");
    if (!it.isText) st.push("font-variant-numeric:tabular-nums");
    if (it.indent) st.push(it.align === "right" ? `padding-right:${6 + it.indent * 9}px` : `padding-left:${6 + it.indent * 9}px`);
    else st.push(it.align === "right" ? "padding-right:7px" : it.align === "center" ? "" : "padding-left:7px");
    const cl = ["t", it.wrap ? "wrap" : "", it.ov && cls !== "chead" ? "ov" : ""].filter(Boolean).join(" ");
    if (it.rot) { text += `<div class="t ov" style="${st.filter(Boolean).join(";")};${rotBox()}">${rotSpan(it.rot, it.text)}</div>`; continue; }
    text += `<div class="${cl}" style="${st.filter(Boolean).join(";")}">${esc(it.text)}</div>`;
  }
  let extra = "";
  for (const r of L.rects) extra += `<div style="position:absolute;box-sizing:border-box;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;${r.fill ? `background:${r.fill};` : ""}${r.line ? `border:${r.line.w}px solid ${r.line.color};` : ""}${r.ellipse ? "border-radius:50%;" : r.round ? `border-radius:${rad * 2}px;` : ""}${shapeTransform(r)}"></div>`;
  for (const tb of L.texts as Rect[]) extra += `<div class="tbox" style="left:${tb.x}px;top:${tb.y}px;width:${tb.w}px;height:${tb.h}px;${tb.fill ? `background:${tb.fill};` : ""}${tb.line ? `border:${tb.line.w}px solid ${tb.line.color};` : ""}justify-content:${tb.anchorV === "ctr" ? "center" : tb.anchorV === "b" ? "flex-end" : "flex-start"};font-family:${CLEANFONT};${shapeTransform(tb)}">${textboxInner(tb.paras)}</div>`;
  for (const p of L.pics) extra += picHtml(p, undefined, !!ctx.forExport);
  return `<div class="xt cx" style="width:${L.W}px;height:${L.H}px">${back}${extra}${text}</div>`;
}
