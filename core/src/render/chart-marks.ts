/* Marks on a series chart (09 §2.2, §3.1; S14.3, CT-06): annotations in data coordinates – an arrow from the axis floor
   to a point, a line between two points or at a value, a band, an icon or a text above a column – placed again at every
   build from the chart's own layout, so they follow the data: a reload, a scenario's value, a version's removed cell.
   Where a mark stands (MarkAt):
   * { s, i }: series s's value i (counted in its own group) – a bar's outer end, a line's point; on a target series the
     top of the **target** bar (09 §3.3), so an icon above an "actual inside target" column clears its outline;
   * { g, edge }: a category group's start or end edge (a divider's place), from the floor to the ceiling;
   * { x, y, axis }: a category (its name, or its index) and a value on the axis y or y2 (a scatter chart: a number on its
     x axis and a value on y, S14.4).
   `b` is another such place, or "floor" / "ceiling" (the plot's bottom / top below / above `a`).
   Nodes only (ADR-004): an arrow is a `line` and its heads (render/heads.ts: filled `path`s, the line shortened under a
   filled head); a line a `line`; a band a `rect` (alpha .15, under the data); an icon its paths (render/icons.ts resolveIcon: a vendored
   Tabler icon once M15 registers the set, else the built-in of the same name, else "info" and an Issues line); a text
   a `text` with the callouts' {Sheet!C7} tokens resolved. The PowerPoint export draws the same nodes as plain shapes over
   the native chart (pptx/scene.ts: the chart's overlay, in its group) – never pictures, never connector shapes. */
import type { Box, ChartItem, ChartMark, Head, Heads, MarkAt } from "../model/types";
import type { Node, PathCmd, Stroke } from "../dl/types";
import type { RenderCtx } from "./context";
import type { Metrics } from "./excel-dl";
import { headGeom, headed } from "./heads";
import { iconCmds, resolveIcon, vendoredNodes } from "./icons";
import { calloutText } from "./shape-dl";
import { lineH, lum, textNode, type St } from "./chart-font";
import { dashOf, lineStyleOf } from "./chart-lines";
import { parseColor, solid } from "../dl/color";
import { changeNodes, gapNodes, refNodes, type TargetFrame, type TargetOut } from "./chart-targets";

const r2 = (v: number) => Math.round(v * 100) / 100 || 0;
const HEX = /^#[0-9A-Fa-f]{6}$/;
/** a place a mark can stand on: x, the value's y, the top of what is drawn there (a target bar's top), the radius of the
    marker drawn there (an arrow stops short of it), the colour drawn there */
export interface Anchor { x: number; y: number; top: number; r: number; color: string }
/** what chart-series.ts tells the marks of its layout */
export interface MarkFrame {
  plot: Box; cats: string[]; slot: number; horizontal: boolean;
  /** series id → its anchors by category of the chart (null = a gap), and its group's first category */
  series: Map<string, { anchors: (Anchor | null)[]; start: number }>;
  groups: Map<string, { start: number; len: number }>;
  /** a value on an axis → px (null: no such axis is drawn) */ vp: (v: number, axis: "y" | "y2") => number | null;
  /** a scatter chart's x value → px (S14.4): { x, y } marks stand at a number on its x axis, not on a category */ xp?: (x: number) => number;
  ink: string; lab: St; withFmt: (st: St, f: ChartMark["fmt"]) => St;
  /** (B52) what the reference lines, gap arrows and change pills need (chart-targets.ts); unset: they are not drawn */
  targets?: TargetFrame & { /** where a right-hand label of a reference line starts */ refLabelX: number };
}
/** the marks' nodes over the data, the bands under it (a band tints the plot, not the bars: on the slide and under the
    native chart), a hit per mark, the Issues lines */
export interface MarksOut { nodes: Node[]; under: Node[]; hits: Node[]; issues: string[];
  /** (S14.6) each arrow / line mark as the PowerPoint export writes it: one plain line shape from a to b (not shortened)
      with native a:headEnd (end a) / a:tailEnd (end b); `drop` = its nodes the export's overlay leaves out (the line and
      the heads PowerPoint draws itself – a limiter's "bar" tick stays a node: PowerPoint has no such end) */
  arrows: MarkArrow[];
  /** (B52) nodes the PowerPoint card leaves out: a reference line's line (the native chart draws it as a series) */ native: Node[] }
export interface MarkArrow { a: { x: number; y: number }; b: { x: number; y: number }; stroke: Stroke; head?: Head; tail?: Head; size?: Heads["size"]; drop: Node[] }

/** a place in px, or why there is none ("" = a gap: nothing to say) */
function placeOf(at: MarkAt | undefined, F: MarkFrame): Anchor | string {
  if (!at || typeof at !== "object") return "no place";
  if ("s" in at) {
    const S = F.series.get(String(at.s));
    if (!S) return `series '${at.s}' not found`;
    const i = Math.floor(+at.i);
    if (!Number.isFinite(i) || i < 0) return `point ${at.i} of '${at.s}' not found`;
    return S.anchors[S.start + i] ?? "";
  }
  if ("g" in at) {
    const G = F.groups.get(String(at.g));
    if (!G) return `group '${at.g}' not found`;
    const k = at.edge === "end" ? G.start + G.len : G.start, P = F.plot;
    return F.horizontal ? { x: P.x + P.w, y: P.y + P.h - k * F.slot, top: P.y + P.h - k * F.slot, r: 0, color: F.ink }
      : { x: P.x + k * F.slot, y: P.y + P.h, top: P.y, r: 0, color: F.ink };
  }
  if (F.xp) {
    const x = typeof at.x === "number" ? at.x : typeof at.x === "string" && at.x.trim() ? +at.x : NaN, v = F.vp(+at.y, "y");
    if (!Number.isFinite(x)) return `x ${JSON.stringify(at.x)} not on the axis`;
    if (v === null || !Number.isFinite(+at.y)) return `value ${at.y} not on the axis`;
    const px = F.xp(x);
    return { x: px, y: v, top: v, r: 0, color: F.ink };
  }
  const k = typeof at.x === "string" ? F.cats.indexOf(at.x) : Math.floor(+at.x);
  if (!(k >= 0 && k < F.cats.length)) return `category ${JSON.stringify(at.x)} not found`;
  const v = F.vp(+at.y, at.axis === "y2" ? "y2" : "y");
  if (v === null || !Number.isFinite(+at.y)) return `value ${at.y} not on the axis`;
  const c = F.horizontal ? F.plot.y + F.plot.h - (k + .5) * F.slot : F.plot.x + (k + .5) * F.slot;
  return F.horizontal ? { x: v, y: c, top: c, r: 0, color: F.ink } : { x: c, y: v, top: v, r: 0, color: F.ink };
}
/** the floor / ceiling below / above a place */
const edgeOf = (a: Anchor, b: "floor" | "ceiling", F: MarkFrame): Anchor => F.horizontal
  ? { x: b === "floor" ? F.plot.x : F.plot.x + F.plot.w, y: a.y, top: a.y, r: 0, color: a.color }
  : { x: a.x, y: b === "floor" ? F.plot.y + F.plot.h : F.plot.y, top: b === "floor" ? F.plot.y + F.plot.h : F.plot.y, r: 0, color: a.color };
const box = (nodes: Node[]): Box | null => {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const add = (x: number, y: number) => { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); };
  for (const n of nodes) {
    if (n.t === "line") { add(n.x1, n.y1); add(n.x2, n.y2); }
    else if (n.t === "rect") { add(n.x, n.y); add(n.x + n.w, n.y + n.h); }
    else if (n.t === "path") for (const c of n.d) for (let k = 1; k + 1 < c.length; k += 2) add(c[k] as number, c[k + 1] as number);
    else if (n.t === "text") { add(n.x, n.y - n.size); add(n.x + (n.w ?? 0), n.y + n.size * .3); }
  }
  return Number.isFinite(x1) ? { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) } : null;
};

/** every mark's nodes (in id order: a later id on top), a hit per mark, and the Issues lines (a mark whose place or icon
    is not found; a quoted cell that cannot be read) */
export function markNodes(it: ChartItem, id: string, F: MarkFrame, ctx: RenderCtx, m: Metrics): MarksOut {
  const out: MarksOut = { nodes: [], under: [], hits: [], issues: [], arrows: [], native: [] };
  // (a mark switched off – B52's `off` – is kept, not drawn)
  const list = Object.entries(it.marks && typeof it.marks === "object" ? it.marks : {}).filter(([, k]) => k && typeof k === "object" && !k.off).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  for (const [mid, k] of list) {
    // (B52) a reference line, a gap arrow, change pills: chart-targets.ts, from the layout's targets
    if (k.kind === "ref" || k.kind === "gap" || k.kind === "change") {
      const T = F.targets;
      if (!T) continue;                                          // (not on this kind of chart: seriesLayout says so once)
      let r: TargetOut;
      if (k.kind === "ref") { const R = T.refs.get(mid); if (!R) continue; r = refNodes(R, m, T.refLabelX); }
      else r = k.kind === "gap" ? gapNodes(mid, k, T, m) : changeNodes(mid, k, T, m);
      out.issues.push(...r.issues);
      if (!r.nodes.length) continue;
      out.nodes.push(...r.nodes); out.native.push(...r.native);
      if (r.arrow) out.arrows.push({ ...r.arrow, head: r.arrow.head as Head | undefined, tail: r.arrow.tail as Head | undefined });
      const b = box(r.nodes);
      if (b) out.hits.push({ t: "hit", kind: "mark", id: `${id}:${mid}`, x: r2(b.x - 2), y: r2(b.y - 2), w: r2(b.w + 4), h: r2(b.h + 4), label: k.kind });
      continue;
    }
    const a = placeOf(k.a, F);
    if (typeof a === "string") { if (a) out.issues.push(`mark '${mid}': ${a}`); continue; }
    const own = HEX.test(k.style?.color || "") ? k.style!.color!.toUpperCase() : HEX.test(k.fmt?.color || "") ? k.fmt!.color!.toUpperCase() : null;
    const color = own || a.color || F.ink, nodes: Node[] = [];
    const bAt = (dflt: "floor" | "ceiling" | null): Anchor | string | null => k.b === "floor" || k.b === "ceiling" ? edgeOf(a, k.b, F) : k.b && typeof k.b === "object" ? placeOf(k.b, F) : dflt ? edgeOf(a, dflt, F) : null;
    const dy = Number.isFinite(+(k.dy as number)) ? +(k.dy as number) : -6;
    switch (k.kind) {
      case "arrow": case "line": {
        let b = bAt(k.kind === "arrow" ? "floor" : null);
        if (typeof b === "string") { if (b) out.issues.push(`mark '${mid}': ${b}`); continue; }
        // a line with one place: across the plot at its value (a reference line), or a group edge's floor to ceiling
        let a1: Anchor = a;
        if (!b) {
          if (k.a && "g" in k.a) { a1 = edgeOf(a, "ceiling", F); b = edgeOf(a, "floor", F); }
          else { const P = F.plot; a1 = F.horizontal ? { ...a, y: P.y } : { ...a, x: P.x }; b = F.horizontal ? { ...a, y: P.y + P.h } : { ...a, x: P.x + P.w }; }
        }
        const L = lineStyleOf(k.style, color, 1.5), dash = dashOf(L);
        const stroke: Stroke = { w: L.w, paint: solid(L.color), cap: "butt", ...(dash ? { dash } : {}) };
        const heads = k.style?.heads && typeof k.style.heads === "object" ? k.style.heads : k.kind === "arrow" ? { a: "triangle" as const } : undefined;
        // an arrow onto a marked point stops at the marker's ring
        const pa = { x: a1.x, y: a1.y }, pb = { x: b.x, y: b.y }, len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
        if (a1.r > 0 && len > a1.r + 2) { pa.x += (pb.x - pa.x) * (a1.r + 1) / len; pa.y += (pb.y - pa.y) * (a1.r + 1) / len; }
        const h = headed(pa, pb, stroke, heads), line: Node = { t: "line", x1: r2(h.a.x), y1: r2(h.a.y), x2: r2(h.b.x), y2: r2(h.b.y), stroke };
        nodes.push(line, ...h.nodes);
        // (S14.6, 09 §4.2: the export's native ends – the heads headed() drew, in its order: end a's, then end b's)
        const nA = headGeom(heads?.a, pa, pb, stroke.w, heads?.size) ? 1 : 0, nB = headGeom(heads?.b, pb, pa, stroke.w, heads?.size) ? 1 : 0;
        const ea = nA && heads!.a !== "bar" ? heads!.a : undefined, eb = nB && heads!.b !== "bar" ? heads!.b : undefined;
        out.arrows.push({ a: { x: r2(pa.x), y: r2(pa.y) }, b: { x: r2(pb.x), y: r2(pb.y) }, stroke, ...(ea ? { head: ea } : {}), ...(eb ? { tail: eb } : {}), ...(heads?.size ? { size: heads.size } : {}),
          drop: [line, ...(ea ? h.nodes.slice(0, nA) : []), ...(eb ? h.nodes.slice(nA, nA + nB) : [])] });
        break;
      }
      case "band": {
        const b = bAt(null);
        if (typeof b === "string" || !b) { out.issues.push(`mark '${mid}': ${b || "a band needs two places"}`); continue; }
        const P = F.plot;
        let x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
        if (x2 - x1 < 1) { x1 = P.x; x2 = P.x + P.w; }
        if (y2 - y1 < 1) { y1 = P.y; y2 = P.y + P.h; }
        nodes.push({ t: "rect", x: r2(x1), y: r2(y1), w: r2(x2 - x1), h: r2(y2 - y1), fill: { solid: parseColor(color).c, a: .15 } });
        break;
      }
      case "icon": {
        const size = Number.isFinite(+(k.size as number)) && +(k.size as number) > 0 ? Math.max(6, Math.min(200, +(k.size as number))) : 24;
        const ic = resolveIcon(k.icon), x0 = a.x - size / 2, y0 = a.top + dy - size, s = size / 24;
        if (ic.missing) out.issues.push(`mark '${mid}': icon '${ic.asked}' not found`);
        if (ic.src === "builtin") nodes.push({ t: "path", d: iconCmds(ic.name, r2(x0), r2(y0), s), fill: solid(color), rule: "evenodd" });
        // a vendored Tabler icon (M15): each path painted as the set says (filled dots, half-ink paths; S14.3 review 7)
        else nodes.push(...vendoredNodes(ic, r2(x0), r2(y0), s, parseColor(color).c));
        break;
      }
      case "text": {
        const t = calloutText(typeof k.text === "string" ? k.text : "", ctx);
        for (const x of t.missing) out.issues.push(`mark '${mid}': ${x} not found`);
        if (!t.text.trim()) continue;
        // (a text takes its anchor's colour unless that is light – luminance ≥ .6, the rule that puts white labels in dark
        // bars; the grey bar's #A6A6A6 is .65, 2.4 : 1 on white – then the design's ink; its own colour always wins;
        // S14.3 review 6)
        const st = F.withFmt({ ...F.lab, color: own || lum(color) < .6 ? color : F.ink }, k.fmt), lh = lineH(st);
        nodes.push(textNode(m, t.text, a.x, a.top + dy - lh, st, "center"));
        break;
      }
      default: continue;
    }
    const b = box(nodes);
    (k.kind === "band" ? out.under : out.nodes).push(...nodes);
    if (b) out.hits.push({ t: "hit", kind: "mark", id: `${id}:${mid}`, x: r2(b.x - 2), y: r2(b.y - 2), w: r2(b.w + 4), h: r2(b.h + 4), label: k.kind });
  }
  return out;
}
