/* Targets on a series chart (4.10, B52; ADR-015 amendment of 2026-10-22): three kinds of mark, each an entry of the
   chart's `marks` map (on / off – `off` –, styled and removed one by one; chart-marks.ts calls these for them):
   * "ref"    – a reference line across the plot at a value read from a CELL of any sheet (a linked workbook's, a deck
                table's), shown in that cell's number format, so a reload or a scenario's value moves it; a typed number
                is the fallback. Its label (the name – text or a cell – and the value) at the right end (the plot leaves
                room for it), at the left end or above the line's right end;
   * "gap"    – an arrow from a series' point (`a.i` -1 = its last point) to a reference line, labelled with the live
                difference (point − line: sign, number format, optional % of the line) and a caption, coloured by sign;
   * "change" – pills between consecutive points of a series (`pairs` all or the last only): the absolute and / or %
                change, coloured by sign (a neutral grey for no change), in a row above the plot's floor or under the line,
                and a caption.
   The display list's own nodes only (ADR-004): lines, filled paths (the arrow's head, render/heads.ts), rounded rects,
   texts. In PowerPoint (09 §4.2 as amended): a reference line is a real line series of the native chart (its value in
   every row of the embedded workbook – the first row the number, the others `=` that cell, so Edit Data moves it), its
   label a text box; the gap arrow one line shape with a native head (chart-overlay.ts), its label text boxes; the pills
   rounded rectangles and text boxes – all placed from this one layout, so screen, PDF, PNG and PowerPoint agree. */
import type { ChartAxis, ChartItem, ChartMark, DataRef } from "../model/types";
import type { Node, Stroke, TextNode } from "../dl/types";
import type { RenderCtx } from "./context";
import type { Metrics } from "./excel-dl";
import type { LineSem } from "../pptx/chart-sem";
import { refTarget, removedOf, shown } from "./chart-data";
import { tickText } from "./chart-axes";
import { dashOf, lineStyleOf } from "./chart-lines";
import { font, lineH, textNode, type St } from "./chart-font";
import { headGeom, headed } from "./heads";
import { palette } from "../model/style";
import { isConsult } from "../model/designs";
import { ispChartColors, ISP_GREY, ISP_RGB, ispTint } from "../model/isp";
import { parseColor, solid } from "../dl/color";

const r2 = (v: number) => Math.round(v * 100) / 100 || 0;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const MINUS = "−";
export const TARGET_KINDS = ["ref", "gap", "change"] as const;
export const isTargetKind = (k: unknown): k is "ref" | "gap" | "change" => k === "ref" || k === "gap" || k === "change";

/** what each design gives the targets: the reference lines' colours (the first, the others), the sign colours, the pills'
    tint (how much white over the sign colour) and the captions' grey */
export interface TargetLook { refs: [string, string]; pos: string; neg: string; zero: string; tint: number; muted: string }
export function targetLook(ctx: RenderCtx, ink: string): TargetLook {
  const P = palette(ctx.style), d = ctx.style.design;
  // the Intesa Sanpaolo template (B48): its blue and its 50 % black for the lines, its green for a rise
  if (ispChartColors(ctx.style)) return { refs: [ISP_RGB.blu, ISP_GREY], pos: ISP_RGB.verde, neg: P.neg.toUpperCase(), zero: ISP_GREY, tint: .86, muted: ISP_GREY };
  if (d === "glass") return { refs: [ink.toUpperCase(), "#8E8E93"], pos: "#248A3D", neg: "#D70015", zero: "#8E8E93", tint: .84, muted: "#6E6E73" };
  if (isConsult(d)) return { refs: [ink.toUpperCase(), "#8A96A3"], pos: P.pos.toUpperCase(), neg: P.neg.toUpperCase(), zero: "#8A96A3", tint: .88, muted: "#6B7682" };
  return { refs: [ink.toUpperCase(), "#8C93A3"], pos: P.pos.toUpperCase(), neg: P.neg.toUpperCase(), zero: "#8C93A3", tint: .86, muted: "#6B7280" };
}
/** a colour mixed with white (a pill's fill) */
const tintOf = (hex: string, t: number) => ispTint(hex, t);

/** a reference line's value, its text in the cell's number format (or the mark's), its name, its axis */
export interface RefVal { id: string; k: ChartMark; v: number | null; text: string; fmt: string; name: string; axis: "y" | "y2"; n: number;
  /** why it is not drawn ("" = a gap: nothing to say) */ issue?: string }
const isRef = (x: unknown): x is DataRef => !!x && typeof x === "object" && typeof (x as DataRef).range === "string";
/** the first cell of a DataRef: its number (null: text, blank, an error), the cell's format, its text */
export function cellOf(ref: DataRef, ctx: RenderCtx): { v: number | null; fmt: string; text: string; source: string; gone: boolean } | null {
  const T = refTarget(ref, ctx);
  if (!T.S || !T.g) return null;
  // (a cell the shown version empties is no number: the line is not drawn, as a series gets a gap there)
  const gone = removedOf(ctx, T.S)(T.g.r1, T.g.c1);
  const c = T.S.get(T.g.r1, T.g.c1), v = !gone && c && c.t === "n" && typeof c.v === "number" && Number.isFinite(c.v) ? c.v : null;
  return { v, fmt: c?.fmt || "General", text: gone ? "" : shown(T.S, T.g.r1, T.g.c1, ctx).trim(), source: T.source, gone };
}
/** a cell's format that says nothing of how to show its number (Excel's General) */
const isGeneral = (f: string) => !f || /^general$/i.test(f.trim());
/** a value axis with its bounds and major unit read from cells (`cells`: each over the typed number; B53). A cell
    without a number leaves that setting to the typed one (else automatic) and says so */
export function axisFromCells(A: ChartAxis | undefined, ctx: RenderCtx, name: string, issues: string[]): ChartAxis | undefined {
  const C = A && A.cells && typeof A.cells === "object" ? A.cells : null;
  if (!A || !C) return A;
  const out: ChartAxis = { ...A };
  for (const key of ["min", "max", "step"] as const) {
    const ref = C[key];
    if (!isRef(ref)) continue;
    const c = cellOf(ref, ctx);
    if (c && c.v !== null && (key !== "step" || c.v > 0)) out[key] = c.v;
    else issues.push(`the ${name} axis's ${key === "step" ? "major unit" : key}: ${c ? (c.gone ? `${c.source} is emptied by the version shown` : `no ${key === "step" ? "positive number" : "number"} in ${c.source}`) : `${refTarget(ref, ctx).source} not found`}`);
  }
  // (B53 review) a min not below the max: the bounds read from cells go back to the typed ones (else automatic)
  if (typeof out.min === "number" && typeof out.max === "number" && out.min >= out.max && (isRef(C.min) || isRef(C.max))) {
    issues.push(`the ${name} axis's min (${out.min}) is not below its max (${out.max}): ${isRef(C.min) && isRef(C.max) ? "both are" : isRef(C.min) ? "the min is" : "the max is"} typed or automatic instead`);
    for (const key of ["min", "max"] as const) if (isRef(C[key])) { if (typeof A[key] === "number") out[key] = A[key]; else delete out[key]; }
  }
  return out;
}
/** the marks of the chart that are on, in id order (a later id on top) */
export const marksOf = (it: ChartItem) => Object.entries(it.marks && typeof it.marks === "object" ? it.marks : {})
  .filter(([, k]) => k && typeof k === "object" && !k.off).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
/** every reference line that is on: its value (a cell's number; a typed number), its name, the axis it stands on. Its text:
    the mark's number format, else the cell's – but a cell in General (and a typed value) takes `fallbackFmt`, the format
    its axis's tick labels show (B53: an Ambition cell of 12000 in General beside an axis of "12.000" reads "12.000"; a
    line without a name shows its value alone) */
export function refValues(it: ChartItem, ctx: RenderCtx, fallbackFmt: string | ((axis: "y" | "y2") => string)): RefVal[] {
  const fb = (ax: "y" | "y2") => (typeof fallbackFmt === "function" ? fallbackFmt(ax) : fallbackFmt) || "General";
  const out: RefVal[] = [];
  let n = 0;
  for (const [id, k] of marksOf(it)) {
    if (k.kind !== "ref") continue;
    const num = typeof k.num === "string" && k.num.trim() ? k.num : "";
    const axis = k.axis === "y2" ? "y2" : "y";
    const r: RefVal = { id, k, v: null, text: "", fmt: num || fb(axis), name: "", axis, n: n++ };
    if (isRef(k.value)) {
      const c = cellOf(k.value, ctx);
      if (!c) r.issue = `reference line '${id}': ${refTarget(k.value, ctx).source} not found`;
      else if (c.gone) r.issue = `reference line '${id}': ${c.source} is emptied by the version shown`;
      else if (c.v === null) r.issue = `reference line '${id}': no number in ${c.source}`;
      else { r.v = c.v; r.fmt = num || (isGeneral(c.fmt) ? fb(axis) : c.fmt); }
    } else if (typeof k.value === "number" && Number.isFinite(k.value)) r.v = k.value;
    else r.issue = `reference line '${id}': no value (a cell or a number)`;
    if (r.v !== null) r.text = tickText(r.v, r.fmt);
    if (typeof k.name === "string") r.name = k.name.trim();
    else if (isRef(k.name)) { const c = cellOf(k.name, ctx); r.name = c ? c.text : ""; if (!c) r.issue = `reference line '${id}': its name's cell ${refTarget(k.name, ctx).source} not found`; }
    out.push(r);
  }
  return out;
}

/** a reference line as drawn: its value's place, look, label */
export interface RefLine { id: string; v: number; y: number; x1: number; x2: number; line: LineSem; stroke: Stroke; name: string; text: string; fmt: string; axis: "y" | "y2";
  label: { text: string; st: St; pos: RefPos } | null;
  /** a series of the native PowerPoint chart (else a plain line shape of its overlay) */ series: boolean }
/** where a reference line's label stands: after the plot's right end (default, Excel's), on the line inside the plot's
    right end ("inside", on the card's ground), above the left end ("left"), above or below the right end */
export type RefPos = "right" | "left" | "above" | "below" | "inside";
const REF_POS: readonly string[] = ["right", "left", "above", "below", "inside"];
/** a reference line's label: what it shows, in its style (the line's colour, bold unless its fmt says) */
export function refLabel(r: RefVal, color: string, lab: St, withFmt: (st: St, f: ChartMark["fmt"]) => St): { text: string; st: St; pos: RefPos } | null {
  const show = r.k.show || "both";
  const text = show === "none" ? "" : show === "name" ? r.name : show === "value" ? r.text : [r.name, r.text].filter(Boolean).join(" ");
  if (!text) return null;
  const pos = (REF_POS.includes(r.k.pos as string) ? r.k.pos : "right") as RefPos;
  return { text, st: withFmt({ ...lab, weight: 700, color }, r.k.fmt), pos };
}
/** a reference line's look: its own, else the design's (the first line the design's ink, the others its grey), dashed */
export function refStyle(r: RefVal, look: TargetLook): LineSem {
  return lineStyleOf({ dash: "dashed", ...(r.k.style || {}) }, look.refs[r.n === 0 ? 0 : 1], 1.5);
}

/** a difference with its sign (+ / − / none for 0) in a number format: the format of the absolute value */
export function signed(d: number, fmt: string): string {
  const t = tickText(Math.abs(d), fmt);
  return d > 0 ? "+" + t : d < 0 ? MINUS + t : t;
}
/** a change as a %: one decimal, signed */
export const signedPct = (p: number) => signed(p, "0.0%");
/** the colour of a difference: by sign (the mark's own colours, else the design's), or the mark's own one ("fixed") */
export function signColor(k: ChartMark, d: number, look: TargetLook, own: string | null, ink: string): string {
  if (k.signs === "fixed") return own || ink;
  const S = k.signs && typeof k.signs === "object" ? k.signs : {};
  const pick = (c: string | undefined, dflt: string) => HEX.test(c || "") ? c!.toUpperCase() : dflt;
  return d > 0 ? pick(S.pos, look.pos) : d < 0 ? pick(S.neg, look.neg) : pick(S.zero, look.zero);
}

/** a series' points (x, y, the marker's radius) and values by category of the chart, its first category, its format */
export interface SerPts { anchors: ({ x: number; y: number; r: number } | null)[]; vals: (number | null)[]; start: number; fmt: string;
  /** its points stand on a stack's top (a stacked column, area or line), not on its own value */ stacked?: boolean }
/** what the targets need of the chart's layout (a part of chart-marks.ts MarkFrame) */
export interface TargetFrame {
  plot: { x: number; y: number; w: number; h: number }; slot: number; ink: string; lab: St; withFmt: (st: St, f: ChartMark["fmt"]) => St;
  /** the reference lines as drawn (seriesLayout), by id; those not drawn (no value, a 100 % axis: said once there) */ refs: Map<string, RefLine>; refOff?: Set<string>;
  /** the series drawn, by id */ series: Map<string, SerPts>;
  look: TargetLook;
  /** (B53) a dragged label's offset in px (0, 0 when none) – keys as ChartItem.nudge's; the card's ground behind an
      "inside" label (the card's fill and opacity); the top of the row under the category labels (pills "below") */ nudge?: (key: string) => { x: number; y: number }; ground?: { fill: string; a: number }; below?: number;
}
export interface TargetOut { nodes: Node[]; issues: string[];
  /** (B53) the labels the stage can drag: their nudge key and box */ labels?: { key: string; box: { x: number; y: number; w: number; h: number } }[];
  /** the gap arrow as the export writes it (one line shape with native ends): from the line (a) to the point (b) */
  arrow?: { a: { x: number; y: number }; b: { x: number; y: number }; stroke: Stroke; head?: string; tail?: string; size?: "s" | "m" | "l"; drop: Node[] };
  /** nodes the PowerPoint export leaves out: a reference line's line (the native chart's own series draws it) */ native: Node[] }

/** a reference line's nodes: the line across the plot (or between the first and the last category's centres – where
    PowerPoint's series can draw it, chart-series.ts refSpan) and its label */
export function refNodes(R: RefLine, m: Metrics, labelX: number, F?: Pick<TargetFrame, "nudge" | "ground">): TargetOut {
  const line: Node = { t: "line", x1: r2(R.x1), y1: r2(R.y), x2: r2(R.x2), y2: r2(R.y), stroke: R.stroke };
  const nodes: Node[] = [line], out: TargetOut = { nodes, issues: [], native: R.series ? [line] : [], labels: [] };
  if (R.label) {
    const L = R.label, lh = lineH(L.st), key = "r:" + R.id, d = F?.nudge?.(key) ?? { x: 0, y: 0 };
    const [x, top, al]: [number, number, "left" | "right"] = L.pos === "right" ? [labelX, R.y - lh / 2, "left"] : L.pos === "left" ? [R.x1 + 4, R.y - lh - 2, "left"]
      : L.pos === "below" ? [R.x2 - 4, R.y + 2, "right"] : L.pos === "inside" ? [R.x2 - 6, R.y - lh / 2, "right"] : [R.x2 - 4, R.y - lh - 2, "right"];
    const t = placed(m, L.text, x + d.x, top + d.y, L.st, al);
    // ("inside": on the line, the card's ground behind the text so the dashes do not cross it)
    if (L.pos === "inside") nodes.push({ t: "rect", x: r2(t.box.x - 4), y: r2(t.box.y), w: r2(t.box.w + 8), h: r2(t.box.h), fill: { solid: parseColor(F?.ground?.fill || "#FFFFFF").c, ...(F?.ground && F.ground.a < 1 ? { a: F.ground.a } : {}) } });
    nodes.push(t.node); out.labels!.push({ key, box: t.box });
  }
  return out;
}
/** a text node and its line box */
function placed(m: Metrics, text: string, x: number, top: number, st: St, al: "left" | "center" | "right"): { node: TextNode; box: { x: number; y: number; w: number; h: number } } {
  const n = textNode(m, text, x, top, st, al), w = n.w;
  return { node: n, box: { x: r2(al === "center" ? x - w / 2 : al === "right" ? x - w : x), y: r2(top), w: r2(w), h: lineH(st) } };
}
/** the last point of a series with a value (i -1), or point i (counted in its group) */
function pointOf(S: SerPts, i: number): number | null {
  if (i >= 0) { const k = S.start + Math.floor(i); return S.anchors[k] && S.vals[k] !== null ? k : null; }
  for (let k = S.anchors.length - 1; k >= 0; k--) if (S.anchors[k] && S.vals[k] !== null) return k;
  return null;
}
/** the default series of a gap or change mark: the first line series drawn, else the first series */
const firstSeries = (F: TargetFrame) => [...F.series.keys()][0];

/** a gap arrow: from the reference line down / up to beside the point (or, `from` "point", from beside the point to the
    line), the difference and the caption beside it – on the arrow's right or left (`labelSide`), the caption under or
    over the difference (`capPos`) */
export function gapNodes(id: string, k: ChartMark, F: TargetFrame, m: Metrics): TargetOut {
  const out: TargetOut = { nodes: [], issues: [], native: [], labels: [] };
  const sid = k.a && "s" in k.a ? String(k.a.s) : firstSeries(F), S = sid ? F.series.get(sid) : undefined;
  if (!S) { out.issues.push(`gap '${id}': series '${sid ?? ""}' not found`); return out; }
  const R = typeof k.ref === "string" ? F.refs.get(k.ref) : undefined;
  if (!R) { if (!(typeof k.ref === "string" && F.refOff?.has(k.ref))) out.issues.push(`gap '${id}': reference line '${k.ref ?? ""}' not found`); return out; }
  // (a stacked series' point stands on the stack's top: the arrow from there would not measure its own value – review of B52)
  if (S.stacked) { out.issues.push(`gap '${id}': not drawn on a stacked series (its points stand on the stack, not on its values)`); return out; }
  const i = pointOf(S, k.a && "s" in k.a ? +k.a.i : -1);
  if (i === null) return out;                                   // a gap in the data: nothing to point at
  const p = S.anchors[i]!, v = S.vals[i]!, d = v - R.v;
  const own = HEX.test(k.style?.color || "") ? k.style!.color!.toUpperCase() : null, color = signColor(k, d, F.look, own, F.ink);
  const side = k.pos === "left" ? -1 : 1, dx = gapDx(F.slot), x = p.x + side * dx;
  const L = lineStyleOf({ ...(k.style || {}), color }, color, 1.5), dash = dashOf(L);
  const stroke: Stroke = { w: L.w, paint: solid(L.color), cap: "butt", ...(dash ? { dash } : {}) };
  const heads = k.style?.heads && typeof k.style.heads === "object" ? k.style.heads : { b: "triangle" as const };
  // (end a where it starts – the line, or with `from` "point" the point –, end b where its head points by default)
  const onLine = { x, y: R.y }, atPoint = { x, y: p.y }, [pa, pb] = k.from === "point" ? [atPoint, onLine] : [onLine, atPoint];
  if (Math.abs(pb.y - pa.y) > 1) {
    const h = headed(pa, pb, stroke, heads), line: Node = { t: "line", x1: r2(h.a.x), y1: r2(h.a.y), x2: r2(h.b.x), y2: r2(h.b.y), stroke };
    out.nodes.push(line, ...h.nodes);
    const nA = headGeom(heads.a, pa, pb, stroke.w, heads.size) ? 1 : 0, nB = headGeom(heads.b, pb, pa, stroke.w, heads.size) ? 1 : 0;
    const ea = nA && heads.a !== "bar" ? heads.a : undefined, eb = nB && heads.b !== "bar" ? heads.b : undefined;
    out.arrow = { a: { x: r2(pa.x), y: r2(pa.y) }, b: { x: r2(pb.x), y: r2(pb.y) }, stroke, ...(ea ? { head: ea } : {}), ...(eb ? { tail: eb } : {}), ...(heads.size ? { size: heads.size } : {}),
      drop: [line, ...(ea ? h.nodes.slice(0, nA) : []), ...(eb ? h.nodes.slice(nA, nA + nB) : [])] };
  }
  // the label: the difference (bold, larger) and the caption (small) beside the arrow's middle
  const G = gapText(k, d, R.v, R.fmt || S.fmt, F.lab, F.withFmt, color), caption = G.caption, big = G.big, small = G.small;
  const lside = k.labelSide === "left" ? -1 : k.labelSide === "right" ? 1 : side;
  const lb = lineH(big), ls = caption ? lineH(small) : 0, nd = F.nudge?.("g:" + id) ?? { x: 0, y: 0 };
  const top = (onLine.y + atPoint.y) / 2 - (lb + ls) / 2 + nd.y, lx = x + lside * 6 + nd.x, al = lside > 0 ? "left" : "right";
  const capOver = k.capPos === "above" && !!caption;
  const T = placed(m, G.text, lx, capOver ? top + ls : top, big, al);
  out.nodes.push(T.node);
  let box = T.box;
  if (caption) {
    const C = placed(m, caption, lx, capOver ? top : top + lb, small, al);
    out.nodes.push(C.node);
    const x0 = Math.min(box.x, C.box.x), x1 = Math.max(box.x + box.w, C.box.x + C.box.w);
    box = { x: x0, y: r2(top), w: r2(x1 - x0), h: lb + ls };
  }
  out.labels!.push({ key: "g:" + id, box });
  return out;
}
/** how far beside its point a gap arrow stands */
export const gapDx = (slot: number) => Math.max(12, Math.min(36, slot * .25));
/** a gap's label: its text (the signed difference, its % of the line), caption and styles (colour unset) */
function gapText(k: ChartMark, d: number, ref: number, fmt0: string, lab: St, withFmt: (st: St, f: ChartMark["fmt"]) => St, color = lab.color) {
  const fmt = typeof k.num === "string" && k.num.trim() ? k.num : fmt0;
  const text = signed(d, fmt) + (k.pct && ref ? ` (${signedPct(d / Math.abs(ref))})` : "");
  const big = withFmt({ ...lab, size: Math.round(lab.size * 1.4), weight: 700, color }, k.fmt), small: St = { ...lab, size: Math.max(6, Math.round(lab.size * .8)), weight: 400, color };
  return { text, caption: typeof k.caption === "string" ? k.caption : "gap", big, small };
}
/** how wide a gap mark's label runs past its point's arrow, on each side (the plot leaves room on the right for it):
    measured on the label it will show – the difference `d` of its point (B53: no longer a sample as wide as the line's
    own value) */
export function gapLabelW(k: ChartMark, R: RefVal | undefined, lab: St, withFmt: (st: St, f: ChartMark["fmt"]) => St, m: Metrics, d?: number | null): number {
  if (!R || R.v === null) return 0;
  const G = gapText(k, d ?? -Math.abs(R.v), R.v, R.fmt, lab, withFmt);
  const text = d === undefined || d === null ? MINUS + tickText(Math.abs(R.v), typeof k.num === "string" && k.num.trim() ? k.num : R.fmt) + (k.pct ? " (−00.0%)" : "") : G.text;
  return Math.max(m.run(text, font(G.big)).w, G.caption ? m.run(G.caption, font(G.small)).w : 0) + 6;
}

/** the height of a row of change pills (the layout leaves it under the category labels for `pos` "below") */
export function pillRowH(F: Pick<TargetFrame, "lab" | "withFmt">, k: ChartMark): number {
  return lineH(F.withFmt({ ...F.lab, size: Math.max(6, Math.round(F.lab.size * .82)), weight: 600 }, k.fmt)) + 6;
}
/** change pills: one between each pair of consecutive points of the series (or the last pair), the change in it – in a
    row just above the plot's floor ("axis", default), under the line between the two points ("line"), under the later
    point ("point"), in a row along the plot's top ("above") or under the category labels ("below"); the caption above
    the row's left (default) or right end, or under the row (`capPos`) */
export function changeNodes(id: string, k: ChartMark, F: TargetFrame, m: Metrics): TargetOut {
  const out: TargetOut = { nodes: [], issues: [], native: [], labels: [] };
  const sid = k.a && "s" in k.a ? String(k.a.s) : firstSeries(F), S = sid ? F.series.get(sid) : undefined;
  if (!S) { out.issues.push(`change '${id}': series '${sid ?? ""}' not found`); return out; }
  const pairs: [number, number][] = [];
  for (let i = 1; i < S.anchors.length; i++) if (S.anchors[i] && S.anchors[i - 1] && S.vals[i] !== null && S.vals[i - 1] !== null) pairs.push([i - 1, i]);
  const list = k.pairs === "last" ? pairs.slice(-1) : pairs;
  if (!list.length) return out;
  const fmt = typeof k.num === "string" && k.num.trim() ? k.num : S.fmt, abs = k.abs !== false, pct = k.pct !== false;
  const own = HEX.test(k.style?.color || "") ? k.style!.color!.toUpperCase() : null;
  const st0 = F.withFmt({ ...F.lab, size: Math.max(6, Math.round(F.lab.size * .82)), weight: 600 }, k.fmt), lh = lineH(st0), h = lh + 6, P = F.plot;
  const nd = (key: string) => F.nudge?.(key) ?? { x: 0, y: 0 };
  let rowTop = Infinity, rowBottom = -Infinity, rowLeft = Infinity, rowRight = -Infinity;
  for (const [a, b] of list) {
    const va = S.vals[a]!, vb = S.vals[b]!, d = vb - va, A = S.anchors[a]!, B = S.anchors[b]!;
    const parts = [abs ? signed(d, fmt) : "", pct && va ? (abs ? `(${signedPct(d / Math.abs(va))})` : signedPct(d / Math.abs(va))) : ""].filter(Boolean);
    if (!parts.length) continue;
    const text = parts.join(" "), color = signColor(k, d, F.look, own, F.ink), st = { ...st0, color };
    const tw = m.run(text, font(st)).w, w = Math.min(Math.max(tw + 16, h * 2), Math.max(h, F.slot - 6)), key = `c:${id}:${b - S.start}`, o = nd(key);
    const cx = (k.pos === "point" ? B.x : (A.x + B.x) / 2) + o.x;
    const cy = (k.pos === "line" ? Math.min(P.y + P.h - h / 2 - 2, Math.max(A.y, B.y) + h / 2 + 14)
      : k.pos === "point" ? Math.min(P.y + P.h - h / 2 - 2, B.y + B.r + h / 2 + 4)
        : k.pos === "above" ? P.y + h / 2 + 2
          : k.pos === "below" && F.below !== undefined ? F.below + h / 2 + 2 : P.y + P.h - h / 2 - 8) + o.y;
    out.nodes.push({ t: "rect", x: r2(cx - w / 2), y: r2(cy - h / 2), w: r2(w), h: r2(h), r: r2(h / 2), fill: { solid: parseColor(tintOf(color, F.look.tint)).c } });
    out.nodes.push(textNode(m, text, cx, cy - lh / 2, st, "center"));
    out.labels!.push({ key, box: { x: r2(cx - w / 2), y: r2(cy - h / 2), w: r2(w), h: r2(h) } });
    rowTop = Math.min(rowTop, cy - h / 2 - o.y); rowBottom = Math.max(rowBottom, cy + h / 2 - o.y);
    rowLeft = Math.min(rowLeft, cx - w / 2 - o.x); rowRight = Math.max(rowRight, cx + w / 2 - o.x);
  }
  const caption = typeof k.caption === "string" ? k.caption : "";
  if (caption && Number.isFinite(rowTop)) {
    const cs: St = { ...F.lab, size: Math.max(6, Math.round(F.lab.size * .72)), weight: 400, italic: true, color: F.look.muted }, ch = lineH(cs), o = nd(`c:${id}:cap`);
    // (the default: above the row at the plot's left, as before 4.11)
    const [x, top, al]: [number, number, "left" | "right"] = k.capPos === "right" ? [Math.min(P.x + P.w - 4, rowRight), rowTop - ch - 2, "right"]
      : k.capPos === "below" ? [Math.max(P.x + 4, rowLeft), rowBottom + 2, "left"] : [P.x + 4, rowTop - ch - 2, "left"];
    const C = placed(m, caption, x + o.x, top + o.y, cs, al);
    out.nodes.push(C.node); out.labels!.push({ key: `c:${id}:cap`, box: C.box });
  }
  return out;
}
