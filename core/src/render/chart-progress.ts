/* The budget-achievement chart (4.14, B55; ADR-015 amendment of 2026-10-23): a chart of type "progress" (ChartItem.progress)
   – per category one tall bar: a light track standing for 100 % of the category's target, a dark fill up to
   value / target, capped at the track (a bar over its target can take another fill, or a small band of it at its top);
   the achievement % above the bar, the category's name under it in capitals, and under that the gap in words ("+210 over",
   "1,700 to go": render/deltas.ts's one rule, so it reads as the B54 cards beside it – never "−0", the value cell's
   number format). Inside the same card as every chart, with the chart card's title, subtitle, corner tag and separator
   (chart-card.ts). The value axis and gridlines are off unless the item's axes.y asks for them.
   Data (progressData): values and targets per category from ranges or single cells (ONE target cell serves every
   category), or straight from a long table – per value of a group column, its LAST row with a number in the value
   column (the latest period) and the target in that row. Read through ctx.sheet() as every chart's cells (hidden rows,
   a version's removed cells and deleted rows skipped), so a reload, a scenario and "Run for each value" move it; a bad
   or missing cell, a zero or negative target is an Issues line, never a throw.
   PowerPoint (progressSem): a NATIVE clustered column chart – the track series (1 = 100 % per category) and the fill
   series (value / target capped at 1, a formula of the embedded workbook's value and target columns) overlapped 100 %,
   the gap width as drawn, the % as the track's data labels (static rich text, refreshed at every export); the names,
   the gaps and an over band are text boxes and shapes over it (the chart's overlay), as the B54 card's parts. Pure. */
import type { Box, ChartItem, ChartProgress, DataRef } from "../model/types";
import type { Node } from "../dl/types";
import type { Metrics } from "./excel-dl";
import type { RenderCtx } from "./context";
import type { BarsSem, BarSerSem, LineSem } from "../pptx/chart-sem";
import { cardParts, cardRoom, cardStyles, tagText } from "./chart-card";
import { catsOf, cellsOf, chartHide, genOf, labelsFor, numberAt, readRefs, refTarget, removedOf, shown, type Val } from "./chart-data";
import { tickText } from "./chart-axes";
import { ellipsis, font, lineH, lum, textNode, type St } from "./chart-font";
import { axisLook, fontSem, withFmt, type SeriesStyle } from "./chart-series";
import { isGeneral, targetLook } from "./chart-targets";
import { shownZero, signedText } from "./deltas";
import { fitText, kpiHeadColor } from "./kpi-dl";
import { mix } from "../model/style";
import { solid } from "../dl/color";

const HEX = /^#[0-9A-Fa-f]{6}$/;
const r2 = (v: number) => Math.round(v * 100) / 100 || 0;
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const isRef = (x: unknown): x is DataRef => isObj(x) && typeof x.range === "string";
/** the most bars a chart draws (more: named in the Issues panel) */
export const MAX_BARS = 8;
/** a bar's widest (slide px): one or two categories in a wide box stay bars, not blocks */
export const MAX_BAR_W = 180;
/** the default gap between bars, % of a bar (Excel's gap width) */
export const PROGRESS_GAP = 40;

/* ---- the data ---- */
/** one category as read: its name, value and target (null: no number), the value cell's number format */
export interface ProgressRow { cat: string; v: number | null; t: number | null; fmt: string;
  /** value / target (null: no value, no target, or a target of 0 or less – no achievement) */ ratio: number | null }
export type ProgressData = { ok: true; rows: ProgressRow[]; issues: string[]; /** the value cells' name (the Edit Data column) */ name: string; key: string }
  | { ok: false; why: "missing" | "empty"; source: string; key: string };
export const progressOf = (it: ChartItem): ChartProgress => isObj(it.progress) ? it.progress as ChartProgress : {};
const refList = (x: unknown): DataRef[] => Array.isArray(x) ? x.filter(isRef) : isRef(x) ? [x] : [];
/** every sheet the chart reads (its values, targets, names, the long table's columns, the subtitle's and tag's cells) */
function progressSheets(it: ChartItem, ctx: RenderCtx): string[] {
  const P = progressOf(it), out = new Set<string>(), add = (x: unknown) => { for (const r of refList(x)) out.add(refTarget(r, ctx).sheet); };
  add(P.vals); add(P.targets); add(P.cats); add(it.labels); add(it.subtitle);
  if (isObj(P.table)) { add(P.table.by); add(P.table.val); add(P.table.target); }
  if (isObj(it.tag)) add(it.tag.text);
  out.delete("");
  return [...out].sort();
}
const CACHE = new Map<string, ProgressData>();
/** the chart's categories, values and targets – cached by what it reads (the item's data keys, each sheet's generation:
    a reload, a scenario's overlay; the edits, the version) */
export function progressData(it: ChartItem, ctx: RenderCtx): ProgressData {
  const P = progressOf(it), sheets = progressSheets(it, ctx);
  const key = JSON.stringify(["progress", P.vals ?? null, P.targets ?? null, P.cats ?? null, P.table ?? null, it.labels ?? null,
    sheets.map(n => [n, genOf(ctx.sheet?.(n) ?? null), ctx.edits[ctx.sheet?.(n)?.name ?? n] || null]), ctx.version, ctx.preset?.tables || null]);
  const hit = CACHE.get(key); if (hit) return hit;
  const out = isObj(P.table) ? fromTable(it, P.table as NonNullable<ChartProgress["table"]>, ctx, key) : fromCells(it, P, ctx, key);
  if (CACHE.size > 200) CACHE.clear();
  CACHE.set(key, out);
  return out;
}
const ratioOf = (v: number | null, t: number | null) => v === null || t === null || !(t > 0) ? null : v / t;
/** a row's Issues lines: no value, no target, a target of 0 or less */
function rowIssues(r: ProgressRow, issues: string[]) {
  const n = r.cat || "?";
  if (r.v === null) issues.push(`'${n}': no value`);
  if (r.t === null) issues.push(`'${n}': no target`);
  else if (r.t === 0) issues.push(`'${n}': the target is 0 – no achievement`);
  else if (r.t < 0) issues.push(`'${n}': the target is negative – no achievement`);
}
/** values and targets from ranges or cells */
function fromCells(it: ChartItem, P: ChartProgress, ctx: RenderCtx, key: string): ProgressData {
  const issues: string[] = [], vals = refList(P.vals), tgts = refList(P.targets);
  if (!vals.length) return { ok: false, why: "missing", source: "no values chosen", key };
  const V = readRefs(vals, ctx, it), T = tgts.length ? readRefs(tgts, ctx, it) : null;
  if (V.missing && !V.vals.length) return { ok: false, why: "missing", source: V.source, key };
  if (V.missing) issues.push(`values ${V.source}: a range not found`);
  if (!T) issues.push("no targets chosen");
  else if (T.missing) issues.push(`targets ${T.source} not found`);
  const n = V.vals.length;
  // (one target cell: every category's target)
  const tv = (i: number): Val | undefined => !T ? undefined : T.vals.length === 1 ? T.vals[0] : T.vals[i];
  if (T && !T.missing && T.vals.length !== 1 && T.vals.length !== n) issues.push(`${T.vals.length} targets for ${n} values`);
  // the names: typed, a range, the item's labels, else the text beside the values
  let names: string[] | null = Array.isArray(P.cats) ? P.cats.map(c => typeof c === "string" ? c : String(c ?? "")) : null;
  if (!names && (isRef(P.cats) || isRef(it.labels))) {
    const ref = (isRef(P.cats) ? P.cats : it.labels) as DataRef;
    names = catsOf(ref, ctx, it);
    if (!names) issues.push(`names ${refTarget(ref, ctx).source} not found`);
  }
  if (!names && V.first) { const at = labelsFor(V.first.S, V.first.g, null, ctx, V.first.hide), cells = cellsOf(V.first.S, V.first.g, V.first.hide); names = cells.map(([r, c], k) => at(r, c, k)); }
  const rows = V.vals.map((x, i): ProgressRow => {
    const t = tv(i)?.v ?? null;
    return { cat: (names?.[i] ?? "").trim() || String(i + 1), v: x.v, t, fmt: x.fmt || "General", ratio: ratioOf(x.v, t) };
  });
  return finish(rows, issues, V.first ? nameAbove(V.first.S, V.first.g.r1, V.first.g.c1, ctx) : "", vals.map(r => refTarget(r, ctx).source).join(", "), key);
}
/** a long table: per group (column `by`, in the order its values first appear), its last row with a number in `val`;
    the target in that row of `target` */
function fromTable(it: ChartItem, tb: NonNullable<ChartProgress["table"]>, ctx: RenderCtx, key: string): ProgressData {
  const issues: string[] = [];
  const col = (ref: unknown, what: string) => {
    if (!isRef(ref)) { issues.push(`no ${what} column chosen`); return null; }
    const T = refTarget(ref, ctx);
    if (!T.S || !T.g) { issues.push(`${what} column ${T.source} not found`); return null; }
    const S = T.S, removed = removedOf(ctx, S);
    return { S, source: T.source, g: T.g, cells: cellsOf(S, T.g, chartHide(it, ctx, S, T.g, ref)), removed };
  };
  const B = col(tb.by, "group"), V = col(tb.val, "value"), T = col(tb.target, "target");
  if (!B || !V) { const ref = !B ? tb.by : tb.val; return { ok: false, why: "missing", source: isRef(ref) ? refTarget(ref, ctx).source : !B ? "the group column" : "the value column", key }; }
  if (V.cells.length !== B.cells.length) issues.push(`the value column ${V.source} has ${V.cells.length} cells for ${B.cells.length} in ${B.source}`);
  if (T && T.cells.length !== B.cells.length) issues.push(`the target column ${T.source} has ${T.cells.length} cells for ${B.cells.length} in ${B.source}`);
  const groups = new Map<string, { name: string; last: number }>();
  B.cells.forEach(([r, c], k) => {
    const name = B.removed(r, c) ? "" : shown(B.S, r, c, ctx).trim();
    if (!name) return;
    const g = groups.get(name.toLowerCase()) || { name, last: -1 };
    groups.set(name.toLowerCase(), g);
    const vc = V.cells[k];
    if (vc && numberAt(V.S, vc[0], vc[1], V.removed) !== null) g.last = k;
  });
  if (!groups.size) return { ok: false, why: "empty", source: B.source, key };
  const rows = [...groups.values()].map((g): ProgressRow => {
    if (g.last < 0) return { cat: g.name, v: null, t: null, fmt: "General", ratio: null };
    const [vr, vcc] = V.cells[g.last], x = V.S.get(vr, vcc), v = numberAt(V.S, vr, vcc, V.removed);
    const tc = T?.cells[g.last], t = T && tc ? numberAt(T.S, tc[0], tc[1], T.removed) : null;
    return { cat: g.name, v, t, fmt: x?.fmt || "General", ratio: ratioOf(v, t) };
  });
  // (a group whose value column holds no number at all: said once, its bar empty)
  for (const r of rows) if (r.v === null) issues.push(`'${r.cat}': no number in ${V.source}`);
  return finish(rows, issues, nameAbove(V.S, V.g.r1, V.g.c1, ctx), V.source, key, true);
}
/** the header above a column of values (the Edit Data column's name) */
function nameAbove(S: import("../xlsx/types").Sheet, r: number, c: number, ctx: RenderCtx): string {
  for (let k = 1; k <= 3 && r - k >= 1; k++) { const x = S.get(r - k, c); if (x && x.t === "s") { const t = shown(S, r - k, c, ctx).trim(); if (t) return t; } }
  return "";
}
function finish(rows: ProgressRow[], issues: string[], name: string, source: string, key: string, said = false): ProgressData {
  if (!rows.length) return { ok: false, why: "empty", source, key };
  for (const r of rows) if (!(said && r.v === null)) rowIssues(r, issues);
  if (rows.length > MAX_BARS) issues.push(`the chart draws ${MAX_BARS} bars: ${rows.length - MAX_BARS} more not drawn`);
  if (!rows.some(r => r.v !== null)) return { ok: false, why: "empty", source, key };
  return { ok: true, rows: rows.slice(0, MAX_BARS), issues, name, key };
}

/* ---- the words ---- */
/** the % above a bar: value / target in the chart's format (default 0.0 %); "n/a" without one */
export const pctText = (r: ProgressRow, num?: string) => r.ratio === null ? (r.v === null ? "–" : "n/a") : tickText(r.ratio, typeof num === "string" && num.trim() ? num : "0.0%");
/** the gap's number format: the chart's own, else the value cell's, else #,##0 (B54's General) */
export const gapFmt = (r: ProgressRow, num?: string) => typeof num === "string" && num.trim() ? num : !isGeneral(r.fmt) ? r.fmt : "#,##0";
/** the gap in words: value − target, in a format, with the words of the side it is on. Sign "over" (the owner's
    picture): "+210 over", "1,700 to go"; "both": "−1,700 to go" too; "none": no sign at all. A gap that shows as zero is
    over ("+0 over") – never "−0" (deltas.ts signedText) */
export function gapText(d: number, fmt: string, g?: ChartProgress["gap"]): string {
  const sign = g?.sign === "both" || g?.sign === "none" ? g.sign : "over";
  const zero = shownZero(d, fmt), up = zero || d > 0, dd = zero ? 0 : d;
  const n = sign === "none" ? tickText(Math.abs(dd), fmt).replace(/^[+\-−]/, "") : up || sign === "both" ? signedText(dd, fmt) : tickText(-dd, fmt);
  const w = (up ? typeof g?.over === "string" ? g.over : "over" : typeof g?.under === "string" ? g.under : "to go").trim();
  return w ? n + " " + w : n;
}

/* ---- the layout ---- */
export interface ProgressBar { i: number; x: number; w: number; track: Box; fill: Box | null; fillColor: string; over: boolean; mark: Box | null }
export interface ProgressLayout {
  title: string; titleSt: St; titleBox: Box | null; plot: Box; slot: number; barW: number; /** the gap width drawn (% of a bar) */ gap: number;
  rows: ProgressRow[]; bars: ProgressBar[]; name: string;
  colors: { fill: string; track: string; over: string };
  st: { pct: St; cat: St; cap: St; axis: St };
  /** the texts: above (the %), under (the names, the gaps) */ pct: Node[]; under: Node[]; pctTexts: string[];
  axis: { show: boolean; grid: LineSem | null; num: string; ticks: { v: number; text: string }[]; nodes: Node[] };
  /** the chart card's parts (subtitle, tag, separator) */ card: Node[];
  issue: string | null; frame: Box;
}
/** the % label's default: the design's accent – its first palette colour that reads as a colour, not as ink (a
    consulting design's palette opens with its navy, the bars' own colour): else the picture's blue */
export function accentOf(colors: string[]): string {
  const c = colors.find(x => HEX.test(x) && lum(x) > .25 && lum(x) < .8);
  return (c || "#2F55F4").toUpperCase();
}
/** the design's colours of the bars: its dark (the KPI card's header – the B54 slide's), a light grey of it, its positive colour */
export function progressColors(it: ChartItem, ctx: RenderCtx, ink: string) {
  const P = progressOf(it), dark = kpiHeadColor(ctx), T = targetLook(ctx, ink);
  const own = (c: unknown, d: string) => typeof c === "string" && HEX.test(c) ? c.toUpperCase() : d;
  return { fill: own(P.fill, dark), track: own(P.track, mix(dark, "#FFFFFF", .87).toUpperCase()), over: own(P.overFill, T.pos) };
}
/** where everything goes inside the frame (the box less the card's padding); the bars at Excel's slots, so the native
    chart's columns stand where the slide draws them */
export function progressLayout(it: ChartItem, frame: Box, ctx: RenderCtx, m: Metrics, sty: SeriesStyle): ProgressLayout | { why: "missing" | "empty"; source: string } {
  const data = progressData(it, ctx);
  if (!data.ok) return { why: data.why, source: data.source };
  const P = progressOf(it), issues = [...data.issues], { x: X0, y: Y0, w: W0, h: H0 } = frame;
  // (the card's parts this chart takes: subtitle, tag, separator – never a stats or momentum row, which read series)
  const cardIt: ChartItem = { ...it, stats: undefined, moms: undefined };
  let area: Box = { ...frame };
  // the title (the item's; "" or unset: none), the tag beside it
  let title = (typeof it.title === "string" ? it.title : "").trim();
  const titleSt = withFmt(sty.ttl, it.titleFmt), tagT = tagText(it, ctx).text;
  if (title && tagT) {
    const tw0 = Math.min(W0 * .45, m.run(tagT, font(cardStyles(sty.lab, "#000000", "#000000").tag)).w), room0 = Math.max(10, W0 - tw0 - 16);
    if (m.run(title, font(titleSt)).w > room0) title = ellipsis(m, title, titleSt, room0);
  }
  let titleBox: Box | null = null;
  if (title) {
    const lh = lineH(titleSt), w = Math.min(W0, m.run(title, font(titleSt)).w), al = it.titleFmt?.align;
    titleBox = { x: al === "left" ? X0 : al === "right" ? X0 + W0 - w : X0 + (W0 - w) / 2, y: Y0, w, h: lh };
    area = { ...area, y: area.y + lh + 8, h: Math.max(10, area.h - lh - 8) };
  }
  const room = cardRoom(cardIt, sty.lab, !!title, ctx), titleH = title ? lineH(titleSt) : 0;
  if (room.tagLine) area = { ...area, y: area.y + room.tagLine, h: Math.max(10, area.h - room.tagLine) };
  const skip = room.top > area.h - 60 ? { stats: true, sep: true } : {};
  const cardTop = area.y;
  if (!skip.stats) area = { ...area, y: area.y + room.top, h: Math.max(10, area.h - room.top) };
  else if (room.top) issues.push("the chart is too small for its subtitle and separator: not drawn");
  const card = cardParts(cardIt, { frame, titleH, top: cardTop, bottom: Y0 + H0, skip, series: [], cats: [], num: "General", lab: sty.lab, ink: sty.ink, sepColor: axisLook(ctx).card.line }, ctx, m);
  issues.push(...card.issues);
  // the texts' styles: the % large, bold, in the design's accent; the name bold in capitals; the gap small and grey
  const T = targetLook(ctx, sty.ink), s = sty.lab.size;
  const pctSt = withFmt({ ...sty.lab, size: Math.round(s * 1.9), weight: 700, italic: false, color: accentOf(sty.colors) }, P.pct?.fmt);
  const catSt = withFmt({ ...sty.lab, size: Math.max(6, Math.round(s * .9)), weight: 700, italic: false, color: sty.ink }, P.cat?.fmt);
  const capSt = withFmt({ ...sty.lab, size: Math.max(6, Math.round(s * .86)), weight: 400, italic: false, color: T.muted }, P.gap?.fmt);
  const axisSt: St = { ...sty.lab, size: Math.max(6, Math.round(s * .8)), weight: 400, italic: false, color: axisLook(ctx).tick };
  const pctOn = !P.pct?.off, catOn = !P.cat?.off, capOn = !P.gap?.off;
  // the rows of text above and under the bars
  const top = pctOn ? lineH(pctSt) + 6 : 4, below = (catOn ? 8 + lineH(catSt) : 0) + (capOn ? (catOn ? 2 : 8) + lineH(capSt) : 0);
  const ax = isObj(it.axes) && isObj(it.axes.y) ? it.axes.y : {}, axShow = ax.show === true, gridOn = ax.grid === true;
  const axNum = typeof ax.num === "string" && ax.num.trim() ? ax.num : "0%", ticks = [0, .25, .5, .75, 1].map(v => ({ v, text: tickText(v, axNum) }));
  const axW = axShow ? Math.max(...ticks.map(t => m.run(t.text, font(axisSt)).w)) + 8 : 0;
  const plot: Box = { x: area.x + axW, y: area.y + top, w: Math.max(10, area.w - axW), h: Math.max(10, area.h - top - below) };
  if (area.h - top - below < 30) issues.push("the chart is too small for its bars: make it taller");
  // the bars: Excel's slots (a slot per category, the bar 1 / (1 + gap) of it, centred), never wider than MAX_BAR_W
  const N = data.rows.length, slot = plot.w / N, g0 = Number.isFinite(+(it.gap as number)) ? Math.max(0, Math.min(500, +(it.gap as number))) : PROGRESS_GAP;
  let barW = slot / (1 + g0 / 100), gap = g0;
  if (barW > MAX_BAR_W) { barW = MAX_BAR_W; gap = Math.min(500, (slot / barW - 1) * 100); barW = slot / (1 + gap / 100); }
  const colors = progressColors(it, ctx, sty.ink), overMode = P.over === "color" || P.over === "mark" ? P.over : "none";
  const bars = data.rows.map((r, i): ProgressBar => {
    const x = plot.x + i * slot + (slot - barW) / 2, f = r.ratio === null ? 0 : Math.max(0, Math.min(1, r.ratio)), over = r.ratio !== null && r.ratio > 1;
    const fh = f * plot.h, fill = fh > 0 ? { x, y: plot.y + plot.h - fh, w: barW, h: fh } : null;
    return { i, x, w: barW, track: { x, y: plot.y, w: barW, h: plot.h }, fill, fillColor: over && overMode === "color" ? colors.over : colors.fill, over,
      mark: over && overMode === "mark" ? { x, y: plot.y, w: barW, h: Math.max(3, Math.round(Math.min(8, plot.h * .03))) } : null };
  });
  // the texts: the % centred above each track (shrunk to its slot), the name and the gap under it
  const pct: Node[] = [], under: Node[] = [], pctTexts: string[] = [], cut: string[] = [];
  data.rows.forEach((r, i) => {
    const cx = plot.x + (i + .5) * slot, wmax = Math.max(8, slot - 4), t = pctText(r, P.pct?.num);
    pctTexts.push(t);
    if (pctOn) { const f = fitText(m, t, pctSt, wmax, Math.min(pctSt.size, 9)); if (f.cut) cut.push("a %"); pct.push(textNode(m, f.text, cx, plot.y - 6 - lineH(f.st), f.st, "center")); }
    let y = plot.y + plot.h + 8;
    if (catOn) { const name = P.cat?.caps === false ? r.cat : r.cat.toUpperCase(); under.push(textNode(m, ellipsis(m, name, catSt, wmax), cx, y, catSt, "center")); y += lineH(catSt) + 2; }
    if (capOn && r.v !== null && r.t !== null) under.push(textNode(m, ellipsis(m, gapText(r.v - r.t, gapFmt(r, P.gap?.num), P.gap), capSt, wmax), cx, catOn ? y : plot.y + plot.h + 8, capSt, "center"));
  });
  if (cut.length) issues.push("the % does not fit its bar's room: cut (make the chart wider)");
  // the value axis (off unless asked): its labels at the left, gridlines across
  const grid: LineSem | null = gridOn ? axisLook(ctx).grid || { color: "#D9D9D9", w: 1 } : null, axNodes: Node[] = [];
  if (axShow) for (const t of ticks) axNodes.push(textNode(m, t.text, plot.x - 6, plot.y + plot.h - t.v * plot.h - lineH(axisSt) / 2, axisSt, "right"));
  return { title, titleSt, titleBox, plot, slot, barW, gap, rows: data.rows, bars, name: data.name, colors, st: { pct: pctSt, cat: catSt, cap: capSt, axis: axisSt },
    pct, under, pctTexts, axis: { show: axShow, grid, num: axNum, ticks, nodes: axNodes }, card: card.nodes, issue: issues.length ? [...new Set(issues)].join("; ") : null, frame };
}
const gridStroke = (l: LineSem) => ({ w: l.w, paint: solid(l.color), ...(l.dash === "sysDot" ? { dash: [2, 3] } : l.dash === "dash" ? { dash: [6, 4] } : {}) });
/** the over bands (a shape over the native chart in PowerPoint) */
const markNodes = (L: ProgressLayout): Node[] => L.bars.flatMap(b => b.mark ? [{ t: "rect", x: r2(b.mark.x), y: r2(b.mark.y), w: r2(b.mark.w), h: r2(b.mark.h), fill: solid(L.colors.over) } as Node] : []);
/** the chart on the slide: the title, the card's parts, gridlines, tracks, fills, over bands, the axis, the texts */
export function progressNodes(L: ProgressLayout, m: Metrics): Node[] {
  const out: Node[] = [];
  if (L.title && L.titleBox) out.push(textNode(m, L.title, L.titleBox.x, L.titleBox.y, L.titleSt));
  out.push(...L.card);
  if (L.axis.grid) for (const t of L.axis.ticks) { const y = r2(L.plot.y + L.plot.h - t.v * L.plot.h); out.push({ t: "line", x1: r2(L.plot.x), y1: y, x2: r2(L.plot.x + L.plot.w), y2: y, stroke: gridStroke(L.axis.grid) }); }
  for (const b of L.bars) {
    out.push({ t: "rect", x: r2(b.track.x), y: r2(b.track.y), w: r2(b.track.w), h: r2(b.track.h), fill: solid(L.colors.track) });
    if (b.fill) out.push({ t: "rect", x: r2(b.fill.x), y: r2(b.fill.y), w: r2(b.fill.w), h: r2(b.fill.h), fill: solid(b.fillColor) });
  }
  out.push(...markNodes(L), ...L.axis.nodes, ...L.pct, ...L.under);
  return out;
}
/** what stands over the native chart in PowerPoint: the card's parts, the over bands, the names and the gaps (text boxes) */
export const progressOverlay = (L: ProgressLayout): Node[] => [...L.card, ...markNodes(L), ...L.under];
/** the native chart (09 §4.2's column chart): the track and fill series overlapped, the bars' gap as drawn, the % as the
    track's data labels, the axes hidden unless shown on the slide; the embedded workbook holds the values and targets,
    the fill computed from them (Edit Data in PowerPoint moves the bar) */
export function progressSem(L: ProgressLayout): BarsSem {
  const cats = L.rows.map(r => r.cat);
  const fillVals = L.rows.map(r => r.ratio === null ? null : Math.max(0, Math.min(1, r.ratio)));
  const track: BarSerSem = { name: "Target (100%)", values: L.rows.map(() => 1), color: L.colors.track, fmt: "0%", points: [],
    labels: L.pct.length ? { show: ["value"], pos: "outEnd", num: null, font: fontSem(L.st.pct), points: L.pctTexts.map((text, i) => ({ i, text })) } : null };
  const fill: BarSerSem = { name: "Achievement", values: fillVals, color: L.colors.fill, fmt: "0.0%", labels: null,
    points: L.bars.flatMap(b => b.fillColor !== L.colors.fill ? [{ i: b.i, color: b.fillColor }] : []),
    // (=MIN(1, MAX(0, value / target)) of the workbook's Value and Target columns: E1, E2)
    f: L.rows.map(r => r.ratio === null ? null : "MIN(1,MAX(0,IF({E2}>0,{E1}/{E2},0)))") };
  const fmtOf = (r: ProgressRow) => r.fmt || "General";
  return {
    dir: "col", grouping: "clustered", gap: Math.round(L.gap), overlap: 100, cats, series: [track, fill],
    val: { min: 0, max: 1, step: .25, num: L.axis.num, grid: L.axis.grid, line: null, show: L.axis.show, font: fontSem(L.st.axis) },
    cat: { line: null, show: false, font: fontSem(L.st.cat), skip: 1 }, title: L.titleBox, plot: L.plot, legend: null,
    book: { values: 1, extra: [{ name: L.name || "Value", values: L.rows.map(r => r.v), f: L.rows.map(() => null), fmt: fmtOf(L.rows.find(r => r.v !== null) || L.rows[0]) },
      { name: "Target", values: L.rows.map(r => r.t), f: L.rows.map(() => null), fmt: fmtOf(L.rows.find(r => r.v !== null) || L.rows[0]) }] },
  };
}
/** the % texts the chart shows (tests, the panel) */
export const progressTexts = (it: ChartItem, ctx: RenderCtx) => {
  const d = progressData(it, ctx), P = progressOf(it);
  return d.ok ? d.rows.map(r => ({ cat: r.cat, pct: pctText(r, P.pct?.num), gap: r.v === null || r.t === null ? "" : gapText(r.v - r.t, gapFmt(r, P.gap?.num), P.gap) })) : [];
};
