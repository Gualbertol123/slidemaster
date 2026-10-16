/* A scenario overlay (PLAN S7.4, docs/next/07 §2.4, ADR-014): the cells the engine recomputed, laid over the workbook
   as a *view* – a Workbook whose changed sheets are copies of the real ones with those cells' values replaced. The
   renderers read the view through the same Sheet interface as the real workbook, so tables, comments, conditional
   formats, charts and callouts follow the scenario without knowing it; the real SheetStore, the document and the
   workbook file are never touched, and dropping the view ends the scenario. */
import { CellMap, Kind, type SheetColumns } from "../xlsx/sheetstore";
import { findRegions } from "../xlsx/layout";
import { makeSheet, textOf } from "../xlsx/workbook";
import type { Sheet, Workbook } from "../xlsx/types";
import type { CellValue } from "./engine";

/** the sheet with `changes` ("r,c" → value) in place of its cells' values: a copy of its columns (13 bytes a cell), the
    same formats, rows, merges, conditional formats and drawings; a value a cell did not have becomes a new cell only
    when the cell exists (the engine changes formula cells, which exist) */
export function overlaySheet(S: Sheet, changes: Map<string, CellValue>): Sheet {
  const C = S.cols?.cells; if (!C || !S.cols) return S;
  const cols: SheetColumns = { ...C, kind: C.kind.slice(), num: C.num.slice(), strs: C.strs.slice() };
  const strIx = new Map<string, number>();
  const intern = (s: string) => { let i = strIx.get(s); if (i === undefined) { i = cols.strs.indexOf(s); if (i < 0) { i = cols.strs.length; cols.strs.push(s); } strIx.set(s, i); } return i; };
  for (const [key, v] of changes) {
    const comma = key.indexOf(","), r = +key.slice(0, comma), c = +key.slice(comma + 1);
    const i = cellIndexOf(C, r, c); if (i < 0) continue;
    if (v === null || v === "") { cols.kind[i] = Kind.Blank; cols.num[i] = 0; }
    else if (typeof v === "number") { cols.kind[i] = C.kind[i] === Kind.Date ? Kind.Date : Kind.Num; cols.num[i] = v; }
    else if (typeof v === "boolean") { cols.kind[i] = Kind.Bool; cols.num[i] = v ? 1 : 0; }
    else if (typeof v === "string") { cols.kind[i] = Kind.Str; cols.num[i] = intern(v); }
    else { cols.kind[i] = Kind.Err; cols.num[i] = intern(v.err); }
  }
  const V = makeSheet({ name: S.name, cells: new CellMap(cols, S.ctx), rowInfo: S.rowInfo, colRanges: S.colRanges, merges: S.merges, cfRules: S.cfRules, unsupportedCF: S.unsupportedCF,
    drawing: S.drawing, defColW: S.defColW, defRowH: S.defRowH, zeroH: S.zeroH, ctx: S.ctx, ...(S.error !== undefined ? { error: S.error } : {}) }, cols);
  V.cols = { cells: cols, rows: S.cols.rows }; V.hidden = S.hidden; V.size = S.size; V.unpaired = S.unpaired;
  if (S.unreadableFormulas) V.unreadableFormulas = S.unreadableFormulas;
  V.title = textOf(V, 1, 1); V.subtitle = textOf(V, 2, 1); if (V.subtitle.toLowerCase() === "x") V.subtitle = "";
  V.tables = findRegions(V);
  return V;
}
function cellIndexOf(C: SheetColumns, r: number, c: number): number {
  let lo = 0, hi = C.rows.length; while (lo < hi) { const m = (lo + hi) >> 1; if (C.rows[m] < r) lo = m + 1; else hi = m; }
  if (lo >= C.rows.length || C.rows[lo] !== r) return -1;
  let a = C.rowOff[lo], b = C.rowOff[lo + 1];
  while (a < b) { const m = (a + b) >> 1; if (C.col[m] < c) a = m + 1; else b = m; }
  return a < C.rowOff[lo + 1] && C.col[a] === c ? a : -1;
}

/** the workbook as the scenario sees it: the same object but for the changed sheets (by sheet id, as `wb.sheets` names
    them). A new object each time: the per-workbook layout cache (model/preset.ts LCACHE keys on the workbook object)
    never serves the scenario's layouts to the real workbook or the other way round (the worker clears it per preview,
    so it does not grow by one set of layouts each time) */
export function overlayWorkbook(wb: Workbook, changes: Map<string, Map<string, CellValue>>): Workbook {
  const view: Workbook = { ...wb, sheets: wb.sheets.map(S => { const ch = changes.get(S.name); return ch && ch.size ? overlaySheet(S, ch) : S; }) };
  view.isLoaded = n => view.sheets.some(S => S.name === n);
  view.ensure = async names => { const added = await wb.ensure(names); for (const S of added) if (!view.isLoaded(S.name)) view.sheets.push(S); return added; };
  return view;
}
/** a short stable digest of the changes: part of every table's cache key while the scenario shows */
export function overlayHash(changes: Map<string, Map<string, CellValue>>): string {
  let h = 0x811c9dc5, n = 0;
  for (const [sheet, m] of changes) for (const [k, v] of m) { n++; for (const ch of sheet + "|" + k + "=" + (v && typeof v === "object" ? v.err : String(v))) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); }
  return n ? "s" + (h >>> 0).toString(16) + "-" + n : "";
}
