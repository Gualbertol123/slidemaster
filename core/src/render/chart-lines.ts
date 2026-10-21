/* Lines of a series chart (09 §3.1, §3.2; S14.3, CT-01, CT-05): a series' points → one `path` per run of values (a gap
   – a blank, a text cell, a removed cell, another group's category – breaks the line, as PowerPoint's dispBlanksAs gap),
   straight `L` segments or, smoothed, cubic Béziers from Catmull–Rom with tension ½ (control points p1 + (p2 − p0) / 6
   and p2 − (p3 − p1) / 6, the ends duplicated: what Excel's "smoothed line" draws within a pixel); the stroke round-capped
   and round-joined; and the markers (circle as four cubics, square, diamond, triangle) filled, ringed 1.5 px in the
   background colour. A marker's size is a whole number of points, as PowerPoint stores it (c:marker c:size), so the
   native chart's markers are the slide's. Pure numbers and nodes; chart-series.ts places them. */
import type { Node, PathCmd, Stroke } from "../dl/types";
import type { LineStyle } from "../model/types";
import type { LineSem, MarkerSem } from "../pptx/chart-sem";
import { solid } from "../dl/color";

const r2 = (v: number) => Math.round(v * 100) / 100 || 0;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const KAPPA = .5523;
/** px → pt (pptx/drawingml.ts PT: a 1600 px slide is 960 pt wide) */
const PT = .6;
export type Pt = { x: number; y: number };

/** the runs of consecutive points (null = a gap) */
export function runs<T>(pts: (T | null)[]): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  for (const p of pts) { if (p === null) { if (cur.length) out.push(cur); cur = []; } else cur.push(p); }
  if (cur.length) out.push(cur);
  return out;
}
/** a run of points as path commands: straight, or smoothed (Catmull–Rom → cubic Bézier, ends duplicated) */
export function linePath(p: Pt[], smooth: boolean): PathCmd[] {
  if (!p.length) return [];
  const d: PathCmd[] = [["M", r2(p[0].x), r2(p[0].y)]];
  for (let i = 0; i < p.length - 1; i++) {
    const p1 = p[i], p2 = p[i + 1];
    if (!smooth) { d.push(["L", r2(p2.x), r2(p2.y)]); continue; }
    const p0 = p[i - 1] || p1, p3 = p[i + 2] || p2;
    d.push(["C", r2(p1.x + (p2.x - p0.x) / 6), r2(p1.y + (p2.y - p0.y) / 6), r2(p2.x - (p3.x - p1.x) / 6), r2(p2.y - (p3.y - p1.y) / 6), r2(p2.x), r2(p2.y)]);
  }
  return d;
}
/** the drawn stroke on both sides of point i (its run's neighbours; smoothed as linePath draws it, 8 steps a segment):
    what a label beside the point must not cover (09 §3.1, S14.3 review 9) */
export function strokeNear(pts: (Pt | null)[], i: number, smooth: boolean): Pt[][] {
  const at = (k: number) => k >= 0 && k < pts.length ? pts[k] : null, out: Pt[][] = [];
  for (const k of [i - 1, i]) {
    const p1 = at(k), p2 = at(k + 1);
    if (!p1 || !p2) continue;
    if (!smooth) { out.push([p1, p2]); continue; }
    const p0 = at(k - 1) || p1, p3 = at(k + 2) || p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }, c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    const seg: Pt[] = [];
    for (let j = 0; j <= 8; j++) {
      const t = j / 8, u = 1 - t;
      seg.push({ x: u * u * u * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p2.x, y: u * u * u * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p2.y });
    }
    out.push(seg);
  }
  return out;
}
/** whether a polyline crosses or enters a box (Liang–Barsky per segment) */
export function polyHitsBox(poly: Pt[], b: { x: number; y: number; w: number; h: number }): boolean {
  for (let k = 0; k + 1 < poly.length; k++) {
    const { x: x1, y: y1 } = poly[k], dx = poly[k + 1].x - x1, dy = poly[k + 1].y - y1;
    let t0 = 0, t1 = 1, ok = true;
    for (const [p, q] of [[-dx, x1 - b.x], [dx, b.x + b.w - x1], [-dy, y1 - b.y], [dy, b.y + b.h - y1]]) {
      if (p === 0) { if (q < 0) { ok = false; break; } continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; }
      else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
    }
    if (ok && t0 <= t1) return true;
  }
  return false;
}
/** a line's look: its own colour, weight (0.25–20 px; default 2.5) and dash, else the series' colour */
export function lineStyleOf(st: LineStyle | undefined, color: string, w0 = 2.5): LineSem {
  const w = st && Number.isFinite(+(st.w as number)) && +(st.w as number) > 0 ? Math.max(.25, Math.min(20, +(st.w as number))) : w0;
  const c = st && HEX.test(st.color || "") ? st.color!.toUpperCase() : color;
  const dash = st?.dash === "dashed" ? "dash" : st?.dash === "dotted" ? "sysDot" : st?.dash === "dashdot" ? "dashDot" : undefined;
  return { color: c, w, ...(dash ? { dash } : {}) };
}
/** a LineSem's dash as the display list's pattern: PowerPoint's preset dashes in multiples of the width (dash 4:3, sysDot
    1:1, dashDot 4:3:1:3), so a dashed line looks the same in both */
export function dashOf(l: LineSem): number[] | undefined {
  const w = Math.max(1, l.w);
  return l.dash === "dash" ? [4 * w, 3 * w] : l.dash === "sysDot" ? [w, w] : l.dash === "dashDot" ? [4 * w, 3 * w, w, 3 * w] : undefined;
}
/** a line's stroke (round caps and joins: smoothed lines and markers, 09 §3.1) */
export function lineStroke(l: LineSem, cap: "round" | "butt" = "round"): Stroke {
  const dash = dashOf(l);
  return { w: l.w, paint: solid(l.color), cap, join: "round", ...(dash ? { dash } : {}) };
}

/** a series' marker: none unless the series asks for one (a shape other than "none"); size in px rounded to whole
    points (2–72, PowerPoint's range; default 7 px), fill its own colour or the series', ringed in the background colour */
export function markerOf(mk: { shape?: string; size?: number; color?: string } | undefined, color: string, ring: string): MarkerSem | null {
  if (!mk || typeof mk !== "object") return null;
  const shape = mk.shape === undefined ? "circle" : mk.shape;
  if (shape !== "circle" && shape !== "square" && shape !== "diamond" && shape !== "triangle") return null;
  const px = Number.isFinite(+(mk.size as number)) && +(mk.size as number) > 0 ? +(mk.size as number) : 7;
  return { symbol: shape, size: Math.max(2, Math.min(72, Math.round(px * PT))), color: HEX.test(mk.color || "") ? mk.color!.toUpperCase() : color, ring, w: 1.5 };
}
/** the marker's size on the slide, px */
export const markerPx = (m: MarkerSem) => m.size / PT;
/** a marker centred on (x, y): its path, filled, ringed */
export function markerNode(m: MarkerSem, x: number, y: number, fill: string): Node | null {
  const s = markerPx(m), r = s / 2;
  let d: PathCmd[];
  switch (m.symbol) {
    case "square": d = [["M", x - r, y - r], ["L", x + r, y - r], ["L", x + r, y + r], ["L", x - r, y + r], ["Z"]]; break;
    case "diamond": d = [["M", x, y - r], ["L", x + r, y], ["L", x, y + r], ["L", x - r, y], ["Z"]]; break;
    case "triangle": d = [["M", x, y - r], ["L", x + r, y + r], ["L", x - r, y + r], ["Z"]]; break;
    case "circle": { const k = r * KAPPA; d = [["M", x + r, y], ["C", x + r, y + k, x + k, y + r, x, y + r], ["C", x - k, y + r, x - r, y + k, x - r, y], ["C", x - r, y - k, x - k, y - r, x, y - r], ["C", x + k, y - r, x + r, y - k, x + r, y], ["Z"]]; break; }
    default: return null;
  }
  d = d.map(c => c[0] === "Z" ? c : [c[0], ...c.slice(1).map(v => r2(v as number))] as PathCmd);
  return { t: "path", d, fill: solid(fill), stroke: { w: m.w, paint: solid(m.ring), join: "round" } };
}
