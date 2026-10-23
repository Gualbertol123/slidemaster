/* The budget-achievement chart's changes (4.14, B55; core render/chart-progress.ts): Insert chart ▾ › Budget
   achievement… (a long table chosen in the sheet view: its header row names the group, value and target columns, else
   their order – one item, one undo step), the type switch's first `progress` from a series chart, and the chart panel's
   builders – each ONE item.patch: `progress` is a plain key, written whole from the item as it is now (null removes a
   setting); a subtitle (any chart) typed or from a cell. Pure functions of the item (app/tests/chart-progress-panel.test.tsx);
   chart-progress-insert.ts reads the header row and sends (this file stays free of the page: chart-panel.ts imports it). */
import type { ChartItem, ChartProgress, DataRef, ItemPatch } from "@slide-builder/core/model/types";
import { A1, parseRange } from "@slide-builder/core/xlsx/util";
import { isNumText } from "@slide-builder/core/render/context";

/** a first row of numbers only (or blanks) is data, not a header row (as KPI cards from table) */
const isHeaderRow = (headers: string[]) => headers.some(h => h.trim() && !isNumText(h));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
/** the long table's columns by header name: the group (Product …), the value (Volume, Actual …), the target (Budget,
    Target …) – column numbers; null for one not named (then the column order: first, second to last, last) */
export function progressColumns(headers: string[], c0: number): { by: number; val: number; target: number } {
  const H = headers.map(norm), at = (re: RegExp, not: number[] = []) => { const i = H.findIndex((h, k) => re.test(h) && !not.includes(c0 + k)); return i < 0 ? -1 : c0 + i; };
  const c2 = c0 + headers.length - 1;
  const target = at(/budget|bdg|target|plan|goal|objective/);
  const by = at(/^(product|name|item|category|segment|kpi|line|business|desk|branch|region)/, [target]);
  const val = at(/volume|value|actual|current|latest|amount|balance|stock|outstanding|^vol|^act/, [target, by]);
  return { by: by >= 0 ? by : c0, val: val >= 0 ? val : Math.max(c0, c2 - 1), target: target >= 0 ? target : c2 };
}
/** a header as words: "Volume_EUR_m" → "volume", "EoM_Budget_EUR_m" → "EoM budget" (units dropped, a Capitalised word
    lower-cased, an acronym kept) */
export function headerWords(h: string): string {
  const words = h.replace(/[_.]+/g, " ").split(/\s+/).filter(w => w && !/^(eur|usd|gbp|chf|€|\$|m|mn|mln|k|bn|%|\(.*\))$/i.test(w));
  return words.map(w => /^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w).join(" ");
}
/** the subtitle Insert writes: "Latest volume / EoM budget" (the picture's) from the two headers */
export const subtitleOf = (val: string, target: string) => {
  const v = headerWords(val), t = headerWords(target);
  return v && t ? `Latest ${v} / ${t}` : "Latest value / budget";
};
/** the chart Budget achievement… makes of a long table (`range`: its header row and data rows), at the slide's right */
export function achievementFromTable(sheet: string, range: string, headers: string[]): ChartItem | null {
  const g = parseRange(range), head = isHeaderRow(headers), first = head ? g.r1 + 1 : g.r1;
  if (g.r2 < first || g.c2 <= g.c1) return null;
  const cols = head ? progressColumns(headers, g.c1) : { by: g.c1, val: Math.max(g.c1, g.c2 - 1), target: g.c2 };
  const col = (c: number): DataRef => ({ sheet, range: A1(first, c) + ":" + A1(g.r2, c) });
  const name = (c: number) => head ? headers[c - g.c1] || "" : "";
  return { kind: "chart", type: "progress", title: "BUDGET ACHIEVEMENT", titleFmt: { align: "left" }, subtitle: subtitleOf(name(cols.val), name(cols.target)),
    values: col(cols.val), labels: col(cols.by), legendAt: "none", box: { x: 1240, y: 180, w: 300, h: 660 },
    progress: { table: { by: col(cols.by), val: col(cols.val), target: col(cols.target) } } };
}
/** the type switch to "progress": the chart's own `progress` when it has one, else one from its first series (its
    values; its targets, if any, as the targets) or its values */
export function toProgressPatch(it: ChartItem): ItemPatch {
  if (isObj(it.progress)) return { type: "progress" };
  const s = Object.values(it.sers || {}).filter(x => x && Array.isArray(x.vals)).sort((a, b) => (+a.n || 0) - (+b.n || 0))[0];
  const p: ChartProgress = s ? { vals: s.vals, ...(Array.isArray(s.target) && s.target.length ? { targets: s.target } : {}) } : { vals: [it.values] };
  return { type: "progress", progress: p };
}
type Sub = "pct" | "cat" | "gap";
/** the chart's `progress` with these settings (null / undefined / "" removes one); `sub` sets them inside pct / cat / gap
    (an emptied part goes) */
export function progressPatch(it: ChartItem, p: Record<string, unknown>, sub?: Sub): ItemPatch {
  const cur: Record<string, unknown> = isObj(it.progress) ? JSON.parse(JSON.stringify(it.progress)) : {};
  const tgt: Record<string, unknown> = sub ? (isObj(cur[sub]) ? cur[sub] as Record<string, unknown> : {}) : cur;
  for (const [k, v] of Object.entries(p)) { if (v === null || v === undefined || v === "") delete tgt[k]; else tgt[k] = v; }
  if (sub) { if (Object.keys(tgt).length) cur[sub] = tgt; else delete cur[sub]; }
  return { progress: cur as ChartProgress };
}
/** a text format inside pct / cat / gap (size, colour, bold), merged */
export function progressFmtPatch(it: ChartItem, sub: Sub, f: Record<string, unknown>): ItemPatch {
  const cur = isObj(it.progress) && isObj(it.progress[sub]) && isObj((it.progress[sub] as Record<string, unknown>).fmt) ? { ...(it.progress[sub] as { fmt: Record<string, unknown> }).fmt } : {};
  for (const [k, v] of Object.entries(f)) { if (v === null || v === undefined || v === "") delete cur[k]; else cur[k] = v; }
  return progressPatch(it, { fmt: Object.keys(cur).length ? cur : null }, sub);
}
/** where the data comes from: the long table (its columns kept), or ranges / cells */
export function sourcePatch(it: ChartItem, mode: "table" | "cells"): ItemPatch {
  const P = isObj(it.progress) ? it.progress as ChartProgress : {};
  if (mode === "cells") return progressPatch(it, { table: null, vals: P.vals ?? (P.table ? [P.table.val] : [it.values]), ...(P.targets ? {} : P.table ? { targets: [P.table.target] } : {}) });
  return progressPatch(it, { table: P.table ?? { by: it.labels ?? it.values, val: P.vals?.[0] ?? it.values, target: P.targets?.[0] ?? it.values } });
}
/** the cells chosen in the sheet view for the chart (PickCells "chart-ref") */
export type ProgressRef = "prog-by" | "prog-val" | "prog-target" | "prog-vals" | "prog-targets" | "prog-cats" | "subtitle-cell";
export function progressRefPatch(it: ChartItem, what: ProgressRef, ref: DataRef): ItemPatch | null {
  const P = isObj(it.progress) ? it.progress as ChartProgress : {};
  const t = P.table ?? { by: ref, val: ref, target: ref };
  switch (what) {
    case "prog-by": return progressPatch(it, { table: { ...t, by: ref } });
    case "prog-val": return { ...progressPatch(it, { table: { ...t, val: ref } }), values: ref };
    case "prog-target": return progressPatch(it, { table: { ...t, target: ref } });
    case "prog-vals": return { ...progressPatch(it, { vals: [ref] }), values: ref };
    case "prog-targets": return progressPatch(it, { targets: [ref] });
    case "prog-cats": return progressPatch(it, { cats: ref });
    case "subtitle-cell": return { subtitle: { ...ref, range: ref.range.split(":")[0] } };
  }
}
/** the subtitle typed (empty: none) */
export const subtitlePatch = (v: string): ItemPatch => ({ subtitle: v.trim() ? v.trim() : null });
