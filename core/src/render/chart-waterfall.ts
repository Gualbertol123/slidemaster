/* Waterfall charts (09 §2.2, §3.1, §3.2, §4.2; S14.4, CT-01): one series' steps as columns floating on the running
   total – an increase from the total before it upwards, a decrease downwards, a point marked `total` (points[i].total)
   standing on the axis from 0 to its own value, the running total going on from there (Excel's "Set as total") – in the
   design's colours (up = positive, down = negative, total = the chart's ink; Liquid Glass's first chart colour), a
   point's own colour over them, and thin connector lines from each step's end to the next step.
   PowerPoint (no Office 2016 chartex, Q4): the classic stacked-column construction – an invisible base series under
   the visible up / down / total series in one stacked c:barChart (a step that crosses zero: its part below zero in a
   second series of the same colour, as stacked columns stack negatives downwards), at the slide's fixed bounds and plot,
   so each column stands where the slide draws it. Two invisible series of a c:lineChart on the same axes carry the
   rest: the values themselves (what Edit Data shows and pptxcheck --sources compares with the cells) and the data
   labels, each a static text at the very place the slide draws it (a line point's centred label: a stacked column has no
   "outside end"). The connectors are lines under the chart (the card), as on the slide – never connector shapes. */
import type { ChartSeries } from "../model/types";
import type { BarsSem, BarSerSem, GroupSem, LineSem } from "../pptx/chart-sem";
import type { RenderCtx } from "./context";
import type { SerData } from "./chart-data";
import type { SeriesLayout } from "./chart-series";
import { palette } from "../model/style";
import { lineH } from "./chart-font";
import { lineStyleOf } from "./chart-lines";
import { lightOf } from "./chart-bars";

export type StepKind = "up" | "down" | "total";
/** one column: category i, the value it shows, its ends in axis values (from → to: `to` is the running total after it) */
export interface Step { i: number; v: number; from: number; to: number; kind: StepKind }
/** a point's settings as a waterfall reads them: `total` marks a total column (09 §3.2) */
type WPoint = NonNullable<ChartSeries["points"]>[string] & { total?: unknown };
/** whether point i (the series' own index) is a total */
export const isTotal = (s: SerData, i: number): boolean => (s.src.points?.[String(i - s.start)] as WPoint | undefined)?.total === true;
/** the running total: per category its column (null = a gap: no column, the total unchanged), and the values the axis
    must hold (0 always: the first column and every total stand on it) */
export function waterfallSteps(s: SerData): { steps: (Step | null)[]; lo: number; hi: number } {
  let run = 0, lo = 0, hi = 0;
  const steps = s.vals.map((v, i): Step | null => {
    if (v === null || v === undefined) return null;
    const total = isTotal(s, i), from = total ? 0 : run, to = total ? v : run + v;
    run = to; lo = Math.min(lo, from, to); hi = Math.max(hi, from, to);
    return { i, v, from, to, kind: total ? "total" : v >= 0 ? "up" : "down" };
  });
  return { steps, lo, hi };
}
/** the design's three colours: positive, negative (the deck's palette, as the tables' green and red) and the total's
    (the chart's ink; Liquid Glass: its first chart colour, as the spike drew it) */
export function waterfallColors(ctx: RenderCtx, ink: string, first: string): Record<StepKind, string> {
  const P = palette(ctx.style);
  return { up: P.pos.toUpperCase(), down: P.neg.toUpperCase(), total: (ctx.style.design === "glass" ? first : ink).toUpperCase() };
}
/** the legend's entries, as Excel names them (legendHide keys: "up", "down", "total") */
export const STEP_NAMES: Record<StepKind, string> = { up: "Increase", down: "Decrease", total: "Total" };
/** the connectors' look: the series' `line`, else a thin dashed line in the design's axis-line colour (S14.4 review 8;
    `color`, default a neutral grey) */
export const connectorLine = (s: ChartSeries, color = "#8A93A3"): LineSem => s.line && typeof s.line === "object" ? lineStyleOf({ dash: "dashed", ...s.line }, color, 1) : { color, w: 1, dash: "dash" };
/** a connector from each column's end (its running total) to the next column, across the gap between them */
export function connectors(bars: { i: number; x: number; w: number }[], steps: (Step | null)[], vp: (v: number) => number, line: LineSem): { x1: number; x2: number; y: number; line: LineSem }[] {
  const out: { x1: number; x2: number; y: number; line: LineSem }[] = [], r2 = (v: number) => Math.round(v * 100) / 100 || 0;
  const by = [...bars].sort((a, b) => a.i - b.i);
  for (let k = 0; k + 1 < by.length; k++) {
    const a = by[k], b = by[k + 1], st = steps[a.i];
    if (!st || b.x <= a.x + a.w) continue;
    out.push({ x1: r2(a.x + a.w), x2: r2(b.x), y: r2(vp(st.to)), line });
  }
  return out;
}

/** the native chart of a waterfall (see the top): `base` is seriesSem's own (axes, plot, title, legend box), its series
    and chart groups replaced by the construction */
export function waterfallSem(L: SeriesLayout, base: BarsSem): BarsSem {
  const W = L.fall!, n = L.data.cats.length, s = L.data.series[0], sem: BarSerSem[] = [];
  const at = (f: (st: Step) => number | null) => W.steps.map(st => st ? f(st) : null);
  const nz = (v: number | null) => v === null || Math.abs(v) < 1e-12 ? null : +v.toPrecision(15);
  const font = base.series[0]?.labels?.font ?? null;
  // each column's lower / upper end; its base: from 0 to the end nearer 0 (none when the column crosses or touches 0)
  const lowHi = (st: Step) => [Math.min(st.from, st.to), Math.max(st.from, st.to)];
  const baseVal = (st: Step) => { const [a, b] = lowHi(st); return a >= 0 ? a : b <= 0 ? b : 0; };
  const invisible = (name: string, values: (number | null)[], type: "column" | "line"): BarSerSem => ({ name, values, color: "#FFFFFF", fmt: s.fmt, points: [], labels: null, type, axis: "y", invisible: true, ...(type === "line" ? { stroke: null, marker: null, smooth: false } : {}) });
  sem.push(invisible("Base", at(st => nz(baseVal(st))), "column"));
  const hidden = [0], bars: number[] = [0], kinds: { kind: StepKind; at: number }[] = [];
  const barOf = new Map(L.bars.map(b => [b.i, b])), zeroY = L.plot.y + L.plot.h - (0 - L.scale.min) / ((L.scale.max - L.scale.min) || 1) * L.plot.h;
  for (const kind of ["up", "down", "total"] as const) {
    const mine = W.steps.filter((st): st is Step => !!st && st.kind === kind);
    if (!mine.length) continue;
    const color = W.colors[kind];
    // the part away from 0 beyond the base; a column across 0: its part above 0 here, the part below in the extra series
    const main = at(st => st.kind !== kind ? null : (() => { const [a, b] = lowHi(st); return nz(a >= 0 ? b - a : b <= 0 ? a - b : b); })());
    const below = at(st => { if (st.kind !== kind) return null; const [a, b] = lowHi(st); return a < 0 && b > 0 ? nz(a) : null; });
    // (Liquid Glass, a column across 0: its two parts take the slide's one gradient split at 0 – the part above from the
    // column's top colour to the colour at 0, the part below from there to its bottom colour; S14.4 review 6)
    const pts = (vals: (number | null)[], part: "main" | "below") => vals.flatMap((v, i) => {
      if (v === null) return [];
      const B = barOf.get(i), own = B && B.color !== color ? B.color : null, rev = L.gradient && B && B.dir === "down";
      const c = own || color, st = W.steps[i];
      if (L.gradient && B && st && Math.min(st.from, st.to) < 0 && Math.max(st.from, st.to) > 0 && B.h > 0) {
        const top = B.dir === "down" ? c : lightOf(c), bottom = B.dir === "down" ? lightOf(c) : c;
        const mid = mixHex(top, bottom, Math.max(0, Math.min(1, (zeroY - B.y) / B.h)));
        return [part === "main" ? { i, color: mid, light: top } : { i, color: bottom, light: mid }];
      }
      if (!own && !rev) return [];
      return [{ i, color: c, ...(L.gradient ? { light: lightOf(c) } : {}), ...(rev ? { rev: true } : {}) }];
    });
    const mk = (name: string, values: (number | null)[], part: "main" | "below"): BarSerSem => ({ name, values, color, fmt: s.fmt, points: pts(values, part), labels: null, type: "column", axis: "y", ...(L.gradient ? { light: lightOf(color) } : {}) });
    bars.push(sem.length); kinds.push({ kind, at: sem.length });
    sem.push(mk(STEP_NAMES[kind], main, "main"));
    if (below.some(v => v !== null)) { bars.push(sem.length); hidden.push(sem.length); sem.push(mk(`${STEP_NAMES[kind]} (below 0)`, below, "below")); }
  }
  // the values (Edit Data, --sources) and the labels' carrier: at each label's centre, its text there
  const values = sem.length; hidden.push(values);
  sem.push(invisible(s.name || "Values", s.vals.slice(0, n), "line"));
  const span = L.scale.max - L.scale.min || 1, P = L.plot;
  const labs = L.labs.filter(l => l.s === 0), carrier = sem.length;
  if (labs.length && font) {
    // (a carrier point outside the axis's bounds would lose its label in PowerPoint: the slide keeps its labels inside the
    // plot, and any that is still out – the plot shorter than a label – stands on the bound with its label below / above
    // it; S14.4 review 1)
    const at = new Map(labs.map(l => {
      const v = L.scale.min + (P.y + P.h - (l.top + lineH(l.st) / 2)) / P.h * span;
      return [l.i, v > L.scale.max ? { v: L.scale.max, pos: "b" as const } : v < L.scale.min ? { v: L.scale.min, pos: "t" as const } : { v, pos: null }];
    }));
    const c = invisible("Labels", L.data.cats.map((_, i) => at.has(i) ? +at.get(i)!.v.toPrecision(15) : null), "line");
    c.labels = { show: [], pos: "ctr", num: null, font, points: labs.map(l => ({ i: l.i, text: l.text, ...(l.st.color.toUpperCase() !== font.color.toUpperCase() ? { color: l.st.color } : {}), ...(at.get(l.i)!.pos ? { pos: at.get(l.i)!.pos } : {}) })) };
    hidden.push(carrier); sem.push(c);
  }
  // Edit Data (S14.4 review 3): the construction columns are formulas over the values column and a running total column
  // (after the series'), so a value changed in PowerPoint moves its columns – as long as each step keeps its kind and
  // side of zero (a step that turns into another kind moves to that kind's series when the chart has one; a new
  // crossing of zero needs a new export). The labels stay the texts of the export
  const formulas = waterfallFormulas(W.steps, i => isTotal(s, i), sem, kinds, n);
  const groups: GroupSem[] = [{ kind: "bar", axis: "y", grouping: "stacked", gap: L.gap, overlap: 100, series: bars },
    { kind: "line", axis: "y", grouping: "standard", gap: 0, overlap: 0, series: sem.slice(values).map((_, k) => values + k) }];
  // the legend: the kinds the slide lists (legendHide by "up" / "down" / "total"; past the room: left out)
  const shown = new Set(W.legend);
  const legendHide = [...hidden, ...kinds.filter(k => !shown.has(k.kind)).map(k => k.at)].sort((a, b) => a - b);
  return { ...base, grouping: "stacked", overlap: 100, series: sem, groups, val2: null, legend: base.legend ? { ...base.legend, hide: legendHide } : null,
    book: { values, extra: [{ name: "Running total", values: formulas.run, f: formulas.runF }] } };
}
/** the formulas of a waterfall's embedded workbook (see waterfallSem): per row its running total ({R}: a total's own
    value, else the row before's plus its value), the base under the column and each kind's part above / below 0 – the
    same arithmetic as waterfallSem's, in Excel's words; sets `f` on the construction series */
function waterfallFormulas(steps: (Step | null)[], total: (i: number) => boolean, sem: BarSerSem[], kinds: { kind: StepKind; at: number }[], n: number): { run: (number | null)[]; runF: string[] } {
  const run: (number | null)[] = [], runF: string[] = [];
  let r = 0;
  for (let i = 0; i < n; i++) {
    const st = steps[i];
    if (st) r = st.to;
    run.push(+r.toPrecision(15));
    runF.push(total(i) ? `IF({V}="",{Rp},{V})` : `{Rp}+N({V})`);
  }
  const lohi = (i: number) => { const from = total(i) ? "0" : "{Rp}"; return [`MIN(${from},{R})`, `MAX(${from},{R})`]; };
  sem[0].f = Array.from({ length: n }, (_, i) => { const [lo, hi] = lohi(i); return `IF({V}="","",IF(${lo}>=0,${lo},IF(${hi}<=0,${hi},0)))`; });
  for (const { kind, at } of kinds) {
    const cond = (i: number) => kind === "total" ? (total(i) ? "TRUE" : null) : total(i) ? null : kind === "up" ? "{V}>=0" : "{V}<0";
    const below = sem[at + 1]?.name.endsWith("(below 0)") ? sem[at + 1] : null;
    sem[at].f = Array.from({ length: n }, (_, i) => { const c = cond(i); if (!c) return null; const [lo, hi] = lohi(i); return `IF({V}="","",IF(${c},IF(${lo}>=0,${hi}-${lo},IF(${hi}<=0,${lo}-${hi},${hi})),""))`; });
    if (below) below.f = Array.from({ length: n }, (_, i) => { const c = cond(i); if (!c) return null; const [lo, hi] = lohi(i); return `IF({V}="","",IF(AND(${c},${lo}<0,${hi}>0),${lo},""))`; });
  }
  return { run, runF };
}
/** the colour a fraction t of the way from a to b (#RRGGBB) */
export function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
  const A = p(a), B = p(b);
  return "#" + A.map((v, k) => Math.round(v + (B[k] - v) * t).toString(16).padStart(2, "0")).join("").toUpperCase();
}
