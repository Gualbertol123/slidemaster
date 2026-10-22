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
import type { ChartItem, ChartMark, DataRef } from "../model/types";
import type { Node, Stroke } from "../dl/types";
import type { RenderCtx } from "./context";
import type { Metrics } from "./excel-dl";
import type { LineSem } from "../pptx/chart-sem";
import { refTarget, shown } from "./chart-data";
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
function cellOf(ref: DataRef, ctx: RenderCtx): { v: number | null; fmt: string; text: string; source: string } | null {
  const T = refTarget(ref, ctx);
  if (!T.S || !T.g) return null;
  const c = T.S.get(T.g.r1, T.g.c1), v = c && c.t === "n" && typeof c.v === "number" && Number.isFinite(c.v) ? c.v : null;
  return { v, fmt: c?.fmt || "General", text: shown(T.S, T.g.r1, T.g.c1, ctx).trim(), source: T.source };
}
/** the marks of the chart that are on, in id order (a later id on top) */
export const marksOf = (it: ChartItem) => Object.entries(it.marks && typeof it.marks === "object" ? it.marks : {})
  .filter(([, k]) => k && typeof k === "object" && !k.off).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
/** every reference line that is on: its value (a cell's number; a typed number – `fallbackFmt`, the series' format, when
    it has none of its own), its name, the axis it stands on */
export function refValues(it: ChartItem, ctx: RenderCtx, fallbackFmt: string): RefVal[] {
  const out: RefVal[] = [];
  let n = 0;
  for (const [id, k] of marksOf(it)) {
    if (k.kind !== "ref") continue;
    const num = typeof k.num === "string" && k.num.trim() ? k.num : "";
    const r: RefVal = { id, k, v: null, text: "", fmt: num || fallbackFmt || "General", name: "", axis: k.axis === "y2" ? "y2" : "y", n: n++ };
    if (isRef(k.value)) {
      const c = cellOf(k.value, ctx);
      if (!c) r.issue = `reference line '${id}': ${refTarget(k.value, ctx).source} not found`;
      else if (c.v === null) r.issue = `reference line '${id}': no number in ${c.source}`;
      else { r.v = c.v; r.fmt = num || c.fmt; }
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
  label: { text: string; st: St; pos: "right" | "left" | "above" } | null }
/** a reference line's label: what it shows, in its style (the line's colour, bold unless its fmt says) */
export function refLabel(r: RefVal, color: string, lab: St, withFmt: (st: St, f: ChartMark["fmt"]) => St): { text: string; st: St; pos: "right" | "left" | "above" } | null {
  const show = r.k.show || "both";
  const text = show === "none" ? "" : show === "name" ? r.name : show === "value" ? r.text : [r.name, r.text].filter(Boolean).join(" ");
  if (!text) return null;
  const pos = r.k.pos === "left" || r.k.pos === "above" ? r.k.pos : "right";
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
export interface SerPts { anchors: ({ x: number; y: number; r: number } | null)[]; vals: (number | null)[]; start: number; fmt: string }
/** what the targets need of the chart's layout (a part of chart-marks.ts MarkFrame) */
export interface TargetFrame {
  plot: { x: number; y: number; w: number; h: number }; slot: number; ink: string; lab: St; withFmt: (st: St, f: ChartMark["fmt"]) => St;
  /** the reference lines as drawn (seriesLayout), by id */ refs: Map<string, RefLine>;
  /** the series drawn, by id */ series: Map<string, SerPts>;
  look: TargetLook;
}
export interface TargetOut { nodes: Node[]; issues: string[];
  /** the gap arrow as the export writes it (one line shape with native ends): from the line (a) to the point (b) */
  arrow?: { a: { x: number; y: number }; b: { x: number; y: number }; stroke: Stroke; head?: string; tail?: string; size?: "s" | "m" | "l"; drop: Node[] };
  /** nodes the PowerPoint export leaves out: a reference line's line (the native chart's own series draws it) */ native: Node[] }

/** a reference line's nodes: the line across the plot (or between the first and the last category's centres – where
    PowerPoint's series can draw it, chart-series.ts refSpan) and its label */
export function refNodes(R: RefLine, m: Metrics, labelX: number): TargetOut {
  const line: Node = { t: "line", x1: r2(R.x1), y1: r2(R.y), x2: r2(R.x2), y2: r2(R.y), stroke: R.stroke };
  const nodes: Node[] = [line];
  if (R.label) {
    const L = R.label, lh = lineH(L.st);
    if (L.pos === "right") nodes.push(textNode(m, L.text, labelX, R.y - lh / 2, L.st, "left"));
    else if (L.pos === "left") nodes.push(textNode(m, L.text, R.x1 + 4, R.y - lh - 2, L.st, "left"));
    else nodes.push(textNode(m, L.text, R.x2 - 4, R.y - lh - 2, L.st, "right"));
  }
  return { nodes, issues: [], native: [line] };
}
/** the last point of a series with a value (i -1), or point i (counted in its group) */
function pointOf(S: SerPts, i: number): number | null {
  if (i >= 0) { const k = S.start + Math.floor(i); return S.anchors[k] && S.vals[k] !== null ? k : null; }
  for (let k = S.anchors.length - 1; k >= 0; k--) if (S.anchors[k] && S.vals[k] !== null) return k;
  return null;
}
/** the default series of a gap or change mark: the first line series drawn, else the first series */
const firstSeries = (F: TargetFrame) => [...F.series.keys()][0];

/** a gap arrow: from the reference line down / up to beside the point, the difference and the caption beside it */
export function gapNodes(id: string, k: ChartMark, F: TargetFrame, m: Metrics): TargetOut {
  const out: TargetOut = { nodes: [], issues: [], native: [] };
  const sid = k.a && "s" in k.a ? String(k.a.s) : firstSeries(F), S = sid ? F.series.get(sid) : undefined;
  if (!S) { out.issues.push(`gap '${id}': series '${sid ?? ""}' not found`); return out; }
  const R = typeof k.ref === "string" ? F.refs.get(k.ref) : undefined;
  if (!R) { out.issues.push(`gap '${id}': reference line '${k.ref ?? ""}' not found`); return out; }
  const i = pointOf(S, k.a && "s" in k.a ? +k.a.i : -1);
  if (i === null) return out;                                   // a gap in the data: nothing to point at
  const p = S.anchors[i]!, v = S.vals[i]!, d = v - R.v;
  const own = HEX.test(k.style?.color || "") ? k.style!.color!.toUpperCase() : null, color = signColor(k, d, F.look, own, F.ink);
  const side = k.pos === "left" ? -1 : 1, dx = Math.max(12, Math.min(36, F.slot * .25)), x = p.x + side * dx;
  const L = lineStyleOf({ ...(k.style || {}), color }, color, 1.5), dash = dashOf(L);
  const stroke: Stroke = { w: L.w, paint: solid(L.color), cap: "butt", ...(dash ? { dash } : {}) };
  const heads = k.style?.heads && typeof k.style.heads === "object" ? k.style.heads : { b: "triangle" as const };
  const pa = { x, y: R.y }, pb = { x, y: p.y };
  if (Math.abs(pb.y - pa.y) > 1) {
    const h = headed(pa, pb, stroke, heads), line: Node = { t: "line", x1: r2(h.a.x), y1: r2(h.a.y), x2: r2(h.b.x), y2: r2(h.b.y), stroke };
    out.nodes.push(line, ...h.nodes);
    const nA = headGeom(heads.a, pa, pb, stroke.w, heads.size) ? 1 : 0, nB = headGeom(heads.b, pb, pa, stroke.w, heads.size) ? 1 : 0;
    const ea = nA && heads.a !== "bar" ? heads.a : undefined, eb = nB && heads.b !== "bar" ? heads.b : undefined;
    out.arrow = { a: { x: r2(pa.x), y: r2(pa.y) }, b: { x: r2(pb.x), y: r2(pb.y) }, stroke, ...(ea ? { head: ea } : {}), ...(eb ? { tail: eb } : {}), ...(heads.size ? { size: heads.size } : {}),
      drop: [line, ...(ea ? h.nodes.slice(0, nA) : []), ...(eb ? h.nodes.slice(nA, nA + nB) : [])] };
  }
  // the label: the difference (bold, larger) and the caption (small) beside the arrow's middle
  const fmt = typeof k.num === "string" && k.num.trim() ? k.num : R.fmt || S.fmt;
  const text = signed(d, fmt) + (k.pct && R.v ? ` (${signedPct(d / Math.abs(R.v))})` : "");
  const big = F.withFmt({ ...F.lab, size: Math.round(F.lab.size * 1.4), weight: 700, color }, k.fmt), small: St = { ...F.lab, size: Math.max(6, Math.round(F.lab.size * .8)), weight: 400, color };
  const caption = typeof k.caption === "string" ? k.caption : "gap";
  const lb = lineH(big), ls = caption ? lineH(small) : 0, top = (pa.y + pb.y) / 2 - (lb + ls) / 2, lx = x + side * 6, al = side > 0 ? "left" : "right";
  out.nodes.push(textNode(m, text, lx, top, big, al));
  if (caption) out.nodes.push(textNode(m, caption, lx, top + lb, small, al));
  return out;
}
/** how wide a gap mark's label runs past its point (the plot leaves room on the right for it) */
export function gapLabelW(k: ChartMark, R: RefVal | undefined, lab: St, withFmt: (st: St, f: ChartMark["fmt"]) => St, m: Metrics): number {
  if (!R || R.v === null) return 0;
  const big = withFmt({ ...lab, size: Math.round(lab.size * 1.4), weight: 700 }, k.fmt), small: St = { ...lab, size: Math.max(6, Math.round(lab.size * .8)), weight: 400 };
  const sample = MINUS + tickText(Math.abs(R.v), typeof k.num === "string" && k.num.trim() ? k.num : R.fmt) + (k.pct ? " (−00.0%)" : "");
  const caption = typeof k.caption === "string" ? k.caption : "gap";
  return Math.max(m.run(sample, font(big)).w, caption ? m.run(caption, font(small)).w : 0) + 6;
}

/** change pills: one between each pair of consecutive points of the series (or the last pair), the change in it */
export function changeNodes(id: string, k: ChartMark, F: TargetFrame, m: Metrics): TargetOut {
  const out: TargetOut = { nodes: [], issues: [], native: [] };
  const sid = k.a && "s" in k.a ? String(k.a.s) : firstSeries(F), S = sid ? F.series.get(sid) : undefined;
  if (!S) { out.issues.push(`change '${id}': series '${sid ?? ""}' not found`); return out; }
  const pairs: [number, number][] = [];
  for (let i = 1; i < S.anchors.length; i++) if (S.anchors[i] && S.anchors[i - 1] && S.vals[i] !== null && S.vals[i - 1] !== null) pairs.push([i - 1, i]);
  const list = k.pairs === "last" ? pairs.slice(-1) : pairs;
  if (!list.length) return out;
  const fmt = typeof k.num === "string" && k.num.trim() ? k.num : S.fmt, abs = k.abs !== false, pct = k.pct !== false;
  const own = HEX.test(k.style?.color || "") ? k.style!.color!.toUpperCase() : null;
  const st0 = F.withFmt({ ...F.lab, size: Math.max(6, Math.round(F.lab.size * .82)), weight: 600 }, k.fmt), lh = lineH(st0), h = lh + 6, P = F.plot;
  let rowTop = Infinity;
  for (const [a, b] of list) {
    const va = S.vals[a]!, vb = S.vals[b]!, d = vb - va, A = S.anchors[a]!, B = S.anchors[b]!;
    const parts = [abs ? signed(d, fmt) : "", pct && va ? (abs ? `(${signedPct(d / Math.abs(va))})` : signedPct(d / Math.abs(va))) : ""].filter(Boolean);
    if (!parts.length) continue;
    const text = parts.join(" "), color = signColor(k, d, F.look, own, F.ink), st = { ...st0, color };
    const tw = m.run(text, font(st)).w, w = Math.min(Math.max(tw + 16, h * 2), Math.max(h, F.slot - 6)), cx = (A.x + B.x) / 2;
    const cy = k.pos === "line" ? Math.min(P.y + P.h - h / 2 - 2, Math.max(A.y, B.y) + h / 2 + 14) : P.y + P.h - h / 2 - 8;
    out.nodes.push({ t: "rect", x: r2(cx - w / 2), y: r2(cy - h / 2), w: r2(w), h: r2(h), r: r2(h / 2), fill: { solid: parseColor(tintOf(color, F.look.tint)).c } });
    out.nodes.push(textNode(m, text, cx, cy - lh / 2, st, "center"));
    rowTop = Math.min(rowTop, cy - h / 2);
  }
  const caption = typeof k.caption === "string" ? k.caption : "";
  if (caption && Number.isFinite(rowTop)) {
    const cs: St = { ...F.lab, size: Math.max(6, Math.round(F.lab.size * .72)), weight: 400, italic: true, color: F.look.muted };
    out.nodes.push(textNode(m, caption, P.x + 4, rowTop - lineH(cs) - 2, cs, "left"));
  }
  return out;
}
