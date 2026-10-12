/* What the wizard and the formula bar read of a sheet, computed where the sheet is (the core worker, PLAN S2.5):
   a sheet's summary, a window of its cells as the wizard's preview draws them, one cell, and the size of a table
   definition. Plain data: a few hundred rows travel to the page, never the sheet. */
import { formatValue } from "./numfmt";
import { usedRange } from "./detect";
import { splitRef, type Range } from "./util";
import { growG, rangeToG, tableSizes, validRange } from "../model/preset";
import { buildLayout } from "./layout";
import { A1 } from "./util";
import type { TableDef } from "../model/types";
import type { CellType, Sheet, Workbook } from "./types";

export interface SheetInfo {
  name: string; error?: string; title: string;
  /** the "x" regions (marker tables), in order */
  regions: Range[];
  /** the used range as the wizard shows it (clipped to 400 rows × 80 columns) */
  used: { r2: number; c2: number; clipped: boolean };
}
export function sheetInfo(S: Sheet): SheetInfo {
  return { name: S.name, ...(S.error !== undefined ? { error: S.error } : {}), title: S.title, regions: S.tables.map(T => T.g), used: usedRange(S) };
}

/** a cell of a window: its text as the sheet shows it and the few styles the wizard's preview uses */
export interface WindowCell { r: number; c: number; text: string; fill?: string; color?: string; b?: true; right?: true }
export interface SheetWindow {
  r0: number; r1: number; c0: number; c1: number;
  /** per row / column of the window: shown size in px (Excel's) and hidden */
  rows: { px: number; hidden: boolean }[]; cols: { px: number; hidden: boolean }[];
  /** the cells there are in visible rows and columns */
  cells: WindowCell[];
}
export function sheetWindow(S: Sheet, r0: number, r1: number, c0: number, c1: number): SheetWindow {
  const rows: SheetWindow["rows"] = [], cols: SheetWindow["cols"] = [], cells: WindowCell[] = [];
  for (let r = r0; r <= r1; r++) rows.push({ px: S.rowPx(r), hidden: S.rowHidden(r) });
  for (let c = c0; c <= c1; c++) cols.push({ px: S.colPx(c), hidden: S.colHidden(c) });
  for (let r = r0; r <= r1; r++) {
    if (rows[r - r0].hidden) continue;
    for (let c = c0; c <= c1; c++) {
      if (cols[c - c0].hidden) continue;
      const x = S.get(r, c); if (!x) continue;
      const w: WindowCell = { r, c, text: x.t !== "blank" ? formatValue(x).text : "" };
      const f = x.xf || {};
      if (f.fill) w.fill = f.fill;
      if (f.font && f.font.color && f.font.color !== "#000000") w.color = f.font.color;
      if (f.font && f.font.b) w.b = true;
      if (x.t === "n" || x.t === "d") w.right = true;
      cells.push(w);
    }
  }
  return { r0, r1, c0, c1, rows, cols, cells };
}

/** one cell: its value, type, number format and the text Excel shows */
export interface CellInfo { sheet: string; ref: string; v: string | number | boolean | null; t: CellType; fmt: string; text: string }
export function cellInfo(S: Sheet, ref: string): CellInfo | null {
  const a = splitRef(ref); if (!a) return null;
  const x = S.get(a.r, a.c); if (!x) return null;
  return { sheet: S.name, ref, v: x.v, t: x.t, fmt: x.fmt, text: x.t !== "blank" ? formatValue(x).text : "" };
}

/** rows × columns a table definition shows (null: it does not resolve) – what resolveTable gives, without
    caching or touching shared layouts (the wizard's drafts must not reach the layouts the worker draws with) */
export function tableSize(wb: Workbook, def: TableDef): [number, number] | null {
  const z = tableSizes(def), S = wb.sheets.find(s => s.name === def.sheet); if (!S) return null;
  const extras = !!(z.cols || z.rows || def.scales || def.merges);
  let g: Range | null = null;
  if (def.kind === "markers") {
    const T = S.tables.find(T => A1(T.g.r1, T.g.c1) === def.anchor) || S.tables[def.index] || null;
    if (T && !extras) return [T.rows.length, T.cols.length];
    if (T) g = T.g;
  } else if (validRange(def.range)) { g = rangeToG(def.range); if (def.grow) g = growG(S, g); }
  const L = g ? buildLayout(S, g, { cols: z.cols, rows: z.rows, merges: def.merges }) : null;
  return L ? [L.rows.length, L.cols.length] : null;
}
