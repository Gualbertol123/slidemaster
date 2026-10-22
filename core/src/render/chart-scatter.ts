/* Scatter charts (09 §2.2, §3.1, §4.2; S14.4, CT-01): every series' points at (x, y) on two value axes – the x axis
   numeric, with Excel's automatic bounds and unit (chart-axes.ts, the same rule as a value axis; or `axes.x`'s own min /
   max / step) –, drawn with the line charts' parts (chart-lines.ts): markers (a circle unless the series asks for
   another shape) and, optionally, a line through the points in their order (`line` set, or `smooth`: Catmull–Rom, as a
   smoothed line). Pure numbers; chart-series.ts places them, and the PowerPoint writer gives its c:scatterChart the same
   two c:valAx bounds and units, so PowerPoint's points are these points. */
import type { ChartAxis, ChartSeries } from "../model/types";
import type { MarkerSem } from "../pptx/chart-sem";
import type { SerData } from "./chart-data";
import { autoScale, ticks, tickText, axisFormat, type Scale } from "./chart-axes";
import { markerOf } from "./chart-lines";

/** a scatter series draws a line through its points when it asks for one: a `line` look, or `smooth` */
export const scatterLine = (s: ChartSeries): boolean => s.smooth === true || !!(s.line && typeof s.line === "object");
/** a scatter series' marker: its own (a circle by default); "none" only when a line shows the points instead */
export function scatterMarker(s: ChartSeries, color: string, ring: string): MarkerSem | null {
  const mk = s.marker && typeof s.marker === "object" ? s.marker : {};
  return markerOf(mk, color, ring) ?? (scatterLine(s) ? null : markerOf({ ...mk, shape: "circle" }, color, ring));
}
/** the x values every shown series holds where it also has a y value: what the x axis must hold */
export function xRange(ser: SerData[]): { lo: number; hi: number } {
  let lo = Infinity, hi = -Infinity;
  for (const s of ser) (s.xs || []).forEach((x, i) => { if (x !== null && s.vals[i] !== null) { lo = Math.min(lo, x); hi = Math.max(hi, x); } });
  return Number.isFinite(lo) ? { lo, hi } : { lo: 0, hi: 1 };
}
/** the x axis: its scale (at most as many intervals as labels of `wide` px fit in `w`), ticks and their texts in the
    axis's number format, else the x cells' */
export function xAxisOf(ser: SerData[], A: ChartAxis | undefined, w: number, wide: (fmt: string, s: Scale) => number): { scale: Scale; ticks: { v: number; text: string }[]; num: string } {
  const { lo, hi } = xRange(ser), num = axisFormat(A, false, ser.find(s => s.xs?.some(x => x !== null))?.xFmt || "General");
  // (the labels' width depends on the scale, the scale on how many fit: Excel's 10 intervals first, then fewer)
  let scale = autoScale(lo, hi, { axis: A });
  const room = Math.floor(w / (wide(num, scale) + 16));
  if (room < Math.round((scale.max - scale.min) / (scale.step || 1))) scale = autoScale(lo, hi, { axis: A, maxN: Math.max(2, room) });
  return { scale, ticks: ticks(scale).map(v => ({ v, text: tickText(v, num) })), num };
}
