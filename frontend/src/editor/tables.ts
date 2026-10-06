/* Table geometry tools: column widths / row heights (typed or dragged), copying sizes between tables,
   "make same size" (also across slides), horizontal alignment. Everything becomes table.patch /
   slide.patch operations (one undo step per action). */
import { S } from "../state/store";
import { change, ctx } from "../state/app";
import { buildLayout } from "../xlsx/layout";
import type { TableLayout } from "../xlsx/types";
import type { Layout, Op, RuntimeSlide, TableDef } from "../model/types";
import { computeLayout, layoutOf, tableW } from "../render/slide";
import { glassGeom } from "../render/glass";
import { curSlide, selItems, selTable } from "./edit";
import { A1, parseRange } from "../xlsx/util";

const r1 = (v: number) => Math.round(v * 10) / 10;
/** width of a column as shown (Liquid Glass may have widened it) */
export function shownColW(L: TableLayout, c: number): number {
  const x = ctx();
  return x.style.design === "glass" ? glassGeom(L, x).Wc.get(c) ?? L.colW.get(c)! : L.colW.get(c)!;
}
export const shownRowH = (L: TableLayout, r: number) => L.rowH.get(r)!;

export function selCols(): number[] { const T = selTable(), s = S.sel; return T && s ? T.cols.filter(c => c >= s.c1 && c <= s.c2) : []; }
export function selRows(): number[] { const T = selTable(), s = S.sel; return T && s ? T.rows.filter(r => r >= s.r1 && r <= s.r2) : []; }

const tablePatch = (def: TableDef, patch: Record<string, unknown>): Op => ({ op: "table.patch", id: def.id, patch } as Op);

/** px = null → back to the Excel width */
export function setColWidth(L: TableLayout, cols: number[], px: number | null, label = "Column width") {
  if (!L.def || !cols.length) return;
  const m: Record<string, number | null> = {};
  for (const c of cols) m[c] = px === null ? null : r1(Math.max(4, px));
  change(label, [tablePatch(L.def, { cols: m })]);
}
export function setRowHeight(L: TableLayout, rows: number[], px: number | null, label = "Row height") {
  if (!L.def || !rows.length) return;
  const m: Record<string, number | null> = {};
  for (const r of rows) m[r] = px === null ? null : r1(Math.max(4, px));
  change(label, [tablePatch(L.def, { rows: m })]);
}

/** stretch a table: every column (axis "x") or row ("y") times f – dragging a table border */
export function stretchTable(L: TableLayout, axis: "x" | "y", f: number) {
  if (!L.def || !isFinite(f) || Math.abs(f - 1) < .005) return;
  const m: Record<string, number> = {};
  if (axis === "x") for (const c of L.cols) m[c] = r1(Math.max(4, shownColW(L, c) * f));
  else for (const r of L.rows) m[r] = r1(Math.max(4, shownRowH(L, r) * f));
  change(axis === "x" ? "Table width" : "Table height", [tablePatch(L.def, axis === "x" ? { cols: m } : { rows: m })]);
}

/** every table of the deck with where it is shown */
export interface TableRef { slide: number; i: number; L: TableLayout }
export function allTables(): TableRef[] {
  const out: TableRef[] = [];
  S.slides.forEach((R, slide) => R.tables.forEach((L, i) => { if (L.def) out.push({ slide, i, L }); }));
  return out;
}
const uniqueDefs = (refs: TableRef[]) => { const m = new Map<string, TableLayout>(); for (const r of refs) if (!m.has(r.L.def!.id)) m.set(r.L.def!.id, r.L); return m; };

/** copy column widths and row heights position by position (1st visible column → 1st, …) */
export function copySizes(from: TableLayout, to: TableRef[], what: { cols: boolean; rows: boolean } = { cols: true, rows: true }) {
  const ops: Op[] = [];
  for (const L of uniqueDefs(to).values()) {
    if (L.def!.id === from.def?.id) continue;
    const patch: Record<string, unknown> = {};
    if (what.cols) { const m: Record<string, number> = {}; L.cols.forEach((c, k) => { const src = from.cols[k]; if (src !== undefined) m[c] = r1(shownColW(from, src)); }); patch.cols = m; }
    if (what.rows) { const m: Record<string, number> = {}; L.rows.forEach((r, k) => { const src = from.rows[k]; if (src !== undefined) m[r] = r1(shownRowH(from, src)); }); patch.rows = m; }
    ops.push(tablePatch(L.def!, patch));
  }
  if (ops.length) change("Copy table sizes", ops);
}

export function resetSizes(refs: TableRef[]) {
  const ops = [...uniqueDefs(refs).values()].filter(L => L.def!.cols || L.def!.rows).map(L => tablePatch(L.def!, { cols: null, rows: null }));
  const slides = new Set(refs.map(r => r.slide));
  for (const s of slides) if (S.slides[s].cfg.scale) ops.push({ op: "slide.patch", id: S.slides[s].id, patch: { scale: null } } as Op);
  if (ops.length) change("Reset table sizes", ops);
}

/** Make the chosen tables exactly the same size on the slides: columns and rows are scaled so every
    table has the same width/height in table pixels, the tables get the same weight on their slides,
    and – when they are on several slides – those slides get one common fixed scale (the largest that
    fits all of them). */
export function makeSameSize(refs: TableRef[], opts: { width: boolean; height: boolean; target: "largest" | "smallest" | "first" }) {
  const defs = uniqueDefs(refs); if (defs.size < 1) return { ok: false, why: "Choose at least two tables." };
  const x = ctx(), list = [...defs.values()];
  const Ws = list.map(L => tableW(L, x)), Hs = list.map(L => L.H);
  const pick = (a: number[]) => opts.target === "first" ? a[0] : opts.target === "smallest" ? Math.min(...a) : Math.max(...a);
  const Wt = pick(Ws), Ht = pick(Hs);
  const ops: Op[] = [], newL = new Map<string, TableLayout>();
  list.forEach((L, k) => {
    const patch: Record<string, unknown> = {}, sizes: { cols?: Record<string, number>; rows?: Record<string, number> } = { cols: { ...(L.def!.cols || {}) }, rows: { ...(L.def!.rows || {}) } };
    if (opts.width) { const f = Wt / Ws[k], m: Record<string, number> = {}; for (const c of L.cols) m[c] = r1(shownColW(L, c) * f); patch.cols = m; sizes.cols = m; }
    if (opts.height) { const f = Ht / Hs[k], m: Record<string, number> = {}; for (const r of L.rows) m[r] = r1(shownRowH(L, r) * f); patch.rows = m; sizes.rows = m; }
    ops.push(tablePatch(L.def!, patch));
    const nl = buildLayout(L.sheet, L.g, sizes);
    if (nl) { nl.def = { ...L.def!, ...sizes } as TableDef; nl.id = L.id; nl.items.forEach(it => { it.L = nl; }); newL.set(L.def!.id, nl); }
  });
  // same weight on every slide, and one common scale across slides
  const slides = [...new Set(refs.map(r => r.slide))];
  const tmp = slides.map(si => {
    const R = S.slides[si], base = layoutOf(R);
    const w = base.w.map((v, i) => (R.tables[i].def && defs.has(R.tables[i].def!.id)) ? 1 : v);
    const lay: Layout = { bands: JSON.parse(JSON.stringify(base.bands)), w };
    const tR: RuntimeSlide = { ...R, cfg: { ...R.cfg, scale: undefined, layout: lay }, tables: R.tables.map(L => (L.def && newL.get(L.def.id)) || L), _auto: undefined };
    return { R, lay, fit: computeLayout(tR, x).fit };
  });
  const common = Math.min(...tmp.map(t => t.fit));
  for (const t of tmp) ops.push({ op: "slide.patch", id: t.R.id, patch: { layout: t.lay, scale: slides.length > 1 ? Math.round(common * 10000) / 10000 : null } } as Op);
  change("Make tables the same size", ops);
  return { ok: true, why: "" };
}

export function alignTables(align: "left" | "center" | "right", slideIdx: number[] = [S.cur]) {
  const ops = slideIdx.map(i => S.slides[i]).filter(R => R && R.tables.length).map(R => ({ op: "slide.patch", id: R.id, patch: { align: align === "center" ? null : align } } as Op));
  if (ops.length) change("Align tables " + align, ops);
}
/** vertical position of the tables in the content area; null = the default (slightly above the middle) */
export function valignTables(v: "top" | "middle" | "bottom" | null, slideIdx: number[] = [S.cur]) {
  const ops = slideIdx.map(i => S.slides[i]).filter(R => R && R.tables.length).map(R => ({ op: "slide.patch", id: R.id, patch: { valign: v } } as Op));
  if (ops.length) change(v ? "Align tables " + v : "Default vertical position", ops);
}
export const currentTableRefs = (): TableRef[] => (curSlide()?.tables || []).map((L, i) => ({ slide: S.cur, i, L })).filter(r => r.L.def);

/* ---- merge / unmerge (like Excel: the top-left value is kept) ---- */
import { rangeKey } from "../xlsx/layout";
export function canMerge(): boolean { const s = S.sel; return !!s && !!selTable()?.def && (s.r2 > s.r1 || s.c2 > s.c1); }
export function mergedInSel() { return selItems().filter(it => it.b.m); }
export function mergeSel() {
  const T = selTable(), s = S.sel; if (!T?.def || !s || !canMerge()) return;
  const key = A1(s.r1, s.c1) + ":" + A1(s.r2, s.c2), cur = T.def.merges || {}, patch: Record<string, "merge" | null> = {};
  // a new merge replaces user merges inside it
  for (const [k, v] of Object.entries(cur)) if (v === "merge" && k !== key) { const g = parseRange(k); if (g.r1 <= s.r2 && g.r2 >= s.r1 && g.c1 <= s.c2 && g.c2 >= s.c1) patch[k] = null; }
  patch[key] = "merge";
  change("Merge cells", [tablePatch(T.def, { merges: patch })]);
}
export function unmergeSel() {
  const T = selTable(); if (!T?.def) return;
  const cur = T.def.merges || {}, patch: Record<string, "split" | null> = {};
  for (const it of mergedInSel()) { const k = rangeKey(it.b.m!); patch[k] = cur[k] === "merge" ? null : "split"; }
  if (Object.keys(patch).length) change("Unmerge cells", [tablePatch(T.def, { merges: patch })]);
}
