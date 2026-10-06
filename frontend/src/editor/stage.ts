/* The slide being edited: imperative DOM for speed (one overlay per table, binary-search hit
   testing, only changed cells are swapped after an edit). */
import { S, emit, STAGE } from "../state/store";
import { change, ctx, setZoom } from "../state/app";
import type { Item, TableLayout } from "../xlsx/types";
import type { Layout, Op, RuntimeSlide } from "../model/types";
import { applyLayout, buildSlide, computeLayout, GX, GY, layoutOf, tableHtml, tableW, type SlideEl } from "../render/slide";
import { glassGeom, gItem } from "../render/glass";
import { effFmt, effText } from "../render/edits";
import { activeItem, commitText, curSlide, itemAt, selItems, setSel } from "./edit";
import { selCols, selRows, setColWidth, setRowHeight, shownColW, shownRowH } from "./tables";
import type { Note, Side } from "../model/types";

let host: HTMLElement | null = null;
export function mountStage(el: HTMLElement) {
  host = el;
  STAGE.render = renderStage; STAGE.refresh = refreshStage; STAGE.paintSel = paintSel; STAGE.fit = fitStage;
  addEventListener("resize", fitStage);
  renderStage();
}
const wrapEl = () => host?.querySelector<HTMLElement & { _scale?: number }>(".stagewrap") || null;
export const slideScale = () => wrapEl()?._scale || 1;

/* geometry of a cell on screen (Liquid Glass widens columns) */
function cellBox(it: Item): Item { if (ctx().style.design !== "glass" || !it.L) return it; return gItem(it, glassGeom(it.L, ctx())); }

export function renderStage() {
  if (!host) return;
  host.innerHTML = "";
  const R = curSlide(); if (!R) return;
  const wrap = document.createElement("div") as HTMLDivElement & { _scale?: number }; wrap.className = "stagewrap";
  const slide = buildSlide(R, S.cur, ctx(), { interactive: true });
  wrap.appendChild(slide); host.appendChild(wrap);
  slide.querySelectorAll<HTMLElement & { _html?: string }>(":scope > .tw").forEach(tw => { tw._html = tableHtml(R, +tw.dataset.i!, ctx()); });
  slide.querySelectorAll<HTMLImageElement>("img.logo").forEach(img => img.addEventListener("error", () => { (img.parentNode as HTMLElement).style.display = "none"; if (!S.logoMissing) { S.logoMissing = true; emit(); } }));
  wireSlide(slide, R);
  fitStage(); paintSel();
}
export function fitStage() {
  const wrap = wrapEl(); if (!host || !wrap) return;
  const cw = host.clientWidth, ch = host.clientHeight;
  const fit = Math.min((cw - 56) / 1600, (ch - 64) / 900);
  const s = S.zoom === "fit" ? fit : S.zoom;
  const slide = wrap.querySelector<HTMLElement>(".slide")!; slide.style.transform = `scale(${s})`;
  wrap.style.width = 1600 * s + "px"; wrap.style.height = 900 * s + "px";
  wrap.style.left = Math.max(16, (cw - 1600 * s) / 2) + "px"; wrap.style.top = Math.max(16, (ch - 900 * s) / 2) + "px";
  host.style.overflow = S.zoom === "fit" ? "hidden" : "auto";
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
  const sel = S.sel; if (!sel || !curSlide()) return;
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
addEventListener("pointerup", () => { DRAG = null; });
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
    const sel = S.sel && S.sel.t === t ? (edge.kind === "col" ? selCols() : selRows()) : [];
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
    if (e.shiftKey && S.sel && S.sel.t === t) setSel(t, S.sel.anchor, cell); else setSel(t, cell, cell);
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
    if (DRAG && (e.buttons & 1) && +h.dataset.t! === DRAG.t && S.sel && (S.sel.ar !== it.b.r || S.sel.ac !== it.b.c)) setSel(DRAG.t, S.sel.anchor, { r: it.b.r, c: it.b.c });
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
    el.addEventListener("pointerdown", e => { e.stopPropagation(); selectNote(el.dataset.note!); });
    el.addEventListener("dblclick", e => { e.stopPropagation(); editNote(R, el); });
  });
  if (pendingNoteEdit) { const el = slide.querySelector<HTMLElement>(`.tnote[data-note="${CSS.escape(pendingNoteEdit)}"]`); pendingNoteEdit = null; if (el) setTimeout(() => editNote(R, el), 30); }
  if (S.noteSel) { const el = slide.querySelector<HTMLElement>(`.tnote[data-note="${CSS.escape(S.noteSel)}"]`); if (el) paintNoteSel(); else S.noteSel = null; }
  slide.querySelectorAll<HTMLElement>(".hbox").forEach(hb => wireTableHandles(slide, R, hb));
  slide.querySelectorAll<HTMLElement>("[data-edit]").forEach(el => el.addEventListener("dblclick", () => editSlideText(R, el)));
}
const slidePatch = (label: string, R: RuntimeSlide, patch: Record<string, unknown>) => change(label, [{ op: "slide.patch", id: R.id, patch } as Op]);
function wireTableHandles(slide: HTMLElement, R: RuntimeSlide, hb: HTMLElement) {
  const i = +hb.dataset.i!, mark = slide.querySelector<HTMLElement>(".dropmark")!;
  hb.querySelector<HTMLElement>(".size")!.addEventListener("pointerdown", e => {
    e.preventDefault(); e.stopPropagation();
    const c = ctx(), sc = slideScale(), sx = e.clientX, sy = e.clientY;
    const start = computeLayout(R, c).boxes[i], base = layoutOf(R), w0 = base.w.slice(), T = R.tables[i];
    const lay: Layout = { bands: JSON.parse(JSON.stringify(base.bands)), w: w0.slice() };
    hb.setPointerCapture(e.pointerId); hb.classList.add("active");
    const move = (ev: PointerEvent) => {
      const target = Math.max(30, Math.max(start.w + (ev.clientX - sx) / sc, (start.h + (ev.clientY - sy) / sc) * tableW(T, c) / T.H));
      let lo = 0.05, hi = 30;
      for (let n = 0; n < 36; n++) { const mid = (lo + hi) / 2; const ww = w0.slice(); ww[i] = mid; if (computeLayout(R, c, ww, lay).boxes[i].w < target) lo = mid; else hi = mid; }
      lay.w = w0.slice(); lay.w[i] = Math.round(lo * 1000) / 1000;
      applyLayout(slide, R, c, lay.w, lay);
    };
    const up = () => { hb.removeEventListener("pointermove", move); hb.removeEventListener("pointerup", up); hb.classList.remove("active"); slidePatch("Resize table", R, { layout: lay }); };
    hb.addEventListener("pointermove", move); hb.addEventListener("pointerup", up);
  });
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
      const lay: Layout = JSON.parse(JSON.stringify(layoutOf(R)));
      const bands = lay.bands.map(b => b.filter(x => x !== i)); const bi = bands.findIndex(b => b.includes(drop!.t));
      if (drop.zone === "left" || drop.zone === "right") { const p = bands[bi].indexOf(drop.t); bands[bi].splice(drop.zone === "left" ? p : p + 1, 0, i); }
      else bands.splice(drop.zone === "top" ? bi : bi + 1, 0, [i]);
      lay.bands = bands.filter(b => b.length);
      slidePatch("Move table", R, { layout: lay });
    };
    hb.addEventListener("pointermove", move); hb.addEventListener("pointerup", up);
  });
}

/* ---- inline editing ---- */
let INLINE: HTMLInputElement | null = null;
export function openInline(initial?: string) {
  const it = activeItem(); const wrap = wrapEl(); const sel = S.sel;
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
  const finish = (ok: boolean, move?: [number, number]) => { if (done) return; done = true; INLINE = null; const v = inp.value; inp.remove(); if (ok) commitText(v, move); };
  inp.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); finish(true, [e.shiftKey ? -1 : 1, 0]); }
    else if (e.key === "Tab") { e.preventDefault(); finish(true, [0, e.shiftKey ? -1 : 1]); }
    else if (e.key === "Escape") finish(false);
  });
  inp.addEventListener("blur", () => finish(true));
}
/* titles and subtitles: double-click on the slide to edit (stored in the preset) */
function editSlideText(R: RuntimeSlide, el: HTMLElement) {
  const key = el.dataset.edit as "title" | "subtitle", wrap = wrapEl(); if (!wrap) return;
  const wr = wrap.getBoundingClientRect(), r = el.getBoundingClientRect();
  const inp = document.createElement("input"); inp.className = "inline-edit";
  inp.value = key === "title" ? R.title : (R.subtitle || "");
  Object.assign(inp.style, { left: (r.left - wr.left - 4) + "px", top: (r.top - wr.top - 4) + "px", width: Math.max(320, r.width + 40) + "px", height: (r.height + 8) + "px", fontSize: Math.max(14, r.height * 0.62) + "px", fontWeight: key === "title" ? "700" : "500" });
  wrap.appendChild(inp); inp.focus(); inp.select();
  let done = false;
  const finish = (ok: boolean) => { if (done) return; done = true; const v = inp.value.trim(); inp.remove(); if (ok) slidePatch(key === "title" ? "Edit title" : "Edit subtitle", R, { [key]: v || null }); };
  inp.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); });
  inp.addEventListener("blur", () => finish(true));
}
export const isInlineOpen = () => !!INLINE;
export { STAGE };

/* ---- text boxes ---- */
let pendingNoteEdit: string | null = null;
const noteKeyOf = (R: RuntimeSlide, i: number, side: Side) => (R.tables[i].id || String(i)) + ":" + side;
export function noteOf(key: string): Note | null { return (curSlide()?.cfg.notes || {})[key] || null; }
export function selectNote(key: string | null) {
  S.noteSel = key; if (key) { S.sel = null; paintSel(); }
  paintNoteSel(); emit();
}
function paintNoteSel() {
  host?.querySelectorAll(".tnote.sel").forEach(e => e.classList.remove("sel"));
  if (S.noteSel) host?.querySelector(`.tnote[data-note="${CSS.escape(S.noteSel)}"]`)?.classList.add("sel");
}
export function patchNote(label: string, patch: Partial<Note> | null) {
  const R = curSlide(), key = S.noteSel; if (!R || !key) return;
  const cur = noteOf(key); if (!cur && patch) return;
  change(label, [{ op: "slide.patch", id: R.id, patch: { notes: { [key]: patch === null ? null : { ...cur, ...patch } } } } as Op]);
  if (patch === null) S.noteSel = null;
}
function editNote(R: RuntimeSlide, el: HTMLElement) {
  const wrap = wrapEl(); if (!wrap) return;
  const key = el.dataset.note!, cur = (R.cfg.notes || {})[key] || { text: "" };
  selectNote(key);
  const wr = wrap.getBoundingClientRect(), r = el.getBoundingClientRect();
  const ta = document.createElement("textarea"); ta.className = "inline-edit note-edit"; ta.value = cur.text || "";
  Object.assign(ta.style, { left: (r.left - wr.left - 2) + "px", top: (r.top - wr.top - 2) + "px", width: Math.max(160, r.width + 4) + "px", height: Math.max(48, r.height + 4) + "px",
    fontSize: Math.max(12, (parseFloat(el.style.fontSize) || 18) * slideScale()) + "px", textAlign: el.style.textAlign || "left" });
  wrap.appendChild(ta); ta.focus(); ta.select();
  let done = false;
  const finish = (ok: boolean) => {
    if (done) return; done = true; const v = ta.value; ta.remove();
    if (!ok) return;
    // an empty box that was never written is removed again
    if (!v.trim()) { change("Remove text box", [{ op: "slide.patch", id: R.id, patch: { notes: { [key]: null } } } as Op]); S.noteSel = null; return; }
    if (v !== cur.text) change("Edit text box", [{ op: "slide.patch", id: R.id, patch: { notes: { [key]: { ...cur, text: v } } } } as Op]);
  };
  ta.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Escape") finish(false); if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) finish(true); });
  ta.addEventListener("blur", () => finish(true));
}
export { shownColW, shownRowH };
