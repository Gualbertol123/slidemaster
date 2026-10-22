/* A chart's data (07 §3; 4.7 series, docs/next/09 §2.2, S14.2): every rule about which cells a chart reads lives here,
   for the old one-range charts (pie, donut: chartData) and the series charts (seriesData) alike –
   * a DataRef names a sheet id ("Sheet", "[Book.xlsx]Sheet" of a linked workbook) or a table of the deck (any slide's;
     its range follows the table when it grows), read through ctx.sheet() like the tables, so a reload or a scenario's
     overlay (another sheet object) redraws the chart;
   * hidden rows and columns are skipped (as Excel's charts skip them, values and categories alike);
   * the cells a version removes are blanked in place: a pie leaves them out, a series gets a gap there (its category
     stays, as the table keeps the row);
   * text and blank cells are no number: a pie leaves them out, a series gets a gap;
   * at most MAX_CELLS cells per rectangle (a range the size of a sheet is a mistake, not a chart).
   Pure; cached per sheet object (pies) or per the sheets' generations (series), never across a reload or a scenario. */
import type { ChartGroup, ChartItem, ChartSeries, DataRef, LineOrNone, SeriesType } from "../model/types";
import type { Sheet } from "../xlsx/types";
import type { Range } from "../xlsx/util";
import type { RenderCtx } from "./context";
import { formatValue } from "../xlsx/numfmt";
import { A1, numToCol, parseRange } from "../xlsx/util";
import { CELL_TOKEN, tokenSheet } from "../model/preset";

/* ---- one rectangle ---- */
export interface Slice { label: string; v: number; text: string }
export type ChartData =
  | { ok: true; source: string; series: string; slices: Slice[] }
  | { ok: false; source: string; why: "missing" | "empty" };
/** the most cells a chart reads per rectangle */
const MAX_CELLS = 2000;
/** where a DataRef points: its sheet, its rectangle (a table's range follows the table when it grows), and how the
    Issues panel names it ("Summary!C5:C9") */
export function refTarget(ref: DataRef | undefined, ctx: RenderCtx): { S: Sheet | null; g: Range | null; source: string; sheet: string } {
  if (!ref || typeof ref !== "object" || typeof ref.range !== "string") return { S: null, g: null, source: "?", sheet: "" };
  const def = "table" in ref ? (ctx.preset?.tables || []).find(t => t.id === ref.table) : undefined;
  const sheet = "table" in ref ? def?.sheet || "" : typeof ref.sheet === "string" ? ref.sheet : "";
  const range = ref.range.replace(/\$/g, "").toUpperCase().trim(), source = (sheet || "?") + "!" + range;
  const S = sheet ? ctx.sheet?.(sheet) ?? null : null;
  let g = /^[A-Z]{1,3}[0-9]{1,7}(:[A-Z]{1,3}[0-9]{1,7})?$/.test(range) ? parseRange(range) : null;
  if (!g || g.r2 < g.r1 || g.c2 < g.c1) return { S, g: null, source, sheet };
  // a table that grows with new rows: a range ending on the table's saved last row ends on its current one
  if (def && def.kind === "range" && def.grow) {
    const L = ctx.slides.flatMap(R => R.tables).find(t => t.def?.id === def.id);
    if (L && g.r2 === parseRange(def.range).r2 && L.g.r2 > g.r2) g = { ...g, r2: L.g.r2 };
  }
  if ((g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1) > MAX_CELLS) return { S, g: null, source, sheet };
  return { S, g, source, sheet };
}
/** the text a cell shows: its formatted value, or the text a cell edit put there (while the Excel text is unchanged) */
export function shown(S: Sheet, r: number, c: number, ctx: RenderCtx): string {
  const cell = S.get(r, c), t = cell ? formatValue(cell).text : "";
  const e = ctx.edits[S.name]?.[A1(r, c)];
  return e && e.text !== undefined && e.orig === t ? e.text : t;
}
/** the version's removed cells of a sheet: is (r, c) one of them */
function removedOf(ctx: RenderCtx, S: Sheet): (r: number, c: number) => boolean {
  const cut = (ctx.version?.hide[S.name] || []).map(parseRange);
  return (r, c) => cut.some(x => r >= x.r1 && r <= x.r2 && c >= x.c1 && c <= x.c2);
}
/** the cells of a rectangle in reading order (rows, then columns), without hidden rows and columns */
export function cellsOf(S: Sheet, g: Range): [number, number][] {
  const out: [number, number][] = [];
  for (let r = g.r1; r <= g.r2; r++) { if (S.rowHidden(r)) continue; for (let c = g.c1; c <= g.c2; c++) if (!S.colHidden(c)) out.push([r, c]); }
  return out;
}
/** a cell as a chart value: its number, or null (text, blank, an error, a cell the version removes) */
function numberAt(S: Sheet, r: number, c: number, removed: (r: number, c: number) => boolean): number | null {
  const x = S.get(r, c);
  return !x || x.t !== "n" || typeof x.v !== "number" || !Number.isFinite(x.v) || removed(r, c) ? null : x.v;
}
/** the label of value k of a rectangle: the labels range's cell k, else the headers beside the values – the nearest
    column on the left with text in those rows (a column of values), or the nearest row above (a row of values) */
function labelsFor(S: Sheet, g: Range, L: ReturnType<typeof refTarget> | null, ctx: RenderCtx): (r: number, c: number, k: number) => string {
  const lcells = L?.S && L.g ? cellsOf(L.S, L.g) : null, col = g.c1 === g.c2 && g.r2 > g.r1;
  if (lcells) return (_r, _c, k) => lcells[k] ? shown(L!.S!, lcells[k][0], lcells[k][1], ctx).trim() : "";
  if (col) {
    let lc = 0;
    for (let c = g.c1 - 1; c >= 1 && c >= g.c1 - 30 && !lc; c--) for (let r = g.r1; r <= g.r2; r++) { const x = S.get(r, c); if (x && x.t === "s" && String(x.v).trim()) { lc = c; break; } }
    return (r, _c, k) => (lc ? shown(S, r, lc, ctx).trim() : "") || String(k + 1);
  }
  let lr = 0;
  for (let r = g.r1 - 1; r >= 1 && r >= g.r1 - 30 && !lr; r--) for (let c = g.c1; c <= g.c2; c++) { const x = S.get(r, c); if (x && x.t === "s" && String(x.v).trim()) { lr = r; break; } }
  return (_r, c, k) => (lr ? shown(S, lr, c, ctx).trim() : "") || String(k + 1);
}
/** the name of the values of a rectangle: the nearest text above a column of values / left of a row of values (5 cells) */
function nameBeside(S: Sheet, g: Range, ctx: RenderCtx): string {
  const col = g.c1 === g.c2 && g.r2 > g.r1;
  for (let k = 1; k <= 5; k++) {
    const r = col ? g.r1 - k : g.r1, c = col ? g.c1 : g.c1 - k;
    if (r < 1 || c < 1) break;
    const x = S.get(r, c);
    if (x && x.t === "s") { const t = shown(S, r, c, ctx).trim(); if (t) return t; }
  }
  return "";
}
const DATA = new WeakMap<Sheet, Map<string, ChartData>>();
/** a pie's numbers, labels and series name (cached per sheet object: a reload or a scenario's view is another one) */
export function chartData(it: ChartItem, ctx: RenderCtx): ChartData {
  const T = refTarget(it.values, ctx), source = T.source;
  if (!T.S || !T.g) return { ok: false, source, why: "missing" };
  const S = T.S, g = T.g, L = it.labels ? refTarget(it.labels, ctx) : null;
  // (labels on another sheet object – a linked book reloaded, one sheet of a scenario's view – are not cached here)
  if (L?.S && L.S !== S) return resolve(S, g, L, it, ctx, source);
  const key = JSON.stringify([g, it.labels ? [L!.sheet, L!.g] : null, it.series ?? null, ctx.edits[S.name] || null, L?.S && L.S !== S ? ctx.edits[L.S.name] || null : null, ctx.version?.hide || null]);
  let m = DATA.get(S); if (!m) DATA.set(S, m = new Map());
  const hit = m.get(key); if (hit) return hit;
  const out = resolve(S, g, L, it, ctx, source);
  if (m.size > 200) m.clear();
  m.set(key, out);
  return out;
}
function resolve(S: Sheet, g: Range, L: ReturnType<typeof refTarget> | null, it: ChartItem, ctx: RenderCtx, source: string): ChartData {
  const cells = cellsOf(S, g), removed = removedOf(ctx, S), labelAt = labelsFor(S, g, L, ctx);
  const slices: Slice[] = [];
  cells.forEach(([r, c], k) => {
    if (numberAt(S, r, c, removed) === null) return;
    const x = S.get(r, c)!;
    slices.push({ label: labelAt(r, c, k) || numToCol(c) + r, v: x.v as number, text: formatValue(x).text });
  });
  if (!slices.length || !slices.some(s => s.v !== 0)) return { ok: false, source, why: "empty" };
  // the series name: the item's, else the text beside the values
  const series = typeof it.series === "string" ? it.series : nameBeside(S, g, ctx);
  return { ok: true, source, series, slices };
}

/* ---- series charts (4.7, 09 §2.2) ---- */
/** one series as drawn: a value (or null = a gap) per category of its group, the texts the cells show, its own number
    format (the first number cell's), its targets */
export interface SerData {
  id: string; n: number; name: string; type: SeriesType; axis: "y" | "y2"; stack: string | null; color: string | null;
  /** per category of the chart (the series' group's slots; null elsewhere and in a gap) */ vals: (number | null)[];
  texts: string[]; fmt: string; target: (number | null)[] | null; source: string; src: ChartSeries;
  /** per category, the cell's own number format ("" in a gap): PowerPoint's per-point formatCode where it is not `fmt`
      (S14.2 review 5) */ fmts?: string[];
  /** its group's first category: the series' value i (its `points[i]`, a mark's { s, i }) stands at category start + i */ start: number;
  /** a scatter chart's (S14.4): per value its x (null = no point there), the x cell's text and the x cells' number format;
      null on every other chart */ xs?: (number | null)[] | null; xTexts?: string[]; xFmt?: string;
}
export interface GroupData { id: string; n: number; start: number; len: number; label: string; divider: LineOrNone | null | undefined }
export type SeriesData =
  | { ok: true; cats: string[]; groups: GroupData[]; series: SerData[]; issues: string[]; key: string }
  | { ok: false; source: string; why: "missing" | "empty"; key: string };
/** a number per cell: its value (null = a gap), its text, its format */
interface Val { v: number | null; text: string; fmt: string }
/** the cells of several rectangles, concatenated (a series from different places); `missing` when one is not found */
function readRefs(refs: unknown, ctx: RenderCtx): { vals: Val[]; source: string; missing: boolean; first: { S: Sheet; g: Range } | null } {
  const list = Array.isArray(refs) ? refs as DataRef[] : refs && typeof refs === "object" ? [refs as DataRef] : [];
  const vals: Val[] = [], sources: string[] = [];
  let missing = !list.length, first: { S: Sheet; g: Range } | null = null;
  for (const ref of list) {
    const T = refTarget(ref, ctx); sources.push(T.source);
    if (!T.S || !T.g) { missing = true; continue; }
    const S = T.S, removed = removedOf(ctx, S);
    if (!first) first = { S, g: T.g };
    for (const [r, c] of cellsOf(S, T.g)) {
      const v = numberAt(S, r, c, removed), x = S.get(r, c);
      vals.push({ v, text: v === null ? "" : formatValue(x!).text, fmt: v === null ? "" : x!.fmt || "General" });
    }
  }
  return { vals, source: sources.join(", ") || "?", missing, first };
}
/** a category list: a DataRef's texts (hidden rows / columns skipped; a removed cell is an empty name) or given names */
function catsOf(cats: ChartGroup["cats"] | undefined, ctx: RenderCtx): string[] | null {
  if (Array.isArray(cats)) return cats.map(c => typeof c === "string" ? c : String(c ?? ""));
  const T = refTarget(cats as DataRef | undefined, ctx);
  if (!T.S || !T.g) return null;
  const S = T.S, removed = removedOf(ctx, S);
  return cellsOf(S, T.g).map(([r, c]) => removed(r, c) ? "" : shown(S, r, c, ctx).trim());
}
/** a series' name: its text, or the cell it names, else the text beside its first rectangle, else "Series n" */
function nameOf(s: ChartSeries, first: { S: Sheet; g: Range } | null, k: number, ctx: RenderCtx): string {
  if (typeof s.name === "string") return s.name;
  if (s.name && typeof s.name === "object") {
    const T = refTarget(s.name, ctx);
    if (T.S && T.g) return shown(T.S, T.g.r1, T.g.c1, ctx).trim();
  }
  return (first ? nameBeside(first.S, first.g, ctx) : "") || `Series ${k + 1}`;
}
/** the series of a chart in their order (n, then id), hidden ones and malformed entries left out */
export function seriesList(it: ChartItem): [string, ChartSeries][] {
  const all = it.sers && typeof it.sers === "object" ? Object.entries(it.sers) : [];
  return all.filter(([, s]) => s && typeof s === "object" && Array.isArray(s.vals) && !s.hide)
    .sort(([a, p], [b, q]) => (Number.isFinite(+p.n) ? +p.n : 0) - (Number.isFinite(+q.n) ? +q.n : 0) || (a < b ? -1 : a > b ? 1 : 0));
}
/** a sheet object's generation: a reload or a scenario's view is another object, so another number (the cache key) */
const GEN = new WeakMap<Sheet, number>();
let gens = 0;
const genOf = (S: Sheet | null) => { if (!S) return 0; let g = GEN.get(S); if (g === undefined) GEN.set(S, g = ++gens); return g; };
/** every sheet id a series chart reads (values, targets, names, categories, labels) */
function refSheets(it: ChartItem, ctx: RenderCtx): string[] {
  const out = new Set<string>(), add = (ref: unknown) => {
    for (const r of Array.isArray(ref) ? ref : [ref]) if (r && typeof r === "object" && typeof (r as DataRef).range === "string") out.add(refTarget(r as DataRef, ctx).sheet);
  };
  for (const [, s] of seriesList(it)) { add(s.vals); add(s.target); add(s.name); add(s.xs); }
  for (const g of Object.values(it.groups || {})) if (g && typeof g === "object") add(g.cats);
  add(it.labels);
  // the cells a text mark quotes ({Targets!B3}: a reload of that sheet is another key, S14.3)
  for (const k of Object.values(it.marks && typeof it.marks === "object" ? it.marks : {})) if (k && typeof k.text === "string")
    for (const t of k.text.matchAll(CELL_TOKEN)) out.add(tokenSheet(t[1]));
  out.delete("");
  return [...out].sort();
}
const SERIES = new Map<string, SeriesData>();
/** a series chart's categories, groups and series (09 §2.2): each series from its own rectangles – any sheet, any
    deck table, a linked workbook –, one value per category of its group (extra values ignored, missing ones gaps; both
    named for the Issues panel). Cached by everything it reads: the item's data keys, each sheet's generation (a
    reload, a scenario's overlay) and edits, the version's removed cells */
export function seriesData(it: ChartItem, ctx: RenderCtx): SeriesData {
  const sheets = refSheets(it, ctx);
  // (the chart's type: a series without its own type takes the chart's – S14.2 review 2)
  const key = JSON.stringify([it.type, it.sers, it.groups ?? null, it.labels ?? null, sheets.map(n => [n, genOf(ctx.sheet?.(n) ?? null), ctx.edits[ctx.sheet?.(n)?.name ?? n] || null]), ctx.version?.hide || null, ctx.preset?.tables || null]);
  const hit = SERIES.get(key); if (hit) return hit;
  const out = resolveSeries(it, ctx, key);
  if (SERIES.size > 200) SERIES.clear();
  SERIES.set(key, out);
  return out;
}
function resolveSeries(it: ChartItem, ctx: RenderCtx, key: string): SeriesData {
  const list = seriesList(it), issues: string[] = [];
  const read = list.map(([id, s], k) => ({ id, s, k, r: readRefs(s.vals, ctx), t: s.target ? readRefs(s.target, ctx) : null }));
  if (!read.length || read.every(x => x.r.missing && !x.r.vals.length)) return { ok: false, source: read[0]?.r.source || "?", why: "missing", key };
  // the category groups, in their order; without groups one, named by the labels range or the first series' headers
  // (a scatter chart has no categories: its points stand on a numeric x axis, S14.4 – groups are not read)
  const scatter = it.type === "scatter";
  const gdefs = Object.entries(scatter ? {} : it.groups || {}).filter(([, g]) => g && typeof g === "object")
    .sort(([a, p], [b, q]) => (+p.n || 0) - (+q.n || 0) || (a < b ? -1 : a > b ? 1 : 0));
  const groups: GroupData[] = [], cats: string[] = [];
  if (gdefs.length) for (const [gid, g] of gdefs) {
    const names = catsOf(g.cats, ctx);
    if (!names) issues.push(`categories ${refTarget(g.cats as DataRef, ctx).source} not found`);
    groups.push({ id: gid, n: +g.n || 0, start: cats.length, len: (names || []).length, label: typeof g.label === "string" ? g.label : "", divider: g.divider });
    cats.push(...(names || []));
  } else {
    const len = Math.max(0, ...read.map(x => x.r.vals.length)), f = read.find(x => x.r.first)?.r.first;
    const L = it.labels && !scatter ? refTarget(it.labels, ctx) : null;
    if (scatter) for (let k = 0; k < len; k++) cats.push(String(k + 1));
    else if (f) {
      const at = labelsFor(f.S, f.g, L, ctx), cells = cellsOf(f.S, f.g);
      for (let k = 0; k < len; k++) cats.push(k < cells.length ? at(cells[k][0], cells[k][1], k) || numToCol(cells[k][1]) + cells[k][0] : L ? "" : String(k + 1));
    } else for (let k = 0; k < len; k++) cats.push(String(k + 1));
    groups.push({ id: "", n: 0, start: 0, len, label: "", divider: undefined });
  }
  const series: SerData[] = read.map(({ id, s, k, r, t }) => {
    const g = groups.find(x => x.id === s.group) || groups[0], name = nameOf(s, r.first, k, ctx);
    if (r.missing) issues.push(`'${name}': ${r.source} not found`);
    if (r.vals.length && r.vals.length !== g.len && gdefs.length) issues.push(`'${name}' has ${r.vals.length} values for ${g.len} categories`);
    const vals: (number | null)[] = cats.map(() => null), texts = cats.map(() => ""), fmts = cats.map(() => ""), target = t ? cats.map((): number | null => null) : null;
    for (let i = 0; i < g.len && i < r.vals.length; i++) { vals[g.start + i] = r.vals[i].v; texts[g.start + i] = r.vals[i].text; fmts[g.start + i] = r.vals[i].fmt; }
    if (t && target) for (let i = 0; i < g.len && i < t.vals.length; i++) target[g.start + i] = t.vals[i].v;
    // (a series without a type takes the chart's: a line chart's are lines, an area chart's areas, a combo's columns)
    const type: SeriesType = s.type === "column" || s.type === "bar" || s.type === "line" || s.type === "area" || s.type === "scatter" ? s.type
      : it.type === "bar" ? "bar" : it.type === "line" ? "line" : it.type === "area" ? "area" : "column";
    const out: SerData = { id, n: +s.n || 0, name, type, axis: s.axis === "y2" ? "y2" : "y", stack: typeof s.stack === "string" ? s.stack : null,
      color: typeof s.color === "string" && /^#[0-9A-Fa-f]{6}$/.test(s.color) ? s.color.toUpperCase() : null,
      vals, texts, fmts, fmt: r.vals.find(v => v.v !== null)?.fmt || "General", target, source: r.source, src: s, start: g.start };
    if (scatter) Object.assign(out, scatterXs(s, name, r.vals.length, cats.length, ctx, issues));
    return out;
  });
  if (!series.some(s => s.vals.some(v => v !== null && v !== 0))) return { ok: false, source: read.map(x => x.r.source).join(", "), why: "empty", key };
  return { ok: true, cats, groups, series, issues, key };
}
/** a scatter series' x values (09 §2.2 `xs`, S14.4): one per value, in reading order like the values (hidden cells
    skipped, a removed, text or blank cell no number – that point is not drawn); without `xs` Excel's 1, 2, 3 …; an `xs`
    that is not found draws on 1, 2, 3 … too, with an Issues line, as does a count that differs from the values' */
function scatterXs(s: ChartSeries, name: string, n: number, len: number, ctx: RenderCtx, issues: string[]): Pick<SerData, "xs" | "xTexts" | "xFmt"> {
  const ones = () => ({ xs: Array.from({ length: len }, (_, i): number | null => i < n ? i + 1 : null), xTexts: Array.from({ length: len }, (_, i) => i < n ? String(i + 1) : ""), xFmt: "General" });
  if (!s.xs) return ones();
  const x = readRefs(s.xs, ctx);
  if (x.missing) { issues.push(`'${name}': x values ${x.source} not found`); return ones(); }
  if (x.vals.length !== n) issues.push(`'${name}' has ${x.vals.length} x values for ${n} values`);
  return { xs: Array.from({ length: len }, (_, i) => i < n && i < x.vals.length ? x.vals[i].v : null), xTexts: Array.from({ length: len }, (_, i) => i < n && i < x.vals.length ? x.vals[i].text : ""),
    xFmt: x.vals.find(v => v.v !== null)?.fmt || "General" };
}
/** a chart draws its series (4.7: columns and bars S14.2; lines, areas and combos S14.3; scatter and waterfall S14.4)
    rather than the pie of its one range */
export function hasSeries(it: ChartItem): boolean {
  return (it.type === "column" || it.type === "bar" || it.type === "line" || it.type === "area" || it.type === "combo" || it.type === "scatter" || it.type === "waterfall") && seriesList(it).length > 0;
}
