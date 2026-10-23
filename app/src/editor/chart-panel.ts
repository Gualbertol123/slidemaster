/* The chart panel's changes (S14.5, CT-08; docs/next/09 §2.2, §8 M14): each builds ONE item.patch from the chart as it
   is now, so every change is one undo step, and touches only the entries it changes – a whole series, group, axis or
   mark (item.patch merges these maps per entry) –, so two people changing two series (or a series and an axis) at once
   both keep their change; the same series: the later one wins (09 §2.2, Q13) – a point's setting and a series' cells
   included (`points` live in the series entry). A NEW series, group or mark gets a random id (newEntryId, as
   newItemId does for items), so two people adding one at once add two (S14.5 review 1). Pure functions of the item (tested on
   their own, app/tests/chart-panel.test.tsx; no page state here, so the core's export runs them in node too); chart-send.ts
   sends them. */
import { cardRefPatch } from "./chart-card";
import type { ChartAxis, ChartGroup, ChartItem, ChartMark, ChartSeries, ChartType, DataRef, ItemPatch, LegendAt, MarkAt, SeriesType } from "@slide-builder/core/model/types";

/** a point's settings as the panel writes them (colour, marker, label, a waterfall's `total`; core/src/model/types.ts) */
export type PointSet = NonNullable<ChartSeries["points"]>[string];
/** the chart types of the panel's switch, in its order */
export const CHART_TYPES: { t: ChartType; label: string }[] = [
  { t: "pie", label: "Pie" }, { t: "donut", label: "Donut" }, { t: "column", label: "Column" }, { t: "bar", label: "Bar" }, { t: "line", label: "Line" },
  { t: "area", label: "Area" }, { t: "combo", label: "Combo" }, { t: "scatter", label: "Scatter" }, { t: "waterfall", label: "Waterfall" }];
/** what a series may be in a combo: Excel's own combo set (09 §2.2: bar and scatter need axes of their own) */
export const COMBO_TYPES: SeriesType[] = ["column", "line", "area"];
export const isSeriesType = (t: ChartType) => t !== "pie" && t !== "donut";
const HEX = /^#[0-9A-Fa-f]{6}$/;
/** every series of the chart in its order (n, then id) – hidden ones too (the panel lists them, greyed) */
export function allSeries(it: ChartItem): [string, ChartSeries][] {
  return Object.entries(it.sers && typeof it.sers === "object" ? it.sers : {}).filter(([, s]) => s && typeof s === "object" && Array.isArray(s.vals))
    .sort(([a, p], [b, q]) => (Number.isFinite(+p.n) ? +p.n : 0) - (Number.isFinite(+q.n) ? +q.n : 0) || (a < b ? -1 : a > b ? 1 : 0)) as [string, ChartSeries][];
}
const sorted = <T extends { n: number }>(m: Record<string, T> | undefined) => Object.entries(m && typeof m === "object" ? m : {}).filter(([, g]) => g && typeof g === "object")
  .sort(([a, p], [b, q]) => (+p.n || 0) - (+q.n || 0) || (a < b ? -1 : a > b ? 1 : 0));
export const allGroups = (it: ChartItem): [string, ChartGroup][] => sorted(it.groups);
/** an id no entry of `m` has: prefix + 1, 2, … – only for an entry two writers would make the SAME (the type switch's
    first series, the first group of the chart's present categories): both then write one equal entry */
export function freeId(m: Record<string, unknown> | undefined, prefix: string): string {
  for (let k = 1; ; k++) if (!m || !(prefix + k in m)) return prefix + k;
}
/** a new entry's id: prefix + 5 random base-36 characters (none of `m`'s) – two writers adding at once never make the
    same id, so item.patch (which replaces a whole entry) keeps both additions (S14.5 review 1) */
export function newEntryId(m: Record<string, unknown> | undefined, prefix: string, rnd: () => number = Math.random): string {
  for (;;) { const id = prefix + rnd().toString(36).slice(2, 7).padEnd(5, "0"); if (!m || !(id in m)) return id; }
}
const nextN = (m: Record<string, { n: number }> | undefined) => Math.max(0, ...Object.values(m || {}).filter(x => x && typeof x === "object").map(x => +x.n || 0)) + 1;
/** an entry with these keys set (a null or undefined value: the key removed) */
function withKeys<T extends object>(cur: T, p: Record<string, unknown>): T {
  const out = { ...cur } as Record<string, unknown>;
  for (const [k, v] of Object.entries(p)) { if (v === null || v === undefined) delete out[k]; else out[k] = v; }
  return out as T;
}

/* ---- the chart ---- */
/** the type switch: a chart without series (a pie of one range, 4.3–4.6) gets its first series from its own numbers –
    `sers: {s1: {n: 1, vals: [values]}}`, `values` kept (09 §2.2) –, named as the pie's series name when it had one; its
    names (`labels`) stay its categories. The pie's own slice colours become the points' colours and its labels the
    series' labels (S14.5 review 6: "label" → category, "value" → value; its "percent" – a share of the whole pie – has
    no column / line counterpart, so it is not carried). Back to pie or donut: the series are kept (switching again finds
    them). The first series' id is "s1" (freeId): two writers switching at once write one equal series */
export function typePatch(it: ChartItem, t: ChartType): ItemPatch {
  if (!isSeriesType(t) || allSeries(it).length) return { type: t };
  const points: Record<string, PointSet> = {};
  for (const [k, v] of Object.entries(it.colors && typeof it.colors === "object" ? it.colors : {}))
    if (/^\d+$/.test(k) && typeof v === "string" && HEX.test(v)) points[k] = { color: v.toUpperCase() };
  const show = (Array.isArray(it.show) ? it.show : []).flatMap(x => x === "label" ? ["category" as const] : x === "value" ? ["value" as const] : []);
  const s1: ChartSeries = { n: 1, vals: [it.values], ...(typeof it.series === "string" && it.series ? { name: it.series } : {}),
    ...(Object.keys(points).length ? { points } : {}), ...(show.length ? { labels: { show } } : {}) };
  return { type: t, sers: { [freeId(it.sers, "s")]: s1 } };
}
export const stackPatch = (v: "none" | "stacked" | "percent"): ItemPatch => ({ stack: v === "none" ? null : v });
/** a number box: empty = unset (the default), else the number (clamped) */
export function numOrNull(v: string, lo = -Infinity, hi = Infinity): number | null | undefined {
  const t = v.trim().replace(",", ".");
  if (!t) return null;
  const n = +t;
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : undefined;
}

/* ---- series ---- */
/** a new series of these cells, after the others (its name: the text beside its cells, until one is typed) */
export function addSeriesPatch(it: ChartItem, vals: DataRef): ItemPatch {
  return { sers: { [newEntryId(it.sers, "s")]: { n: nextN(it.sers), vals: [vals], ...(it.type === "combo" ? { type: "line" as const } : {}) } } };
}
/** a series removed – with its legend entry and the marks that stand on it (they would point at nothing) */
export function removeSeriesPatch(it: ChartItem, id: string): ItemPatch {
  const marks = Object.entries(it.marks || {}).filter(([, k]) => k && (onSeries(k.a, id) || (typeof k.b === "object" && onSeries(k.b, id))));
  return { sers: { [id]: null }, ...(it.legendHide?.[id] ? { legendHide: { [id]: null } } : {}), ...(marks.length ? { marks: Object.fromEntries(marks.map(([k]) => [k, null])) } : {}) };
}
const onSeries = (a: MarkAt | undefined, id: string) => !!a && "s" in a && a.s === id;
/** a series one place up (-1) or down (+1): it swaps its `n` with its neighbour's – two entries, nothing else (equal n:
    the neighbour's ± ½, so the order is the asked one whatever the ids) */
export function moveSeriesPatch(it: ChartItem, id: string, dir: -1 | 1): ItemPatch | null {
  const list = allSeries(it), k = list.findIndex(([x]) => x === id), j = k + dir;
  if (k < 0 || j < 0 || j >= list.length) return null;
  const [a, A] = list[k], [b, B] = list[j], na = +A.n || 0, nb = +B.n || 0;
  const [toA, toB] = na !== nb ? [nb, na] : [nb + dir * .5, na];
  return { sers: { [a]: { ...A, n: toA }, [b]: { ...B, n: toB } } };
}
/** one series' settings (null removes a key) – the whole entry, as item.patch replaces it */
export function seriesPatch(it: ChartItem, id: string, p: Partial<Record<keyof ChartSeries, unknown>>): ItemPatch | null {
  const cur = it.sers?.[id]; if (!cur) return null;
  return { sers: { [id]: withKeys(cur, p) } };
}
/** one point's settings of a series (null removes a key – but `label: null` hides its label, `label: undefined`
    removes it; a point left with none goes) */
export function pointPatch(it: ChartItem, id: string, i: number, p: Partial<Record<keyof PointSet, unknown>>): ItemPatch | null {
  const cur = it.sers?.[id] as ChartSeries | undefined; if (!cur) return null;
  const { label, ...rest } = p, pts = { ...(cur.points || {}) }, next: Record<string, unknown> = withKeys(pts[String(i)] || {}, rest);
  if ("label" in p) { if (label === undefined) delete next.label; else next.label = label; }
  if (Object.keys(next).length) pts[String(i)] = next; else delete pts[String(i)];
  return seriesPatch(it, id, { points: Object.keys(pts).length ? pts : null });
}
/** a series' labels: what they show and where (none shown and no position: the key goes) */
export function labelsPatch(it: ChartItem, id: string, p: { show?: string[]; pos?: string | null; num?: string | null }): ItemPatch | null {
  const cur = it.sers?.[id]; if (!cur) return null;
  const L = withKeys({ show: [], ...(cur.labels || {}) } as Record<string, unknown>, p) as NonNullable<ChartSeries["labels"]>;
  return seriesPatch(it, id, { labels: (L.show || []).length || L.pos || L.num || L.fmt ? L : null });
}

/* ---- axes, legend ---- */
export function axisPatch(it: ChartItem, ax: "x" | "y" | "y2", p: Partial<Record<keyof ChartAxis, unknown>>): ItemPatch {
  const next = withKeys(it.axes?.[ax] || {}, p);
  return { axes: { [ax]: Object.keys(next).length ? next : null } };
}
/** (B53) an axis's min, max or step from a cell (null: typed / automatic again) – the whole axis entry, one undo step */
export function axisCellPatch(it: ChartItem, ax: "x" | "y" | "y2", key: "min" | "max" | "step", ref: DataRef | null): ItemPatch {
  const cur = it.axes?.[ax] || {}, cells: Record<string, unknown> = { ...(cur.cells || {}) };
  if (ref) cells[key] = ref; else delete cells[key];
  return axisPatch(it, ax, { cells: Object.keys(cells).length ? cells : null });
}
/* ---- (B53) labels dragged on the stage: ChartItem.nudge, fractions of the chart's box ---- */
/** a label dropped `dx`, `dy` slide px from where it was (its earlier offset kept: the new one adds to it), as a
    fraction of the chart's box; back at its place (|offset| under half a px) the entry goes */
export function nudgePatch(it: ChartItem, key: string, dx: number, dy: number, box: { w: number; h: number }): ItemPatch {
  const cur = it.nudge?.[key], r = (v: number) => Math.round(v * 1e5) / 1e5;
  const fx = r((cur?.dx || 0) + dx / Math.max(1, box.w)), fy = r((cur?.dy || 0) + dy / Math.max(1, box.h));
  return { nudge: { [key]: Math.abs(fx * box.w) < .5 && Math.abs(fy * box.h) < .5 ? null : { dx: fx, dy: fy } } };
}
/** every dragged label back at its place (one undo step) */
export const nudgeResetPatch = (): ItemPatch => ({ nudge: null });
export const legendAtPatch = (v: LegendAt): ItemPatch => ({ legendAt: v });
/** one legend entry hidden or shown again (a series id; a waterfall's "up" / "down" / "total") */
export const legendHidePatch = (key: string, hide: boolean): ItemPatch => ({ legendHide: { [key]: hide ? true : null } });

/* ---- category groups and dividers ---- */
/** a category group of these cells after the others. The first one: the chart's present categories (its names range,
    when it has one) become a group before it, so they stay where they are (that one "g1": two writers make it equal;
    the new group a random id, so both writers' groups stay) */
export function addGroupPatch(it: ChartItem, cats: DataRef): ItemPatch {
  const groups: Record<string, ChartGroup> = {};
  let n = nextN(it.groups);
  if (!allGroups(it).length && it.labels) { groups[freeId(it.groups, "g")] = { n: 1, cats: it.labels }; n = 2; }
  const id = newEntryId({ ...(it.groups || {}), ...groups }, "g");
  groups[id] = { n, cats, ...(n > 1 ? { divider: { dash: "dashed" as const } } : {}) };
  return { groups };
}
export function groupPatch(it: ChartItem, id: string, p: Partial<Record<keyof ChartGroup, unknown>>): ItemPatch | null {
  const cur = it.groups?.[id]; if (!cur) return null;
  return { groups: { [id]: withKeys(cur, p) } };
}
/** a group removed; its series go back to the first group (their `group` key cleared, each a whole series entry) */
export function removeGroupPatch(it: ChartItem, id: string): ItemPatch {
  const mine = allSeries(it).filter(([, s]) => s.group === id);
  return { groups: { [id]: null }, ...(mine.length ? { sers: Object.fromEntries(mine.map(([k, s]) => [k, withKeys(s, { group: null })])) } : {}) };
}

/* ---- marks ---- */
export type MarkKind = "arrow" | "icon" | "text" | "line" | "band";
/** a new mark at a point (the selected one): an arrow from the axis's floor up to it, an icon or a text above it, a line
    or a band from it to the next point of its series. null – nothing to stand on (S14.5 review 3): the series is gone
    (removed, undone, another writer), or `len` (the series' points, when known) has no such point, or – a line or a
    band – no next one */
export function addMarkPatch(it: ChartItem, kind: MarkKind, at: { s: string; i: number }, len?: number): ItemPatch | null {
  if (!markFits(it, kind, at, len)) return null;
  const a: MarkAt = { s: at.s, i: at.i }, next: MarkAt = { s: at.s, i: at.i + 1 };
  const m: ChartMark = kind === "arrow" ? { kind, a, b: "floor", style: { w: 1.5, heads: { a: "triangle" } } }
    : kind === "icon" ? { kind, a, icon: "tabler:target", size: 26, dy: -40 }
      : kind === "text" ? { kind, a, text: "Note", dy: -14, fmt: { b: true } }
        : kind === "line" ? { kind, a, b: next, style: { w: 1.5, dash: "dashed" } }
          : { kind, a, b: next };
  return { marks: { [newEntryId(it.marks, "m")]: m } };
}
/** whether a mark of this kind can stand at this point: its series is there, the point is one of its `len`, and a
    line or a band has a next point */
export function markFits(it: ChartItem, kind: MarkKind, at: { s: string; i: number } | null | undefined, len?: number): boolean {
  if (!at || !it.sers?.[at.s] || !Number.isInteger(at.i) || at.i < 0) return false;
  if (len === undefined) return true;
  return at.i < len && (kind !== "line" && kind !== "band" || at.i + 1 < len);
}
export function markPatch(it: ChartItem, id: string, p: Partial<Record<keyof ChartMark, unknown>>): ItemPatch | null {
  const cur = it.marks?.[id]; if (!cur) return null;
  return { marks: { [id]: withKeys(cur, p) } };
}
export const removeMarkPatch = (id: string): ItemPatch => ({ marks: { [id]: null } });
/** how the panel names where a mark stands */
export function markAtText(it: ChartItem, a: MarkAt | "floor" | "ceiling" | undefined): string {
  if (!a) return "–";
  if (a === "floor" || a === "ceiling") return a === "floor" ? "the axis's floor" : "the top";
  if ("s" in a) { const s = it.sers?.[a.s]; return `${s && typeof s.name === "string" && s.name ? s.name : a.s} · point ${a.i + 1}`; }
  if ("g" in a) return `group ${a.g} · ${a.edge}`;
  return `x ${a.x} · y ${a.y}`;
}

/* ---- 4.10 (B52): reference lines, gap arrows, change pills – each a whole marks entry (one undo step, ADR-015 amendment) ---- */
/** the chart's reference lines (marks of kind "ref"), in id order */
export const refMarks = (it: ChartItem): [string, ChartMark][] => Object.entries(it.marks && typeof it.marks === "object" ? it.marks : {})
  .filter(([, k]) => k && typeof k === "object" && k.kind === "ref").sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
/** the series a gap or change mark stands on by default: the first line series, else the first series */
function defaultSeries(it: ChartItem): string | null {
  const list = allSeries(it).filter(([, s]) => !s.hide);
  return (list.find(([, s]) => s.type === "line" || (!s.type && (it.type === "line" || it.type === "area"))) || list[0])?.[0] ?? null;
}
/** a new reference line at a cell's value (its first cell: the line follows the workbook); a typed number is the fallback */
export function addRefPatch(it: ChartItem, value: DataRef | number): ItemPatch {
  const v = typeof value === "number" ? value : { ...value, range: value.range.split(":")[0] };
  return { marks: { [newEntryId(it.marks, "r")]: { kind: "ref", value: v } } };
}
/** a new gap arrow from a series' last point (or the selected point) to the first reference line; null without a line or a series */
export function addGapPatch(it: ChartItem, at?: { s: string; i: number } | null): ItemPatch | null {
  const ref = refMarks(it)[0]?.[0], s = at && it.sers?.[at.s] ? at.s : defaultSeries(it);
  if (!ref || !s) return null;
  return { marks: { [newEntryId(it.marks, "g")]: { kind: "gap", a: { s, i: at && at.s === s ? at.i : -1 }, ref, caption: "gap to target" } } };
}
/** new change pills on a series (default: the first line series): every pair of consecutive points, absolute and % */
export function addChangePatch(it: ChartItem, sid?: string | null): ItemPatch | null {
  const s = sid && it.sers?.[sid] ? sid : defaultSeries(it);
  if (!s) return null;
  return { marks: { [newEntryId(it.marks, "p")]: { kind: "change", a: { s, i: -1 }, caption: "Change" } } };
}
/** a reference line removed – with the gap arrows that point to it (they would point at nothing), in one patch */
export function removeRefPatch(it: ChartItem, id: string): ItemPatch {
  const gaps = Object.entries(it.marks || {}).filter(([, k]) => k && typeof k === "object" && k.kind === "gap" && k.ref === id).map(([g]) => g);
  return { marks: Object.fromEntries([id, ...gaps].map(k => [k, null])) };
}
/** an extra switched on or off: kept either way (`off`) */
export const markOnPatch = (it: ChartItem, id: string, on: boolean) => markPatch(it, id, { off: on ? null : true });

/* ---- the cells chosen in the sheet view (PickCells.tsx, req.kind "chart-ref") ---- */
/** what the cells are for: a new series' values, a series' values / x values / targets / name, a new group's or a
    group's categories */
export type ChartRefWhat = { what: "add" } | { what: "vals" | "xs" | "target" | "name"; ser: string } | { what: "group-add" } | { what: "cats"; group: string }
  /* (B52) a new reference line at a cell; a line's value or name from a cell */
  | { what: "ref-add" } | { what: "ref-value" | "ref-name"; mark: string }
  /* (B53) an axis's min, max or step from a cell */
  | { what: "axis"; ax: "x" | "y" | "y2"; key: "min" | "max" | "step" }
  /* (B54) the chart card: a stat's or a momentum chip's cell, the tag's cell, the filter's column and value */
  | { what: "stat-cell"; stat: string } | { what: "mom-cell"; mom: string } | { what: "tag-cell" } | { what: "filter-by" } | { what: "filter-eq" };
/** the kinds of cells that are one cell (a name, a reference line's value or name) */
export const oneCell = (w: ChartRefWhat | null | undefined) => w?.what === "name" || w?.what === "ref-add" || w?.what === "ref-value" || w?.what === "ref-name" || w?.what === "axis"
  || w?.what === "stat-cell" || w?.what === "mom-cell" || w?.what === "tag-cell" || w?.what === "filter-eq";
/** the change the chosen cells make (null: the series or group is gone meanwhile) */
export function refPatch(it: ChartItem, w: ChartRefWhat, ref: DataRef): ItemPatch | null {
  switch (w.what) {
    case "add": return addSeriesPatch(it, ref);
    case "vals": return seriesPatch(it, w.ser, { vals: [ref] });
    case "xs": return seriesPatch(it, w.ser, { xs: [ref] });
    case "target": return seriesPatch(it, w.ser, { target: [ref] });
    case "name": return seriesPatch(it, w.ser, { name: { ...ref, range: ref.range.split(":")[0] } });
    case "group-add": return addGroupPatch(it, ref);
    case "cats": return groupPatch(it, w.group, { cats: ref });
    case "ref-add": return addRefPatch(it, ref);
    case "ref-value": return markPatch(it, w.mark, { value: { ...ref, range: ref.range.split(":")[0] } });
    case "ref-name": return markPatch(it, w.mark, { name: { ...ref, range: ref.range.split(":")[0] } });
    case "axis": return axisCellPatch(it, w.ax, w.key, { ...ref, range: ref.range.split(":")[0] });
    case "stat-cell": case "mom-cell": case "tag-cell": case "filter-by": case "filter-eq": return cardRefPatch(it, w, ref);
  }
}
export const REF_TITLE: Record<ChartRefWhat["what"], string> = { add: "Chart: add a series", vals: "Chart: the series' numbers", xs: "Chart: the series' x values",
  target: "Chart: the series' targets", name: "Chart: the series' name", "group-add": "Chart: add a category group", cats: "Chart: the group's categories",
  "ref-add": "Chart: add a reference line", "ref-value": "Chart: the reference line's value", "ref-name": "Chart: the reference line's name",
  axis: "Chart: the axis's bound from a cell", "stat-cell": "Chart: the stat's cell", "mom-cell": "Chart: the cell to compare with", "tag-cell": "Chart: the tag's cell",
  "filter-by": "Chart: the column to filter by", "filter-eq": "Chart: the filter's value from a cell" };
export const REF_HINT: Record<ChartRefWhat["what"], string> = { add: "Drag across the numbers of the new series – any sheet, a linked workbook's too.",
  vals: "Drag across the series' numbers.", xs: "Drag across the x values, one per number of the series.", target: "Drag across the targets, one per number of the series.",
  name: "Click the cell with the series' name: the legend follows it.", "group-add": "Drag across the names of the new group's categories.", cats: "Drag across the group's category names.",
  "ref-add": "Click the cell with the line's value (a budget, an ambition): the line follows the workbook.", "ref-value": "Click the cell with the line's value: the line follows the workbook.",
  "ref-name": "Click the cell with the line's name: its label follows the workbook.",
  axis: "Click the cell with the number: the axis follows the workbook, a reload and a scenario.",
  "stat-cell": "Click the cell with the number: the stat follows the workbook.", "mom-cell": "Click the cell with the number to compare the last value with.",
  "tag-cell": "Click the cell with the tag's text.", "filter-by": "Drag across the column to filter by (e.g. Product) – as many rows as the chart's numbers.",
  "filter-eq": "Click the cell holding the value to keep (e.g. a product name): a scenario or Run for each value can change it." };
