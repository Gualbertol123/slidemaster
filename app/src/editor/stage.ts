/* The slide being edited: imperative DOM for speed (one overlay per table, binary-search hit
   testing, only changed cells are swapped after an edit). */
import { get, patch, patchAll, STAGE, toast, useStore } from "../state/store";
import { change, ctx, setZoom } from "../state/app";
import type { Item, TableLayout } from "../xlsx/types";
import type { Layout, Op, RuntimeSlide } from "../model/types";
import { MEMO_KEY, applyLayout, buildSlide, computeLayout, GX, GY, layoutOf, sizingOf, sizingPatch, tableHtml, tableW, type SlideEl } from "../render/slide";
import { glassGeom, gItem } from "../render/glass";
import { effFmt, effText } from "../render/edits";
import { activeItem, commitText, curSlide, itemAt, selItems, setSel } from "./edit";
import { selCols, selRows, setColWidth, setRowHeight, shownColW, shownRowH, stretchTable } from "./tables";
import { applyPainter } from "./painter";
import type { Note, Side, SlideTextKey } from "../model/types";
import { selectSlideText } from "./textfmt";
import { todayLabel } from "../render/cover";
import { commentText } from "../render/comment";

let host: HTMLElement | null = null, unsubscribe: (() => void) | null = null;
export function mountStage(el: HTMLElement) {
  host = el;
  STAGE.render = renderStage; STAGE.refresh = refreshStage; STAGE.paintSel = paintSel; STAGE.fit = fitStage;
  removeEventListener("resize", fitStage); addEventListener("resize", fitStage);
  // the stage follows the slices it draws: the selection (cells, slide text, text box, painter) and the zoom.
  // Slides are redrawn by the document changes (state/app.ts), which know whether a refresh is enough.
  unsubscribe?.();
  const subs = [
    useStore.subscribe(s => s.selection, (now, was) => {
      if (now.sel !== was.sel || now.textSel !== was.textSel) paintSel();
      if (now.noteSel !== was.noteSel) paintNoteSel();
      if (!now.painter !== !was.painter) document.body.classList.toggle("painting", !!now.painter);
    }),
    useStore.subscribe(s => s.ui.zoom, () => fitStage()),
  ];
  unsubscribe = () => subs.forEach(f => f());
  renderStage();
}
const wrapEl = () => host?.querySelector<HTMLElement & { _scale?: number }>(".stagewrap") || null;
export const slideScale = () => wrapEl()?._scale || 1;

/* geometry of a cell on screen (Liquid Glass widens columns) */
function cellBox(it: Item): Item { if (ctx().style.design !== "glass" || !it.L) return it; return gItem(it, glassGeom(it.L, ctx())); }

/* while a cell, title or text box is being edited on the slide, redraws (autosave, other people's changes)
   wait: rebuilding the slide would throw away the editor and what is being typed */
let pendingRender = false;
const editorOpen = () => !!host?.querySelector(".inline-edit");
function afterEdit() { setTimeout(() => { if (pendingRender && !editorOpen()) { pendingRender = false; renderStage(); } }, 0); }
export function renderStage() {
  if (!host) return;
  if (editorOpen()) { pendingRender = true; return; }
  pendingRender = false;
  host.innerHTML = "";
  const R = curSlide(); if (!R) return;
  const wrap = document.createElement("div") as HTMLDivElement & { _scale?: number }; wrap.className = "stagewrap";
  const slide = buildSlide(R, get().deck.cur, ctx(), { interactive: true });
  wrap.appendChild(slide); host.appendChild(wrap);
  slide.querySelectorAll<HTMLElement & { _html?: string }>(":scope > .tw").forEach(tw => { tw._html = tableHtml(R, +tw.dataset.i!, ctx()); });
  // the logo warning follows the latest load: a failure earlier (e.g. before the file was copied) does not stick
  slide.querySelectorAll<HTMLImageElement>("img.logo").forEach(img => {
    img.addEventListener("error", () => { (img.parentNode as HTMLElement).style.display = "none"; if (!get().ui.logoMissing) patch("ui", { logoMissing: true }); });
    img.addEventListener("load", () => { if (get().ui.logoMissing) patch("ui", { logoMissing: false }); });
  });
  wireSlide(slide, R);
  fitStage(); paintSel();
}
export function fitStage() {
  const wrap = wrapEl(); if (!host || !wrap) return;
  const cw = host.clientWidth, ch = host.clientHeight;
  const fit = Math.min((cw - 56) / 1600, (ch - 64) / 900);
  const zoom = get().ui.zoom, s = zoom === "fit" ? fit : zoom;
  const slide = wrap.querySelector<HTMLElement>(".slide")!; slide.style.transform = `scale(${s})`;
  wrap.style.width = 1600 * s + "px"; wrap.style.height = 900 * s + "px";
  wrap.style.left = Math.max(16, (cw - 1600 * s) / 2) + "px"; wrap.style.top = Math.max(16, (ch - 900 * s) / 2) + "px";
  host.style.overflow = zoom === "fit" ? "hidden" : "auto";
  wrap._scale = s;
  const zv = document.getElementById("zoomVal"); if (zv) zv.textContent = Math.round(s * 100) + "%";
}
export function zoomBy(f: number) { setZoom(Math.max(.2, Math.min(3, slideScale() * f))); paintSel(); }

function patchTable(oldEl: Element, newEl: Element) {
  const a = oldEl.children, b = newEl.children;
  if (a.length !== b.length || oldEl.getAttribute("style") !== newEl.getAttribute("style")) { oldEl.replaceWith(newEl); return; }
  for (let i = b.length - 1; i >= 0; i--) if (!a[i].isEqualNode(b[i])) a[i].replaceWith(b[i]);
}
/** after cell edits: re-render only the tables whose HTML changed, swapping only changed elements */
export function refreshStage() {
  const slide = wrapEl()?.querySelector<SlideEl>(".slide"), R = curSlide();
  if (!slide || !R || slide._rid !== R.id || slide.querySelectorAll(":scope > .tw").length !== R.tables.length) return renderStage();
  if (Object.values(R.cfg.notes || {}).some(n => n.auto)) return renderStage();     // automated comments follow the numbers
  if (slide._notes !== JSON.stringify(R.cfg.notes || {})) return renderStage();      // a text box was added, moved or changed
  const c = ctx();
  slide.querySelectorAll<HTMLElement & { _html?: string }>(":scope > .tw").forEach(tw => {
    const i = +tw.dataset.i!, L = R.tables[i], html = tableHtml(R, i, c);
    if (tw._html === html) return;
    const tmp = document.createElement("div"); tmp.innerHTML = html;
    patchTable(tw.querySelector(".xt")!, tmp.firstElementChild!);
    tw._html = html; tw.style.width = tableW(L, c) + "px";
    const hits = tw.querySelector<HTMLElement>(".hits"); if (hits) hits.style.width = tableW(L, c) + "px";
  });
  applyLayout(slide, R, c); paintSel();
}

/* ---- hit testing: binary search over column/row edges ---- */
type Edge = [number, number, number];
function colEdges(T: TableLayout): Edge[] {
  const c = ctx(), glassy = c.style.design === "glass", G = glassy ? glassGeom(T, c) : null, key = glassy ? "g" + G!.key : "x";
  const cache = (T._cache || (T._cache = {})) as Record<string, unknown>;
  const hit = cache.ce as { key: string; list: Edge[] } | undefined;
  if (hit && hit.key === key) return hit.list;
  const list = T.cols.map(col => (glassy ? [G!.X.get(col)!, G!.Wc.get(col)!, col] : [T.colX.get(col)!, T.colW.get(col)!, col]) as Edge);
  cache.ce = { key, list }; return list;
}
function bsearch(list: Edge[], v: number): Edge | undefined { let lo = 0, hi = list.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (list[m][0] <= v) lo = m; else hi = m - 1; } return list[lo]; }
function cellFromPoint(T: TableLayout, lx: number, ly: number) {
  const col = bsearch(colEdges(T), lx);
  const cache = (T._cache || (T._cache = {})) as Record<string, unknown>;
  const rows = (cache.re || (cache.re = T.rows.map(r => [T.rowY.get(r)!, T.rowH.get(r)!, r]))) as Edge[];
  const row = bsearch(rows, ly);
  if (!col || !row) return null;
  return itemAt(T, row[2], col[2]) || null;
}
function pointToCell(hits: HTMLElement, e: PointerEvent | MouseEvent) {
  const T = curSlide().tables[+hits.dataset.t!], rc = hits.getBoundingClientRect(), k = rc.width / tableW(T, ctx());
  return cellFromPoint(T, (e.clientX - rc.left) / k, (e.clientY - rc.top) / k);
}
export function paintSel() {
  const slide = host?.querySelector(".slide"); if (!slide) return;
  slide.querySelectorAll(".selbox,.actbox").forEach(e => e.remove());
  slide.querySelectorAll(".tsel").forEach(e => e.classList.remove("tsel"));
  if (get().selection.textSel) slide.querySelector(`[data-edit="${get().selection.textSel}"]`)?.classList.add("tsel");
  const sel = get().selection.sel; if (!sel || !curSlide()) return;
  const its = selItems().map(cellBox); if (!its.length) return;
  const hits = slide.querySelector(`.hits[data-t="${sel.t}"]`); if (!hits) return;
  const x0 = Math.min(...its.map(a => a.bx)), y0 = Math.min(...its.map(a => a.by)), x1 = Math.max(...its.map(a => a.bx + a.bw)), y1 = Math.max(...its.map(a => a.by + a.bh));
  const b = computeLayout(curSlide(), ctx()).boxes[sel.t]; if (!b) return;
  const sc = 1 / (b.scale * slideScale());
  if (its.length > 1) hits.insertAdjacentHTML("beforeend", `<div class="selbox" style="left:${x0}px;top:${y0}px;width:${x1 - x0}px;height:${y1 - y0}px"></div>`);
  const a0 = activeItem(), a = a0 && cellBox(a0);
  if (a) hits.insertAdjacentHTML("beforeend", `<div class="actbox" style="left:${a.bx}px;top:${a.by}px;width:${a.bw}px;height:${a.bh}px;box-shadow:inset 0 0 0 ${2.5 * sc}px #0A66D8,0 0 0 ${1 * sc}px rgba(255,255,255,.9)"></div>`);
}

/* ---- slide interaction: cells + table move/resize ---- */
let DRAG: { t: number } | null = null;
addEventListener("pointerup", () => { const was = DRAG; DRAG = null; if (was && get().selection.painter) applyPainter(); });
/* column / row borders: hovering within 5 screen px of a border shows a resize cursor; dragging sets the
   width/height (for every selected column/row when the border belongs to the selection) */
type Border = { kind: "col" | "row"; key: number; start: number; size: number; pos: number };
function edgeAt(h: HTMLElement, e: PointerEvent | MouseEvent): Border | null {
  const T = curSlide().tables[+h.dataset.t!], rc = h.getBoundingClientRect(), k = rc.width / tableW(T, ctx());
  const lx = (e.clientX - rc.left) / k, ly = (e.clientY - rc.top) / k, tol = 4 / k;
  let best: Border | null = null, bd = tol;
  for (const [x0, w, c] of colEdges(T)) { const d = Math.abs(lx - (x0 + w)); if (d <= bd && ly >= 0 && ly <= T.H) { bd = d; best = { kind: "col", key: c, start: x0, size: w, pos: x0 + w }; } }
  const cache = (T._cache || (T._cache = {})) as Record<string, unknown>;
  const rows = (cache.re || (cache.re = T.rows.map(r => [T.rowY.get(r)!, T.rowH.get(r)!, r]))) as Edge3[];
  for (const [y0, hh, r] of rows) { const d = Math.abs(ly - (y0 + hh)); if (d < bd) { bd = d; best = { kind: "row", key: r, start: y0, size: hh, pos: y0 + hh }; } }
  return best;
}
type Edge3 = [number, number, number];
function startEdgeDrag(h: HTMLElement, e: PointerEvent, edge: Border) {
  const t = +h.dataset.t!, T = curSlide().tables[t], rc = h.getBoundingClientRect(), k = rc.width / tableW(T, ctx());
  const guide = document.createElement("div"); guide.className = "sizeguide " + edge.kind;
  const tip = document.createElement("div"); tip.className = "sizetip";
  h.append(guide, tip); h.setPointerCapture(e.pointerId);
  const sx = e.clientX, sy = e.clientY; let size = edge.size;
  const paint = () => {
    const p = edge.start + size, inv = 1 / k;
    if (edge.kind === "col") Object.assign(guide.style, { left: p + "px", top: "0px", height: T.H + "px", width: 2 * inv + "px" });
    else Object.assign(guide.style, { top: p + "px", left: "0px", width: tableW(T, ctx()) + "px", height: 2 * inv + "px" });
    tip.textContent = Math.round(size) + " px";
    Object.assign(tip.style, edge.kind === "col" ? { left: p + 6 * inv + "px", top: "0px" } : { left: "0px", top: p + 6 * inv + "px" }, { fontSize: 12 * inv + "px", padding: `${2 * inv}px ${6 * inv}px`, borderRadius: 4 * inv + "px" });
  };
  paint();
  const move = (ev: PointerEvent) => { size = Math.max(4, edge.size + (edge.kind === "col" ? ev.clientX - sx : ev.clientY - sy) / k); paint(); };
  const up = () => {
    h.removeEventListener("pointermove", move); h.removeEventListener("pointerup", up); guide.remove(); tip.remove();
    if (Math.abs(size - edge.size) < .5) return;
    const sel = get().selection.sel?.t === t ? (edge.kind === "col" ? selCols() : selRows()) : [];
    const keys = sel.includes(edge.key) ? sel : [edge.key];
    if (edge.kind === "col") setColWidth(T, keys, size); else setRowHeight(T, keys, size);
  };
  h.addEventListener("pointermove", move); h.addEventListener("pointerup", up);
}
function wireSlide(slide: HTMLElement, R: RuntimeSlide) {
  slide.addEventListener("pointerdown", e => {
    const h = (e.target as Element).closest<HTMLElement>(".hits"); if (!h) return;
    const edge = edgeAt(h, e);
    if (edge) { e.preventDefault(); e.stopPropagation(); startEdgeDrag(h, e, edge); return; }
    const it = pointToCell(h, e); if (!it) return;
    e.preventDefault(); (document.getElementById("fxInput") as HTMLInputElement | null)?.blur();
    const t = +h.dataset.t!, cell = { r: it.b.r, c: it.b.c };
    const cur = get().selection.sel;
    if (e.shiftKey && cur && cur.t === t) setSel(t, cur.anchor, cell); else setSel(t, cell, cell);
    DRAG = { t };
  });
  let hovT = 0;
  slide.addEventListener("pointermove", e => {
    const h = (e.target as Element).closest<HTMLElement>(".hits"); if (!h) return;
    const now = performance.now(); if (now - hovT < 16 && !(DRAG && (e.buttons & 1))) return; hovT = now;
    if (!(e.buttons & 1)) { const ed = edgeAt(h, e); h.style.cursor = ed ? (ed.kind === "col" ? "col-resize" : "row-resize") : ""; }
    const it = pointToCell(h, e); if (!it) return;
    const g = cellBox(it), hv = h.querySelector<HTMLElement>(".hov")!;
    Object.assign(hv.style, { display: "block", left: g.bx + "px", top: g.by + "px", width: g.bw + "px", height: g.bh + "px" });
    const cur = get().selection.sel;
    if (DRAG && (e.buttons & 1) && +h.dataset.t! === DRAG.t && cur && (cur.ar !== it.b.r || cur.ac !== it.b.c)) setSel(DRAG.t, cur.anchor, { r: it.b.r, c: it.b.c });
  });
  slide.addEventListener("pointerleave", () => slide.querySelectorAll<HTMLElement>(".hov").forEach(x => x.style.display = "none"));
  slide.addEventListener("dblclick", e => {
    const h = (e.target as Element).closest<HTMLElement>(".hits"); if (!h) return;
    const ed = edgeAt(h, e);            // double-click on a border: back to the Excel size
    if (ed) { const T = curSlide().tables[+h.dataset.t!]; if (ed.kind === "col") setColWidth(T, [ed.key], null, "Column width: Excel"); else setRowHeight(T, [ed.key], null, "Row height: Excel"); return; }
    openInline();
  });
  // text boxes around tables
  slide.querySelectorAll<HTMLButtonElement>(".hbox .addnote").forEach(b => b.addEventListener("pointerdown", e => {
    e.preventDefault(); e.stopPropagation();
    const i = +(b.closest(".hbox") as HTMLElement).dataset.i!, side = b.dataset.side as Side, key = noteKeyOf(R, i, side);
    if ((R.cfg.notes || {})[key]) { pendingNoteEdit = key; STAGE.render(); return; }
    pendingNoteEdit = key;
    change("Add text box", [{ op: "slide.patch", id: R.id, patch: { notes: { [key]: { text: "" } } } } as Op]);
  }));
  slide.querySelectorAll<HTMLElement>(".tnote").forEach(el => {
    el.addEventListener("pointermove", e => { if (!(e.buttons & 1)) { const ed = noteEdge(el, e); el.style.cursor = ed ? (ed === "l" || ed === "r" ? "ew-resize" : "ns-resize") : ""; } });
    el.addEventListener("pointerdown", e => {
      e.stopPropagation(); selectNote(el.dataset.note!);
      const ed = noteEdge(el, e); if (ed) { e.preventDefault(); stretchNote(slide, R, el, ed, e); } else moveNote(slide, R, el, e);
    });
    el.addEventListener("dblclick", e => { e.stopPropagation(); editNote(R, el); });
  });
  if (pendingNoteEdit) { const el = slide.querySelector<HTMLElement>(`.tnote[data-note="${CSS.escape(pendingNoteEdit)}"]`); pendingNoteEdit = null; if (el) setTimeout(() => editNote(R, el), 30); }
  const noteSel = get().selection.noteSel;
  if (noteSel) { const el = slide.querySelector<HTMLElement>(`.tnote[data-note="${CSS.escape(noteSel)}"]`); if (el) paintNoteSel(); else patch("selection", { noteSel: null }); }
  slide.querySelectorAll<HTMLElement>(".hbox").forEach(hb => wireTableHandles(slide, R, hb));
  // titles, subtitles, cover note and date: click selects (the toolbar formats them), double-click edits
  slide.querySelectorAll<HTMLElement>("[data-edit]").forEach(el => {
    el.addEventListener("pointerdown", e => { e.stopPropagation(); selectSlideText(el.dataset.edit as SlideTextKey); });
    el.addEventListener("dblclick", () => editSlideText(R, el));
  });
  // a click on the empty slide clears every selection
  slide.addEventListener("pointerdown", e => {
    if ((e.target as Element).closest(".hits,.tnote,.hbox,[data-edit]")) return;
    const { sel, noteSel, textSel } = get().selection;
    if (sel || noteSel || textSel) patch("selection", { sel: null, textSel: null, noteSel: null });
  });
}
export function editSelectedText() {
  const el = get().selection.textSel && host?.querySelector<HTMLElement>(`.slide [data-edit="${get().selection.textSel}"]`), R = curSlide();
  if (el && R) editSlideText(R, el);
}
const slidePatch = (label: string, R: RuntimeSlide, patch: Record<string, unknown>) => change(label, [{ op: "slide.patch", id: R.id, patch } as Op]);
function wireTableHandles(slide: HTMLElement, R: RuntimeSlide, hb: HTMLElement) {
  const i = +hb.dataset.i!, mark = slide.querySelector<HTMLElement>(".dropmark")!;
  hb.querySelector<HTMLElement>(".size")!.addEventListener("pointerdown", e => {
    e.preventDefault(); e.stopPropagation();
    const c = ctx(), sc = slideScale(), sx = e.clientX, sy = e.clientY;
    const start = computeLayout(R, c).boxes[i], base = layoutOf(R, c), w0 = base.w.slice(), T = R.tables[i];
    const lay: Layout = { bands: JSON.parse(JSON.stringify(base.bands)), w: w0.slice() };
    hb.setPointerCapture(e.pointerId); hb.classList.add("active");
    const move = (ev: PointerEvent) => {
      const target = Math.max(30, Math.max(start.w + (ev.clientX - sx) / sc, (start.h + (ev.clientY - sy) / sc) * tableW(T, c) / T.H));
      let lo = 0.05, hi = 30;
      for (let n = 0; n < 36; n++) { const mid = (lo + hi) / 2; const ww = w0.slice(); ww[i] = mid; if (computeLayout(R, c, ww, lay).boxes[i].w < target) lo = mid; else hi = mid; }
      lay.w = w0.slice(); lay.w[i] = Math.round(lo * 1000) / 1000;
      applyLayout(slide, R, c, lay.w, lay);
    };
    const up = () => { hb.removeEventListener("pointermove", move); hb.removeEventListener("pointerup", up); hb.classList.remove("active"); slidePatch("Resize table", R, sizingPatch(R, c, { ...sizingOf(R, c), layout: lay })); };
    hb.addEventListener("pointermove", move); hb.addEventListener("pointerup", up);
  });
  // borders of the table: drag to stretch the columns (left/right) or rows (top/bottom)
  hb.querySelectorAll<HTMLElement>(".edge").forEach(edge => edge.addEventListener("pointerdown", e => {
    e.preventDefault(); e.stopPropagation();
    const side = edge.dataset.edge as "l" | "r" | "t" | "b", horiz = side === "l" || side === "r";
    const sc = slideScale(), sx = e.clientX, sy = e.clientY, b = computeLayout(R, ctx()).boxes[i];
    const tip = document.createElement("div"); tip.className = "edgetip"; hb.appendChild(tip);
    hb.classList.add("active");          // listeners on the window: a redraw during the drag (sync) must not lose it
    let f = 1;
    const move = (ev: PointerEvent) => {
      const d = (horiz ? ev.clientX - sx : ev.clientY - sy) / sc * (side === "l" || side === "t" ? -1 : 1);
      f = Math.max(.2, Math.min(5, ((horiz ? b.w : b.h) + d) / (horiz ? b.w : b.h)));
      const w = horiz ? b.w * f : b.h * f;
      if (horiz) Object.assign(hb.style, { width: w + "px", left: (side === "l" ? b.x + b.w - w : b.x) + "px" });
      else Object.assign(hb.style, { height: w + "px", top: (side === "t" ? b.y + b.h - w : b.y) + "px" });
      tip.textContent = Math.round(f * 100) + " %";
    };
    const up = () => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up); hb.classList.remove("active"); tip.remove();
      if (Math.abs(f - 1) < .005) { if (hb.isConnected) applyLayout(slide, R, ctx()); return; }
      const L = curSlide()?.tables[i]; if (L && curSlide().id === R.id) stretchTable(L, horiz ? "x" : "y", f);
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  }));
  hb.querySelector<HTMLElement>(".grip")!.addEventListener("pointerdown", e => {
    e.preventDefault(); e.stopPropagation();
    const c = ctx(), sc = slideScale(), rect = slide.getBoundingClientRect();
    hb.setPointerCapture(e.pointerId); hb.classList.add("active");
    let drop: { t: number; b: ReturnType<typeof computeLayout>["boxes"][number]; zone: "left" | "right" | "top" | "bottom" } | null = null;
    const move = (ev: PointerEvent) => {
      const px = (ev.clientX - rect.left) / sc, py = (ev.clientY - rect.top) / sc, boxes = computeLayout(R, c).boxes;
      drop = null; let best = Infinity;
      for (const b of boxes) {
        if (!b || b.i === i) continue;
        const cx = Math.max(b.x, Math.min(px, b.x + b.w)), cy = Math.max(b.y, Math.min(py, b.y + b.h)), dist = Math.hypot(px - cx, py - cy);
        if (dist < best) { best = dist; const rx = (px - b.x) / b.w - .5, ry = (py - b.y) / b.h - .5; drop = { t: b.i, b, zone: Math.abs(rx) > Math.abs(ry) ? (rx < 0 ? "left" : "right") : (ry < 0 ? "top" : "bottom") }; }
      }
      if (drop && best < 240) {
        const b = drop.b, st = mark.style; mark.style.display = "block";
        if (drop.zone === "left" || drop.zone === "right") Object.assign(st, { left: (drop.zone === "left" ? b.x - GX / 2 - 3 : b.x + b.w + GX / 2 - 3) + "px", top: b.y + "px", width: "6px", height: b.h + "px" });
        else { const bb = boxes.filter(x => x && x.band === b.band), l = Math.min(...bb.map(x => x.x)), r = Math.max(...bb.map(x => x.x + x.w)); const t = drop.zone === "top" ? Math.min(...bb.map(x => x.y)) - GY / 2 - 3 : Math.max(...bb.map(x => x.y + x.h)) + GY / 2 - 3; Object.assign(st, { left: l + "px", top: t + "px", width: (r - l) + "px", height: "6px" }); }
      } else { drop = null; mark.style.display = "none"; }
    };
    const up = () => {
      hb.removeEventListener("pointermove", move); hb.removeEventListener("pointerup", up); hb.classList.remove("active"); mark.style.display = "none";
      if (!drop) return;
      const lay: Layout = JSON.parse(JSON.stringify(layoutOf(R, c)));
      const bands = lay.bands.map(b => b.filter(x => x !== i)); const bi = bands.findIndex(b => b.includes(drop!.t));
      if (drop.zone === "left" || drop.zone === "right") { const p = bands[bi].indexOf(drop.t); bands[bi].splice(drop.zone === "left" ? p : p + 1, 0, i); }
      else bands.splice(drop.zone === "top" ? bi : bi + 1, 0, [i]);
      lay.bands = bands.filter(b => b.length);
      slidePatch("Move table", R, sizingPatch(R, c, { ...sizingOf(R, c), layout: lay }));
    };
    hb.addEventListener("pointermove", move); hb.addEventListener("pointerup", up);
  });
}

/* ---- inline editing ---- */
let INLINE: HTMLInputElement | null = null;
export function openInline(initial?: string) {
  const it = activeItem(); const wrap = wrapEl(); const sel = get().selection.sel;
  if (!it || INLINE || !wrap || !sel) return;
  const R = curSlide(), hits = wrap.querySelector<HTMLElement>(`.hits[data-t="${sel.t}"]`); if (!hits) return;
  const T = R.tables[sel.t], g = cellBox(it), rc = hits.getBoundingClientRect(), k = rc.width / tableW(T, ctx());
  const wr = wrap.getBoundingClientRect(), hr = { left: rc.left + g.bx * k, top: rc.top + g.by * k, width: g.bw * k, height: g.bh * k };
  const inp = document.createElement("input"); inp.className = "inline-edit";
  inp.value = initial !== undefined ? initial : effText(ctx(), it);
  const fpx = (effFmt(ctx(), it).sz * 96 / 72) * computeLayout(R, ctx()).boxes[sel.t].scale * slideScale();
  Object.assign(inp.style, { left: (hr.left - wr.left - 2) + "px", top: (hr.top - wr.top - 2) + "px", width: Math.max(120, hr.width + 4) + "px", height: Math.max(26, hr.height + 4) + "px", fontSize: Math.max(12, fpx) + "px", textAlign: it.align === "right" ? "right" : it.align === "center" ? "center" : "left" });
  wrap.appendChild(inp); inp.focus(); if (initial === undefined) inp.select(); else inp.setSelectionRange(inp.value.length, inp.value.length);
  INLINE = inp;
  let done = false;
  const finish = (ok: boolean, move?: [number, number]) => { if (done) return; done = true; INLINE = null; const v = inp.value; inp.remove(); if (ok) commitText(v, move); afterEdit(); };
  inp.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); finish(true, [e.shiftKey ? -1 : 1, 0]); }
    else if (e.key === "Tab") { e.preventDefault(); finish(true, [0, e.shiftKey ? -1 : 1]); }
    else if (e.key === "Escape") finish(false);
  });
  inp.addEventListener("blur", () => finish(true));
}
/* titles, subtitles, cover note and date: double-click on the slide to edit (stored in the preset) */
const TEXT_LABEL: Record<SlideTextKey, string> = { title: "Edit title", subtitle: "Edit subtitle", note: "Edit cover note", date: "Edit date" };
function editSlideText(R: RuntimeSlide, el: HTMLElement) {
  const key = el.dataset.edit as SlideTextKey, wrap = wrapEl(); if (!wrap) return;
  const wr = wrap.getBoundingClientRect(), r = el.getBoundingClientRect(), cs = getComputedStyle(el), sc = slideScale();
  const inp = document.createElement("input"); inp.className = "inline-edit";
  inp.value = key === "title" ? R.title : key === "subtitle" ? (R.subtitle || "") : key === "date" ? (R.cfg.date || todayLabel()) : (R.cfg.note || "");
  Object.assign(inp.style, { left: (r.left - wr.left - 4) + "px", top: (r.top - wr.top - 4) + "px", width: Math.max(320, r.width + 40) + "px", height: Math.max(28, r.height + 8) + "px",
    fontSize: Math.max(14, parseFloat(cs.fontSize) * sc) + "px", fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, fontFamily: cs.fontFamily });
  wrap.appendChild(inp); inp.focus(); inp.select();
  let done = false;
  const finish = (ok: boolean) => { if (done) return; done = true; const v = inp.value.trim(); inp.remove(); if (ok) slidePatch(TEXT_LABEL[key], R, { [key]: v || null }); afterEdit(); };
  inp.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); });
  inp.addEventListener("blur", () => finish(true));
}
export const isInlineOpen = () => !!INLINE;
export { STAGE };

/* ---- text boxes ---- */
/* stretching: the outer edges of a text box can be dragged (a box beside a table: its far edge and its
   bottom; a box above/below: its outer edge and its right edge). The dragged edge snaps to the edges of
   the tables, other text boxes and the content area, and a guide line shows what it lines up with. */
type NEdge = "l" | "r" | "t" | "b";
const STRETCH: Record<Side, NEdge[]> = { right: ["r", "b"], left: ["l", "b"], top: ["t", "r"], bottom: ["b", "r"] };
function noteEdge(el: HTMLElement, e: PointerEvent | MouseEvent): NEdge | null {
  const r = el.getBoundingClientRect(), tol = 7;
  const near: Record<NEdge, boolean> = { l: Math.abs(e.clientX - r.left) <= tol, r: Math.abs(e.clientX - r.right) <= tol, t: Math.abs(e.clientY - r.top) <= tol, b: Math.abs(e.clientY - r.bottom) <= tol };
  return (el.classList.contains("free") ? (["l", "r", "t", "b"] as NEdge[]) : STRETCH[el.dataset.side as Side]).find(k => near[k]) || null;
}
const SNAP = 8;
function snapTargets(slide: HTMLElement, R: RuntimeSlide, self: HTMLElement): { x: number[]; y: number[] } {
  const b = computeLayout(R, ctx()).boxes, xs = [50, 1550], ys = [822];
  for (const t of b) if (t) { xs.push(t.x, t.x + t.w); ys.push(t.y, t.y + t.h); }
  // other text boxes, the notes section, page number and footer – as drawn
  slide.querySelectorAll<HTMLElement>(":scope > .tnote, :scope > .pageno").forEach(el => {
    if (el === self || el.style.display === "none") return;
    const x = parseFloat(el.style.left), y = parseFloat(el.style.top), w = parseFloat(el.style.width), h = parseFloat(el.style.height);
    if ([x, y, w, h].every(isFinite)) { xs.push(x, x + w); ys.push(y, y + h); }
  });
  return { x: xs, y: ys };
}
function stretchNote(slide: HTMLElement, R: RuntimeSlide, el: HTMLElement, edge: NEdge, e: PointerEvent) {
  const sc = slideScale(), key = el.dataset.note!, cur = (R.cfg.notes || {})[key]; if (!cur) return;
  const x0 = parseFloat(el.style.left), y0 = parseFloat(el.style.top), w0 = parseFloat(el.style.width), h0 = parseFloat(el.style.height);
  const horiz = edge === "l" || edge === "r", targets = snapTargets(slide, R, el);
  const guide = document.createElement("div"); guide.className = "snapline " + (horiz ? "v" : "h"); slide.appendChild(guide);
  const bub = slide.querySelector<HTMLElement>(`.notebub[data-i="${el.dataset.i}"][data-side="${el.dataset.side}"]`);
  const sx = e.clientX, sy = e.clientY; let size = horiz ? w0 : h0;
  const move = (ev: PointerEvent) => {
    const d = (horiz ? ev.clientX - sx : ev.clientY - sy) / sc * (edge === "l" || edge === "t" ? -1 : 1);
    size = Math.max(horiz ? 120 : 40, (horiz ? w0 : h0) + d);
    // the moving edge, in slide px, and the nearest edge it can line up with
    const pos = edge === "r" ? x0 + size : edge === "l" ? x0 + w0 - size : edge === "b" ? y0 + size : y0 + h0 - size;
    let best: number | null = null;
    for (const t of horiz ? targets.x : targets.y) if (Math.abs(t - pos) <= SNAP && (best === null || Math.abs(t - pos) < Math.abs(best - pos))) best = t;
    if (best !== null) size += (edge === "r" || edge === "b" ? 1 : -1) * (best - pos);
    guide.style.display = best === null ? "none" : "block";
    if (best !== null) Object.assign(guide.style, horiz ? { left: best + "px" } : { top: best + "px" });
    const st = horiz ? { width: size + "px", ...(edge === "l" ? { left: x0 + w0 - size + "px" } : {}) } : { height: size + "px", ...(edge === "t" ? { top: y0 + h0 - size + "px" } : {}) };
    Object.assign(el.style, st); if (bub) Object.assign(bub.style, st);
  };
  const up = () => {
    removeEventListener("pointermove", move); removeEventListener("pointerup", up); guide.remove();
    if (Math.abs(size - (horiz ? w0 : h0)) < 1) return;
    const next: Note = { ...cur, [horiz ? "w" : "h"]: Math.round(size) };
    // a free box dragged by its left/top edge also moves
    if (el.classList.contains("free")) { next.x = Math.round(parseFloat(el.style.left)); next.y = Math.round(parseFloat(el.style.top)); }
    change(horiz ? "Text box width" : "Text box height", [{ op: "slide.patch", id: R.id, patch: { notes: { [key]: next } } } as Op]);
  };
  addEventListener("pointermove", move); addEventListener("pointerup", up);
}
/* moving: drag a text box by its body to put it anywhere on the slide (e.g. below one table and beside
   another). It snaps – left/right edges and top/bottom edges – to tables, other boxes and the content area. */
function moveNote(slide: HTMLElement, R: RuntimeSlide, el: HTMLElement, e: PointerEvent) {
  if (e.button !== 0 || el.querySelector("textarea") || editorOpen()) return;
  const sc = slideScale(), key = el.dataset.note!, cur = (R.cfg.notes || {})[key]; if (!cur) return;
  const x0 = parseFloat(el.style.left), y0 = parseFloat(el.style.top), w = parseFloat(el.style.width), h = parseFloat(el.style.height);
  const sx = e.clientX, sy = e.clientY; let started = false, nx = x0, ny = y0;
  let targets: { x: number[]; y: number[] } | null = null, gv: HTMLElement | null = null, gh: HTMLElement | null = null;
  const bub = slide.querySelector<HTMLElement>(`.notebub[data-i="${el.dataset.i}"][data-side="${el.dataset.side}"]`);
  const snap = (a: number, size: number, list: number[]) => {
    let best: { d: number; line: number } | null = null;
    for (const t of list) for (const edge of [a, a + size]) { const d = t - edge; if (Math.abs(d) <= SNAP && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line: t }; }
    return best;
  };
  const move = (ev: PointerEvent) => {
    const dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc;
    if (!started) {
      if (Math.hypot(dx, dy) < 4) return;                         // a click (select, double-click to edit) is not a move
      started = true; targets = snapTargets(slide, R, el); el.classList.add("moving");
      gv = document.createElement("div"); gv.className = "snapline v"; gh = document.createElement("div"); gh.className = "snapline h"; slide.append(gv, gh);
    }
    nx = Math.max(0, Math.min(1600 - w, x0 + dx)); ny = Math.max(0, Math.min(900 - h, y0 + dy));
    const bx = snap(nx, w, targets!.x), by = snap(ny, h, targets!.y);
    if (bx) nx += bx.d; if (by) ny += by.d;
    gv!.style.display = bx ? "block" : "none"; if (bx) gv!.style.left = bx.line + "px";
    gh!.style.display = by ? "block" : "none"; if (by) gh!.style.top = by.line + "px";
    const st = { left: nx + "px", top: ny + "px" }; Object.assign(el.style, st); if (bub) Object.assign(bub.style, st);
  };
  const up = () => {
    removeEventListener("pointermove", move); removeEventListener("pointerup", up);
    if (!started) return;
    gv?.remove(); gh?.remove(); el.classList.remove("moving");
    const { span: _s, ...rest } = cur;
    change("Move text box", [{ op: "slide.patch", id: R.id, patch: { notes: { [key]: { ...rest, x: Math.round(nx), y: Math.round(ny), w: Math.round(w), h: Math.round(h) } } } } as Op]);
  };
  addEventListener("pointermove", move); addEventListener("pointerup", up);
}
/** adds the slide's notes section (where the footer is) and opens it for typing; selects it when it exists */
export function addSlideNotes() {
  const R = curSlide(); if (!R) return;
  if ((R.cfg.notes || {})[MEMO_KEY]) { selectNote(MEMO_KEY); return; }
  pendingNoteEdit = MEMO_KEY;
  change("Add notes", [{ op: "slide.patch", id: R.id, patch: { notes: { [MEMO_KEY]: { text: "", size: 13, color: "#5B6274" } } } } as Op]);
}
/** puts a moved text box back next to its table */
export function attachNote() {
  const R = curSlide(), key = get().selection.noteSel, cur = key && R?.cfg.notes?.[key]; if (!R || !key || !cur) return;
  const { x: _x, y: _y, ...rest } = cur;
  change("Text box back next to the table", [{ op: "slide.patch", id: R.id, patch: { notes: { [key]: rest } } } as Op]);
}
let pendingNoteEdit: string | null = null;
const noteKeyOf = (R: RuntimeSlide, i: number, side: Side) => (R.tables[i].id || String(i)) + ":" + side;
export function noteOf(key: string): Note | null { return (curSlide()?.cfg.notes || {})[key] || null; }
/** selects a text box (null: none); the subscription in mountStage paints it */
export function selectNote(key: string | null) {
  patch("selection", key ? { noteSel: key, sel: null, textSel: null } : { noteSel: null });
}
function paintNoteSel() {
  host?.querySelectorAll(".tnote.sel").forEach(e => e.classList.remove("sel"));
  const key = get().selection.noteSel;
  if (key) host?.querySelector(`.tnote[data-note="${CSS.escape(key)}"]`)?.classList.add("sel");
}
export function patchNote(label: string, patch: Partial<Note> | null) {
  const R = curSlide(), key = get().selection.noteSel; if (!R || !key) return;
  const cur = noteOf(key); if (!cur && patch) return;
  change(label, [{ op: "slide.patch", id: R.id, patch: { notes: { [key]: patch === null ? null : { ...cur, ...patch } } } } as Op]);
  if (patch === null) patchAll({ selection: { noteSel: null } });
}
function editNote(R: RuntimeSlide, el: HTMLElement) {
  const wrap = wrapEl(); if (!wrap) return;
  const key = el.dataset.note!, cur = (R.cfg.notes || {})[key] || { text: "" };
  // an automated comment shows its current text; changing it turns it into fixed text
  const T = R.tables[+el.dataset.i!], gen = cur.auto && T ? commentText(T, cur.auto, ctx(), R) : null;
  selectNote(key);
  const wr = wrap.getBoundingClientRect(), r = el.getBoundingClientRect();
  const ta = document.createElement("textarea"); ta.className = "inline-edit note-edit"; ta.value = gen ?? (cur.text || "");
  Object.assign(ta.style, { left: (r.left - wr.left - 2) + "px", top: (r.top - wr.top - 2) + "px", width: Math.max(160, r.width + 4) + "px", height: Math.max(48, r.height + 4) + "px",
    fontSize: Math.max(12, (parseFloat(el.style.fontSize) || 18) * slideScale()) + "px", textAlign: el.style.textAlign || "left" });
  wrap.appendChild(ta); ta.focus(); if (gen === null) ta.select();
  let done = false;
  const finish = (ok: boolean) => {
    if (done) return; done = true; const v = ta.value; ta.remove(); afterEdit();
    if (!ok) return;
    // an empty box that was never written is removed again
    if (!v.trim()) { change("Remove text box", [{ op: "slide.patch", id: R.id, patch: { notes: { [key]: null } } } as Op]); patch("selection", { noteSel: null }); return; }
    if (gen !== null) {
      if (v === gen) return;
      const { auto: _a, ...rest } = cur;
      change("Edit comment", [{ op: "slide.patch", id: R.id, patch: { notes: { [key]: { ...rest, text: v } } } } as Op]);
      toast("The comment is now fixed text – it no longer follows the numbers. Use <b>Comment…</b> to write it automatically again.");
      return;
    }
    if (v !== cur.text) change("Edit text box", [{ op: "slide.patch", id: R.id, patch: { notes: { [key]: { ...cur, text: v } } } } as Op]);
  };
  ta.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Escape") finish(false); if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) finish(true); });
  ta.addEventListener("blur", () => finish(true));
}
export { shownColW, shownRowH };
