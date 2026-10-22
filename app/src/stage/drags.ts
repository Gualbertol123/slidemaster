/* Drags on the stage (ported from v3's editor/stage.ts): a column or row border, the table's corner (resize, keeps
   the proportions), a table border (stretch its columns or rows), the grip (move the table next to another), a text
   box's body (move anywhere, snapping) and its outer edges (stretch, snapping), a slide item's body (a chart: move, snapping)
   and its corner (resize). In a free layout (B18, 07 §5.1) every table, text box and item moves and resizes on its own
   (freeTable, and the text box / item drags writing the slide's free boxes). Moves and resizes snap (4.8, S15.4; 09 §5:
   core render/snap.ts – edges, centres, cell borders, equal gaps and sizes; Alt held: no snapping, everywhere) and drop
   on 1/4 px (snapRound) exactly where the preview showed them. While the pointer moves, a preview is
   drawn from store state (at most once per animation frame); on pointer-up ONE operation is sent, one undo step, as
   in v3. */
import { slideCtx } from "@slide-builder/core/render/look";
import { get } from "../state/store";
import { change, ctx } from "../state/app";
import type { Layout, Note, Op, RuntimeSlide, Side } from "@slide-builder/core/model/types";
import { areaFor, computeLayout, freeKey, freeOf, geomOf, GX, GY, itemBoxOf, layoutOf, MEMO_KEY, noteKey, sizingOf, sizingPatch, snapRound, tableH, tableW, type TBox } from "@slide-builder/core/render/layout";
import { resizeMarks, snapEdge, snapMove, snapTargets as coreTargets, snapTol, type SnapMarks, type SnapTargets } from "@slide-builder/core/render/snap";
import { routeOf } from "@slide-builder/core/render/line-dl";
import { lineNow } from "../editor/lines";
import { nudgePatch } from "../editor/chart-panel";
import { curSlide } from "../editor/edit";
import { selCols, selRows, setColWidth, setRowHeight, stretchTable } from "../editor/tables";
import { requestsIssued, setStage, stage } from "./data";
import { slidePatch, slideScale } from "./actions";
import { colEdges, rowEdges, type Border } from "./hit";
import type { Rect } from "./model";
import { PART_LABEL, savedPart, type ContentsPart } from "@slide-builder/core/render/contents";

/** what a drag shows; `done`: the drag ended with a change – it stays until the slide drawn with that change arrives
    (data.ts), so nothing jumps back for a moment */
export type DragPreview = (
  | { kind: "border"; t: number; edge: Border; size: number }
  | { kind: "resize"; i: number; boxes: TBox[]; /** a free table's snapping marks */ marks?: SnapMarks | null }
  | { kind: "stretch"; i: number; side: "l" | "r" | "t" | "b"; f: number; box: Rect }
  | { kind: "grip"; i: number; mark: Rect | null }
  | { kind: "note"; key: string; box: Rect; moved: boolean; /** what it lines up with (stage/guides.tsx) */ marks: SnapMarks | null }
  | { kind: "item"; id: string; box: Rect; moved: boolean; marks: SnapMarks | null }
  /** a part of the contents slide in a free layout (B51): its box as it will be dropped */
  | { kind: "part"; part: ContentsPart; box: Rect; marks: SnapMarks | null }) & { done?: boolean; /** requests sent when it ended */ after?: number };

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
  const done: DragPreview = last.kind === "note" || last.kind === "item" || last.kind === "part" ? { ...last, marks: null, done: true, after: requestsIssued() } : { ...last, done: true, after: requestsIssued() };
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
/* ---- snapping (4.8, S15.4; 09 §5, F8): every object's drag – a table of a free layout, a text box, the notes section, a
   chart, a shape or icon, a line (stage/lines.tsx) – lines up with the slide's edges, centre lines and margins, the other
   objects' edges and centres, the other tables' cell borders, the other lines' ends and middles, and with equal gaps
   and sizes (core render/snap.ts, its targets collected once at pointer-down); SNAP = 8 px on screen (snapTol); Alt
   held: no snapping, for every object in every layout. What is dropped is what the preview showed: the moving
   positions on 1/4 px (snapRound). */
/** what a drag snaps to: the slide's (core snap.ts), the tables as drawn – their boxes and cell borders – but `self.table`,
    the slide items but `self.item` (lines: their ends and middles), and `others` (the text boxes, the page number…) */
export function snapTargets(R: RuntimeSlide, others: Rect[], self: { table?: number; item?: string } = {}): SnapTargets {
  const c = slideCtx(ctx(), R), boxes = computeLayout(R, c).boxes, list: Rect[] = [], cells: { x: number[]; y: number[] }[] = [], points: { x: number; y: number }[] = [];
  boxes.forEach((b, i) => {
    if (!b || i === self.table) return;
    list.push({ x: b.x, y: b.y, w: b.w, h: b.h });
    const T = R.tables[i];
    // its column and row borders (an exhibit has none: its cells are not a grid)
    if (T && geomOf(c) !== "exhibit") cells.push({ x: colEdges(T, c).map(([x0, w]) => b.x + (x0 + w) * b.scale), y: rowEdges(T).map(([y0, h]) => b.y + (y0 + h) * b.scale) });
  });
  for (const [id, it] of Object.entries(R.cfg.items || {})) {
    if (id === self.item || !it) continue;
    if (it.kind === "line") { const L = lineNow(R, id, ctx(), boxes); if (L) points.push(L.a, L.b, routeOf(L.it, L.a, L.b).mid); continue; }
    const b = itemBoxOf(R, id, boxes, c); if (b) list.push(b);
  }
  const seen = new Set<string>();
  const uniq = [...list, ...others].filter(b => { const k = b && [b.x, b.y, b.w, b.h].join(); if (!b || seen.has(k)) return false; seen.add(k); return true; });
  return coreTargets({ boxes: uniq, cells, points, top: areaFor(R, c).y });
}
/* ---- free layout (B18): one slide.patch carrying the design's whole entry with the dragged box changed (one undo step) */
/** the op that puts box `key` of the slide's free layout at `box`; null when the layout is not free */
export function freeOp(R: RuntimeSlide, key: string, box: Rect & { scale?: number }): Op | null {
  const c = ctx(), f = freeOf(R, c); if (!f) return null;
  // what a drag moves stays on the slide (07 §5.1: clamped 0–1600 / 0–900, as text boxes are); not rounded here – the drags
  // put what they move on 1/4 px (snapRound), the sides a drag does not move stay exactly where they were, and a moved
  // table keeps its exact scale
  const w = Math.max(1, Math.min(1600, box.w)), h = Math.max(1, Math.min(900, box.h));
  const b = { x: Math.max(0, Math.min(1600 - w, box.x)), y: Math.max(0, Math.min(900 - h, box.y)), w, h, ...(box.scale ? { scale: box.scale } : {}) };
  return { op: "slide.patch", id: R.id, patch: { free: { [c.style.design]: { on: true, items: { ...f.items, [key]: b } } } } } as Op;
}
/** the slide with box `key` of its free layout at `box` (a drag's preview, laid out by the same computeLayout) */
function freeTrial(R: RuntimeSlide, key: string, box: Rect & { scale?: number }): RuntimeSlide {
  const c = ctx(), f = freeOf(R, c)!, d = c.style.design;
  return { ...R, cfg: { ...R.cfg, free: { ...R.cfg.free, [d]: { on: true, items: { ...f.items, [key]: box } } } } };
}
/** v down to 1/4 px (the furthest a box of an unrounded size can go on the slide and stay on the grid) */
const floor4 = (v: number) => Math.floor(v * 4 + 1e-9) / 4;
/** a moved box at (x, y), kept on the slide: snapped (unless Alt) and on 1/4 px – the preview and the drop. Kept on the
    slide after rounding (S15.4 review 1): a box of an unrounded size (a free table's, from its scale) pushed against the
    right or bottom edge stops at the last 1/4 px that keeps it on the slide, so freeOp's clamp leaves it as previewed */
export function moved(T: SnapTargets, b: Rect, alt: boolean, tol: number): { box: Rect; marks: SnapMarks | null } {
  const s = alt ? null : snapMove(T, b, tol);
  const box = s ? s.box : b;
  return { box: { ...box, x: Math.max(0, Math.min(snapRound(box.x), floor4(1600 - box.w))), y: Math.max(0, Math.min(snapRound(box.y), floor4(900 - box.h))) }, marks: s ? s.marks : null };
}
/** a table of a free layout: moved by its grip, resized by its corner or an edge keeping the workbook's proportions – the
    corner and the edges set its scale (an edge from its own axis, the opposite side staying), its box follows */
export function freeTable(R: RuntimeSlide, i: number, how: "move" | "corner" | NEdge, e: PointerEvent) {
  if (e.button !== 0) return;
  const c = slideCtx(ctx(), R), T = R.tables[i], all = computeLayout(R, c).boxes, start = all[i], f = freeOf(R, c); if (!T || !start || !f) return;
  const W = tableW(T, c), H = tableH(T, c), sc = slideScale(), tol = snapTol(sc), sx = e.clientX, sy = e.clientY, key = freeKey.table(R, i);
  // what it lines up with: the other tables, the text boxes, the items, the slide's guides
  // (the table's own text boxes without a saved box move with it: not targets)
  const others: Rect[] = [];
  all.forEach((b, k) => { if (!b) return; for (const [side, n] of Object.entries(b.notes)) if (n && (k !== i || f.items[freeKey.note(noteKey(R, k, side as Side))])) others.push(n); });
  const t = snapTargets(R, others, { table: i });
  let box: Rect & { scale: number } = { x: start.x, y: start.y, w: start.w, h: start.h, scale: start.scale }, moved0 = false, at: PointerEvent | null = null, frame = 0;
  const solve = () => {
    frame = 0; const ev = at; if (!ev) return; at = null;
    const dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc, snap = !ev.altKey;
    if (!moved0 && Math.hypot(dx, dy) < 3) return;                      // a click is not a drag
    let marks: SnapMarks | null = null;
    if (how === "move") {
      const m = moved(t, { x: Math.max(0, Math.min(1600 - start.w, start.x + dx)), y: Math.max(0, Math.min(900 - start.h, start.y + dy)), w: start.w, h: start.h }, !snap, tol);
      box = { ...box, x: m.box.x, y: m.box.y }; marks = m.marks;
    } else if (how === "t" || how === "b") {
      // a top or bottom edge (S15.4 review 2): the new height from the pointer, snapped at the moving edge, on 1/4 px – the
      // width and the scale follow from it (the workbook's proportions), so the snapped edge is where the guide is
      const bottom = start.y + start.h;
      let h = start.h + (how === "t" ? -dy : dy);
      if (snap) h += how === "b" ? snapEdge(t, false, start.y + h, tol, { now: h, sign: 1 }) : -snapEdge(t, false, bottom - h, tol, { now: h, sign: -1 });
      const maxH = Math.min(how === "t" ? bottom : 900 - start.y, (1600 - start.x) * H / W);
      h = Math.max(30 * H / W, Math.min(maxH, snapRound(h)));
      const w = h * W / H;
      box = { x: start.x, y: how === "t" ? snapRound(bottom - h) : start.y, w, h, scale: w / W };
      if (snap) marks = resizeMarks(t, box, { y: [how] }, { w: true, h: true });
    } else {
      // the new width from the pointer (a side edge: its own axis; the corner: the larger of the two), snapped at the
      // moving edge – to a target or to another object's width / height
      let w = how === "corner" ? Math.max(start.w + dx, (start.h + dy) * W / H) : start.w + (how === "l" ? -dx : dx);
      if (snap) {
        if (how === "corner" || how === "r") w += snapEdge(t, true, start.x + w, tol, { now: w, sign: 1 });
        else w -= snapEdge(t, true, start.x + start.w - w, tol, { now: w, sign: -1 });
      }
      // at least 30 px wide, inside the slide on the sides that move; the width on 1/4 px
      const right = start.x + start.w;
      const maxW = Math.min(how === "l" ? right : 1600 - start.x, (900 - start.y) * W / H);
      w = Math.max(30, Math.min(maxW, snapRound(w)));
      const hh = w * H / W;
      box = { x: how === "l" ? snapRound(right - w) : start.x, y: start.y, w, h: hh, scale: w / W };
      if (snap) marks = resizeMarks(t, box, how === "corner" ? { x: ["r"], y: ["b"] } : { x: [how === "l" ? "l" : "r"] }, { w: true, h: true });
    }
    moved0 = true;
    // drawn in this frame (solve runs in one already)
    next = { kind: "resize", i, boxes: computeLayout(freeTrial(R, key, box), c).boxes, marks }; setStage({ drag: next });
  };
  follow(ev => { at = ev; if (!frame) frame = requestAnimationFrame(solve); }, () => {
    if (frame) { cancelAnimationFrame(frame); solve(); }                // the last position counts
    endPreview(moved0); setStage({ armed: false });
    const op = moved0 ? freeOp(R, key, box) : null;
    if (op) change(how === "move" ? "Move table" : "Resize table", [op]);
  }, () => { if (frame) cancelAnimationFrame(frame); endPreview(); setStage({ armed: false }); });
}

/** an edge moved by a resize: its new size (at least `min`, at most `room`), snapped at the moving edge unless Alt – to a
    target or to another object's size – on 1/4 px; the box it gives and its marks */
function edgeResize(T: SnapTargets | null, box: Rect, edge: NEdge, size0: number, min: number, room: number, alt: boolean, tol: number): { box: Rect; marks: SnapMarks | null } {
  const horiz = edge === "l" || edge === "r", far = edge === "r" || edge === "b";
  let size = Math.max(min, Math.min(room, size0));
  if (T && !alt) {
    const pos = edge === "r" ? box.x + size : edge === "l" ? box.x + box.w - size : edge === "b" ? box.y + size : box.y + box.h - size;
    size += (far ? 1 : -1) * snapEdge(T, horiz, pos, tol, { now: size, sign: far ? 1 : -1 });
  }
  size = Math.max(min, Math.min(room, snapRound(size)));
  const out = horiz ? { x: edge === "l" ? snapRound(box.x + box.w - size) : box.x, y: box.y, w: size, h: box.h } : { x: box.x, y: edge === "t" ? snapRound(box.y + box.h - size) : box.y, w: box.w, h: size };
  return { box: out, marks: T && !alt ? resizeMarks(T, out, horiz ? { x: [far ? "r" : "l"] } : { y: [far ? "b" : "t"] }, horiz ? { w: true } : { h: true }) : null };
}

/** a part of the contents slide in a free layout (B51: its title, its list) – as a table of a free layout: moved by its
    grip, resized by its corner or an edge keeping its proportions (its scale against the design's own size of it);
    `start`: where it is drawn now. Snaps as every object does (4.8, S15.4: snapMove / snapEdge, Alt: none) and drops on
    1/4 px. One slide.patch on the drop: one undo step */
export function freePart(R: RuntimeSlide, part: ContentsPart, how: "move" | "corner" | NEdge, start: Rect, others: Rect[], e: PointerEvent) {
  if (e.button !== 0) return;
  const c = slideCtx(ctx(), R); if (!freeOf(R, c)) return;
  const s0 = savedPart(R, c, part)?.scale ?? 1, W = start.w / s0, H = start.h / s0, sc = slideScale(), tol = snapTol(sc), sx = e.clientX, sy = e.clientY, key = freeKey.part(part);
  const t = snapTargets({ ...R, tables: [] }, others);
  let box: Rect & { scale: number } = { ...start, scale: s0 }, moved0 = false, at: PointerEvent | null = null, frame = 0;
  const solve = () => {
    frame = 0; const ev = at; if (!ev) return; at = null;
    const dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc, snap = !ev.altKey;
    if (!moved0 && Math.hypot(dx, dy) < 3) return;                     // a click is not a drag
    let marks: SnapMarks | null = null;
    if (how === "move") {
      const m = moved(t, { x: Math.max(0, Math.min(1600 - start.w, start.x + dx)), y: Math.max(0, Math.min(900 - start.h, start.y + dy)), w: start.w, h: start.h }, !snap, tol);
      box = { ...box, x: m.box.x, y: m.box.y }; marks = m.marks;
    } else if (how === "t" || how === "b") {
      // the new height from the pointer, snapped at the moving edge, on 1/4 px – the width and the scale follow from it
      const bottom = start.y + start.h;
      let h = start.h + (how === "t" ? -dy : dy);
      if (snap) h += how === "b" ? snapEdge(t, false, start.y + h, tol, { now: h, sign: 1 }) : -snapEdge(t, false, bottom - h, tol, { now: h, sign: -1 });
      const maxH = Math.min(how === "t" ? bottom : 900 - start.y, (1600 - start.x) * H / W);
      h = Math.max(Math.min(30 * H / W, maxH), Math.min(maxH, snapRound(h)));
      const w = h * W / H;
      box = { x: start.x, y: how === "t" ? snapRound(bottom - h) : start.y, w, h, scale: w / W };
      if (snap) marks = resizeMarks(t, box, { y: [how] }, { w: true, h: true });
    } else {
      // the new width from the pointer (a side edge: its own axis; the corner: the larger of the two), snapped at the moving edge
      let w = how === "corner" ? Math.max(start.w + dx, (start.h + dy) * W / H) : start.w + (how === "l" ? -dx : dx);
      if (snap) {
        if (how === "corner" || how === "r") w += snapEdge(t, true, start.x + w, tol, { now: w, sign: 1 });
        else w -= snapEdge(t, true, start.x + start.w - w, tol, { now: w, sign: -1 });
      }
      const right = start.x + start.w;
      const maxW = Math.min(how === "l" ? right : 1600 - start.x, (900 - start.y) * W / H);
      w = Math.max(Math.min(30, maxW), Math.min(maxW, snapRound(w)));
      const hh = w * H / W;
      box = { x: how === "l" ? snapRound(right - w) : start.x, y: start.y, w, h: hh, scale: w / W };
      if (snap) marks = resizeMarks(t, box, how === "corner" ? { x: ["r"], y: ["b"] } : { x: [how === "l" ? "l" : "r"] }, { w: true, h: true });
    }
    moved0 = true;
    next = { kind: "part", part, box, marks }; setStage({ drag: next });
  };
  follow(ev => { at = ev; if (!frame) frame = requestAnimationFrame(solve); }, () => {
    if (frame) { cancelAnimationFrame(frame); solve(); }                // the last position counts
    endPreview(moved0);
    const op = moved0 ? freeOp(R, key, box) : null;
    if (op) change((how === "move" ? "Move " : "Resize ") + PART_LABEL[part].toLowerCase(), [op]);
  }, () => { if (frame) cancelAnimationFrame(frame); endPreview(); });
}

export function noteStretch(R: RuntimeSlide, key: string, box: Rect, edge: NEdge, free: boolean, others: Rect[], e: PointerEvent) {
  const sc = slideScale(), tol = snapTol(sc), cur = (R.cfg.notes || {})[key]; if (!cur) return;
  const { x: x0, y: y0, w: w0, h: h0 } = box, horiz = edge === "l" || edge === "r", targets = snapTargets(R, others);
  const sx = e.clientX, sy = e.clientY; let now = box, moved0 = false;
  follow(ev => {
    const d = (horiz ? ev.clientX - sx : ev.clientY - sy) / sc * (edge === "l" || edge === "t" ? -1 : 1);
    // a free layout keeps the box on the slide on the side that moves (the other side stays where it is)
    const fl = free && key !== MEMO_KEY && !!freeOf(R, ctx()), min = horiz ? 120 : 40, room = edge === "r" ? 1600 - x0 : edge === "l" ? x0 + w0 : edge === "b" ? 900 - y0 : y0 + h0;
    const r = edgeResize(targets, box, edge, (horiz ? w0 : h0) + d, min, fl ? Math.max(min, room) : Infinity, ev.altKey, tol);
    moved0 ||= Math.abs(horiz ? ev.clientX - sx : ev.clientY - sy) >= 3;
    now = r.box;
    preview({ kind: "note", key, box: now, moved: false, marks: r.marks });
  }, () => {
    // (a box below the smallest size jumps to it on any jitter: only a real drag counts)
    const changed = moved0 && Math.abs((horiz ? now.w : now.h) - (horiz ? w0 : h0)) >= 1;
    endPreview(changed);
    if (!changed) return;
    // a free layout: the layout's box (the text box itself unchanged)
    const fo = key !== MEMO_KEY ? freeOp(R, freeKey.note(key), now) : null;
    if (fo) { change(horiz ? "Text box width" : "Text box height", [fo]); return; }
    const nextNote: Note = { ...cur, [horiz ? "w" : "h"]: horiz ? now.w : now.h };
    // a free box dragged by its left / top edge also moves
    if (free) { nextNote.x = now.x; nextNote.y = now.y; }
    change(horiz ? "Text box width" : "Text box height", [{ op: "slide.patch", id: R.id, patch: { notes: { [key]: nextNote } } } as Op]);
  });
}
/** a slide item's body: moved anywhere on the slide, lining up with the slide, the tables, text boxes and other items
    (snapping, Alt: none); one item.patch on the drop – a chart beside a table is placed freely from then on (as a moved
    text box) */
export function itemMove(R: RuntimeSlide, id: string, box: Rect, others: Rect[], e: PointerEvent) {
  if (e.button !== 0 || stage().editor || !R.cfg.items?.[id]) return;
  const sc = slideScale(), tol = snapTol(sc), { x: x0, y: y0 } = box, w = snapRound(box.w), h = snapRound(box.h), sx = e.clientX, sy = e.clientY;
  // its targets collected at pointer-down, not in the first drag frame (S15.4 review 4)
  const targets = snapTargets(R, others, { item: id });
  let started = false, nx = x0, ny = y0;
  follow(ev => {
    const dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc;
    if (!started) { if (Math.hypot(dx, dy) < 4) return; started = true; }
    const m = moved(targets, { x: Math.max(0, Math.min(1600 - w, x0 + dx)), y: Math.max(0, Math.min(900 - h, y0 + dy)), w, h }, ev.altKey, tol);
    nx = m.box.x; ny = m.box.y;
    preview({ kind: "item", id, box: { x: nx, y: ny, w, h }, moved: true, marks: m.marks });
  }, () => {
    if (!started) return;
    endPreview(true);
    const it = R.cfg.items?.[id], label = it?.kind === "chart" ? "Move chart" : "Move shape";
    const fo = freeOp(R, freeKey.item(id), { x: nx, y: ny, w, h });
    if (fo) { change(label, [fo]); return; }
    change(label, [{ op: "item.patch", slide: R.id, id, patch: { box: { x: nx, y: ny, w, h }, attach: null } } as Op]);
  });
}
/** a slide item's corner: its width and height (at least 80 × 60, inside the slide) – in a free layout also an edge (that
    side), snapping unless Alt is held; one op on the drop */
export function itemResize(R: RuntimeSlide, id: string, box: Rect, e: PointerEvent, edge: "corner" | NEdge = "corner", others: Rect[] = []) {
  if (e.button !== 0 || !R.cfg.items?.[id]) return;
  const sc = slideScale(), tol = snapTol(sc), sx = e.clientX, sy = e.clientY, targets = snapTargets(R, others, { item: id }); let now = box, moved0 = false;
  follow(ev => {
    const dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc;
    moved0 ||= Math.hypot(ev.clientX - sx, ev.clientY - sy) >= 3;
    let marks: SnapMarks | null = null;
    if (edge === "corner") {
      let w = box.w + dx, h = box.h + dy;
      if (!ev.altKey) { w += snapEdge(targets, true, box.x + w, tol, { now: w, sign: 1 }); h += snapEdge(targets, false, box.y + h, tol, { now: h, sign: 1 }); }
      now = { ...box, w: Math.max(80, Math.min(1600 - box.x, snapRound(w))), h: Math.max(60, Math.min(900 - box.y, snapRound(h))) };
      if (!ev.altKey) marks = resizeMarks(targets, now, { x: ["r"], y: ["b"] }, { w: true, h: true });
    } else {
      const horiz = edge === "l" || edge === "r", far = edge === "r" || edge === "b";
      const r = edgeResize(targets, box, edge, (horiz ? box.w : box.h) + (horiz ? dx : dy) * (far ? 1 : -1), horiz ? 80 : 60, edge === "r" ? 1600 - box.x : edge === "l" ? box.x + box.w : edge === "b" ? 900 - box.y : box.y + box.h, ev.altKey, tol);
      now = r.box; marks = r.marks;
    }
    preview({ kind: "item", id, box: now, moved: false, marks });
  }, () => {
    const changed = moved0 && (Math.abs(now.w - box.w) >= 1 || Math.abs(now.h - box.h) >= 1 || Math.abs(now.x - box.x) >= 1 || Math.abs(now.y - box.y) >= 1);
    endPreview(changed);
    if (!changed) return;
    const it = R.cfg.items?.[id];
    const fo = freeOp(R, freeKey.item(id), now);
    if (fo) { change(it?.kind === "chart" ? "Chart size" : "Shape size", [fo]); return; }
    // an item beside a table keeps its place there (the table makes room for its new size); a free one its corner
    change(it?.kind === "chart" ? "Chart size" : "Shape size", [{ op: "item.patch", slide: R.id, id, patch: { box: { x: it?.attach ? it.box.x : now.x, y: it?.attach ? it.box.y : now.y, w: now.w, h: now.h } } } as Op]);
  });
}
export function noteMove(R: RuntimeSlide, key: string, box: Rect, others: Rect[], e: PointerEvent) {
  if (e.button !== 0 || stage().editor) return;
  const sc = slideScale(), tol = snapTol(sc), cur = (R.cfg.notes || {})[key]; if (!cur) return;
  const { x: x0, y: y0 } = box, w = snapRound(box.w), h = snapRound(box.h), sx = e.clientX, sy = e.clientY;
  // its targets collected at pointer-down, not in the first drag frame (S15.4 review 4)
  const targets = snapTargets(R, others);
  let started = false, nx = x0, ny = y0;
  follow(ev => {
    const dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc;
    if (!started) {
      if (Math.hypot(dx, dy) < 4) return;                          // a click (select, double-click to edit) is not a move
      started = true;
    }
    // Alt: no snapping, in every layout (09 §5.1: before 4.8 a text box ignored Alt outside a free layout)
    const m = moved(targets, { x: Math.max(0, Math.min(1600 - w, x0 + dx)), y: Math.max(0, Math.min(900 - h, y0 + dy)), w, h }, ev.altKey, tol);
    nx = m.box.x; ny = m.box.y;
    preview({ kind: "note", key, box: { x: nx, y: ny, w, h }, moved: true, marks: m.marks });
  }, () => {
    if (!started) return;
    endPreview(true);
    const fo = key !== MEMO_KEY ? freeOp(R, freeKey.note(key), { x: nx, y: ny, w, h }) : null;
    if (fo) { change("Move text box", [fo]); return; }
    const { span: _s, ...rest } = cur;
    change("Move text box", [{ op: "slide.patch", id: R.id, patch: { notes: { [key]: { ...rest, x: nx, y: ny, w, h } } } } as Op]);
  });
}

/** (B53) a chart's label dragged on the stage (the selected chart's title, a point value, a reference line's, gap arrow's
    or pill's label, a caption): a dashed ghost of its box follows the pointer; on the drop the label's offset from where
    the chart puts it (ChartItem.nudge, a fraction of the chart's box: it follows the data and a resize) – one op, one
    undo step. A click that does not move (under 3 px) changes nothing and is a click: `click` (the stage selects the mark
    or point under it, as without a label – B53 review) */
export function labelDrag(R: RuntimeSlide, id: string, key: string, box: Rect, itemBox: Rect, host: HTMLElement, e: PointerEvent, click?: () => void) {
  if (e.button !== 0) return;
  const sc = slideScale(), sx = e.clientX, sy = e.clientY;
  const ghost = document.createElement("div");
  ghost.className = "labelghost"; ghost.dataset.label = key;
  ghost.style.cssText = `position:absolute;left:${box.x - itemBox.x}px;top:${box.y - itemBox.y}px;width:${box.w}px;height:${box.h}px;outline:1px dashed #0A66D8;pointer-events:none`;
  host.appendChild(ghost);
  let dx = 0, dy = 0;
  follow(ev => {
    dx = (ev.clientX - sx) / sc; dy = (ev.clientY - sy) / sc;
    ghost.style.transform = `translate(${dx}px,${dy}px)`;
  }, () => {
    ghost.remove();
    if (Math.hypot(dx, dy) < 3) { click?.(); return; }
    const it = R.cfg.items?.[id];
    if (!it || it.kind !== "chart") return;
    change("Move chart label", [{ op: "item.patch", slide: R.id, id, patch: nudgePatch(it, key, dx, dy, itemBox) } as Op]);
  }, () => ghost.remove());
}
