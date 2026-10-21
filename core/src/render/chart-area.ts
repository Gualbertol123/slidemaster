/* Areas of a series chart (09 §3.1, §3.2; S14.3, CT-01): standard (each area from the axis's zero), stacked (each on the
   series below it, in series order) and 100 % (each a share of the category's absolute sum). A blank breaks the area
   (its band stops at the last value and starts again at the next); in a stack a blank adds nothing to the series above.
   Pure numbers – chart-series.ts turns each run into a closed `path` (fill alpha .85), and the PowerPoint writer gives
   its c:areaChart the same grouping, so PowerPoint's areas are these areas. */
import type { StackMode } from "./chart-bars";

/** a series' band at one category: from `lo` to `hi` in axis values (null = a gap) */
export interface Band { lo: number; hi: number; v: number }
/** each series' bands per category, and the values the axis must hold */
export function stackAreas(vals: (number | null)[][], mode: StackMode): { bands: (Band | null)[][]; lo: number; hi: number } {
  const n = Math.max(0, ...vals.map(v => v.length)), bands: (Band | null)[][] = vals.map(() => []);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (mode === "none") {
      vals.forEach((sv, s) => { const v = sv[i]; if (v === null || v === undefined) { bands[s].push(null); return; } bands[s].push({ lo: 0, hi: v, v }); lo = Math.min(lo, v); hi = Math.max(hi, v); });
      continue;
    }
    const sum = mode === "percent" ? vals.reduce((a, sv) => a + Math.abs(sv[i] ?? 0), 0) : 1;
    let run = 0;
    vals.forEach((sv, s) => {
      const v = sv[i]; if (v === null || v === undefined) { bands[s].push(null); return; }
      const x = mode === "percent" ? (sum ? v / sum : 0) : v;
      bands[s].push({ lo: run, hi: run + x, v }); run += x;
      lo = Math.min(lo, run, 0); hi = Math.max(hi, run, 0);
    });
  }
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  return { bands, lo, hi };
}
