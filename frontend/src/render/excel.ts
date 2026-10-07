/* Excel design: a faithful copy of the workbook formatting (absolutely positioned divs). */
import { esc } from "../xlsx/util";
import { bcss } from "../xlsx/layout";
import type { Para, Pic, Rect, TableLayout } from "../xlsx/types";
import { effItems } from "./edits";
import type { RenderCtx } from "./context";
import { fontStack } from "../model/fonts";



export const XLFONT = `'Century Gothic','CenturyGothic','URW Gothic','AppleGothic',Arial,sans-serif`;

export function picHtml(p: Pic, cls: string | undefined, forExport: boolean): string {
  const tr: string[] = []; if (p.rot) tr.push(`rotate(${p.rot}deg)`); if (p.flipH) tr.push("scaleX(-1)"); if (p.flipV) tr.push("scaleY(-1)");
  const outer = `left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;${tr.length ? `transform:${tr.join(" ")};` : ""}`;
  if (p.unsupported || !p.src) return forExport ? "" : `<div class="pic missing" style="${outer}" title="${esc(p.name)}"><span>${esc(p.unsupported || "Picture")}</span></div>`;
  const c = p.crop;
  if (c && (c.l || c.t || c.r || c.b)) {
    const iw = p.w / Math.max(.01, 1 - c.l - c.r), ih = p.h / Math.max(.01, 1 - c.t - c.b);
    return `<div class="pic ${cls || ""}" style="${outer}"><img src="${p.src}" alt="" style="left:${(-c.l * iw).toFixed(2)}px;top:${(-c.t * ih).toFixed(2)}px;width:${iw.toFixed(2)}px;height:${ih.toFixed(2)}px"></div>`;
  }
  return `<div class="pic ${cls || ""}" style="${outer}"><img src="${p.src}" alt="" style="left:0;top:0;width:100%;height:100%"></div>`;
}
export function textboxInner(paras: Para[] | undefined, inkMap?: (c: string) => string): string {
  return (paras || []).map(p => `<div style="text-align:${p.align}">${p.runs.length ? p.runs.map(r => `<span style="${r.sz ? `font-size:${(r.sz * 96 / 72).toFixed(1)}px;` : ""}${r.b ? "font-weight:700;" : ""}${r.i ? "font-style:italic;" : ""}${r.color ? `color:${inkMap ? inkMap(r.color) : r.color};` : ""}">${esc(r.text)}</span>`).join("") : "&nbsp;"}</div>`).join("");
}
export function shapeTransform(o: { rot?: number; flipH?: boolean; flipV?: boolean }): string {
  const tr: string[] = []; if (o.rot) tr.push(`rotate(${o.rot}deg)`); if (o.flipH) tr.push("scaleX(-1)"); if (o.flipV) tr.push("scaleY(-1)");
  return tr.length ? `transform:${tr.join(" ")};` : "";
}
/* Excel text rotation: 1–90 counter-clockwise, 91–180 clockwise, 255 stacked letters */
export function rotBox() { return "display:flex;align-items:center;justify-content:center;line-height:1.1"; }
export function rotSpan(rot: number, text: string) {
  if (rot === 255) return `<span style="writing-mode:vertical-rl;text-orientation:upright">${esc(text)}</span>`;
  const deg = rot <= 90 ? -rot : rot - 90;
  return `<span style="display:inline-block;white-space:nowrap;transform:rotate(${deg}deg)">${esc(text)}</span>`;
}

export function renderExcel(L: TableLayout, ctx: RenderCtx, opts: { noText?: boolean } = {}): string {
  // raw Excel: the workbook's own formatting (plus the user's cell edits) – no deck colours
  const items = effItems(L, ctx), rr = Math.round(8 * ctx.style.radius / 100);
  let h = `<div class="xt" style="width:${L.W}px;height:${L.H}px">`;
  for (const it of items) {
    const st = [`left:${it.bx}px`, `top:${it.by}px`, `width:${it.bw}px`, `height:${it.bh}px`];
    if (it.fill) st.push(`background:${it.fill}`);
    if (it.top) st.push(`border-top:${bcss(it.top)}`);
    if (it.left) st.push(`border-left:${bcss(it.left)}`);
    if (it.right) st.push(`border-right:${bcss(it.right)}`);
    if (it.bottom) st.push(`border-bottom:${bcss(it.bottom)}`);
    if (st.length > 4) h += `<div class="b" style="${st.join(";")}"></div>`;
  }
  for (const it of (opts.noText ? [] : items)) {
    if (!it.text) continue;
    const f = it.font, tw = it.tw || it.bw;
    const st = [`left:${it.bx}px`, `top:${it.by}px`, `width:${tw}px`, `height:${it.bh}px`,
      it.userFont || ctx.style.text?.table?.font ? `font-family:${fontStack(it.userFont || ctx.style.text!.table!.font, XLFONT)}` : `font-family:'${(f.name || "").replace(/['"]/g, "")}',${XLFONT}`, `font-size:${((f.sz || 11) * 96 / 72).toFixed(2)}px`, `color:${it.color || "#000"}`,
      `justify-content:${it.align === "right" ? "flex-end" : it.align === "center" ? "center" : "flex-start"}`,
      `align-items:${it.valign === "top" ? "flex-start" : it.valign === "center" ? "center" : "flex-end"}`, `text-align:${it.align}`];
    if (f.b) st.push("font-weight:700"); if (f.i) st.push("font-style:italic");
    const dec = [f.u ? "underline" : "", f.s ? "line-through" : ""].filter(Boolean).join(" "); if (dec) st.push(`text-decoration:${dec}`);
    if (it.indent) st.push(it.align === "right" ? `padding-right:${3 + it.indent * 9}px` : `padding-left:${3 + it.indent * 9}px`);
    if (it.valign === "bottom" || !it.valign) st.push("padding-bottom:1px");
    const cls = ["t", it.wrap ? "wrap" : "", it.ov ? "ov" : ""].filter(Boolean).join(" ");
    if (it.rot) { h += `<div class="t ov" style="${st.join(";")};${rotBox()}">${rotSpan(it.rot, it.text)}</div>`; continue; }
    h += `<div class="${cls}" style="${st.join(";")}">${esc(it.text)}</div>`;
  }
  for (const r of L.rects) h += `<div style="position:absolute;box-sizing:border-box;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;${r.fill ? `background:${r.fill};` : ""}${r.line ? `border:${r.line.w}px solid ${r.line.color};` : ""}${r.ellipse ? "border-radius:50%;" : r.round ? `border-radius:${rr}px;` : ""}${shapeTransform(r)}"></div>`;
  for (const tb of L.texts as Rect[]) h += `<div class="tbox" style="left:${tb.x}px;top:${tb.y}px;width:${tb.w}px;height:${tb.h}px;${tb.fill ? `background:${tb.fill};` : ""}${tb.line ? `border:${tb.line.w}px solid ${tb.line.color};` : ""}${tb.round ? `border-radius:${rr}px;` : ""}justify-content:${tb.anchorV === "ctr" ? "center" : tb.anchorV === "b" ? "flex-end" : "flex-start"};font-family:${XLFONT};${shapeTransform(tb)}">${textboxInner(tb.paras)}</div>`;
  for (const p of L.pics) h += picHtml(p, undefined, !!ctx.forExport);
  return h + `</div>`;
}
