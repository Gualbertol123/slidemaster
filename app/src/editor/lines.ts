/* Lines on slides (4.8, M15 S15.3; docs/next/09 §2.3, §5.3; LN-01, LN-02): insert one of the owner's kinds (straight
   line, arrow, double arrow, elbow, curve, bracket, range marker, limiter, divider, callout line), restyle it, and the
   operations its handles send on the drop – each change ONE undo step:
   - an end moved: that end's point; with Ctrl near an object's anchor point it attaches there (`ends.a` / `ends.b`),
     dropped anywhere else it is free again (09 §5.3); Shift keeps a straight line at 0 / 45 / 90°;
   - the middle: a straight line or a range moves whole (both ends free), an elbow's bend moves (`mid`, 0–1 along the
     run), a curve's bulge and a bracket's depth follow the pointer (`mid`, px);
   - the line's body: the whole line moves (both ends free).
   Where the ends are saved: automatic layout – the item's a / b (and its box, which item.patch needs); free layout of
   this design – the design's free entry `free[design].items["i:<id>"]`, its bounds plus a / b (09 §2.3), one
   slide.patch with the design's whole entry as every free-layout drag. An attached end is saved at its resolved point
   too, so it stays there if its object goes. Pure builders (lineOps…) beside the actions that send them. */
import type { Anchor, Heads, LineItem, LineRoute, LineStyle, Op, RuntimeSlide, TextFmt } from "@slide-builder/core/model/types";
import type { RenderCtx } from "@slide-builder/core/render/context";
import { computeLayout, freeKey, freeOf, snapRound } from "@slide-builder/core/render/layout";
import { ANCHOR_AT, anchorPoint, anchorTargets, lineBox, lineEnds, routeOf, type Pt } from "@slide-builder/core/render/line-dl";
import { slideCtx } from "@slide-builder/core/render/look";
import { change, ctx } from "../state/app";
import { curSlide } from "./edit";
import { newItemId, selectItem } from "./charts";

/* ---- the kinds of line the owner listed (09 §2.3): presets of one item ---- */
export type LinePreset = "line" | "arrow" | "double" | "elbow" | "curve" | "bracket" | "range" | "limiter" | "divider" | "callout";
export const LINE_PRESETS: { id: LinePreset; label: string; title: string }[] = [
  { id: "line", label: "Line", title: "A straight line" },
  { id: "arrow", label: "Arrow", title: "A straight arrow" },
  { id: "double", label: "Double arrow", title: "An arrow at both ends" },
  { id: "elbow", label: "Elbow", title: "An elbow arrow: horizontal, then vertical (drag its middle to move the bend)" },
  { id: "curve", label: "Curve", title: "A curved arrow (drag its middle to bend it)" },
  { id: "bracket", label: "Bracket", title: "A square bracket between two points (drag its middle for its depth), with a label" },
  { id: "range", label: "Range marker", title: "A line with ticks at its ends and a label above it" },
  { id: "limiter", label: "Limiter", title: "A line with a tick at each end" },
  { id: "divider", label: "Divider", title: "A thin dashed line across the slide, in the design's rule colour" },
  { id: "callout", label: "Callout line", title: "A thin line with a small arrow: attach its ends to a callout and a table with Ctrl" },
];
/** a new line of a kind, centred at (cx, cy) on the slide (1600 × 900) */
export function presetLine(p: LinePreset, cx = 800, cy = 450): LineItem {
  const span = (w: number, h = 0): { a: Pt; b: Pt } => ({ a: { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2) }, b: { x: Math.round(cx + w / 2), y: Math.round(cy + h / 2) } });
  const make = (route: LineRoute, e: { a: Pt; b: Pt }, extra: Partial<LineItem> = {}): LineItem => ({ kind: "line", route, ...e, ...extra, box: lineBox(e.a, e.b) });
  switch (p) {
    case "arrow": return make("straight", span(320), { style: { heads: { b: "triangle" } } });
    case "double": return make("straight", span(320), { style: { heads: { a: "triangle", b: "triangle" } } });
    case "elbow": return make("elbow", span(320, 160), { bend: "hv", mid: .5, style: { heads: { b: "triangle" } } });
    case "curve": return make("curve", span(320), { mid: -60, style: { heads: { b: "triangle" } } });
    case "bracket": return make("bracket", span(320), { mid: 16, text: "Label" });
    case "range": return make("range", span(320), { text: "+0 %" });
    case "limiter": return make("straight", span(320), { style: { heads: { a: "bar", b: "bar" } } });
    case "divider": return make("straight", { a: { x: 50, y: Math.round(cy) }, b: { x: 1550, y: Math.round(cy) } }, { style: { w: 1, dash: "dashed" } });
    case "callout": return make("straight", span(240, 120), { style: { w: 1.5, heads: { b: "arrow", size: "s" } } });
    default: return make("straight", span(320));
  }
}
/** Insert line ▾: a new line of that kind in the middle of the slide, selected (one undo step) */
export function insertLine(p: LinePreset) {
  const R = curSlide(); if (!R) return null;
  const id = newItemId(), it = presetLine(p);
  change("Insert " + (LINE_PRESETS.find(x => x.id === p)?.label.toLowerCase() || "line"), [{ op: "item.patch", slide: R.id, id, patch: it } as Op]);
  selectItem(id);
  return id;
}

/* ---- where a line is now (this design), and what its handles change ---- */
export interface LineNow { it: LineItem; a: Pt; b: Pt; attached: ("a" | "b")[]; lost: ("a" | "b")[] }
/** the line `id` of slide R as drawn in this design: its resolved ends (`boxes`: the slide's layout, when the caller
    has it – the stage resolves every line of a slide on one layout) */
export function lineNow(R: RuntimeSlide, id: string, c: RenderCtx, boxes?: ReturnType<typeof computeLayout>["boxes"]): LineNow | null {
  const it = R.cfg.items?.[id]; if (!it || it.kind !== "line") return null;
  const sc = slideCtx(c, R), e = lineEnds(R, id, it, boxes ?? computeLayout(R, sc).boxes, sc);
  return e ? { it, a: e.a, b: e.b, attached: e.attached, lost: e.lost } : null;
}
type EndsPatch = { a?: Anchor; b?: Anchor } | null;
/** the ops that put the line's ends at a / b (rounded to 1/4 px), and – when given – its attachments (replaced whole;
    null: none) and other keys of the item (mid…): one item.patch in automatic layout; in this design's free layout the
    design's entry (one slide.patch) plus an item.patch for what is not per design */
export function lineOps(R: RuntimeSlide, id: string, c: RenderCtx, a: Pt, b: Pt, more: { ends?: EndsPatch; mid?: number } = {}): Op[] {
  const q = (v: number) => Math.round(v * 4) / 4, A = { x: q(a.x), y: q(a.y) }, B = { x: q(b.x), y: q(b.y) };
  const sc = slideCtx(c, R), f = freeOf(R, sc), item: Record<string, unknown> = {};
  if ("ends" in more) item.ends = more.ends && (more.ends.a || more.ends.b) ? more.ends : null;
  if (more.mid !== undefined) item.mid = Math.round(more.mid * 1000) / 1000;
  if (f) {
    const ops: Op[] = [{ op: "slide.patch", id: R.id, patch: { free: { [sc.style.design]: { on: true, items: { ...f.items, [freeKey.item(id)]: { ...lineBox(A, B), a: A, b: B } } } } } } as Op];
    if (Object.keys(item).length) ops.push({ op: "item.patch", slide: R.id, id, patch: item } as Op);
    return ops;
  }
  return [{ op: "item.patch", slide: R.id, id, patch: { a: A, b: B, box: lineBox(A, B), ...item } } as Op];
}
/** every anchor point (09 §5.3: Ctrl attaches) of the slide's objects as drawn in this design – never the line itself;
    worked out once per drag */
export function anchorList(R: RuntimeSlide, id: string, c: RenderCtx): { anchor: Anchor; at: Pt }[] {
  const sc = slideCtx(c, R);
  return anchorTargets(R, computeLayout(R, sc).boxes, sc, id).flatMap(t => ANCHOR_AT.map(at => ({ anchor: { to: t.to, at }, at: anchorPoint(t.box, at) })));
}
/** the nearest of them within `tol` px of p */
export function nearestAnchor(list: { anchor: Anchor; at: Pt }[], p: Pt, tol: number): { anchor: Anchor; at: Pt } | null {
  let best: { anchor: Anchor; at: Pt } | null = null, bd = tol;
  for (const x of list) { const d = Math.hypot(x.at.x - p.x, x.at.y - p.y); if (d <= bd) { best = x; bd = d; } }
  return best;
}
/** Shift: the end at 0 / 45 / 90° from the other one (as PowerPoint), the same length */
export function snap45(from: Pt, p: Pt): Pt {
  const dx = p.x - from.x, dy = p.y - from.y, L = Math.hypot(dx, dy), ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4;
  return { x: from.x + Math.round(Math.cos(ang) * L * 100) / 100, y: from.y + Math.round(Math.sin(ang) * L * 100) / 100 };
}
/** an end dragged to p: attached to `anchor` (Ctrl near an object) or free again */
export function endOps(R: RuntimeSlide, id: string, c: RenderCtx, k: "a" | "b", p: Pt, anchor: Anchor | null): Op[] | null {
  const L = lineNow(R, id, c); if (!L) return null;
  const ends: { a?: Anchor; b?: Anchor } = { ...(L.it.ends || {}) };
  if (anchor) ends[k] = anchor; else delete ends[k];
  const a = k === "a" ? p : L.a, b = k === "b" ? p : L.b;
  return lineOps(R, id, c, a, b, { ends });
}
/** the whole line moved by (dx, dy): both ends free (09 §5.3) */
export function moveOps(R: RuntimeSlide, id: string, c: RenderCtx, dx: number, dy: number): Op[] | null {
  const L = lineNow(R, id, c); if (!L) return null;
  return lineOps(R, id, c, { x: L.a.x + dx, y: L.a.y + dy }, { x: L.b.x + dx, y: L.b.y + dy }, L.it.ends ? { ends: null } : {});
}
/** the middle handle dragged to p: a straight line or a range moves whole; an elbow's bend, a curve's bulge, a
    bracket's depth follow the pointer */
export function midOps(R: RuntimeSlide, id: string, c: RenderCtx, p: Pt): Op[] | null {
  const L = lineNow(R, id, c); if (!L) return null;
  const { it, a, b } = L;
  if (it.route === "straight" || it.route === "range") { const m = routeOf(it, a, b).mid; return moveOps(R, id, c, p.x - m.x, p.y - m.y); }
  return [{ op: "item.patch", slide: R.id, id, patch: { mid: midFor(it, a, b, p) } } as Op];
}
/** the `mid` a middle handle at p gives (elbow: 0–1 along its first run; curve / bracket: px off the chord, signed). An
    elbow's bend goes on 1/4 px – the point, not the fraction, is rounded (S15.4 review 3: a fraction on 1/1000 put a bend
    snapped to a guide up to span / 2000 px off it) – the fraction kept to 1e-9, which routeOf draws back on that point */
export function midFor(it: Pick<LineItem, "route" | "bend">, a: Pt, b: Pt, p: Pt): number {
  if (it.route === "elbow") {
    const t = it.bend === "vh" ? (b.y - a.y ? (snapRound(p.y) - a.y) / (b.y - a.y) : .5) : (b.x - a.x ? (snapRound(p.x) - a.x) / (b.x - a.x) : .5);
    return Math.round(Math.max(0, Math.min(1, t)) * 1e9) / 1e9;
  }
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
  return Math.round(((p.x - (a.x + b.x) / 2) * nx + (p.y - (a.y + b.y) / 2) * ny) * 4) / 4;
}

/* ---- the ribbon's changes of the selected line (LineTools.tsx): each one item.patch ---- */
const send = (label: string, id: string, patch: Record<string, unknown>) => { const R = curSlide(); if (R) change(label, [{ op: "item.patch", slide: R.id, id, patch } as Op]); };
/** its style with `p` over it (style is one key, replaced whole: 09 §2.3) */
export function setLineStyle(label: string, id: string, it: LineItem, p: Partial<LineStyle & { heads: Heads }>) {
  const st: Record<string, unknown> = { ...(it.style || {}), ...p };
  if (st.heads && typeof st.heads === "object") {
    const h = Object.fromEntries(Object.entries(st.heads).filter(([, v]) => v !== undefined));
    st.heads = Object.keys(h).length ? h : undefined;
  }
  for (const k of Object.keys(st)) if (st[k] === undefined) delete st[k];
  send(label, id, { style: Object.keys(st).length ? st : null });
}
export const setLineRoute = (id: string, it: LineItem, route: LineRoute) =>
  send("Line kind", id, { route, ...(route !== it.route && it.mid !== undefined ? { mid: null } : {}), ...(route === "elbow" && !it.bend ? { bend: "hv" } : {}) });
export const setLineBend = (id: string, bend: "hv" | "vh") => send("Elbow direction", id, { bend });
export const setLineText = (id: string, text: string) => send("Line label", id, { text: text.trim() ? text : null });
export const setLineFmt = (id: string, fmt: Partial<Record<keyof TextFmt, unknown>>) => send("Label format", id, { fmt });
/** both ends free again (its ends stay where they are drawn now) */
export function detachLine(id: string) {
  const R = curSlide(), c = ctx(); if (!R) return;
  const L = lineNow(R, id, c); if (!L) return;
  change("Detach line", lineOps(R, id, c, L.a, L.b, { ends: null }));
}
/** its two ends swapped (the heads stay at the same places of the line) */
export function reverseLine(id: string) {
  const R = curSlide(), c = ctx(); if (!R) return;
  const L = lineNow(R, id, c); if (!L) return;
  const h = L.it.style?.heads, e = L.it.ends;
  const ops = lineOps(R, id, c, L.b, L.a, { ends: e ? { ...(e.b ? { a: e.b } : {}), ...(e.a ? { b: e.a } : {}) } : null });
  const last = ops[ops.length - 1] as Extract<Op, { op: "item.patch" }>;
  const extra: Record<string, unknown> = h ? { style: { ...L.it.style, heads: { ...(h.b ? { a: h.b } : {}), ...(h.a ? { b: h.a } : {}), ...(h.size ? { size: h.size } : {}) } } } : {};
  if (L.it.route === "elbow") extra.mid = 1 - (L.it.mid ?? .5);
  if (L.it.route === "curve" || L.it.route === "bracket") extra.mid = -(L.it.mid ?? (L.it.route === "bracket" ? 16 : Math.hypot(L.b.x - L.a.x, L.b.y - L.a.y) * .25));
  if (last.op === "item.patch") last.patch = { ...(last.patch || {}), ...extra } as never;
  else ops.push({ op: "item.patch", slide: R.id, id, patch: extra } as Op);
  change("Reverse line", ops);
}
