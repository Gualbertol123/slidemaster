/* Slide composition: tables arranged in bands, title, cover/index, page number, logo. */
import { esc } from "../xlsx/util";
import type { TableLayout } from "../xlsx/types";
import type { Layout, RuntimeSlide } from "../model/types";
import { glassLevel } from "../model/style";
import { tableName } from "../model/preset";
import { sheetKey, type RenderCtx } from "./context";
import { renderExcel } from "./excel";
import { glassGeom, renderGlass } from "./glass";
import { coverHtml, indexHtml } from "./cover";
import { pageNoBox, pageNoFor, pageNoHtml } from "./pagenumbers";
import { cache } from "./edits";

export const SLIDE_W = 1600, SLIDE_H = 900;
export const GX = 36, GY = 28, MAXK = 2.0;
export const areaFor = (R: RuntimeSlide) => R.subtitle ? { x: 50, y: 126, w: 1500, h: 696 } : { x: 50, y: 104, w: 1500, h: 718 };
export const tableW = (L: TableLayout, ctx: RenderCtx) => ctx.style.design === "glass" ? glassGeom(L, ctx).W : L.W;

export function defaultLayout(R: RuntimeSlide): Layout {
  // tables of the same sheet that share rows sit side by side; everything else stacks, in slide order
  const T = R.tables, bands: { sheet: unknown; r1: number; r2: number; ids: number[] }[] = [];
  T.forEach((L, i) => {
    const bd = bands.find(b => b.sheet === L.sheet && L.g.r1 <= b.r2 && L.g.r2 >= b.r1);
    if (bd) { bd.ids.push(i); bd.r1 = Math.min(bd.r1, L.g.r1); bd.r2 = Math.max(bd.r2, L.g.r2); }
    else bands.push({ sheet: L.sheet, r1: L.g.r1, r2: L.g.r2, ids: [i] });
  });
  bands.forEach(b => b.ids.sort((p, q) => T[p].g.c1 - T[q].g.c1));
  return { bands: bands.map(b => b.ids), w: T.map(() => 1) };
}
export function validLayout(L: Layout | null | undefined, n: number): L is Layout {
  if (!L || !Array.isArray(L.bands) || !Array.isArray(L.w) || L.w.length !== n) return false;
  const seen = L.bands.flat(); return seen.length === n && new Set(seen).size === n && seen.every(i => Number.isInteger(i) && i >= 0 && i < n);
}
export function layoutOf(R: RuntimeSlide): Layout {
  const saved = R.cfg && R.cfg.layout;
  if (validLayout(saved, R.tables.length)) return saved;
  if (!R._auto || R._auto.w.length !== R.tables.length) R._auto = defaultLayout(R);
  return R._auto;
}
export interface TBox { i: number; band: number; x: number; y: number; w: number; h: number; scale: number }
export function computeLayout(R: RuntimeSlide, ctx: RenderCtx, w?: number[], lay?: Layout): { boxes: TBox[]; k: number } {
  if (!R.tables.length) return { boxes: [], k: 1 };
  lay = lay || layoutOf(R); const ww = w || lay.w; const T = R.tables, A = areaFor(R);
  const bands = lay.bands.filter(b => b.length);
  let k = MAXK;
  const sumH = bands.reduce((s, b) => s + Math.max(...b.map(i => T[i].H * ww[i])), 0);
  k = Math.min(k, (A.h - GY * (bands.length - 1)) / sumH);
  for (const b of bands) { const sw = b.reduce((s, i) => s + tableW(T[i], ctx) * ww[i], 0); k = Math.min(k, (A.w - GX * (b.length - 1)) / sw); }
  k = Math.max(k, 0.01);
  const boxes: TBox[] = []; let y = 0;
  const dims = bands.map(b => ({ w: b.reduce((s, i) => s + tableW(T[i], ctx) * ww[i] * k, 0) + GX * (b.length - 1), h: Math.max(...b.map(i => T[i].H * ww[i] * k)) }));
  const Htot = dims.reduce((s, d) => s + d.h, 0) + GY * (bands.length - 1);
  const top = A.y + Math.max(0, (A.h - Htot) / 2 * 0.35);
  bands.forEach((b, bi) => {
    let x = A.x + (A.w - dims[bi].w) / 2;
    for (const i of b) { const sc = k * ww[i], tw = tableW(T[i], ctx); boxes[i] = { i, band: bi, x, y: top + y, w: tw * sc, h: T[i].H * sc, scale: sc }; x += tw * sc + GX; }
    y += dims[bi].h + GY;
  });
  return { boxes, k };
}

export function tableHtml(R: RuntimeSlide, i: number, ctx: RenderCtx, thumb = false): string {
  const L = R.tables[i], d = ctx.style.design, key = d + "|" + glassLevel(ctx.style) + "|" + ctx.workbook + "|" + sheetKey(ctx, L.sheet) + "|" + (ctx.forExport ? 1 : 0);
  if (thumb && L.items.length > 1200)              // thumbnails of big tables: shapes only, no text
    return cache(L, "thtml", key, () => d === "glass" ? renderGlass(L, ctx, { noText: true }) : renderExcel(L, ctx, { noText: true }));
  return cache(L, "html", key, () => d === "glass" ? renderGlass(L, ctx) : renderExcel(L, ctx));
}
export function placeGlass(el: HTMLElement, ex: number, ey: number, ew: number, eh: number, sc: number, gi: number) {
  const LENS = 1 + .06 * gi;
  const cx = ex + ew / 2, cy = ey + eh / 2;
  el.style.backgroundSize = `100% 100%, ${(1600 * LENS / sc).toFixed(2)}px ${(900 * LENS / sc).toFixed(2)}px`;
  el.style.backgroundPosition = `0 0, ${(-(ex + (LENS - 1) * cx) / sc).toFixed(2)}px ${(-(ey + (LENS - 1) * cy) / sc).toFixed(2)}px`;
}
export const slideHasLogo = (R: RuntimeSlide) => !(R.cfg && R.cfg.logo === false);

export interface SlideOpts { interactive?: boolean; thumb?: boolean }
export type SlideEl = HTMLDivElement & { _rid?: string };
export function buildSlide(R: RuntimeSlide, idx: number, ctx: RenderCtx, opts: SlideOpts = {}): SlideEl {
  const d = ctx.style.design, glassy = d === "glass";
  const slide = document.createElement("div") as SlideEl;
  slide.className = "slide " + d + (R.type !== "content" ? " " + R.type : "");
  if (glassy) { slide.style.setProperty("--gi", String(glassLevel(ctx.style))); slide.style.setProperty("--amt", String((+ctx.style.color || 0) / 100)); }
  const pageNo = pageNoFor(ctx, idx);
  const logo = slideHasLogo(R) ? ctx.logoSrc : "", cover = R.type === "cover";
  let h = glassy ? `<div class="wall"></div>` : "";
  // a page number in the top-left corner pushes the title to the right
  const shift = pageNo !== null && ctx.style.pn.pos === "tl" ? pageNoBox(ctx, pageNo, glassy).w + 22 : 0, sh = shift ? ` style="left:${56 + shift}px"` : "";
  if (cover) h += coverHtml(R, glassy);
  else {
    h += `<div class="title" data-edit="title"${sh}>${esc(R.title)}</div>`;
    if (R.subtitle) h += `<div class="subtitle" data-edit="subtitle"${sh}>${esc(R.subtitle)}</div>`;
  }
  if (R.type === "index") h += indexHtml(R, ctx, glassy);
  if (pageNo !== null) h += pageNoHtml(ctx, pageNo, glassy, !!logo, cover);
  R.tables.forEach((t, i) => {
    h += `<div class="tw" data-i="${i}" style="width:${tableW(t, ctx)}px;height:${t.H}px">${tableHtml(R, i, ctx, opts.thumb)}${opts.interactive ? `<div class="hits" data-t="${i}" style="width:${tableW(t, ctx)}px;height:${t.H}px"><div class="hov"></div></div>` : ""}</div>`;
  });
  if (opts.interactive) h += R.tables.map((t, i) => `<div class="hbox" data-i="${i}"><div class="grip" title="Drag to move this table">⠿ ${esc(tableName(t, ctx.preset))}</div><div class="size" title="Drag to resize"></div></div>`).join("") + `<div class="dropmark"></div>`;
  if (R.type === "content" && !R.tables.length && opts.interactive) h += `<div class="emptyslide">No tables on this slide – add some with the wizard.</div>`;
  if (logo) h += glassy
    ? `<div class="gls wb chrome logowrap" style="left:${cover ? 1150 : 1256}px;top:${cover ? 800 : 832}px;width:${cover ? 400 : 314}px;height:${cover ? 68 : 52}px;border-radius:${cover ? 34 : 26}px"><img class="logo" src="${esc(logo)}" alt=""></div>`
    : `<div class="logowrap${cover ? " big" : ""}"><img class="logo" src="${esc(logo)}" alt=""></div>`;
  slide.innerHTML = h;
  slide._rid = R.id;
  applyLayout(slide, R, ctx);
  return slide;
}
export function applyLayout(slide: HTMLElement, R: RuntimeSlide, ctx: RenderCtx, w?: number[], lay?: Layout): TBox[] {
  const { boxes } = computeLayout(R, ctx, w, lay);
  const glassy = slide.classList.contains("glass"), gi = glassLevel(ctx.style);
  slide.querySelectorAll<HTMLElement>(":scope > .tw").forEach(el => {
    const b = boxes[+el.dataset.i!]; if (!b) return;
    el.style.left = b.x + "px"; el.style.top = b.y + "px"; el.style.transform = `scale(${b.scale})`;
    if (glassy) el.querySelectorAll<HTMLElement>(".wb").forEach(g => placeGlass(g, b.x + parseFloat(g.style.left) * b.scale, b.y + parseFloat(g.style.top) * b.scale, parseFloat(g.style.width) * b.scale, parseFloat(g.style.height) * b.scale, b.scale, gi));
  });
  if (glassy) slide.querySelectorAll<HTMLElement>(":scope > .chrome.wb").forEach(g => placeGlass(g, parseFloat(g.style.left), parseFloat(g.style.top), parseFloat(g.style.width), parseFloat(g.style.height), 1, gi));
  slide.querySelectorAll<HTMLElement>(":scope > .hbox").forEach(el => { const b = boxes[+el.dataset.i!]; if (b) Object.assign(el.style, { left: b.x + "px", top: b.y + "px", width: b.w + "px", height: b.h + "px" }); });
  return boxes;
}
