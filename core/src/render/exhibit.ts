/* Consulting designs as data exhibits (product owner, 2026-10-16: Consulting Navy = "Insight board", Consulting Red =
   "Signal"; docs/next/08-consulting-designs.md §2.6, review/S7b.3/concepts/). A table is read for its meaning – the label
   column, the body rows, the total row, a series of period columns (Week37 … Week39), reference columns (Budget) and
   variance groups ("Δ vs. Budget": an absolute and a % column) – so the designs can draw it as an exhibit (trend lines,
   diverging bars, a KPI line, a message panel) instead of a grid. Every number shown is a cell of the table (effItems:
   edits, versions and the scenario overlay included); nothing is invented. A table that does not read as an exhibit
   (no numeric columns, no labels) is `kind: "plain"` and drawn as a clean typographic table. Pure; shared by the core
   worker (drawing) and the page (hit-testing: exhibitBoxes). */
import type { Item, TableLayout } from "../xlsx/types";
import type { RenderCtx } from "./context";
import { tableKey } from "./context";
import { cache, effItems } from "./edits";
import { analysisOf, gridOf } from "./comment";
import { cleanHead, TOTAL } from "../model/comment";
import { consultOptions } from "../model/designs";

/** one cell of the exhibit: the item (for its hit, text and edits) and its value when it is a number */
export interface ExCell { it: Item; r: number; c: number; text: string; v: number | null }
/** body: a row of its own (the bars' scales, the facts); sub: a subtotal, an "of which" or a bold block head – drawn bold,
    not counted; total: the table's total (a "Grand total", else a "Total…" row at the top or the bottom) */
export interface ExRow { r: number; kind: "body" | "sub" | "total"; label: ExCell | null; cells: Map<number, ExCell> }
/** consecutive period columns (their header texts), oldest first */
export interface ExSeries { cols: number[]; labels: string[] }
/** a reference column (Budget, Plan, Target, Prior year …) */
export interface ExRef { col: number; label: string }
/** a variance group: its label without "Δ" ("vs Budget"), its absolute and its % column (either may be missing) */
export interface ExDelta { label: string; abs: number | null; pct: number | null }
export interface Exhibit {
  kind: "exhibit" | "plain";
  labelCol: number;
  /** header rows (their texts, for a plain table's head) */ head: number[];
  rows: ExRow[]; total: ExRow | null;
  series: ExSeries | null; refs: ExRef[]; deltas: ExDelta[];
}
/** the facts the slide-level elements quote (Navy's KPI line, Red's message panel); each one a cell of the table */
export interface ExFact { label: string; value: ExCell; pct: ExCell | null }
export interface ExFacts {
  /** the total's latest period value (or its first numeric cell) and what it is ("Total banks loans · Week39") */
  headline: ExFact | null;
  /** the total's variances, at most three, in a stable order: vs previous period, vs a reference (budget), the longest horizon */
  kpis: ExFact[];
  /** the variance the message panel leads with (vs budget if there is one, else the first) */ lead: ExFact | null;
  /** how many body rows are below zero on the lead variance, of how many have a value */ short: { n: number; of: number } | null;
  /** the body row with the most negative lead variance */ worst: { label: string; abs: ExCell | null; pct: ExCell | null } | null;
}

/* ---- reading a table. Rows and columns are SHEET numbers (ExRow.r, ExCell.r / .c, labelCol, ExSeries.cols, ExRef.col,
   ExDelta.abs / .pct), as items' b.r / b.c. Values: the comments' grid (gridOf: the cell's number, or its effective text
   parsed as the comments do; a cell removed in the version shown has none) */
const COMPARE = /Δ|∆|\bvs\.?\b|\bvar\.?\b|delta|change|chg|diff/i;
const PLANISH = /budget|bdg|plan|target|forecast|fcst|objective|\bpy\b|prior|last year|\bly\b/i;
/** a period header: Week39 / W39 / Wk 39, a month, a quarter, a half, a year, a date */
const PERIOD = /^(w(ee)?k?\.?\s*\d{1,2}|q[1-4](\s*'?\d{2,4})?|h[12](\s*\d{2,4})?|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(\s*'?\d{2,4})?|(fy\s*)?(19|20)\d\d|\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?|m\d{1,2})$/i;

/** the table read as an exhibit (cached per table, like effItems) */
export function exhibitOf(L: TableLayout, ctx: RenderCtx): Exhibit {
  return cache(L, "exhibit", tableKey(ctx, L), () => {
    const a = analysisOf(L, ctx), g = gridOf(L, ctx), C = L.cols.length;
    const items = new Map(effItems(L, ctx).map(it => [it.b.r + "," + it.b.c, it]));
    const cellAt = (ri: number, ci: number): ExCell | null => {
      const r = L.rows[ri], c = L.cols[ci], it = items.get(r + "," + c), x = g[ri]?.[ci];
      return it && x && x.anchor ? { it, r, c, text: it.removed ? "" : String(it.text || ""), v: x.v } : null;
    };
    // a leading row of whole numbers 1900–2100 ("Region | 2023 | 2024", years Excel stores as numbers) is a header row
    const yearRow = (ri: number) => { const xs = g[ri].slice(a.labelCol + 1).filter(x => x.anchor && x.v !== null); return xs.length > 0 && xs.every(x => Number.isInteger(x.v) && x.v! >= 1900 && x.v! <= 2100); };
    let k0 = 0; while (k0 < a.rows.length && !TOTAL.test(a.rows[k0].label) && yearRow(a.rows[k0].r)) k0++;
    const rowsA = a.rows.slice(k0);
    const first = rowsA.length ? rowsA[0].r : g.length;
    const head = L.rows.slice(0, first).filter((_r, i) => g[i].some(x => x.text.trim()));
    const plain: Exhibit = { kind: "plain", labelCol: L.cols[a.labelCol] ?? L.cols[0], head, rows: [], total: null, series: null, refs: [], deltas: [] };
    if (!rowsA.length) return plain;                                                   // no labelled numeric rows
    // a caption merged across every number column ("Loans (mln €)") is no number column's head
    const caps = new Set(C - a.labelCol > 2 ? captions(L, ctx, head, L.cols[a.labelCol + 1], L.cols[C - 1]).map(it => String(it.text).trim()) : []);
    const heads = Array.from({ length: C }, (_x, ci) => { const p: string[] = []; for (let ri = 0; ri < first; ri++) { const t = (g[ri][ci]?.text || "").trim(); if (t && !p.includes(t) && !(ci > a.labelCol && caps.has(t))) p.push(t); } return p; });
    const numeric = (ci: number) => rowsA.some(d => { const x = g[d.r][ci]; return x.anchor && x.v !== null; });
    // variance groups: the comments' analysis (Δ / vs columns with Abs. and %)
    const deltas: ExDelta[] = a.groups.map(G => ({ label: G.name, abs: G.abs === null ? null : L.cols[G.abs], pct: G.pct === null ? null : L.cols[G.pct] }));
    const inDelta = new Set(a.groups.flatMap(G => [G.abs, G.pct]).filter((x): x is number => x !== null));
    // a series: the longest run (the last of equals) of ≥ 2 adjacent numeric period columns
    const isPeriod = (ci: number) => ci > a.labelCol && !inDelta.has(ci) && numeric(ci) && heads[ci].some(h => PERIOD.test(h)) && !heads[ci].some(h => COMPARE.test(h) || PLANISH.test(h));
    let best: number[] = [], run: number[] = [];
    for (let ci = 0; ci <= C; ci++) { if (ci < C && isPeriod(ci)) run.push(ci); else { if (run.length >= 2 && run.length >= best.length) best = run; run = []; } }
    const series: ExSeries | null = best.length ? { cols: best.map(ci => L.cols[ci]), labels: best.map(ci => heads[ci].find(h => PERIOD.test(h) && !/\d[/.-]\d/.test(h)) || heads[ci][0]) } : null;
    const inSeries = new Set(best), refs: ExRef[] = [];
    for (let ci = a.labelCol + 1; ci < C; ci++) if (!inDelta.has(ci) && !inSeries.has(ci) && numeric(ci)) refs.push({ col: L.cols[ci], label: heads[ci][heads[ci].length - 1] || "" });
    // every column with content has its place, or the table is drawn plainly: nothing may be left out
    for (let ci = 0; ci < C; ci++) {
      if (ci === a.labelCol || inDelta.has(ci) || inSeries.has(ci) || refs.some(x => x.col === L.cols[ci])) continue;
      if (rowsA.some(d => g[d.r][ci].anchor && g[d.r][ci].text.trim())) return plain;
    }
    if (!series && !deltas.length) return plain;                                       // numbers, but nothing to show as an exhibit
    const rowOf = (ri: number, kind: ExRow["kind"]): ExRow => {
      const cells = new Map<number, ExCell>();
      for (let ci = a.labelCol + 1; ci < C; ci++) { const x = cellAt(ri, ci); if (x) cells.set(x.c, x); }
      return { r: L.rows[ri], kind, label: cellAt(ri, a.labelCol), cells };
    };
    // the total: a "Grand total", else a "Total…" row at the table's top or bottom (subtotals sit between; only subtotals:
    // no total, so no headline quotes one of them);
    // subtotals, "of which" rows and bold block heads are drawn as such and left out of the scales and the facts
    const totals = rowsA.filter(d => TOTAL.test(d.label)), ends = [rowsA[0], rowsA[rowsA.length - 1]];
    const tot = totals.find(d => /grand/i.test(d.label)) || ends.find(d => totals.includes(d)) || null;
    const ent = new Set(a.entities.map(d => d.r));
    return { kind: "exhibit", labelCol: L.cols[a.labelCol], head, rows: rowsA.filter(d => d !== tot).map(d => rowOf(d.r, ent.has(d.r) ? "body" : "sub")),
      total: tot ? rowOf(tot.r, "total") : null, series, refs, deltas };
  });
}

/** the head items merged across the number columns from c1 to c2 (a table's caption) */
function captions(L: TableLayout, ctx: RenderCtx, head: number[], c1: number, c2: number): Item[] {
  const hs = new Set(head);
  return effItems(L, ctx).filter(it => hs.has(it.b.r) && it.b.c <= c1 && it.b.c2 >= c2 && String(it.text || "").trim());
}
/** is a head item the table's caption (merged across every number column)? */
const isCaption = (L: TableLayout, ex: Exhibit) => {
  const ci = L.cols.indexOf(ex.labelCol), c1 = L.cols[ci + 1], c2 = L.cols[L.cols.length - 1];
  return (it: Item) => L.cols.length - ci > 2 && it.b.c <= c1 && it.b.c2 >= c2;
};
/** the rows of their own: the bars' scales and the facts count them */
export const bodyRows = (ex: Exhibit) => ex.rows.filter(r => r.kind === "body");

/* ---- facts ---- */
/** what a variance compares with (the comments' kinds, model/comment.ts kindOf) */
export function deltaKind(label: string): "target" | "week" | "year" | "yoy" | "quarter" | "month" | "other" {
  return /budget|bdg|plan|target|forecast|fcst|objective/i.test(label) ? "target" : /prev|previous|last\s*week|w\/w|wow|\bweek\b/i.test(label) ? "week"
    : /yoy|y\/y|\bpy\b|\bly\b|prior year|last year|same week/i.test(label) ? "yoy" : /boy|ytd|beginning of (the )?year|\bdec\b/i.test(label) ? "year"
      : /\bq[1-4]\b|quarter|qtd|eoq/i.test(label) ? "quarter" : /eom|month|m\/m|mom|mtd/i.test(label) ? "month" : "other";
}
const FACTS = new WeakMap<Exhibit, ExFacts>();
/** what the slide-level elements quote (each one a cell of the table); nothing for a plain table */
export function exhibitFacts(ex: Exhibit): ExFacts {
  const hit = FACTS.get(ex); if (hit) return hit;
  const out = factsOf(ex); FACTS.set(ex, out); return out;
}
function factsOf(ex: Exhibit): ExFacts {
  if (ex.kind !== "exhibit") return { headline: null, kpis: [], lead: null, short: null, worst: null };
  const T = ex.total, name = T?.label ? cleanHead(T.label.text) : "";
  const num = (row: ExRow | null, c: number | null) => { const x = row && c !== null ? row.cells.get(c) : undefined; return x && x.v !== null ? x : null; };
  // headline: the total's latest period, else its first number
  let headline: ExFact | null = null;
  if (T && ex.series) { const k = ex.series.cols.length - 1, v = num(T, ex.series.cols[k]); if (v) headline = { label: [name, ex.series.labels[k]].filter(Boolean).join(" · "), value: v, pct: null }; }
  if (T && !headline) { const v = [...T.cells.values()].find(x => x.v !== null); if (v) headline = { label: name, value: v, pct: null }; }
  const fact = (row: ExRow | null, d: ExDelta): ExFact | null => { const ab = num(row, d.abs), p = num(row, d.pct), v = ab || p; return v ? { label: d.label, value: v, pct: ab ? p : null } : null; };
  const by = (k: string) => ex.deltas.find(d => deltaKind(d.label) === k) || null;
  const longest = by("year") || by("yoy") || by("quarter") || by("month");
  const picked = [by("week"), by("target"), longest].filter((d, i, xs): d is ExDelta => !!d && xs.indexOf(d) === i);
  const kpis = T ? picked.map(d => fact(T, d)).filter((f): f is ExFact => !!f).slice(0, 3) : [];
  const leadD = by("target") || ex.deltas[0] || null, lead = leadD && T ? fact(T, leadD) : null;
  let short: ExFacts["short"] = null, worst: ExFacts["worst"] = null;
  if (leadD) {
    const valOf = (row: ExRow) => (num(row, leadD.abs) || num(row, leadD.pct))?.v ?? null;
    const withV = bodyRows(ex).filter(row => valOf(row) !== null), below = withV.filter(row => valOf(row)! < 0);
    short = { n: below.length, of: withV.length };
    const w = below.sort((x, y) => valOf(x)! - valOf(y)!)[0];
    if (w) worst = { label: w.label ? w.label.text.replace(/\s*\(\d+\)\s*$/, "").trim() : "", abs: num(w, leadD.abs), pct: num(w, leadD.pct) };
  }
  return { headline, kpis, lead, short, worst };
}

/* ---- geometry: the exhibit's own natural size, its columns, rows and the box of every cell it shows. Measurement-free
   (the page hit-tests with it): bar lengths come from the values, label widths from their length. Table px, 0,0 = the
   exhibit's top left; the slide places and scales it as any table. */
export type BoxR = { x: number; y: number; w: number; h: number };
/** a column of the exhibit: the label, the latest period (Navy: its number; Red: a bar and its number), the trend over
    the series, a reference, a variance as a diverging bar (axis at the centre), a variance as a % text */
export interface ExCol { kind: "label" | "latest" | "trend" | "ref" | "dbar" | "dpct" | "num" | "lane"; x: number; w: number; ref?: ExRef; delta?: ExDelta;
  /** full numbers: a number column's sheet column and what it holds */ col?: number; role?: "period" | "latest" | "ref" | "abs" | "pct" }
/** full numbers: a head text (a header cell's, or a sub-head of our own), its line (0 top, 1 bottom) and alignment */
export interface ExHead { it: Item | null; text: string; x: number; w: number; line: 0 | 1; align: "start" | "middle" | "end" }
export interface ExLayout {
  design: "mckinsey" | "bain"; ex: Exhibit; W: number; H: number;
  /** "full": every cell's number in tabular columns, the graphics beside them; "compact": the concepts' look */
  numbers: "full" | "compact";
  /** full numbers: the head texts */ headTexts: ExHead[];
  /** the head's height, the row pitch, the top of each drawn row (body rows, then the total) */
  head: number; pitch: number; tops: Map<number, number>;
  cols: ExCol[];
  /** per column (its key: the label column, a series / ref / Δ column), the header cell drawn above it */
  heads: Map<ExCol, { it: Item; text: string }>;
  /** the box of every cell drawn, by "r,c" (header cells too) */ boxes: Map<string, BoxR>;
  /** per Δ / latest column (sheet column): the largest |value| of the body rows (the bars' scale) */ max: Map<number, number>;
}
/** Navy ("Insight board") and Red ("Signal") at WORKBOOK scale (as Excel and Liquid Glass build their tables: rows
    ≈ 20 px, text 11 pt), so two exhibits fit a slide at a scale near 1 (≈ 0.7 × the concepts' sizes): the head band, its
    rule and the heads' centre line, column widths, the trend's size, bar half-widths and heights, the axis' half-height,
    the label column's range, and the type (text, the smaller labels, the references, the heads with their spacing).
    The row pitch is the table's: max(20, its median row height × 1.1) */
export const EXG = {
  mckinsey: { head: 28, rule: 21, headY: 10, latest: 64, gap: 18, trend: 84, spark: 64, sparkH: 13, ref: 87, dgap: 28, dbar: 140, half: 28, barH: 9, axis: 9, label: [84, 210] as const },
  bain: { head: 26, rule: 0, headY: 11, latest: 180, bar: 120, dbar: 160, half: 48, barH: 11, axis: 10, dpct: 76, label: [80, 210] as const },
} as const;
export const EXT = { text: 14.67, total: 14.67, totalRed: 15.5, small: 12, ref: 13.75, value: 13, head: 9.5, ls: 1.1 } as const;

/** full numbers (round 4): the head band (two lines and their centre lines), the rule, the number columns (a period, the
    latest period – in Red its value band under it –, a reference, a variance's absolute and %), a variance's bar lane
    (Red: the first two only), the gap around a group, the trend, the bar height, the label column's range */
export const EXF = {
  mckinsey: { head: 34, lines: [10, 23] as const, rule: 30, num: 64, latest: 64, ref: 68, abs: 58, pct: 58, lane: 34, lanes: 99, ggap: 12, trend: 84, spark: 64, sparkH: 13, barH: 8, label: [84, 210] as const },
  bain: { head: 32, lines: [9, 22] as const, rule: 0, num: 62, latest: 84, ref: 66, abs: 56, pct: 56, lane: 44, lanes: 2, ggap: 10, trend: 0, spark: 0, sparkH: 0, barH: 8, label: [80, 200] as const },
} as const;
/** the table's row pitch at workbook scale: max(20, its median row height × 1.1) */
function pitchOf(L: TableLayout) { const rh = L.rows.map(r => L.rowH.get(r) || 0).filter(h => h > 0).sort((p, q) => p - q), med = rh.length ? rh[rh.length >> 1] : 20; return Math.round(Math.max(20, med * 1.1) * 100) / 100; }
/** a head text's width without measuring (bold capitals 9.5 px, letter-spacing 1.1) */
const headW = (t: string) => [...t].length * (9.5 * .66 + 1.1);

export function exhibitLayout(L: TableLayout, ctx: RenderCtx, numbers: "full" | "compact" = consultOptions(ctx).numbers): ExLayout | null {
  const d = ctx.style.design === "bain" ? "bain" : ctx.style.design === "mckinsey" ? "mckinsey" : null;
  if (!d) return null;
  return numbers === "full" ? fullLayout(L, ctx, d) : compactLayout(L, ctx, d);
}
function fullLayout(L: TableLayout, ctx: RenderCtx, d: "mckinsey" | "bain"): ExLayout {
  return cache(L, "exgeomF", tableKey(ctx, L) + "|" + d, () => {
    const ex = exhibitOf(L, ctx), G = EXF[d], boxes = new Map<string, BoxR>(), max = new Map<number, number>(), tops = new Map<number, number>(), headTexts: ExHead[] = [];
    const base = { design: d, ex, numbers: "full" as const, heads: new Map<ExCol, { it: Item; text: string }>(), headTexts, boxes, max, tops };
    if (ex.kind !== "exhibit") return { ...base, W: L.W, H: L.H, head: 0, pitch: 0, cols: [] };
    const all = [...ex.rows, ...(ex.total ? [ex.total] : [])];
    const chars = Math.max(0, ...all.map(r => (r.label?.text || "").trim().length));
    const cols: ExCol[] = [], at = (kind: ExCol["kind"], w: number, more: Partial<ExCol> = {}) => { const c: ExCol = { kind, x: W, w, ...more }; cols.push(c); W += w; return c; };
    let W = 0;
    at("label", Math.min(G.label[1], Math.max(G.label[0], Math.ceil(chars * 9.6) + 16)));
    const ser = ex.series, last = ser ? ser.cols[ser.cols.length - 1] : null;
    // a number column: its width, or as wide as its longest text needs (14.67 px: a digit or letter ≈ 8.3 px, a separator
    // or sign . , - + ' and space ≈ 4.6 px; 8 px to spare)
    const textW = (t: string) => [...t].reduce((s, ch) => s + (/[.,\-+' ]/.test(ch) ? 4.6 : 8.3), 0);
    const fit = (col: number, w: number) => Math.max(w, Math.ceil(Math.max(0, ...all.map(r => textW((r.cells.get(col)?.text || "").trim())))) + 8);
    if (ser) for (const col of ser.cols) at("num", fit(col, col === last ? G.latest : G.num), { col, role: col === last ? "latest" : "period" });
    if (ser && G.trend) at("trend", G.trend);
    for (const ref of ex.refs) at("num", fit(ref.col, G.ref), { col: ref.col, role: "ref", ref });
    const groups: { x: number; w: number; delta: ExDelta; abs: ExCol | null; pct: ExCol | null }[] = [];
    for (const [i, delta] of ex.deltas.entries()) {
      W += G.ggap;
      const x0 = W;
      if (i < G.lanes) at("lane", G.lane, { delta });
      const abs = delta.abs !== null ? at("num", fit(delta.abs, G.abs), { col: delta.abs, role: "abs", delta }) : null;
      const pct = delta.pct !== null ? at("num", fit(delta.pct, G.pct), { col: delta.pct, role: "pct", delta }) : null;
      groups.push({ x: x0, w: W - x0, delta, abs, pct });
    }
    const head = G.head, pitch = pitchOf(L);
    all.forEach((r, i) => tops.set(r.r, head + i * pitch));
    const H = head + all.length * pitch;
    // the bars' scales: the body rows' largest |value| (a variance: its absolute, else its %; Red: the latest period)
    const num = (r: ExRow, c: number | null) => { const x = c === null ? undefined : r.cells.get(c); return x && x.v !== null ? x.v : null; };
    const scaleOf = (c: number | null) => { if (c === null) return; max.set(c, Math.max(0, ...bodyRows(ex).map(r => Math.abs(num(r, c) ?? 0)))); };
    if (d === "bain") scaleOf(last);
    for (const c of cols) if (c.kind === "lane") scaleOf(c.delta!.abs ?? c.delta!.pct);
    // heads: per column its header cells (top to bottom, at most two lines); a variance group's title centred over the
    // group, its "Abs." / "%" right-aligned over their numbers
    const items = effItems(L, ctx);
    const cap = isCaption(L, ex), over = (col: number) => { const out: Item[] = []; for (const r of ex.head) { const it = items.find(x => x.b.r <= r && x.b.r2 >= r && x.b.c <= col && x.b.c2 >= col && String(x.text || "").trim() && (col === ex.labelCol || !cap(x))); if (it && !out.includes(it)) out.push(it); } return out; };
    const put = (it: Item | null, text: string, x: number, w: number, line: 0 | 1, align: ExHead["align"]) => {
      headTexts.push({ it, text, x, w, line, align });
      if (it && !boxes.has(it.b.r + "," + it.b.c)) boxes.set(it.b.r + "," + it.b.c, { x, y: line ? head / 2 : 0, w, h: head / 2 });
    };
    const column = (c: ExCol, col: number, align: ExHead["align"]) => {
      const its = over(col).slice(0, 2), x = c.x, w = c.w;
      if (its.length === 2) { put(its[0], String(its[0].text).trim(), x, w, 0, align); put(its[1], String(its[1].text).trim(), x, w, 1, align); return; }
      if (!its.length) return;
      const t = String(its[0].text).trim(), sp = t.indexOf(" ");
      if (headW(t) > w - 4 && sp > 0) { put(its[0], t.slice(0, sp), x, w, 0, align); headTexts.push({ it: null, text: t.slice(sp + 1), x, w, line: 1, align }); }
      else put(its[0], t, x, w, 1, align);
    };
    for (const c of cols) if (c.kind === "label") column(c, ex.labelCol, "start"); else if (c.kind === "num" && (c.role === "period" || c.role === "latest" || c.role === "ref")) column(c, c.col!, "end");
    for (const g of groups) {
      const its = over(g.delta.abs ?? g.delta.pct!), top = its[0] || null;
      put(top, top ? String(top.text).trim() : "Δ " + g.delta.label, g.x, g.w, 0, "middle");
      for (const k of [g.abs, g.pct]) {
        if (!k) continue;
        const sub = over(k.col!).find(x => x !== top) || null;
        put(sub, sub ? String(sub.text).trim() : k.role === "abs" ? "Abs." : "%", k.x, k.w, 1, "end");
      }
    }
    // the numbers' boxes: their columns, a row high
    for (const r of all) {
      const y = tops.get(r.r)!;
      if (r.label) boxes.set(r.label.r + "," + r.label.c, { x: cols[0].x, y, w: cols[0].w, h: pitch });
      for (const c of cols) if (c.kind === "num") { const x = r.cells.get(c.col!); if (x) boxes.set(x.r + "," + x.c, { x: c.x, y, w: c.w, h: pitch }); }
    }
    return { ...base, W, H, head, pitch, cols };
  });
}
function compactLayout(L: TableLayout, ctx: RenderCtx, d: "mckinsey" | "bain"): ExLayout {
  return cache(L, "exgeom", tableKey(ctx, L) + "|" + d, () => {
    const ex = exhibitOf(L, ctx), G = EXG[d], boxes = new Map<string, BoxR>(), max = new Map<number, number>(), tops = new Map<number, number>();
    if (ex.kind !== "exhibit") return { design: d, ex, numbers: "compact", headTexts: [], W: L.W, H: L.H, head: 0, pitch: 0, tops, cols: [], heads: new Map(), boxes, max };
    const all = [...ex.rows, ...(ex.total ? [ex.total] : [])];
    // the label column: as wide as the longest label needs (14.67 px bold, ~9.6 px a character), within the design's range
    const chars = Math.max(0, ...all.map(r => (r.label?.text || "").trim().length));
    const cols: ExCol[] = [], at = (kind: ExCol["kind"], w: number, more: Partial<ExCol> = {}) => { const c: ExCol = { kind, x: W, w, ...more }; cols.push(c); W += w; return c; };
    let W = 0;
    at("label", Math.min(G.label[1], Math.max(G.label[0], Math.ceil(chars * 9.6) + 16)));
    if (d === "mckinsey") {
      const N = EXG.mckinsey;
      if (ex.series) { at("latest", N.latest); W += N.gap; at("trend", N.trend); }
      for (const ref of ex.refs) at("ref", N.ref, { ref });
      if (ex.deltas.length) W += N.dgap;
      for (const delta of ex.deltas) at("dbar", N.dbar, { delta });
    } else {
      const R = EXG.bain;
      if (ex.series) at("latest", R.latest);
      ex.deltas.forEach((delta, i) => at(i < 2 ? "dbar" : "dpct", i < 2 ? R.dbar : R.dpct, { delta }));
    }
    const head = G.head, pitch = pitchOf(L);
    all.forEach((r, i) => tops.set(r.r, head + i * pitch));
    const H = head + all.length * pitch;
    // the bars' scales: the body rows' largest |value| per column
    const num = (r: ExRow, c: number | null) => { const x = c === null ? undefined : r.cells.get(c); return x && x.v !== null ? x.v : null; };
    const scaleOf = (c: number | null) => { if (c === null) return; max.set(c, Math.max(0, ...bodyRows(ex).map(r => Math.abs(num(r, c) ?? 0)))); };
    const last = ex.series ? ex.series.cols[ex.series.cols.length - 1] : null;
    scaleOf(last);
    for (const c of cols) if (c.kind === "dbar") scaleOf(c.delta!.abs ?? c.delta!.pct);
    // header cells: the first head row with text over the column
    const items = effItems(L, ctx), heads = new Map<ExCol, { it: Item; text: string }>();
    const cap = isCaption(L, ex), headOver = (col: number) => { for (const r of ex.head) { const it = items.find(x => x.b.r <= r && x.b.r2 >= r && x.b.c <= col && x.b.c2 >= col && String(x.text || "").trim() && (col === ex.labelCol || !cap(x))); if (it) return it; } return null; };
    for (const c of cols) {
      const col = c.kind === "label" ? ex.labelCol : c.kind === "latest" ? last : c.kind === "trend" ? null : c.ref ? c.ref.col : c.delta!.abs ?? c.delta!.pct;
      const it = col === null ? null : headOver(col);
      if (it) { heads.set(c, { it, text: String(it.text).trim() }); boxes.set(it.b.r + "," + it.b.c, { x: c.x, y: 0, w: c.w, h: head }); }
    }
    // cell boxes
    for (const r of all) {
      const y = tops.get(r.r)!, total = r.kind === "total", key = (x: ExCell) => x.r + "," + x.c, put = (x: ExCell | null | undefined, b: BoxR) => { if (x) boxes.set(key(x), b); };
      for (const c of cols) {
        const row = { y, h: pitch };
        if (c.kind === "label") put(r.label, { x: c.x, w: c.w, ...row });
        else if (c.kind === "latest") put(last === null ? null : r.cells.get(last), { x: c.x, w: c.w, ...row });
        else if (c.kind === "trend") {
          // the earlier periods: a slice of the trend each (the latest has its own column)
          const k = ex.series!.cols.length - 1;
          ex.series!.cols.slice(0, k).forEach((col, j) => put(r.cells.get(col), { x: c.x + j * c.w / k, w: c.w / k, ...row }));
        } else if (c.kind === "ref") put(r.cells.get(c.ref!.col), { x: c.x, w: c.w, ...row });
        else if (c.kind === "dpct") { const D = c.delta!; put(r.cells.get(D.pct ?? D.abs!), { x: c.x, w: c.w, ...row }); }
        else {
          const D = c.delta!, ab = D.abs === null ? null : r.cells.get(D.abs), pc = D.pct === null ? null : r.cells.get(D.pct), cx = c.x + c.w / 2;
          if (total) { put(ab, { x: c.x, w: c.w / 2, ...row }); put(pc, { x: cx, w: c.w / 2, ...row }); continue; }
          const bar = barOf(c, D.abs ?? D.pct, r, max, G.half, G.barH, y + pitch / 2);
          if (d === "bain" || !ab || !pc) {
            // one text (Red: the absolute; Navy without a %: the absolute): the bar and its label's side
            const b = bar.v === null ? { x: cx - 12, w: 24 } : bar.v >= 0 ? { x: cx, w: c.x + c.w - cx } : { x: c.x, w: cx - c.x };
            put(ab || pc, { ...b, ...row });
          } else {
            put(ab, { x: bar.x, y: bar.y, w: Math.max(6, bar.w), h: bar.h });
            put(pc, bar.v !== null && bar.v < 0 ? { x: c.x, w: Math.max(0, bar.x - 4 - c.x), ...row } : { x: bar.x + bar.w + 4, w: Math.max(0, c.x + c.w - bar.x - bar.w - 4), ...row });
          }
        }
      }
    }
    return { design: d, ex, numbers: "compact", headTexts: [], W, H, head, pitch, tops, cols, heads, boxes, max };
  });
}
/** a diverging bar: from the axis (the column's centre) towards the value's side, its length ∝ |value| / the column's max
    (at most the half); a subtotal has none (its value would dwarf the rows it sums) */
export function barOf(c: ExCol, col: number | null, r: ExRow, max: Map<number, number>, half: number, h: number, cy: number) {
  const x0 = c.x + c.w / 2, cell = col === null ? undefined : r.cells.get(col), v = cell && cell.v !== null ? cell.v : null, m = col === null ? 0 : max.get(col) || 0;
  const w = v === null || v === 0 || !m || r.kind === "sub" ? 0 : Math.max(2, Math.min(1, Math.abs(v) / m) * half);   // a subtotal: its number only
  return { v, x: v !== null && v < 0 ? x0 - w : x0, y: cy - h / 2, w, h };
}
/** the exhibit's size and the boxes of the cells it shows (a plain table: Excel's geometry, its items' boxes) */
export function exhibitGeom(L: TableLayout, ctx: RenderCtx, numbers: "full" | "compact" = consultOptions(ctx).numbers): { W: number; H: number; boxes: Map<string, BoxR> } {
  const g = exhibitLayout(L, ctx, numbers);
  if (g && g.ex.kind === "exhibit") return g;
  return cache(L, "exgeomPlain", tableKey(ctx, L), () => {
    const boxes = new Map<string, BoxR>();
    for (const it of effItems(L, ctx)) boxes.set(it.b.r + "," + it.b.c, { x: it.bx, y: it.by, w: it.bw, h: it.bh });
    return { W: L.W, H: L.H, boxes };
  });
}
