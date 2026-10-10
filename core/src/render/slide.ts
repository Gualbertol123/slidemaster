/* Slide composition: tables arranged in bands, title, cover/index, page number, logo. */
import { esc } from "../xlsx/util";
import type { TableLayout } from "../xlsx/types";
import type { Layout, Note, RuntimeSlide, Side, SlideSizing } from "../model/types";
import { glassLevel, themeOf } from "../model/style";
import { darken, hexRgb } from "../xlsx/color";
import { tableName } from "../model/preset";
import { tableKey, type RenderCtx } from "./context";
import { renderExcel } from "./excel";
import { palette } from "../model/style";
import { glassGeom, renderGlass } from "./glass";
import { coverHtml, indexHtml } from "./cover";
import { footerHtml, pageNoBox, pageNoFor, pageNoHtml } from "./pagenumbers";
import { todayLabel } from "./cover";
import { cache } from "./edits";
import { effNote, fmtCss, hasMarkup, richText, slideTextFmt, titleGeom } from "./text";
import { commentText } from "./comment";
import type { NoteMeasure, TextMeasurer } from "../platform";

export const SLIDE_W = 1600, SLIDE_H = 900;
export const GX = 36, GY = 28, MAXK = 2.0;
export function areaFor(R: RuntimeSlide, ctx?: RenderCtx) {
  const a = R.subtitle ? { x: 50, y: 126, w: 1500, h: 696 } : { x: 50, y: 104, w: 1500, h: 718 };
  const push = ctx ? Math.min(200, titleGeom(R, ctx).push) : 0;          // larger titles push the tables down
  return push ? { ...a, y: a.y + push, h: a.h - push } : a;
}
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
/* Table sizing (arrangement, weights, fixed scale) is kept per design: the designs draw the tables at
   different sizes and only Liquid Glass and Excel Refined have text boxes, so sizing set in one design
   must not shrink the tables of another. Older decks have one shared sizing (cfg.layout/cfg.scale): it
   is used by every design without its own; raw Excel corrects the shared scale for the room the text
   boxes took in the design it was made in. */
export type Sizing = { layout?: Layout | null; scale?: number | null; align?: SlideSizing["align"] | null; valign?: SlideSizing["valign"] | null };
export function sizingOf(R: RuntimeSlide, ctx: RenderCtx): Sizing & { own: boolean } {
  const own = R.cfg?.sizes?.[ctx.style.design];
  if (own) return { layout: own.layout, scale: own.scale, align: own.align, valign: own.valign, own: true };
  return { layout: R.cfg?.layout, scale: R.cfg?.scale, align: R.cfg?.align, valign: R.cfg?.valign, own: false };
}
/** a slide.patch that gives the current design its own sizing; designs still on the shared sizing
    keep what they show now (it is copied into their own entries) */
export function sizingPatch(R: RuntimeSlide, ctx: RenderCtx, entry: Sizing) {
  const sizes: Record<string, unknown> = {}, d = ctx.style.design;
  if (R.cfg.layout || R.cfg.scale || R.cfg.align || R.cfg.valign) for (const o of DESIGNS) if (o !== d && !R.cfg.sizes?.[o]) {
    const oc = { ...ctx, style: { ...ctx.style, design: o } }, sc = fixedScale(R, oc);
    sizes[o] = clean({ layout: R.cfg.layout, scale: sc ? Math.round(sc * 10000) / 10000 : null, align: R.cfg.align, valign: R.cfg.valign });
  }
  // an entry that sets nothing still marks the design as having its own (automatic) sizing
  sizes[d] = clean(entry);
  return { layout: null, scale: null, align: null, valign: null, sizes };
}
/** a sizing patch that changes only some fields of the current design's sizing */
export const sizingChange = (R: RuntimeSlide, ctx: RenderCtx, ch: Sizing) => { const { own: _o, ...cur } = sizingOf(R, ctx); return sizingPatch(R, ctx, { ...cur, ...ch }); };
const DESIGNS = ["glass", "excel", "clean"] as const;
const clean = (e: Sizing): SlideSizing => ({ ...(e.layout ? { layout: e.layout } : {}), ...(e.scale ? { scale: e.scale } : {}), ...(e.align && e.align !== "center" ? { align: e.align } : {}), ...(e.valign ? { valign: e.valign } : {}) });
/** the fixed scale of the slide in this design ("Make same size"), 0 = none */
function fixedScale(R: RuntimeSlide, ctx: RenderCtx): number {
  const sz = sizingOf(R, ctx), s = sz.scale && sz.scale > 0 ? sz.scale : 0;
  if (!s || sz.own || ctx.style.design !== "excel" || !R.cfg.notes || !Object.keys(R.cfg.notes).length) return s;
  // shared scale made with text boxes: grow it by as much as the missing text boxes let the tables grow
  const withNotes = computeLayout({ ...R, cfg: { ...R.cfg, scale: undefined } }, { ...ctx, style: { ...ctx.style, design: "clean" } }).fit;
  const bare = computeLayout({ ...R, cfg: { ...R.cfg, scale: undefined } }, ctx).fit;
  return withNotes > 0 ? s * bare / withNotes : s;
}
export function layoutOf(R: RuntimeSlide, ctx?: RenderCtx): Layout {
  const saved = ctx ? sizingOf(R, ctx).layout : R.cfg && R.cfg.layout;
  if (validLayout(saved, R.tables.length)) return saved;
  if (!R._auto || R._auto.w.length !== R.tables.length) R._auto = defaultLayout(R);
  return R._auto;
}
export interface NoteBox { x: number; y: number; w: number; h: number; /** placed freely on the slide (moved by the user) */ free?: boolean }
export interface TBox { i: number; band: number; x: number; y: number; w: number; h: number; scale: number; notes: Partial<Record<Side, NoteBox>> }
export const NOTE_GAP = 14, NOTE_W = 240;
/** the slide's notes section: a text box of the slide (not of a table), key in SlideDef.notes */
export const MEMO_KEY = "slide:notes";
/** where the notes section is: where the user put it, else where the footer goes (bottom left) */
export const memoBox = (n: Note) => ({ x: n.x ?? 56, y: n.y ?? 832, w: n.w || 900, h: n.h || 44 });
export const SIDES: Side[] = ["top", "bottom", "left", "right"];
export const noteKey = (R: RuntimeSlide, i: number, side: Side) => (R.tables[i].id || String(i)) + ":" + side;
/** the text boxes of table i, with the deck's text box style applied */
export function notesOf(R: RuntimeSlide, i: number, ctx?: RenderCtx): Partial<Record<Side, Note>> {
  const out: Partial<Record<Side, Note>> = {}, all = R.cfg.notes || {};
  if (ctx && ctx.style.design === "excel") return out;                 // raw Excel: nothing added to the workbook's tables
  for (const side of SIDES) {
    const n = all[noteKey(R, i, side)]; if (!n) continue;
    const e = ctx ? effNote(ctx, n) : n;
    // automated comment: written from the table's current numbers
    out[side] = ctx && n.auto && R.tables[i] ? { ...e, text: commentText(R.tables[i], n.auto, ctx, R) } : e;
  }
  return out;
}
/** height of a text box above/below a table: explicit, or from its lines (wrapping is handled by shrinking the font) */
const noteH = (n: Note) => n.h || Math.max(30, Math.max(1, String(n.text || "").split("\n").length) * (n.size || 18) * (n.lh || 1.28) + 12) + (n.bubble ? 20 : 0);
const noteW = (n: Note) => n.w || NOTE_W;

/** Tables (plus their text boxes) in bands. k = largest scale ≤ MAXK that fits the content area – or the
    slide's fixed scale (set by "Make same size"), reduced only if it would not fit. */
export function computeLayout(R: RuntimeSlide, ctx: RenderCtx, w?: number[], lay?: Layout): { boxes: TBox[]; k: number; fit: number; reduced: boolean } {
  if (!R.tables.length) return { boxes: [], k: 1, fit: 1, reduced: false };
  lay = lay || layoutOf(R, ctx); const ww = w || lay.w; const T = R.tables, A0 = areaFor(R, ctx);
  const bands = lay.bands.filter(b => b.length);
  const N = T.map((_, i) => notesOf(R, i, ctx));
  // text boxes "beside all tables" (span): a column at the left/right of the content area, as tall as all
  // the tables; the tables are laid out in the remaining width
  const spans: { i: number; side: "left" | "right"; n: Note }[] = [];
  // text boxes moved by the user sit where they were put and take no room from the tables
  const frees: { i: number; side: Side; n: Note }[] = [];
  N.forEach((ns, i) => SIDES.forEach(sd => { const n = ns[sd]; if (n && n.x != null && n.y != null) { frees.push({ i, side: sd, n }); delete ns[sd]; } }));
  N.forEach((ns, i) => (["left", "right"] as const).forEach(sd => { const n = ns[sd]; if (n?.span) { spans.push({ i, side: sd, n }); delete ns[sd]; } }));
  const colR = Math.max(0, ...spans.filter(x => x.side === "right").map(x => noteW(x.n))), colL = Math.max(0, ...spans.filter(x => x.side === "left").map(x => noteW(x.n)));
  const A = { ...A0, x: A0.x + (colL ? colL + NOTE_GAP * 2 : 0), w: A0.w - (colL ? colL + NOTE_GAP * 2 : 0) - (colR ? colR + NOTE_GAP * 2 : 0) };
  const ex = N.map(n => ({ l: n.left ? noteW(n.left) + NOTE_GAP : 0, r: n.right ? noteW(n.right) + NOTE_GAP : 0, t: n.top ? noteH(n.top) + NOTE_GAP : 0, b: n.bottom ? noteH(n.bottom) + NOTE_GAP : 0 }));
  // text boxes stretched by the user: a side box taller than its table, a box above/below wider than it
  const sideH = (i: number) => Math.max(N[i].left?.h || 0, N[i].right?.h || 0);
  const tbW = (i: number) => Math.max(N[i].top?.w || 0, N[i].bottom?.w || 0);
  const unitW = (i: number, k: number) => Math.max(tableW(T[i], ctx) * ww[i] * k, tbW(i)) + ex[i].l + ex[i].r;
  const unitH = (i: number, k: number) => Math.max(T[i].H * ww[i] * k, sideH(i)) + ex[i].t + ex[i].b;
  const fits = (k: number) => {
    let h = GY * (bands.length - 1);
    for (const b of bands) { let bw = GX * (b.length - 1); for (const i of b) bw += unitW(i, k); if (bw > A.w + .01) return false; h += Math.max(...b.map(i => unitH(i, k))); }
    return h <= A.h + .01;
  };
  let lo = 0.01, hi = MAXK;
  if (fits(hi)) lo = hi; else for (let n = 0; n < 40; n++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; }
  const fit = lo, fixed = fixedScale(R, ctx);
  const k = fixed ? Math.min(fixed, fit) : fit;
  const boxes: TBox[] = []; let y = 0;
  const dims = bands.map(b => ({ w: b.reduce((s, i) => s + unitW(i, k), 0) + GX * (b.length - 1), h: Math.max(...b.map(i => unitH(i, k))) }));
  const Htot = dims.reduce((s, d) => s + d.h, 0) + GY * (bands.length - 1);
  const sz = sizingOf(R, ctx), free = Math.max(0, A.h - Htot), va = sz.valign;
  const top = A.y + (va === "top" ? 0 : va === "middle" ? free / 2 : va === "bottom" ? free : free / 2 * 0.35);
  const align = sz.align || "center";
  bands.forEach((b, bi) => {
    let x = A.x + (align === "left" ? 0 : align === "right" ? A.w - dims[bi].w : (A.w - dims[bi].w) / 2);
    for (const i of b) {
      const sc = k * ww[i], tw = tableW(T[i], ctx) * sc, th = T[i].H * sc;
      const bx = x + ex[i].l, by = top + y + ex[i].t, n = N[i], notes: TBox["notes"] = {};
      const sh = Math.max(th, sideH(i));
      if (n.top) notes.top = { x: bx, y: by - ex[i].t, w: n.top.w || tw, h: ex[i].t - NOTE_GAP };
      if (n.bottom) notes.bottom = { x: bx, y: sh + by + NOTE_GAP, w: n.bottom.w || tw, h: ex[i].b - NOTE_GAP };
      if (n.left) notes.left = { x: bx - ex[i].l, y: by, w: ex[i].l - NOTE_GAP, h: n.left.h || th };
      if (n.right) notes.right = { x: bx + tw + NOTE_GAP, y: by, w: ex[i].r - NOTE_GAP, h: n.right.h || th };
      boxes[i] = { i, band: bi, x: bx, y: by, w: tw, h: th, scale: sc, notes };
      x += unitW(i, k) + GX;
    }
    y += dims[bi].h + GY;
  });
  // the spanning column sits next to the tables actually drawn (not the far edge of the slide)
  if (spans.length) {
    const xs = boxes.filter(Boolean).flatMap(b => [b.x, b.x + b.w, ...Object.values(b.notes).flatMap(n => n ? [n.x, n.x + n.w] : [])]);
    const left = Math.min(...xs), right = Math.max(...xs);
    for (const { i, side, n } of spans) {
      const wN = noteW(n), h = n.h || Htot;
      boxes[i].notes[side] = { x: side === "right" ? Math.min(A0.x + A0.w - wN, right + NOTE_GAP * 2) : Math.max(A0.x, left - NOTE_GAP * 2 - wN), y: top, w: wN, h };
    }
  }
  for (const { i, side, n } of frees) boxes[i].notes[side] = { x: n.x!, y: n.y!, w: n.w || NOTE_W, h: n.h || noteH(n), free: true };
  return { boxes, k, fit, reduced: !!fixed && fit < fixed - 1e-6 };
}

export function tableHtml(R: RuntimeSlide, i: number, ctx: RenderCtx, thumb = false): string {
  const L = R.tables[i], d = ctx.style.design, key = d + "|" + glassLevel(ctx.style) + "|" + tableKey(ctx, L) + "|" + (ctx.forExport ? 1 : 0);
  if (thumb && L.items.length > 1200)              // thumbnails of big tables: shapes only, no text
    return cache(L, "thtml", key, () => d === "glass" ? renderGlass(L, ctx, { noText: true }) : renderExcel(L, ctx, { noText: true }));
  // Excel Refined = the Excel tables exactly as in the workbook (same colours); it only adds text boxes and comments
  return cache(L, "html", key, () => d === "glass" ? renderGlass(L, ctx) : renderExcel(L, ctx));
}
export const slideHasLogo = (R: RuntimeSlide) => !(R.cfg && R.cfg.logo === false);
/** contrast 0…100 (50 = as designed): lower fades the wallpaper (and glass) towards white,
    higher deepens the wallpaper and whitens the glass surfaces */
export function contrastVars(contrast: number): Record<string, string> {
  const ct = Math.max(0, Math.min(100, contrast)) / 100;
  if (ct < .5) { const f = (.5 - ct) * 1.4; return { "--wfade": f.toFixed(3), "--gfade": (f * .6).toFixed(3) }; }
  const u = ct - .5;
  return { "--wfade": "0", "--gfade": (u * .9).toFixed(3) };              // the deeper wallpaper itself: render/wallpaper.ts
}

/** accent colours of the theme as CSS variables (none for the default theme: the CSS has its values) */
export function themeVars(ctx: RenderCtx): Record<string, string> {
  const t = themeOf(ctx.style), o = ctx.style.colors || {}, P = palette(ctx.style), v: Record<string, string> = {};
  if (t.id !== "aurora" || o.accent) {
    const a1 = o.accent || t.a1, x = o.accent || t.x;
    Object.assign(v, { "--a1": a1, "--a2": o.accent ? a1 : t.a2, "--a1rgb": hexRgb(a1).join(","), "--a2rgb": hexRgb(o.accent ? a1 : t.a2).join(","), "--x1": x, "--x2": darken(x, .6), "--ixink": darken(a1, .55) });
  }
  // overrides that every design reads from CSS variables
  if (o.pos) v["--posrgb"] = hexRgb(P.pos).join(",");
  if (o.neg) v["--negrgb"] = hexRgb(P.neg).join(",");
  if (o.bg && ctx.style.design !== "glass") v["--slidebg"] = P.bg;
  return v;
}
export interface SlideOpts { interactive?: boolean; thumb?: boolean }
/** a slide as markup: the slide element's class and CSS variables, and its inner HTML (placed and fitted by the page) */
export interface SlideMarkup { className: string; vars: [string, string][]; html: string }
export function slideMarkup(R: RuntimeSlide, idx: number, ctx: RenderCtx, opts: SlideOpts = {}): SlideMarkup {
  const d = ctx.style.design, glassy = d === "glass", rk = ctx.style.radius / 100;
  const className = "slide " + (d === "clean" ? "excel clean" : d) + (R.type !== "content" ? " " + R.type : "");
  const vars: [string, string][] = [["--rk", String(rk)]];
  for (const [k, v] of Object.entries(themeVars(ctx))) vars.push([k, v]);
  if (glassy) {
    vars.push(["--gi", String(glassLevel(ctx.style))], ["--amt", String((+ctx.style.color || 0) / 100)]);
    for (const [k, v] of Object.entries(contrastVars(ctx.style.contrast))) vars.push([k, v]);
  }
  const pageNo = pageNoFor(ctx, idx);
  const logo = slideHasLogo(R) ? ctx.logoSrc : "", cover = R.type === "cover";
  let h = glassy ? `<div class="wall"></div>` : "";
  // a page number in the top-left corner pushes the title to the right
  const shift = pageNo !== null && ctx.style.pn.pos === "tl" ? pageNoBox(ctx, pageNo, glassy).w + 22 : 0, sh = shift ? `left:${56 + shift}px;` : "";
  if (cover) h += coverHtml(R, glassy, rk, ctx);
  else {
    h += `<div class="title" data-edit="title" style="${sh}${fmtCss(slideTextFmt(ctx, R, "title"))}">${esc(R.title)}</div>`;
    if (R.subtitle) h += `<div class="subtitle" data-edit="subtitle" style="${sh}top:${titleGeom(R, ctx).subTop}px;${fmtCss(slideTextFmt(ctx, R, "subtitle"))}">${esc(R.subtitle)}</div>`;
  }
  if (R.type === "index") h += indexHtml(R, ctx, glassy);
  if (pageNo !== null) h += pageNoHtml(ctx, pageNo, glassy, !!logo, cover);
  h += footerHtml(ctx, idx, glassy, !!logo, cover, pageNo, todayLabel());
  R.tables.forEach((t, i) => {
    h += `<div class="tw" data-i="${i}" style="width:${tableW(t, ctx)}px;height:${t.H}px">${tableHtml(R, i, ctx, opts.thumb)}${opts.interactive ? `<div class="hits" data-t="${i}" style="width:${tableW(t, ctx)}px;height:${t.H}px"><div class="hov"></div></div>` : ""}</div>`;
    const ns = notesOf(R, i, ctx);
    for (const side of SIDES) {
      const n = ns[side]; if (!n) continue;
      const txt = String(n.text || "");
      if (!txt.trim() && !opts.interactive) continue;
      const st = [`font-size:${n.size || 18}px`, fmtCss({ font: n.font, b: n.b || undefined, i: n.i || undefined, color: n.color }, { size: false, align: false }), `text-align:${n.align || (side === "left" ? "right" : "left")}`, n.lh ? `line-height:${n.lh}` : "", n.pgap != null ? `--pgap:${n.pgap}em` : "",
        n.valign ? `justify-content:${n.valign === "top" ? "flex-start" : n.valign === "middle" ? "center" : "flex-end"}` : ""].filter(Boolean).join(";");
      // a bubble behind the text: a glass card like the tables' (Liquid Glass) or a framed box (Excel)
      if (n.bubble && txt.trim()) h += glassy ? `<div class="gls wb card notebub" data-i="${i}" data-side="${side}" style="border-radius:${Math.round(22 * rk)}px"></div>`
        : `<div class="notebub x" data-i="${i}" data-side="${side}" style="border-radius:${Math.round(8 * rk)}px"></div>`;
      h += `<div class="tnote ${side}${n.bubble ? " bub" : ""}${n.auto ? " auto" : ""}${n.x != null && n.y != null ? " free" : ""}${txt.trim() ? "" : " empty"}" data-note="${esc(noteKey(R, i, side))}" data-i="${i}" data-side="${side}" style="${st}">${!txt.trim() ? "Double-click to write" : hasMarkup(txt) || n.pgap != null ? richText(txt) : esc(txt)}</div>`;
    }
  });
  // the slide's notes section (sources, footnotes…): a text box of the slide itself, placed where the user
  // put it – by default where the footer is; not in raw Excel
  const memo = d === "excel" ? null : (R.cfg.notes || {})[MEMO_KEY];
  if (memo && (String(memo.text || "").trim() || opts.interactive)) {
    const n = effNote(ctx, memo), txt = String(n.text || ""), mb = memoBox(memo);
    const pos = `left:${mb.x}px;top:${mb.y}px;width:${mb.w}px;height:${mb.h}px`;
    const st = [pos, `font-size:${n.size || 13}px`, fmtCss({ font: n.font, b: n.b || undefined, i: n.i || undefined, color: n.color }, { size: false, align: false }), `text-align:${n.align || "left"}`,
      n.lh ? `line-height:${n.lh}` : "", n.pgap != null ? `--pgap:${n.pgap}em` : "", `justify-content:${n.valign === "top" ? "flex-start" : n.valign === "bottom" ? "flex-end" : "center"}`].filter(Boolean).join(";");
    if (n.bubble && txt.trim()) h += glassy ? `<div class="gls wb card notebub memo" data-i="-1" data-side="bottom" style="${pos};border-radius:${Math.round(16 * rk)}px"></div>` : `<div class="notebub x memo" data-i="-1" data-side="bottom" style="${pos};border-radius:${Math.round(8 * rk)}px"></div>`;
    h += `<div class="tnote memo free bottom${n.bubble ? " bub" : ""}${txt.trim() ? "" : " empty"}" data-note="${MEMO_KEY}" data-i="-1" data-side="bottom" style="${st}">${!txt.trim() ? "Notes – double-click to write" : hasMarkup(txt) || n.pgap != null ? richText(txt) : esc(txt)}</div>`;
  }
  if (opts.interactive) h += R.tables.map((t, i) => `<div class="hbox" data-i="${i}"><div class="grip" title="Drag to move this table">⠿ ${esc(tableName(t, ctx.preset))}</div><div class="size" title="Drag to resize (keeps the proportions)"></div>${(["l", "r", "t", "b"] as const).map(e => `<div class="edge ${e}" data-edge="${e}" title="Drag to make the table ${e === "l" || e === "r" ? "wider or narrower" : "taller or shorter"}"></div>`).join("")}${d === "excel" ? "" : SIDES.map(sd => `<button class="addnote ${sd}" data-side="${sd}" title="Add a text box ${sd === "top" ? "above" : sd === "bottom" ? "below" : "on the " + sd}">+</button>`).join("")}</div>`).join("") + `<div class="dropmark"></div>`;
  if (R.type === "content" && !R.tables.length && opts.interactive) h += `<div class="emptyslide">No tables on this slide – add some with the wizard.</div>`;
  if (logo) {
    const lx = cover ? 1150 : 1256, ly = cover ? 800 : 832, lw = cover ? 400 : 314, lh = cover ? 68 : 52;
    h += glassy
      ? (ctx.style.logoBubble
        ? `<div class="gls wb chrome logowrap" style="left:${lx}px;top:${ly}px;width:${lw}px;height:${lh}px;border-radius:${Math.min(lh / 2, lh / 2 * rk)}px"><img class="logo" src="${esc(logo)}" alt=""></div>`
        : `<div class="logowrap plain" style="left:${lx}px;top:${ly}px;width:${lw}px;height:${lh}px"><img class="logo" src="${esc(logo)}" alt=""></div>`)
      : `<div class="logowrap${cover ? " big" : ""}"><img class="logo" src="${esc(logo)}" alt=""></div>`;
  }
  return { className, vars, html: h };
}

/** text boxes: the font shrinks (never below 9 px) until the text fits its box */
export function fitNoteSize(note: NoteMeasure, start: number, m: TextMeasurer): number {
  let size = start;
  while (size > 9) { if (m.noteFits(note, size)) break; size -= 1; }
  return size;
}
