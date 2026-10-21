/* Columns and bars (09 §3.1, §3.2; S14.2, CT-01): clustered, stacked and 100 % – which part of a category's slot each
   series' bar takes (Excel's gap width and overlap), where each bar starts and ends in values, and the design's corner
   radius on its outer end. Pure numbers: chart-series.ts turns them into `rect` nodes, and the PowerPoint writer gives
   its c:barChart the same grouping, gapWidth and overlap, so PowerPoint's bars are these bars. */
import { mix } from "../model/style";

export type StackMode = "none" | "stacked" | "percent";
/** one bar: series s, category i, from → to in axis values (to is the outer end), v the value it shows */
export interface Seg { s: number; i: number; v: number; from: number; to: number; /** the outermost of its stack on its side (the rounded end) */ outer: boolean }
/** the bars of every series (gaps have none), the values the axis must hold, and each category's total (100 %) */
export function stackBars(vals: (number | null)[][], mode: StackMode): { segs: Seg[]; lo: number; hi: number } {
  const segs: Seg[] = [], n = Math.max(0, ...vals.map(v => v.length));
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (mode === "none") {
      vals.forEach((sv, s) => { const v = sv[i]; if (v === null || v === undefined) return; segs.push({ s, i, v, from: 0, to: v, outer: true }); lo = Math.min(lo, v); hi = Math.max(hi, v); });
      continue;
    }
    // stacked: positives up from 0, negatives down from 0, in series order; 100 %: each a share of the category's
    // absolute sum
    const sum = mode === "percent" ? vals.reduce((a, sv) => a + Math.abs(sv[i] ?? 0), 0) : 1;
    let pos = 0, neg = 0;
    const here: Seg[] = [];
    vals.forEach((sv, s) => {
      const v = sv[i]; if (v === null || v === undefined) return;
      const x = mode === "percent" ? (sum ? v / sum : 0) : v;
      if (x >= 0) { here.push({ s, i, v, from: pos, to: pos + x, outer: false }); pos += x; }
      else { here.push({ s, i, v, from: neg, to: neg + x, outer: false }); neg += x; }
    });
    const lastPos = [...here].reverse().find(g => g.to > g.from), lastNeg = [...here].reverse().find(g => g.to < g.from);
    for (const g of here) g.outer = g === lastPos || g === lastNeg;
    segs.push(...here);
    lo = Math.min(lo, neg, 0); hi = Math.max(hi, pos, 0);
  }
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  return { segs, lo, hi };
}
/** Excel's bar width and offsets in a slot of width 1: n bars per category (one per series when clustered, one when
    stacked), gap = the space between clusters in % of a bar (0–500), overlap in % of a bar (−100–100). A slot holds
    w·(n − (n − 1)·o) + g·w */
export function barSlots(n: number, gap: number, overlap: number): { w: number; off: (k: number) => number } {
  const g = Math.max(0, Math.min(500, gap)) / 100, o = Math.max(-100, Math.min(100, overlap)) / 100, k = Math.max(1, n);
  const w = 1 / (k - (k - 1) * o + g);
  return { w, off: j => g * w / 2 + j * w * (1 - o) };
}
/** the defaults: gap 150 %, overlap 0 (clustered) or 100 (stacked: the bars of a category are one bar) */
export function gapOf(v: unknown): number { const n = +(v as number); return Number.isFinite(n) && v !== null && v !== "" ? Math.max(0, Math.min(500, Math.round(n))) : 150; }
export function overlapOf(v: unknown, mode: StackMode): number {
  if (mode !== "none") return 100;
  const n = +(v as number); return Number.isFinite(n) && v !== null && v !== "" ? Math.max(-100, Math.min(100, Math.round(n))) : 0;
}
/** a rectangle's corner radii [tl, tr, br, bl] for a bar whose outer end points up / down / right / left, at most half
    its width and its length */
export function outerRadius(r: number, dir: "up" | "down" | "right" | "left", w: number, h: number): number | [number, number, number, number] {
  const k = Math.max(0, Math.min(r, (dir === "up" || dir === "down" ? w : h) / 2, dir === "up" || dir === "down" ? h : w));
  if (!(k > 0)) return 0;
  return dir === "up" ? [k, k, 0, 0] : dir === "down" ? [0, 0, k, k] : dir === "right" ? [0, k, k, 0] : [k, 0, 0, k];
}
/** a Liquid Glass bar's light stop (its outer end) */
export const lightOf = (c: string) => mix(c, "#FFFFFF", .22);
