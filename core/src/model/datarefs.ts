/* Every cell reference of a slide item in one place (B57, 4.14; the owner, 2026-10-23: "if i move cells around in excel the
   graphs and tabs will break, i want to be easily able to repoint them without having to rebuild the entire graph").
   * refsOf: each DataRef an item stores (a chart's values, labels, series, groups, marks, axis cells, filter, card cells,
     budget-achievement chart; a KPI card's title, value and rows) and each cell a text quotes ({Sheet!C7}), with a path
     ("sers.s1.vals.0", "text~0") and a label in words ("Series 1 values", "KPI value");
   * rewritePatch: ONE item.patch replacing only the references named (a map entry whole, as item.patch merges them) –
     styles, texts, card parts and nudges stay;
   * the shift maths (a move by N rows / columns, Excel's insert or delete at a row / column) and a sheet's rename;
   * the fingerprint (the header and the first label beside a reference, ChartItem.bind) and the checks against the
     workbook as it is now: a missing sheet, an empty range, text where numbers were expected, a moved block;
   * findBlock: where the header text is now (a moved column found by its header "Volume_EUR_m").
   Pure (no page, no render): the core's display list (render/follow.ts), the app's Data sources panel and the tests use it. */
import type { Binds, DataRef, Item, RefBind, TableDef } from "./types";
import type { Sheet } from "../xlsx/types";
import type { Range } from "../xlsx/util";
import { A1, colToNum, numToCol } from "../xlsx/util";
import { formatValue } from "../xlsx/numfmt";

/** one reference of an item: where it sits in the item, what it is called, what it reads */
export interface RefSlot {
  /** "values", "sers.s1.vals.0", "axes.y.cells.min", "rows.0.src.cell", "text~0" (the first cell a text quotes) */ path: string;
  /** in words: "Series 1 values", "KPI value", "Filter column" */ label: string;
  ref: DataRef;
  /** what the cells should hold: numbers, texts (names, a header), or either */ want: "num" | "text" | "any";
  /** one cell (a value, a name): the sheet view picks a cell */ one: boolean;
  /** a cell a text quotes ({Sheet!C7}): rewritten in the text */ token?: boolean;
}
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
export const isRef = (x: unknown): x is DataRef => isObj(x) && typeof x.range === "string" && (typeof x.sheet === "string" || typeof x.table === "string");
/** a cell a text quotes: {Sheet!C7}, {'Sheet name'!C7}, {[Peers.xlsx]Peer!F7} (model/preset.ts CELL_TOKEN, kept apart: preset.ts reads this file) */
const TOKEN = /\{((?:'[^']+'|[^{}!]+))!\$?([A-Z]{1,3})\$?([0-9]{1,7})\}/g;
const tokenSheet = (s: string) => s.startsWith("'") && s.endsWith("'") && s.length > 1 ? s.slice(1, -1).replace(/''/g, "'") : s.trim();
/** a sheet name as a token writes it: quoted when it holds spaces or signs */
export const tokenName = (sheet: string) => /^[\w.[\]-]+$/.test(sheet) ? sheet : "'" + sheet.replace(/'/g, "''") + "'";
/** a map's entries in their order (n, then id) */
const ordered = <T>(m: unknown): [string, T][] => Object.entries(isObj(m) ? m : {}).filter(([, v]) => isObj(v))
  .sort(([a, p], [b, q]) => (+(p as { n?: number }).n! || 0) - (+(q as { n?: number }).n! || 0) || (a < b ? -1 : a > b ? 1 : 0)) as [string, T][];
const quote = (s: unknown) => typeof s === "string" && s.trim() ? " “" + s.trim() + "”" : "";

/** every reference of an item, in the panel's order (a kind this page does not know: none) */
export function refsOf(it: Item | null | undefined): RefSlot[] {
  if (!isObj(it)) return [];
  const out: RefSlot[] = [];
  const add = (path: string, label: string, ref: unknown, want: RefSlot["want"], one = false) => { if (isRef(ref)) out.push({ path, label, ref, want, one }); };
  const list = (path: string, label: string, refs: unknown, want: RefSlot["want"]) => {
    const a = Array.isArray(refs) ? refs : [];
    a.forEach((r, k) => add(path + "." + k, label + (a.length > 1 ? ` (part ${k + 1})` : ""), r, want));
  };
  const tokens = (path: string, label: string, text: unknown) => {
    if (typeof text !== "string") return;
    let k = 0;
    for (const m of text.matchAll(TOKEN)) out.push({ path: path + "~" + k++, label, ref: { sheet: tokenSheet(m[1]), range: m[2] + m[3] }, want: "any", one: true, token: true });
  };
  const x = it as unknown as Record<string, unknown>;
  if (it.kind === "chart") {
    const sers = ordered<Record<string, unknown>>(x.sers);
    // (a chart with series still keeps its first range: what it draws as a pie or a donut – 09 §2.2)
    add("values", sers.length ? "Values as a pie" : "Values", x.values, "num");
    add("labels", "Category names", x.labels, "text");
    sers.forEach(([id, s], i) => {
      const S = `Series ${i + 1}` + quote(s.name);
      list(`sers.${id}.vals`, S + " values", s.vals, "num");
      list(`sers.${id}.xs`, S + " x values", s.xs, "num");
      list(`sers.${id}.target`, S + " targets", s.target, "num");
      add(`sers.${id}.name`, S + " name", s.name, "text", true);
    });
    const groups = ordered<Record<string, unknown>>(x.groups);
    groups.forEach(([id, g], i) => add(`groups.${id}.cats`, groups.length > 1 ? `Category group ${i + 1}` + quote(g.label) : "Categories", g.cats, "text"));
    for (const [id, k] of ordered<Record<string, unknown>>(x.marks)) {
      const nm = typeof k.name === "string" && k.name.trim() ? `“${k.name.trim()}” line` : "Reference line";
      add(`marks.${id}.value`, nm + " value", k.value, "num", true);
      add(`marks.${id}.name`, nm + " name", k.name, "text", true);
      tokens(`marks.${id}.text`, "Text on the chart: quoted cell", k.text);
    }
    const AX: Record<string, string> = { x: "X axis", y: "Value axis", y2: "Secondary axis" }, KEY: Record<string, string> = { min: "minimum", max: "maximum", step: "major unit" };
    for (const a of ["x", "y", "y2"]) {
      const ax = isObj(x.axes) ? x.axes[a] : null, cells = isObj(ax) ? ax.cells : null;
      if (isObj(cells)) for (const key of ["min", "max", "step"]) add(`axes.${a}.cells.${key}`, `${AX[a]} ${KEY[key]}`, cells[key], "num", true);
    }
    if (isObj(x.filter)) { add("filter.by", "Filter column", x.filter.by, "text"); add("filter.eq", "Filter value", x.filter.eq, "text", true); }
    ordered<Record<string, unknown>>(x.stats).forEach(([id, k], i) => add(`stats.${id}.cell`, `Stat ${i + 1}${quote(k.label)} cell`, k.cell, "num", true));
    ordered<Record<string, unknown>>(x.moms).forEach(([id, k], i) => add(`moms.${id}.cell`, `Momentum chip ${i + 1} cell`, k.cell, "num", true));
    if (isObj(x.tag)) add("tag.text", "Tag", x.tag.text, "text", true);
    add("subtitle", "Subtitle", x.subtitle, "text", true);
    if (isObj(x.progress)) {
      const P = x.progress;
      list("progress.vals", "Budget chart values", P.vals, "num");
      list("progress.targets", "Budget chart budgets", P.targets, "num");
      add("progress.cats", "Budget chart names", P.cats, "text");
      if (isObj(P.table)) {
        add("progress.table.by", "Product column", P.table.by, "text");
        add("progress.table.val", "Value column", P.table.val, "num");
        add("progress.table.target", "Budget column", P.table.target, "num");
      }
    }
  } else if (it.kind === "kpi") {
    add("head", "KPI title", x.head, "text", true);
    add("cur", "KPI value", x.cur, "num", true);
    (Array.isArray(x.rows) ? x.rows : []).forEach((r: unknown, i) => {
      const src = isObj(r) && isObj(r.src) ? r.src : null, nm = `Row ${i + 1}` + quote(isObj(r) ? r.label : "");
      if (src) { add(`rows.${i}.src.cell`, nm + " change", src.cell, "num", true); add(`rows.${i}.src.ref`, nm + " reference", src.ref, "num", true); }
    });
  } else if (it.kind === "shape" || it.kind === "line") tokens("text", "Quoted cell", x.text);
  return out;
}
/** the item maps whose entries item.patch replaces whole (a series, a group, a mark, an axis, a stat, a momentum chip) */
const ENTRY_MAPS = ["sers", "groups", "marks", "axes", "stats", "moms"];
const seg = (p: string) => { const t = p.indexOf("~"); return { keys: (t < 0 ? p : p.slice(0, t)).split("."), tok: t < 0 ? -1 : +p.slice(t + 1) }; };
/** the value at a path ("sers.s1.vals.0"); undefined when it is not there */
export function getAt(it: unknown, path: string): unknown {
  let v: unknown = it;
  for (const k of seg(path).keys) { if (!v || typeof v !== "object") return undefined; v = (v as Record<string, unknown>)[k]; }
  return v;
}
function setAt(root: Record<string, unknown>, keys: string[], val: unknown) {
  let v: Record<string, unknown> = root;
  for (const k of keys.slice(0, -1)) { const n = v[k]; if (!n || typeof n !== "object") return false; v = n as Record<string, unknown>; }
  v[keys[keys.length - 1]] = val;
  return true;
}
/** the k-th quoted cell of a text pointed at another cell */
export function retoken(text: string, k: number, ref: DataRef): string {
  let i = 0;
  return text.replace(TOKEN, m => i++ === k && "sheet" in ref ? "{" + tokenName(ref.sheet) + "!" + ref.range.split(":")[0] + "}" : m);
}
/** ONE item.patch that points these references (by path) elsewhere and sets (or, null, removes) these binds: a map's
    entry whole, a plain key whole (a KPI card's rows, a chart's filter, its budget chart), nothing else – the styles,
    the texts, the card's parts and nudges stay. A path that is not there is left out (null when nothing is left) */
export function rewritePatch(it: Item, refs: Record<string, DataRef>, binds: Record<string, RefBind | null> = {}): import("./types").ItemPatch | null {
  const copy = JSON.parse(JSON.stringify(it)) as Record<string, unknown>, top = new Set<string>();
  for (const [path, ref] of Object.entries(refs)) {
    const { keys, tok } = seg(path);
    if (tok >= 0) {
      const t = getAt(copy, keys.join("."));
      if (typeof t !== "string") continue;
      const nt = retoken(t, tok, ref);
      if (nt !== t && setAt(copy, keys, nt)) top.add(keys[0] + (ENTRY_MAPS.includes(keys[0]) ? "." + keys[1] : ""));
      continue;
    }
    if (!isRef(getAt(copy, path))) continue;                    // (a reference only where one is)
    if (setAt(copy, keys, JSON.parse(JSON.stringify(ref)))) top.add(keys[0] + (ENTRY_MAPS.includes(keys[0]) ? "." + keys[1] : ""));
  }
  const p: Record<string, unknown> = {};
  for (const t of top) {
    const [k, e] = t.split(".");
    if (e !== undefined) ((p[k] ||= {}) as Record<string, unknown>)[e] = (copy[k] as Record<string, unknown>)[e];
    else p[k] = copy[k];
  }
  const b = Object.entries(binds);
  if (b.length) p.bind = Object.fromEntries(b.map(([k, v]) => [k, v === null ? null : { ...v }]));
  return Object.keys(p).length ? p as import("./types").ItemPatch : null;
}

/* ---- addresses and the shift maths ---- */
const MAXR = 1048576, MAXC = 16384;
/** an A1 rectangle ("C2:C9", "C7"; $ and case ignored) – null when it is none */
export function parseA1(range: string): Range | null {
  const m = /^\$?([A-Z]{1,3})\$?([0-9]{1,7})(?::\$?([A-Z]{1,3})\$?([0-9]{1,7}))?$/.exec(String(range || "").trim().toUpperCase());
  if (!m) return null;
  const c1 = colToNum(m[1]), r1 = +m[2], c2 = m[3] ? colToNum(m[3]) : c1, r2 = m[4] ? +m[4] : r1;
  if (!r1 || !r2) return null;
  return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
}
/** a rectangle as A1: one cell "C7", else "C2:C9" (`pair`: "C7:C7" stays a pair) */
export const fmtA1 = (g: Range, pair = false) => g.r1 === g.r2 && g.c1 === g.c2 && !pair ? A1(g.r1, g.c1) : A1(g.r1, g.c1) + ":" + A1(g.r2, g.c2);
/** a move of cells: by `dr` rows and `dc` columns. With `row` (`col`) it is Excel's insert (n > 0) or delete (n < 0) at
    that row (column): only rows at or below it move, a range across it grows or shrinks, deleted cells are gone (null);
    without, every cell moves (a cell pushed above row 1 or left of column A: null) */
export interface Shift { dr: number; dc: number; row?: number; col?: number }
/** one dimension: the span [a, b] after n inserted (or deleted) at `at`, or moved by n */
export function shiftSpan(a: number, b: number, n: number, at: number | undefined, max: number): [number, number] | null {
  if (!n) return [a, b];
  let x: number, y: number;
  if (at === undefined) { x = a + n; y = b + n; }
  else if (n > 0) { x = a >= at ? a + n : a; y = b >= at ? b + n : b; }
  else {
    const m = -n, q = at + m - 1;                                 // rows at … q are deleted
    x = a < at ? a : a > q ? a - m : at;
    y = b < at ? b : b > q ? b - m : at - 1;
  }
  return x < 1 || y > max || x > y ? null : [x, y];
}
/** a rectangle shifted (null: gone or off the sheet) */
export function shiftRect(g: Range, s: Shift): Range | null {
  const r = shiftSpan(g.r1, g.r2, s.dr, s.row, MAXR), c = shiftSpan(g.c1, g.c2, s.dc, s.col, MAXC);
  return r && c ? { r1: r[0], r2: r[1], c1: c[0], c2: c[1] } : null;
}
/** an address shifted: a cell "C7", a rectangle "C2:C9", whole rows "5:7" (rows only), whole columns "C:D" (columns only);
    its form kept. null: gone (deleted) or off the sheet; unchanged text when it is no address */
export function shiftA1(range: string, s: Shift): string | null {
  const t = String(range).trim().toUpperCase().replace(/\$/g, "");
  let m = /^([0-9]{1,7})(?::([0-9]{1,7}))?$/.exec(t);
  if (m) { const r = shiftSpan(+m[1], +(m[2] ?? m[1]), s.dr, s.row, MAXR); return r ? (m[2] !== undefined ? r[0] + ":" + r[1] : String(r[0])) : null; }
  m = /^([A-Z]{1,3})(?::([A-Z]{1,3}))?$/.exec(t);
  if (m) { const c = shiftSpan(colToNum(m[1]), colToNum(m[2] ?? m[1]), s.dc, s.col, MAXC); return c ? (m[2] !== undefined ? numToCol(c[0]) + ":" + numToCol(c[1]) : numToCol(c[0])) : null; }
  const g = parseA1(t); if (!g) return range;
  const n = shiftRect(g, s);
  return n ? fmtA1(n, t.includes(":")) : null;
}
/** the sheet a reference reads (a deck table's: that table's sheet; "" when the table is gone) */
export const refSheet = (ref: DataRef, tables: readonly TableDef[] | null | undefined) => "sheet" in ref ? ref.sheet : (tables || []).find(t => t.id === ref.table)?.sheet ?? "";
/** a reference's address as Data sources shows it and a bind stores it: "Volumes!C2:C9" */
export const refAt = (ref: DataRef, tables?: readonly TableDef[] | null) => (refSheet(ref, tables) || "?") + "!" + String(ref.range).replace(/\$/g, "").toUpperCase().trim();

/* ---- the fingerprint and the checks ---- */
/** a cell's text as a header or a label compares it: a text cell's text, trimmed, spaces folded, any case */
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
function textAt(S: Sheet, r: number, c: number): string {
  if (r < 1 || c < 1) return "";
  const x = S.get(r, c);
  return x && x.t === "s" ? String(x.v).trim() : "";
}
function shownAt(S: Sheet, r: number, c: number): string {
  const x = S.get(r, c);
  return !x ? "" : x.t === "s" ? String(x.v).trim() : formatValue(x).text.trim();
}
/** the header and the label beside a rectangle as bound now: for a column of cells (or one cell) the nearest text above
    it (5 rows; its own first cell when that is a text over numbers) and the nearest text left of its first cell (30
    columns; a text range's own first cell); for a row of cells the nearest text left of it and above its first cell */
export function fingerprint(S: Sheet, g: Range, want: RefSlot["want"], at: string): RefBind {
  const b: RefBind = { at }, row = g.r1 === g.r2 && g.c2 > g.c1;
  const firstText = textAt(S, g.r1, g.c1);
  if (!row) {
    for (let k = 1; k <= 5 && !b.h; k++) { const t = textAt(S, g.r1 - k, g.c1); if (t) { b.h = t; b.hr = k; } }
    if (!b.h && firstText && want === "num" && g.r2 > g.r1) { b.h = firstText; b.hr = 0; }
    if (want === "text" && firstText) { b.l = firstText; }
    else for (let k = 1; k <= 30 && !b.l; k++) { const t = textAt(S, g.r1, g.c1 - k); if (t) { b.l = t; b.lc = k; } }
  } else {
    for (let k = 1; k <= 30 && !b.h; k++) { const t = textAt(S, g.r1, g.c1 - k); if (t) { b.h = t; b.hc = k; } }
    if (want === "text" && firstText) b.l = firstText;
    else for (let k = 1; k <= 5 && !b.l; k++) { const t = textAt(S, g.r1 - k, g.c1); if (t) { b.l = t; b.lr = k; } }
  }
  for (const k of ["hr", "hc", "lr", "lc"] as const) if (!b[k]) delete b[k];
  return b;
}
/** a bind still about this reference: stored for its address now (one made for another address is stale: the reference
    was pointed elsewhere since, by another panel or another page) */
export const bindFor = (b: RefBind | null | undefined, at: string): RefBind | null => b && typeof b === "object" && (!b.at || norm(b.at) === norm(at)) ? b : null;
/** what a reference reads now */
export type RefStatus = "ok" | "empty" | "sheet" | "table" | "text" | "moved" | "bad" | "wait";
/** the words Data sources shows */
export const STATUS_TEXT: Record<RefStatus, string> = { ok: "OK", empty: "empty", sheet: "missing sheet", table: "missing table", text: "text, not numbers", moved: "moved?", bad: "not an address", wait: "reading…" };
export interface CheckCtx {
  /** a loaded sheet by its id */ sheet: (name: string) => Sheet | null;
  /** the sheet exists in the workbook (loaded or not); unset: loaded = exists */ exists?: (name: string) => boolean;
  tables?: readonly TableDef[] | null;
}
export interface RefCheck { status: RefStatus; why: string; at: string; sheet: string; g: Range | null; S: Sheet | null;
  /** advisory (status OK): the label bound beside it reads otherwise now – a sort or new rows, or a move */ note?: string }
const MAX_CELLS = 2000;
/** a reference against the workbook: its sheet (or deck table), its cells (empty; text where numbers are expected) and
    its bind (the header and the label at their places: else the block moved) */
export function checkRef(slot: Pick<RefSlot, "ref" | "want">, ctx: CheckCtx, bind?: RefBind | null): RefCheck {
  const ref = slot.ref, at = refAt(ref, ctx.tables), sheet = refSheet(ref, ctx.tables);
  const g = parseA1(ref.range), base = { at, sheet, g };
  if ("table" in ref && !sheet) return { ...base, status: "table", why: `the table it reads is no longer in the deck`, S: null };
  if (!g) return { ...base, status: "bad", why: `“${ref.range}” is not a cell address`, S: null };
  const S = ctx.sheet(sheet);
  if (!S) return ctx.exists && ctx.exists(sheet) ? { ...base, status: "wait", why: "", S: null } : { ...base, status: "sheet", why: `the sheet “${sheet}” is not in the workbook (renamed or deleted?)`, S: null };
  let any = false, num = false, n = 0;
  for (let r = g.r1; r <= g.r2 && n < MAX_CELLS; r++) for (let c = g.c1; c <= g.c2 && n < MAX_CELLS; c++, n++) {
    const x = S.get(r, c); if (!x || x.t === "blank" || String(x.v ?? "").trim() === "") continue;
    any = true; if (x.t === "n") num = true;
  }
  // (its header gone from above it says more than "empty": the block moved – checked first)
  const b = bindFor(bind, at);
  let note = "";
  if (b) {
    const hr = g.r1 - (b.hr || 0), hc = g.c1 - (b.hc || 0);
    if (b.h && norm(textAt(S, hr, hc) || (b.hr || b.hc ? "" : shownAt(S, hr, hc))) !== norm(b.h))
      return { ...base, status: "moved", why: `${at}: “${b.h}” is no longer at ${A1(hr, hc)}${textAt(S, hr, hc) ? ` (it shows “${textAt(S, hr, hc)}”)` : ""}`, S };
  }
  if (!any) return { ...base, status: "empty", why: `${at} is empty`, S };
  if (b) {
    // (the label is a data value – the first category –: rows sorted or added change it. Advisory: a note, never moved?)
    if (b.l && norm(labelNear(S, g.r1, g.c1, b)) !== norm(b.l)) note = `the first label is “${labelNear(S, g.r1, g.c1, b) || "(none)"}” now (it was “${b.l}”): new rows or another order?`;
  }
  if (slot.want === "num" && !num) return { ...base, status: "text", why: `${at} holds text where numbers were expected`, S };
  return { ...base, status: "ok", why: "", S, ...(note ? { note } : {}) };
}
/** where Find the block / Follow header found a reference's header: the shift back under it, or `ambiguous` – the
    header text in more than one place and the label singling out none (the stored address is kept: "moved?") */
export type Found = { dr: number; dc: number; ambiguous?: undefined } | { ambiguous: number; dr?: undefined; dc?: undefined };
/** the label beside a rectangle starting at (r, c), as the fingerprint took it but scanning along the row (the column)
    for the first text – a column inserted between the labels and the data does not hide it */
function labelNear(S: Sheet, r: number, c: number, b: RefBind): string {
  if (b.lc) { for (let k = 1; k <= 30 + 5 && c - k >= 1; k++) { const t = textAt(S, r, c - k); if (t) return t; } return ""; }
  if (b.lr) { for (let k = 1; k <= 5 + 5 && r - k >= 1; k++) { const t = textAt(S, r - k, c); if (t) return t; } return ""; }
  return shownAt(S, r, c);
}
/** where the bound header (else the label) is now: the shift that brings the reference back under it. One cell with the
    header text: there. Several: the one whose label (scanned along its row) agrees, when exactly one does – else
    ambiguous. null: the text is nowhere (or the bind has none). {0, 0}: still in place */
export function findBlock(S: Sheet, g: Range, b: RefBind): Found | null {
  const useH = !!b.h, text = norm(useH ? b.h! : b.l || ""); if (!text) return null;
  const or = g.r1 - ((useH ? b.hr : b.lr) || 0), oc = g.c1 - ((useH ? b.hc : b.lc) || 0);
  const own = useH ? !(b.hr || b.hc) : !(b.lr || b.lc);      // the text is the range's own first cell (number cells too)
  const at = (r: number, c: number) => norm(own ? shownAt(S, r, c) : textAt(S, r, c));
  if (at(or, oc) === text) return { dr: 0, dc: 0 };
  const hits: { dr: number; dc: number }[] = [];
  for (const x of S.cells.values()) {
    if (x.t !== "s" && !own) continue;
    if (norm(own ? shownAt(S, x.r, x.c) : String(x.v)) !== text) continue;
    const dr = x.r - or, dc = x.c - oc;
    if (g.r1 + dr >= 1 && g.c1 + dc >= 1) hits.push({ dr, dc });
  }
  if (hits.length <= 1) return hits[0] ?? null;
  // (several: the label – advisory, a data value – may single one out; a header found by its label is not)
  if (!useH || !b.l) return { ambiguous: hits.length };
  const agree = hits.filter(h => norm(labelNear(S, g.r1 + h.dr, g.c1 + h.dc, b)) === norm(b.l!));
  return agree.length === 1 ? agree[0] : { ambiguous: hits.length };
}
/** a reference moved by (dr, dc) – its form ("C7", "C2:C9") kept */
export function movedRef(ref: DataRef, d: { dr: number; dc: number }): DataRef | null {
  const r = shiftA1(ref.range, { dr: d.dr, dc: d.dc });
  return r === null ? null : { ...ref, range: r };
}
/** a table's header row (the texts of its first row, 12 columns at most) */
export function tableHeader(S: Sheet, g: Range): string[] {
  const out: string[] = [];
  for (let c = g.c1; c <= g.c2 && out.length < 12; c++) out.push(shownAt(S, g.r1, c));
  return out;
}
/** where a table's header row is now: the shift that brings its rectangle back under the texts (most of them agreeing,
    then the nearest); null when its first text is nowhere */
export function findHeaderRow(S: Sheet, g: Range, h: string[]): { dr: number; dc: number } | null {
  const want = h.map(norm), k0 = want.findIndex(Boolean); if (k0 < 0) return null;
  const agree = (r: number, c0: number) => want.reduce((n, t, k) => n + (t && norm(shownAt(S, r, c0 + k)) === t ? 1 : 0), 0);
  const need = want.filter(Boolean).length;
  if (agree(g.r1, g.c1) === need) return { dr: 0, dc: 0 };
  let best: { dr: number; dc: number; score: number } | null = null;
  for (const x of S.cells.values()) {
    if (norm(shownAt(S, x.r, x.c)) !== want[k0]) continue;
    const c0 = x.c - k0; if (c0 < 1) continue;
    const n = agree(x.r, c0), dr = x.r - g.r1, dc = c0 - g.c1;
    if (n * 2 < need) continue;                                   // (half the header at least)
    const score = (need - n) * 1e6 + Math.abs(dr) + Math.abs(dc);
    if (!best || score < best.score) best = { dr, dc, score };
  }
  return best ? { dr: best.dr, dc: best.dc } : null;
}
/** the binds of an item that follow their header */
export const following = (it: Item): [string, RefBind][] => Object.entries(isObj((it as { bind?: Binds }).bind) ? (it as { bind: Binds }).bind : {}).filter(([p, b]) => isObj(b) && b.f === true && !p.includes("~"));
