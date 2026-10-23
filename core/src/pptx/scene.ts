/* A slide's display list → a native PowerPoint scene (docs/next/07 §4, B21; the product owner's 2026-10-19 rule:
   "standardised and lean – no bulk images, no connections, use tables"). Pure: no XML here (drawingml.ts writes it).
   The display list stays the truth for geometry: every element of the scene is where its nodes are drawn.
   - Tables: a "tw" hit and its group become one group of the table's own shapes (cards, capsules, bars) around a real
     table (`a:tbl`): its grid from the cells' hit boxes (kind "t"), cell texts as paragraphs of runs, cell fills from the
     solid rectangles that cover a cell, borders from the lines (and thin separators) on its edges. A text that would not
     fit its cell in PowerPoint (it overflows, turns or is taller than its row) stays a text box over the table.
   - Texts: the runs of an element (the last hit before them whose box holds them: a title, a text box, a page number)
     become one text box of paragraphs (the hit's label tells the paragraphs from the wrapped lines); runs with no such
     hit are text boxes of their own. A title's decorative copy becomes its run's shadow.
   - Everything else is a native shape: rect → rect / roundRect, a path → ellipse, rect or a custom geometry, a line →
     a line shape (never a connector), a picture → `p:pic` (a clip becomes its geometry and crop: Liquid Glass's frosted
     surfaces are the one blurred wallpaper, cropped, under their tints), shadows → the shape's outer / inner shadow
     (a sharp one is a shape of its own). Gradients are DrawingML gradients, alpha included.
   - Items (charts, callouts; the core's `sem.items`): a chart is its card plus a native chart frame; a callout's shape
     becomes a preset geometry holding its text. */
import type { DisplayList, Matrix, Node, Paint, PathCmd, RGB, Stop, Stroke } from "../dl/types";
import type { Heads } from "../model/types";
import type { LineSem } from "../render/line-dl";
import { mul, pathBox, radii, rrectPath } from "../dl/geom";
import type { ChartSem } from "./chart-sem";
export type { ChartSem, FontSem } from "./chart-sem";
import { overlayEls } from "./chart-overlay";   // M14 (S14.6): a chart's arrow marks with native ends, in the overlay's order

/* ---- the scene ---- */
export interface Box { x: number; y: number; w: number; h: number }
/** a native line end (DrawingML a:headEnd at the path's first point, a:tailEnd at its last; 09 §4.3): its type and size */
export interface LineEnd { type: "triangle" | "stealth" | "diamond" | "oval" | "arrow"; size?: "s" | "m" | "l" }
/** a stroke: width px, paint, dash pattern px, cap, join (S14.P), native ends (S14.P: lines and chart marks; never a
    connector shape) */
export interface Line { w: number; paint: Paint; dash?: number[]; cap?: "butt" | "round" | "square"; join?: "miter" | "round" | "bevel"; head?: LineEnd; tail?: LineEnd }
/** an outer or inner shadow: offset, blur px, colour and alpha; sx / sy: the shadow's size against the shape's (spread) */
export interface Shadow { dx: number; dy: number; blur: number; c: RGB; a: number; sx?: number; sy?: number }
export type Geom = { prst: string; adj?: Record<string, number> } | { path: PathCmd[]; open?: boolean;
  /** (S15.2, icons) the same outline as several a:path of one custGeom, each filled and / or stroked: an outline icon's
      open strokes beside its filled dots in one shape. `path` is their concatenation */ parts?: GeomPart[] };
export interface GeomPart { d: PathCmd[]; fill: boolean; stroke: boolean }
export type Placeholder = "title" | "ctrTitle" | "subTitle" | "body" | "ftr" | "sldNum";
export interface ShapeEl { k: "sp"; box: Box; rot?: number; flipH?: boolean; flipV?: boolean; geom: Geom; fill?: Paint | null; line?: Line | null;
  outer?: Shadow; inner?: Shadow; text?: TextBody; name?: string; ph?: Placeholder;
  /** a line segment (line nodes; border candidates in tables) */ seg?: [number, number, number, number]; /** drawn for a sharp shadow */ fromShadow?: boolean;
  /** Excel's data bar / icon in a table cell (S16.4: a "cf" hit before it, render/cf-dl.ts) */ cf?: "bar" | "icon" }
export interface PicEl { k: "pic"; box: Box; rot?: number; flipH?: boolean; flipV?: boolean; image: string; crop?: Crop; geom?: Geom; alpha?: number; outer?: Shadow; name?: string }
export interface Crop { l: number; t: number; r: number; b: number }
export interface TextBody { paras: Para[]; anchor: "t" | "ctr" | "b"; ins: [number, number, number, number]; wrap: boolean }
/** a paragraph: its lines (each a list of runs), alignment, line pitch px (exact spacing), space before px; a bulleted
    paragraph (B48 review, 2: the Excel designs' text-box bullets) its native bullet – level 1 a filled square, level 2
    an outline one, in its colour – with the text's left margin and the bullet's (negative) indent from it, px */
export interface Para { align: "l" | "ctr" | "r"; runs: Run[]; pitch: number; before: number; bu?: { level: 1 | 2; c: RGB; a: number }; marL?: number; indent?: number }
export interface Run { text: string; css: string; size: number; b: boolean; i: boolean; color: RGB; a: number; ls?: number; u?: boolean; s?: boolean;
  /** superscript (+) / subscript (−), % of the size */ baseline?: number; shadow?: Shadow; /** a soft line break before this run */ br?: boolean }
export interface Cell { text?: TextBody; fill?: Paint | null; l?: Line | null; r?: Line | null; t?: Line | null; b?: Line | null; span?: [number, number]; merged?: boolean;
  /** cell margins px [l, t, r, b] and anchor */ mar?: [number, number, number, number]; anchor?: "t" | "ctr" | "b" }
export interface TableEl { k: "tbl"; box: Box; cols: number[]; rows: number[]; cells: Cell[][]; name?: string }
export interface ChartEl { k: "chart"; box: Box; chart: ChartSem; name?: string }
export interface GroupEl { k: "grp"; children: El[]; name?: string }
export type El = ShapeEl | PicEl | TableEl | ChartEl | GroupEl;

/* ---- what the core says of a slide besides its display list (SlideList.sem, kind "pptx") ---- */
export type ItemSem =
  /** a chart: its card, the native chart (chart-sem.ts), and (4.7, M14) what is drawn over it – marks, dividers, the
      title rule – as plain shapes in the chart's group, never pictures */
  | { kind: "chart"; at: [number, number]; card: DisplayList; chart: ChartSem; overlay?: DisplayList }
  | { kind: "shape"; at: [number, number]; shape: string; box: Box; tail?: { x: number; y: number } | null; radius: number;
      /** a Tabler icon (4.8, S15.2): written as custom geometry from its paths, never a picture (iconEls) */ icon?: "tabler" | "tabler-filled" }
  /** a line (4.8, M15; 09 §4.3): its heads, written as native a:headEnd / a:tailEnd (no connector shape); `line` (S15.3)
      its geometry at the resolved ends, its stroke and its label's nodes (render/line-dl.ts LineSem) */
  | { kind: "line"; at: [number, number]; heads: Heads | null; line?: LineSem }
  /** a KPI card (B54, 4.13): its shapes and text boxes, grouped */
  | { kind: "kpi"; at: [number, number] };
export interface SlideSem { type: "cover" | "index" | "content"; items: Record<string, ItemSem>; /** the design's chart / accent colours */ palette: string[];
  /** the top-level nodes [start, end) the slide's layout carries, never the slide (B48 review, 3: the Excel designs' logo
      and cover band – on the layout even when the deck has one slide of that kind) */
  layout?: [number, number] }

/* ---- walking the display list ---- */
type Clip = { box: Box; r: number } | { path: PathCmd[]; box: Box };
interface Ctx { M: Matrix; alpha: number; clip: Clip | null }
interface Owner { n: number; kind: string; id: string; box: Box; label: string }
interface TRun { text: string; css: string; size: number; b: boolean; i: boolean; color: RGB; a: number; ls: number; u: boolean; s: boolean;
  x: number; y: number; w: number; rot: number; decorative: boolean }
type Prim =
  | { p: "el"; el: El }
  | { p: "text"; run: TRun; owner: Owner | null }
  | { p: "hit"; owner: Owner }
  /** a paragraph's bullet (a "bu" hit and the path after it): the paragraph's own bullet in PowerPoint */
  | { p: "bullet"; owner: Owner | null; bu: Bullet; el: El }
  | { p: "shadow"; box: Box; r: number; dx: number; dy: number; blur: number; spread: number; c: RGB; a: number; inset: boolean };

/** a bullet drawn in the display list (a hit of kind "bu", id "1" / "2", then its path): its level, box and colour */
interface Bullet { level: 1 | 2; box: Box; c: RGB; a: number }

const ID: Matrix = [1, 0, 0, 1, 0, 0];
const OWNERS = new Set(["f", "t", "tbox", "item"]);
const r2 = (v: number) => Math.round(v * 100) / 100;
const near = (a: number, b: number, e: number) => Math.abs(a - b) <= e;
const boxNear = (a: Box, b: Box, e: number) => near(a.x, b.x, e) && near(a.y, b.y, e) && near(a.x + a.w, b.x + b.w, e) && near(a.y + a.h, b.y + b.h, e);
const inside = (a: Box, b: Box, e = .5) => a.x >= b.x - e && a.y >= b.y - e && a.x + a.w <= b.x + b.w + e && a.y + a.h <= b.y + b.h + e;
const apply = (M: Matrix, x: number, y: number): [number, number] => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
/** the matrix's scale along x and y, its rotation (degrees clockwise) and whether it mirrors */
function decompose(M: Matrix) {
  const sx = Math.hypot(M[0], M[1]), det = M[0] * M[3] - M[1] * M[2], sy = sx ? det / sx : Math.hypot(M[2], M[3]);
  return { sx, sy: Math.abs(sy), rot: Math.atan2(M[1], M[0]) * 180 / Math.PI, flip: det < 0 };
}
const axisAligned = (M: Matrix) => Math.abs(M[1]) < 1e-9 && Math.abs(M[2]) < 1e-9 && M[0] > 0 && M[3] > 0;
/** a box under an axis-aligned matrix */
const mapBox = (M: Matrix, b: Box): Box => ({ x: M[0] * b.x + M[4], y: M[3] * b.y + M[5], w: M[0] * b.w, h: M[3] * b.h });
const mapPath = (M: Matrix, d: PathCmd[]): PathCmd[] => d.map(c => {
  if (c[0] === "Z") return c;
  if (c[0] === "C") { const [a, b] = apply(M, c[1], c[2]), [e, f] = apply(M, c[3], c[4]), [g, h] = apply(M, c[5], c[6]); return ["C", a, b, e, f, g, h]; }
  const [x, y] = apply(M, c[1], c[2]); return [c[0], x, y];
});
function mulPaint(p: Paint, k: number): Paint {
  if (k >= 1) return p;
  if ("solid" in p) return { solid: p.solid, a: (p.a ?? 1) * k };
  if ("linear" in p) return { linear: p.linear, stops: p.stops.map(s => ({ ...s, a: s.a * k })) };
  return { radial: { ...p.radial, stops: p.radial.stops.map(s => ({ ...s, a: s.a * k })) } };
}
/** a display-list stroke under a scale and an alpha: its line (width, dash, cap, join) */
const lineOf = (st: Stroke, s: number, alpha: number): Line => ({ w: st.w * s, paint: mulPaint(st.paint, alpha), ...(st.dash ? { dash: st.dash.map(v => v * s) } : {}),
  ...(st.cap ? { cap: st.cap } : {}), ...(st.join ? { join: st.join } : {}) });
const paintAlpha = (p: Paint) => "solid" in p ? p.a ?? 1 : ("linear" in p ? p.stops : p.radial.stops).reduce((m, s) => Math.max(m, s.a), 0);
/** the most visible colour of a paint (a gradient's strongest stop) */
function mainColour(p: Paint): { c: RGB; a: number } {
  if ("solid" in p) return { c: p.solid, a: p.a ?? 1 };
  const stops: Stop[] = "linear" in p ? p.stops : p.radial.stops;
  const s = stops.reduce((m, x) => x.a > m.a ? x : m, stops[0]);
  return { c: s.c, a: s.a };
}

/** a path's simplest preset: an ellipse (four cubics round a box) or an axis-aligned rectangle; else null */
function presetOf(d: PathCmd[]): { prst: string; box: Box } | null {
  const b = pathBox(d);
  const pts = d.filter(c => c[0] !== "Z");
  if (d.length === 6 && d[0][0] === "M" && d.slice(1, 5).every(c => c[0] === "C") && d[5][0] === "Z") {
    // on-curve points at the four mid-sides
    const on = [d[0], ...d.slice(1, 5)].map(c => c[0] === "M" ? [c[1], c[2]] : [(c as number[])[5], (c as number[])[6]]);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, e = Math.max(.6, (b.w + b.h) * .004);
    const mids = [[cx, b.y], [b.x + b.w, cy], [cx, b.y + b.h], [b.x, cy]];
    if (on.slice(0, 4).every(p => mids.some(m => near(p[0] as number, m[0], e) && near(p[1] as number, m[1], e)))) return { prst: "ellipse", box: b };
  }
  if (pts.length >= 4 && pts.length <= 5 && pts.every(c => c[0] === "M" || c[0] === "L") && d[d.length - 1][0] === "Z") {
    const xs = new Set(pts.map(c => r2(c[1] as number))), ys = new Set(pts.map(c => r2(c[2] as number)));
    if (xs.size === 2 && ys.size === 2) return { prst: "rect", box: b };
  }
  return null;
}
/** a rounded rectangle's preset: roundRect with its radius (adj: radius against the shorter side, 50 000 = half) */
function rectGeom(w: number, h: number, q: [number, number, number, number]): Geom {
  if (q.every(v => v <= .05)) return { prst: "rect" };
  if (q.every(v => near(v, q[0], .05))) return { prst: "roundRect", adj: { adj: Math.round(Math.min(50000, q[0] / Math.max(.01, Math.min(w, h)) * 100000)) } };
  return { path: rrectPath(0, 0, w, h, q) };
}

/** the display list's nodes → primitives in drawing order (shapes, text runs, hits, shadows) */
class Walker {
  prims: Prim[] = [];
  /** with `split`: the primitives of the nodes `sem.layout` names (the layout's) */
  fixed: Prim[] = [];
  private owner: Owner | null = null;
  /** the next shape is a data bar's / an icon's (S16.4) */
  private cfMark: "bar" | "icon" | null = null;
  private seq = 0;
  /** a "bu" hit seen: the next path is that bullet's square */
  private bullet: 1 | 2 | null = null;
  constructor(private readonly sem: SlideSem | null, private readonly images: (id: string) => boolean, private readonly split = false) {}

  walk(nodes: DisplayList, c: Ctx, top = false) {
    const L = top && this.split ? this.sem?.layout : undefined;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (L && i >= L[0] && i < L[1]) { this.fixed.push(...this.sub(() => this.node(n, c))); continue; }
      // an item of the slide (chart, callout): its run of nodes as one element
      const item = top && this.sem ? Object.entries(this.sem.items).find(([, it]) => it.at[0] === i && it.at[1] > i) : undefined;
      if (item) { this.item(item[0], item[1], nodes.slice(i, item[1].at[1]), c); i = item[1].at[1] - 1; continue; }
      // a table: its hit, then its group
      if (n.t === "hit" && n.id === "tw" && nodes[i + 1]?.t === "group") { this.table(nodes[i + 1] as Extract<Node, { t: "group" }>, c); i++; continue; }
      this.node(n, c);
    }
  }
  private sub(f: () => void): Prim[] {
    const keep = this.prims, own = this.owner;
    this.prims = []; this.owner = null;
    try { f(); return this.prims; } finally { this.prims = keep; this.owner = own; }
  }
  private table(g: Extract<Node, { t: "group" }>, c: Ctx) {
    const prims = this.sub(() => this.node(g, c));
    this.prims.push({ p: "el", el: { k: "grp", name: "Table", children: buildTable(prims) } });
  }
  private item(id: string, it: ItemSem, nodes: DisplayList, c: Ctx) {
    if (it.kind === "chart") {
      const prims = this.sub(() => this.walk(it.card, c));
      const card = assemble(prims);
      // over the native chart: its overlay's shapes (lines with native heads, icons, texts), in the chart's group
      const over = overlayEls(it.overlay || [], it.chart, ns => assemble(this.sub(() => this.walk(ns, c))));
      this.prims.push({ p: "el", el: { k: "grp", name: "Chart " + id, children: [...card, { k: "chart", box: it.chart.box, chart: it.chart, name: "Chart" }, ...over] } });
      return;
    }
    if (it.kind === "shape" && it.icon) { this.prims.push(...iconEls(nodes, c).map(el => ({ p: "el" as const, el }))); return; }
    // a line (S15.3): its own shape from its geometry, its label (background and text box) walked alone
    if (it.kind === "line" && it.line) { this.prims.push(...lineEls(it.line, assemble(this.sub(() => this.walk(it.line!.label, c)))).map(el => ({ p: "el" as const, el }))); return; }
    const prims = this.sub(() => this.walk(nodes, c));
    // a KPI card (B54): each text its own text box where it is drawn (title, value, each change and label), never one
    // box reflowing them all under the card's hit
    if (it.kind === "kpi") for (const p of prims) if (p.p === "text") p.owner = null;
    // (a line's member without its geometry – S14.P's – : its nodes' shapes, grouped)
    const els = it.kind === "line" ? group(assemble(prims), "Line") : it.kind === "kpi" ? group(assemble(prims), "KPI card") : callout(assemble(prims), it);
    this.prims.push(...els.map(el => ({ p: "el" as const, el })));
  }

  node(n: Node, c: Ctx) {
    // (S16.4) a "cf" hit marks the shapes of the node after it as a data bar or an icon of a table cell
    if (n.t === "hit" && n.kind === "cf") { this.cfMark = n.id === "icon" ? "icon" : "bar"; return; }
    const mark = n.t !== "hit" && n.t !== "group" ? this.cfMark : null, k = this.prims.length;
    if (mark) this.cfMark = null;
    this.node0(n, c);
    if (mark) for (let i = k; i < this.prims.length; i++) { const p = this.prims[i]; if (p.p === "el" && p.el.k === "sp") p.el.cf = mark; }
  }
  private node0(n: Node, c: Ctx) {
    switch (n.t) {
      case "hit": {
        // a paragraph's bullet (slide-dl.ts, the Excel designs' text boxes; only in the PowerPoint export's lists)
        if (n.kind === "bu") { this.bullet = n.id === "2" ? 2 : 1; return; }
        const o: Owner = { n: this.seq++, kind: n.kind, id: n.id, box: this.boxOf(n, c.M), label: n.label ?? "" };
        if (OWNERS.has(n.kind) && n.id !== "tw") this.owner = o;
        if (n.kind === "t") this.prims.push({ p: "hit", owner: o });
        return;
      }
      case "group": {
        const M = n.transform ? mul(c.M, n.transform) : c.M;
        let clip = c.clip;
        if (n.clip) {
          if ("d" in n.clip) { const d = mapPath(M, n.clip.d); clip = { path: d, box: pathBox(d) }; }
          else if (axisAligned(M)) clip = { box: mapBox(M, n.clip), r: typeof n.clip.r === "number" ? n.clip.r * M[0] : Array.isArray(n.clip.r) ? n.clip.r[0] * M[0] : 0 };
        }
        const k = n.alpha ?? 1;
        for (const ch of n.children) this.node(ch, { M, alpha: c.alpha * k, clip });
        return;
      }
      case "rect": return this.rect(n, c);
      case "path": return this.path(n, c);
      case "line": {
        const [x1, y1] = apply(c.M, n.x1, n.y1), [x2, y2] = apply(c.M, n.x2, n.y2), s = decompose(c.M).sx;
        const x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
        const line = lineOf(n.stroke, s, c.alpha);
        this.prims.push({ p: "el", el: { k: "sp", box: { x, y, w, h }, geom: { path: [["M", x1 - x, y1 - y], ["L", x2 - x, y2 - y]], open: true }, fill: null, line, seg: [x1, y1, x2, y2] } });
        return;
      }
      case "image": return this.image(n, c);
      case "shadow": {
        if (n.a <= 0) return;
        const s = decompose(c.M).sx, box = axisAligned(c.M) ? mapBox(c.M, n) : this.boxOf(n, c.M);
        const r = (typeof n.r === "number" ? n.r : Array.isArray(n.r) ? n.r[0] : 0) * s;
        const sh = { box, r, dx: n.dx * s, dy: n.dy * s, blur: n.blur * s, spread: n.spread * s, c: n.c, a: n.a * c.alpha, inset: !!n.inset };
        if (!sh.inset && sh.blur <= .01) {
          // a sharp shadow is a shape: the box moved and grown by the spread
          const b = { x: box.x + sh.dx - sh.spread, y: box.y + sh.dy - sh.spread, w: box.w + 2 * sh.spread, h: box.h + 2 * sh.spread };
          if (b.w > 0 && b.h > 0) this.prims.push({ p: "el", el: { k: "sp", box: b, geom: rectGeom(b.w, b.h, [0, 0, 0, 0].map(() => Math.max(0, r + sh.spread)) as [number, number, number, number]), fill: { solid: n.c, a: sh.a }, fromShadow: true } });
          return;
        }
        this.prims.push({ p: "shadow", ...sh });
        return;
      }
      case "text": {
        if (!n.src) return;
        const { sx, rot } = decompose(c.M), [x, y] = apply(c.M, n.x, n.y), f = n.fill;
        const col = "solid" in f ? f : { solid: [0, 0, 0] as RGB, a: 1 };
        const weight = n.weight ?? (n.b ? 700 : 400);
        this.prims.push({ p: "text", owner: this.ownerOf(x, y, n.size * sx, (n.w ?? 0) * sx, rot), run: {
          text: n.src, css: n.css || n.font, size: n.size * sx, b: weight >= 600, i: !!n.i, color: col.solid, a: (col.a ?? 1) * c.alpha, ls: (n.ls || 0) * sx,
          u: !!n.decoration?.underline, s: !!n.decoration?.strike, x, y, w: (n.w ?? n.src.length * n.size * .5) * sx, rot, decorative: !!n.decorative } });
        return;
      }
    }
  }
  /** the element a run belongs to: the last hit whose box holds the run's middle (a little leeway); else none */
  private ownerOf(x: number, y: number, size: number, w: number, rot: number): Owner | null {
    const o = this.owner;
    if (!o || Math.abs(rot) > .01) return null;
    const mx = x + w / 2, my = y - size * .35, e = Math.max(3, size * .5);
    return mx >= o.box.x - e && mx <= o.box.x + o.box.w + e && my >= o.box.y - e && my <= o.box.y + o.box.h + e ? o : null;
  }
  private boxOf(b: Box, M: Matrix): Box {
    if (axisAligned(M)) return mapBox(M, b);
    const pts = [apply(M, b.x, b.y), apply(M, b.x + b.w, b.y), apply(M, b.x, b.y + b.h), apply(M, b.x + b.w, b.y + b.h)];
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  /** a box under any matrix: the box's centre mapped, its sides scaled, the rotation (and mirroring) of the matrix */
  private placed(b: Box, M: Matrix): { box: Box; rot?: number; flipV?: boolean } {
    if (axisAligned(M)) return { box: mapBox(M, b) };
    const { sx, sy, rot, flip } = decompose(M), [cx, cy] = apply(M, b.x + b.w / 2, b.y + b.h / 2), w = b.w * sx, h = b.h * sy;
    return { box: { x: cx - w / 2, y: cy - h / 2, w, h }, ...(Math.abs(rot) > .01 ? { rot: ((rot % 360) + 360) % 360 } : {}), ...(flip ? { flipV: true } : {}) };
  }

  private rect(n: Extract<Node, { t: "rect" }>, c: Ctx) {
    if (!n.fill && !n.stroke) return;
    if ((n.w <= 0 || n.h <= 0) && !n.stroke) return;
    const s = decompose(c.M).sx;
    let { box, rot, flipV } = this.placed(n, c.M);
    let q = radii(n.r, n.w, n.h).map(v => v * s) as [number, number, number, number];
    const cl = c.clip;
    if (cl && !rot && "r" in cl) {
      // a fill of the whole clip takes the clip's corners (glass surfaces: tint, sheens); a rectangle beyond a square clip is cut
      if (boxNear(box, cl.box, .75) && q.every(v => v <= .05)) { box = cl.box; q = [cl.r, cl.r, cl.r, cl.r]; }
      else if (!cl.r && !inside(box, cl.box) && q.every(v => v <= .05)) {
        const x0 = Math.max(box.x, cl.box.x), y0 = Math.max(box.y, cl.box.y), x1 = Math.min(box.x + box.w, cl.box.x + cl.box.w), y1 = Math.min(box.y + box.h, cl.box.y + cl.box.h);
        if (x1 <= x0 || y1 <= y0) return;
        box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
    } else if (cl && !rot && "path" in cl && boxNear(box, cl.box, .75) && q.every(v => v <= .05)) {
      // a fill of a path's clip (a disc): the clip's outline
      const pre = presetOf(cl.path);
      this.prims.push({ p: "el", el: { k: "sp", box: cl.box, geom: pre ? { prst: pre.prst } : { path: cl.path.map(p => shiftCmd(p, -cl.box.x, -cl.box.y)) }, fill: n.fill ? mulPaint(n.fill, c.alpha) : null, line: null } });
      return;
    }
    const line: Line | null = n.stroke ? lineOf(n.stroke, s, c.alpha) : null;
    const el: ShapeEl = { k: "sp", box, ...(rot ? { rot } : {}), ...(flipV ? { flipV } : {}), geom: rectGeom(box.w, box.h, q), fill: n.fill ? mulPaint(n.fill, c.alpha) : null, line };
    // a highlight line along the top of the shape just drawn (a Liquid Glass capsule's border-top): that shape's inner
    // shadow, not a shape of its own – a table of capsules is not twice as many shapes
    const prev = this.prims[this.prims.length - 1];
    if (hairline(el) && prev?.p === "el" && prev.el.k === "sp" && !prev.el.inner && !prev.el.text && near(prev.el.box.x, box.x, .6) && near(prev.el.box.y, box.y, .6)
      && near(prev.el.box.w, box.w, .6) && prev.el.box.h > 3 * box.h) {
      const f = el.fill as { solid: RGB; a?: number };
      prev.el.inner = { dx: 0, dy: box.h, blur: 0, c: f.solid, a: f.a ?? 1 };
      return;
    }
    this.prims.push({ p: "el", el });
  }
  private path(n: Extract<Node, { t: "path" }>, c: Ctx) {
    const d = mapPath(c.M, n.d), b = pathBox(d), s = decompose(c.M).sx;
    if (b.w <= 0 && b.h <= 0) return;
    const pre = presetOf(d);
    const line: Line | null = n.stroke ? lineOf(n.stroke, s, c.alpha) : null;
    const el: ShapeEl = { k: "sp", box: b, geom: pre ? { prst: pre.prst } : { path: d.map(p => shiftCmd(p, -b.x, -b.y)) }, fill: n.fill ? mulPaint(n.fill, c.alpha) : null, line };
    const level = this.bullet;
    this.bullet = null;
    if (level) {
      // the square of a bullet: its paragraph's bullet, in the colour it is drawn in (the shape stays only if no text box takes it)
      const { c: col, a } = mainColour(n.fill ? mulPaint(n.fill, c.alpha) : mulPaint(n.stroke!.paint, c.alpha));
      this.prims.push({ p: "bullet", owner: this.owner, bu: { level, box: b, c: col, a }, el });
      return;
    }
    this.prims.push({ p: "el", el });
  }
  private image(n: Extract<Node, { t: "image" }>, c: Ctx) {
    if (n.w <= 0 || n.h <= 0 || !this.images(n.id)) return;
    let { box, rot, flipV } = this.placed(n, c.M);
    rot = (rot || 0) + (n.rotation || 0);
    const flipH = !!n.flipH, fv = !!flipV !== !!n.flipV;
    let crop: Crop = { l: n.crop?.l || 0, t: n.crop?.t || 0, r: n.crop?.r || 0, b: n.crop?.b || 0 };
    let geom: Geom | undefined;
    const cl = c.clip;
    if (cl && !rot && !inside(box, cl.box, .75)) {
      // the clip is the picture's window: its outline the geometry, the parts outside it cropped away (glass surfaces)
      const W = cl.box, fw = box.w / Math.max(.01, 1 - crop.l - crop.r), fh = box.h / Math.max(.01, 1 - crop.t - crop.b);
      const fx = box.x - crop.l * fw, fy = box.y - crop.t * fh;
      crop = { l: (W.x - fx) / fw, t: (W.y - fy) / fh, r: (fx + fw - W.x - W.w) / fw, b: (fy + fh - W.y - W.h) / fh };
      box = W;
      if ("r" in cl) { if (cl.r > .05) geom = { prst: "roundRect", adj: { adj: Math.round(Math.min(50000, cl.r / Math.max(.01, Math.min(W.w, W.h)) * 100000)) } }; }
      else { const pre = presetOf(cl.path); geom = pre ? { prst: pre.prst } : { path: cl.path.map(p => shiftCmd(p, -W.x, -W.y)) }; }
    } else if (cl && !rot && "path" in cl && boxNear(box, cl.box, 1.5)) {
      const pre = presetOf(cl.path); geom = pre ? { prst: pre.prst } : { path: cl.path.map(p => shiftCmd(p, -cl.box.x, -cl.box.y)) };
    }
    const anyCrop = crop.l || crop.t || crop.r || crop.b;
    const alpha = (n.alpha ?? 1) * c.alpha;
    this.prims.push({ p: "el", el: { k: "pic", box, ...(rot ? { rot: ((rot % 360) + 360) % 360 } : {}), ...(flipH ? { flipH } : {}), ...(fv ? { flipV: true } : {}), image: n.id,
      ...(anyCrop ? { crop } : {}), ...(geom ? { geom } : {}), ...(alpha < 1 ? { alpha } : {}),
      // a keyed picture's drop shadow (a picture of its own on screen): PowerPoint's shadow of the picture
      ...(n.shadow ? { outer: { dx: 0, dy: 4, blur: 10, c: [20, 30, 60] as RGB, a: .3 } } : {}) } });
  }
}
const shiftCmd = (c: PathCmd, dx: number, dy: number): PathCmd => c[0] === "Z" ? c : c[0] === "C" ? ["C", c[1] + dx, c[2] + dy, c[3] + dx, c[4] + dy, c[5] + dx, c[6] + dy] : [c[0], c[1] + dx, c[2] + dy];

/* ---- text boxes ---- */
/** where PowerPoint 16 puts the baseline in a line of exact spacing S (measured, the same for Segoe UI, Arial, Century
    Gothic, Georgia and Calibri): 0.75 S from the line's top, but S − 0.225 em while S is 0.9–1.2 em */
export function baselineIn(S: number, size: number): number {
  const k = S / Math.max(.01, size);
  return k > .9 && k < 1.195 ? S - .225 * size : .75 * S;
}

/** runs (absolute, upright) → lines by baseline, each sorted along x, with the spaces between runs put back */
function linesOf(runs: TRun[]): { y: number; runs: TRun[]; x0: number; x1: number; size: number }[] {
  const sorted = [...runs].sort((a, b) => a.y - b.y || a.x - b.x), lines: { y: number; runs: TRun[]; x0: number; x1: number; size: number }[] = [];
  for (const r of sorted) {
    const l = lines.find(L => Math.abs(L.y - r.y) <= .36 * Math.max(L.size, r.size) && !(r.x < L.x1 - .5 && r.x + r.w > L.x0 + .5 && Math.abs(L.y - r.y) > .05 * r.size));
    if (l) { l.runs.push(r); l.x0 = Math.min(l.x0, r.x); l.x1 = Math.max(l.x1, r.x + r.w); if (r.size > l.size) { l.size = r.size; l.y = r.y; } }
    else lines.push({ y: r.y, runs: [r], x0: r.x, x1: r.x + r.w, size: r.size });
  }
  for (const l of lines) l.runs.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => a.y - b.y);
}
const toRun = (r: TRun, lineY: number, lineSize: number): Run => {
  const off = r.y - lineY, sup = off < -.12 * lineSize ? 30 : off > .12 * lineSize ? -25 : 0;
  // a superscript / subscript keeps the line's size: PowerPoint makes it smaller itself
  return { text: r.text, css: r.css, size: r2(sup ? r.size / .62 : r.size), b: r.b, i: r.i, color: r.color, a: r.a, ...(r.ls ? { ls: r.ls } : {}), ...(r.u ? { u: true } : {}), ...(r.s ? { s: true } : {}),
    ...(sup ? { baseline: sup } : {}) };
};
const squash = (t: string) => t.replace(/\s+/g, "");

/** a text body for runs in a frame: paragraphs (the label's lines tell hard breaks from wrapping), alignment and the
    insets that put the first baseline where the display list has it */
export function textBody(runs0: TRun[], frame: Box, label: string, opts: { wrap: boolean; /** a one-line paragraph's pitch */ one?: number; /** the paragraphs' bullets */ bullets?: Bullet[] } = { wrap: true }): { body: TextBody; frame: Box } {
  // a title's decorative copy (its text shadow): the shadow of the run it copies
  const deco = runs0.filter(r => r.decorative), runs = runs0.filter(r => !r.decorative);
  const lines = linesOf(runs);
  if (!lines.length) return { body: { paras: [], anchor: "t", ins: [0, 0, 0, 0], wrap: opts.wrap }, frame };
  const shadowOf = (r: TRun): Shadow | undefined => {
    const d = deco.find(x => x.text === r.text && near(x.size, r.size, .01) && near(x.x, r.x, 3) && near(x.y, r.y, 4));
    return d ? { dx: d.x - r.x, dy: d.y - r.y, blur: 0, c: d.color, a: d.a } : undefined;
  };
  // the paragraphs: consecutive lines whose text makes up one line of the label
  const want = label.split("\n").map(squash).filter(Boolean), groups: (typeof lines)[] = [];
  let k = 0, acc = "";
  const text = (l: (typeof lines)[number]) => squash(l.runs.map(r => r.text).join(""));
  const matched = want.length > 0 && want.join("") === lines.map(text).join("");
  for (const l of lines) {
    if (!matched) { groups.push([l]); continue; }
    if (!acc) groups.push([]);
    groups[groups.length - 1].push(l); acc += text(l);
    if (acc === want[k]) { k++; acc = ""; }
  }
  // each bullet's paragraph: the one whose first line has the bullet beside it (its centre near the line's x-height); the
  // paragraph then starts at its bullet (`hang` px before its text), as PowerPoint's hanging indent puts it
  const buOf = new Map<(typeof lines)[number][], Bullet>();
  for (const b of opts.bullets || []) {
    const cy = b.box.y + b.box.h / 2;
    let best: (typeof lines)[number][] | null = null, dist = Infinity;
    for (const g of groups) { const l = g[0], d = Math.abs(l.y - .36 * l.size - cy); if (d < dist && d <= .6 * l.size && b.box.x < l.x0) { best = g; dist = d; } }
    if (best && !buOf.has(best)) buOf.set(best, b);
  }
  const hangOf = (g: (typeof lines)[number][]) => { const b = buOf.get(g); return b ? Math.max(0, Math.min(...g.map(l => l.x0)) - b.box.x) : 0; };
  const lineHang = new Map<(typeof lines)[number], number>();
  for (const g of groups) { const h = hangOf(g); for (const l of g) lineHang.set(l, h); }
  const left = (l: (typeof lines)[number]) => l.x0 - (lineHang.get(l) || 0);
  // the frame: wide enough for its widest line (+2 % for PowerPoint's own metrics), and the insets from it
  const x0 = Math.min(...lines.map(left)), x1 = Math.max(...lines.map(l => l.x1));
  let F = { ...frame };
  if (x0 < F.x) { F.w += F.x - x0; F.x = x0; }
  if (x1 > F.x + F.w) F.w = x1 - F.x;
  // a paragraph's alignment: the edge its lines keep to (within half an em: a cell's padding), else centred, else left
  const alignOf = (ls: typeof lines): "l" | "ctr" | "r" => {
    const lg = ls.map(l => left(l) - F.x), rg = ls.map(l => F.x + F.w - l.x1), e = Math.max(2, .5 * ls[0].size);
    const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
    if (ls.length > 1 && spread(lg) < 1.5 && spread(rg) >= 1.5) return "l";
    if (ls.length > 1 && spread(rg) < 1.5 && spread(lg) >= 1.5) return "r";
    if (ls.every((_, i) => Math.abs(lg[i] - rg[i]) < 2) && Math.min(...lg) > e) return "ctr";
    if (Math.max(...rg) <= e && Math.max(...rg) < Math.min(...lg)) return "r";
    if (Math.max(...lg) <= e || ls.length > 1) return "l";
    return Math.abs(lg[0] - rg[0]) <= e ? "ctr" : rg[0] < lg[0] ? "r" : "l";
  };
  const paras: Para[] = [];
  let prevLast: (typeof lines)[number] | null = null;
  for (const g of groups) {
    // a wrapped paragraph keeps the display list's pitch; one line takes its element's height when that is a line's
    const pitch = g.length > 1 ? (g[g.length - 1].y - g[0].y) / (g.length - 1) : opts.one ?? (groups.length === 1 && frame.h >= .9 * g[0].size && frame.h <= 2.2 * g[0].size ? frame.h : 1.2 * g[0].size);
    const runsOut: Run[] = [];
    g.forEach((l, li) => {
      l.runs.forEach((r, j) => {
        const prev = l.runs[j - 1], out = toRun(r, l.y, l.size), sh = shadowOf(r);
        if (sh) out.shadow = sh;
        // the spaces the display list leaves out between runs, and between wrapped lines (one paragraph: PowerPoint wraps)
        if (j === 0 && li > 0) out.text = " " + out.text;
        else if (prev && r.x - (prev.x + prev.w) > .18 * r.size && !/\s$/.test(prev.text) && !/^\s/.test(r.text)) out.text = " " + out.text;
        runsOut.push(out);
      });
    });
    const before = prevLast ? Math.max(0, g[0].y - prevLast.y - pitch) : 0;
    const bu = buOf.get(g), hang = hangOf(g);
    paras.push({ align: alignOf(g), runs: runsOut, pitch: r2(pitch), before: r2(before), ...(bu ? { bu: { level: bu.level, c: bu.c, a: bu.a }, indent: -r2(hang) } : {}) });
    prevLast = g[g.length - 1];
  }
  // left / right insets for text that sits away from the frame's edge
  const lg = Math.max(0, Math.min(...lines.map(l => left(l) - F.x))), rg = Math.max(0, Math.min(...lines.map(l => F.x + F.w - l.x1)));
  const allL = paras.every(p => p.align === "l"), allR = paras.every(p => p.align === "r");
  const insL = allL ? lg : 0, insR = allR ? rg : 0;
  // the slack: a wrapped paragraph may need a little more room in PowerPoint's metrics
  const slack = Math.min(24, F.w * .02);
  if (allR) F = { ...F, x: F.x - slack, w: F.w + slack };
  else if (paras.every(p => p.align === "ctr")) F = { ...F, x: F.x - slack / 2, w: F.w + slack };
  else F = { ...F, w: F.w + slack };
  // a bulleted paragraph's text margin: from the inset to its text (its bullet `indent` before it)
  groups.forEach((g, k) => { const p = paras[k]; if (p.bu) p.marL = r2(Math.max(0, Math.min(...g.map(l => l.x0)) - F.x - insL)); });
  // the top inset: the first line's top where PowerPoint then draws its baseline on the display list's
  const top = lines[0].y - baselineIn(paras[0].pitch, lines[0].size);
  if (top < F.y) { F.h += F.y - top; F.y = top; }
  const bottom = lines[lines.length - 1].y - baselineIn(paras[paras.length - 1].pitch, lines[lines.length - 1].size) + paras[paras.length - 1].pitch;
  if (bottom > F.y + F.h) F.h = bottom - F.y;
  return { body: { paras, anchor: "t", ins: [r2(insL), r2(top - F.y), r2(insR), 0], wrap: opts.wrap }, frame: F };
}

const PH: Record<string, Placeholder> = { title: "title", "cv-title": "ctrTitle", "cv-sub": "subTitle" };
function placeholderOf(o: Owner | null): Placeholder | undefined {
  if (!o || o.kind !== "f") return undefined;
  if (PH[o.id]) return PH[o.id];
  if (/^(gls wb chrome )?pageno/.test(o.id)) return /footer/.test(o.id) ? "ftr" : "sldNum";
  return undefined;
}
const NAMES: Record<string, string> = { title: "Title", subtitle: "Subtitle", "cv-title": "Title", "cv-sub": "Subtitle", "cv-kicker": "Kicker" };

/** primitives → elements: texts gathered by their element into text boxes, shadows given to the shapes that cast them */
export function assemble(prims: Prim[]): El[] {
  const out: (El | null)[] = [], shapes: { at: number; el: ShapeEl | PicEl }[] = [];
  const textAt = new Map<number, { owner: Owner | null; runs: TRun[]; bullets: Bullet[] }>(), loose: number[] = [];
  const pendingOuter: { sh: Extract<Prim, { p: "shadow" }>; from: number }[] = [];
  for (const pr of prims) {
    if (pr.p === "el") {
      const at = out.length; out.push(pr.el);
      if (pr.el.k === "sp" || pr.el.k === "pic") {
        shapes.push({ at, el: pr.el });
        // an outer shadow waiting for its shape (the next one of the same box)
        for (let j = pendingOuter.length - 1; j >= 0; j--) {
          const s = pendingOuter[j].sh;
          if (boxNear(pr.el.box, s.box, 1.5)) { giveOuter(pr.el, s); pendingOuter.splice(j, 1); }
          else if (out.length - pendingOuter[j].from > 12) pendingOuter.splice(j, 1);
        }
      }
      // a 1 px highlight along the top of the shape just before it (a Liquid Glass capsule's border-top): that
      // shape's inner shadow, so a table of capsules is not twice as many shapes
      if (pr.el.k === "sp" && hairline(pr.el)) {
        const prev = shapes[shapes.length - 2];
        if (prev && prev.el.k === "sp" && !prev.el.inner && near(prev.el.box.x, pr.el.box.x, .6) && near(prev.el.box.y, pr.el.box.y, .6) && near(prev.el.box.w, pr.el.box.w, .6)
          && prev.el.box.h > 3 * pr.el.box.h) {
          const f = pr.el.fill as { solid: RGB; a?: number };
          prev.el.inner = { dx: 0, dy: pr.el.box.h, blur: 0, c: f.solid, a: f.a ?? 1 };
          out[at] = null; shapes.pop();
        }
      }
    } else if (pr.p === "shadow") {
      if (pr.inset) {
        // an inset shadow: the last shape of its box (the tint it lies on)
        const s = [...shapes].reverse().find(x => boxNear(x.el.box, pr.box, 1.5));
        if (s && s.el.k === "sp" && pr.blur > .01 && (!s.el.inner || s.el.inner.a * s.el.inner.blur < pr.a * pr.blur))
          s.el.inner = { dx: pr.dx, dy: pr.dy, blur: pr.blur, c: pr.c, a: pr.a };
      } else pendingOuter.push({ sh: pr, from: out.length });
    } else if (pr.p === "text" || pr.p === "bullet") {
      // a bullet without a text box of its own stays the shape it is drawn as
      if (pr.p === "bullet" && !pr.owner) { out.push(pr.el); continue; }
      const key = pr.owner ? pr.owner.n : -1 - loose.length;
      let g = textAt.get(key);
      if (!g) { g = { owner: pr.owner, runs: [], bullets: [] }; textAt.set(key, g); out.push({ k: "sp", box: { x: 0, y: 0, w: 0, h: 0 }, geom: { prst: "rect" }, name: "text:" + key } as ShapeEl); if (!pr.owner) loose.push(key); }
      if (pr.p === "bullet") g.bullets.push(pr.bu); else g.runs.push(pr.run);
    }
  }
  const owners: (Owner | null)[] = [];
  return frameGroups(out.map((el, i) => {
    if (!el || el.k !== "sp" || !el.name?.startsWith("text:")) return el;
    const g = textAt.get(+el.name.slice(5))!;
    owners[i] = g.owner;
    return g.runs.length ? textBox(g.runs, g.owner, g.bullets) : null;
  }), owners).filter((e): e is El => !!e);
}
/** a text box's border (B49, render/note-frame.ts): the outline-only shape just before a text box ("tnote …") that lies
    inside the box becomes one group with it, "Text box": its native outline (a:ln) at the box, the text over it, moved
    together in PowerPoint. (The text box keeps its own frame and insets: an outline on it would sit on its PowerPoint
    frame, which is wider than the box by the slack wrapped text needs.) */
function frameGroups(els: (El | null)[], owners: (Owner | null)[]): (El | null)[] {
  const out = [...els];
  out.forEach((el, i) => {
    const o = owners[i];
    if (!el || el.k !== "sp" || !o || !/^tnote\b/.test(o.id)) return;
    // back from the text box over what its text drew inside the box (a consulting heading's accent bar) to the border
    const mid: number[] = [];
    for (let j = i - 1; j >= 0; j--) {
      const f = out[j];
      if (!f) continue;
      if (f.k === "sp" && !f.fill && f.line && "solid" in f.line.paint && !f.text && !f.seg && !f.rot && !f.fromShadow && inside(f.box, o.box, f.line.w + .5)) {
        out[j] = null; mid.forEach(k => { out[k] = null; });
        // the text inside the border: the text box's slack for PowerPoint's wrapping (textBody) never past the line
        const a = f.box.x + f.line.w / 2, b = f.box.x + f.box.w - f.line.w / 2, t = { ...el };
        if (t.box.x < a && t.text) { const dx = a - t.box.x; t.box = { ...t.box, x: a, w: t.box.w - dx }; t.text = { ...t.text, ins: [r2(Math.max(0, t.text.ins[0] - dx)), t.text.ins[1], t.text.ins[2], t.text.ins[3]] }; }
        if (t.box.x + t.box.w > b && b > t.box.x) { const dx = t.box.x + t.box.w - b; t.box = { ...t.box, w: b - t.box.x }; if (t.text) t.text = { ...t.text, ins: [t.text.ins[0], t.text.ins[1], r2(Math.max(0, t.text.ins[2] - dx)), t.text.ins[3]] }; }
        out[i] = { k: "grp", name: "Text box", children: [{ ...f, name: "Border" }, ...mid.reverse().map(k => els[k]!), t] };
        return;
      }
      if ((f.k !== "sp" && f.k !== "pic") || !inside(f.box, o.box, 1) || boxNear(f.box, o.box, 1.5) || mid.length >= 8) return;
      mid.push(j);
    }
  });
  return out;
}
/** a thin solid rectangle with nothing else to it (a highlight line) */
const hairline = (e: ShapeEl) => !e.text && !e.line && !e.outer && !e.inner && !e.rot && !e.seg && e.box.h <= 2.5 && e.box.w > 4 * e.box.h
  && !!e.fill && "solid" in e.fill && "prst" in e.geom && e.geom.prst === "rect";
function giveOuter(el: ShapeEl | PicEl, s: { dx: number; dy: number; blur: number; spread: number; c: RGB; a: number; box: Box }) {
  // PowerPoint has one outer shadow per shape: the strongest of the recipe's layers; the spread as its size
  if (el.outer && el.outer.a * el.outer.blur >= s.a * s.blur) return;
  const sx = s.box.w > 0 ? (s.box.w + 2 * s.spread) / s.box.w : 1, sy = s.box.h > 0 ? (s.box.h + 2 * s.spread) / s.box.h : 1;
  el.outer = { dx: s.dx, dy: s.dy, blur: s.blur, c: s.c, a: Math.min(1, s.a), ...(Math.abs(sx - 1) > .005 ? { sx: Math.max(.5, sx) } : {}), ...(Math.abs(sy - 1) > .005 ? { sy: Math.max(.5, sy) } : {}) };
}
/** the text box of an element's runs: the element's box, or the runs' own extent */
function textBox(runs: TRun[], owner: Owner | null, bullets: Bullet[] = []): ShapeEl {
  const rot = runs.find(r => Math.abs(r.rot) > .01);
  if (rot) {
    // turned text (a cell's rotated text): one line, the box turned about its centre
    const r = rot, lh = r.size * 1.2, w = r.w + r.size * .3, rad = r.rot * Math.PI / 180;
    // the run's start is on its baseline; its box's centre is half its width along the run and above the baseline
    const up = baselineIn(lh, r.size) - lh / 2, cx = r.x + Math.cos(rad) * r.w / 2 + Math.sin(rad) * up, cy = r.y + Math.sin(rad) * r.w / 2 - Math.cos(rad) * up;
    const box = { x: cx - w / 2, y: cy - lh / 2, w, h: lh };
    return { k: "sp", box, rot: ((r.rot % 360) + 360) % 360, geom: { prst: "rect" }, fill: null, line: null, name: "Text",
      text: { paras: [{ align: "ctr", runs: [toRun({ ...r, y: r.y }, r.y, r.size)], pitch: r2(lh), before: 0 }], anchor: "ctr", ins: [0, 0, 0, 0], wrap: false } };
  }
  const minX = Math.min(...runs.map(r => r.x)), maxX = Math.max(...runs.map(r => r.x + r.w));
  const minY = Math.min(...runs.map(r => r.y - r.size)), maxY = Math.max(...runs.map(r => r.y + r.size * .3));
  const frame = owner ? owner.box : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  const { body, frame: F } = textBody(runs, frame, owner?.label ?? runs.map(r => r.text).join(""), { wrap: !!owner, bullets });
  const ph = placeholderOf(owner);
  return { k: "sp", box: F, geom: { prst: "rect" }, fill: null, line: null, text: body, name: owner ? NAMES[owner.id] || (ph ? ph === "sldNum" ? "Slide Number" : "Footer" : "Text") : "Text", ...(ph ? { ph } : {}) };
}

/* ---- tables ---- */
function clusters(vals: number[], e = .75): number[] {
  const s = [...vals].sort((a, b) => a - b), out: number[] = [];
  for (const v of s) if (!out.length || v - out[out.length - 1] > e) out.push(v);
  return out;
}
const idxOf = (arr: number[], v: number, e: number) => { let best = -1, d = e; arr.forEach((a, i) => { if (Math.abs(a - v) <= d) { d = Math.abs(a - v); best = i; } }); return best; };

/** a table's primitives → its elements: the shapes under it, the table, the shapes over it */
export function buildTable(prims: Prim[]): El[] {
  const hits = prims.flatMap(p => p.p === "hit" ? [p.owner] : []);
  const cells0 = new Map<string, Owner>();
  for (const h of hits) if (!cells0.has(h.id) && h.box.w > 0 && h.box.h > 0) cells0.set(h.id, h);
  if (cells0.size < 2) return assemble(prims);
  // the grid: every cell box's edges
  const owners = [...cells0.values()];
  const xs = clusters(owners.flatMap(o => [o.box.x, o.box.x + o.box.w])), ys = clusters(owners.flatMap(o => [o.box.y, o.box.y + o.box.h]));
  const nC = xs.length - 1, nR = ys.length - 1;
  if (nC < 1 || nR < 1) return assemble(prims);
  const cells: Cell[][] = Array.from({ length: nR }, () => Array.from({ length: nC }, (): Cell => ({})));
  const cover: (Owner | null)[][] = Array.from({ length: nR }, () => Array(nC).fill(null));
  const span = new Map<number, { r0: number; c0: number; r1: number; c1: number }>();
  for (const o of owners) {
    const c0 = idxOf(xs, o.box.x, 1), c1 = idxOf(xs, o.box.x + o.box.w, 1), r0 = idxOf(ys, o.box.y, 1), r1 = idxOf(ys, o.box.y + o.box.h, 1);
    if (c0 < 0 || c1 <= c0 || r0 < 0 || r1 <= r0) continue;
    let free = true;
    for (let r = r0; r < r1 && free; r++) for (let c = c0; c < c1; c++) if (cover[r][c]) { free = false; break; }
    if (!free) continue;
    for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) { cover[r][c] = o; if (r !== r0 || c !== c0) cells[r][c].merged = true; }
    if (r1 - r0 > 1 || c1 - c0 > 1) cells[r0][c0].span = [r1 - r0, c1 - c0];
    span.set(o.n, { r0, c0, r1, c1 });
  }
  const used = new Set<Prim>(), overFill = new Set<Prim>();
  const box = { x: xs[0], y: ys[0], w: xs[nC] - xs[0], h: ys[nR] - ys[0] };
  /** the cell at a grid position (its merged cell's first one) */
  const cellAt = (r: number, c: number): Cell => { const o = cover[r][c], s = o ? span.get(o.n) : null; return s ? cells[s.r0][s.c0] : cells[r][c]; };
  let at = -1;
  const mark = (p: Prim, i: number) => { used.add(p); if (at < 0 || i < at) at = i; };
  const fillOf = new Map<Cell, { p: Prim; i: number }>();
  prims.forEach((p, i) => {
    if (p.p !== "el" || p.el.k !== "sp" || p.el.cf) return;
    const el = p.el;
    // a cell's fill: a solid rectangle (or its seam polygon) over one cell or one merged cell
    if (el.fill && "solid" in el.fill && !el.line && !el.outer && !el.inner && !el.rot && !el.text && !el.fromShadow
      && ("prst" in el.geom ? el.geom.prst === "rect" : isSeam(el.geom.path, el.box))) {
      // (a seam polygon reaches SEAM table px – scaled – under its neighbours: the nearest grid lines are its cell's)
      const e = "prst" in el.geom ? 1.2 : 3.5;
      const c0 = idxOf(xs, el.box.x, e), c1 = idxOf(xs, el.box.x + el.box.w, e), r0 = idxOf(ys, el.box.y, e), r1 = idxOf(ys, el.box.y + el.box.h, e);
      if (c0 >= 0 && c1 > c0 && r0 >= 0 && r1 > r0) {
        const o = cover[r0][c0], s = o ? span.get(o.n) : null;
        const whole = s ? s.r0 === r0 && s.c0 === c0 && s.r1 === r1 && s.c1 === c1 : r1 - r0 === 1 && c1 - c0 === 1;
        // a second fill over a cell: taken when it is opaque (it hides the first), else left a shape over the table
        const had = cells[r0][c0].fill, opaque = (el.fill.a ?? 1) >= .999;
        if (whole && (el.fill.a ?? 1) > 0 && (!had || opaque)) { cells[r0][c0].fill = el.fill; fillOf.set(cells[r0][c0], { p, i }); mark(p, i); }
        else if (whole && had) overFill.add(p);                  // (drawn over the cell's own: over the table)
      }
      return;
    }
    // a border: a line on a grid line, from one grid edge to another; a thin separator across most of the table
    const thin = !el.text && !el.rot && el.fill && !el.line && "prst" in el.geom && el.geom.prst === "rect" && (el.box.h <= 2.5 || el.box.w <= 2.5);
    const seg: [number, number, number, number] | null = el.seg ?? (thin ? (el.box.h <= el.box.w ? [el.box.x, el.box.y + el.box.h / 2, el.box.x + el.box.w, el.box.y + el.box.h / 2] : [el.box.x + el.box.w / 2, el.box.y, el.box.x + el.box.w / 2, el.box.y + el.box.h]) : null);
    if (!seg) return;
    const paint = el.seg ? el.line?.paint : el.fill!, w = el.seg ? el.line?.w ?? 1 : Math.min(el.box.w, el.box.h);
    if (!paint || paintAlpha(paint) <= 0) return;
    const { c: col, a } = mainColour(paint), ln: Line = { w, paint: { solid: col, a }, ...(el.seg && el.line?.dash ? { dash: el.line.dash } : {}) };
    const soft = !el.seg;              // a separator inset from the table's edges: on every cell it spans most of
    const horiz = Math.abs(seg[1] - seg[3]) < .01, vert = Math.abs(seg[0] - seg[2]) < .01;
    if (!horiz && !vert) return;
    if (horiz) {
      const y = seg[1], j = idxOf(ys, y, w / 2 + .9), xa = Math.min(seg[0], seg[2]), xb = Math.max(seg[0], seg[2]);
      if (j < 0) return;
      let a0 = idxOf(xs, xa, 1.5), b0 = idxOf(xs, xb, 1.5);
      if (soft) {
        if (xb - xa < box.w * .5) return;
        a0 = xs.findIndex((x, k) => k < nC && xs[k + 1] - Math.max(xa, x) > (xs[k + 1] - x) * .5); b0 = nC - [...xs].reverse().findIndex((x, k) => k < nC && Math.min(xb, x) - xs[nC - k - 1] > (x - xs[nC - k - 1]) * .5);
      }
      if (a0 < 0 || b0 <= a0 || b0 > nC) return;
      for (let c = a0; c < b0; c++) {
        const above = j > 0 ? cellAt(j - 1, c) : null, below = j < nR ? cellAt(j, c) : null;
        // inside a merged cell: not an edge
        if (above && below && above === below) return;
      }
      for (let c = a0; c < b0; c++) { if (j > 0) cellAt(j - 1, c).b = stronger(cellAt(j - 1, c).b, ln); if (j < nR) cellAt(j, c).t = stronger(cellAt(j, c).t, ln); }
      mark(p, i);
    } else {
      const x = seg[0], j = idxOf(xs, x, w / 2 + .9), ya = Math.min(seg[1], seg[3]), yb = Math.max(seg[1], seg[3]);
      if (j < 0) return;
      let a0 = idxOf(ys, ya, 1.5), b0 = idxOf(ys, yb, 1.5);
      if (soft) {
        if (yb - ya < box.h * .5) return;
        a0 = ys.findIndex((y, k) => k < nR && ys[k + 1] - Math.max(ya, y) > (ys[k + 1] - y) * .5); b0 = nR - [...ys].reverse().findIndex((y, k) => k < nR && Math.min(yb, y) - ys[nR - k - 1] > (y - ys[nR - k - 1]) * .5);
      }
      if (a0 < 0 || b0 <= a0 || b0 > nR) return;
      for (let r = a0; r < b0; r++) { const L = j > 0 ? cellAt(r, j - 1) : null, R = j < nC ? cellAt(r, j) : null; if (L && R && L === R) return; }
      for (let r = a0; r < b0; r++) { if (j > 0) cellAt(r, j - 1).r = stronger(cellAt(r, j - 1).r, ln); if (j < nC) cellAt(r, j).l = stronger(cellAt(r, j).l, ln); }
      mark(p, i);
    }
  });
  // the cells' texts: their runs in the cell when they fit it as PowerPoint lays them out
  const byOwner = new Map<number, { runs: TRun[]; idx: number[] }>();
  prims.forEach((p, i) => { if (p.p === "text" && p.owner?.kind === "t" && span.has(p.owner.n)) { const g = byOwner.get(p.owner.n) || { runs: [], idx: [] }; g.runs.push(p.run); g.idx.push(i); byOwner.set(p.owner.n, g); } });
  for (const o of owners) {
    const g = byOwner.get(o.n), s = span.get(o.n);
    if (!g || !s) continue;
    const cellBox = { x: xs[s.c0], y: ys[s.r0], w: xs[s.c1] - xs[s.c0], h: ys[s.r1] - ys[s.r0] };
    if (g.runs.some(r => Math.abs(r.rot) > .01 || r.decorative)) continue;
    const lines = linesOf(g.runs);
    const tooWide = lines.some(l => l.x0 < cellBox.x - .5 || l.x1 > cellBox.x + cellBox.w + .5);
    // a row is never lower than its text in PowerPoint: one line takes at most the row (exact spacing), a wrapped cell
    // keeps the display list's pitch – and its text goes over the table when that does not fit
    const size = Math.max(...lines.map(l => l.size)), one = Math.max(.8 * size, Math.min(1.2 * size, cellBox.h));
    const pitch = lines.length > 1 ? (lines[lines.length - 1].y - lines[0].y) / (lines.length - 1) : one;
    if (tooWide || lines.length * pitch > cellBox.h + .5) continue;
    const { body } = textBody(g.runs, cellBox, o.label, { wrap: true, one });
    // the text's height in PowerPoint: every line at its paragraph's pitch, the space between paragraphs
    const H = lines.length * pitch + body.paras.reduce((t, p) => t + p.before, 0);
    if (H > cellBox.h + .5) continue;
    // the cell's anchor and margins: the first line's top where PowerPoint then draws its baseline on the display list's
    const gt = Math.max(0, Math.min(cellBox.h - H, lines[0].y - baselineIn(body.paras[0].pitch, lines[0].size) - cellBox.y)), gb = Math.max(0, cellBox.h - H - gt);
    const anchor: Cell["anchor"] = Math.abs(gt - gb) < 1.5 ? "ctr" : gt < gb ? "t" : "b";
    const lg = Math.max(0, Math.min(...lines.map(l => l.x0 - cellBox.x))), rg = Math.max(0, Math.min(...lines.map(l => cellBox.x + cellBox.w - l.x1)));
    const al = body.paras.every(p => p.align === "r") ? "r" : body.paras.every(p => p.align === "ctr") ? "ctr" : "l";
    const cell = cells[s.r0][s.c0];
    cell.text = { ...body, wrap: true, ins: [0, 0, 0, 0] };
    cell.mar = [al === "l" ? r2(lg) : 0, anchor === "t" ? r2(gt) : 0, al === "r" ? r2(rg) : 0, anchor === "b" ? r2(gb) : 0];
    cell.anchor = anchor;
    g.idx.forEach(i => mark(prims[i], i));
  }
  // (S16.4, 09 §4.3) a data bar drawn over its cell's fill is a shape under the table: the fill leaves the table (the cell
  // has none) and stays a shape where it was drawn, under the bar
  prims.forEach((p, i) => {
    if (p.p !== "el" || p.el.k !== "sp" || p.el.cf !== "bar") return;
    const b = p.el.box, mx = b.x + b.w / 2, my = b.y + b.h / 2;
    const c = xs.findIndex((x, k) => k < nC && mx >= x && mx < xs[k + 1]), r = ys.findIndex((y, k) => k < nR && my >= y && my < ys[k + 1]);
    if (c < 0 || r < 0) return;
    const cell = cellAt(r, c), f = fillOf.get(cell);
    if (f && f.i < i) { cell.fill = null; used.delete(f.p); fillOf.delete(cell); }
  });
  at = -1; prims.forEach((p, i) => { if (used.has(p) && (at < 0 || i < at)) at = i; });
  if (at < 0) return assemble(prims);
  // the table where its cells' texts are drawn (fills and borders come before them); a line drawn between the first
  // fill and the texts stays over the fills: after the table
  const firstText = prims.findIndex(p => used.has(p) && p.p === "text"), place = firstText >= 0 ? firstText : prims.reduce((m, p, i) => used.has(p) ? i + 1 : m, at);
  const tbl: TableEl = { k: "tbl", box, cols: xs.slice(1).map((x, i) => r2(x - xs[i])), rows: ys.slice(1).map((y, i) => r2(y - ys[i])), cells, name: "Table" };
  const rest: Prim[] = [], over: Prim[] = [];
  prims.forEach((p, i) => {
    if (i === place) rest.push({ p: "el", el: tbl }, ...over);
    if (used.has(p)) return;
    // a cell text left out of the table, drawn before its first taken one, would be hidden by the cells' fills: over it
    // (an icon of Excel's icon sets: over the table, in its group; a data bar stays where it is drawn – under it)
    if (overFill.has(p) || (i < place && p.p === "el" && p.el.k === "sp" && p.el.cf === "icon") || (i > at && i < place && !(p.p === "el" && p.el.k === "sp" && p.el.cf === "bar") && (p.p === "text" || (p.p === "el" && p.el.k === "sp" && (p.el.seg || (p.el.box.h <= 2.5 || p.el.box.w <= 2.5)))))) over.push(p);
    else rest.push(p);
  });
  if (place >= prims.length) rest.push({ p: "el", el: tbl }, ...over);
  return assemble(rest);
}
/** of two borders on one edge, the one that shows more (width × alpha); the later on a tie, as it is drawn over */
function stronger(a: Line | null | undefined, b: Line): Line {
  if (!a) return b;
  const k = (l: Line) => l.w * ("solid" in l.paint ? l.paint.a ?? 1 : 1);
  return k(b) >= k(a) ? b : a;
}
/** a cell fill's polygon reaching under its neighbours (excel-dl.ts seamPath): a rectangle with strips, all axis-aligned */
function isSeam(d: PathCmd[], b: Box) {
  return d.length <= 14 && d[0][0] === "M" && d[d.length - 1][0] === "Z" && d.slice(1, -1).every(c => c[0] === "L") && b.w > 0 && b.h > 0;
}

/* ---- lines (4.8, M15 S15.3 / S15.5; 09 §4.3, LN-03) ---- */
/** a line item's elements: one plain shape named "Line" – never a connector (p:cxnSp), and an attached line is written
    where it is drawn (PowerPoint does not keep it attached) –: a straight one `a:prstGeom prst="line"` in its bounds,
    flipped so that its first point is end a (flipH / flipV), any other route an open `a:custGeom`; its stroke on `a:ln`
    (width, colour, dash, cap, join) with native a:headEnd (end a) / a:tailEnd (end b). The limiter's ticks ("bar"
    heads, which PowerPoint has no end for) are drawn solid with round caps, as the slide draws them (render/heads.ts):
    segments of the same custom geometry – its a:ln round-capped, which the ticks then cover at the ends – only beside a
    straight solid route with no native end; else a shape of their own beside it (an a:ln is the shape's: a dashed
    route would dash its ticks, a native end would land on a tick, an elbow's joins would turn round). Its label's
    background and text box are grouped with it ("Line") */
const group = (els: El[], name: string): El[] => els.length > 1 ? [{ k: "grp", name, children: els }] : els;
function lineEls(L: LineSem, label: El[]): El[] {
  const st = L.stroke, line: Line = { w: st.w, paint: st.paint, ...(st.dash ? { dash: st.dash } : {}), ...(st.cap ? { cap: st.cap } : {}), ...(st.join ? { join: st.join } : {}) };
  const end = (h: typeof L.head): LineEnd | undefined => h && h !== "bar" && h !== "none" ? { type: h, ...(L.size ? { size: L.size } : {}) } : undefined;
  const head = end(L.head), tail = end(L.tail), native = !!(head || tail);
  const shape = (d: PathCmd[], ln: Line): ShapeEl => { const b = pathBox(d); return { k: "sp", box: b, geom: { path: d.map(p => shiftCmd(p, -b.x, -b.y)), open: true }, fill: null, line: ln, name: "Line" }; };
  const out: El[] = [];
  const ticks = L.bars.length > 0, together = ticks && L.straight && !native && !line.dash;
  if (L.straight && !together) {
    const { a, b } = L, box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
    out.push({ k: "sp", box, ...(b.x < a.x ? { flipH: true } : {}), ...(b.y < a.y ? { flipV: true } : {}), geom: { prst: "line" }, fill: null, line: { ...line, ...(head ? { head } : {}), ...(tail ? { tail } : {}) }, name: "Line" });
  } else if (together) out.push(shape([...L.route, ...L.bars.flat()], { ...line, cap: "round" }));
  else out.push(shape(L.route, { ...line, ...(head ? { head } : {}), ...(tail ? { tail } : {}) }));
  // the ticks on their own: solid, round caps and joins (as drawn)
  if (ticks && !together) { const { dash: _d, ...solidLn } = line; out.push(shape(L.bars.flat(), { ...solidLn, cap: "round", join: "round" })); }
  out.push(...label);
  return group(out, "Line");
}

/* ---- icons (4.8, S15.2; 09 §4.3) ---- */
const samePaint = (a: Paint | undefined, b: Paint | undefined) => !a || !b || JSON.stringify(a) === JSON.stringify(b);
const sameStroke = (a: Stroke | undefined, b: Stroke | undefined) => !a || !b || JSON.stringify(a) === JSON.stringify(b);
/** a Tabler icon's elements: its paths as custom geometry (never a picture, never a preset that only looks alike) – one
    shape of several a:path while they share their ink and width (an outline icon's strokes beside its filled dots: one
    shape), another where they differ (a path at half ink); outline paths noFill with round caps and joins
    (`a:ln cap="rnd"`, `a:round`), filled ones solidFill. Several shapes are grouped as "Icon" */
function iconEls(nodes: DisplayList, c: Ctx): El[] {
  const s = decompose(c.M).sx, out: ShapeEl[] = [];
  let cur: { parts: GeomPart[]; fill?: Paint; stroke?: Stroke } | null = null;
  const flush = () => {
    if (!cur) return;
    const all = cur.parts.flatMap(p => p.d), b = pathBox(all);
    if (b.w > 0 || b.h > 0) {
      const parts = cur.parts.map(p => ({ ...p, d: p.d.map(x => shiftCmd(x, -b.x, -b.y)) }));
      out.push({ k: "sp", box: b, geom: { path: parts.flatMap(p => p.d), open: !cur.fill, parts }, fill: cur.fill ? mulPaint(cur.fill, c.alpha) : null,
        line: cur.stroke ? lineOf(cur.stroke, s, c.alpha) : null, name: "Icon" });
    }
    cur = null;
  };
  for (const n of nodes) {
    if (n.t !== "path" || (!n.fill && !n.stroke)) continue;
    if (cur && !(samePaint(cur.fill, n.fill) && sameStroke(cur.stroke, n.stroke))) flush();
    cur ??= { parts: [] };
    cur.parts.push({ d: mapPath(c.M, n.d), fill: !!n.fill, stroke: !!n.stroke });
    if (n.fill) cur.fill = n.fill;
    if (n.stroke) cur.stroke = n.stroke;
  }
  flush();
  return out.length > 1 ? [{ k: "grp", name: "Icon", children: out }] : out;
}

/* ---- callouts ---- */
/** a callout's elements: its main shape as the preset it is (rect, roundRect, ellipse, rightArrow,
    wedgeRoundRectCallout) holding its text; a glass callout stays its surfaces with the text box over them */
function callout(els: El[], it: Extract<ItemSem, { kind: "shape" }>): El[] {
  const B = it.box;
  // its main shape: the first that covers the item's box (a bubble's outline reaches out to its tail)
  const main = els.findIndex(e => e.k === "sp" && !e.text && !e.fromShadow && (e.fill || e.line) && inside(B, e.box, Math.max(2, (e.line?.w ?? 0) + 1)) && e.box.w * e.box.h <= 4 * B.w * B.h);
  const texts = els.filter(e => e.k === "sp" && !!e.text);
  if (main >= 0 && it.shape !== "icon") {
    const m = els[main] as ShapeEl, k = it.shape;
    if (k === "arrow" || k === "bubble" || k === "circle") m.box = { ...B };
    const W = m.box.w, H = m.box.h, ss = Math.max(.01, Math.min(W, H));
    const adjR = (r: number) => Math.round(Math.min(50000, Math.max(0, r) / ss * 100000));
    const head = Math.min(W * .4, H);
    m.geom = k === "rect" ? { prst: "rect" } : k === "round" ? { prst: "roundRect", adj: { adj: adjR(it.radius) } } : k === "pill" ? { prst: "roundRect", adj: { adj: 50000 } }
      : k === "circle" ? { prst: "ellipse" } : k === "arrow" ? { prst: "rightArrow", adj: { adj1: 50000, adj2: Math.round(head / ss * 100000) } }
      : k === "bubble" ? { prst: "wedgeRoundRectCallout", adj: bubbleAdj(B, it.tail, it.radius) } : m.geom;
    m.name = "Callout";
    if (texts.length === 1) {
      // the text inside the shape: insets from the preset's own text rectangle (ECMA-376 presetShapeDefinitions: a
      // rounded rectangle's is inset by 0.29 of its radius, an ellipse's is the inscribed rectangle, an arrow's its shaft)
      const rr = (k === "pill" ? ss / 2 : k === "round" || k === "bubble" ? Math.min(ss / 2, Math.max(0, it.radius)) : 0) * .29289;
      const R = k === "circle" ? { x: W * .14645, y: H * .14645, w: W * .7071, h: H * .7071 }
        : k === "arrow" ? { x: 0, y: H / 4, w: (W - head) + (H / 4) * head / (H / 2), h: H / 2 } : { x: rr, y: rr, w: W - 2 * rr, h: H - 2 * rr };
      const t = texts[0] as ShapeEl, tb = t.box, body = t.text!;
      const l = tb.x - (m.box.x + R.x), top = tb.y - (m.box.y + R.y), r = (m.box.x + R.x + R.w) - (tb.x + tb.w);
      m.text = { ...body, ins: [r2(Math.max(0, l) + body.ins[0]), r2(Math.max(0, top) + body.ins[1]), r2(Math.max(0, r) + body.ins[2]), 0], anchor: "t" };
      const rest = els.filter(e => e !== t);
      return rest.length > 1 ? [{ k: "grp", name: "Callout", children: rest }] : rest;
    }
  }
  return els.length > 1 ? [{ k: "grp", name: "Callout", children: els }] : els;
}
/** the speech bubble's tail as the preset's adjustments: the tip's offset from the centre, in 1/100 000 of the box */
function bubbleAdj(B: Box, tip: { x: number; y: number } | null | undefined, r: number) {
  const t = tip && Number.isFinite(tip.x) && Number.isFinite(tip.y) ? tip : { x: B.x + B.w * .25, y: B.y + B.h + Math.min(40, B.h * .5) };
  return { adj1: Math.round((t.x - (B.x + B.w / 2)) / Math.max(.01, B.w) * 100000), adj2: Math.round((t.y - (B.y + B.h / 2)) / Math.max(.01, B.h) * 100000),
    adj3: Math.round(Math.min(50000, r / Math.max(.01, Math.min(B.w, B.h)) * 100000)) };
}

/** a slide's display list (and what the core says of it) → its scene, in drawing order */
export function sceneOf(nodes: DisplayList, sem: SlideSem | null, images: (id: string) => boolean): El[] {
  const w = new Walker(sem, images);
  w.walk(nodes, { M: ID, alpha: 1, clip: null }, true);
  return assemble(w.prims);
}
/** the same, with the elements of the nodes `sem.layout` names apart (`fixed`: the slide's layout carries them) */
export function sceneParts(nodes: DisplayList, sem: SlideSem | null, images: (id: string) => boolean): { els: El[]; fixed: El[] } {
  const w = new Walker(sem, images, true);
  w.walk(nodes, { M: ID, alpha: 1, clip: null }, true);
  return { els: assemble(w.prims), fixed: assemble(w.fixed) };
}
