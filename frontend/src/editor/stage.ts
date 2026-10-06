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
function wireSlide(slide: HTMLElement, R: RuntimeSlide) {
  slide.addEventListener("pointerdown", e => {
    const h = (e.target as Element).closest<HTMLElement>(".hits"); if (!h) return;
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
    const it = pointToCell(h, e); if (!it) return;
    const g = cellBox(it), hv = h.querySelector<HTMLElement>(".hov")!;
    Object.assign(hv.style, { display: "block", left: g.bx + "px", top: g.by + "px", width: g.bw + "px", height: g.bh + "px" });
    if (DRAG && (e.buttons & 1) && +h.dataset.t! === DRAG.t && S.sel && (S.sel.ar !== it.b.r || S.sel.ac !== it.b.c)) setSel(DRAG.t, S.sel.anchor, { r: it.b.r, c: it.b.c });
  });
  slide.addEventListener("pointerleave", () => slide.querySelectorAll<HTMLElement>(".hov").forEach(x => x.style.display = "none"));
  slide.addEventListener("dblclick", e => { if ((e.target as Element).closest(".hits")) openInline(); });
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
