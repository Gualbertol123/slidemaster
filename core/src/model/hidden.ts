/* Rows and columns closed up on a slide (4.9, B36, 09 §2.5 / §3.6): one hidden set per table, the union of
   - the slide's own `hidden` map (F11: "<tableId>:r<sheet row>" / "<tableId>:c<COLUMN>", this slide only), and
   - the shown version's `drop` (F14: per sheet, "5:7" rows / "C:D" columns, every slide of that version).
   buildLayout closes the set up exactly as it closes Excel's own hidden rows and columns, so sizing, borders, gridlines,
   comments, KPIs, charts reading the table and every export follow from the one layout. Pure. */
import { colToNum, numToCol } from "../xlsx/util";
import type { SlideDef } from "./types";

export interface HideSet { rows: Set<number>; cols: Set<number> }
export const emptyHide = (): HideSet => ({ rows: new Set(), cols: new Set() });
export const hideSize = (h: HideSet | null | undefined) => h ? h.rows.size + h.cols.size : 0;

/** the slide.patch key of a row / column of a table */
export const hiddenKey = (tableId: string, kind: "r" | "c", n: number) => tableId + ":" + kind + (kind === "r" ? n : numToCol(n));
/** a key read back: its table, row or column number (null: not a key of a row or column) */
export function parseHiddenKey(k: string): { table: string; kind: "r" | "c"; n: number } | null {
  const i = k.lastIndexOf(":"); if (i <= 0) return null;
  const m = /^(?:r([1-9][0-9]{0,6})|c([A-Z]{1,3}))$/.exec(k.slice(i + 1)); if (!m) return null;
  return m[1] ? { table: k.slice(0, i), kind: "r", n: +m[1] } : { table: k.slice(0, i), kind: "c", n: colToNum(m[2]) };
}
/** the rows and columns a slide hides of one of its tables */
export function slideHidden(cfg: Pick<SlideDef, "hidden"> | null | undefined, tableId: string | undefined, into = emptyHide()): HideSet {
  const map = cfg?.hidden;
  if (!tableId || !map || typeof map !== "object") return into;
  for (const [k, v] of Object.entries(map)) {
    if (v !== true) continue;
    const p = parseHiddenKey(k); if (!p || p.table !== tableId) continue;
    (p.kind === "r" ? into.rows : into.cols).add(p.n);
  }
  return into;
}
/** a version's deleted rows / columns of one sheet: "5:7" / "5" rows, "C:D" / "C" columns (anything else is skipped) */
export function dropHidden(list: unknown, into = emptyHide()): HideSet {
  if (!Array.isArray(list)) return into;
  for (const x of list) {
    const m = typeof x === "string" ? /^\s*(?:([0-9]{1,7})(?::([0-9]{1,7}))?|([A-Z]{1,3})(?::([A-Z]{1,3}))?)\s*$/i.exec(x) : null;
    if (!m) continue;
    const rows = !!m[1], a = rows ? +m[1] : colToNum(m[3].toUpperCase()), b = rows ? +(m[2] || m[1]) : colToNum((m[4] || m[3]).toUpperCase());
    const lo = Math.max(1, Math.min(a, b)), hi = Math.min(Math.max(a, b), lo + 100000);
    for (let n = lo; n <= hi; n++) (rows ? into.rows : into.cols).add(n);
  }
  return into;
}
/** what a version deletes, per sheet (`DeckVersion.drop`, S16.2) */
export type DropMap = Record<string, unknown> | null | undefined;
/** the hidden set of one table on one slide: the slide's rows / columns and the version's deleted ones of its sheet */
export function hideFor(cfg: Pick<SlideDef, "hidden"> | null | undefined, tableId: string | undefined, sheet: string, drop?: DropMap): HideSet {
  const h = slideHidden(cfg, tableId);
  if (drop && typeof drop === "object" && Object.prototype.hasOwnProperty.call(drop, sheet)) dropHidden(drop[sheet], h);
  return h;
}
/** a set as a cache key ("" when empty): it joins the layout cache key and tableKey, so every cache misses exactly where
    the hidden set changed */
export function hideKey(h: HideSet | null | undefined): string {
  if (!hideSize(h)) return "";
  const n = (s: Set<number>) => [...s].sort((a, b) => a - b).join(",");
  return "r" + n(h!.rows) + "c" + n(h!.cols);
}
/** the slide's hidden entries of one table (the keys to clear for "Unhide all on this table") */
export function hiddenEntries(cfg: Pick<SlideDef, "hidden"> | null | undefined, tableId: string): string[] {
  return Object.keys(cfg?.hidden || {}).filter(k => parseHiddenKey(k)?.table === tableId);
}
