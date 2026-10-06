/* Presets: which tables exist ("x" markers or picked ranges) and which slides show them. */
import { buildLayout } from "../xlsx/layout";
import { A1, parseRange, uid } from "../xlsx/util";
import type { Range } from "../xlsx/util";
import type { Sheet, TableLayout, Workbook } from "../xlsx/types";
import type { Preset, RuntimeSlide, SlideDef, TableDef } from "./types";

export const SLIDE_RX = /slide/i;
export const visibleSheets = (wb: Workbook) => wb.sheets.filter(S => !S.hidden);
export const rangeToG = (range: string): Range => {
  const g = parseRange(range.toUpperCase().replace(/\$/g, ""));
  return { r1: Math.min(g.r1, g.r2) - 1, c1: Math.min(g.c1, g.c2) - 1, r2: Math.max(g.r1, g.r2) + 1, c2: Math.max(g.c1, g.c2) + 1 };
};
export const gToRange = (g: Range) => A1(g.r1 + 1, g.c1 + 1) + ":" + A1(g.r2 - 1, g.c2 - 1);
export const validRange = (r: unknown) => /^\$?[A-Z]{1,3}\$?\d{1,7}(:\$?[A-Z]{1,3}\$?\d{1,7})?$/i.test(String(r || "").trim());
export const presetSheets = (p: Preset | null | undefined) => [...new Set(((p && p.tables) || []).map(t => t.sheet))];

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
const hasExtras = (def: TableDef) => !!(def.cols || def.rows || def.scales || def.merges);
export function resolveTable(wb: Workbook, def: TableDef): TableLayout | null {
  const S = wb.sheets.find(s => s.name === def.sheet); if (!S) return null;
  let L: TableLayout | null = null, g: Range | null = null;
  if (def.kind === "markers") {
    const T = S.tables.find(T => A1(T.g.r1, T.g.c1) === def.anchor) || S.tables[def.index] || null;
    if (T && !hasExtras(def)) L = T;                       // shared layout of the "x" region
    else if (T) g = T.g;
  } else if (validRange(def.range)) {
    g = rangeToG(def.range); if (def.grow) g = growG(S, g);
  }
  if (!L && g) {
    // own layout per table definition when it has sizes or colour scales (they must not leak to other tables)
    const key = S.name + "|" + JSON.stringify(g) + (hasExtras(def) ? "|" + def.id + "|" + JSON.stringify([def.cols, def.rows, def.merges]) : "");
    const hit = LCACHE.get(key);
    if (!hit || hit.wb !== wb) { const b = buildLayout(S, g, { cols: def.cols, rows: def.rows, merges: def.merges }); if (b) LCACHE.set(key, { wb, L: b }); else LCACHE.delete(key); }
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
export function runtimeSlides(wb: Workbook, preset: Preset | null, workbookName: string): RuntimeSlide[] {
  if (!preset) return [];
  const T: Record<string, TableLayout> = {};
  for (const def of preset.tables || []) { const L = resolveTable(wb, def); if (L) T[def.id] = L; }
  return (preset.slides || []).map(ps => {
    const tables = (ps.tables || []).map(id => T[id]).filter(Boolean);
    const S0 = tables[0] && tables[0].sheet;
    const sameSheet = tables.length > 0 && tables.every(L => L.sheet === S0);
    const R: RuntimeSlide = { id: ps.id, type: ps.type || "content", cfg: ps, tables, missing: (ps.tables || []).filter(id => !T[id]).length, title: "", subtitle: "", label: "" };
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
