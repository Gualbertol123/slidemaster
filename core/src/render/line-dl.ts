/* Lines and annotations on slides (4.8, M15 S15.3; docs/next/09 §2.3, §3.4, §4.3): a `line` item's display-list nodes,
   with the eight node types only (ADR-004) –
   - routes: straight and range (one `line` node), elbow (a `path` of three segments, the bend at `mid`, `bend` hv / vh),
     curve (one cubic, `mid` its bulge px), bracket (a square bracket, `mid` its depth px: three segments);
   - heads at each end (render/heads.ts: filled ones shorten the stroke so the tip is exact, "bar" the limiter's tick); a
     range marker has bar heads unless it sets its own;
   - the stroke: the item's colour, else the design's ink (a divider – straight, dashed, no heads – the design's rule
     colour); weight 0.5–8 px (default 2); dash; caps butt (round on a plain solid line), joins set (miter on elbows and
     brackets, round on curves);
   - a label at the middle (a range marker's above it), its cells quoted ({Sheet!C7}, as a callout's), on a background
     rect of the slide's ground so it reads across the line; one `hit` of kind "item" over it (its text box in PowerPoint);
   - hits `{kind: "line", id}` along the line: a 12 px band, one box per segment (a curve's by eight chords).
   Where the ends are: `lineEnds` – the item's `a` / `b`, in a free layout this design's (`free[design].items["i:<id>"]`
   a / b; an entry an older page wrote with its box only moves the ends by as much as the box moved), and an attached end
   (`ends.a` / `ends.b`) at that point of its object as it is drawn in this design (a table, a text box, another item) –
   an object that is gone leaves the end at its saved point and gives the Issues line "its end lost its object".
   The PowerPoint export takes the same geometry (`LineSem`): pptx/scene.ts lineEls writes a plain shape (a:prstGeom
   "line" with flips, or an open a:custGeom) with native a:headEnd / a:tailEnd – never a connector – at the resolved
   places. Pure. */
import type { Node, PathCmd, Stroke } from "../dl/types";
import type { Anchor, Box, Head, Heads, LineItem, RuntimeSlide } from "../model/types";
import type { RenderCtx } from "./context";
import type { Metrics } from "./excel-dl";
import { primaryFamily } from "./excel-dl";
import { headGeom, headed, headLength } from "./heads";
import { freeKey, freeOf, itemBoxOf, MEMO_KEY, memoBox, noteKey, SIDES, type TBox } from "./layout";
import { calloutText } from "./shape-dl";
import { parseColor, solid } from "../dl/color";
import { isConsult } from "../model/designs";
import { specOf } from "./consult-spec";
import { deckFmt } from "./text";
import { themeVars } from "./slide";

export type Pt = { x: number; y: number };
const r2 = (v: number) => Math.round(v * 100) / 100 || 0;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const ok = (p: unknown): p is Pt => !!p && typeof p === "object" && [(p as Pt).x, (p as Pt).y].every(v => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 16000);
/** a line's weight px (09 §2.3: 0.5–8, default 2) */
export const lineWeight = (it: Pick<LineItem, "style">) => { const w = it.style?.w; return typeof w === "number" && Number.isFinite(w) ? Math.max(.5, Math.min(8, w)) : 2; };
/** its heads: a range marker's are bars unless it sets its own */
export function headsOf(it: Pick<LineItem, "route" | "style">): Heads {
  const h = it.style?.heads;
  return h && typeof h === "object" ? h : it.route === "range" ? { a: "bar", b: "bar" } : {};
}
const HEADS: Head[] = ["none", "arrow", "triangle", "stealth", "oval", "diamond", "bar"];
const headOk = (h: unknown): Head | undefined => HEADS.includes(h as Head) && h !== "none" ? h as Head : undefined;

/* ---- where the ends are ---- */
/** the bounds of a–b padded to 1 px each side: the `box` item.patch needs (w, h > 0, 09 §2.3) */
export const lineBox = (a: Pt, b: Pt): Box => ({ x: r2(Math.min(a.x, b.x) - 1), y: r2(Math.min(a.y, b.y) - 1), w: r2(Math.abs(b.x - a.x) + 2), h: r2(Math.abs(b.y - a.y) + 2) });
/** the point `at` of a box, moved by dx / dy */
export function anchorPoint(b: Box, at: Anchor["at"], dx = 0, dy = 0): Pt {
  const x = at === "l" || at === "tl" || at === "bl" ? b.x : at === "r" || at === "tr" || at === "br" ? b.x + b.w : b.x + b.w / 2;
  const y = at === "t" || at === "tl" || at === "tr" ? b.y : at === "b" || at === "bl" || at === "br" ? b.y + b.h : b.y + b.h / 2;
  return { x: r2(x + (Number.isFinite(dx) ? dx : 0)), y: r2(y + (Number.isFinite(dy) ? dy : 0)) };
}
export const ANCHOR_AT: Anchor["at"][] = ["tl", "t", "tr", "l", "c", "r", "bl", "b", "br"];
/** the objects of a slide a line's end can attach to, as they are drawn in this design: tables ("t:<id>"), text boxes
    ("n:<key>", the notes section too), the other items ("i:<id>") – never a line (a line follows objects, not lines) */
export function anchorTargets(R: RuntimeSlide, boxes: TBox[], ctx: RenderCtx, self?: string): { to: string; box: Box }[] {
  const out: { to: string; box: Box }[] = [];
  boxes.forEach((b, i) => {
    if (!b) return;
    out.push({ to: freeKey.table(R, i), box: { x: b.x, y: b.y, w: b.w, h: b.h } });
    for (const side of SIDES) { const n = b.notes[side]; if (n) out.push({ to: freeKey.note(noteKey(R, i, side)), box: { x: n.x, y: n.y, w: n.w, h: n.h } }); }
  });
  const memo = R.cfg.notes?.[MEMO_KEY];
  if (memo) out.push({ to: freeKey.note(MEMO_KEY), box: memoBox(memo) });
  for (const [id, it] of Object.entries(R.cfg.items || {})) {
    if (id === self || !it || it.kind === "line") continue;
    const b = itemBoxOf(R, id, boxes, ctx); if (b) out.push({ to: freeKey.item(id), box: b });
  }
  return out;
}
/** the box of the object an anchor names, as drawn in this design; null when it is not on the slide */
function anchorBox(R: RuntimeSlide, to: string, boxes: TBox[], ctx: RenderCtx, self: string): Box | null {
  if (typeof to !== "string") return null;
  if (to.startsWith("t:")) { const i = boxes.findIndex((b, k) => !!b && freeKey.table(R, k) === to); return i >= 0 ? { x: boxes[i].x, y: boxes[i].y, w: boxes[i].w, h: boxes[i].h } : null; }
  if (to.startsWith("n:")) {
    const key = to.slice(2);
    if (key === MEMO_KEY) { const n = R.cfg.notes?.[MEMO_KEY]; return n ? memoBox(n) : null; }
    for (let i = 0; i < boxes.length; i++) for (const side of SIDES) { const n = boxes[i]?.notes[side]; if (n && noteKey(R, i, side) === key) return { x: n.x, y: n.y, w: n.w, h: n.h }; }
    return null;
  }
  if (to.startsWith("i:")) {
    const id = to.slice(2), it = R.cfg.items?.[id];
    if (id === self || !it || it.kind === "line") return null;
    return itemBoxOf(R, id, boxes, ctx);
  }
  return null;
}
/** a line's saved ends in this design: its free-layout entry's a / b when free layout is on (an entry with a box but
    no ends – an older page's switch-on – moves them by as much as its box moved), else the item's own */
export function savedEnds(R: RuntimeSlide, id: string, it: LineItem, ctx: RenderCtx): { a: Pt; b: Pt } | null {
  if (!ok(it.a) || !ok(it.b)) return null;
  const f = freeOf(R, ctx), e = f?.items[freeKey.item(id)] as (Box & { a?: Pt; b?: Pt }) | undefined;
  if (e && typeof e === "object") {
    if (ok(e.a) && ok(e.b)) return { a: { x: e.a.x, y: e.a.y }, b: { x: e.b.x, y: e.b.y } };
    const bx = it.box;
    if ([e.x, e.y].every(v => typeof v === "number" && Number.isFinite(v)) && bx && [bx.x, bx.y].every(v => typeof v === "number" && Number.isFinite(v))) {
      const dx = e.x - bx.x, dy = e.y - bx.y;
      return { a: { x: it.a.x + dx, y: it.a.y + dy }, b: { x: it.b.x + dx, y: it.b.y + dy } };
    }
  }
  return { a: { x: it.a.x, y: it.a.y }, b: { x: it.b.x, y: it.b.y } };
}
export interface Ends { a: Pt; b: Pt; /** the ends whose object is gone (they stay at their saved point) */ lost: ("a" | "b")[];
  /** the ends attached to an object that is there */ attached: ("a" | "b")[] }
/** where a line's ends are drawn in this design: saved, or following the object each is attached to */
export function lineEnds(R: RuntimeSlide, id: string, it: LineItem, boxes: TBox[], ctx: RenderCtx): Ends | null {
  const s = savedEnds(R, id, it, ctx); if (!s) return null;
  const out: Ends = { a: s.a, b: s.b, lost: [], attached: [] };
  for (const k of ["a", "b"] as const) {
    const an = it.ends?.[k]; if (!an || typeof an !== "object") continue;
    const b = anchorBox(R, an.to, boxes, ctx, id);
    if (!b) { out.lost.push(k); continue; }
    out[k] = anchorPoint(b, ANCHOR_AT.includes(an.at) ? an.at : "c", +(an.dx ?? 0), +(an.dy ?? 0));
    out.attached.push(k);
  }
  return out;
}

/* ---- the route ---- */
export interface Route { d: PathCmd[]; /** a point the line leaves a towards / arrives at b from (the tangents) */ fromA: Pt; fromB: Pt;
  /** the middle handle (09 §5.3) */ mid: Pt; /** the label's centre, and which way it is pushed off the line (range, bracket) */ label: Pt; push: Pt | null; straight: boolean }
const same = (p: Pt, q: Pt) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
/** the route from a to b (09 §3.4) */
export function routeOf(it: Pick<LineItem, "route" | "mid" | "bend">, a: Pt, b: Pt): Route {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, M = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const P = (p: Pt): Pt => ({ x: r2(p.x), y: r2(p.y) }), mid = typeof it.mid === "number" && Number.isFinite(it.mid) ? it.mid : null;
  const first = (pts: Pt[]) => pts.find(p => !same(p, pts[0])) ?? pts[pts.length - 1], last = (pts: Pt[]) => [...pts].reverse().find(p => !same(p, pts[pts.length - 1])) ?? pts[0];
  if (it.route === "elbow") {
    const t = mid === null ? .5 : Math.max(0, Math.min(1, mid));
    const pts = it.bend === "vh"
      ? [a, { x: a.x, y: a.y + t * dy }, { x: b.x, y: a.y + t * dy }, b]
      : [a, { x: a.x + t * dx, y: a.y }, { x: a.x + t * dx, y: b.y }, b];
    const ps = pts.map(P), m = { x: (ps[1].x + ps[2].x) / 2, y: (ps[1].y + ps[2].y) / 2 };
    return { d: [["M", ps[0].x, ps[0].y], ...ps.slice(1).map(p => ["L", p.x, p.y] as PathCmd)], fromA: first(ps), fromB: last(ps), mid: P(m), label: P(m), push: null, straight: false };
  }
  if (it.route === "curve") {
    const bulge = mid === null ? len * .25 : Math.max(-4000, Math.min(4000, mid)), c = { x: M.x + nx * 2 * bulge, y: M.y + ny * 2 * bulge };
    const c1 = P({ x: a.x + (c.x - a.x) * 2 / 3, y: a.y + (c.y - a.y) * 2 / 3 }), c2 = P({ x: b.x + (c.x - b.x) * 2 / 3, y: b.y + (c.y - b.y) * 2 / 3 });
    const top = P({ x: M.x + nx * bulge, y: M.y + ny * bulge });
    return { d: [["M", r2(a.x), r2(a.y)], ["C", c1.x, c1.y, c2.x, c2.y, r2(b.x), r2(b.y)]], fromA: same(c1, a) ? P(b) : c1, fromB: same(c2, b) ? P(a) : c2, mid: top, label: top, push: null, straight: false };
  }
  if (it.route === "bracket") {
    const depth = mid === null ? 16 : Math.max(-2000, Math.min(2000, mid));
    const ps = [a, { x: a.x + nx * depth, y: a.y + ny * depth }, { x: b.x + nx * depth, y: b.y + ny * depth }, b].map(P);
    const m = P({ x: M.x + nx * depth, y: M.y + ny * depth });
    return { d: [["M", ps[0].x, ps[0].y], ...ps.slice(1).map(p => ["L", p.x, p.y] as PathCmd)], fromA: first(ps), fromB: last(ps), mid: m, label: m, push: { x: nx * Math.sign(depth || 1), y: ny * Math.sign(depth || 1) }, straight: false };
  }
  // straight and range: a range's label sits above it (a steep one: right of it)
  const up = Math.abs(dx) >= Math.abs(dy) ? { x: 0, y: -1 } : { x: 1, y: 0 };
  return { d: [["M", r2(a.x), r2(a.y)], ["L", r2(b.x), r2(b.y)]], fromA: P(b), fromB: P(a), mid: P(M), label: P(M), push: it.route === "range" ? up : null, straight: true };
}
/** the points of a route for hit bands and bounds (a cubic by eight chords) */
export function routePoints(d: PathCmd[]): Pt[] {
  const out: Pt[] = []; let cur: Pt = { x: 0, y: 0 };
  for (const c of d) {
    if (c[0] === "M" || c[0] === "L") { cur = { x: c[1], y: c[2] }; out.push(cur); }
    else if (c[0] === "C") {
      const p0 = cur;
      for (let k = 1; k <= 8; k++) {
        const t = k / 8, u = 1 - t;
        out.push({ x: u * u * u * p0.x + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * c[5], y: u * u * u * p0.y + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6] });
      }
      cur = { x: c[5], y: c[6] };
    }
  }
  return out;
}
/** the distance from a point to a route (the stage's hit test, slide px) */
export function routeDistance(d: PathCmd[], p: Pt): number {
  const pts = routePoints(d); let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy;
    const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L)) : 0;
    best = Math.min(best, Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy));
  }
  return pts.length === 1 ? Math.hypot(p.x - pts[0].x, p.y - pts[0].y) : best;
}

/* ---- the look ---- */
/** relative luminance of a #RRGGBB colour (WCAG), 0–1 */
export function luminance(hex: string): number {
  const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return .2126 * v[0] + .7152 * v[1] + .0722 * v[2];
}
/** a ground dark enough for white ink (a dark band, Consulting Red's panel, a dark custom slide colour) */
export const darkGround = (hex: string | null | undefined) => !!hex && HEX.test(hex) && luminance(hex) < .18;
/** the line's colour: its own, else the design's ink (09 §3.4) – the colour the text boxes are written in when the deck
    sets one (the theme's text colour: Text format › Text boxes), else Liquid Glass's text colour, Excel's and Clean's
    #404040, the consulting designs' ink; a divider's (straight, dashed or dotted, no heads) the design's rule colour.
    On a dark slide colour (Excel / Clean with a dark custom background) a light ink, so that it shows */
export function lineColor(it: Pick<LineItem, "route" | "style">, ctx: RenderCtx): string {
  const own = it.style?.color;
  if (typeof own === "string" && HEX.test(own)) return own.toUpperCase();
  const h = headsOf(it), divider = it.route === "straight" && !headOk(h.a) && !headOk(h.b) && !!it.style?.dash && it.style.dash !== "solid";
  const d = ctx.style.design, deck = deckFmt(ctx, "note").color, text = typeof deck === "string" && HEX.test(deck) ? deck.toUpperCase() : null;
  if (isConsult(d)) { const C = specOf(ctx); return divider ? (C.bottomRule?.color || "#BFBFBF") : text || (d === "mckinsey" ? "#051C2C" : "#4D4D4D"); }
  if (d === "glass") return divider ? "#9AA1AE" : text || "#0B0D17";
  const bg = themeVars(ctx)["--slidebg"];
  if (darkGround(bg)) return divider ? "#8C8C8C" : text && !darkGround(text) ? text : "#F2F2F2";
  return divider ? "#BFBFBF" : text || "#404040";
}
const DASH = { dashed: (w: number) => [w * 4, w * 3], dotted: (w: number) => [w, w * 2], dashdot: (w: number) => [w * 4, w * 2, w, w * 2] } as const;
/** the stroke of a line item (09 §3.4): weight, colour, dash, caps and joins */
export function lineStroke(it: Pick<LineItem, "route" | "style">, ctx: RenderCtx): Stroke {
  const w = lineWeight(it), h = headsOf(it), dash = it.style?.dash && it.style.dash !== "solid" && it.style.dash in DASH ? DASH[it.style.dash](w) : undefined;
  const plain = !headOk(h.a) && !headOk(h.b) && !dash;
  return { w, paint: solid(lineColor(it, ctx)), ...(dash ? { dash } : {}), cap: plain ? "round" : "butt", join: it.route === "curve" ? "round" : "miter" };
}
/** the ground behind a label (it reads across the line): the colour under its centre (slide-dl.ts gives it: the slide's
    background, a consulting design's dark band or message panel); none (Liquid Glass, over its wallpaper) a white chip */
function groundOf(given: string | null | undefined): { color: string; a: number; r: number } {
  return given && HEX.test(given) ? { color: given, a: 1, r: 0 } : { color: "#FFFFFF", a: .85, r: 6 };
}

/* ---- the nodes ---- */
/** what the PowerPoint export writes of a line (pptx/scene.ts lineEls): the route unshortened (PowerPoint draws its own
    heads on it), the stroke, the native ends, the limiter's ticks, the label's nodes */
export interface LineSem { route: PathCmd[]; straight: boolean; a: Pt; b: Pt; stroke: Stroke;
  /** native ends: a:headEnd on a (the path's first point), a:tailEnd on b */ head: Head | null; tail: Head | null; size: Heads["size"] | null;
  /** the limiter's ticks ("bar" heads), each a segment */ bars: PathCmd[][]; label: Node[] }
export interface LineDL { nodes: Node[]; issue: string | null; /** the bounds of what is drawn (the stage's layer) */ box: Box; sem: LineSem | null }
export interface LineEnv { family: string; m: Metrics;
  /** the colour under a label: one for the slide, or the colour at a point (slide-dl.ts groundAt); null: a white chip (Liquid Glass) */
  ground?: string | null | ((p: Pt) => string | null) }
/** a line item at its resolved ends → its nodes (stroke, heads, label, hits) */
export function lineNodes(it: LineItem, id: string, ends: Ends | null, ctx: RenderCtx, env: LineEnv): LineDL {
  if (!ends) return { nodes: [], issue: "its ends are not on the slide (no numbers)", box: it.box, sem: null };
  const { a, b } = ends, R = routeOf(it, a, b), st = lineStroke(it, ctx), h = headsOf(it), size = h.size && h.size in { s: 1, m: 1, l: 1 } ? h.size : undefined;
  const ha = headOk(h.a), hb = headOk(h.b), nodes: Node[] = [];
  // the stroke, shortened under filled heads; the heads
  let d = R.d, headNodes: Node[] = [];
  if (R.straight) {
    const s = headed(a, b, st, { a: ha, b: hb, size });
    nodes.push({ t: "line", x1: s.a.x, y1: s.a.y, x2: s.b.x, y2: s.b.y, stroke: st });
    headNodes = s.nodes;
  } else {
    const ga = headGeom(ha, a, R.fromA, st.w, size), gb = headGeom(hb, b, R.fromB, st.w, size);
    d = shorten(R.d, ga?.back || 0, gb?.back || 0);
    nodes.push({ t: "path", d, stroke: st });
    const ink = st.paint;
    for (const g of [ga, gb]) if (g) headNodes.push(g.filled ? { t: "path", d: g.d, fill: ink } : { t: "path", d: g.d, stroke: { w: st.w, paint: ink, cap: "round", join: "round" } });
  }
  nodes.push(...headNodes);
  // hits along the line: a 12 px band (at least the weight and its heads), one axis-aligned box per segment – coarse on a
  // long diagonal (its box covers the whole rectangle): the stage hit-tests a line by its SVG stroke (stage/lines.tsx),
  // and snapping takes a line's ends and middle (stage/drags.ts snapTargets), never these boxes
  const pts = routePoints(R.d), band = Math.max(6, st.w / 2 + 2, ha || hb ? headLength(st.w, size) / 2 : 0);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], q = pts[i];
    nodes.push({ t: "hit", kind: "line", id, x: r2(Math.min(p.x, q.x) - band), y: r2(Math.min(p.y, q.y) - band), w: r2(Math.abs(q.x - p.x) + 2 * band), h: r2(Math.abs(q.y - p.y) + 2 * band) });
  }
  // the label
  const ref = typeof it.text === "string" && it.text.trim() ? calloutText(it.text, ctx) : null, label: Node[] = [];
  if (ref && ref.text.trim()) label.push(...labelNodes(it, id, ref.text, R, st, env));
  nodes.push(...label);
  // the bounds of everything drawn (routes, heads, label), for the stage's layer
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const p of pts) add(p.x, p.y);
  for (const n of [...headNodes, ...label]) if (n.t === "path") for (const c of n.d) { if (c[0] === "M" || c[0] === "L") add(c[1], c[2]); else if (c[0] === "C") { add(c[1], c[2]); add(c[3], c[4]); add(c[5], c[6]); } } else if (n.t === "rect") { add(n.x, n.y); add(n.x + n.w, n.y + n.h); }
  const pad = Math.max(6, st.w);
  const box = { x: r2(x0 - pad), y: r2(y0 - pad), w: r2(x1 - x0 + 2 * pad), h: r2(y1 - y0 + 2 * pad) };
  const issue = ends.lost.length === 2 ? "both its ends lost their objects" : ends.lost.length ? "its end lost its object" : ref?.missing.length ? `the cell ${ref.missing[0]} cannot be read (shown as #REF)` : null;
  const bars = ([[h.a, a, R.fromA], [h.b, b, R.fromB]] as const).filter(([x]) => x === "bar").map(([, tip, from]) => headGeom("bar", tip, from, st.w, size)!.d);
  const sem: LineSem = { route: R.d, straight: R.straight, a, b, stroke: st, head: ha && ha !== "bar" ? ha : null, tail: hb && hb !== "bar" ? hb : null, size: size ?? null, bars, label };
  return { nodes, issue, box, sem };
}
/** a path's first and last segments shortened by ka / kb px (under a filled head), never past their middle */
function shorten(d: PathCmd[], ka: number, kb: number): PathCmd[] {
  if (!(ka > 0) && !(kb > 0)) return d;
  const out = d.map(c => c.slice() as PathCmd);
  const move = (p: [number, number], q: [number, number], k: number): [number, number] => { const L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (!(L > 0)) return p; const t = Math.min(k, L / 2) / L; return [r2(p[0] + (q[0] - p[0]) * t), r2(p[1] + (q[1] - p[1]) * t)]; };
  // the end points of the segments (a cubic: its control points first), so that a segment of no length – an elbow bent
  // at an end (mid 0 or 1) – is passed over: the stroke goes back under the head along the first segment that has one
  const pts = out.flatMap((c): [number, number][] => c[0] === "M" || c[0] === "L" ? [[c[1], c[2]]] : c[0] === "C" ? [[c[1], c[2]], [c[3], c[4]], [c[5], c[6]]] : []);
  const away = (p: [number, number], list: [number, number][]) => list.find(q => Math.abs(q[0] - p[0]) > 1e-6 || Math.abs(q[1] - p[1]) > 1e-6) ?? p;
  if (ka > 0 && out.length > 1 && out[0][0] === "M") {
    const s = out[0] as ["M", number, number], [x, y] = move([s[1], s[2]], away([s[1], s[2]], pts.slice(1)), ka);
    // a first segment of no length moves with its start (the bend stays a corner)
    const n = out[1];
    if ((n[0] === "L") && Math.abs(n[1] - s[1]) < 1e-6 && Math.abs(n[2] - s[2]) < 1e-6) out[1] = ["L", x, y];
    out[0] = ["M", x, y];
  }
  if (kb > 0 && out.length > 1) {
    const e = out[out.length - 1];
    if (e[0] === "L" || e[0] === "C") {
      const tip: [number, number] = e[0] === "L" ? [e[1], e[2]] : [e[5], e[6]], [x, y] = move(tip, away(tip, pts.slice(0, -1).reverse()), kb);
      const p = out[out.length - 2];
      if (e[0] === "L" && p[0] === "L" && Math.abs(p[1] - tip[0]) < 1e-6 && Math.abs(p[2] - tip[1]) < 1e-6) out[out.length - 2] = ["L", x, y];
      out[out.length - 1] = e[0] === "L" ? ["L", x, y] : ["C", e[1], e[2], e[3], e[4], x, y];
    }
  }
  return out;
}
/** the label: its lines (wrapped at 320 px) centred on the route's middle – a range's above it, a bracket's beyond its
    spine – on a rect of the slide's ground; its hit (kind "item", the text) first, as a text box's */
function labelNodes(it: LineItem, id: string, text: string, R: Route, st: Stroke, env: LineEnv): Node[] {
  const f = it.fmt || {}, size = typeof f.size === "number" && f.size > 0 ? Math.max(8, Math.min(72, f.size)) : 16;
  const weight = f.b ? 700 : 400, italic = !!f.i, family = typeof f.font === "string" && f.font ? `"${f.font}",${env.family}` : env.family;
  const font = `${italic ? "italic " : ""}${weight} ${size}px ${family}`;
  const ink0 = "solid" in st.paint ? "#" + st.paint.solid.map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase() : "#404040";
  const lines = text.split("\n").flatMap(p => p.trim() ? env.m.lines(p, font, 320) : [""]).slice(0, 6);
  const runs = lines.map(l => ({ l, r: env.m.run(l, font) })), lh = Math.round(size * 1.25);
  const W = Math.max(1, ...runs.map(x => x.r.w)), H = lh * lines.length, padX = 6, padY = 2;
  // the box's centre: on the middle, or pushed off the line by half the box and the stroke (a range, a bracket)
  const off = R.push ? (Math.abs(R.push.x) * (W / 2 + padX) + Math.abs(R.push.y) * (H / 2 + padY)) + st.w + 4 : 0;
  const cx = R.label.x + (R.push?.x ?? 0) * off, cy = R.label.y + (R.push?.y ?? 0) * off;
  const under = typeof env.ground === "function" ? env.ground({ x: cx, y: cy }) : env.ground;
  const bx = r2(cx - W / 2 - padX), by = r2(cy - H / 2 - padY), bw = r2(W + 2 * padX), bh = r2(H + 2 * padY), g = groundOf(under);
  // the text in its own colour, else the line's – white where the line's ink would not read on a dark ground
  const ink = typeof f.color === "string" && HEX.test(f.color) ? f.color : darkGround(under) && darkGround(ink0) ? "#FFFFFF" : ink0;
  const align = f.align === "left" ? "left" : f.align === "right" ? "right" : "center";
  const out: Node[] = [{ t: "rect", x: bx, y: by, w: bw, h: bh, ...(g.r ? { r: g.r } : {}), fill: { solid: parseColor(g.color).c, ...(g.a < 1 ? { a: g.a } : {}) } },
    { t: "hit", kind: "item", id, x: bx, y: by, w: bw, h: bh, label: lines.join("\n") }];
  runs.forEach(({ l, r }, k) => {
    if (!l) return;
    const x = align === "left" ? cx - W / 2 : align === "right" ? cx + W / 2 - r.w : cx - r.w / 2;
    const base = cy - H / 2 + k * lh + Math.floor((lh - (r.asc + r.desc)) / 2) + r.asc;
    out.push({ t: "text", font: primaryFamily(family) || "Arial", css: family, weight, ...(italic ? { i: true } : {}), size, x: r2(x), y: r2(base), src: l, w: r2(r.w), fill: solid(ink) });
  });
  return out;
}
