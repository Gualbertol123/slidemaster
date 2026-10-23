/* Series charts (4.7, docs/next/09 §3.1–§3.3; S14.2 columns and bars – CT-01, CT-02, LG-01; S14.3 lines, areas, combo,
   second axis, category groups, targets, marks – CT-03…CT-06): a chart with `sers`, drawn with the display list's own
   nodes –
   * the value axes: y on the left and, when a shown series stands on it, y2 on the right (Excel's automatic bounds and
     unit, chart-axes.ts; or the axis's own min / max / step), tick labels in the axis's number format (else its first
     series' cells'), gridlines where the design or the axis asks for them;
   * the category axis: its labels (one per category, every n-th when they are too narrow), the axis line at zero;
     category groups side by side (09 §2.2), a group's label in a second row when one is named, a divider between groups;
   * per axis, in the order area → column → line (09 §3.1): areas (standard, stacked, 100 %; chart-area.ts), bars
     (clustered, stacked or 100 %, chart-bars.ts; Excel's gap width and overlap, per-point colours, the design's radius on
     the outer end and its gradient, negatives below the axis), "actual inside target" bars (the value filled, the
     target outlined over it, the same width – Q18), lines (straight or smoothed, gaps, markers; chart-lines.ts);
   * data labels: a bar's (value, name, category, percent, ofTarget; outside end, inside end, centre, inside base), white
     inside a dark bar, left out where they do not fit; a line point's (above, below, left, right, centre – one that
     would overlap its neighbour moves to the other side, else is left out); `points[i].label` replacing (or, null,
     hiding) one;
   * scatter charts (S14.4, chart-scatter.ts): every series' points at (x, y) on a numeric x axis, markers, an optional
     line through them; waterfalls (S14.4, chart-waterfall.ts): one series' columns floating on the running total in the
     up / down / total colours, totals standing on the axis, connectors between the steps;
   * the marks (chart-marks.ts: arrows, lines, bands, icons, texts in data coordinates), the legend (chart-legend.ts),
     the title (`titleFmt` over the deck's note style) and its rule, and `hit` nodes: one `point` per value
     ("<item>:<series>:<i>"), one `mark` per mark ("<item>:<mark>").
   seriesLayout is the one place that decides where each part goes: the display list (seriesNodes) and the PowerPoint
   chart (seriesSem: c:areaChart / c:barChart / c:lineChart groups on the primary and secondary axes, with the same
   bounds, gap, overlap, plot rectangle as manualLayout and legend box) are both made from it, so a native chart's bars,
   lines and points stand where the slide's do – and the marks drawn over it as plain shapes land on the data. */
import type { Box, ChartItem, LineOrNone, TextFmt } from "../model/types";
import type { Node, Paint, PathCmd } from "../dl/types";
import type { Metrics } from "./excel-dl";
import type { RenderCtx } from "./context";
import type { BarsSem, BarSerSem, FontSem, GroupSem, LabelPos, LineSem, MarkerSem, PointLabelSem } from "../pptx/chart-sem";
import { seriesData, type SerData, type SeriesData } from "./chart-data";
import { autoScale, axisFormat, ticks, tickText, type Scale } from "./chart-axes";
import { barSlots, gapOf, lightOf, outerRadius, overlapOf, stackBars, type StackMode } from "./chart-bars";
import { stackAreas } from "./chart-area";
import { dashOf, lineStroke, linePath, lineStyleOf, markerNode, markerOf, markerPx, polyHitsBox, runs, strokeNear, type Pt } from "./chart-lines";
import { markNodes, type Anchor, type MarkArrow, type MarkFrame } from "./chart-marks";
import { axisFromCells, gapDx, gapLabelW, marksOf, pillRowH, refLabel, refStyle, refValues, targetLook, type RefLine } from "./chart-targets";
import { scatterLine, scatterMarker, xAxisOf } from "./chart-scatter";
import { STEP_NAMES, connectorLine, connectors, waterfallColors, waterfallSem, waterfallSteps, type Step, type StepKind } from "./chart-waterfall";
import { legendAtOf, legendNodes, shownEntries, type LegendEntry, type LegendOut } from "./chart-legend";
import { ellipsis, font, lineH, lum, textNode, type St } from "./chart-font";
import { cardParts, cardRoom, cardStyles, tagText } from "./chart-card";
import { isConsult } from "../model/designs";
import { specOf } from "./consult-spec";
import { fontStack } from "../model/fonts";
import { parseColor, solid } from "../dl/color";

const r2 = (v: number) => Math.round(v * 100) / 100 || 0;
const frac4 = (v: number) => Math.round(v * 10000) / 10000 || 0;
const HEX = /^#[0-9A-Fa-f]{6}$/;
/** what the design gives a series chart besides chart-dl.ts's ChartLook */
interface AxisLook { tick: string; grid: LineSem | null; gridOn: boolean; line: LineSem | null; card: { fill: string; a: number; line: string } }
function axisLook(ctx: RenderCtx): AxisLook {
  const d = ctx.style.design;
  if (isConsult(d)) {
    const S = specOf(ctx);
    // hairline axes, no gridlines unless the axis asks for them
    return { tick: S.chart.label.color, grid: { color: S.rule.color, w: 1 }, gridOn: false, line: { color: S.rule.color, w: 1 }, card: { fill: "#FFFFFF", a: 1, line: S.rule.color } };
  }
  if (d === "glass") return { tick: "#3C4253", grid: { color: "#C5CCDA", w: 1, dash: "sysDot" }, gridOn: true, line: { color: "#AEB6C6", w: 1 }, card: { fill: "#FFFFFF", a: .7, line: "#E1E5EC" } };
  // Excel and Excel Refined: Office's chart – grey tick labels, light gridlines, the category axis line
  return { tick: "#595959", grid: { color: "#D9D9D9", w: 1 }, gridOn: true, line: { color: "#BFBFBF", w: 1 }, card: { fill: "#FFFFFF", a: .9, line: "#D9D9D9" } };
}
/** a text format over a style (sizes 6–72 px, colours #RRGGBB only: an item's maps are merged without checks) */
export function withFmt(st: St, f: TextFmt | undefined): St {
  if (!f || typeof f !== "object") return st;
  const n = +(f.size as number);
  return { ...st, ...(f.font ? { family: fontStack(f.font) } : {}), ...(Number.isFinite(n) && n > 0 ? { size: Math.max(6, Math.min(72, n)) } : {}),
    ...(f.b !== undefined ? { weight: f.b ? 700 : 400 } : {}), ...(f.i !== undefined ? { italic: !!f.i } : {}), ...(HEX.test(f.color || "") ? { color: f.color!.toUpperCase() } : {}) };
}
export const fontSem = (s: St): FontSem => ({ css: s.family, size: s.size, color: s.color, b: s.weight >= 600, i: s.italic });
/** a line that can be "none" (09 §2.2 LineOrNone): its look, or null; unset → `dflt` */
export function lineOrNone(v: LineOrNone | null | undefined, dflt: LineSem | null): LineSem | null {
  if (v === undefined) return dflt;
  if (v === null || v === "none" || typeof v !== "object") return null;
  return lineStyleOf(v, dflt?.color || "#7F7F7F", dflt?.w || 1);
}

type Pos = "outEnd" | "inEnd" | "ctr" | "inBase";
type Kind = "bar" | "line" | "area";
type Axis = "y" | "y2";
interface Bar { s: number; i: number; v: number; x: number; y: number; w: number; h: number; color: string; dir: "up" | "down" | "right" | "left"; outer: boolean;
  /** the bar's segment in axis values (a 100 % share is to − from) */ from: number; to: number;
  /** "actual inside target": the outlined target bar over it (same x and width) */ target: { y: number; h: number } | null }
interface Lab { s: number; i: number; text: string; x: number; top: number; st: St; align: "left" | "center" | "right"; inside: boolean }
/** (B53) a label's nudge (ChartItem.nudge, fractions of the chart's box) in px; unset or broken: none */
function nudger(it: ChartItem, unit: { w: number; h: number }): (key: string) => { x: number; y: number } {
  const N = it.nudge && typeof it.nudge === "object" ? it.nudge : {}, f = (v: unknown) => Number.isFinite(+(v as number)) ? Math.max(-1, Math.min(1, +(v as number))) : 0;
  return key => { const o = Object.prototype.hasOwnProperty.call(N, key) ? N[key] : null; return o && typeof o === "object" ? { x: r2(f(o.dx) * unit.w), y: r2(f(o.dy) * unit.h) } : { x: 0, y: 0 }; };
}
/** a line or area series as drawn: its paths (one per run of values; an area's closed), stroke, marker, points */
interface Trace { s: number; kind: "line" | "area"; axis: Axis; d: PathCmd[][]; stroke: LineSem | null; smooth: boolean; marker: MarkerSem | null; fill: string;
  /** per category of the chart: the point (null = a gap; an area's blank is drawn as zero and flagged `blank`: no label,
      anchor or hit) and, for an area, its band's lower edge */ pts: ({ x: number; y: number; lo: number; v: number; blank?: boolean } | null)[] }
/** a value axis as drawn */
interface ValAxis { scale: Scale; ticks: { v: number; text: string }[]; num: string; st: St; show: boolean; grid: LineSem | null; percent: boolean }
export interface SeriesLayout {
  data: Extract<SeriesData, { ok: true }>; dir: "col" | "bar"; mode: StackMode; gap: number; overlap: number;
  title: string; titleSt: St; /** the title's text box (the PowerPoint title's manual layout) */ titleBox: Box | null; plot: Box; scale: Scale; num: string; valSt: St; catSt: St; valShow: boolean; catShow: boolean; skip: number;
  look: AxisLook; grid: boolean; colors: string[]; bars: Bar[]; labs: Lab[]; legend: LegendOut; ticks: { v: number; text: string }[];
  /** each series' label settings (null = none), as drawn */ labels: (BarSerSem["labels"] | null)[];
  /** the series (indexes) out of the legend (legendHide) */ hidden: number[];
  issue: string | null;
  /* S14.3 */
  /** each series' kind and value axis */ kinds: Kind[]; axes: Axis[];
  /** the template's stacked areas drawn as stacked lines (series indexes; their line group is stacked as the chart) */ stackLines: number[];
  /** the secondary value axis (right), when a shown series stands on it */ y2: ValAxis | null;
  /** the bar groups: per axis, its series (indexes) and overlap (100 with targets) */ barGroups: { axis: Axis; series: number[]; overlap: number }[];
  /** lines and areas */ traces: Trace[];
  /** the category groups' labels (second row) and the dividers between groups */ groupLabels: { text: string; x: number; w: number }[] | null;
  dividers: { x1: number; y1: number; x2: number; y2: number; line: LineSem }[];
  /** the title's rule (09 §3.3) */ rule: { x1: number; x2: number; y: number; line: LineSem } | null;
  /** the bars' gradient (Liquid Glass), PowerPoint's a:gradFill too (S14.2 review 1) */ gradient: boolean;
  /** the marks' nodes (over the data), bands (under it) and hits; `native`: nodes the PowerPoint card leaves out (a
      reference line's line: the native chart draws it as a series, B52) */ marks: { nodes: Node[]; under: Node[]; hits: Node[]; arrows: MarkArrow[]; native: Node[] };
  /** (B52) the reference lines as drawn, and how far they reach: across the plot ("full": PowerPoint draws them on the
      secondary axes with the category axis "on tick marks"), or from the first to the last category's centre ("centres":
      the chart has a right axis of its own – PowerPoint's series can reach no further) */ refs: RefLine[]; refSpan: "full" | "centres";
  /* S14.4 */
  /** a scatter chart's numeric x axis (null: a category axis) */ xAxis: (ValAxis & { show: boolean }) | null;
  /** a waterfall: each category's column (null = a gap), the up / down / total colours, the kinds its legend lists */
  fall: { steps: (Step | null)[]; colors: Record<StepKind, string>; legend: StepKind[] } | null;
  /** a waterfall's connectors (drawn under the data, as under the native chart) */ connectors: { x1: number; x2: number; y: number; line: LineSem }[];
  /* 4.11 (B53) */
  /** the frame the chart is laid out in (PowerPoint's chart space: a dragged point label's manualLayout is a fraction of it) */ frame: Box;
  /** the title's drag offset, px */ titleNudge: { x: number; y: number };
  /** the hits of the labels the stage can drag ("label", id "<item>|<key>"; on screen only) */ labelHits: Node[];
  /* 4.13 (B54) */
  /** the chart card's parts (chart-card.ts: the tag, stats, separator, momentum row), drawn over the chart – text boxes
      and a line over the native chart in PowerPoint */ card: Node[];
}
export interface SeriesStyle { lab: St; ttl: St; family: string; colors: string[]; legend: "capsule" | "square" | "line"; ink: string; gradient: boolean; radius: number;
  /** the Excel designs' template (ChartLook.trend): the lines' default width, areas as lines */ trend?: { w: number; areaAsLine: boolean } }

/** the kind of chart group a series is drawn in: a horizontal bar chart's are all bars; a scatter series is not a combo
    member (09 §2.2: scatter is a chart of its own type, S14.4) – in a combo it draws as a line */
const kindOf = (s: SerData, dir: "col" | "bar"): Kind => dir === "bar" ? "bar" : s.type === "line" || s.type === "scatter" ? "line" : s.type === "area" ? "area" : "bar";
/** a line point's label place, as PowerPoint names it (t / b / l / r / ctr; Excel's default for a line is right) */
const linePos = (raw: unknown): "t" | "b" | "l" | "r" | "ctr" => raw === "above" || raw === "outEnd" ? "t" : raw === "below" || raw === "inBase" ? "b" : raw === "left" ? "l" : raw === "center" || raw === "inEnd" ? "ctr" : "r";
const FLIP = { t: "b", b: "t", l: "r", r: "l", ctr: null } as const;
/** (B53) a line point's "auto" label place: below a dip (both neighbours higher), else above */
const autoPos = (vals: (number | null)[], i: number): "t" | "b" => {
  const v = vals[i], nb = [vals[i - 1], vals[i + 1]].filter((x): x is number => typeof x === "number");
  return v !== null && v !== undefined && nb.length > 0 && nb.every(x => x > v) ? "b" : "t";
};

/** where every part of a series chart goes inside its frame (the box less the card's padding) */
export function seriesLayout(it: ChartItem, frame: Box, ctx: RenderCtx, m: Metrics, sty: SeriesStyle, id = "", unit: { w: number; h: number } = frame): SeriesLayout | { why: "missing" | "empty"; source: string } {
  const data0 = seriesData(it, ctx);
  if (!data0.ok) return { why: data0.why, source: data0.source };
  // (S14.4: a scatter chart's series are all scatter series, on one pair of axes; a waterfall draws its first series)
  const scatter = it.type === "scatter", fall = it.type === "waterfall";
  const data = fall && data0.series.length > 1 ? { ...data0, series: data0.series.slice(0, 1) } : data0;
  const dir = it.type === "bar" ? "bar" : "col", mode: StackMode = !scatter && !fall && (it.stack === "stacked" || it.stack === "percent") ? it.stack : "none";
  // (B53) an axis's bounds and major unit from cells, over the typed ones
  const look = axisLook(ctx), A0 = it.axes || {}, ser = data.series, axIssues: string[] = [];
  const A: typeof A0 = A0.y?.cells || A0.y2?.cells || A0.x?.cells ? { ...A0, y: axisFromCells(A0.y, ctx, "value", axIssues), y2: axisFromCells(A0.y2, ctx, "right", axIssues), x: axisFromCells(A0.x, ctx, "x", axIssues) } : A0;
  const nudge = nudger(it, unit), screen = !ctx.forExport, labelHits: Node[] = [];
  const hitOf = (key: string, b: Box) => { if (screen && id) labelHits.push({ t: "hit", kind: "label", id: `${id}|${key}`, x: r2(b.x), y: r2(b.y), w: r2(Math.max(1, b.w)), h: r2(Math.max(1, b.h)), label: key }); };
  const colors = ser.map((s, k) => s.color || (k < sty.colors.length ? sty.colors[k] : sty.colors[k % sty.colors.length]));
  const kinds: Kind[] = ser.map(s => scatter ? "line" : fall ? "bar" : kindOf(s, dir));
  // the axis each series stands on: y2 only beside a y series (Excel's secondary axis needs a primary one)
  const anyY = dir === "bar" || ser.some(s => s.axis !== "y2"), axes: Axis[] = ser.map(s => anyY && dir === "col" && !scatter && !fall && s.axis === "y2" ? "y2" : "y");
  // the Excel designs' template (B48 · ISP.chart): trend charts as a line only – an area series is drawn and exported as a
  // line series; stacked (100 %) areas as a stacked (100 %) line chart, each line on the top of the series below it, as
  // PowerPoint stacks one – unless an ordinary line series shares their axis (one chart group cannot be both
  // stacked and not): those areas stay areas
  const stackL = new Set<number>();
  if (sty.trend?.areaAsLine) {
    const conv = ser.map((_, k) => k).filter(k => kinds[k] === "area" && (mode === "none" || !ser.some((__, j) => kinds[j] === "line" && axes[j] === axes[k])));
    for (const k of conv) { kinds[k] = "line"; if (mode !== "none") stackL.add(k); }
  }
  const W = fall ? waterfallSteps(ser[0]) : null, Wc = W ? waterfallColors(ctx, sty.ink, sty.colors[0]) : null;
  const has2 = axes.includes("y2");
  const { x: X0, y: Y0, w: W0, h: H0 } = frame;
  let area: Box = { x: X0, y: Y0, w: W0, h: H0 };
  // the title: the item's ("" = none), else the series' name when there is one series (as Excel); its rule below it
  let title = (typeof it.title === "string" ? it.title : ser.length === 1 ? ser[0].name : "").trim();
  const titleSt = withFmt(sty.ttl, it.titleFmt);
  // (B54) a corner tag shares the title's line: the title keeps clear of it (cut with "…" – on the slide and in PowerPoint)
  const tagT = tagText(it, ctx).text;
  if (title && tagT) {
    const tw0 = Math.min(W0 * .45, m.run(tagT, font(cardStyles(sty.lab, "#000000", "#000000").tag)).w), room0 = Math.max(10, W0 - tw0 - 16);
    if (m.run(title, font(titleSt)).w > room0) title = ellipsis(m, title, titleSt, room0);
  }
  let titleBox: Box | null = null, rule: SeriesLayout["rule"] = null;
  const titleNudge = title ? nudge("title") : { x: 0, y: 0 };
  if (title) {
    const lh = lineH(titleSt), w = Math.min(W0, m.run(title, font(titleSt)).w), al = it.titleFmt?.align;
    titleBox = { x: (al === "left" ? X0 : al === "right" ? X0 + W0 - w : X0 + (W0 - w) / 2) + titleNudge.x, y: Y0 + titleNudge.y, w, h: lh };
    hitOf("title", titleBox);
    area = { ...area, y: area.y + lh + 8, h: Math.max(10, area.h - lh - 8) };
    const rl = lineOrNone(it.titleRule, null);
    if (rl) { rule = { x1: X0, x2: X0 + W0, y: r2(Y0 + lh + 4 + rl.w / 2), line: rl }; area = { ...area, y: area.y + 8 + rl.w, h: Math.max(10, area.h - 8 - rl.w) }; }
  }
  // (B54) the chart card: a tag's own line (no title), the stats row and its separator above the plot, the momentum row
  // below it – the plot shrinks to make room (a chart without them: no room, as before)
  const room = cardRoom(it, sty.lab, !!title, ctx), titleH = title ? lineH(titleSt) : 0;
  if (room.tagLine) area = { ...area, y: area.y + room.tagLine, h: Math.max(10, area.h - room.tagLine) };
  // (a box too small for its rows: the momentum row goes first, then the stats row and its separator – the plot keeps
  // 60 px at least, no row over another; named in the Issues panel)
  const cardSkip: { stats?: boolean; sep?: boolean; moms?: boolean } = {};
  if (room.top + room.bottom > area.h - 60 && room.bottom) { cardSkip.moms = true; room.bottom = 0; }
  if (room.top > area.h - 60 && room.top) { cardSkip.stats = true; cardSkip.sep = true; room.top = 0; }
  const cardTop = area.y, cardBottom = Y0 + H0 - room.bottom;
  if (room.top || room.bottom) area = { ...area, y: area.y + room.top, h: Math.max(10, area.h - room.top - room.bottom) };
  // the legend
  // (Excel lists a stacked chart's and a bar chart's series bottom-up in a legend beside the plot, as they are drawn)
  // (a waterfall's columns are stacked in PowerPoint: listed bottom-up beside the plot too)
  const at = legendAtOf(it), up = (dir === "bar" || fall || mode !== "none" && kinds.every(k => k !== "line")) && at !== "top" && at !== "bottom";
  const markers = ser.map((s, k) => kinds[k] === "line" ? scatter ? scatterMarker(s.src, colors[k], "#FFFFFF") : markerOf(s.src.marker, colors[k], "#FFFFFF") : null);
  const strokes = ser.map((s, k) => kinds[k] === "line" && (!scatter || scatterLine(s.src)) ? lineStyleOf(s.src.line, colors[k], sty.trend?.w) : null);
  // (a scatter series without a line: its marker alone; a waterfall: Increase, Decrease, Total – legendHide "up" / "down"
  // / "total")
  const entries = shownEntries(it, W && Wc ? (["up", "down", "total"] as const).filter(kd => W.steps.some(st => st?.kind === kd)).map((kd): LegendEntry => ({ key: kd, label: STEP_NAMES[kd], color: Wc[kd] }))
    : ser.map((s, k): LegendEntry => ({ key: s.id, label: s.name, color: colors[k], ...(strokes[k] ? { line: strokes[k]!, marker: markers[k] } : markers[k] ? { marker: markers[k] } : {}) })));
  const legend = legendNodes(up ? entries.slice().reverse() : entries, at, area, sty.legend, sty.lab, m, look.card);
  area = legend.area;
  // the axes' text
  const valSt = withFmt({ ...sty.lab, color: look.tick }, A.y?.fmt), catSt = withFmt({ ...sty.lab, color: look.tick }, A.x?.fmt);
  const val2St = withFmt({ ...sty.lab, color: look.tick }, A.y2?.fmt);
  const valShow = A.y?.show !== false, catShow = A.x?.show !== false, val2Show = has2 && A.y2?.show !== false;
  // per axis: its bars (stacked as the chart says), areas (the same), lines, targets – the values its scale must hold
  const per = (["y", "y2"] as Axis[]).map(ax => {
    const idx = ser.map((_, k) => k).filter(k => axes[k] === ax);
    const bi = idx.filter(k => kinds[k] === "bar"), ai = idx.filter(k => kinds[k] === "area" || stackL.has(k)), li = idx.filter(k => kinds[k] === "line" && !stackL.has(k));
    const sb = stackBars(bi.map(k => ser[k].vals), mode), sa = stackAreas(ai.map(k => ser[k].vals), mode);
    let lo = Infinity, hi = -Infinity;
    if (bi.length) { lo = sb.lo; hi = sb.hi; }
    if (ai.length) { lo = Math.min(lo, sa.lo); hi = Math.max(hi, sa.hi); }
    for (const k of li) ser[k].vals.forEach((v, i) => { if (v !== null && (!scatter || ser[k].xs?.[i] != null)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
    // (a waterfall: its running totals, from 0)
    if (W && ax === "y") { lo = W.lo; hi = W.hi; }
    // (targets on a clustered axis: their tops must show)
    const tgt = mode === "none" && !fall && bi.some(k => ser[k].target);
    if (tgt) for (const k of bi) for (const v of ser[k].target || []) if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    const percent = mode === "percent" && (bi.length > 0 || ai.length > 0);
    return { ax, idx, bi, ai, li, sb, sa, lo, hi, tgt, percent, num: axisFormat(ax === "y" ? A.y : A.y2, percent, ser[idx[0]]?.fmt || "General") };
  });
  const [P1, P2] = per, num = P1.num;
  // (B52) the reference lines (column, line, area and combo charts): their values from their cells, held by their axis's
  // scale; the room their labels take on the right
  const refOk = dir === "col" && !scatter && !fall, refIssues: string[] = [];
  // (a cell in General, a typed value: in the format its axis's tick labels show – B53)
  const refVals = refOk ? refValues(it, ctx, ax => (ax === "y2" && has2 ? P2 : P1).num) : [];
  if (!refOk && marksOf(it).some(([, k]) => k.kind === "ref" || k.kind === "gap" || k.kind === "change"))
    refIssues.push("reference lines, gap arrows and change pills are drawn on column, line, area and combo charts only");
  // (a 100 % axis shows shares: an absolute value has no place on it – the line, and a gap arrow to it, are not drawn)
  const refOff = new Set<string>();
  for (const r of refVals) {
    if (r.issue) refIssues.push(r.issue);
    if (r.v === null) { refOff.add(r.id); continue; }
    const P = r.axis === "y2" && has2 ? P2 : P1;
    if (P.percent) { refIssues.push(`reference line '${r.id}' is not drawn on a 100 % axis`); refOff.add(r.id); r.v = null; continue; }
    P.lo = Math.min(P.lo, r.v); P.hi = Math.max(P.hi, r.v);
  }
  const tlook = targetLook(ctx, sty.ink);
  const refLab = (r: (typeof refVals)[number]) => refLabel(r, refStyle(r, tlook).color, sty.lab, withFmt);
  const tw = (t: string, st: St) => m.run(t, font(st)).w;
  const N = Math.max(1, data.cats.length), vlh = lineH(valSt), clh = lineH(catSt);
  // a second row of category labels: the groups' own labels (multi-level categories), when one is named
  const named = data.groups.length > 1 && data.groups.some(g => g.label) && dir === "col";
  let plot: Box, scale: Scale, tk: { v: number; text: string }[], skip = 1, y2: ValAxis | null = null, xAxis: SeriesLayout["xAxis"] = null;
  const mkTicks = (s: Scale, f: string) => ticks(s).map(v => ({ v, text: tickText(v, f) }));
  /** what a line's labels above its points lack above the plot (px; the highest label's top less the point's distance from
      the plot's top) – on the left axis */
  const labelRoomAbove = (S: Scale, h: number) => {
    let need = 0;
    const span = S.max - S.min || 1;
    ser.forEach((s, k) => {
      if (kinds[k] !== "line" || scatter || axes[k] !== "y" || stackL.has(k)) return;
      const L = s.src.labels;
      if (!L || !Array.isArray(L.show) || !L.show.some(w => w === "value" || w === "name" || w === "category")) return;
      const st = withFmt(sty.lab, L.fmt), mk = markers[k], rr = mk ? markerPx(mk) / 2 + 2 : (strokes[k]?.w ?? 2) / 2 + 2;
      s.vals.forEach((v, i) => {
        if (v === null) return;
        const pp = s.src.points?.[String(i - s.start)];
        if (pp && pp.label === null) return;
        const q = pp && typeof pp === "object" && pp.pos ? linePos(pp.pos) : L.pos === "auto" ? autoPos(s.vals, i) : linePos(L.pos);
        if (q === "t") need = Math.max(need, lineH(st) + rr - h * Math.max(0, S.max - v) / span);
      });
    });
    return need;
  };
  if (dir === "col") {
    const lh2 = val2Show ? lineH(val2St) : 0;
    // (B53) change pills in a row under the category labels: their row's height below them
    const pillRow = refOk ? Math.max(0, ...marksOf(it).filter(([, k]) => k.kind === "change" && k.pos === "below").map(([, k]) => pillRowH({ lab: sty.lab, withFmt }, k) + 4)) : 0;
    let top = area.y + (valShow || val2Show ? Math.ceil(Math.max(valShow ? vlh : 0, lh2) / 2) : 4);
    const catH = (catShow ? clh + 6 + (named ? clh + 4 : 0) : 0) + pillRow;
    let h = Math.max(10, area.y + area.h - catH - top);
    scale = autoScale(P1.lo, P1.hi, { maxN: Math.floor(h / (vlh * 1.6)), axis: A.y, percent: P1.percent });
    // (B53) a line's value label above its highest point stays inside the frame (not over the title): the plot's top
    // comes down by what it lacks, measured on the label
    // (4.13.1: again while it lacks more than half a px – a point under a typed or cell max comes down with the plot, by
    // the share of the span it stands under the max: one pass left that share over the edge. The later passes keep the
    // first pass's count of ticks: the axis reads as before, only the plot's top moves)
    let maxN = 0;
    for (let pass = 0; pass < 4; pass++) {
      const need = labelRoomAbove(scale, h) - (top - area.y);
      if (!(need > .5)) break;
      top += need; h = Math.max(10, h - need);
      if (!pass) maxN = Math.floor(h / (vlh * 1.6));
      scale = autoScale(P1.lo, P1.hi, { maxN, axis: A.y, percent: P1.percent });
    }
    tk = mkTicks(scale, num);
    const yw = valShow ? Math.max(...tk.map(t => tw(t.text, valSt))) + 8 : 0;
    let y2w = 4;
    if (has2) {
      const s2 = autoScale(P2.lo, P2.hi, { maxN: Math.floor(h / (Math.max(lh2, vlh) * 1.6)), axis: A.y2, percent: P2.percent }), t2 = mkTicks(s2, P2.num);
      if (val2Show) y2w = Math.max(...t2.map(t => tw(t.text, val2St))) + 8;
      y2 = { scale: s2, ticks: t2, num: P2.num, st: val2St, show: val2Show, grid: A.y2?.grid === true ? look.grid : null, percent: P2.percent };
    }
    // (B52) the reference lines' labels after the plot's right end, and the gap arrows' labels past their last slot – only
    // the measured width of the labels that are there (B53: a gap's own difference, not a sample as wide as the line's value;
    // a label on the arrow's left, or an arrow left of its point, takes none)
    // (B53: no fixed margin – a label may reach the box's edge through the card's own padding when nothing stands beside
    // the plot, and the right axis's 4 px gap is not added to the labels' room)
    const padR = area.x + area.w >= frame.x + frame.w - .5 ? Math.max(0, (unit.w - frame.w) / 2) : 0;
    let room = 0;
    for (const r of refVals) { const L = r.v !== null ? refLab(r) : null; if (L && L.pos === "right") room = Math.max(room, tw(L.text, L.st) + 6 - padR); }
    const slot0 = Math.max(1, (area.w - yw - (has2 ? y2w + room : Math.max(y2w, room))) / N);
    for (const [, k] of marksOf(it)) if (refOk && k.kind === "gap") {
      const R = refVals.find(r => r.id === k.ref), sid = k.a && "s" in k.a ? String(k.a.s) : ser[0]?.id, sk = ser.findIndex(x => x.id === sid);
      if (!R || R.v === null || sk < 0) continue;
      const S = ser[sk], at = k.a && "s" in k.a ? +k.a.i : -1;
      let i = at >= 0 ? S.start + Math.floor(at) : -1;
      if (at < 0) for (let j = S.vals.length - 1; j >= 0; j--) if (S.vals[j] !== null) { i = j; break; }
      const v = i >= 0 ? S.vals[i] : null;
      if (v === null || v === undefined) continue;
      const side = k.pos === "left" ? -1 : 1, lside = k.labelSide === "left" ? -1 : k.labelSide === "right" ? 1 : side;
      const ext = side * gapDx(slot0) + (lside > 0 ? 6 + gapLabelW(k, R, sty.lab, withFmt, m, v - R.v) : 0);
      room = Math.max(room, (i + .5) * slot0 + ext - N * slot0 - y2w - padR);
    }
    const right = has2 ? y2w + room : Math.max(y2w, room);
    plot = { x: area.x + yw, y: top, w: Math.max(10, area.w - yw - right), h };
    if (scatter) {
      // the numeric x axis: its labels centred on their ticks, the first and the last half outside the plot
      const X = xAxisOf(ser, A.x, plot.w, (f, S) => Math.max(...ticks(S).map(v => tw(tickText(v, f), catSt))));
      const half = (k: number) => catShow ? tw(X.ticks[k].text, catSt) / 2 + 2 : 0, left = Math.max(yw, half(0)), right = Math.max(y2w, half(X.ticks.length - 1));
      plot = { x: area.x + left, y: top, w: Math.max(10, area.w - left - right), h };
      xAxis = { scale: X.scale, ticks: X.ticks, num: X.num, st: catSt, show: catShow, grid: A.x?.grid === true ? look.grid : null, percent: false };
    }
    const slot = plot.w / N;
    if (!scatter && catShow && slot < 36) skip = Math.ceil(36 / slot);
  } else {
    const catW = catShow ? Math.min(area.w * .35, Math.max(...data.cats.map(c => tw(c, catSt))) + 10) : 0, valH = valShow ? vlh + 6 : 0;
    const w0 = Math.max(10, area.w - catW - 8);
    const wide = Math.max(...mkTicks(autoScale(P1.lo, P1.hi, { axis: A.y, percent: mode === "percent" }), num).map(t => tw(t.text, valSt)));
    scale = autoScale(P1.lo, P1.hi, { maxN: Math.floor(w0 / (wide + 16)), axis: A.y, percent: mode === "percent" });
    tk = mkTicks(scale, num);
    const half = valShow ? tw(tk[tk.length - 1].text, valSt) / 2 : 4;
    plot = { x: area.x + catW, y: area.y + 4, w: Math.max(10, area.w - catW - half - 2), h: Math.max(10, area.h - valH - 4) };
    const slot = plot.h / N;
    if (catShow && slot < clh + 2) skip = Math.ceil((clh + 2) / slot);
  }
  // values → px along an axis (clamped to the plot: a bar beyond an axis's own bounds ends at its edge)
  const vpOf = (S: Scale) => { const span = S.max - S.min || 1; return (v: number) => { const t = Math.max(0, Math.min(1, (v - S.min) / span)); return dir === "col" ? plot.y + plot.h - t * plot.h : plot.x + t * plot.w; }; };
  const vps: Record<Axis, (v: number) => number> = { y: vpOf(scale), y2: y2 ? vpOf(y2.scale) : vpOf(scale) };
  const gap = gapOf(it.gap), overlap = overlapOf(it.overlap, mode), slot = (dir === "col" ? plot.w : plot.h) / N;
  const bars: Bar[] = [], barGroups: SeriesLayout["barGroups"] = [];
  const anchors: (Anchor | null)[][] = ser.map(() => data.cats.map(() => null));
  for (const P of per) {
    if (!P.bi.length) continue;
    if (W && Wc) {
      // a waterfall: one column per step, floating from the running total before it to the one after it (a total from 0),
      // in the up / down / total colour or the point's own; its outer end where it ends (a decrease's at the bottom)
      const vp = vps.y, s = ser[0], slots = barSlots(1, gap, 100), bw = slots.w * slot, off = slots.off(0) * slot;
      barGroups.push({ axis: "y", series: [0], overlap: 100 });
      for (const st of W.steps) {
        if (!st) continue;
        const own = s.src.points?.[String(st.i - s.start)]?.color, color = typeof own === "string" && HEX.test(own) ? own.toUpperCase() : Wc[st.kind];
        const a = vp(st.from), b = vp(st.to), x = plot.x + st.i * slot + off, y = Math.min(a, b), h = Math.abs(b - a), down = st.to < st.from;
        bars.push({ s: 0, i: st.i, v: st.v, x, y, w: bw, h, color, dir: down ? "down" : "up", outer: true, from: st.from, to: st.to, target: null });
        anchors[0][st.i] = { x: x + bw / 2, y: down ? y + h : y, top: down ? y + h : y, r: 0, color };
      }
      continue;
    }
    const vp = vps[P.ax], S = P.ax === "y" ? scale : y2!.scale;
    // "actual inside target" bars share one place with their targets: PowerPoint draws them as two series of one bar group
    // at overlap 100 (09 §4.2), so the whole group stands at that overlap. Clustered series that never share a category
    // (category groups: each group's own columns) take one place too – overlap 100, each bar centred on its category,
    // in PowerPoint as on the slide (S14.3 review 5) – only on a chart with category groups: an ordinary clustered chart
    // keeps each series' slot, as Excel does, even where another series is blank (S14.3 re-check)
    const lone = mode === "none" && data.groups.length > 1 && P.bi.length > 1 && data.cats.every((_, i) => P.bi.filter(k => ser[k].vals[i] !== null && ser[k].vals[i] !== undefined).length <= 1);
    const ov = P.tgt || lone ? 100 : overlap, n = mode === "none" ? P.bi.length : 1;
    barGroups.push({ axis: P.ax, series: P.bi, overlap: ov });
    const slots = barSlots(n, gap, ov), base = Math.max(S.min, Math.min(S.max, 0));
    for (const g of P.sb.segs) {
      const k = P.bi[g.s], s = ser[k], j = mode === "none" ? g.s : 0, own = s.src.points?.[String(g.i - s.start)]?.color;
      const color = typeof own === "string" && HEX.test(own) ? own.toUpperCase() : colors[k];
      const from = mode === "none" ? base : g.from, a = vp(from), b = vp(g.to);
      const bw = slots.w * slot, off = slots.off(j) * slot;
      const t = mode === "none" && s.target ? s.target[g.i] : null, tb = t !== null && t !== undefined ? vp(t) : null;
      if (dir === "col") {
        const x = plot.x + g.i * slot + off, y = Math.min(a, b), h = Math.abs(b - a);
        const bar: Bar = { s: k, i: g.i, v: g.v, x, y, w: bw, h, color, dir: g.to >= from ? "up" : "down", outer: g.outer, from: g.from, to: g.to, target: tb === null ? null : { y: Math.min(a, tb), h: Math.abs(tb - a) } };
        bars.push(bar);
        const end = bar.dir === "up" ? y : y + h;
        anchors[k][g.i] = { x: x + bw / 2, y: end, top: bar.target ? Math.min(end, bar.target.y) : end, r: 0, color };
      } else {
        // Excel's bar chart: the first category at the bottom, the first series at the bottom of its cluster
        const y = plot.y + plot.h - (g.i + 1) * slot + (slot - off - bw), x = Math.min(a, b), w = Math.abs(b - a);
        bars.push({ s: k, i: g.i, v: g.v, x, y, w, h: bw, color, dir: g.to >= from ? "right" : "left", outer: g.outer, from: g.from, to: g.to, target: null });
        anchors[k][g.i] = { x: g.to >= from ? x + w : x, y: y + bw / 2, top: y + bw / 2, r: 0, color };
      }
    }
  }
  // areas and lines (vertical charts): a point per category centre; a scatter point at its x
  const cx = (i: number) => plot.x + (i + .5) * slot, traces: Trace[] = [];
  const xp = (x: number) => { const S = xAxis!.scale, t = Math.max(0, Math.min(1, (x - S.min) / (S.max - S.min || 1))); return plot.x + t * plot.w; };
  const lineTrace = (k: number, ax: Axis, pts: ({ x: number; y: number; lo: number; v: number } | null)[]) => {
    const s = ser[k], smooth = !!s.src.smooth;
    const d = strokes[k] ? runs(pts).filter(r => r.length > 1).map(r => linePath(r as Pt[], smooth)) : [];
    const mk = markers[k], rr = mk ? markerPx(mk) / 2 + mk.w / 2 : (strokes[k]?.w ?? 2) / 2;
    traces.push({ s: k, kind: "line", axis: ax, d, stroke: strokes[k], smooth, marker: mk, fill: colors[k], pts });
    pts.forEach((p, i) => { if (p) { const pc = s.src.points?.[String(i - s.start)]?.marker; anchors[k][i] = { x: p.x, y: p.y, top: p.y, r: rr, color: typeof pc === "string" && HEX.test(pc) ? pc.toUpperCase() : mk?.color || colors[k] }; } });
  };
  for (const P of per) {
    const vp = vps[P.ax];
    P.ai.forEach((k, j) => {
      // (the template's stacked area as a line: at the top of its band, a blank a gap – as PowerPoint's stacked line chart,
      // whose series above still stand on the ones below)
      if (stackL.has(k)) { lineTrace(k, P.ax, P.sa.bands[j].map((b, i) => b.blank ? null : { x: cx(i), y: vp(b.hi), lo: 0, v: b.v })); return; }
      // (a blank is zero, as PowerPoint draws it: one band across every category)
      const pts = P.sa.bands[j].map((b, i) => ({ x: cx(i), y: vp(b.hi), lo: vp(b.lo), v: b.v, ...(b.blank ? { blank: true } : {}) }));
      const d = runs<Pt & { lo: number }>(pts).filter(r => r.length > 1).map(r => [...linePath(r, false), ...r.slice().reverse().map((p): PathCmd => ["L", r2(p.x), r2(p.lo)]), ["Z"] as PathCmd]);
      traces.push({ s: k, kind: "area", axis: P.ax, d, stroke: null, smooth: false, marker: null, fill: colors[k], pts });
      pts.forEach((p, i) => { if (!p.blank) anchors[k][i] = { x: p.x, y: p.y, top: p.y, r: 0, color: colors[k] }; });
    });
  }
  for (const P of per) {
    const vp = vps[P.ax];
    for (const k of P.li) {
      // (a scatter point at its x on the numeric axis; one without an x is not drawn)
      const s = ser[k], xs = scatter ? s.xs || [] : null;
      // (a scatter point whose x is outside the x axis's bounds – `axes.x` narrower than the data – is not drawn and breaks
      // the line, as Excel and PowerPoint leave it out; S14.4 review 2)
      const out = (x: number) => { const S = xAxis!.scale; return x < S.min - 1e-9 * Math.max(1, Math.abs(S.min)) || x > S.max + 1e-9 * Math.max(1, Math.abs(S.max)); };
      lineTrace(k, P.ax, s.vals.map((v, i) => v === null || xs && (xs[i] === null || xs[i] === undefined || out(xs[i]!)) ? null : { x: xs ? xp(xs[i]!) : cx(i), y: vp(v), lo: 0, v }));
    }
  }
  // the areas first, then the bars, then the lines (09 §3.1)
  traces.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "area" ? -1 : 1));
  // data labels
  const labs: Lab[] = [], labels: SeriesLayout["labels"] = [];
  // (4.13.1) the top of the room a line's "auto" label may reach: the area under the title, stats and legend
  const roomTop = area.y;
  ser.forEach((s, k) => {
    // (a waterfall shows its values unless its labels say otherwise, as Excel's)
    const L = s.src.labels ?? (fall ? { show: ["value" as const] } : undefined);
    const custom = Object.entries(s.src.points || {}).filter(([, p]) => p && typeof p === "object" && "label" in p);
    const st = withFmt(sty.lab, L?.fmt), own = !!(L?.fmt && HEX.test(L.fmt.color || "")), numFmt = typeof L?.num === "string" && L.num.trim() ? L.num : null;
    const tgt = mode === "none" && !!s.target && kinds[k] === "bar";
    // (a share – "percent" – exists on a 100 % chart only, as in Excel; ofTarget on a series with targets only)
    const show = L && Array.isArray(L.show) ? L.show.filter((w): w is "value" | "name" | "category" | "percent" | "ofTarget" => w === "value" || w === "name" || w === "category" || (w === "percent" && mode === "percent" && kinds[k] !== "line") || (w === "ofTarget" && tgt)) : [];
    if (!show.length && !custom.some(([, p]) => typeof p.label === "string")) { labels.push(null); return; }
    const valueText = (i: number, v: number) => numFmt ? tickText(v, numFmt) : s.texts[i] || tickText(v, s.fmt);
    const pts: PointLabelSem[] = [];
    if (kinds[k] !== "bar") {
      // a line's or an area's labels: at the point (an area's in the middle of its band)
      // (B53: "auto" – PowerPoint's series place above, each point's own where it differs)
      const tr = traces.find(t => t.s === k)!, area = tr.kind === "area", semPos = area ? "ctr" : L?.pos === "auto" ? "t" : linePos(L?.pos), rr = tr.marker ? markerPx(tr.marker) / 2 + 2 : (tr.stroke?.w || 2) / 2 + 2;
      const placed: Box[] = [];
      tr.pts.forEach((p, i) => {
        if (!p) return;
        // (an area's blank: PowerPoint draws it as zero and would label it "0" – hidden there, none on the slide)
        if (p.blank) { pts.push({ i, hide: true }); return; }
        const pp = s.src.points?.[String(i - s.start)];
        if (pp && pp.label === null) { pts.push({ i, hide: true }); return; }
        const ownPos = !!pp && typeof pp === "object" && !!pp.pos, auto = !area && !ownPos && L?.pos === "auto";
        let want = area ? "ctr" : ownPos ? linePos(pp!.pos) : auto ? autoPos(tr.pts.map(x => x ? x.v : null), i) : semPos;
        // (a scatter point's "category" is its x, as Excel's X value)
        const text = pp && typeof pp.label === "string" ? pp.label : show.map(w => w === "value" ? valueText(i, p.v) : w === "name" ? s.name : w === "category" ? (scatter ? s.xTexts?.[i] : data.cats[i]) || "" : "").filter(t => t).join(", ");
        if (!text) { pts.push({ i, hide: true }); return; }
        const w = tw(text, st), lh = lineH(st), run = m.run(text, font(st));
        // (the figures' ink in a label's line box: from the baseline – where textNode puts it – up .72 em)
        const figTop = Math.floor((lh - (run.asc + run.desc)) / 2) + run.asc - .72 * st.size;
        const rawAt = (q: "t" | "b" | "l" | "r" | "ctr"): Box & { x0: number; align: Lab["align"] } => {
          const y = area ? (p.y + p.lo) / 2 : p.y;
          return q === "t" ? { x: p.x - w / 2, y: y - rr - lh, w, h: lh, x0: p.x, align: "center" } : q === "b" ? { x: p.x - w / 2, y: y + rr, w, h: lh, x0: p.x, align: "center" }
            : q === "l" ? { x: p.x - rr - 2 - w, y: y - lh / 2, w, h: lh, x0: p.x - rr - 2, align: "right" } : q === "r" ? { x: p.x + rr + 2, y: y - lh / 2, w, h: lh, x0: p.x + rr + 2, align: "left" }
              : { x: p.x - w / 2, y: y - lh / 2, w, h: lh, x0: p.x, align: "center" };
        };
        // (4.13.1) a line's label stays inside the plot: never past its bottom, over the category labels (any place, the
        // user's own too); an "auto" one never past the room above it either (the frame's top: the title, the stats, the
        // card's header). "Auto" first takes the other side when its own would cross and the other fits (a dip on the
        // axis's floor: above; a peak under the frame's top: below) – else the side with more room – then is held inside.
        // Half a px over is inside (labelRoomAbove's own tolerance). A dragged label's offset (nudge) is added after, as set.
        const floor = plot.y + plot.h, ceil = auto ? roomTop : -Infinity;
        if (auto && (want === "t" || want === "b")) {
          const room = (q: "t" | "b") => { const r = rawAt(q); return Math.min(r.y - ceil, floor - (r.y + r.h)); };
          const f = FLIP[want];
          if (room(want) < -.5 && room(f) > room(want)) want = f;
        }
        const boxAt = (q: "t" | "b" | "l" | "r" | "ctr"): Box & { x0: number; align: Lab["align"] } => {
          const r = rawAt(q);
          if (area) return r;
          const y0 = r.y + r.h > floor + .5 ? floor - r.h : r.y, y = y0 < ceil - .5 ? Math.min(ceil, floor - r.h) : y0;
          return y === r.y ? r : { ...r, y };
        };
        // what a label must not cover: its neighbours' labels (09 §3.1); a line's also the bars (any axis's) and its own
        // stroke on both sides of the point, tested against the text's ink (a figure's height, .72 em, on the baseline;
        // 1 px in from each side) – a
        // centred label sits on its point by choice (S14.3 review 9)
        const over = (b: Box, q: Box) => b.x < q.x + q.w && q.x < b.x + b.w && b.y < q.y + q.h && q.y < b.y + b.h;
        const near = area || !tr.stroke ? [] : strokeNear(tr.pts, i, tr.smooth);
        const hits = (b: Box, q: "t" | "b" | "l" | "r" | "ctr") => {
          if (placed.some(o => over(b, o))) return true;
          if (area) return false;
          const inkOf = (c: Box) => ({ x: c.x + 1, y: c.y + figTop, w: Math.max(0, c.w - 2), h: .72 * st.size }), ink = inkOf(b);
          // (4.13.1: a label the user placed, held inside the plot, is tested against its own stroke where its place would
          // have put it – held, it may have to stand on its line; an "auto" one held there tries the other places first)
          const r = auto ? b : rawAt(q), own = r.y === b.y ? ink : inkOf(r);
          return bars.some(r => r.w > 0 && r.h > 0 && over(ink, r)) || (q !== "ctr" && near.some(l => polyHitsBox(l, own)));
        };
        let q: "t" | "b" | "l" | "r" | "ctr" | null = want, b = boxAt(want);
        // one that would overlap its neighbour moves to the other side, else is left out (09 §3.1)
        // (a line's label whose stroke or a bar covers both sides tries the other two: above / below → right, left; left /
        // right → above, below – S14.3 review 9)
        if (hits(b, want)) {
          const f = area ? null : FLIP[want], cross = want === "l" || want === "r" ? ["t", "b"] as const : want === "ctr" ? [] as const : ["r", "l"] as const;
          // (TODO-free note: the series' own place is kept where it fits; an "auto" one tries the other three alike)
          const alt = (f ? [f] : []).concat(area ? [] : cross);
          q = alt.find(x => !hits(boxAt(x), x)) ?? null; if (q) b = boxAt(q);
        }
        if (!q) { pts.push({ i, hide: true }); return; }
        placed.push(b);
        // (B53) a dragged label: where it was dropped, from where the layout puts it
        const key = `v:${s.id}:${i - s.start}`, o = nudge(key);
        labs.push({ s: k, i, text, x: b.x0 + o.x, top: b.y + o.y, st, align: b.align, inside: false });
        hitOf(key, { x: b.x + o.x, y: b.y + o.y, w: b.w, h: b.h });
        // (4.13.1) a label held inside the plot: PowerPoint's place moved by as much (the dLbl's manualLayout, with a nudge)
        const held = b.y - rawAt(q).y;
        const ownText = !!pp && typeof pp.label === "string", moved = o.x !== 0 || o.y + held !== 0;
        if (ownText || q !== semPos || moved) pts.push({ i, ...(ownText ? { text } : {}), ...(q !== semPos ? { pos: q } : {}), ...(moved ? { dx: frac4(o.x / frame.w), dy: frac4((o.y + held) / frame.h) } : {}) });
      });
      labels.push({ show: show.filter((w): w is "value" | "name" | "category" => w === "value" || w === "name" || w === "category"), pos: area ? null : semPos, num: numFmt, font: fontSem(st), points: pts });
      return;
    }
    const raw = L?.pos, wantB: Pos = raw === "inEnd" ? "inEnd" : raw === "center" ? "ctr" : raw === "inBase" || raw === "below" || raw === "left" ? "inBase" : raw === "outEnd" || raw === "above" || raw === "right" ? "outEnd" : mode === "none" ? "outEnd" : "ctr";
    // (a stacked bar has no outside end in Excel or PowerPoint: inside end there)
    const pos: Pos = mode !== "none" && wantB === "outEnd" ? "inEnd" : wantB;
    for (const b of bars.filter(b => b.s === k)) {
      const p = s.src.points?.[String(b.i - s.start)];
      // (B53) the point's own place: above / right its outside end (inside end on a stack), below / left its inside base
      const own0 = p && typeof p === "object" ? p.pos : undefined;
      const bp: Pos = own0 === "center" ? "ctr" : own0 === "below" || own0 === "left" ? "inBase" : own0 === "above" || own0 === "right" ? (mode !== "none" ? "inEnd" : "outEnd") : pos;
      let text: string;
      if (p && p.label === null) { pts.push({ i: b.i, hide: true }); continue; }
      if (p && typeof p.label === "string") text = p.label;
      else {
        const share = mode === "percent" ? b.to - b.from : null, t = s.target?.[b.i];
        // ofTarget: the value ÷ its target, in the label's own percentage format (else Italian "97 %"); no target, none
        const ofT = () => t ? tickText(b.v / t, numFmt && numFmt.includes("%") ? numFmt : "0 %") : "";
        text = show.map(w => w === "value" ? valueText(b.i, b.v) : w === "name" ? s.name : w === "category" ? data.cats[b.i] || "" : w === "ofTarget" ? ofT() : tickText(share ?? 0, "0%")).filter(t => t).join(", ");
      }
      if (!text) { pts.push({ i: b.i, hide: true }); continue; }
      let inside = bp !== "outEnd", white = inside && !own && lum(b.color) < .6, lst = white ? { ...st, color: "#FFFFFF" } : st;
      const w = tw(text, lst), lh = lineH(lst);
      // an inside label that does not fit its bar is left out (Excel would draw it over the edge)
      const len = dir === "col" ? b.h : b.w, across = dir === "col" ? b.w : b.h;
      if (inside && ((dir === "col" ? lh : w) + 4 > len || (dir === "col" ? w : lh) > across + 8)) { pts.push({ i: b.i, hide: true }); continue; }
      let x: number, top: number, align: Lab["align"] = "center";
      if (dir === "col") {
        x = b.x + b.w / 2;
        const up = b.dir === "up", end = up ? b.y : b.y + b.h, start = up ? b.y + b.h : b.y;
        top = bp === "outEnd" ? (up ? end - lh - 2 : end + 2) : bp === "inEnd" ? (up ? end + 3 : end - lh - 3) : bp === "inBase" ? (up ? start - lh - 3 : start + 3) : b.y + (b.h - lh) / 2;
        // a waterfall's label stays inside the plot (S14.4 review 1): a decrease ending on the axis's minimum, an increase
        // up to its maximum would put it under the category labels or over the title – and PowerPoint drops a label
        // whose carrier point is outside the axis's bounds. It goes beyond the column's other end, else inside its end
        // (white in a dark column), else as near as the plot allows
        const lo = plot.y, hi = plot.y + plot.h - lh, ok = (t: number) => t >= lo - .01 && t <= hi + .01;
        if (fall && !ok(top)) {
          const flip = up ? start + 2 : start - lh - 2, inEnd = up ? end + 3 : end - lh - 3;
          if (bp === "outEnd" && ok(flip)) top = flip;
          else if (bp === "outEnd" && b.h >= lh + 4 && w <= b.w + 8 && ok(inEnd)) {
            top = inEnd; inside = true; white = !own && lum(b.color) < .6;
            if (white) lst = { ...st, color: "#FFFFFF" };
          } else top = Math.max(lo, Math.min(hi, top));
        }
      } else {
        top = b.y + (b.h - lh) / 2;
        const right = b.dir === "right", end = right ? b.x + b.w : b.x, start = right ? b.x : b.x + b.w;
        if (bp === "ctr") x = b.x + b.w / 2;
        else if (bp === "outEnd") { x = right ? end + 4 : end - 4; align = right ? "left" : "right"; }
        else if (bp === "inEnd") { x = right ? end - 4 : end + 4; align = right ? "right" : "left"; }
        else { x = right ? start + 4 : start - 4; align = right ? "left" : "right"; }
      }
      const key = `v:${s.id}:${b.i - s.start}`, o = nudge(key), moved = o.x !== 0 || o.y !== 0;
      labs.push({ s: k, i: b.i, text, x: x + o.x, top: top + o.y, st: lst, align, inside });
      { const lw = tw(text, lst); hitOf(key, { x: (align === "center" ? x - lw / 2 : align === "right" ? x - lw : x) + o.x, y: top + o.y, w: lw, h: lineH(lst) }); }
      // PowerPoint: our own texts (a point's label; a share or an ofTarget, which a bar chart's labels cannot show) as
      // static text
      const ownText = (p && typeof p.label === "string") || show.includes("percent") || show.includes("ofTarget");
      if (ownText || white || bp !== pos || moved) pts.push({ i: b.i, ...(ownText ? { text } : {}), ...(white ? { color: "#FFFFFF" } : {}), ...(bp !== pos ? { pos: bp } : {}), ...(moved ? { dx: frac4(o.x / frame.w), dy: frac4(o.y / frame.h) } : {}) });
    }
    labels.push({ show: show.filter((w): w is "value" | "name" | "category" | "percent" => w !== "ofTarget"), pos, num: numFmt, font: fontSem(st), points: pts });
  });
  // the category groups: their labels (a second row) and the dividers between them (from the plot's top through the
  // category labels; default: the axis line's colour)
  const catH = catShow ? clh + 6 + (named ? clh + 4 : 0) : 0;
  const groupLabels = named ? data.groups.map(g => ({ text: g.label, x: plot.x + (g.start + g.len / 2) * slot, w: g.len * slot })) : null;
  const dividers: SeriesLayout["dividers"] = [];
  for (const g of data.groups.slice(1)) {
    // (unset, null or "none": no divider)
    const dl = g.divider && typeof g.divider === "object" ? lineStyleOf(g.divider, look.line?.color || "#BFBFBF", 1) : null;
    if (!dl) continue;
    if (dir === "col") { const x = r2(plot.x + g.start * slot); dividers.push({ x1: x, y1: r2(plot.y), x2: x, y2: r2(plot.y + plot.h + catH), line: dl }); }
    else { const y = r2(plot.y + plot.h - g.start * slot); dividers.push({ x1: r2(frame.x), y1: y, x2: r2(plot.x + plot.w), y2: y, line: dl }); }
  }
  // (B52) the reference lines: at their values, across the plot (or between the first and the last category's centres when
  // the chart has a right axis: PowerPoint's series reach no further – refSpan), their labels after the plot's end
  const refSpan: SeriesLayout["refSpan"] = has2 ? "centres" : "full";
  const refs: RefLine[] = [];
  for (const r of refVals) {
    if (r.v === null) continue;
    const line = refStyle(r, tlook), dash = dashOf(line), y = (r.axis === "y2" && y2 ? vps.y2 : vps.y)(r.v);
    const [x1, x2] = refSpan === "full" || N < 2 ? [plot.x, plot.x + plot.w] : [plot.x + slot / 2, plot.x + plot.w - slot / 2];
    const axis = r.axis === "y2" && y2 ? "y2" : "y";
    // (PowerPoint: a series of the native chart – but one chart group per type and axis: on an axis whose lines PowerPoint
    // stacks, the line is a plain line shape of the overlay instead, review of B52)
    const series = refSpan === "full" || !ser.some((_, k) => axes[k] === axis && stackL.has(k));
    if (!series) refIssues.push(`reference line '${r.id}' is a line shape in PowerPoint, not a series: the lines on its axis are stacked`);
    refs.push({ id: r.id, v: r.v, y: r2(y), x1: r2(x1), x2: r2(x2), line, stroke: { w: line.w, paint: solid(line.color), cap: "butt", ...(dash ? { dash } : {}) },
      name: r.name, text: r.text, fmt: r.fmt, axis, label: refLab(r), series });
  }
  if (refs.length && N < 2) refIssues.push("a reference line needs two categories to be drawn in PowerPoint");
  // (PowerPoint draws the right axis's chart groups over the left axis's: a left-axis reference line under right-axis columns)
  if (refSpan === "centres" && refs.some(r => r.axis === "y" && r.series) && ser.some((_, k) => axes[k] === "y2" && kinds[k] === "bar"))
    refIssues.push("a reference line on the left axis is drawn under the right axis's columns in PowerPoint");
  const refLabelX = r2(plot.x + plot.w + (y2?.show ? Math.max(...y2.ticks.map(t => tw(t.text, y2!.st))) + 8 : 0) + 6);
  // the marks, in data coordinates
  const F: MarkFrame = {
    plot, cats: data.cats, slot, horizontal: dir === "bar", groups: new Map(data.groups.map(g => [g.id, { start: g.start, len: g.len }])),
    // (a hidden series is not drawn: its marks are not either, and that is no mistake – no anchors, no Issues line)
    series: new Map([...Object.keys(it.sers || {}).map((k): [string, { anchors: (Anchor | null)[]; start: number }] => [k, { anchors: [], start: 0 }]), ...ser.map((s, k): [string, { anchors: (Anchor | null)[]; start: number }] => [s.id, { anchors: anchors[k], start: s.start }])]),
    vp: (v, ax) => ax === "y2" && !y2 ? null : vps[ax](v), ink: sty.ink, lab: sty.lab, withFmt, ...(xAxis ? { xp } : {}),
    ...(refOk ? { targets: { plot, slot, ink: sty.ink, lab: sty.lab, withFmt, look: tlook, refs: new Map(refs.map(r => [r.id, r])), refOff, refLabelX, nudge, ground: { fill: look.card.fill, a: look.card.a },
      ...(dir === "col" && catShow ? { below: r2(plot.y + plot.h + clh + 6 + (named ? clh + 4 : 0)) } : dir === "col" ? { below: r2(plot.y + plot.h + 4) } : {}),
      // (a stacked series' points stand on the stack's top, not on its own value: stacked)
      series: new Map(ser.map((s, k) => [s.id, { anchors: anchors[k], vals: s.vals, start: s.start, fmt: s.fmt, stacked: stackL.has(k) || (mode !== "none" && kinds[k] !== "line") }])) } } : {}),
  };
  const mk = markNodes(it, id, F, ctx, m);
  const extra = data0.series.slice(ser.length).map(s => `'${s.name}' is not drawn: a waterfall draws one series`);
  if (screen) labelHits.push(...mk.labels);
  // (B53 review) an axis's own max not above its min (typed, or a max below the automatic minimum): autoScale dropped it
  for (const [nm, ax, S] of [["value", A.y, scale], ["right", A.y2, y2?.scale]] as const)
    if (ax && S && typeof ax.max === "number" && Number.isFinite(ax.max) && ax.max !== S.max) axIssues.push(`the ${nm} axis's max (${ax.max}) is not above its min (${S.min}): automatic instead`);
  const card = cardParts(it, { frame, titleH, top: cardTop, bottom: cardBottom, skip: cardSkip, series: ser, cats: data.cats, num, lab: sty.lab, ink: sty.ink, sepColor: look.card.line }, ctx, m);
  const issues = [...data.issues, ...extra, ...axIssues, ...drawOrderIssues(ser.map(s => s.name), axes, bars, traces), ...refIssues, ...mk.issues, ...card.issues];
  const issue = issues.length ? issues.join("; ") : null;
  return { data, dir, mode, gap, overlap, title, titleSt, titleBox, plot, scale, num, valSt, catSt, valShow, catShow, skip, look,
    grid: typeof A.y?.grid === "boolean" ? A.y.grid : look.gridOn, colors, bars, labs, legend, ticks: tk, labels, issue,
    hidden: ser.flatMap((s, k) => entries.some(e => e.key === s.id) ? [] : [k]),
    kinds, axes, stackLines: [...stackL], y2, barGroups, traces, groupLabels, dividers, rule, gradient: sty.gradient, marks: { nodes: mk.nodes, under: mk.under, hits: mk.hits, arrows: mk.arrows, native: mk.native }, refs, refSpan,
    xAxis, connectors: W ? connectors(bars, W.steps, vps.y, connectorLine(ser[0].src, look.line?.color)) : [],
    fall: W && Wc ? { steps: W.steps, colors: Wc, legend: entries.filter(e => !legend.cut?.includes(e.key)).map(e => e.key as StepKind) } : null,
    frame, titleNudge, labelHits, card: card.nodes };
}

/** PowerPoint draws a chart's groups on the secondary axis over those on the primary one; the slide draws areas, then
    columns, then lines whatever their axis (09 §3.1). Where the two orders disagree and the parts overlap – a left
    axis's line or columns under a right axis's columns or area – the export differs from the slide: an Issues line names
    the series (S14.3 review 8; documented in 09 §4.2's note on combo charts) */
function drawOrderIssues(names: string[], axes: Axis[], bars: Bar[], traces: Trace[]): string[] {
  const out: string[] = [], said = new Set<string>();
  const say = (a: number, b: number, what: string) => {
    const k = `${a}:${b}`; if (said.has(k)) return; said.add(k);
    out.push(`'${names[a]}' (left axis) is drawn under '${names[b]}' (right axis) in PowerPoint, which draws the right axis's ${what} over the left axis's series`);
  };
  const drawn = (b: Bar) => b.w > 0 && b.h > 0, y2bars = bars.filter(b => drawn(b) && axes[b.s] === "y2"), y2areas = traces.filter(t => t.kind === "area" && t.axis === "y2");
  // (an area's band at category i covers y1–y2: its top above its base by more than half a pixel)
  const inBand = (a: Trace, i: number, y1: number, y2: number) => { const p = a.pts[i]; return !!p && !p.blank && p.lo - p.y > .5 && y1 < p.lo && y2 > p.y; };
  for (const t of traces) if (t.kind === "line" && t.axis === "y") {
    for (const b of y2bars) if (t.pts.some((_, i) => strokeNear(t.pts, i, t.smooth).some(l => polyHitsBox(l, b)))) say(t.s, b.s, "columns");
    for (const a of y2areas) if (t.pts.some((p, i) => p && inBand(a, i, p.y, p.y + .01))) say(t.s, a.s, "area");
  }
  for (const b of bars) if (drawn(b) && axes[b.s] === "y") for (const a of y2areas) if (inBand(a, b.i, b.y, b.y + b.h)) say(b.s, a.s, "area");
  return out;
}
const strokeOf = (s: LineSem) => ({ w: s.w, paint: solid(s.color), ...(s.dash === "sysDot" ? { dash: [2, 3] } : s.dash === "dash" ? { dash: [6, 4] } : s.dash === "dashDot" ? { dash: [6, 4, 2, 4] } : {}) });
/** what is drawn under a native chart as well as on the slide (before the gridlines): the title's rule (the PowerPoint
    title is the chart's own), the marks' bands */
export function cardNodes(L: SeriesLayout): Node[] {
  return [...(L.rule ? [{ t: "line", x1: r2(L.rule.x1), y1: L.rule.y, x2: r2(L.rule.x2), y2: L.rule.y, stroke: lineStroke(L.rule.line, "butt") } as Node] : []), ...L.marks.under,
    // (a waterfall's connectors: between the columns, under the labels – the native chart's own labels too)
    ...L.connectors.map((c): Node => ({ t: "line", x1: c.x1, y1: c.y, x2: c.x2, y2: c.y, stroke: lineStroke(c.line, "butt") }))];
}
/** what is drawn over a native chart as well as on the slide: the dividers and the marks (plain shapes in PowerPoint);
    `native` (the PowerPoint card, S14.6): without the arrow and line marks' lines and heads – the export writes each as
    one line shape with native ends from the chart's semantics (ChartSem.arrows, pptx/chart-overlay.ts) */
export function overlayNodes(L: SeriesLayout, native = false): Node[] {
  const drop = native ? new Set([...L.marks.arrows.flatMap(a => a.drop), ...L.marks.native]) : null;
  // (B54: the card's parts after the marks – an arrow's place among the overlay's nodes, arrowPlaces, stays)
  return [...L.dividers.map((d): Node => ({ t: "line", x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, stroke: lineStroke(d.line, "butt") })), ...(drop ? L.marks.nodes.filter(n => !drop.has(n)) : L.marks.nodes), ...(L.card || [])];
}
/** (S14.6 review 6) each arrow / line mark's place in overlayNodes(L, true): the count of that overlay's nodes before it
    (the dividers, then the other marks' nodes of a lower id – and none of its own), so that the export writes it where the
    slide draws it (marks in id order, a later id on top; pptx/chart-overlay.ts overlayEls) */
export function arrowPlaces(L: SeriesLayout): number[] {
  const drop = new Set([...L.marks.arrows.flatMap(a => a.drop), ...L.marks.native]), at = new Map<Node, number>();
  let kept = L.dividers.length;
  for (const n of L.marks.nodes) if (!drop.has(n)) kept++; else if (!at.has(n)) at.set(n, kept);
  return L.marks.arrows.map(a => at.get(a.drop[0]) ?? kept);
}

/** the nodes of a laid-out series chart: gridlines, areas, bars, the axis line, lines and markers, labels, the axes'
    texts, dividers and marks, the legend, the title, the point and mark hits */
export function seriesNodes(L: SeriesLayout, id: string, frame: Box, m: Metrics, sty: SeriesStyle): Node[] {
  const out: Node[] = [], { plot, dir, scale } = L, span = scale.max - scale.min || 1;
  if (L.title) {
    const tx = L.titleBox ? L.titleBox.x - (L.titleNudge?.x || 0) : 0;
    const al = L.titleBox && tx <= frame.x + .01 && L.titleBox.w < frame.w - .01 ? "left" : L.titleBox && tx + L.titleBox.w >= frame.x + frame.w - .01 && L.titleBox.w < frame.w - .01 ? "right" : "center";
    const n = L.titleNudge || { x: 0, y: 0 };
    out.push(textNode(m, ellipsis(m, L.title, L.titleSt, frame.w), (al === "left" ? frame.x : al === "right" ? frame.x + frame.w : frame.x + frame.w / 2) + n.x, frame.y + n.y, L.titleSt, al));
  }
  out.push(...cardNodes(L));
  const vpOf = (S: Scale) => { const sp = S.max - S.min || 1; return (v: number) => { const t = Math.max(0, Math.min(1, (v - S.min) / sp)); return dir === "col" ? plot.y + plot.h - t * plot.h : plot.x + t * plot.w; }; };
  const vp = (v: number) => { const t = Math.max(0, Math.min(1, (v - scale.min) / span)); return dir === "col" ? plot.y + plot.h - t * plot.h : plot.x + t * plot.w; };
  // gridlines (behind the bars): the primary axis's, the secondary's when it asks for them
  if (L.grid && L.look.grid) for (const t of L.ticks) {
    const p = r2(vp(t.v));
    out.push(dir === "col" ? { t: "line", x1: r2(plot.x), y1: p, x2: r2(plot.x + plot.w), y2: p, stroke: strokeOf(L.look.grid) } : { t: "line", x1: p, y1: r2(plot.y), x2: p, y2: r2(plot.y + plot.h), stroke: strokeOf(L.look.grid) });
  }
  if (L.y2?.grid) { const v2 = vpOf(L.y2.scale); for (const t of L.y2.ticks) { const p = r2(v2(t.v)); out.push({ t: "line", x1: r2(plot.x), y1: p, x2: r2(plot.x + plot.w), y2: p, stroke: strokeOf(L.y2.grid) }); } }
  // (a scatter chart's x axis: vertical gridlines when it asks for them)
  const xp = (x: number) => { const S = L.xAxis!.scale, t = Math.max(0, Math.min(1, (x - S.min) / (S.max - S.min || 1))); return plot.x + t * plot.w; };
  if (L.xAxis?.grid) for (const t of L.xAxis.ticks) { const p = r2(xp(t.v)); out.push({ t: "line", x1: p, y1: r2(plot.y), x2: p, y2: r2(plot.y + plot.h), stroke: strokeOf(L.xAxis.grid) }); }
  // areas (alpha .85)
  for (const tr of L.traces) if (tr.kind === "area") for (const d of tr.d) out.push({ t: "path", d, fill: { solid: parseColor(tr.fill).c, a: .85 } });
  // the bars, and over each its target's outline
  for (const b of L.bars) {
    if (b.w > 0 && b.h > 0) {
      const c = parseColor(b.color).c, light = parseColor(lightOf(b.color)).c;
      const lin: [number, number, number, number] = b.dir === "up" ? [0, 0, 0, 1] : b.dir === "down" ? [0, 1, 0, 0] : b.dir === "right" ? [1, 0, 0, 0] : [0, 0, 1, 0];
      const fill: Paint = sty.gradient ? { linear: lin, stops: [{ o: 0, c: light, a: 1 }, { o: 1, c, a: 1 }] } : { solid: c };
      const r = b.outer && sty.radius > 0 && !b.target ? outerRadius(sty.radius, b.dir, b.w, b.h) : 0;
      out.push({ t: "rect", x: r2(b.x), y: r2(b.y), w: r2(b.w), h: r2(b.h), ...(r ? { r } : {}), fill });
    }
    if (b.target && b.target.h > 0) out.push({ t: "rect", x: r2(b.x), y: r2(b.target.y), w: r2(b.w), h: r2(b.target.h), stroke: { w: 1.5, paint: solid(b.color) } });
  }
  // the category axis line, at zero (or the axis's end nearest it)
  const axisLine = L.look.line;
  if (axisLine) {
    const p = r2(vp(Math.max(scale.min, Math.min(scale.max, 0))));
    out.push(dir === "col" ? { t: "line", x1: r2(plot.x), y1: p, x2: r2(plot.x + plot.w), y2: p, stroke: strokeOf(axisLine) } : { t: "line", x1: p, y1: r2(plot.y), x2: p, y2: r2(plot.y + plot.h), stroke: strokeOf(axisLine) });
  }
  // the lines and their markers
  for (const tr of L.traces) if (tr.kind === "line") {
    if (tr.stroke) for (const d of tr.d) out.push({ t: "path", d, stroke: lineStroke(tr.stroke) });
    if (tr.marker) {
      const own = L.data.series[tr.s].src.points || {}, st = L.data.series[tr.s].start;
      tr.pts.forEach((p, i) => { if (!p) return; const pc = own[String(i - st)]?.marker, n = markerNode(tr.marker!, p.x, p.y, typeof pc === "string" && HEX.test(pc) ? pc.toUpperCase() : tr.marker!.color); if (n) out.push(n); });
    }
  }
  // data labels
  for (const l of L.labs) out.push(textNode(m, l.text, l.x, l.top, l.st, l.align));
  // the value axes' tick labels
  if (L.valShow) for (const t of L.ticks) {
    const p = vp(t.v), lh = lineH(L.valSt);
    out.push(dir === "col" ? textNode(m, t.text, plot.x - 6, p - lh / 2, L.valSt, "right") : textNode(m, t.text, p, plot.y + plot.h + 4, L.valSt, "center"));
  }
  if (L.y2?.show) { const v2 = vpOf(L.y2.scale), lh = lineH(L.y2.st); for (const t of L.y2.ticks) out.push(textNode(m, t.text, plot.x + plot.w + 6, v2(t.v) - lh / 2, L.y2.st, "left")); }
  // the category labels, and the groups' labels under them (a scatter chart: its x axis's tick labels)
  if (L.xAxis) { if (L.xAxis.show) for (const t of L.xAxis.ticks) out.push(textNode(m, t.text, xp(t.v), plot.y + plot.h + 4, L.xAxis.st, "center")); }
  else if (L.catShow) {
    const N = Math.max(1, L.data.cats.length), slot = (dir === "col" ? plot.w : plot.h) / N, lh = lineH(L.catSt);
    L.data.cats.forEach((c, i) => {
      if (i % L.skip) return;
      if (dir === "col") out.push(textNode(m, ellipsis(m, c, L.catSt, slot * L.skip - 4), plot.x + (i + .5) * slot, plot.y + plot.h + 4, L.catSt, "center"));
      else out.push(textNode(m, ellipsis(m, c, L.catSt, plot.x - frame.x - 8), plot.x - 6, plot.y + plot.h - (i + .5) * slot - lh / 2, L.catSt, "right"));
    });
    if (L.groupLabels) for (const g of L.groupLabels) if (g.text) out.push(textNode(m, ellipsis(m, g.text, L.catSt, g.w - 4), g.x, plot.y + plot.h + 4 + lh + 4, L.catSt, "center"));
  }
  out.push(...overlayNodes(L));
  out.push(...L.legend.nodes);
  // a hit per value (the panel's point: per-point colour and label, S14.5), one per mark
  for (const b of L.bars) {
    const s = L.data.series[b.s];
    out.push({ t: "hit", kind: "point", id: `${id}:${s.id}:${b.i - s.start}`, x: r2(b.x), y: r2(b.y), w: r2(Math.max(1, b.w)), h: r2(Math.max(1, b.h)), label: `${s.name} · ${L.data.cats[b.i] || b.i + 1}: ${s.texts[b.i] || tickText(b.v, s.fmt)}` });
  }
  for (const tr of L.traces) {
    const s = L.data.series[tr.s], hs = Math.max(12, tr.marker ? markerPx(tr.marker) + 4 : 0);
    tr.pts.forEach((p, i) => { if (p && !p.blank) out.push({ t: "hit", kind: "point", id: `${id}:${s.id}:${i - s.start}`, x: r2(p.x - hs / 2), y: r2(p.y - hs / 2), w: hs, h: hs, label: `${s.name} · ${(L.xAxis ? s.xTexts?.[i] : L.data.cats[i]) || i + 1}: ${s.texts[i] || tickText(p.v, s.fmt)}` }); });
  }
  out.push(...L.marks.hits);
  // (B53) the labels the stage drags (on screen only: none in an export's list)
  if (L.labelHits) out.push(...L.labelHits);
  return out;
}

/** what the PowerPoint writer makes of the same layout: chart groups (areas, bars, lines; primary, then secondary) with
    these bounds, series, labels and legend */
export function seriesSem(L: SeriesLayout): BarsSem {
  const ser: BarSerSem[] = L.data.series.map((s, k) => {
    const kind = L.kinds[k], tr = L.traces.find(t => t.s === k);
    const out: BarSerSem = {
      name: s.name, values: s.vals.slice(), color: L.colors[k], fmt: s.fmt,
      // (a point's index is the series' own – its group's –; PowerPoint's the chart's category)
      points: kind === "bar" ? Object.entries(s.src.points || {}).flatMap(([i, p]) => p && typeof p.color === "string" && HEX.test(p.color) && +i >= 0 && +i + s.start < s.vals.length ? [{ i: +i + s.start, color: p.color.toUpperCase() }] : []) : [],
      labels: L.labels[k] ?? null,
      type: kind === "bar" ? (L.dir === "bar" ? "bar" : "column") : L.xAxis ? "scatter" : kind, axis: L.axes[k],
    };
    // a scatter series: its x per value (S14.4)
    if (L.xAxis) { out.xs = (s.xs || []).slice(); out.xFmt = s.xFmt || "General"; }
    // each point's own number format where it is not the series' (PowerPoint's per-point formatCode, S14.2 review 5)
    if (s.fmts?.some((f, i) => f && f !== s.fmt && s.vals[i] !== null)) out.fmts = s.fmts.map((f, i) => s.vals[i] !== null && f !== s.fmt ? f : "");
    // Liquid Glass: each bar's gradient as drawn – the light stop at its outer end (a negative bar's at its other end)
    if (kind === "bar" && L.gradient) {
      const own = new Map(out.points.map(p => [p.i, p.color]));
      const rev = new Set(L.bars.filter(b => b.s === k && b.w > 0 && b.h > 0 && (b.dir === "down" || b.dir === "left")).map(b => b.i));
      out.light = lightOf(out.color);
      out.points = [...new Set([...own.keys(), ...rev])].sort((a, b) => a - b).map(i => {
        const c = own.get(i) ?? out.color;
        return { i, color: c, light: lightOf(c), ...(rev.has(i) ? { rev: true } : {}) };
      });
    }
    if (kind === "line") {
      out.smooth = !!tr?.smooth; out.stroke = tr?.stroke ?? null; out.marker = tr?.marker ?? null;
      out.markers = tr?.marker ? Object.entries(s.src.points || {}).flatMap(([i, p]) => p && typeof p.marker === "string" && HEX.test(p.marker) && +i >= 0 && +i + s.start < s.vals.length ? [{ i: +i + s.start, color: p.marker.toUpperCase() }] : []) : [];
    }
    if (kind === "area") out.alpha = .85;
    return out;
  });
  // "actual inside target": each target series after the series list, its own column of the embedded workbook
  const companion = new Map<number, number>();
  L.barGroups.forEach(g => g.series.forEach(k => {
    const s = L.data.series[k];
    if (L.mode !== "none" || !s.target) return;
    companion.set(k, ser.length);
    ser.push({ name: `${s.name} – target`, values: s.target.slice(), color: L.colors[k], fmt: s.fmt, points: ser[k].points.map(p => ({ i: p.i, color: p.color })), labels: null, type: "column", axis: L.axes[k], target: { w: 1.5 } });
  }));
  // (B52) the reference lines: each a line series of its value in every category (the first row of the embedded workbook
  // holds the number, the others "=" that cell: Edit Data moves the whole line), no marker, no labels (its label is a
  // text box of the overlay), never in the legend. Across the plot ("full"): on the secondary axes – a hidden category
  // axis "on tick marks" (midCat) and a hidden value axis with the primary one's bounds; else on its own axis's lines
  const refIdx: number[] = [];
  for (const r of L.refs) {
    if (!r.series) continue;                          // (a line shape of the overlay: chart-targets.ts refNodes)
    refIdx.push(ser.length);
    ser.push({ name: r.name || "Reference", values: L.data.cats.map(() => r.v), color: r.line.color, fmt: r.fmt, points: [], labels: null, type: "line", axis: L.refSpan === "full" ? "y2" : r.axis,
      smooth: false, stroke: r.line, marker: null, markers: [], f: L.data.cats.map((_, i) => i ? "{TOP}" : null) });
  }
  const grouping = L.mode === "none" ? "clustered" : L.mode === "stacked" ? "stacked" : "percentStacked";
  const groups: GroupSem[] = [];
  if (L.xAxis) groups.push({ kind: "scatter", axis: "y", grouping: "standard", gap: 0, overlap: 0, series: ser.map((_, k) => k) });
  else for (const ax of ["y", "y2"] as const) {
    const of = (kind: Kind) => L.data.series.map((_, k) => k).filter(k => L.axes[k] === ax && L.kinds[k] === kind);
    const ai = of("area"), li = of("line"), bg = L.barGroups.find(g => g.axis === ax);
    if (ai.length) groups.push({ kind: "area", axis: ax, grouping: L.mode === "none" ? "standard" : grouping, gap: 0, overlap: 0, series: ai });
    if (bg) groups.push({ kind: "bar", axis: ax, grouping, gap: L.gap, overlap: bg.overlap, series: bg.series.flatMap(k => companion.has(k) ? [k, companion.get(k)!] : [k]) });
    // (the template's stacked areas as lines: a stacked / 100 % stacked line chart – never beside ordinary lines on one axis)
    // (B52) reference lines of this axis (a chart with a right axis) join its standard line group – PowerPoint keeps one
    // chart group per type and axis (review of B52); its stacked lines never have one (seriesLayout: a line shape then)
    const ri = L.refSpan === "centres" ? refIdx.filter(k => ser[k].axis === ax) : [];
    if (li.length || ri.length) groups.push({ kind: "line", axis: ax, grouping: li.some(k => L.stackLines.includes(k)) ? grouping : "standard", gap: 0, overlap: 0, series: [...li, ...ri] });
  }
  const refAxis = L.refSpan === "full" && refIdx.length > 0 && !L.xAxis;
  if (refAxis) groups.push({ kind: "line", axis: "y2", grouping: "standard", gap: 0, overlap: 0, series: refIdx });
  const lp = L.legend.at === "right" ? "r" : L.legend.at === "left" ? "l" : L.legend.at === "top" ? "t" : L.legend.at === "top-right" ? "tr" : L.legend.at === "inside-tl" || L.legend.at === "inside-tr" ? "r" : "b";
  const y2 = L.y2, X = L.xAxis;
  const out: BarsSem = {
    dir: L.dir, grouping, gap: L.gap, overlap: L.barGroups[0]?.overlap ?? L.overlap,
    cats: L.data.cats.slice(), series: ser, title: L.titleBox,
    val: { min: L.scale.min, max: L.scale.max, step: L.scale.step, num: L.num, grid: L.grid ? L.look.grid : null, line: null, show: L.valShow, font: fontSem(L.valSt) },
    cat: { line: L.look.line, show: L.catShow, font: fontSem(L.catSt), skip: L.skip },
    plot: { x: r2(L.plot.x), y: r2(L.plot.y), w: r2(L.plot.w), h: r2(L.plot.h) },
    legend: L.legend.box ? { pos: lp, box: L.legend.ppt ?? L.legend.box, overlay: L.legend.at === "inside-tl" || L.legend.at === "inside-tr",
      // (the entries past the slide's room as well: "+N more" there, left out in PowerPoint – S14.2 review 3)
      hide: [...L.hidden, ...L.data.series.flatMap((s, k) => L.legend.cut?.includes(s.id) ? [k] : []), ...companion.values(), ...refIdx].sort((a, b) => a - b) } : null,
    groups, ...(refAxis ? { refAxis: true } : {}),
    val2: refAxis ? { min: L.scale.min, max: L.scale.max, step: L.scale.step, num: L.num, grid: null, line: null, show: false, font: fontSem(L.valSt) } : y2 ? { min: y2.scale.min, max: y2.scale.max, step: y2.scale.step, num: y2.num, grid: y2.grid, line: null, show: y2.show, font: fontSem(y2.st) } : null,
    levels: L.groupLabels ? L.data.cats.map((_, i) => { const g = L.data.groups.find(x => x.start === i && x.len > 0); return g ? g.label : ""; }) : null,
    ...(X ? { xval: { min: X.scale.min, max: X.scale.max, step: X.scale.step, num: X.num, grid: X.grid, line: L.look.line, show: X.show, font: fontSem(X.st) } } : {}),
  };
  // a waterfall: the stacked construction (chart-waterfall.ts)
  return L.fall ? waterfallSem(L, out) : out;
}
// (LabelPos is the PowerPoint writer's: re-exported for the tests)
export type { LabelPos };
