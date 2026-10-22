/* Drags on the stage (ported from v3's editor/stage.ts): a column or row border, the table's corner (resize, keeps
   the proportions), a table border (stretch its columns or rows), the grip (move the table next to another), a text
   box's body (move anywhere, snapping) and its outer edges (stretch, snapping), a slide item's body (a chart: move, snapping)
   and its corner (resize). In a free layout (B18, 07 §5.1) every table, text box and item moves and resizes on its own
   (freeTable, and the text box / item drags writing the slide's free boxes); Alt held: no snapping. While the pointer moves, a preview is
   drawn from store state (at most once per animation frame); on pointer-up ONE operation is sent, one undo step, as
   in v3. */
import { slideCtx } from "@slide-builder/core/render/look";
import { get } from "../state/store";
import { change, ctx } from "../state/app";
import type { Layout, Note, Op, RuntimeSlide, Side } from "@slide-builder/core/model/types";
import { areaFor, computeLayout, freeKey, freeOf, GX, GY, itemBoxOf, layoutOf, MEMO_KEY, noteKey, sizingOf, sizingPatch, tableH, tableW, type TBox } from "@slide-builder/core/render/layout";
import { curSlide } from "../editor/edit";
import { selCols, selRows, setColWidth, setRowHeight, stretchTable } from "../editor/tables";
import { requestsIssued, setStage, stage } from "./data";
import { slidePatch, slideScale } from "./actions";
import type { Border } from "./hit";
import type { Rect } from "./model";
import { PART_LABEL, savedPart, type ContentsPart } from "@slide-builder/core/render/contents";

/** what a drag shows; `done`: the drag ended with a change – it stays until the slide drawn with that change arrives
    (data.ts), so nothing jumps back for a moment */
export type DragPreview = (
  | { kind: "border"; t: number; edge: Border; size: number }
  | { kind: "resize"; i: number; boxes: TBox[]; /** a free table's snapping guides */ v?: number | null; h?: number | null }
  | { kind: "stretch"; i: number; side: "l" | "r" | "t" | "b"; f: number; box: Rect }
  | { kind: "grip"; i: number; mark: Rect | null }
  | { kind: "note"; key: string; box: Rect; moved: boolean; v: number | null; h: number | null }
  | { kind: "item"; id: string; box: Rect; moved: boolean; v: number | null; h: number | null }
  /** a part of the contents slide in a free layout (B51): its box as it will be dropped */
  | { kind: "part"; part: ContentsPart; box: Rect; v: number | null; h: number | null }) & { done?: boolean; /** requests sent when it ended */ after?: number };

/* one store update per frame, however often the pointer moves */
let raf = 0, next: DragPreview | null = null;
function preview(p: DragPreview) {
  next = p;
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; setStage({ drag: next }); });
}
/** the drag ended: `changed` keeps its last preview (without guides) until the new slide is drawn, at most 2 s */
function endPreview(changed = false) {
  if (raf) cancelAnimationFrame(raf);
  const last = next; raf = 0; next = null;
  if (!changed || !last || last.kind === "border" || last.kind === "grip" || last.kind === "stretch") { setStage({ drag: null }); return; }
  const done: DragPreview = last.kind === "note" || last.kind === "item" || last.kind === "part" ? { ...last, v: null, h: null, done: true, after: requestsIssued() } : { ...last, done: true, after: requestsIssued() };
  setStage({ drag: done });
  setTimeout(() => { if (stage().drag === done) setStage({ drag: null }); }, 2000);
}
/** pointer listeners on the window for the rest of a drag (a redraw during the drag must not lose it); a cancelled
    pointer (the system took it) changes nothing: `cancel`, by default the preview goes */
function follow(move: (e: PointerEvent) => void, up: (e: PointerEvent) => void, cancel: () => void = () => endPreview()) {
  const m = (e: PointerEvent) => move(e);
  const u = (e: PointerEvent) => { removeEventListener("pointermove", m); removeEventListener("pointerup", u); removeEventListener("pointercancel", u); if (e.type === "pointercancel") cancel(); else up(e); };
  addEventListener("pointermove", m); addEventListener("pointerup", u); addEventListener("pointercancel", u);
}

/** a column / row border: the width or height of that column / row (of every selected one when it is selected) */
export function borderDrag(t: number, e: PointerEvent, edge: Border, k: number) {
  const sx = e.clientX, sy = e.clientY; let size = edge.size;
  preview({ kind: "border", t, edge, size });
  follow(ev => { size = Math.max(4, edge.size + (edge.kind === "col" ? ev.clientX - sx : ev.clientY - sy) / k); preview({ kind: "border", t, edge, size }); }, () => {
    endPreview();
    const T = curSlide()?.tables[t];
    if (!T || Math.abs(size - edge.size) < .5) return;
    const sel = get().selection.sel?.t === t ? (edge.kind === "col" ? selCols() : selRows()) : [];
    const keys = sel.includes(edge.key) ? sel : [edge.key];
    if (edge.kind === "col") setColWidth(T, keys, size); else setRowHeight(T, keys, size);
  });
}

/** the corner: the table's scale in its band, found by bisection so that the table is as large as the pointer */
export function resizeDrag(R: RuntimeSlide, i: number, e: PointerEvent) {
  const c = slideCtx(ctx(), R), sc = slideScale(), sx = e.clientX, sy = e.clientY;
  const start = computeLayout(R, c).boxes[i], base = layoutOf(R, c), w0 = base.w.slice(), T = R.tables[i];
  const lay: Layout = { bands: JSON.parse(JSON.stringify(base.bands)), w: w0.slice() };
  let moved = false, at: PointerEvent | null = null, frame = 0;
  // the layout for the pointer's latest position, once per frame (the bisection lays the slide out ~20 times)
  const solve = () => {
    frame = 0; const ev = at; if (!ev) return; at = null;
    const target = Math.max(30, Math.max(start.w + (ev.clientX - sx) / sc, (start.h + (ev.clientY - sy) / sc) * tableW(T, c) / tableH(T, c)));
    let lo = 0.05, hi = 30;                                // 22 halvings: the weight to 1/100 000 (it is kept to 1/1 000)
    for (let n = 0; n < 22; n++) { const mid = (lo + hi) / 2; const ww = w0.slice(); ww[i] = mid; if (computeLayout(R, c, ww, lay).boxes[i].w < target) lo = mid; else hi = mid; }
    lay.w = w0.slice(); lay.w[i] = Math.round(lo * 1000) / 1000; moved = true;
    // drawn in this frame (solve runs in one already: preview() would wait for the next)
    next = { kind: "resize", i, boxes: computeLayout(R, c, lay.w, lay).boxes }; setStage({ drag: next });
  };
  follow(ev => { at = ev; if (!frame) frame = requestAnimationFrame(solve); }, () => {
    if (frame) { cancelAnimationFrame(frame); solve(); }             // the last position counts
    endPreview(moved); setStage({ armed: false });
    if (moved) slidePatch("Resize table", R, sizingPatch(R, c, { ...sizingOf(R, c), layout: lay }));
  }, () => { if (frame) cancelAnimationFrame(frame); endPreview(); setStage({ armed: false }); });
}

/** a table border: every column (left / right) or row (top / bottom) stretched by the same factor */
export function stretchDrag(R: RuntimeSlide, i: number, side: "l" | "r" | "t" | "b", e: PointerEvent) {
  const horiz = side === "l" || side === "r", sc = slideScale(), sx = e.clientX, sy = e.clientY, b = computeLayout(R, ctx()).boxes[i];
  let f = 1;
  preview({ kind: "stretch", i, side, f, box: { x: b.x, y: b.y, w: b.w, h: b.h } });
  follow(ev => {
    const d = (horiz ? ev.clientX - sx : ev.clientY - sy) / sc * (side === "l" || side === "t" ? -1 : 1);
    f = Math.max(.2, Math.min(5, ((horiz ? b.w : b.h) + d) / (horiz ? b.w : b.h)));
    const w = (horiz ? b.w : b.h) * f;
    preview({ kind: "stretch", i, side, f, box: horiz ? { x: side === "l" ? b.x + b.w - w : b.x, y: b.y, w, h: b.h } : { x: b.x, y: side === "t" ? b.y + b.h - w : b.y, w: b.w, h: w } });
  }, () => {
    endPreview();
    if (Math.abs(f - 1) < .005) return;
    const L = curSlide()?.tables[i]; if (L && curSlide().id === R.id) stretchTable(L, horiz ? "x" : "y", f);
  });
}

/** the grip: drop the table beside another one (left / right in its band) or above / below that band */
export function gripDrag(R: RuntimeSlide, i: number, e: PointerEvent, slideEl: HTMLElement) {
  const c = ctx(), sc = slideScale(), rect = slideEl.getBoundingClientRect(), boxes = computeLayout(R, c).boxes;
  let drop: { t: number; zone: "left" | "right" | "top" | "bottom" } | null = null;
  preview({ kind: "grip", i, mark: null });
  follow(ev => {
    const px = (ev.clientX - rect.left) / sc, py = (ev.clientY - rect.top) / sc;
    let best = Infinity, cand: { t: number; b: TBox; zone: "left" | "right" | "top" | "bottom" } | null = null;
    for (const b of boxes) {
      if (!b || b.i === i) continue;
      const cx = Math.max(b.x, Math.min(px, b.x + b.w)), cy = Math.max(b.y, Math.min(py, b.y + b.h)), dist = Math.hypot(px - cx, py - cy);
      if (dist < best) { best = dist; const rx = (px - b.x) / b.w - .5, ry = (py - b.y) / b.h - .5; cand = { t: b.i, b, zone: Math.abs(rx) > Math.abs(ry) ? (rx < 0 ? "left" : "right") : (ry < 0 ? "top" : "bottom") }; }
    }
    let mark: Rect | null = null;
    if (cand && best < 240) {
      const b = cand.b;
      if (cand.zone === "left" || cand.zone === "right") mark = { x: cand.zone === "left" ? b.x - GX / 2 - 3 : b.x + b.w + GX / 2 - 3, y: b.y, w: 6, h: b.h };
      else { const bb = boxes.filter(x => x && x.band === b.band), l = Math.min(...bb.map(x => x.x)), r = Math.max(...bb.map(x => x.x + x.w)); mark = { x: l, y: cand.zone === "top" ? Math.min(...bb.map(x => x.y)) - GY / 2 - 3 : Math.max(...bb.map(x => x.y + x.h)) + GY / 2 - 3, w: r - l, h: 6 }; }
      drop = { t: cand.t, zone: cand.zone };
    } else drop = null;
    preview({ kind: "grip", i, mark });
  }, () => {
    endPreview();
    if (!drop) return;
    const lay: Layout = JSON.parse(JSON.stringify(layoutOf(R, c)));
    const bands = lay.bands.map(b => b.filter(x => x !== i)); const bi = bands.findIndex(b => b.includes(drop!.t));
    if (drop.zone === "left" || drop.zone === "right") { const p = bands[bi].indexOf(drop.t); bands[bi].splice(drop.zone === "left" ? p : p + 1, 0, i); }
    else bands.splice(drop.zone === "top" ? bi : bi + 1, 0, [i]);
    lay.bands = bands.filter(b => b.length);
    slidePatch("Move table", R, sizingPatch(R, c, { ...sizingOf(R, c), layout: lay }));
  });
}

/* ---- text boxes: stretching drags an outer edge (a box beside a table: its far edge and its bottom; above / below:
   its outer edge and its right edge; a free box: any edge); moving drags the body. Edges snap to the tables, the
   other text boxes, the page number, the footer and the content area, and a guide shows what they line up with */
export type NEdge = "l" | "r" | "t" | "b";
const STRETCH: Record<Side, NEdge[]> = { right: ["r", "b"], left: ["l", "b"], top: ["t", "r"], bottom: ["b", "r"] };
export function noteEdge(el: HTMLElement, e: PointerEvent | MouseEvent, free: boolean, side: Side): NEdge | null {
  const r = el.getBoundingClientRect(), tol = 7;
  const near: Record<NEdge, boolean> = { l: Math.abs(e.clientX - r.left) <= tol, r: Math.abs(e.clientX - r.right) <= tol, t: Math.abs(e.clientY - r.top) <= tol, b: Math.abs(e.clientY - r.bottom) <= tol };
  return (free ? (["l", "r", "t", "b"] as NEdge[]) : STRETCH[side]).find(k => near[k]) || null;
}
const SNAP = 8;
/** where edges can snap: the tables, the content area (50 / 1550, the footer line 822), other boxes as drawn */
export function snapTargets(R: RuntimeSlide, others: Rect[]): { x: number[]; y: number[] } {
  const c = ctx(), b = computeLayout(R, c).boxes, xs = [50, 1550], ys = [822];
  // a free layout also lines up with the slide's middle and the top of the content area
  if (freeOf(R, c)) { xs.push(800); ys.push(450, areaFor(R, c).y); }
  for (const t of b) if (t) { xs.push(t.x, t.x + t.w); ys.push(t.y, t.y + t.h); }
  for (const o of others) if ([o.x, o.y, o.w, o.h].every(isFinite)) { xs.push(o.x, o.x + o.w); ys.push(o.y, o.y + o.h); }
  return { x: xs, y: ys };
}
/* ---- free layout (B18): one slide.patch carrying the design's whole entry with the dragged box changed (one undo step) */
/** the op that puts box `key` of the slide's free layout at `box`; null when the layout is not free */
export function freeOp(R: RuntimeSlide, key: string, box: Rect & { scale?: number }): Op | null {
  const c = ctx(), f = freeOf(R, c); if (!f) return null;
  // what a drag moves stays on the slide (07 §5.1: clamped 0–1600 / 0–900, as text boxes are); not rounded – the sides a
  // drag does not move stay exactly where they were, and a moved table keeps its exact scale
  const w = Math.max(1, Math.min(1600, box.w)), h = Math.max(1, Math.min(900, box.h));
  const b = { x: Math.max(0, Math.min(1600 - w, box.x)), y: Math.max(0, Math.min(900 - h, box.y)), w, h, ...(box.scale ? { scale: box.scale } : {}) };
  return { op: "slide.patch", id: R.id, patch: { free: { [c.style.design]: { on: true, items: { ...f.items, [key]: b } } } } } as Op;
}
/** the slide with box `key` of its free layout at `box` (a drag's preview, laid out by the same computeLayout) */
function freeTrial(R: RuntimeSlide, key: string, box: Rect & { scale?: number }): RuntimeSlide {
  const c = ctx(), f = freeOf(R, c)!, d = c.style.design;
  return { ...R, cfg: { ...R.cfg, free: { ...R.cfg.free, [d]: { on: true, items: { ...f.items, [key]: box } } } } };
}
/** the nearest target within SNAP of one of the edges */
function snapTo(list: number[], edges: number[]) {
  let best: { d: number; line: number } | null = null;
  for (const t of list) for (const e of edges) { const d = t - e; if (Math.abs(d) <= SNAP && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line: t }; }
  return best;
}
/** a table of a free layout: moved by its grip, resized by its corner or an edge keeping the workbook's proportions – the
    corner and the edges set its scale (an edge from its own axis, the opposite side staying), its box follows */
export function freeTable(R: RuntimeSlide, i: number, how: "move" | "corner" | NEdge, e: PointerEvent) {
  if (e.button !== 0) return;
  const c = slideCtx(ctx(), R), T = R.tables[i], all = computeLayout(R, c).boxes, start = all[i], f = freeOf(R, c); if (!T || !start || !f) return;
  const W = tableW(T, c), H = tableH(T, c), sc = slideScale(), sx = e.clientX, sy = e.clientY, key = freeKey.table(R, i);
  // what it lines up with: the other tables, the text boxes, the items, the slide's guides
  // (the table's own text boxes without a saved box move with it: not targets)
  const others: Rect[] = [];
  all.forEach((b, k) => { if (!b) return; if (k !== i) others.push(b); for (const [side, n] of Object.entries(b.notes)) if (n && (k !== i || f.items[freeKey.note(noteKey(R, k, side as Side))])) others.push(n); });
  for (const id of Object.keys(R.cfg.items || {})) { const b = itemBoxOf(R, id, all, c); if (b) others.push(b); }
  const t = snapTargets({ ...R, tables: [] }, others);
  let box: Rect & { scale: number } = { x: start.x, y: start.y, w: start.w, h: start.h, scale: start.scale }, moved = false, at: PointerEvent | null = null, frame = 0;
  const solve = () => {
    frame = 0; const ev = at; if (!ev) return; at = null;
    const dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc, snap = !ev.altKey;
    if (!moved && Math.hypot(dx, dy) < 3) return;                       // a click is not a drag
    let v: number | null = null, h: number | null = null;
    if (how === "move") {
      let x = Math.max(0, Math.min(1600 - start.w, start.x + dx)), y = Math.max(0, Math.min(900 - start.h, start.y + dy));
      const bx = snap ? snapTo(t.x, [x, x + start.w]) : null, by = snap ? snapTo(t.y, [y, y + start.h]) : null;
      if (bx) { x += bx.d; v = bx.line; } if (by) { y += by.d; h = by.line; }
      // (a snap that would take it off the slide is not taken: the drop is where the preview is)
      const cx = Math.max(0, Math.min(1600 - start.w, x)), cy = Math.max(0, Math.min(900 - start.h, y));
      if (cx !== x) v = null; if (cy !== y) h = null;
      box = { ...box, x: cx, y: cy };
    } else {
      // the new width from the pointer (an edge: its own axis; the corner: the larger of the two), snapped at the moving edge
      const horiz = how === "l" || how === "r";
      let w = how === "corner" ? Math.max(start.w + dx, (start.h + dy) * W / H) : horiz ? start.w + (how === "l" ? -dx : dx) : (start.h + (how === "t" ? -dy : dy)) * W / H;
      if (snap) {
        if (how === "corner" || how === "r") { const s2 = snapTo(t.x, [start.x + w]); if (s2) { w += s2.d; v = s2.line; } }
        if (how === "l") { const s2 = snapTo(t.x, [start.x + start.w - w]); if (s2) { w -= s2.d; v = s2.line; } }
        if ((how === "corner" && v === null) || how === "b") { const s2 = snapTo(t.y, [start.y + w * H / W]); if (s2) { w += s2.d * W / H; h = s2.line; } }
        if (how === "t") { const s2 = snapTo(t.y, [start.y + start.h - w * H / W]); if (s2) { w -= s2.d * W / H; h = s2.line; } }
      }
      // at least 30 px wide, inside the slide on the sides that move
      const right = start.x + start.w, bottom = start.y + start.h;
      const maxW = Math.min(how === "l" ? right : 1600 - start.x, (how === "t" ? bottom : 900 - start.y) * W / H);
      w = Math.max(30, Math.min(maxW, w));
      const hh = w * H / W;
      box = { x: how === "l" ? right - w : start.x, y: how === "t" ? bottom - hh : start.y, w, h: hh, scale: w / W };
    }
    moved = true;
    // drawn in this frame (solve runs in one already)
    next = { kind: "resize", i, boxes: computeLayout(freeTrial(R, key, box), c).boxes, v, h }; setStage({ drag: next });
  };
  follow(ev => { at = ev; if (!frame) frame = requestAnimationFrame(solve); }, () => {
    if (frame) { cancelAnimationFrame(frame); solve(); }                // the last position counts
    endPreview(moved); setStage({ armed: false });
    const op = moved ? freeOp(R, key, box) : null;
    if (op) change(how === "move" ? "Move table" : "Resize table", [op]);
  }, () => { if (frame) cancelAnimationFrame(frame); endPreview(); setStage({ armed: false }); });
}

/** a part of the contents slide in a free layout (B51: its title, its list) – as a table of a free layout: moved by its
    grip, resized by its corner or an edge keeping its proportions (its scale against the design's own size of it);
    `start`: where it is drawn now. One slide.patch on the drop: one undo step */
export function freePart(R: RuntimeSlide, part: ContentsPart, how: "move" | "corner" | NEdge, start: Rect, others: Rect[], e: PointerEvent) {
  if (e.button !== 0) return;
  const c = slideCtx(ctx(), R); if (!freeOf(R, c)) return;
  const s0 = savedPart(R, c, part)?.scale ?? 1, W = start.w / s0, H = start.h / s0, sc = slideScale(), sx = e.clientX, sy = e.clientY, key = freeKey.part(part);
  const t = snapTargets({ ...R, tables: [] }, others);
  let box: Rect & { scale: number } = { ...start, scale: s0 }, moved = false, at: PointerEvent | null = null, frame = 0;
  const solve = () => {
    frame = 0; const ev = at; if (!ev) return; at = null;
    const dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc, snap = !ev.altKey;
    if (!moved && Math.hypot(dx, dy) < 3) return;                       // a click is not a drag
    let v: number | null = null, h: number | null = null;
    if (how === "move") {
      let x = Math.max(0, Math.min(1600 - start.w, start.x + dx)), y = Math.max(0, Math.min(900 - start.h, start.y + dy));
      const bx = snap ? snapTo(t.x, [x, x + start.w]) : null, by = snap ? snapTo(t.y, [y, y + start.h]) : null;
      if (bx) { x += bx.d; v = bx.line; } if (by) { y += by.d; h = by.line; }
      const cx = Math.max(0, Math.min(1600 - start.w, x)), cy = Math.max(0, Math.min(900 - start.h, y));
      if (cx !== x) v = null; if (cy !== y) h = null;
      box = { ...box, x: cx, y: cy };
    } else {
      const horiz = how === "l" || how === "r";
      let w = how === "corner" ? Math.max(start.w + dx, (start.h + dy) * W / H) : horiz ? start.w + (how === "l" ? -dx : dx) : (start.h + (how === "t" ? -dy : dy)) * W / H;
      if (snap) {
        if (how === "corner" || how === "r") { const s2 = snapTo(t.x, [start.x + w]); if (s2) { w += s2.d; v = s2.line; } }
        if (how === "l") { const s2 = snapTo(t.x, [start.x + start.w - w]); if (s2) { w -= s2.d; v = s2.line; } }
        if ((how === "corner" && v === null) || how === "b") { const s2 = snapTo(t.y, [start.y + w * H / W]); if (s2) { w += s2.d * W / H; h = s2.line; } }
        if (how === "t") { const s2 = snapTo(t.y, [start.y + start.h - w * H / W]); if (s2) { w -= s2.d * W / H; h = s2.line; } }
      }
      const right = start.x + start.w, bottom = start.y + start.h;
      const maxW = Math.min(how === "l" ? right : 1600 - start.x, (how === "t" ? bottom : 900 - start.y) * W / H);
      w = Math.max(Math.min(30, maxW), Math.min(maxW, w));
      const hh = w * H / W;
      box = { x: how === "l" ? right - w : start.x, y: how === "t" ? bottom - hh : start.y, w, h: hh, scale: w / W };
    }
    moved = true;
    next = { kind: "part", part, box, v, h }; setStage({ drag: next });
  };
  follow(ev => { at = ev; if (!frame) frame = requestAnimationFrame(solve); }, () => {
    if (frame) { cancelAnimationFrame(frame); solve(); }                // the last position counts
    endPreview(moved);
    const op = moved ? freeOp(R, key, box) : null;
    if (op) change((how === "move" ? "Move " : "Resize ") + PART_LABEL[part].toLowerCase(), [op]);
  }, () => { if (frame) cancelAnimationFrame(frame); endPreview(); });
}

export function noteStretch(R: RuntimeSlide, key: string, box: Rect, edge: NEdge, free: boolean, others: Rect[], e: PointerEvent) {
  const sc = slideScale(), cur = (R.cfg.notes || {})[key]; if (!cur) return;
  const { x: x0, y: y0, w: w0, h: h0 } = box, horiz = edge === "l" || edge === "r", targets = snapTargets(R, others);
  const sx = e.clientX, sy = e.clientY; let size = horiz ? w0 : h0, now = box, moved = false;
  follow(ev => {
    const d = (horiz ? ev.clientX - sx : ev.clientY - sy) / sc * (edge === "l" || edge === "t" ? -1 : 1);
    size = Math.max(horiz ? 120 : 40, (horiz ? w0 : h0) + d);
    // a free layout keeps the box on the slide on the side that moves (the other side stays where it is)
    const fl = free && key !== MEMO_KEY && !!freeOf(R, ctx()), room = edge === "r" ? 1600 - x0 : edge === "l" ? x0 + w0 : edge === "b" ? 900 - y0 : y0 + h0;
    if (fl) size = Math.min(size, Math.max(horiz ? 120 : 40, room));
    // the moving edge, in slide px, and the nearest edge it can line up with
    const pos = edge === "r" ? x0 + size : edge === "l" ? x0 + w0 - size : edge === "b" ? y0 + size : y0 + h0 - size;
    let best: number | null = null;
    if (!(ev.altKey && freeOf(R, ctx()))) for (const t of horiz ? targets.x : targets.y) if (Math.abs(t - pos) <= SNAP && (best === null || Math.abs(t - pos) < Math.abs(best - pos))) best = t;
    if (best !== null) size += (edge === "r" || edge === "b" ? 1 : -1) * (best - pos);
    if (fl) size = Math.min(size, Math.max(horiz ? 120 : 40, room));
    moved ||= Math.abs(horiz ? ev.clientX - sx : ev.clientY - sy) >= 3;
    now = horiz ? { x: edge === "l" ? x0 + w0 - size : x0, y: y0, w: size, h: h0 } : { x: x0, y: edge === "t" ? y0 + h0 - size : y0, w: w0, h: size };
    preview({ kind: "note", key, box: now, moved: false, v: horiz ? best : null, h: horiz ? null : best });
  }, () => {
    // (a box below the smallest size jumps to it on any jitter: only a real drag counts)
    const changed = moved && Math.abs(size - (horiz ? w0 : h0)) >= 1;
    endPreview(changed);
    if (!changed) return;
    // a free layout: the layout's box (the text box itself unchanged)
    const fo = key !== MEMO_KEY ? freeOp(R, freeKey.note(key), now) : null;
    if (fo) { change(horiz ? "Text box width" : "Text box height", [fo]); return; }
    const nextNote: Note = { ...cur, [horiz ? "w" : "h"]: Math.round(size) };
    // a free box dragged by its left / top edge also moves
    if (free) { nextNote.x = Math.round(now.x); nextNote.y = Math.round(now.y); }
    change(horiz ? "Text box width" : "Text box height", [{ op: "slide.patch", id: R.id, patch: { notes: { [key]: nextNote } } } as Op]);
  });
}
/** a slide item's body: moved anywhere on the slide, its edges snapping to the tables', text boxes' and other items'; one
    item.patch on the drop – a chart beside a table is placed freely from then on (as a moved text box) */
export function itemMove(R: RuntimeSlide, id: string, box: Rect, others: Rect[], e: PointerEvent) {
  if (e.button !== 0 || stage().editor || !R.cfg.items?.[id]) return;
  const sc = slideScale(), { x: x0, y: y0, w, h } = box, sx = e.clientX, sy = e.clientY;
  let started = false, nx = x0, ny = y0, targets: { x: number[]; y: number[] } | null = null;
  const snap = (a: number, size: number, list: number[]) => {
    let best: { d: number; line: number } | null = null;
    for (const t of list) for (const edge of [a, a + size]) { const d = t - edge; if (Math.abs(d) <= SNAP && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line: t }; }
    return best;
  };
  follow(ev => {
    const dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc;
    if (!started) { if (Math.hypot(dx, dy) < 4) return; started = true; targets = snapTargets(R, others); }
    nx = Math.max(0, Math.min(1600 - w, x0 + dx)); ny = Math.max(0, Math.min(900 - h, y0 + dy));
    // Alt: no snapping (B18's rule, as the free layout will have it)
    const bx = ev.altKey ? null : snap(nx, w, targets!.x), by = ev.altKey ? null : snap(ny, h, targets!.y);
    if (bx) nx += bx.d; if (by) ny += by.d;
    preview({ kind: "item", id, box: { x: nx, y: ny, w, h }, moved: true, v: bx ? bx.line : null, h: by ? by.line : null });
  }, () => {
    if (!started) return;
    endPreview(true);
    const it = R.cfg.items?.[id], label = it?.kind === "chart" ? "Move chart" : "Move shape";
    const fo = freeOp(R, freeKey.item(id), { x: nx, y: ny, w, h });
    if (fo) { change(label, [fo]); return; }
    change(label, [{ op: "item.patch", slide: R.id, id, patch: { box: { x: Math.round(nx), y: Math.round(ny), w: Math.round(w), h: Math.round(h) }, attach: null } } as Op]);
  });
}
/** a slide item's corner: its width and height (at least 80 × 60, inside the slide) – in a free layout also an edge (that
    side), snapping unless Alt is held; one op on the drop */
export function itemResize(R: RuntimeSlide, id: string, box: Rect, e: PointerEvent, edge: "corner" | NEdge = "corner", others: Rect[] = []) {
  if (e.button !== 0 || !R.cfg.items?.[id]) return;
  const sc = slideScale(), sx = e.clientX, sy = e.clientY, targets = freeOf(R, ctx()) ? snapTargets(R, others) : null; let now = box, moved = false;
  follow(ev => {
    const dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc;
    moved ||= Math.hypot(ev.clientX - sx, ev.clientY - sy) >= 3;
    let v: number | null = null, hl: number | null = null;
    if (edge === "corner") {
      let w = box.w + dx, h = box.h + dy;
      if (targets && !ev.altKey) { const a = snapTo(targets.x, [box.x + w]), b = snapTo(targets.y, [box.y + h]); if (a) { w += a.d; v = a.line; } if (b) { h += b.d; hl = b.line; } }
      now = { ...box, w: Math.max(80, Math.min(1600 - box.x, w)), h: Math.max(60, Math.min(900 - box.y, h)) };
    } else {
      const horiz = edge === "l" || edge === "r", far = edge === "r" || edge === "b";
      let size = (horiz ? box.w : box.h) + (horiz ? dx : dy) * (far ? 1 : -1);
      const pos = edge === "r" ? box.x + size : edge === "l" ? box.x + box.w - size : edge === "b" ? box.y + size : box.y + box.h - size;
      const s2 = targets && !ev.altKey ? snapTo(horiz ? targets.x : targets.y, [pos]) : null;
      if (s2) { size += (far ? 1 : -1) * s2.d; if (horiz) v = s2.line; else hl = s2.line; }
      size = Math.max(horiz ? 80 : 60, Math.min(edge === "r" ? 1600 - box.x : edge === "l" ? box.x + box.w : edge === "b" ? 900 - box.y : box.y + box.h, size));
      now = horiz ? { ...box, x: edge === "l" ? box.x + box.w - size : box.x, w: size } : { ...box, y: edge === "t" ? box.y + box.h - size : box.y, h: size };
    }
    preview({ kind: "item", id, box: now, moved: false, v, h: hl });
  }, () => {
    const changed = moved && (Math.abs(now.w - box.w) >= 1 || Math.abs(now.h - box.h) >= 1 || Math.abs(now.x - box.x) >= 1 || Math.abs(now.y - box.y) >= 1);
    endPreview(changed);
    if (!changed) return;
    const it = R.cfg.items?.[id];
    const fo = freeOp(R, freeKey.item(id), now);
    if (fo) { change(it?.kind === "chart" ? "Chart size" : "Shape size", [fo]); return; }
    // an item beside a table keeps its place there (the table makes room for its new size); a free one its corner
    change(it?.kind === "chart" ? "Chart size" : "Shape size", [{ op: "item.patch", slide: R.id, id, patch: { box: { x: Math.round(it?.attach ? it.box.x : box.x), y: Math.round(it?.attach ? it.box.y : box.y), w: Math.round(now.w), h: Math.round(now.h) } } } as Op]);
  });
}
export function noteMove(R: RuntimeSlide, key: string, box: Rect, others: Rect[], e: PointerEvent) {
  if (e.button !== 0 || stage().editor) return;
  const sc = slideScale(), cur = (R.cfg.notes || {})[key]; if (!cur) return;
  const { x: x0, y: y0, w, h } = box, sx = e.clientX, sy = e.clientY;
  let started = false, nx = x0, ny = y0, targets: { x: number[]; y: number[] } | null = null;
  const snap = (a: number, size: number, list: number[]) => {
    let best: { d: number; line: number } | null = null;
    for (const t of list) for (const edge of [a, a + size]) { const d = t - edge; if (Math.abs(d) <= SNAP && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line: t }; }
    return best;
  };
  follow(ev => {
    const dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc;
    if (!started) {
      if (Math.hypot(dx, dy) < 4) return;                          // a click (select, double-click to edit) is not a move
      started = true; targets = snapTargets(R, others);
    }
    nx = Math.max(0, Math.min(1600 - w, x0 + dx)); ny = Math.max(0, Math.min(900 - h, y0 + dy));
    const off = ev.altKey && !!freeOf(R, ctx()), bx = off ? null : snap(nx, w, targets!.x), by = off ? null : snap(ny, h, targets!.y);
    if (bx) nx += bx.d; if (by) ny += by.d;
    preview({ kind: "note", key, box: { x: nx, y: ny, w, h }, moved: true, v: bx ? bx.line : null, h: by ? by.line : null });
  }, () => {
    if (!started) return;
    endPreview(true);
    const fo = key !== MEMO_KEY ? freeOp(R, freeKey.note(key), { x: nx, y: ny, w, h }) : null;
    if (fo) { change("Move text box", [fo]); return; }
    const { span: _s, ...rest } = cur;
    change("Move text box", [{ op: "slide.patch", id: R.id, patch: { notes: { [key]: { ...rest, x: Math.round(nx), y: Math.round(ny), w: Math.round(w), h: Math.round(h) } } } } as Op]);
  });
}
