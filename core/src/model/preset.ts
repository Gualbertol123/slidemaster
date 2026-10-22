/* Presets: which tables exist ("x" markers or picked ranges) and which slides show them. */
import { buildLayout } from "../xlsx/layout";
import { hideFor, hideKey, hideSize, hiddenEntries, type DropMap, type HideSet } from "./hidden";
import { A1, parseRange, uid } from "../xlsx/util";
import type { Range } from "../xlsx/util";
import type { Sheet, TableLayout, Workbook } from "../xlsx/types";
import type { ChartItem, Design, LineItem, Preset, RuntimeSlide, ShapeItem, SlideDef, TableDef, TableSizes } from "./types";

export const SLIDE_RX = /slide/i;
export const visibleSheets = (wb: Workbook) => wb.sheets.filter(S => !S.hidden);
export const rangeToG = (range: string): Range => {
  const g = parseRange(range.toUpperCase().replace(/\$/g, ""));
  return { r1: Math.min(g.r1, g.r2) - 1, c1: Math.min(g.c1, g.c2) - 1, r2: Math.max(g.r1, g.r2) + 1, c2: Math.max(g.c1, g.c2) + 1 };
};
export const gToRange = (g: Range) => A1(g.r1 + 1, g.c1 + 1) + ":" + A1(g.r2 - 1, g.c2 - 1);
export const validRange = (r: unknown) => /^\$?[A-Z]{1,3}\$?\d{1,7}(:\$?[A-Z]{1,3}\$?\d{1,7})?$/i.test(String(r || "").trim());
/** the sheets a deck reads: its tables' and those its slide items (charts, callouts) draw from (4.3) */
export const presetSheets = (p: Preset | null | undefined) => [...new Set([...((p && p.tables) || []).map(t => t.sheet), ...itemSheets(p)])];
/** the sheet ids the slide items name: a chart's values / labels ranges, a callout's {Sheet!C7} references. Per kind
    (S14.P review, 4): each kind's own function below, so M14 (charts: sers / groups / marks) and M15 (line labels,
    icons) never edit the same lines; a kind this page does not know names none */
export function itemSheets(p: Preset | null | undefined): string[] {
  const out: string[] = [];
  for (const s of (p && p.slides) || []) for (const it of Object.values(s.items || {})) {
    if (!it || typeof it !== "object") continue;
    const f = ITEM_SHEETS[it.kind];
    if (f) out.push(...f(it as never));
  }
  return out;
}
const refSheet = (ref: unknown): string[] => ref && typeof ref === "object" && "sheet" in ref && typeof (ref as { sheet: unknown }).sheet === "string" && (ref as { sheet: string }).sheet ? [(ref as { sheet: string }).sheet] : [];
const textSheets = (text: unknown): string[] => typeof text === "string" ? [...text.matchAll(CELL_TOKEN)].map(m => tokenSheet(m[1])) : [];
/** a chart (M14): its values and labels */
function chartSheets(it: ChartItem): string[] {
  return [it.values, it.labels].flatMap(refSheet);
}
/* ---- M14 above this line, M15 below it ---- */
/** a callout or an icon (M15): the cells its text quotes */
function shapeSheets(it: ShapeItem): string[] {
  return textSheets(it.text);
}
/** a line (M15): the cells its label quotes */
function lineSheets(it: LineItem): string[] {
  return textSheets(it.text);
}
const ITEM_SHEETS: Record<string, (it: never) => string[]> = { chart: chartSheets, shape: shapeSheets, line: lineSheets };
/** a cell quoted in a callout's text: {Sheet!C7}, {'Sheet name'!C7}, {[Peers.xlsx]Peer!F7} (07 §3) */
export const CELL_TOKEN = /\{((?:'[^']+'|[^{}!]+))!\$?([A-Z]{1,3})\$?([0-9]{1,7})\}/g;
/** the sheet id of a token's sheet part ('quoted' names unquoted) */
export const tokenSheet = (s: string) => s.startsWith("'") && s.endsWith("'") && s.length > 1 ? s.slice(1, -1).replace(/''/g, "'") : s.trim();

function cellHasData(S: Sheet, r: number, c: number) {
  const x = S.get(r, c);
  return !!(x && x.t !== "blank" && String(x.v).trim() !== "" && String(x.v).trim().toLowerCase() !== "x");
}
/** "grows with new rows": the table extends downwards while the row below its last row has data
    in the table's columns (v2 stopped after 2000 rows). */
export function growG(S: Sheet, g: Range): Range {
  let r = g.r2, limit = g.r2;
  for (const x of S.cells.values()) if (x.r > limit) limit = x.r;
  while (r <= limit) {
    let any = false;
    for (let c = g.c1 + 1; c < g.c2; c++) if (cellHasData(S, r, c)) { any = true; break; }
    if (!any) break;
    r++;
  }
  return { ...g, r2: r };
}

/** per-workbook cache of range layouts (cleared when a workbook is opened) */
export const LCACHE = new Map<string, { wb: Workbook; L: TableLayout }>();
/** column widths and row heights of a table in one design: its own, else the shared ones (older decks) */
export function tableSizes(def: TableDef, design?: Design): TableSizes {
  const own = design ? def.sizes?.[design] : undefined;
  return own || { ...(def.cols ? { cols: def.cols } : {}), ...(def.rows ? { rows: def.rows } : {}) };
}
const hasExtras = (def: TableDef, z: TableSizes) => !!(z.cols || z.rows || def.scales || def.merges);
const inside = (h: HideSet, g: Range): HideSet => ({ rows: new Set([...h.rows].filter(r => r > g.r1 && r < g.r2)), cols: new Set([...h.cols].filter(c => c > g.c1 && c < g.c2)) });
/** layouts with hidden rows are kept for the last few sets only (each hide / unhide makes one: Risks 2 of the M16 plan) */
const HIDDEN_MAX = 48;
function trimHidden(fresh: string) {
  const keys = [...LCACHE.keys()].filter(k => k.includes("|h"));
  for (const k of keys.slice(0, Math.max(0, keys.length - HIDDEN_MAX))) if (k !== fresh) LCACHE.delete(k);
}
/** hide (4.9, B36): the rows / columns its slide hides or its version deletes (model/hidden.ts) – an own layout, cached
    by the set; a set that would leave no row or column is not applied (the table never vanishes) */
export function resolveTable(wb: Workbook, def: TableDef, design?: Design, hide?: HideSet | null): TableLayout | null {
  const z = tableSizes(def, design);
  const S = wb.sheets.find(s => s.name === def.sheet); if (!S) return null;
  let L: TableLayout | null = null, g: Range | null = null, T: TableLayout | null = null;
  if (def.kind === "markers") {
    T = S.tables.find(T => A1(T.g.r1, T.g.c1) === def.anchor) || S.tables[def.index] || null;
    if (T) g = T.g;
  } else if (validRange(def.range)) {
    g = rangeToG(def.range); if (def.grow) g = growG(S, g);
  }
  // the hidden rows / columns inside the table (the same layout whatever else the slide hides)
  const h = g && hideSize(hide) ? inside(hide!, g) : null, hk = hideKey(h);
  if (T && !hasExtras(def, z) && !hk) L = T;                  // shared layout of the "x" region
  else if (g) {
    // own layout per table definition when it has sizes, colour scales or hidden rows (they must not leak to other tables)
    const key = S.name + "|" + JSON.stringify(g) + (hasExtras(def, z) || hk ? "|" + def.id + "|" + JSON.stringify([z.cols, z.rows, def.merges]) : "") + (hk ? "|h" + hk : "");
    const hit = LCACHE.get(key);
    if (!hit || hit.wb !== wb) {
      const sz = { cols: z.cols, rows: z.rows, merges: def.merges }, b = hk ? buildLayout(S, g, sz, h) : null;
      const out = b || buildLayout(S, g, sz);
      if (out) { if (b) out.hide = hk; LCACHE.set(key, { wb, L: out }); if (hk) trimHidden(key); } else LCACHE.delete(key);
    }
    L = LCACHE.get(key)?.L || null;
  }
  if (!L) return null;
  L.sheet = S; L.def = def; L.id = def.id;
  L.items.forEach(it => { it.L = L!; });
  return L;
}
export function tableName(L: TableLayout, preset: Preset | null): string {
  if (L.def && L.def.name) return L.def.name;
  const base = L.sheet.title || L.sheet.name;
  const many = !!preset && preset.tables.filter(t => t.sheet === L.sheet.name).length > 1;
  return many ? base + " · " + gToRange(L.g) : base;
}

/** default preset for a workbook opened for the first time (x-marker tables of the "slide" sheets) */
export function defaultPreset(wb: Workbook): Preset {
  const withTables = visibleSheets(wb).filter(S => S.tables.length);
  let chosen = withTables.filter(S => SLIDE_RX.test(S.name));
  if (!chosen.length) chosen = withTables;
  const tables: TableDef[] = [], slides: SlideDef[] = [];
  for (const S of chosen) {
    const ids = S.tables.map((T, i) => { const id = uid(); tables.push({ id, sheet: S.name, kind: "markers", anchor: A1(T.g.r1, T.g.c1), index: i }); return id; });
    slides.push({ id: uid(), type: "content", title: null, subtitle: null, tables: ids, layout: null });
  }
  const sheets = wb.meta.filter(x => SLIDE_RX.test(x.name) || chosen.some(S => S.name === x.name)).map(x => x.name);
  return { sheets, tables, slides };
}

/** runtime slides: preset slides with their tables resolved against the workbook */
/** the slides of a preset with their tables, sized for `design` (column widths and row heights are per design) */
/** opts.drop (4.9, S16.2): the shown version's deleted rows / columns per sheet; a slide's own `hidden` rows / columns
    (S16.1) resolve that slide's tables on their own */
export function runtimeSlides(wb: Workbook, preset: Preset | null, workbookName: string, design?: Design, opts?: { drop?: DropMap }): RuntimeSlide[] {
  if (!preset) return [];
  const T: Record<string, TableLayout> = {}, drop = opts?.drop && typeof opts.drop === "object" && Object.keys(opts.drop).length ? opts.drop : null;
  const defs = new Map((preset.tables || []).map(d => [d.id, d]));
  // a table the version would leave with no row or column keeps them all (resolveTable: it never vanishes); the menu and
  // the wizard refuse such a delete, two writers' merge can reach it – counted, the Issues panel names it (S16.2 review)
  const whole = new Set<string>();
  for (const def of preset.tables || []) {
    const h = drop ? hideFor(null, def.id, def.sheet, drop) : null, L = resolveTable(wb, def, design, h);
    if (L) { T[def.id] = L; if (h && !L.hide && hideSize(inside(h, L.g))) whole.add(def.id); }
  }
  /** a table as this slide shows it: with the rows / columns it hides (and the version's), else the deck's layout */
  const onSlide = (ps: SlideDef, id: string) => {
    const def = defs.get(id);
    return def && T[id] && ps.hidden && hiddenEntries(ps, id).length ? resolveTable(wb, def, design, hideFor(ps, id, def.sheet, drop)) || T[id] : T[id];
  };
  return (preset.slides || []).map(ps => {
    const tables = (ps.tables || []).map(id => onSlide(ps, id)).filter(Boolean);
    const S0 = tables[0] && tables[0].sheet;
    const sameSheet = tables.length > 0 && tables.every(L => L.sheet === S0);
    const R: RuntimeSlide = { id: ps.id, type: ps.type || "content", cfg: ps, tables, missing: (ps.tables || []).filter(id => !T[id]).length, title: "", subtitle: "", label: "" };
    const nw = whole.size ? (ps.tables || []).filter(id => whole.has(id)).length : 0; if (nw) R.dropWhole = nw;
    if (R.type === "cover") { R.title = ps.title || workbookName.replace(/\.[^.]+$/, ""); R.subtitle = ps.subtitle || ""; R.label = "Cover"; }
    else if (R.type === "index") { R.title = ps.title || "Contents"; R.subtitle = ps.subtitle || ""; R.label = "Index"; }
    else {
      R.title = ps.title || (S0 ? (S0.title || S0.name) : "New slide");
      const a2inTable = sameSheet && tables.some(L => 2 > L.g.r1 && 2 < L.g.r2 && 1 > L.g.c1 && 1 < L.g.c2);
      R.subtitle = ps.subtitle != null && ps.subtitle !== "" ? ps.subtitle : (sameSheet && !a2inTable ? S0.subtitle : "");
      R.label = ps.title || (S0 ? S0.name : "Empty slide");
    }
    return R;
  });
}
