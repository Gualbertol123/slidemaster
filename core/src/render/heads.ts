/* Line ends (docs/next/09 §2.3, §3.4; S14.P – shared by M14's chart marks and M15's lines): a model `Head` at one end of
   a stroke → its geometry in slide px, drawn with the display list's own nodes (ADR-004: a `path`, no new node type).
   Sizes s / m / l = 2 / 3 / 4.5 × the line's weight (at least 6 px long, so a hairline's arrow still shows). Under a
   filled head (triangle, stealth) the line is shortened so the tip is exact and the stroke's butt end does not show past
   it; oval and diamond sit centred on the end, as PowerPoint draws them; "arrow" is an open V of the line's own stroke;
   "bar" (the limiter) a perpendicular tick through the end. PowerPoint writes the same heads natively
   (pptx/drawingml.ts lineEnd / headEnd: a:headEnd / a:tailEnd; the bar as a segment of the line's geometry). Pure. */
import type { Node, Paint, PathCmd, Stroke } from "../dl/types";
import type { Head, Heads } from "../model/types";

type Pt = { x: number; y: number };
export const HEAD_SCALE = { s: 2, m: 3, l: 4.5 } as const;
/** the length of a head along the line, px */
export const headLength = (w: number, size: Heads["size"] = "m") => Math.max(6, HEAD_SCALE[size || "m"] * w);
/** one head's geometry: the path, whether it is filled (else stroked with the line's stroke), and how far the line
    is shortened under it (px along the line from the tip) */
export interface HeadGeom { d: PathCmd[]; filled: boolean; back: number }
const KAPPA = .5523;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** the head `h` with its tip at `tip`, the line arriving from `from` (any point before the tip on the line, or the
    tangent's direction for a curve); null for "none", an unknown head or a line of no length */
export function headGeom(h: Head | undefined, tip: Pt, from: Pt, w: number, size?: Heads["size"]): HeadGeom | null {
  if (!h || h === "none") return null;
  const dx = tip.x - from.x, dy = tip.y - from.y, len = Math.hypot(dx, dy);
  if (!(len > 1e-9) || !(w > 0)) return null;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux, L = headLength(w, size), H = L / 2;
  // a point at `a` px behind the tip along the line and `b` px to its side
  const at = (a: number, b: number): [number, number] => [r2(tip.x - ux * a + nx * b), r2(tip.y - uy * a + ny * b)];
  const P = (c: "M" | "L", a: number, b: number): PathCmd => [c, ...at(a, b)];
  switch (h) {
    case "triangle": return { d: [P("M", 0, 0), P("L", L, H), P("L", L, -H), ["Z"]], filled: true, back: L };
    case "stealth": return { d: [P("M", 0, 0), P("L", L, H), P("L", L * .6, 0), P("L", L, -H), ["Z"]], filled: true, back: L * .6 };
    case "diamond": return { d: [P("M", -H, 0), P("L", 0, H), P("L", H, 0), P("L", 0, -H), ["Z"]], filled: true, back: 0 };
    case "arrow": return { d: [P("M", L, H), P("L", 0, 0), P("L", L, -H)], filled: false, back: 0 };
    case "bar": return { d: [P("M", 0, H), P("L", 0, -H)], filled: false, back: 0 };
    case "oval": {
      // four cubics round the end (centre on the tip), from its far side
      const k = H * KAPPA, C = (a1: number, b1: number, a2: number, b2: number, a3: number, b3: number): PathCmd => ["C", ...at(a1, b1), ...at(a2, b2), ...at(a3, b3)];
      return { d: [P("M", H, 0), C(H, k, k, H, 0, H), C(-k, H, -H, k, -H, 0), C(-H, -k, -k, -H, 0, -H), C(k, -H, H, -k, H, 0), ["Z"]], filled: true, back: 0 };
    }
  }
  return null;
}

/** a straight stroke from a to b with the item's heads: the shortened line's ends and the heads as display-list nodes
    (filled heads in the stroke's colour, open ones with the stroke itself, round-joined) – what a straight line, a chart's
    arrow mark and a range marker draw */
export function headed(a: Pt, b: Pt, stroke: Stroke, heads: Heads | undefined): { a: Pt; b: Pt; nodes: Node[] } {
  const ha = headGeom(heads?.a, a, b, stroke.w, heads?.size), hb = headGeom(heads?.b, b, a, stroke.w, heads?.size);
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  // never shortened past the middle (a line shorter than its heads keeps a stub)
  const ka = Math.min(ha?.back || 0, len / 2), kb = Math.min(hb?.back || 0, len / 2);
  // (a path's stroke is solid – a gradient stroke is a rect's or a line's only: an open head takes the gradient's last stop)
  const fill: Paint = stroke.paint, ink: Paint = "solid" in fill ? fill : (s => ({ solid: s.c, a: s.a }))(("linear" in fill ? fill.stops : fill.radial.stops).slice(-1)[0]);
  const node = (g: HeadGeom): Node => g.filled ? { t: "path", d: g.d, fill } : { t: "path", d: g.d, stroke: { w: stroke.w, paint: ink, cap: "round", join: "round" } };
  return {
    a: { x: r2(a.x + ux * ka), y: r2(a.y + uy * ka) }, b: { x: r2(b.x - ux * kb), y: r2(b.y - uy * kb) },
    nodes: [...(ha ? [node(ha)] : []), ...(hb ? [node(hb)] : [])],
  };
}
