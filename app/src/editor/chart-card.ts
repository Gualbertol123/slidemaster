/* The chart card's changes (4.13, B54): pure builders of ONE item.patch each (one undo step), for the chart panel's
   "Card" section (ui/ChartCardPanel.tsx) – the stats row's chips, the corner tag, the separator, the momentum row's
   chips and label, and the long table's filter. Map entries (stats / moms) are written whole, per entry, so two writers on
   two chips both keep theirs; switching a part off keeps its settings (`off`), as the targets do. */
import type { ChartItem, ChartMom, ChartStat, DataRef, ItemPatch } from "@slide-builder/core/model/types";

const nextN = (m: Record<string, { n: number }> | undefined) => Math.max(0, ...Object.values(m || {}).map(x => +x?.n || 0)) + 1;
function newId(m: Record<string, unknown> | undefined, p: string) { let k = 1; while (m && (p + k) in m) k++; return p + k; }
const firstRef = (it: ChartItem) => Object.entries(it.marks || {}).filter(([, k]) => k && k.kind === "ref").map(([id]) => id).sort()[0];
/** a chip's settings changed (null removes a key) – the whole entry */
function withKeys<T extends object>(cur: T, p: Record<string, unknown>): T {
  const out = { ...cur } as Record<string, unknown>;
  for (const [k, v] of Object.entries(p)) { if (v === null || v === undefined) delete out[k]; else out[k] = v; }
  return out as T;
}
/** the owner's card in one step: latest value, the reference line's value and the gap to it (when the chart has a
    reference line), a separator, and the momentum row (vs first, since trough, period on period) */
export function cardPresetPatch(it: ChartItem): ItemPatch {
  const ref = firstRef(it), stats: Record<string, ChartStat> = { s1: { n: 1, label: "Latest", src: "last" } };
  if (ref) { stats.s2 = { n: 2, label: "Reference", src: "ref", ref }; stats.s3 = { n: 3, label: "Gap", src: "gap", ref }; }
  return { stats, sep: {}, moms: { m1: { n: 1, vs: "first" }, m2: { n: 2, vs: "trough" }, m3: { n: 3, vs: "prev" } } };
}
export function addStatPatch(it: ChartItem, src: ChartStat["src"] = "last"): ItemPatch | null {
  if (Object.values(it.stats || {}).filter(s => s && !s.off).length >= 4) return null;
  const ref = firstRef(it);
  return { stats: { [newId(it.stats, "s")]: { n: nextN(it.stats), src, ...((src === "ref" || src === "gap" || src === "gapPct") && ref ? { ref } : {}) } } };
}
export function statPatch(it: ChartItem, id: string, p: Partial<Record<keyof ChartStat, unknown>>): ItemPatch | null {
  const cur = it.stats?.[id]; if (!cur) return null;
  return { stats: { [id]: withKeys(cur, p) } };
}
export const removeStatPatch = (id: string): ItemPatch => ({ stats: { [id]: null } });
export function addMomPatch(it: ChartItem, vs: ChartMom["vs"] = "prev"): ItemPatch {
  return { moms: { [newId(it.moms, "m")]: { n: nextN(it.moms), vs } } };
}
export function momPatch(it: ChartItem, id: string, p: Partial<Record<keyof ChartMom, unknown>>): ItemPatch | null {
  const cur = it.moms?.[id]; if (!cur) return null;
  return { moms: { [id]: withKeys(cur, p) } };
}
export const removeMomPatch = (id: string): ItemPatch => ({ moms: { [id]: null } });
/** the tag's text (empty: no tag) and colour */
export function tagPatch(it: ChartItem, text: string | DataRef | null, color?: string | null): ItemPatch {
  if (text === null || (typeof text === "string" && !text.trim())) return { tag: null };
  const c = color === undefined ? it.tag?.color : color;
  return { tag: { text: typeof text === "string" ? text.trim() : text, ...(c ? { color: c } : {}) } };
}
/** the filter: its column (a range) and value (text, or a cell) – a filter without a column goes */
export function filterPatch(it: ChartItem, p: { by?: DataRef; eq?: string | DataRef }): ItemPatch | null {
  const by = p.by ?? it.filter?.by, eq = p.eq ?? it.filter?.eq ?? "";
  return by ? { filter: { by, eq } } : null;
}
/** the cells a card part takes from the sheet view (PickCells "chart-ref") */
export function cardRefPatch(it: ChartItem, w: { what: "stat-cell"; stat: string } | { what: "mom-cell"; mom: string } | { what: "tag-cell" } | { what: "filter-by" } | { what: "filter-eq" }, ref: DataRef): ItemPatch | null {
  const one = { ...ref, range: ref.range.split(":")[0] };
  switch (w.what) {
    case "stat-cell": return statPatch(it, w.stat, { src: "cell", cell: one });
    case "mom-cell": return momPatch(it, w.mom, { vs: "cell", cell: one });
    case "tag-cell": return tagPatch(it, one);
    case "filter-by": return filterPatch(it, { by: ref });
    case "filter-eq": return it.filter?.by ? filterPatch(it, { eq: one }) : null;
  }
}
