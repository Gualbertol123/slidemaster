/* Snapping (4.8, M15 S15.4; docs/next/09 §5, F8; SN-01…SN-04): where a dragged object lines up. Pure, no DOM: the stage
   (app/src/stage/drags.ts, stage/lines.tsx) collects the targets once at pointer-down and asks per animation frame.
   - Targets (§5.1), on the current slide in the current design: the slide's edges (0 / 1600, 0 / 900) and centre lines
     (800 / 450), the content margins (50 / 1550, the content area's top, the footer line 822); every other object's
     box – left, centre, right; top, middle, bottom; a table's column and row borders (its cells); a line's ends and
     middle. Kept as two arrays sorted by position (x and y), each entry with its kind.
   - Per frame (§5.2): a binary search per moving edge / centre finds the nearest target within `tol` (SNAP = 8 px on
     screen: `snapTol(scale)` = 8 / scale slide px); equal spacing scans the moving box's row (column) neighbours and
     snaps it to make its gaps equal to its neighbours' gap; a resize can snap to another object's width / height
     ("same size as").
   - The answer carries what the stage draws (never exported, a DOM overlay): every matched line (centre matches
     dashed), the equal gaps as dimension markers with their size in px, the equal sizes.
   The caller rounds what it drops with `snapRound` (layout.ts) and previews that same rounded value (09 §2.6). */
import { SLIDE_H, SLIDE_W, snapRound } from "./layout";

export type SnapKind = "slide" | "centre" | "margin" | "edge" | "middle" | "cell" | "line";
export interface SnapTarget { v: number; kind: SnapKind }
export interface SnapBox { x: number; y: number; w: number; h: number }
export interface SnapTargets {
  /** sorted by v */ x: SnapTarget[];
  /** sorted by v */ y: SnapTarget[];
  /** the other objects' boxes (equal spacing, equal size) */ boxes: SnapBox[];
  /** their widths and heights, sorted (equal size) */ ws: number[]; hs: number[];
}
/** a matched line across the slide (`axis` v: x = at; h: y = at); `centre`: a centre / middle line took part (dashed) */
export interface SnapGuide { axis: "v" | "h"; at: number; centre: boolean }
/** an equal gap: from → to along `axis` (x: horizontal gap), drawn at `at` across it; `px` its size */
export interface SnapGap { axis: "x" | "y"; from: number; to: number; at: number; px: number }
/** an equal size: a box whose width (`w`) or height (`h`) is the same – the matching object's and the moving one's */
export interface SnapSize { axis: "w" | "h"; box: SnapBox; px: number }
export interface SnapMarks { guides: SnapGuide[]; gaps: SnapGap[]; sizes: SnapSize[] }
export const NO_MARKS: SnapMarks = { guides: [], gaps: [], sizes: [] };

/** 09 §5.1: 8 px on screen */
export const SNAP_PX = 8;
/** the snapping distance in slide px at the stage's scale (screen px per slide px): a zoomed-in drag snaps finer */
export const snapTol = (scale: number) => SNAP_PX / (scale > 0 && Number.isFinite(scale) ? scale : 1);
/** how close a drawn edge counts as on a target for its guide (a dropped position is on 1/4 px: half of that, and a hair) */
const ON = 0.13;

const ok = (v: number) => typeof v === "number" && Number.isFinite(v);
const okBox = (b: SnapBox | null | undefined): b is SnapBox => !!b && ok(b.x) && ok(b.y) && ok(b.w) && ok(b.h) && b.w >= 0 && b.h >= 0;
const byV = (a: SnapTarget, b: SnapTarget) => a.v - b.v;

/** the targets of one drag (§5.1), collected once at pointer-down. `boxes`: the other objects' boxes as drawn; `cells`:
    the other tables' column (x) and row (y) borders in slide px; `points`: the other lines' ends and middles; `top`: the
    content area's top (the margins are the design's) */
export function snapTargets(o: { boxes?: (SnapBox | null | undefined)[]; cells?: { x: number[]; y: number[] }[]; points?: { x: number; y: number }[]; top?: number | null }): SnapTargets {
  const x: SnapTarget[] = [{ v: 0, kind: "slide" }, { v: SLIDE_W, kind: "slide" }, { v: SLIDE_W / 2, kind: "centre" }, { v: 50, kind: "margin" }, { v: SLIDE_W - 50, kind: "margin" }];
  const y: SnapTarget[] = [{ v: 0, kind: "slide" }, { v: SLIDE_H, kind: "slide" }, { v: SLIDE_H / 2, kind: "centre" }, { v: 822, kind: "margin" }];
  if (o.top != null && ok(o.top)) y.push({ v: o.top, kind: "margin" });
  const boxes = (o.boxes || []).filter(okBox);
  for (const b of boxes) {
    x.push({ v: b.x, kind: "edge" }, { v: b.x + b.w / 2, kind: "middle" }, { v: b.x + b.w, kind: "edge" });
    y.push({ v: b.y, kind: "edge" }, { v: b.y + b.h / 2, kind: "middle" }, { v: b.y + b.h, kind: "edge" });
  }
  for (const c of o.cells || []) { for (const v of c.x) if (ok(v)) x.push({ v, kind: "cell" }); for (const v of c.y) if (ok(v)) y.push({ v, kind: "cell" }); }
  for (const p of o.points || []) if (p && ok(p.x) && ok(p.y)) { x.push({ v: p.x, kind: "line" }); y.push({ v: p.y, kind: "line" }); }
  x.sort(byV); y.sort(byV);
  return { x, y, boxes, ws: boxes.map(b => b.w).filter(w => w > 0).sort((a, b) => a - b), hs: boxes.map(b => b.h).filter(h => h > 0).sort((a, b) => a - b) };
}

/** the first index whose value is ≥ v (a sorted array of numbers or of targets) */
function lower<T>(list: T[], v: number, at: (t: T) => number): number {
  let lo = 0, hi = list.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (at(list[m]) < v) lo = m + 1; else hi = m; }
  return lo;
}
const tv = (t: SnapTarget) => t.v, nv = (n: number) => n;
/** the nearest value of a sorted list within tol of v: its offset d (value − v), or null */
function nearestIn<T>(list: T[], v: number, tol: number, at: (t: T) => number): { d: number; t: T } | null {
  const i = lower(list, v, at);
  let best: { d: number; t: T } | null = null;
  for (const k of [i - 1, i]) {
    if (k < 0 || k >= list.length) continue;
    const d = at(list[k]) - v;
    if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t: list[k] };
  }
  return best;
}
/** the nearest target to any of `edges` within tol: how far to move (d) and the line (09 §5.2: one binary search each) */
export function snapAxis(list: SnapTarget[], edges: number[], tol: number): { d: number; line: number; edge: number } | null {
  let best: { d: number; line: number; edge: number } | null = null;
  edges.forEach((e, k) => { if (!ok(e)) return; const n = nearestIn(list, e, tol, tv); if (n && (!best || Math.abs(n.d) < Math.abs(best.d))) best = { d: n.d, line: n.t.v, edge: k }; });
  return best;
}
/** a size within tol of another object's (equal size): the change d and that size */
export function snapSize(sizes: number[], size: number, tol: number): { d: number; px: number } | null {
  const n = nearestIn(sizes, size, tol, nv);
  return n ? { d: n.d, px: n.t } : null;
}

/** the guides of a box as drawn (`which` of its lines: l c r for x, t m b for y – a resize only its moving edges) */
export function guidesOf(T: SnapTargets, box: SnapBox, which: { x?: ("l" | "c" | "r")[]; y?: ("t" | "m" | "b")[] } = { x: ["l", "c", "r"], y: ["t", "m", "b"] }): SnapGuide[] {
  const out: SnapGuide[] = [];
  const scan = (list: SnapTarget[], v: number, mid: boolean, axis: "v" | "h") => {
    let centre = mid, hit = false;
    for (let i = lower(list, v - ON, tv); i < list.length && list[i].v <= v + ON; i++) { hit = true; if (list[i].kind === "centre" || list[i].kind === "middle") centre = true; }
    if (hit && !out.some(g => g.axis === axis && Math.abs(g.at - v) <= ON)) out.push({ axis, at: v, centre });
  };
  for (const k of which.x || []) scan(T.x, k === "l" ? box.x : k === "c" ? box.x + box.w / 2 : box.x + box.w, k === "c", "v");
  for (const k of which.y || []) scan(T.y, k === "t" ? box.y : k === "m" ? box.y + box.h / 2 : box.y + box.h, k === "m", "h");
  return out;
}

/* ---- equal spacing (§5.1): the moving box's neighbours on its row (overlapping it vertically) or column */
interface Spacing { d: number; gaps: SnapGap[] }
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0);
/** along x (`horiz`) or y: the nearest position within tol that makes the box's gap equal to its neighbours' gap –
    between two neighbours (both gaps equal), or beyond a pair (the pair's gap repeated) */
export function snapSpacing(T: SnapTargets, box: SnapBox, tol: number, horiz: boolean): Spacing | null {
  const p0 = horiz ? box.x : box.y, s = horiz ? box.w : box.h, c0 = horiz ? box.y : box.x, cs = horiz ? box.h : box.w;
  const lo = (b: SnapBox) => horiz ? b.x : b.y, hi = (b: SnapBox) => horiz ? b.x + b.w : b.y + b.h;
  const clo = (b: SnapBox) => horiz ? b.y : b.x, chi = (b: SnapBox) => horiz ? b.y + b.h : b.x + b.w;
  // the row: boxes overlapping the moving box across the axis; before it (ending left of its centre) and after it
  const row = T.boxes.filter(b => overlap(clo(b), chi(b), c0, c0 + cs) > 0);
  const mid = p0 + s / 2;
  const before = row.filter(b => hi(b) <= mid && hi(b) <= p0 + tol).sort((a, b) => hi(b) - hi(a));
  const after = row.filter(b => lo(b) >= mid && lo(b) >= p0 + s - tol).sort((a, b) => lo(a) - lo(b));
  const at = (a: SnapBox, b: SnapBox) => { const l = Math.max(clo(a), clo(b)), r = Math.min(chi(a), chi(b)); return r >= l ? (l + r) / 2 : (Math.max(chi(a), chi(b)) + Math.min(clo(a), clo(b))) / 2; };
  const gap = (from: number, to: number, a: SnapBox, b: SnapBox): SnapGap => ({ axis: horiz ? "x" : "y", from, to, at: at(a, b), px: Math.round((to - from) * 4) / 4 });
  const moved = (p: number): SnapBox => horiz ? { ...box, x: p } : { ...box, y: p };
  const cands: Spacing[] = [];
  const L = before[0], R = after[0];
  // between its two nearest neighbours: both gaps equal
  if (L && R) {
    const g = (lo(R) - hi(L) - s) / 2;
    if (g >= 0) { const p = hi(L) + g, m = moved(p); cands.push({ d: p - p0, gaps: [gap(hi(L), p, L, m), gap(p + s, lo(R), m, R)] }); }
  }
  // beyond a pair on the left (L2 … L … box): the pair's gap repeated
  if (L) {
    const L2 = before.find(b => hi(b) <= lo(L) && overlap(clo(b), chi(b), clo(L), chi(L)) > 0);
    if (L2) { const g = lo(L) - hi(L2), p = hi(L) + g, m = moved(p); if (g >= 0) cands.push({ d: p - p0, gaps: [gap(hi(L2), lo(L), L2, L), gap(hi(L), p, L, m)] }); }
  }
  // before a pair on the right (box … R … R2)
  if (R) {
    const R2 = after.find(b => lo(b) >= hi(R) && overlap(clo(b), chi(b), clo(R), chi(R)) > 0);
    if (R2) { const g = lo(R2) - hi(R), p = lo(R) - g - s, m = moved(p); if (g >= 0) cands.push({ d: p - p0, gaps: [gap(p + s, lo(R), m, R), gap(hi(R), lo(R2), R, R2)] }); }
  }
  let best: Spacing | null = null;
  for (const c of cands) if (Math.abs(c.d) <= tol && (!best || Math.abs(c.d) < Math.abs(best.d))) best = c;
  return best;
}

/** a moved box (09 §5.1 / §5.2): its left / centre / right edges and top / middle / bottom snapped to the nearest target
    within tol, or its gaps made equal to its neighbours' (whichever is nearer); its position on 1/4 px (snapRound);
    `bound`: the moved box must stay in it (the slide: a snap that would take it out is not taken). The marks to draw
    for where it lands */
export function snapMove(T: SnapTargets, box: SnapBox, tol: number, bound: SnapBox | null = { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H }): { box: SnapBox; marks: SnapMarks } {
  const inside = (b: SnapBox) => !bound || (b.x >= bound.x - 1e-9 && b.y >= bound.y - 1e-9 && b.x + b.w <= bound.x + bound.w + 1e-9 && b.y + b.h <= bound.y + bound.h + 1e-9);
  let out = { ...box }, gaps: SnapGap[] = [];
  for (const horiz of [true, false]) {
    const p = horiz ? out.x : out.y, s = horiz ? out.w : out.h;
    const e = snapAxis(horiz ? T.x : T.y, [p, p + s / 2, p + s], tol), q = snapSpacing(T, out, tol, horiz);
    const spaced = !!q && (!e || Math.abs(q.d) < Math.abs(e.d)), d = spaced ? q!.d : e ? e.d : 0;
    // on 1/4 px (09 §2.6): what is drawn is what is dropped
    const next = horiz ? { ...out, x: snapRound(p + d) } : { ...out, y: snapRound(p + d) };
    if (!inside(next)) continue;
    out = next;
    if (spaced) gaps = gaps.concat(q!.gaps);
  }
  return { box: out, marks: { guides: guidesOf(T, out), gaps, sizes: [] } };
}

/** the marks of a box that was not snapped (none) or whose edges a resize moved: `x` / `y` its moving edges' guides, and
    its equal sizes – exact matches of the box's width / height with another object's */
export function resizeMarks(T: SnapTargets, box: SnapBox, which: { x?: ("l" | "c" | "r")[]; y?: ("t" | "m" | "b")[] }, sizes: { w?: boolean; h?: boolean } = {}): SnapMarks {
  const out: SnapSize[] = [];
  // (the matching object's marker and the moving one's)
  if (sizes.w) { const b = T.boxes.find(o => Math.abs(o.w - box.w) <= ON); if (b) out.push({ axis: "w", box: b, px: snapRound(b.w) }, { axis: "w", box, px: snapRound(box.w) }); }
  if (sizes.h) { const b = T.boxes.find(o => Math.abs(o.h - box.h) <= ON); if (b) out.push({ axis: "h", box: b, px: snapRound(b.h) }, { axis: "h", box, px: snapRound(box.h) }); }
  return { guides: guidesOf(T, box, which), gaps: [], sizes: out };
}

/** a moving edge (a resize): the nearest target, or the size that equals another object's (`size`: the edge's box size
    now, `sign`: +1 when the edge moving forward grows it) – the edge's change d, or 0 */
export function snapEdge(T: SnapTargets, horiz: boolean, pos: number, tol: number, size?: { now: number; sign: 1 | -1 }): number {
  const e = snapAxis(horiz ? T.x : T.y, [pos], tol);
  const z = size ? snapSize(horiz ? T.ws : T.hs, size.now, tol) : null;
  const dz = z ? z.d * size!.sign : null;
  if (dz !== null && (!e || Math.abs(dz) < Math.abs(e.d))) return dz;
  return e ? e.d : 0;
}

/** a point (a line's end, 09 §5.3): x and y each to the nearest target within tol; the guides it lands on */
export function snapPoint(T: SnapTargets, p: { x: number; y: number }, tol: number): { p: { x: number; y: number }; marks: SnapMarks } {
  const ex = snapAxis(T.x, [p.x], tol), ey = snapAxis(T.y, [p.y], tol);
  const q = { x: p.x + (ex ? ex.d : 0), y: p.y + (ey ? ey.d : 0) };
  return { p: q, marks: { guides: guidesOf(T, { x: q.x, y: q.y, w: 0, h: 0 }, { x: ["l"], y: ["t"] }), gaps: [], sizes: [] } };
}
