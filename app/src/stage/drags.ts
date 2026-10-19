/* Drags on the stage (ported from v3's editor/stage.ts): a column or row border, the table's corner (resize, keeps
   the proportions), a table border (stretch its columns or rows), the grip (move the table next to another), a text
   box's body (move anywhere, snapping) and its outer edges (stretch, snapping), a slide item's body (a chart: move, snapping)
   and its corner (resize). While the pointer moves, a preview is
   drawn from store state (at most once per animation frame); on pointer-up ONE operation is sent, one undo step, as
   in v3. */
import { get } from "../state/store";
import { change, ctx } from "../state/app";
import type { Layout, Note, Op, RuntimeSlide, Side } from "@slide-builder/core/model/types";
import { computeLayout, GX, GY, layoutOf, sizingOf, sizingPatch, tableH, tableW, type TBox } from "@slide-builder/core/render/layout";
import { curSlide } from "../editor/edit";
import { selCols, selRows, setColWidth, setRowHeight, stretchTable } from "../editor/tables";
import { requestsIssued, setStage, stage } from "./data";
import { slidePatch, slideScale } from "./actions";
import type { Border } from "./hit";
import type { Rect } from "./model";

/** what a drag shows; `done`: the drag ended with a change – it stays until the slide drawn with that change arrives
    (data.ts), so nothing jumps back for a moment */
export type DragPreview = (
  | { kind: "border"; t: number; edge: Border; size: number }
  | { kind: "resize"; i: number; boxes: TBox[] }
  | { kind: "stretch"; i: number; side: "l" | "r" | "t" | "b"; f: number; box: Rect }
  | { kind: "grip"; i: number; mark: Rect | null }
  | { kind: "note"; key: string; box: Rect; moved: boolean; v: number | null; h: number | null }
  | { kind: "item"; id: string; box: Rect; moved: boolean; v: number | null; h: number | null }) & { done?: boolean; /** requests sent when it ended */ after?: number };

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
  const done: DragPreview = last.kind === "note" || last.kind === "item" ? { ...last, v: null, h: null, done: true, after: requestsIssued() } : { ...last, done: true, after: requestsIssued() };
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
  const c = ctx(), sc = slideScale(), sx = e.clientX, sy = e.clientY;
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
  const b = computeLayout(R, ctx()).boxes, xs = [50, 1550], ys = [822];
  for (const t of b) if (t) { xs.push(t.x, t.x + t.w); ys.push(t.y, t.y + t.h); }
  for (const o of others) if ([o.x, o.y, o.w, o.h].every(isFinite)) { xs.push(o.x, o.x + o.w); ys.push(o.y, o.y + o.h); }
  return { x: xs, y: ys };
}
export function noteStretch(R: RuntimeSlide, key: string, box: Rect, edge: NEdge, free: boolean, others: Rect[], e: PointerEvent) {
  const sc = slideScale(), cur = (R.cfg.notes || {})[key]; if (!cur) return;
  const { x: x0, y: y0, w: w0, h: h0 } = box, horiz = edge === "l" || edge === "r", targets = snapTargets(R, others);
  const sx = e.clientX, sy = e.clientY; let size = horiz ? w0 : h0, now = box;
  follow(ev => {
    const d = (horiz ? ev.clientX - sx : ev.clientY - sy) / sc * (edge === "l" || edge === "t" ? -1 : 1);
    size = Math.max(horiz ? 120 : 40, (horiz ? w0 : h0) + d);
    // the moving edge, in slide px, and the nearest edge it can line up with
    const pos = edge === "r" ? x0 + size : edge === "l" ? x0 + w0 - size : edge === "b" ? y0 + size : y0 + h0 - size;
    let best: number | null = null;
    for (const t of horiz ? targets.x : targets.y) if (Math.abs(t - pos) <= SNAP && (best === null || Math.abs(t - pos) < Math.abs(best - pos))) best = t;
    if (best !== null) size += (edge === "r" || edge === "b" ? 1 : -1) * (best - pos);
    now = horiz ? { x: edge === "l" ? x0 + w0 - size : x0, y: y0, w: size, h: h0 } : { x: x0, y: edge === "t" ? y0 + h0 - size : y0, w: w0, h: size };
    preview({ kind: "note", key, box: now, moved: false, v: horiz ? best : null, h: horiz ? null : best });
  }, () => {
    endPreview(Math.abs(size - (horiz ? w0 : h0)) >= 1);
    if (Math.abs(size - (horiz ? w0 : h0)) < 1) return;
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
    const it = R.cfg.items?.[id];
    change(it?.kind === "chart" ? "Move chart" : "Move shape", [{ op: "item.patch", slide: R.id, id, patch: { box: { x: Math.round(nx), y: Math.round(ny), w: Math.round(w), h: Math.round(h) }, attach: null } } as Op]);
  });
}
/** a slide item's corner: its width and height (at least 80 × 60, inside the slide); one item.patch on the drop */
export function itemResize(R: RuntimeSlide, id: string, box: Rect, e: PointerEvent) {
  if (e.button !== 0 || !R.cfg.items?.[id]) return;
  const sc = slideScale(), sx = e.clientX, sy = e.clientY; let now = box;
  follow(ev => {
    const w = Math.max(80, Math.min(1600 - box.x, box.w + (ev.clientX - sx) / sc)), h = Math.max(60, Math.min(900 - box.y, box.h + (ev.clientY - sy) / sc));
    now = { ...box, w, h };
    preview({ kind: "item", id, box: now, moved: false, v: null, h: null });
  }, () => {
    const changed = Math.abs(now.w - box.w) >= 1 || Math.abs(now.h - box.h) >= 1;
    endPreview(changed);
    if (!changed) return;
    const it = R.cfg.items?.[id];
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
    const bx = snap(nx, w, targets!.x), by = snap(ny, h, targets!.y);
    if (bx) nx += bx.d; if (by) ny += by.d;
    preview({ kind: "note", key, box: { x: nx, y: ny, w, h }, moved: true, v: bx ? bx.line : null, h: by ? by.line : null });
  }, () => {
    if (!started) return;
    endPreview(true);
    const { span: _s, ...rest } = cur;
    change("Move text box", [{ op: "slide.patch", id: R.id, patch: { notes: { [key]: { ...rest, x: Math.round(nx), y: Math.round(ny), w: Math.round(w), h: Math.round(h) } } } } as Op]);
  });
}
