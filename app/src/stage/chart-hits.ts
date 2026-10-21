/* A series chart's point and mark under the pointer (S14.5; 09 §3.1 "Selection"): the chart's own layer carries a `hit`
   node per value ("point", id "<item>:<series>:<i>") and per mark ("mark", "<item>:<mark>"), in slide px. The stage picks
   the one under the pointer – a mark before a point, the smallest box first – for the panel's per-point and per-mark
   settings. Pure. */
import type { DisplayList, HitNode, Matrix } from "@slide-builder/core/dl/types";

export interface ChartHit { point?: { s: string; i: number }; mark?: string; box: { x: number; y: number; w: number; h: number }; label?: string }
const mul = (a: Matrix, b: Matrix): Matrix => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
/** every point and mark hit of an item's nodes, its box in slide px */
export function chartHits(nodes: DisplayList, item: string, M: Matrix = [1, 0, 0, 1, 0, 0], out: ChartHit[] = []): ChartHit[] {
  for (const n of nodes) {
    if (n.t === "group") { chartHits(n.children, item, n.transform ? mul(M, n.transform) : M, out); continue; }
    if (n.t !== "hit" || (n.kind !== "point" && n.kind !== "mark") || !n.id.startsWith(item + ":")) continue;
    const xs = [n.x, n.x + n.w].map(x => M[0] * x + M[4]), ys = [n.y, n.y + n.h].map(y => M[3] * y + M[5]);
    const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.abs(xs[1] - xs[0]), h: Math.abs(ys[1] - ys[0]) };
    const rest = n.id.slice(item.length + 1);
    out.push(n.kind === "mark" ? { mark: rest, box, ...label(n) } : pointOf(rest, box, n));
  }
  return out;
}
const label = (n: HitNode) => n.label !== undefined ? { label: n.label } : {};
function pointOf(rest: string, box: ChartHit["box"], n: HitNode): ChartHit {
  const k = rest.lastIndexOf(":");
  return { point: { s: rest.slice(0, k), i: +rest.slice(k + 1) }, box, ...label(n) };
}
/** the hit under (x, y): a mark first, then the smallest box */
export function chartHitAt(nodes: DisplayList, item: string, x: number, y: number): ChartHit | null {
  const under = chartHits(nodes, item).filter(h => x >= h.box.x && x <= h.box.x + h.box.w && y >= h.box.y && y <= h.box.y + h.box.h);
  under.sort((a, b) => (a.mark ? 0 : 1) - (b.mark ? 0 : 1) || a.box.w * a.box.h - b.box.w * b.box.h);
  return under[0] ?? null;
}
/** the hit of the selected point or mark (its box: the stage's ring) */
export function selectedHit(nodes: DisplayList, item: string, sel: { point?: { s: string; i: number } | null; mark?: string | null }): ChartHit | null {
  return chartHits(nodes, item).find(h => sel.mark ? h.mark === sel.mark : !!sel.point && !!h.point && h.point.s === sel.point.s && h.point.i === sel.point.i) ?? null;
}
