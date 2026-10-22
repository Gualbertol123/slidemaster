/* A series chart's value axis (09 §3.1, §3.2; S14.2, CT-02): Excel's automatic bounds and major unit, ticks, and the
   tick labels' texts. Pure numbers – chart-series.ts places them, and the PowerPoint writer fixes the same min / max /
   unit on its c:valAx, so PowerPoint's axis is this axis.

   Excel's rule (Microsoft's "How Chart Axis Limits Are Determined", the rule Excel 2007–365 still follows for a linear
   axis, checked on its own charts):
   * all values ≥ 0: the minimum is 0 when the spread (max − min) is more than 1/6 of the maximum, else
     min − spread / 2 (rounded down to the major unit); the maximum is max + spread / 20, rounded up to the major unit;
   * all values ≤ 0: the same, mirrored;
   * values of both signs: min − spread / 20 and max + spread / 20, each rounded outwards;
   * the major unit: the smallest 1, 2 or 5 × 10ⁿ that leaves at most `maxN` intervals (Excel's 10 on an ordinary
     chart; fewer when the plot is short, as Excel thins a small chart's axis);
   * one value, or all equal: from 0 to it (or it to 0); all zero: 0 to 1.
   An axis's own min / max / step (ChartAxis) win over each of these. */
import type { ChartAxis } from "../model/types";
import { formatValue } from "../xlsx/numfmt";

export interface Scale { min: number; max: number; step: number }
/** the axis's ticks: min, min + step, …, max (at most 200; a step that does not divide stops before max) */
export function ticks(s: Scale): number[] {
  const out: number[] = [];
  if (!(s.step > 0) || !(s.max > s.min)) return [s.min];
  const n = Math.min(200, Math.floor((s.max - s.min) / s.step + 1e-9));
  for (let k = 0; k <= n; k++) out.push(clean(s.min + k * s.step));
  return out;
}
/** a float rid of its binary noise (0.1 + 0.2 → 0.3) */
const clean = (v: number) => +v.toPrecision(12) || 0;
/** the 1-2-5 candidates from about span / 1000 upwards */
function* steps(span: number): Generator<number> {
  let p = 10 ** Math.floor(Math.log10(span / 1000));
  for (;;) { for (const f of [1, 2, 5]) yield clean(f * p); p *= 10; }
}
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** Excel's automatic scale for values lo…hi, with the axis's own settings over it */
export function autoScale(lo: number, hi: number, opts: { maxN?: number; axis?: ChartAxis; percent?: boolean } = {}): Scale {
  const A = opts.axis || {}, maxN = Math.max(2, Math.min(10, Math.floor(opts.maxN ?? 10)));
  if (!isNum(lo) || !isNum(hi)) { lo = 0; hi = 1; }
  if (lo > hi) [lo, hi] = [hi, lo];
  // 100 %: 0 to 100 % (or −100 % when there are negatives), Excel's tenths
  if (opts.percent) { lo = lo < 0 ? -1 : 0; hi = hi > 0 ? 1 : 0; if (lo === hi) hi = 1; }
  const fixMin = isNum(A.min) ? A.min : null;
  let fixMax = isNum(A.max) ? A.max : null;
  // the range the bounds come from
  let a: number, b: number;
  if (opts.percent) { a = lo; b = hi; }
  else if (lo === hi) { a = Math.min(0, lo); b = Math.max(0, hi); if (a === b) b = 1; }
  else if (lo >= 0) { const sp = hi - lo; a = sp > hi / 6 ? 0 : lo - sp / 2; b = hi + sp / 20; }
  else if (hi <= 0) { const sp = hi - lo; b = sp > -lo / 6 ? 0 : hi + sp / 2; a = lo - sp / 20; }
  else { const sp = hi - lo; a = lo - sp / 20; b = hi + sp / 20; }
  // (B53 review: a max not above the min – both the axis's own, or a max below the automatic minimum – is dropped: the
  // automatic maximum stands, never an axis whose min is above its max, in PowerPoint neither)
  const autoB = b;
  if (fixMin !== null) a = fixMin;
  if (fixMax !== null && !(fixMax > a)) fixMax = null;
  b = fixMax !== null ? fixMax : autoB;
  if (!(b > a)) b = a + (Math.abs(a) || 1);
  if (isNum(A.step) && A.step > 0) {
    const step = A.step;
    return { min: fixMin ?? floorTo(a, step), max: fixMax ?? ceilTo(b, step), step };
  }
  for (const step of steps(b - a)) {
    const min = fixMin ?? floorTo(a, step), max = fixMax ?? ceilTo(b, step);
    if ((max - min) / step <= maxN + 1e-9) return { min, max, step };
  }
  return { min: a, max: b, step: b - a };
}
const floorTo = (v: number, s: number) => clean(Math.floor(v / s + 1e-9) * s);
const ceilTo = (v: number, s: number) => clean(Math.ceil(v / s - 1e-9) * s);
/** a tick's text: the axis's number format, else the values' own (the first number cell's), the workbook's locale */
export function tickText(v: number, fmt: string): string {
  return formatValue({ v, t: "n", fmt: fmt || "General" }).text;
}
/** the number format a value axis shows: its own, else 0 % on a 100 % chart, else the series' first cells' format
    (a format with a date or text part is taken only as General, as Excel's axis does for such sources) */
export function axisFormat(axis: ChartAxis | undefined, percent: boolean, cellFmt: string): string {
  if (axis && typeof axis.num === "string" && axis.num.trim()) return axis.num;
  if (percent) return "0%";
  return cellFmt && !/[dmyhs@]/i.test(cellFmt.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "")) ? cellFmt : "General";
}
