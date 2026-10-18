/* Where a slide's tables and text boxes go (PLAN S4.2): the content area, the bands of tables and their scale, the text
   boxes beside, above or below them, and a slide's sizing per design (README gotcha 11: sizes are per design – sizingOf /
   sizingPatch / sizingChange). Pure: the core worker draws with it, the page computes drag previews with the same
   functions (stage/drags.ts), so a preview lands where the drawn slide will. */
import type { TableLayout } from "../xlsx/types";
import type { Item, Layout, Note, RuntimeSlide, Side, SlideSizing } from "../model/types";
import type { RenderCtx } from "./context";
import { glassGeom } from "./glass";
import { effNote, titleGeom } from "./text";
import { consultOptions, DESIGNS, isConsult } from "../model/designs";
import { commentText } from "./comment";
import { exhibitFacts, exhibitGeom, exhibitOf, type Exhibit, type ExFacts } from "./exhibit";

export const SLIDE_W = 1600, SLIDE_H = 900;
export const GX = 36, GY = 28, MAXK = 2.0;
export function areaFor(R: RuntimeSlide, ctx?: RenderCtx) {
  // the consulting designs reserve a two-line title band and a rule under it (08 §2.0); the others as v3
  const a = ctx && isConsult(ctx.style.design) ? (R.subtitle ? { x: 50, y: 170, w: 1500, h: 652 } : { x: 50, y: 138, w: 1500, h: 684 })
    : R.subtitle ? { x: 50, y: 126, w: 1500, h: 696 } : { x: 50, y: 104, w: 1500, h: 718 };
  const push = ctx ? Math.min(200, titleGeom(R, ctx).push) : 0;          // larger titles push the tables down
  const b = push ? { ...a, y: a.y + push, h: a.h - push } : a;
  if (!ctx || R.type !== "content" || !isConsult(ctx.style.design)) return b;
  // the consulting designs' options (designs.ts consultOptions; product owner 2026-10-16: hybrids): a KPI line under the
  // title moves the area down (when the first table has a headline), a message panel on the left moves it to x 560–1540,
  // a dark header band keeps NAVY_BAND.gap between its foot and the area (08 §2.6, review/S7b.3/concepts)
  const o = consultOptions(ctx), facts = o.headline !== "none" ? slideFacts(R, ctx)?.facts : null;
  const p = o.headline === "kpi" && facts?.headline ? KPI_LINE.push : o.background === "band" ? NAVY_BAND.push : 0;
  const c = p ? { ...b, y: b.y + p, h: b.h - p } : b;
  return o.headline === "panel" ? { ...c, x: SIGNAL_AREA.x, w: SIGNAL_AREA.w } : c;
}
/** Consulting Navy's KPI line: its top (the content area's top without it, less 4), its height, and how far it moves the
    content area down */
export const KPI_LINE = { dy: -4, h: 100, push: 128 };
/** Consulting Navy's header band: its foot `gap` above the content area; without a KPI line the area moves `push` down */
export const NAVY_BAND = { gap: 16, push: 14 };
/** Consulting Red's content column, right of the message panel (x 0–500) */
export const SIGNAL_AREA = { panel: 500, x: 560, w: 980 };
/* the facts the consulting furniture quotes, of the slide's first table (exhibit.ts); per drawing context, cached on
   the table */
const factCache = new WeakMap<RenderCtx, WeakMap<TableLayout, { ex: Exhibit; facts: ExFacts } | null>>();
export function slideFacts(R: RuntimeSlide, ctx: RenderCtx): { ex: Exhibit; facts: ExFacts } | null {
  const L = R.tables[0];
  if (!L) return null;
  let m = factCache.get(ctx); if (!m) factCache.set(ctx, m = new WeakMap());
  if (m.has(L)) return m.get(L)!;
  const ex = exhibitOf(L, ctx), out = ex.kind === "exhibit" ? { ex, facts: exhibitFacts(ex) } : null;
  m.set(L, out);
  return out;
}
/** a table's natural size as drawn: Liquid Glass widens columns (glassGeom), the consulting designs draw an exhibit of
    their own size (exhibit.ts); the others draw the workbook's geometry */
/** which geometry a design's tables are drawn on: the Liquid Glass scene's (glassGeom: columns widened for the scene's
    font – Liquid Glass, and the consulting designs' tables "cards"), an exhibit's own (the consulting designs' tables
    "exhibit"), or the workbook's (Excel, Excel Refined, the consulting designs' tables "rules") */
export function geomOf(ctx: RenderCtx): "scene" | "exhibit" | "workbook" {
  const d = ctx.style.design;
  if (d === "glass") return "scene";
  if (!isConsult(d)) return "workbook";
  const t = consultOptions(ctx).tables;
  return t === "cards" ? "scene" : t === "exhibit" ? "exhibit" : "workbook";
}
export const tableW = (L: TableLayout, ctx: RenderCtx) => { const g = geomOf(ctx); return g === "scene" ? glassGeom(L, ctx).W : g === "exhibit" ? exhibitGeom(L, ctx).W : L.W; };
export const tableH = (L: TableLayout, ctx: RenderCtx) => geomOf(ctx) === "exhibit" ? exhibitGeom(L, ctx).H : L.H;

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
export interface TBox { i: number; band: number; x: number; y: number; w: number; h: number; scale: number; notes: Partial<Record<Side, NoteBox>>;
  /** the slide items attached to this table (07 §2.2 `attach`), by item id: laid out beside it as text boxes are */ items?: Record<string, NoteBox> }
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
/** the slide's items attached to a side of table i (charts, callouts: 07 §2.2), in the slide's item order */
export function attachedOf(R: RuntimeSlide, i: number): Partial<Record<Side, { id: string; w: number; h: number }[]>> {
  const out: Partial<Record<Side, { id: string; w: number; h: number }[]>> = {}, T = R.tables[i], items = R.cfg.items;
  if (!T || !items) return out;
  for (const [id, it] of Object.entries(items) as [string, Item][]) {
    const a = it && it.attach, b = it && it.box;
    // (a shared document's box: finite numbers only, at most the slide's size)
    if (!a || !b || a.table !== (T.id || T.def?.id) || !SIDES.includes(a.side) || typeof b.w !== "number" || typeof b.h !== "number" || !Number.isFinite(b.w) || !Number.isFinite(b.h) || b.w <= 0 || b.h <= 0) continue;
    (out[a.side] ||= []).push({ id, w: Math.min(SLIDE_W, b.w), h: Math.min(SLIDE_H, b.h) });
  }
  return out;
}
/** where item `id` of the slide is drawn: beside its table (computeLayout's box), else at its own box; null for an item
    without a valid box */
export function itemBoxOf(R: RuntimeSlide, id: string, boxes: TBox[]): { x: number; y: number; w: number; h: number } | null {
  for (const b of boxes) { const n = b?.items?.[id]; if (n) return { x: n.x, y: n.y, w: n.w, h: n.h }; }
  const b = R.cfg.items?.[id]?.box;
  return b && [b.x, b.y, b.w, b.h].every(v => typeof v === "number" && Number.isFinite(v)) && b.w > 0 && b.h > 0 ? { x: b.x, y: b.y, w: Math.min(SLIDE_W, b.w), h: Math.min(SLIDE_H, b.h) } : null;
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
  // a side's text box sits next to the table, the items attached to that side beyond it (07 §2.2: charts, callouts)
  const AT = T.map((_, i) => attachedOf(R, i)), along = (l: { w: number; h: number }[] | undefined, k: "w" | "h") => (l || []).reduce((s, x) => s + x[k] + NOTE_GAP, 0);
  const nx = N.map(n => ({ l: n.left ? noteW(n.left) + NOTE_GAP : 0, r: n.right ? noteW(n.right) + NOTE_GAP : 0, t: n.top ? noteH(n.top) + NOTE_GAP : 0, b: n.bottom ? noteH(n.bottom) + NOTE_GAP : 0 }));
  const ex = nx.map((e, i) => ({ l: e.l + along(AT[i].left, "w"), r: e.r + along(AT[i].right, "w"), t: e.t + along(AT[i].top, "h"), b: e.b + along(AT[i].bottom, "h") }));
  // text boxes stretched by the user: a side box taller than its table, a box above/below wider than it (and items)
  const most = (l: { w: number; h: number }[] | undefined, k: "w" | "h") => Math.max(0, ...(l || []).map(x => x[k]));
  const sideH = (i: number) => Math.max(N[i].left?.h || 0, N[i].right?.h || 0, most(AT[i].left, "h"), most(AT[i].right, "h"));
  const tbW = (i: number) => Math.max(N[i].top?.w || 0, N[i].bottom?.w || 0, most(AT[i].top, "w"), most(AT[i].bottom, "w"));
  const unitW = (i: number, k: number) => Math.max(tableW(T[i], ctx) * ww[i] * k, tbW(i)) + ex[i].l + ex[i].r;
  const unitH = (i: number, k: number) => Math.max(tableH(T[i], ctx) * ww[i] * k, sideH(i)) + ex[i].t + ex[i].b;
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
      const sc = k * ww[i], tw = tableW(T[i], ctx) * sc, th = tableH(T[i], ctx) * sc;
      const bx = x + ex[i].l, by = top + y + ex[i].t, n = N[i], notes: TBox["notes"] = {};
      const sh = Math.max(th, sideH(i));
      if (n.top) notes.top = { x: bx, y: by - nx[i].t, w: n.top.w || tw, h: nx[i].t - NOTE_GAP };
      if (n.bottom) notes.bottom = { x: bx, y: sh + by + NOTE_GAP, w: n.bottom.w || tw, h: nx[i].b - NOTE_GAP };
      if (n.left) notes.left = { x: bx - nx[i].l, y: by, w: nx[i].l - NOTE_GAP, h: n.left.h || th };
      if (n.right) notes.right = { x: bx + tw + NOTE_GAP, y: by, w: nx[i].r - NOTE_GAP, h: n.right.h || th };
      boxes[i] = { i, band: bi, x: bx, y: by, w: tw, h: th, scale: sc, notes };
      // the attached items, outwards from the table (and its text box on that side), at their own size
      const At = AT[i], items: Record<string, NoteBox> = {};
      let o = nx[i].r; for (const a of At.right || []) { items[a.id] = { x: bx + tw + NOTE_GAP + o, y: by, w: a.w, h: a.h }; o += a.w + NOTE_GAP; }
      o = nx[i].l; for (const a of At.left || []) { o += a.w + NOTE_GAP; items[a.id] = { x: bx - o, y: by, w: a.w, h: a.h }; }
      o = nx[i].t; for (const a of At.top || []) { o += a.h + NOTE_GAP; items[a.id] = { x: bx, y: by - o, w: a.w, h: a.h }; }
      o = nx[i].b; for (const a of At.bottom || []) { items[a.id] = { x: bx, y: sh + by + NOTE_GAP + o, w: a.w, h: a.h }; o += a.h + NOTE_GAP; }
      if (Object.keys(items).length) boxes[i].items = items;
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
