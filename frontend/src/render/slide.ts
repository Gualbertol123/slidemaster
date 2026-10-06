/* Slide composition: tables arranged in bands, title, cover/index, page number, logo. */
import { esc } from "../xlsx/util";
import type { TableLayout } from "../xlsx/types";
import type { Layout, Note, RuntimeSlide, Side } from "../model/types";
import { glassLevel, themeOf } from "../model/style";
import { darken, hexRgb } from "../xlsx/color";
import { tableName } from "../model/preset";
import { tableKey, type RenderCtx } from "./context";
import { renderExcel } from "./excel";
import { glassGeom, renderGlass } from "./glass";
import { coverHtml, indexHtml } from "./cover";
import { footerHtml, pageNoBox, pageNoFor, pageNoHtml } from "./pagenumbers";
import { todayLabel } from "./cover";
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
export interface NoteBox { x: number; y: number; w: number; h: number }
export interface TBox { i: number; band: number; x: number; y: number; w: number; h: number; scale: number; notes: Partial<Record<Side, NoteBox>> }
export const NOTE_GAP = 14, NOTE_W = 240;
export const SIDES: Side[] = ["top", "bottom", "left", "right"];
export const noteKey = (R: RuntimeSlide, i: number, side: Side) => (R.tables[i].id || String(i)) + ":" + side;
export function notesOf(R: RuntimeSlide, i: number): Partial<Record<Side, Note>> {
  const out: Partial<Record<Side, Note>> = {}, all = R.cfg.notes || {};
  for (const side of SIDES) { const n = all[noteKey(R, i, side)]; if (n) out[side] = n; }
  return out;
}
/** height of a text box above/below a table: explicit, or from its lines (wrapping is handled by shrinking the font) */
const noteH = (n: Note) => n.h || Math.max(30, Math.max(1, String(n.text || "").split("\n").length) * (n.size || 18) * 1.3 + 12) + (n.bubble ? 20 : 0);
const noteW = (n: Note) => n.w || NOTE_W;

/** Tables (plus their text boxes) in bands. k = largest scale ≤ MAXK that fits the content area – or the
    slide's fixed scale (set by "Make same size"), reduced only if it would not fit. */
export function computeLayout(R: RuntimeSlide, ctx: RenderCtx, w?: number[], lay?: Layout): { boxes: TBox[]; k: number; fit: number; reduced: boolean } {
  if (!R.tables.length) return { boxes: [], k: 1, fit: 1, reduced: false };
  lay = lay || layoutOf(R); const ww = w || lay.w; const T = R.tables, A = areaFor(R);
  const bands = lay.bands.filter(b => b.length);
  const N = T.map((_, i) => notesOf(R, i));
  const ex = N.map(n => ({ l: n.left ? noteW(n.left) + NOTE_GAP : 0, r: n.right ? noteW(n.right) + NOTE_GAP : 0, t: n.top ? noteH(n.top) + NOTE_GAP : 0, b: n.bottom ? noteH(n.bottom) + NOTE_GAP : 0 }));
  const unitW = (i: number, k: number) => tableW(T[i], ctx) * ww[i] * k + ex[i].l + ex[i].r;
  const unitH = (i: number, k: number) => T[i].H * ww[i] * k + ex[i].t + ex[i].b;
  const fits = (k: number) => {
    let h = GY * (bands.length - 1);
    for (const b of bands) { let bw = GX * (b.length - 1); for (const i of b) bw += unitW(i, k); if (bw > A.w + .01) return false; h += Math.max(...b.map(i => unitH(i, k))); }
    return h <= A.h + .01;
  };
  let lo = 0.01, hi = MAXK;
  if (fits(hi)) lo = hi; else for (let n = 0; n < 40; n++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; }
  const fit = lo, fixed = R.cfg.scale && R.cfg.scale > 0 ? R.cfg.scale : 0;
  const k = fixed ? Math.min(fixed, fit) : fit;
  const boxes: TBox[] = []; let y = 0;
  const dims = bands.map(b => ({ w: b.reduce((s, i) => s + unitW(i, k), 0) + GX * (b.length - 1), h: Math.max(...b.map(i => unitH(i, k))) }));
  const Htot = dims.reduce((s, d) => s + d.h, 0) + GY * (bands.length - 1);
  const free = Math.max(0, A.h - Htot), va = R.cfg.valign;
  const top = A.y + (va === "top" ? 0 : va === "middle" ? free / 2 : va === "bottom" ? free : free / 2 * 0.35);
  const align = R.cfg.align || "center";
  bands.forEach((b, bi) => {
    let x = A.x + (align === "left" ? 0 : align === "right" ? A.w - dims[bi].w : (A.w - dims[bi].w) / 2);
    for (const i of b) {
      const sc = k * ww[i], tw = tableW(T[i], ctx) * sc, th = T[i].H * sc;
      const bx = x + ex[i].l, by = top + y + ex[i].t, n = N[i], notes: TBox["notes"] = {};
      if (n.top) notes.top = { x: bx, y: by - ex[i].t, w: tw, h: ex[i].t - NOTE_GAP };
      if (n.bottom) notes.bottom = { x: bx, y: by + th + NOTE_GAP, w: tw, h: ex[i].b - NOTE_GAP };
      if (n.left) notes.left = { x: bx - ex[i].l, y: by, w: ex[i].l - NOTE_GAP, h: th };
      if (n.right) notes.right = { x: bx + tw + NOTE_GAP, y: by, w: ex[i].r - NOTE_GAP, h: th };
      boxes[i] = { i, band: bi, x: bx, y: by, w: tw, h: th, scale: sc, notes };
      x += unitW(i, k) + GX;
    }
    y += dims[bi].h + GY;
  });
  return { boxes, k, fit, reduced: !!fixed && fit < fixed - 1e-6 };
}

export function tableHtml(R: RuntimeSlide, i: number, ctx: RenderCtx, thumb = false): string {
  const L = R.tables[i], d = ctx.style.design, key = d + "|" + glassLevel(ctx.style) + "|" + tableKey(ctx, L) + "|" + (ctx.forExport ? 1 : 0);
  if (thumb && L.items.length > 1200)              // thumbnails of big tables: shapes only, no text
    return cache(L, "thtml", key, () => d === "glass" ? renderGlass(L, ctx, { noText: true }) : renderExcel(L, ctx, { noText: true }));
  return cache(L, "html", key, () => d === "glass" ? renderGlass(L, ctx) : renderExcel(L, ctx));
}
export function placeGlass(el: HTMLElement, ex: number, ey: number, ew: number, eh: number, sc: number, gi: number) {
  const LENS = 1 + .06 * gi;
  const cx = ex + ew / 2, cy = ey + eh / 2;
  // layers: contrast veil · tint · blurred wallpaper (only the last one is positioned on the slide)
  el.style.backgroundSize = `100% 100%, 100% 100%, ${(1600 * LENS / sc).toFixed(2)}px ${(900 * LENS / sc).toFixed(2)}px`;
  el.style.backgroundPosition = `0 0, 0 0, ${(-(ex + (LENS - 1) * cx) / sc).toFixed(2)}px ${(-(ey + (LENS - 1) * cy) / sc).toFixed(2)}px`;
}
export const slideHasLogo = (R: RuntimeSlide) => !(R.cfg && R.cfg.logo === false);
/** contrast 0…100 (50 = as designed): lower fades the wallpaper (and glass) towards white,
    higher deepens the wallpaper and whitens the glass surfaces */
export function contrastVars(contrast: number): Record<string, string> {
  const ct = Math.max(0, Math.min(100, contrast)) / 100;
  if (ct < .5) { const f = (.5 - ct) * 1.4; return { "--wfade": f.toFixed(3), "--gfade": (f * .6).toFixed(3), "--wallf": "none" }; }
  const u = ct - .5;
  return { "--wfade": "0", "--gfade": (u * .9).toFixed(3), "--wallf": `saturate(${(1 + u * 1.4).toFixed(3)}) brightness(${(1 - u * .36).toFixed(3)})` };
}

/** accent colours of the theme as CSS variables (none for the default theme: the CSS has its values) */
export function themeVars(ctx: RenderCtx): Record<string, string> {
  const t = themeOf(ctx.style); if (t.id === "aurora") return {};
  return { "--a1": t.a1, "--a2": t.a2, "--a1rgb": hexRgb(t.a1).join(","), "--a2rgb": hexRgb(t.a2).join(","), "--x1": t.x, "--x2": darken(t.x, .6), "--ixink": darken(t.a1, .55) };
}
export interface SlideOpts { interactive?: boolean; thumb?: boolean }
export type SlideEl = HTMLDivElement & { _rid?: string };
export function buildSlide(R: RuntimeSlide, idx: number, ctx: RenderCtx, opts: SlideOpts = {}): SlideEl {
  const d = ctx.style.design, glassy = d === "glass", rk = ctx.style.radius / 100;
  const slide = document.createElement("div") as SlideEl;
  slide.className = "slide " + d + (R.type !== "content" ? " " + R.type : "");
  slide.style.setProperty("--rk", String(rk));
  for (const [k, v] of Object.entries(themeVars(ctx))) slide.style.setProperty(k, v);
  if (glassy) {
    slide.style.setProperty("--gi", String(glassLevel(ctx.style))); slide.style.setProperty("--amt", String((+ctx.style.color || 0) / 100));
    for (const [k, v] of Object.entries(contrastVars(ctx.style.contrast))) slide.style.setProperty(k, v);
  }
  const pageNo = pageNoFor(ctx, idx);
  const logo = slideHasLogo(R) ? ctx.logoSrc : "", cover = R.type === "cover";
  let h = glassy ? `<div class="wall"></div>` : "";
  // a page number in the top-left corner pushes the title to the right
  const shift = pageNo !== null && ctx.style.pn.pos === "tl" ? pageNoBox(ctx, pageNo, glassy).w + 22 : 0, sh = shift ? ` style="left:${56 + shift}px"` : "";
  if (cover) h += coverHtml(R, glassy, rk);
  else {
    h += `<div class="title" data-edit="title"${sh}>${esc(R.title)}</div>`;
    if (R.subtitle) h += `<div class="subtitle" data-edit="subtitle"${sh}>${esc(R.subtitle)}</div>`;
  }
  if (R.type === "index") h += indexHtml(R, ctx, glassy);
  if (pageNo !== null) h += pageNoHtml(ctx, pageNo, glassy, !!logo, cover);
  h += footerHtml(ctx, idx, glassy, !!logo, cover, pageNo, todayLabel());
  R.tables.forEach((t, i) => {
    h += `<div class="tw" data-i="${i}" style="width:${tableW(t, ctx)}px;height:${t.H}px">${tableHtml(R, i, ctx, opts.thumb)}${opts.interactive ? `<div class="hits" data-t="${i}" style="width:${tableW(t, ctx)}px;height:${t.H}px"><div class="hov"></div></div>` : ""}</div>`;
    const ns = notesOf(R, i);
    for (const side of SIDES) {
      const n = ns[side]; if (!n) continue;
      const txt = String(n.text || "");
      if (!txt.trim() && !opts.interactive) continue;
      const st = [`font-size:${n.size || 18}px`, n.b ? "font-weight:700" : "", n.i ? "font-style:italic" : "", n.color ? `color:${n.color}` : "", `text-align:${n.align || (side === "left" ? "right" : "left")}`,
        n.valign ? `justify-content:${n.valign === "top" ? "flex-start" : n.valign === "middle" ? "center" : "flex-end"}` : ""].filter(Boolean).join(";");
      // a bubble behind the text: a glass card like the tables' (Liquid Glass) or a framed box (Excel)
      if (n.bubble && txt.trim()) h += glassy ? `<div class="gls wb card notebub" data-i="${i}" data-side="${side}" style="border-radius:${Math.round(22 * rk)}px"></div>`
        : `<div class="notebub x" data-i="${i}" data-side="${side}" style="border-radius:${Math.round(8 * rk)}px"></div>`;
      h += `<div class="tnote ${side}${n.bubble ? " bub" : ""}${txt.trim() ? "" : " empty"}" data-note="${esc(noteKey(R, i, side))}" data-i="${i}" data-side="${side}" style="${st}">${txt.trim() ? esc(txt) : "Double-click to write"}</div>`;
    }
  });
  if (opts.interactive) h += R.tables.map((t, i) => `<div class="hbox" data-i="${i}"><div class="grip" title="Drag to move this table">⠿ ${esc(tableName(t, ctx.preset))}</div><div class="size" title="Drag to resize (keeps the proportions)"></div>${(["l", "r", "t", "b"] as const).map(e => `<div class="edge ${e}" data-edge="${e}" title="Drag to make the table ${e === "l" || e === "r" ? "wider or narrower" : "taller or shorter"}"></div>`).join("")}${SIDES.map(sd => `<button class="addnote ${sd}" data-side="${sd}" title="Add a text box ${sd === "top" ? "above" : sd === "bottom" ? "below" : "on the " + sd}">+</button>`).join("")}</div>`).join("") + `<div class="dropmark"></div>`;
  if (R.type === "content" && !R.tables.length && opts.interactive) h += `<div class="emptyslide">No tables on this slide – add some with the wizard.</div>`;
  if (logo) {
    const lx = cover ? 1150 : 1256, ly = cover ? 800 : 832, lw = cover ? 400 : 314, lh = cover ? 68 : 52;
    h += glassy
      ? (ctx.style.logoBubble
        ? `<div class="gls wb chrome logowrap" style="left:${lx}px;top:${ly}px;width:${lw}px;height:${lh}px;border-radius:${Math.min(lh / 2, lh / 2 * rk)}px"><img class="logo" src="${esc(logo)}" alt=""></div>`
        : `<div class="logowrap plain" style="left:${lx}px;top:${ly}px;width:${lw}px;height:${lh}px"><img class="logo" src="${esc(logo)}" alt=""></div>`)
      : `<div class="logowrap${cover ? " big" : ""}"><img class="logo" src="${esc(logo)}" alt=""></div>`;
  }
  slide.innerHTML = h;
  slide._rid = R.id;
  const boxes = applyLayout(slide, R, ctx);
  fitNotes(slide, boxes, d);
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
  slide.querySelectorAll<HTMLElement>(":scope > .tnote").forEach(el => {
    const nb = boxes[+el.dataset.i!]?.notes[el.dataset.side as Side]; if (!nb) { el.style.display = "none"; return; }
    Object.assign(el.style, { display: "", left: nb.x + "px", top: nb.y + "px", width: nb.w + "px", height: nb.h + "px" });
  });
  slide.querySelectorAll<HTMLElement>(":scope > .notebub").forEach(el => {
    const nb = boxes[+el.dataset.i!]?.notes[el.dataset.side as Side]; if (!nb) { el.style.display = "none"; return; }
    Object.assign(el.style, { display: "", left: nb.x + "px", top: nb.y + "px", width: nb.w + "px", height: nb.h + "px" });
    if (glassy) placeGlass(el, nb.x, nb.y, nb.w, nb.h, 1, gi);
  });
  if (glassy) slide.querySelectorAll<HTMLElement>(":scope > .chrome.wb").forEach(g => placeGlass(g, parseFloat(g.style.left), parseFloat(g.style.top), parseFloat(g.style.width), parseFloat(g.style.height), 1, gi));
  slide.querySelectorAll<HTMLElement>(":scope > .hbox").forEach(el => {
    const b = boxes[+el.dataset.i!]; if (!b) return;
    Object.assign(el.style, { left: b.x + "px", top: b.y + "px", width: b.w + "px", height: b.h + "px" });
    // handles move outwards past the table's text boxes
    const n = b.notes;
    el.style.setProperty("--nt", (n.top ? b.y - n.top.y : 0) + "px"); el.style.setProperty("--nb", (n.bottom ? n.bottom.y + n.bottom.h - b.y - b.h : 0) + "px");
    el.style.setProperty("--nl", (n.left ? b.x - n.left.x : 0) + "px"); el.style.setProperty("--nr", (n.right ? n.right.x + n.right.w - b.x - b.w : 0) + "px");
  });
  return boxes;
}

/* text boxes: the font shrinks (never below 9 px) until the text fits its box – measured off-screen,
   so it also works for thumbnails and exports, which are built detached from the page */
let measurer: { host: HTMLElement; box: HTMLElement } | null = null;
function fitNotes(slide: HTMLElement, boxes: TBox[], design: string) {
  const notes = slide.querySelectorAll<HTMLElement>(":scope > .tnote:not(.empty)");
  if (!notes.length || typeof document === "undefined" || !document.body) return;
  if (!measurer) {
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:absolute;left:-20000px;top:0;width:1600px;height:900px;visibility:hidden;pointer-events:none;overflow:hidden";
    const box = document.createElement("div"); host.appendChild(box); document.body.appendChild(host);
    measurer = { host, box };
  }
  measurer.host.className = "slide " + design;
  for (const el of Array.from(notes)) {
    const nb = boxes[+el.dataset.i!]?.notes[el.dataset.side as Side]; if (!nb) continue;
    const m = measurer.box;
    m.className = el.className; m.style.cssText = el.style.cssText; m.textContent = el.textContent;
    Object.assign(m.style, { left: "0px", top: "0px", width: nb.w + "px", height: "auto", display: "block" });
    let size = parseFloat(el.style.fontSize) || 18;
    while (size > 9) { m.style.fontSize = size + "px"; if (m.scrollHeight <= nb.h + 1 && m.scrollWidth <= nb.w + 1) break; size -= 1; }
    el.style.fontSize = size + "px";
  }
}

