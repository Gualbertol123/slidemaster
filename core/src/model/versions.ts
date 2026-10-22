/* Delete-versions (4.9, B37, docs/next/09 §2.5 / §3.7): a version's per-sheet lists as the wizard's step 4 and ribbon 2 ›
   Cells › For this version ▾ edit them – `drop` (whole rows "5:7" / columns "C:D" deleted: the tables close up, through
   model/hidden.ts) and `hide` (A1 ranges emptied in place). Each edit is one version.patch replacing that sheet's list
   whole (ops.ts). Pure. */
import { dropHidden, emptyHide, type HideSet } from "./hidden";
import { gToRange, rangeToG, validRange } from "./preset";
import { colToNum, numToCol } from "../xlsx/util";
import type { DeckVersion, Op, Preset } from "./types";

export const versionOf = (preset: Preset | null | undefined, id: string | null | undefined): DeckVersion | null =>
  id ? (preset?.versions || []).find(v => v && v.id === id) || null : null;
/** what runtimeSlides closes up for the version shown ("" or a missing id: the full deck, nothing) */
export function versionDrop(preset: Preset | null | undefined, id: string | null | undefined): Record<string, string[]> | undefined {
  const d = versionOf(preset, id)?.drop;
  return d && typeof d === "object" && Object.keys(d).length ? d : undefined;
}

/** a cell in a row or column the version deletes (a callout quoting it shows it empty, as a removed one) */
export function droppedCell(v: DeckVersion | null | undefined, sheet: string, r: number, c: number): boolean {
  const list = v?.drop?.[sheet]; if (!list) return false;
  const h = dropHidden(list); return h.rows.has(r) || h.cols.has(c);
}
/** runs of consecutive numbers: [[5,7],[9,9]] */
function runs(ns: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const n of [...new Set(ns)].sort((a, b) => a - b)) { const l = out[out.length - 1]; if (l && n === l[1] + 1) l[1] = n; else out.push([n, n]); }
  return out;
}
/** a hidden set as a sheet's `drop` list: rows first ("5:7", "9"), then columns ("C:D", "F") */
export function dropList(h: HideSet): string[] {
  return [...runs([...h.rows]).map(([a, b]) => a === b ? String(a) : a + ":" + b),
    ...runs([...h.cols]).map(([a, b]) => a === b ? numToCol(a) : numToCol(a) + ":" + numToCol(b))];
}
/** a sheet's `drop` list with rows (columns) `ns` deleted (`on`) or restored: normalised, in order */
export function dropEdit(list: string[] | undefined, kind: "r" | "c", ns: number[], on: boolean): string[] {
  const h = dropHidden(list || [], emptyHide()), s = kind === "r" ? h.rows : h.cols;
  for (const n of ns) if (on) s.add(n); else s.delete(n);
  return dropList(h);
}
/** "a table keeps at least one row / column" (the rule of For this version ▾ and of the wizard's Delete rows / columns):
    the first of a sheet's table ranges (A1, as the wizard holds them) that the drop list leaves with no row or no
    column – Excel's hidden ones count as gone (`off`, when known); null when every table keeps some */
export function dropEmpties(list: string[] | undefined, ranges: (string | null | undefined)[], off?: { row(r: number): boolean; col(c: number): boolean }): string | null {
  const h = dropHidden(list || []);
  const keeps = (a: number, b: number, gone: (n: number) => boolean) => { for (let n = a; n < b; n++) if (!gone(n)) return true; return false; };
  for (const r of ranges) {
    if (!r || !validRange(r)) continue;
    const g = rangeToG(r);                                                                // (bounds outside the range)
    if (!keeps(g.r1 + 1, g.r2, n => h.rows.has(n) || !!off?.row(n)) || !keeps(g.c1 + 1, g.c2, n => h.cols.has(n) || !!off?.col(n))) return r;
  }
  return null;
}
/** an entry as the lists show it: "rows 10–12", "row 9", "columns I:J", "column F" */
export function dropLabel(entry: string): string {
  const m = /^(\d+)(?::(\d+))?$/.exec(entry);
  if (m) return m[2] && m[2] !== m[1] ? `rows ${m[1]}–${m[2]}` : `row ${m[1]}`;
  return entry.includes(":") ? `columns ${entry}` : `column ${entry}`;
}
/** how many rows and columns a version deletes, over every sheet */
export function dropCount(v: DeckVersion | null | undefined): { rows: number; cols: number } {
  let rows = 0, cols = 0;
  for (const list of Object.values(v?.drop || {})) { const h = dropHidden(list); rows += h.rows.size; cols += h.cols.size; }
  return { rows, cols };
}
/** a sheet's `hide` list without the cells of a rectangle (sheet rows / columns, inclusive): each range it overlaps
    loses the overlap (split into up to four ranges); the others are kept as they are */
export function hideWithout(list: string[] | undefined, s: { r1: number; c1: number; r2: number; c2: number }): string[] {
  const out: string[] = [];
  for (const x of list || []) {
    if (!validRange(x)) { out.push(x); continue; }
    const g = rangeToG(x), a = { r1: g.r1 + 1, c1: g.c1 + 1, r2: g.r2 - 1, c2: g.c2 - 1 };          // (rangeToG: bounds outside)
    if (a.r2 < s.r1 || a.r1 > s.r2 || a.c2 < s.c1 || a.c1 > s.c2) { out.push(x); continue; }
    const put = (r1: number, c1: number, r2: number, c2: number) => { if (r1 <= r2 && c1 <= c2) out.push(gToRange({ r1: r1 - 1, c1: c1 - 1, r2: r2 + 1, c2: c2 + 1 })); };
    put(a.r1, a.c1, s.r1 - 1, a.c2);                                                       // above
    put(s.r2 + 1, a.c1, a.r2, a.c2);                                                       // below
    const r1 = Math.max(a.r1, s.r1), r2 = Math.min(a.r2, s.r2);
    put(r1, a.c1, r2, s.c1 - 1);                                                           // left
    put(r1, s.c2 + 1, r2, a.c2);                                                           // right
  }
  return out;
}
/** the ops of For this version ▾ (and the wizard's lists): one version.patch each, null when nothing changes */
export type VersionAction = "dropRows" | "dropCols" | "empty" | "restoreSel" | "restoreAll";
export function versionOp(v: DeckVersion, action: VersionAction, sheet: string, sel: { r1: number; c1: number; r2: number; c2: number } | null, cells?: { rows: number[]; cols: number[] }): Op | null {
  const same = (a: string[] | undefined, b: string[]) => JSON.stringify(a || []) === JSON.stringify(b);
  const op = (patch: Record<string, unknown>): Op => ({ op: "version.patch", id: v.id, patch } as Op);
  const drop = v.drop?.[sheet], hide = v.hide?.[sheet];
  if (action === "restoreAll") return Object.keys(v.hide || {}).length || Object.keys(v.drop || {}).length ? op({ hide: null, drop: null }) : null;
  if (!sel) return null;
  const rows = cells?.rows ?? range(sel.r1, sel.r2), cols = cells?.cols ?? range(sel.c1, sel.c2);
  if (action === "dropRows" || action === "dropCols") {
    const next = dropEdit(drop, action === "dropRows" ? "r" : "c", action === "dropRows" ? rows : cols, true);
    return same(drop, next) ? null : op({ drop: { [sheet]: next } });
  }
  if (action === "empty") {
    const r = gToRange({ r1: sel.r1 - 1, c1: sel.c1 - 1, r2: sel.r2 + 1, c2: sel.c2 + 1 });
    return (hide || []).includes(r) ? null : op({ hide: { [sheet]: [...(hide || []), r] } });
  }
  // Restore selection: the rows and columns the selection spans (deleted ones inside it too) and its emptied cells
  let d = dropEdit(drop, "r", range(sel.r1, sel.r2), false); d = dropEdit(d, "c", range(sel.c1, sel.c2), false);
  const h = hideWithout(hide, sel), patch: Record<string, unknown> = {};
  if (!same(drop, d)) patch.drop = { [sheet]: d.length ? d : null };
  if (!same(hide, h)) patch.hide = { [sheet]: h.length ? h : null };
  return Object.keys(patch).length ? op(patch) : null;
}
const range = (a: number, b: number) => { const o: number[] = []; for (let n = Math.min(a, b); n <= Math.max(a, b); n++) o.push(n); return o; };
/** an entry's rows or columns (for the wizard's struck-through bands) */
export function dropBands(list: string[] | undefined): { kind: "r" | "c"; a: number; b: number; entry: string }[] {
  return (list || []).flatMap((entry): { kind: "r" | "c"; a: number; b: number; entry: string }[] => {
    const m = /^(\d+)(?::(\d+))?$/.exec(entry); if (m) return [{ kind: "r" as const, a: +m[1], b: +(m[2] || m[1]), entry }];
    const c = /^([A-Z]{1,3})(?::([A-Z]{1,3}))?$/.exec(entry); if (c) return [{ kind: "c" as const, a: colToNum(c[1]), b: colToNum(c[2] || c[1]), entry }];
    return [];
  });
}
