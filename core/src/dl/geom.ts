/* Geometry shared by the three backends, so that the stage, the PNG and the PDF are drawn from the same numbers:
   corner radii, rounded-rectangle outlines, the stepped soft shadows, gradient strokes as rings, picture
   placement (crop, rotation, flips) and text decorations. */
import type { ImageNode, Matrix, Paint, PathCmd, Radii, RGB, RRect, ShadowNode, Stop, Stroke, TextNode } from "./types";

/** a gradient's stops as CSS mixes them: Chromium interpolates CSS gradients in premultiplied colour, canvas, SVG and
    PDF shadings mix colour and alpha apart – so between two stops of different alpha and colour every backend gets
    intermediate stops, mixed premultiplied (white fading into a translucent tint stays white instead of turning grey
    or tinted half-way) */
export function premulStops(stops: Stop[], n = 16): Stop[] {
  const out: Stop[] = [];
  // a fully transparent stop has no colour of its own: it takes its neighbour's (as premultiplied mixing does)
  stops = stops.map((s, i) => s.a > 1e-6 ? s : { ...s, c: (stops[i + 1]?.a ?? 0) > 1e-6 ? stops[i + 1].c : (stops[i - 1]?.a ?? 0) > 1e-6 ? stops[i - 1].c : s.c });
  stops.forEach((s, i) => {
    out.push(s);
    const t = stops[i + 1];
    if (!t || Math.abs(s.a - t.a) < 1e-4 || (s.c[0] === t.c[0] && s.c[1] === t.c[1] && s.c[2] === t.c[2]) || t.o <= s.o) return;
    for (let k = 1; k < n; k++) {
      const u = k / n, a = s.a + (t.a - s.a) * u;
      const c = a > 1e-6 ? s.c.map((v, j) => (v * s.a + (t.c[j] * t.a - v * s.a) * u) / a) as RGB : t.c;
      out.push({ o: s.o + (t.o - s.o) * u, c, a });
    }
  });
  return out;
}

/** the paint a backend draws: a linear gradient whose two points coincide has no direction and is its last stop
    (as CSS draws it) */
export function paintOf(p: Paint): Paint {
  if ("linear" in p && p.linear[0] === p.linear[2] && p.linear[1] === p.linear[3]) {
    const last = p.stops[p.stops.length - 1];
    return { solid: last.c, a: last.a };
  }
  return p;
}

/** the steps of a soft shadow and how far they reach (v3's printcss.ts vectorShadow: STEPS = 5, REACH = .6;
    decision 2026-10-12) */
export const SHADOW_STEPS = 5, SHADOW_REACH = .6;
/** a quarter circle as a cubic: control points at k·r */
const K = 0.5522847498;

/** four corner radii [tl, tr, br, bl], scaled down together when adjacent ones overlap (CSS backgrounds-3 §5.5) */
export function radii(r: Radii | undefined, w: number, h: number): [number, number, number, number] {
  const q: [number, number, number, number] = r === undefined ? [0, 0, 0, 0] : typeof r === "number" ? [r, r, r, r] : [...r];
  for (let i = 0; i < 4; i++) q[i] = Math.max(0, q[i]);
  let f = 1;
  const side = (len: number, a: number, b: number) => { if (a + b > len) f = Math.min(f, len / (a + b)); };
  side(w, q[0], q[1]); side(w, q[3], q[2]); side(h, q[0], q[3]); side(h, q[1], q[2]);
  return f < 1 ? q.map(v => v * f) as typeof q : q;
}
/** the radii of a box grown (s > 0) or shrunk (s < 0) by s on every side, as box-shadow's spread does them:
    a square corner stays square; growing, a radius r < s grows by s·(1 + (r/s − 1)³) (CSS backgrounds-3 §7.1.1) */
export function spreadRadii(q: [number, number, number, number], s: number): [number, number, number, number] {
  return q.map(r => {
    if (r <= 0) return 0;
    if (s <= 0) return Math.max(0, r + s);
    const ratio = r / s;
    return r + (ratio < 1 ? s * (1 + (ratio - 1) ** 3) : s);
  }) as [number, number, number, number];
}

export function isRound(q: number[]) { return q.some(v => v > 0); }
/** the outline of a rounded rectangle, clockwise from the top-left corner's end */
export function rrectPath(x: number, y: number, w: number, h: number, q: [number, number, number, number]): PathCmd[] {
  const [tl, tr, br, bl] = q, X = x + w, Y = y + h;
  if (!isRound(q)) return [["M", x, y], ["L", X, y], ["L", X, Y], ["L", x, Y], ["Z"]];
  const d: PathCmd[] = [["M", x + tl, y], ["L", X - tr, y]];
  if (tr) d.push(["C", X - tr + K * tr, y, X, y + tr - K * tr, X, y + tr]);
  d.push(["L", X, Y - br]);
  if (br) d.push(["C", X, Y - br + K * br, X - br + K * br, Y, X - br, Y]);
  d.push(["L", x + bl, Y]);
  if (bl) d.push(["C", x + bl - K * bl, Y, x, Y - bl + K * bl, x, Y - bl]);
  d.push(["L", x, y + tl]);
  if (tl) d.push(["C", x, y + tl - K * tl, x + tl - K * tl, y, x + tl, y]);
  d.push(["Z"]);
  return d;
}
export const rrectOf = (b: RRect): PathCmd[] => rrectPath(b.x, b.y, b.w, b.h, radii(b.r, b.w, b.h));
/** a box grown by s on every side, radii following the spread rule */
export function grow(b: RRect, s: number, dx = 0, dy = 0): PathCmd[] {
  const q = radii(b.r, b.w, b.h), w = Math.max(0, b.w + 2 * s), h = Math.max(0, b.h + 2 * s);
  return rrectPath(b.x + dx - s, b.y + dy - s, w, h, radii(spreadRadii(q, s), w, h));
}

/** one sharp layer of a stepped shadow: the area to fill and the area it is clipped to (evenodd) */
export interface ShadowLayer { fill: PathCmd[]; clip: PathCmd[]; a: number }
/** a soft shadow as SHADOW_STEPS sharp layers of 1/STEPS strength each (v3's vectorShadow). As CSS box-shadow, an
    outer shadow is drawn outside its box only and an inset one inside it only, so each layer has a clip:
    outer = a frame around the box (evenodd: far rectangle + box), inset = the box */
export function shadowLayers(n: ShadowNode): ShadowLayer[] {
  const out: ShadowLayer[] = [], a = n.a / (n.blur > .5 ? SHADOW_STEPS : 1);
  const steps = n.blur > .5 ? SHADOW_STEPS : 1;
  const far = Math.abs(n.dx) + Math.abs(n.dy) + Math.abs(n.spread) + n.blur + 10;
  const frame = (): PathCmd[] => [...rrectPath(n.x - far, n.y - far, n.w + 2 * far, n.h + 2 * far, [0, 0, 0, 0]), ...rrectOf(n)];
  for (let k = 0; k < steps; k++) {
    const s = steps === 1 ? n.spread : n.spread + n.blur * SHADOW_REACH * ((k + 1) / steps - .5);
    if (!n.inset) {
      if (n.w + 2 * s <= 0 || n.h + 2 * s <= 0) continue;
      out.push({ fill: grow(n, s, n.dx, n.dy), clip: frame(), a });
    } else {
      // inset: the box minus the hole (the box moved by the offset and shrunk by the spread), within the box
      const hole = n.w - 2 * s > 0 && n.h - 2 * s > 0 ? grow(n, -s, n.dx, n.dy) : [];
      out.push({ fill: [...rrectPath(n.x - far, n.y - far, n.w + 2 * far, n.h + 2 * far, [0, 0, 0, 0]), ...hole], clip: rrectOf(n), a });
    }
  }
  return out;
}

/** a gradient stroke of a rect as the ring it covers (evenodd), or of a line as the band it covers */
export function strokeRing(b: RRect, w: number): PathCmd[] {
  const outer = grow(b, w / 2);
  return b.w > w && b.h > w ? [...outer, ...grow(b, -w / 2)] : outer;
}
export function lineBand(x1: number, y1: number, x2: number, y2: number, s: Stroke): PathCmd[] {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len, nx = -uy * s.w / 2, ny = ux * s.w / 2;
  const e = s.cap === "square" || s.cap === "round" ? s.w / 2 : 0;
  const ax = x1 - ux * e, ay = y1 - uy * e, bx = x2 + ux * e, by = y2 + uy * e;
  return [["M", ax + nx, ay + ny], ["L", bx + nx, by + ny], ["L", bx - nx, by - ny], ["L", ax - nx, ay - ny], ["Z"]];
}

/** where a picture is drawn: the transform of its box (rotation and flips about the centre) and the rectangle the
    whole picture covers inside it (crop = the picture grown so that the kept part fills the box, as v3's picHtml) */
export function imagePlacement(n: ImageNode): { m: Matrix | null; full: { x: number; y: number; w: number; h: number } } {
  const c = n.crop, l = c?.l || 0, t = c?.t || 0, r = c?.r || 0, b = c?.b || 0;
  const iw = n.w / Math.max(.01, 1 - l - r), ih = n.h / Math.max(.01, 1 - t - b);
  const full = { x: n.x - l * iw, y: n.y - t * ih, w: iw, h: ih };
  if (!n.rotation && !n.flipH && !n.flipV) return { m: null, full };
  const cx = n.x + n.w / 2, cy = n.y + n.h / 2, a = (n.rotation || 0) * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
  const sx = n.flipH ? -1 : 1, sy = n.flipV ? -1 : 1;
  // translate(c) · rotate(a) · scale(sx, sy) · translate(−c)
  const A = cos * sx, B = sin * sx, C = -sin * sy, D = cos * sy;
  return { m: [A, B, C, D, cx - A * cx - C * cy, cy - B * cx - D * cy], full };
}
export const needsClip = (n: ImageNode) => !!n.crop && (n.crop.l > 0 || n.crop.t > 0 || n.crop.r > 0 || n.crop.b > 0);

/** the x of each character of a shaped run that has one glyph per character (no ligature, no split), else null:
    the screen backends then place each character at the display list's advance, as the PDF places each glyph */
export function charPositions(n: TextNode): number[] | null {
  if (!n.adv || n.dx || n.dy) return null;                       // marks placed on their bases: drawn as one run
  const chars = [...n.src];
  // (one glyph of a shaped run is drawn as the run; one tabular character keeps its advance, to be centred in it)
  if (chars.length !== (n.gids ?? n.adv).length || chars.length !== n.adv.length || chars.length < (n.gids ? 2 : 1)) return null;
  const out: number[] = []; let x = n.x;
  for (const a of n.adv) { out.push(x); x += a; }
  return out;
}

/** underline and strike-through bars of a run: [x, y, w, h] (same fractions of the size in every backend) */
export function decorations(n: TextNode, w: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [], th = Math.max(1, n.size * .06);
  if (n.decoration?.underline) out.push([n.x, n.y + n.size * .08, w, th]);
  if (n.decoration?.strike) out.push([n.x, n.y - n.size * .3, w, th]);
  return out;
}

/** a matrix product: first m2, then m1 */
export const mul = (m1: Matrix, m2: Matrix): Matrix => [
  m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]];
/** the matrix of a paint's unit box (gradients), and of an ellipse of a radial paint within it */
export const boxMatrix = (x: number, y: number, w: number, h: number): Matrix => [w, 0, 0, h, x, y];
export const radialMatrix = (r: { cx: number; cy: number; rx: number; ry: number }): Matrix => [r.rx, 0, 0, r.ry, r.cx, r.cy];

/** the bounding box of a path's points (control points included: enough for gradient boxes of paths) */
export function pathBox(d: PathCmd[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of d) for (let i = 1; i + 1 < c.length; i += 2) {
    const x = c[i] as number, y = c[i + 1] as number;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x0 === Infinity ? { x: 0, y: 0, w: 0, h: 0 } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
